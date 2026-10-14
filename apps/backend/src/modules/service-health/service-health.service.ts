import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { request as httpsRequest } from 'node:https';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';

/**
 * SERVICE HEALTH SENTINEL — turns a silent, day-long billing/service outage into
 * a ~2-minute alert. It detects each outage from OUR OWN data (no dependency on
 * any provider's billing API):
 *   • whatsapp_billing — a spike of Meta `131042` send-failures (billing block)
 *   • openai_quota     — a spike of AI runs failing with quota/billing errors
 *   • telenor_proxy    — the fixed-IP call proxy (smartoffice.tashfeengroup.com)
 *                        failing its health probe (the DigitalOcean droplet down)
 *   • supabase_db      — the database read-only / unreachable (billing hold)
 *
 * On an outage it persists a `SystemAlert` row (→ the rep-facing banner the web
 * app polls) and, ONCE per incident, emails finance/admins + drops an in-app
 * bell with the exact fix. On recovery it clears the row and sends an "all
 * clear". Code can't pay the bill — but it makes the outage loud and fast to fix.
 *
 * Disable with SERVICE_HEALTH_SENTINEL_ENABLED=false.
 */
@Injectable()
export class ServiceHealthSentinelService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ServiceHealthSentinelService.name);
  private static readonly INTERVAL_MS = 2 * 60 * 1000; // every 2 min
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  // Consecutive-bad-tick counters for the single-probe checks (debounce flapping).
  private consecutive: Record<string, number> = {};
  // In-memory dedup for supabase_db (its alert can't be persisted to a read-only DB).
  private dbAlerted = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  onModuleInit(): void {
    if (process.env.SERVICE_HEALTH_SENTINEL_ENABLED === 'false') {
      this.log.log('Service-health sentinel disabled (SERVICE_HEALTH_SENTINEL_ENABLED=false).');
      return;
    }
    this.bootTimer = setTimeout(() => void this.tick(), 60_000);
    this.timer = setInterval(() => void this.tick(), ServiceHealthSentinelService.INTERVAL_MS);
    this.bootTimer.unref?.();
    this.timer.unref?.();
    this.log.log('Service-health sentinel armed: every 2 min (whatsapp / openai / telenor-proxy / db).');
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.checkDatabase(); // first — if DB is the problem, this is the one path that still alerts (email)
      await Promise.allSettled([this.checkWhatsapp(), this.checkOpenAi(), this.checkTelenorProxy()]);
    } catch (e) {
      this.log.warn(`sentinel tick error: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  // ---- detectors -----------------------------------------------------------

  private async checkWhatsapp(): Promise<void> {
    const r = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*)::int n FROM whatsapp.messages
        WHERE direction='OUTBOUND' AND "errorCode" IN ('131042','131045','131026')
          AND "createdAt" > now() - interval '10 minutes'`,
    );
    const n = r[0]?.n ?? 0;
    if (n >= 5) {
      await this.raise('whatsapp_billing', 'critical',
        'WhatsApp sending is temporarily down',
        'WhatsApp messages aren’t sending right now (a billing/eligibility block on the business account). Please use calls meanwhile — sending resumes automatically once it’s fixed.',
        `${n}× Meta error 131042 in the last 10 min. FIX: Meta Business Manager → Billing & Payments → update the WhatsApp payment method / clear the overdue balance.`);
    } else {
      await this.clear('whatsapp_billing');
    }
  }

  private async checkOpenAi(): Promise<void> {
    const r = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*)::int n FROM ai.runs
        WHERE error IS NOT NULL
          AND (error ILIKE '%quota%' OR error ILIKE '%insufficient%' OR error ILIKE '%429%' OR error ILIKE '%billing%' OR error ILIKE '%exceeded%')
          AND "createdAt" > now() - interval '20 minutes'`,
    );
    const n = r[0]?.n ?? 0;
    if (n >= 3) {
      await this.raise('openai_quota', 'warning',
        'AI assistant is paused',
        'Automatic AI replies and voice-note transcription are paused (OpenAI credit/quota). Your chats, calls and everything else work normally.',
        `${n}× OpenAI quota/billing errors on ai.runs in the last 20 min. FIX: top up OpenAI credits / fix the OpenAI billing method.`);
    } else {
      await this.clear('openai_quota');
    }
  }

  private async checkTelenorProxy(): Promise<void> {
    const ok = await this.probe('smartoffice.tashfeengroup.com', '/health');
    if (!ok) {
      this.consecutive['telenor_proxy'] = (this.consecutive['telenor_proxy'] ?? 0) + 1;
      if (this.consecutive['telenor_proxy'] >= 2) {
        await this.raise('telenor_proxy', 'critical',
          'Inbound call routing is down',
          'Incoming phone calls aren’t being routed to the right rep right now (they may ring the wrong person or the default queue). Being worked on.',
          'smartoffice.tashfeengroup.com health probe failed ≥2×. FIX: the DigitalOcean proxy droplet (129.212.239.120) is down — power it on in the DO console (and check it wasn’t manually powered off).');
      }
    } else {
      this.consecutive['telenor_proxy'] = 0;
      await this.clear('telenor_proxy');
    }
  }

  /** DB check is special: a read-only/billing-held DB can't accept the SystemAlert
   *  write, so this one alerts by EMAIL only, with in-memory dedup. */
  private async checkDatabase(): Promise<void> {
    let bad: string | null = null;
    try {
      const ro = await this.prisma.$queryRawUnsafe<any[]>('SHOW transaction_read_only');
      if (ro[0]?.transaction_read_only === 'on') bad = 'database is READ-ONLY (likely a Supabase billing hold)';
    } catch (e) {
      bad = `database query failed: ${(e as Error).message.slice(0, 80)}`;
    }
    if (bad) {
      if (!this.dbAlerted) {
        this.dbAlerted = true;
        await this.emailAdmins('🔴 CRM DATABASE DEGRADED', `The CRM database is impaired: ${bad}.\n\nFIX: Supabase dashboard → Billing (pay any overdue invoice) / check project status. The CRM may be slow or unable to save data until resolved.`);
        this.log.error(`DB DEGRADED: ${bad}`);
      }
    } else if (this.dbAlerted) {
      this.dbAlerted = false;
      await this.emailAdmins('🟢 CRM database recovered', 'The CRM database is back to normal (read-write).');
    }
  }

  // ---- alert plumbing ------------------------------------------------------

  private async raise(key: string, severity: string, title: string, message: string, detail: string): Promise<void> {
    const existing = await this.prisma.systemAlert.findUnique({ where: { key } });
    const now = new Date();
    await this.prisma.systemAlert.upsert({
      where: { key },
      create: { key, active: true, severity, title, message, detail, startedAt: now, lastSeenAt: now },
      update: { active: true, severity, title, message, detail, lastSeenAt: now, resolvedAt: null, ...(existing?.active ? {} : { startedAt: now }) },
    });
    if (existing?.active) return; // already open — alert only on the transition
    this.log.error(`OUTAGE OPEN [${key}]: ${detail}`);
    await this.emailAdmins(`🔴 ${title}`, `${message}\n\n— — —\n${detail}`);
    await this.bellAdmins(key, `🔴 ${title}`, detail);
  }

  private async clear(key: string): Promise<void> {
    const existing = await this.prisma.systemAlert.findUnique({ where: { key } });
    if (!existing?.active) return;
    await this.prisma.systemAlert.update({ where: { key }, data: { active: false, resolvedAt: new Date() } });
    this.log.log(`OUTAGE CLEARED [${key}]`);
    await this.emailAdmins(`🟢 Recovered: ${existing.title}`, `${existing.title} is back to normal.`);
    await this.bellAdmins(key, `🟢 Recovered: ${existing.title}`, 'Service is back to normal.');
  }

  private async emailAdmins(subject: string, text: string): Promise<void> {
    const to = this.adminEmails();
    if (to.length === 0) return;
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')}</div>`;
    await this.email.sendMail({ to, subject: `[Tashfeen CRM] ${subject}`, html }).catch((e) => this.log.warn(`alert email failed: ${(e as Error).message}`));
  }

  private async bellAdmins(key: string, title: string, body: string): Promise<void> {
    try {
      const users = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT ua.id FROM core.user_accounts ua
           JOIN core.user_roles ur ON ur."userId"=ua.id
           JOIN core.role_permissions rp ON rp."roleId"=ur."roleId"
           JOIN core.permissions p ON p.id=rp."permissionId"
          WHERE ua.status='ACTIVE' AND p.key IN ('settings.manage','finance.view_all')`);
      for (const u of users) {
        await this.notifications.create({ userId: u.id, type: `SYSTEM_${key.toUpperCase()}`, title, body, link: '/admin' }).catch(() => undefined);
      }
    } catch (e) { this.log.warn(`bell fan-out failed: ${(e as Error).message}`); }
  }

  private adminEmails(): string[] {
    const env = (process.env.SERVICE_ALERT_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return env.length ? env : ['tashfeensohail99@gmail.com', 'tashfeensohail98@gmail.com'];
  }

  private probe(host: string, path: string): Promise<boolean> {
    return new Promise((resolve) => {
      const req = httpsRequest({ host, port: 443, path, method: 'GET', timeout: 8000, headers: { Host: host } }, (res) => {
        res.resume();
        resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  }

  /** Public read for the banner endpoint. */
  async activeAlerts() {
    return this.prisma.systemAlert.findMany({
      where: { active: true },
      select: { key: true, severity: true, title: true, message: true, startedAt: true },
      orderBy: { startedAt: 'asc' },
    });
  }
}
