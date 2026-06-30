import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { PKT_OFFSET_MS, WhatsAppReportService, type AwaitingContact } from './whatsapp-report.service';

/**
 * Emails the daily WhatsApp activity report at 8 AM PKT, covering the previous
 * full PKT day. Each salesperson gets a private summary of their own numbers +
 * their follow-up list; the admin addresses get the whole-team leaderboard plus
 * every awaiting list. Mirrors the existing onModuleInit + setInterval sweeper
 * pattern (sla-sweeper, expiry-sweeper) — there is no @nestjs/schedule here.
 *
 * Idempotent: one `WhatsAppDailyReportLog` row per covered PKT day, so a backend
 * restart after 8 AM can't re-blast the team. Toggle off with
 * WA_DAILY_REPORT_ENABLED=false; override admin recipients with
 * WA_DAILY_REPORT_ADMINS (comma-separated).
 */
@Injectable()
export class WhatsAppDailyReportService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WhatsAppDailyReportService.name);
  private static readonly SEND_HOUR_PKT = 8;
  private static readonly TICK_MS = 10 * 60 * 1000; // re-check every 10 min
  private static readonly DEFAULT_ADMINS = ['tashfeensohail98@gmail.com', 'tashfeensohail99@gmail.com'];
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly reports: WhatsAppReportService,
  ) {}

  onModuleInit(): void {
    if (process.env.WA_DAILY_REPORT_ENABLED === 'false') {
      this.log.log('WhatsApp daily report disabled (WA_DAILY_REPORT_ENABLED=false).');
      return;
    }
    // First check shortly after boot (catch-up if we started after 8 AM), then
    // every 10 minutes. unref() so these timers never hold the process open.
    this.bootTimer = setTimeout(() => void this.tick(), 90_000);
    this.timer = setInterval(() => void this.tick(), WhatsAppDailyReportService.TICK_MS);
    this.bootTimer.unref?.();
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
  }

  private adminRecipients(): string[] {
    const raw = process.env.WA_DAILY_REPORT_ADMINS;
    const list = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : WhatsAppDailyReportService.DEFAULT_ADMINS;
    return [...new Set(list)];
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const pktHour = new Date(Date.now() + PKT_OFFSET_MS).getUTCHours();
      if (pktHour < WhatsAppDailyReportService.SEND_HOUR_PKT) return;

      const reportDate = this.reports.pktDateString(1); // yesterday (PKT)
      // Fast path: already done today. The create() below is the AUTHORITATIVE
      // atomic claim; this just avoids recomputing every 10 min once sent.
      // Tolerate the marker table not existing yet (pre-migration).
      try {
        if (await this.prisma.whatsAppDailyReportLog.findUnique({ where: { reportDate } })) return;
      } catch (e) {
        this.log.warn(`daily_report_log not ready (${(e as Error).message}); skipping until migrated.`);
        return;
      }

      const from = this.reports.pktMidnightUtc(1);
      const to = this.reports.pktMidnightUtc(0);
      const report = await this.reports.computeActivity(from, to);

      // CLAIM the day BEFORE sending, so a restart/redeploy/crash mid-send can
      // never re-blast the team: the reportDate primary key makes this atomic.
      // P2002 → already claimed by a concurrent/previous run, skip silently;
      // P2021 (table missing) → skip until migrated; any other write error →
      // skip WITHOUT sending (a missed report beats a double blast).
      try {
        await this.prisma.whatsAppDailyReportLog.create({
          data: { reportDate, recipients: 0, texted: report.totals.texted, replied: report.totals.replied },
        });
      } catch (e) {
        const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined;
        if (code === 'P2002') return; // already claimed
        this.log.warn(`Could not claim daily report for ${reportDate} (${code ?? (e as Error).message}); not sending.`);
        return;
      }

      if (report.totals.texted === 0) {
        this.log.log(`No WhatsApp activity for ${reportDate}; marker written, no emails sent.`);
        return;
      }

      let recipients = 0;

      // 1) Per-rep private emails (own stats + own awaiting list).
      const repIds = report.reps.map((r) => r.employeeId).filter((x): x is string => !!x);
      const emps = repIds.length
        ? await this.prisma.employee.findMany({
            where: { id: { in: repIds }, isActive: true, deletedAt: null, user: { status: 'ACTIVE' } },
            select: { id: true, user: { select: { email: true } } },
          })
        : [];
      const emailById = new Map(emps.map((e) => [e.id, e.user?.email ?? null]));

      for (const rep of report.reps) {
        if (!rep.employeeId) continue;
        if (rep.texted === 0 && rep.awaiting === 0) continue;
        const to2 = emailById.get(rep.employeeId);
        if (!to2 || !to2.includes('@')) continue;
        const awaiting = report.awaitingContacts
          .filter((a) => a.employeeId === rep.employeeId)
          .map((a) => ({ contact: a.contact, phone: a.phone, lastInboundAt: a.lastInboundAt, isOld: a.isOld }));
        const ok = await this.email.sendRepWhatsAppDailyReport({
          to: to2,
          repName: rep.name,
          date: reportDate,
          stats: {
            texted: rep.texted,
            replied: rep.replied,
            replyPct: rep.replyPct,
            newContacts: rep.newContacts,
            newReplied: rep.newReplied,
            awaiting: rep.awaiting,
          },
          awaiting,
        });
        if (ok) recipients += 1;
      }

      // 2) Admin full-team email.
      const awaitingByRep = this.groupAwaiting(report.reps, report.awaitingContacts);
      const adminOk = await this.email.sendAdminWhatsAppDailyReport({
        to: this.adminRecipients(),
        date: reportDate,
        totals: report.totals,
        reps: report.reps.map((r) => ({
          name: r.name,
          texted: r.texted,
          replied: r.replied,
          replyPct: r.replyPct,
          newContacts: r.newContacts,
          oldContacts: r.oldContacts,
          awaiting: r.awaiting,
        })),
        awaitingByRep,
      });
      if (adminOk) recipients += this.adminRecipients().length;

      // Best-effort history update; the claim row already exists, so a failure
      // here only loses the recipient count — it never causes a re-send.
      try {
        await this.prisma.whatsAppDailyReportLog.update({ where: { reportDate }, data: { recipients } });
      } catch (e) {
        this.log.warn(`Could not update recipient count for ${reportDate}: ${(e as Error).message}`);
      }
      this.log.log(
        `WhatsApp daily report sent for ${reportDate}: ${report.totals.texted} texted, ${report.totals.replied} replied, ${report.totals.awaiting} awaiting → ${recipients} emails.`,
      );
    } catch (e) {
      this.log.error(`WhatsApp daily report failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Group awaiting contacts by rep, following the reps' (awaiting-desc) order. */
  private groupAwaiting(
    reps: Array<{ employeeId: string | null; name: string }>,
    awaiting: AwaitingContact[],
  ): Array<{ repName: string; items: Array<{ contact: string | null; phone: string | null; lastInboundAt: string | null; isOld: boolean }> }> {
    const byEmp = new Map<string | null, AwaitingContact[]>();
    for (const a of awaiting) {
      const arr = byEmp.get(a.employeeId);
      if (arr) arr.push(a);
      else byEmp.set(a.employeeId, [a]);
    }
    const order: Array<{ id: string | null; name: string }> = reps.map((r) => ({ id: r.employeeId, name: r.name }));
    if (byEmp.has(null) && !order.some((o) => o.id === null)) order.push({ id: null, name: '— Unassigned' });
    return order
      .filter((o) => (byEmp.get(o.id)?.length ?? 0) > 0)
      .map((o) => ({
        repName: o.name,
        items: (byEmp.get(o.id) ?? []).map((a) => ({
          contact: a.contact,
          phone: a.phone,
          lastInboundAt: a.lastInboundAt,
          isOld: a.isOld,
        })),
      }));
  }

}
