import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WhatsAppStatusState } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EmailService } from '../../email/email.service';

/**
 * Interval driver for two WhatsApp Status housekeeping jobs:
 *
 *   1. Scheduled nudge — SCHEDULED rows whose scheduledAt has passed get an
 *      email to the owning employee ("your post is due; open the app and
 *      publish it to My Status on your phone"). The row stays SCHEDULED until
 *      the employee taps Mark-as-Posted — Meta doesn't expose a Status API,
 *      so we can't auto-publish.
 *   2. Expiry sweep — POSTED rows past their 24 h expiresAt flip to EXPIRED.
 *
 * Runs every 60 s (matches the tightest scheduling granularity we allow).
 * Disable with STATUS_SWEEPER_ENABLED=false.
 */
@Injectable()
export class WhatsAppStatusSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WhatsAppStatusSweeperService.name);
  private static readonly INTERVAL_MS = 60_000;
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  onModuleInit(): void {
    if (process.env.STATUS_SWEEPER_ENABLED === 'false') {
      this.log.log('Status sweeper disabled (STATUS_SWEEPER_ENABLED=false).');
      return;
    }
    this.bootTimer = setTimeout(() => void this.tick(), 45_000);
    this.timer = setInterval(
      () => void this.tick(),
      WhatsAppStatusSweeperService.INTERVAL_MS,
    );
    this.bootTimer.unref?.();
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.expireOldPosts();
      await this.nudgeDueSchedules();
    } catch (e) {
      this.log.warn(`status sweep skipped: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async expireOldPosts(): Promise<void> {
    const res = await this.prisma.whatsAppStatus.updateMany({
      where: {
        state: WhatsAppStatusState.POSTED,
        expiresAt: { lte: new Date() },
        deletedAt: null,
      },
      data: { state: WhatsAppStatusState.EXPIRED },
    });
    if (res.count > 0) this.log.log(`expired ${res.count} posted status(es)`);
  }

  /**
   * Emails the owner once per due SCHEDULED post. We piggyback failReason as
   * an idempotency marker — set to "nudge_sent_YYYY-MM-DDTHH:MM:SS" so the
   * next tick skips the same row. The employee then taps Mark-as-Posted (or
   * un-schedules to draft), which clears the row from the SCHEDULED bucket.
   */
  private async nudgeDueSchedules(): Promise<void> {
    const due = await this.prisma.whatsAppStatus.findMany({
      where: {
        state: WhatsAppStatusState.SCHEDULED,
        scheduledAt: { lte: new Date() },
        deletedAt: null,
        OR: [{ failReason: null }, { failReason: { equals: '' } }],
      },
      take: 20,
      select: {
        id: true,
        caption: true,
        scheduledAt: true,
        employeeId: true,
      },
    });
    if (due.length === 0) return;

    for (const row of due) {
      try {
        const emp = await this.prisma.employee.findUnique({
          where: { id: row.employeeId },
          select: { firstName: true, user: { select: { email: true } } },
        });
        const to = emp?.user?.email;
        if (to) {
          const preview = (row.caption ?? '').slice(0, 80);
          await this.email.sendMail({
            to,
            subject: 'Your WhatsApp Status is due to post',
            html: buildNudgeHtml({
              firstName: emp?.firstName ?? 'there',
              caption: preview,
              scheduledAt: row.scheduledAt!,
            }),
          });
        }
        await this.prisma.whatsAppStatus.update({
          where: { id: row.id },
          data: { failReason: `nudge_sent_${new Date().toISOString()}` },
        });
      } catch (e) {
        this.log.warn(`nudge failed for status ${row.id}: ${(e as Error).message}`);
      }
    }
  }
}

function buildNudgeHtml(input: { firstName: string; caption: string; scheduledAt: Date }): string {
  const when = input.scheduledAt.toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
  return `
    <p>Hi ${escapeHtml(input.firstName)},</p>
    <p>Your scheduled WhatsApp Status post is due (${escapeHtml(when)} PKT).</p>
    ${input.caption ? `<p><em>${escapeHtml(input.caption)}${input.caption.length >= 80 ? '…' : ''}</em></p>` : ''}
    <p>Open the CRM Status tab, tap <strong>Post to WhatsApp</strong>, and publish it to your WhatsApp Status.</p>
    <p>Once you've posted it on WhatsApp, tap <strong>Mark as Posted</strong> in the CRM so the record is complete.</p>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
