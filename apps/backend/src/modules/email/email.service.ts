import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface SendMailOptions {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private readonly from: string;
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    const host     = config.get<string>('SMTP_HOST');
    const port     = parseInt(config.get<string>('SMTP_PORT') ?? '465', 10);
    const user     = config.get<string>('SMTP_USER');
    const pass     = config.get<string>('SMTP_PASS');
    const secure   = (config.get<string>('SMTP_SECURE') ?? 'true') !== 'false';
    const fromName = config.get<string>('SMTP_FROM_NAME') ?? 'Tashfeen Immigration';

    this.from    = `"${fromName}" <${user ?? ''}>`;
    this.enabled = Boolean(host && user && pass);

    if (!this.enabled) {
      this.logger.warn('SMTP not configured — email sending is disabled. Set SMTP_HOST, SMTP_USER, SMTP_PASS to enable.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,            // true = SSL on port 465 (Hostinger default)
      auth: { user, pass },
      tls: { rejectUnauthorized: true },
    });

    // Verify connection on startup (non-fatal)
    this.transporter.verify().then(() => {
      this.logger.log(`SMTP ready — connected to ${host}:${port} as ${user}`);
    }).catch((err: unknown) => {
      this.logger.error('SMTP connection failed on startup (will retry per-send)', err);
    });
  }

  async sendMail(opts: SendMailOptions): Promise<boolean> {
    if (!this.enabled || !this.transporter) {
      this.logger.warn(`Email skipped (SMTP not configured): "${opts.subject}" → ${String(opts.to)}`);
      return false;
    }
    try {
      const joinList = (v?: string | string[]) =>
        Array.isArray(v) ? v.filter(Boolean).join(', ') : v;
      const cc = joinList(opts.cc);
      const bcc = joinList(opts.bcc);
      const info = await this.transporter.sendMail({
        from:    this.from,
        to:      Array.isArray(opts.to) ? opts.to.join(', ') : opts.to,
        ...(cc ? { cc } : {}),
        ...(bcc ? { bcc } : {}),
        subject: opts.subject,
        html:    opts.html,
        replyTo: opts.replyTo,
        ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
      });
      this.logger.log(`Email sent: "${opts.subject}" → ${String(opts.to)} (${info.messageId})`);
      return true;
    } catch (err) {
      this.logger.error(`Email send failed: "${opts.subject}" → ${String(opts.to)}`, err);
      return false;
    }
  }

  // ── Convenience templates ──────────────────────────────────────────────────

  async sendLeadAssigned(opts: {
    to: string;
    consultantName: string;
    leadName: string;
    leadPhone: string;
    leadService?: string | null;
    leadCountry?: string | null;
    source?: string | null;
    notes?: string | null;
  }): Promise<boolean> {
    return this.sendMail({
      to: opts.to,
      subject: `New lead assigned: ${opts.leadName}`,
      html: buildLeadAssignedEmail(opts),
    });
  }

  /**
   * AI bot booked an appointment for the assigned sales agent on the lead's
   * behalf — fired right after the Appointment row is created so the agent
   * knows to expect it in their /sales/appointments view.
   */
  async sendNewAppointmentToAgent(opts: {
    to: string;
    consultantName: string;
    leadName: string;
    leadPhone: string;
    scheduledAt: Date;
    durationMinutes: number;
    appointmentType: string;
    modalityLabel: string; // e.g. "Phone call" / "Google Meet" / "Office visit"
    notes?: string | null;
    appointmentsUrl?: string;
  }): Promise<boolean> {
    return this.sendMail({
      to: opts.to,
      subject: `New appointment booked — ${opts.leadName} · ${formatWhen(opts.scheduledAt)}`,
      html: buildNewAppointmentToAgentEmail(opts),
    });
  }

  async sendLeadCreatedNotification(opts: {
    to: string | string[];
    leadName: string;
    leadPhone: string;
    leadService?: string | null;
    leadCountry?: string | null;
    source?: string | null;
    notes?: string | null;
  }): Promise<boolean> {
    return this.sendMail({
      to: opts.to,
      subject: `New lead received: ${opts.leadName}`,
      html: buildLeadCreatedEmail(opts),
    });
  }

  async sendWelcomeEmployee(opts: {
    to: string;
    firstName: string;
    email: string;
    tempPassword: string;
    loginUrl?: string;
  }): Promise<boolean> {
    return this.sendMail({
      to: opts.to,
      subject: 'Welcome to Tashfeen — your account is ready',
      html: buildWelcomeEmployeeEmail(opts),
    });
  }

  /**
   * Client portal welcome — sent when Processing manually creates a client and
   * provisions their portal login. Mirrors sendWelcomeEmployee but with
   * client-facing copy (track application, upload documents, message the team).
   */
  async sendWelcomeClient(opts: {
    to: string;
    firstName: string;
    email: string;
    tempPassword: string;
    loginUrl?: string;
  }): Promise<boolean> {
    return this.sendMail({
      to: opts.to,
      subject: 'Your Tashfeen client portal is ready',
      html: buildWelcomeClientEmail(opts),
    });
  }

  async sendPresenceOfflineWarning(opts: {
    to: string;
    firstName: string;
    offlineMinutes: number;
    penaltyPoints: number;
  }): Promise<boolean> {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:540px;margin:0 auto;color:#1f2937">
        <h2 style="color:#b91c1c;margin-bottom:8px">You're Offline during working hours</h2>
        <p>Hi ${opts.firstName},</p>
        <p>Our system shows you've been marked <b>Offline</b> for over
           <b>${Math.round(opts.offlineMinutes)} minutes</b> during today's working hours.</p>
        <p>While Offline you don't receive new WhatsApp leads, and per company policy
           this has reduced your SLA score by <b>${opts.penaltyPoints} point(s)</b> for
           now (it recovers as you stay available).</p>
        <p>Please switch back to <b>Online</b> in the Sales dashboard so you can receive
           and reply to client chats.</p>
        <p style="color:#6b7280;font-size:12px;margin-top:18px">
           Tashfeen Immigration Solutions · automated availability notice</p>
      </div>`;
    return this.sendMail({
      to: opts.to,
      subject: 'Action needed: you are Offline during working hours',
      html,
    });
  }

  async sendDailyPresenceReport(opts: {
    to: string;
    date: string;
    rows: Array<{ name: string; awayMinutes: number; offlineMinutes: number; penaltyApplied: number }>;
  }): Promise<boolean> {
    const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
    const flagged = opts.rows
      .filter((r) => r.awayMinutes > 0 || r.offlineMinutes > 0 || r.penaltyApplied > 0)
      .sort((a, b) => b.offlineMinutes - a.offlineMinutes || b.awayMinutes - a.awayMinutes);
    const cell = 'padding:8px;border:1px solid #e5e7eb';
    const body =
      flagged.length === 0
        ? '<p>Everyone stayed Online during working hours today.</p>'
        : `<table style="border-collapse:collapse;width:100%;font-size:13px">
             <thead><tr style="background:#f3f4f6;text-align:left">
               <th style="${cell}">Agent</th><th style="${cell}">Away</th>
               <th style="${cell}">Offline</th><th style="${cell}">SLA penalty</th>
             </tr></thead><tbody>
             ${flagged
               .map(
                 (r) => `<tr>
               <td style="${cell}">${r.name}</td>
               <td style="${cell}">${fmt(r.awayMinutes)}</td>
               <td style="${cell};color:${r.offlineMinutes >= 120 ? '#b91c1c' : '#1f2937'}">${fmt(r.offlineMinutes)}</td>
               <td style="${cell}">${r.penaltyApplied > 0 ? `−${r.penaltyApplied}` : '—'}</td>
             </tr>`,
               )
               .join('')}
             </tbody></table>`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:660px;margin:0 auto;color:#1f2937">
        <h2 style="margin-bottom:4px">Daily presence report — ${opts.date}</h2>
        <p style="color:#6b7280;margin-top:0">Manual Away / Offline time during working hours (9–6, Mon–Fri). Offline &gt; 2h costs SLA points.</p>
        ${body}
        <p style="color:#6b7280;font-size:12px;margin-top:18px">Tashfeen Immigration Solutions · automated daily report</p>
      </div>`;
    return this.sendMail({ to: opts.to, subject: `Daily presence report — ${opts.date}`, html });
  }

  // ── Daily WhatsApp activity report (8 AM PKT) ──────────────────────────────

  /** A single salesperson's private morning summary + their follow-up list. */
  async sendRepWhatsAppDailyReport(opts: {
    to: string;
    repName: string;
    date: string;
    stats: { texted: number; replied: number; replyPct: number; newContacts: number; newReplied: number; awaiting: number };
    awaiting: Array<{ contact: string | null; phone: string | null; lastInboundAt: string | null; isOld: boolean }>;
  }): Promise<boolean> {
    const s = opts.stats;
    const awaitColor = s.awaiting > 0 ? '#b91c1c' : '#15803d';
    const kpis = [
      { label: 'Messaged you', value: `${s.texted}`, color: '#0f2742' },
      { label: 'You replied', value: `${s.replied} · ${s.replyPct}%`, color: s.replyPct >= 75 ? '#15803d' : s.replyPct >= 60 ? '#b45309' : '#b91c1c' },
      { label: 'New leads', value: `${s.newReplied}/${s.newContacts}`, color: '#0f2742' },
      { label: 'Awaiting reply', value: `${s.awaiting}`, color: awaitColor },
    ];
    const list =
      opts.awaiting.length === 0
        ? `<p style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;color:#15803d;font-size:14px">🎉 You replied to everyone who messaged you that day. Great work — keep it up!</p>`
        : `<p style="font-size:13px;color:#374151;margin:18px 0 8px">These contacts messaged you and are <strong>still waiting for a reply</strong>. Returning contacts (people you'd spoken to before) are flagged — those are warm and worth prioritising.</p>
           ${EmailService.waContactTable(opts.awaiting)}`;
    const html = EmailService.waReportShell(
      'Your WhatsApp summary',
      `${EmailService.esc(opts.repName)} · ${opts.date}`,
      `${EmailService.waKpiRow(kpis)}${list}`,
    );
    return this.sendMail({ to: opts.to, subject: `Your WhatsApp summary — ${opts.date}`, html });
  }

  /** The full team report for management (leaderboard + every awaiting list). */
  async sendAdminWhatsAppDailyReport(opts: {
    to: string | string[];
    date: string;
    totals: { texted: number; replied: number; replyPct: number; newContacts: number; oldContacts: number; awaiting: number };
    reps: Array<{ name: string; texted: number; replied: number; replyPct: number; newContacts: number; oldContacts: number; awaiting: number }>;
    awaitingByRep: Array<{ repName: string; items: Array<{ contact: string | null; phone: string | null; lastInboundAt: string | null; isOld: boolean }> }>;
  }): Promise<boolean> {
    const t = opts.totals;
    const kpis = [
      { label: 'People messaged', value: `${t.texted}`, color: '#0f2742' },
      { label: 'Replied', value: `${t.replied} · ${t.replyPct}%`, color: t.replyPct >= 75 ? '#15803d' : '#b45309' },
      { label: 'New contacts', value: `${t.newContacts}`, color: '#0f2742' },
      { label: 'Awaiting reply', value: `${t.awaiting}`, color: t.awaiting > 0 ? '#b91c1c' : '#15803d' },
    ];
    const cell = 'padding:8px 10px;border-bottom:1px solid #eef2f6;font-size:13px';
    const head = 'padding:9px 10px;border-bottom:2px solid #e5e7eb;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;text-align:left';
    const pctColor = (p: number) => (p >= 75 ? '#15803d' : p >= 60 ? '#b45309' : '#b91c1c');
    const table = `
      <table style="border-collapse:collapse;width:100%;margin-top:6px">
        <thead><tr>
          <th style="${head}">Rep</th><th style="${head};text-align:right">Texted</th>
          <th style="${head};text-align:right">Replied</th><th style="${head};text-align:right">Reply%</th>
          <th style="${head};text-align:right">New</th><th style="${head};text-align:right">Old</th>
          <th style="${head};text-align:right">Awaiting</th>
        </tr></thead>
        <tbody>
          ${opts.reps
            .map(
              (r) => `<tr>
            <td style="${cell};font-weight:600;color:#0f2742">${EmailService.esc(r.name)}</td>
            <td style="${cell};text-align:right">${r.texted}</td>
            <td style="${cell};text-align:right">${r.replied}</td>
            <td style="${cell};text-align:right;font-weight:700;color:${pctColor(r.replyPct)}">${r.replyPct}%</td>
            <td style="${cell};text-align:right">${r.newContacts}</td>
            <td style="${cell};text-align:right">${r.oldContacts}</td>
            <td style="${cell};text-align:right;font-weight:700;color:${r.awaiting > 0 ? '#b91c1c' : '#9ca3af'}">${r.awaiting}</td>
          </tr>`,
            )
            .join('')}
        </tbody>
      </table>`;
    const awaitingSections = opts.awaitingByRep
      .filter((g) => g.items.length > 0)
      .map(
        (g) => `<div style="margin-top:14px">
          <div style="font-weight:700;color:#0f2742;font-size:13px;margin-bottom:4px">${EmailService.esc(g.repName)} <span style="color:#b91c1c">(${g.items.length})</span></div>
          ${EmailService.waContactTable(g.items)}
        </div>`,
      )
      .join('');
    const awaitingBlock = awaitingSections
      ? `<h3 style="margin:24px 0 4px;color:#0f2742;font-size:15px">Contacts still awaiting a reply</h3>${awaitingSections}`
      : '';
    const html = EmailService.waReportShell(
      'WhatsApp daily report',
      opts.date,
      `${EmailService.waKpiRow(kpis)}<h3 style="margin:22px 0 2px;color:#0f2742;font-size:15px">Team — sorted by awaiting</h3>${table}${awaitingBlock}`,
    );
    return this.sendMail({ to: opts.to, subject: `WhatsApp daily report — ${opts.date}`, html });
  }

  // — shared HTML builders for the WhatsApp report emails —
  private static esc(s: string | null): string {
    return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  private static pktTime(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  private static waReportShell(title: string, subtitle: string, body: string): string {
    return `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
        <div style="background:#0f2742;padding:20px 24px">
          <div style="color:#fff;font-size:18px;font-weight:700">${title}</div>
          <div style="color:#9db4cc;font-size:13px;margin-top:2px">${subtitle}</div>
        </div>
        <div style="padding:20px 24px;color:#1f2937">
          ${body}
          <p style="color:#9ca3af;font-size:11px;margin-top:24px;border-top:1px solid #eef2f6;padding-top:12px">
            Tashfeen Immigration Solutions · automated daily WhatsApp report · human replies only (the assistant bot is excluded).
          </p>
        </div>
      </div>`;
  }
  private static waKpiRow(kpis: Array<{ label: string; value: string; color: string }>): string {
    return `<table style="border-collapse:separate;border-spacing:8px 0;width:100%;table-layout:fixed"><tr>${kpis
      .map(
        (k) => `<td style="background:#f8fafc;border:1px solid #eef2f6;border-radius:10px;padding:12px;text-align:center;vertical-align:top">
          <div style="font-size:22px;font-weight:800;color:${k.color};line-height:1.1">${k.value}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:4px">${k.label}</div>
        </td>`,
      )
      .join('')}</tr></table>`;
  }
  private static waContactTable(
    items: Array<{ contact: string | null; phone: string | null; lastInboundAt: string | null; isOld: boolean }>,
  ): string {
    const cell = 'padding:7px 10px;border-bottom:1px solid #f1f5f9;font-size:13px';
    return `<table style="border-collapse:collapse;width:100%">
      <tbody>${items
        .map(
          (it) => `<tr>
        <td style="${cell};font-weight:600;color:#0f2742">${EmailService.esc(it.contact) || '(no name)'}</td>
        <td style="${cell};color:#374151;font-family:monospace">${EmailService.esc(it.phone) || '—'}</td>
        <td style="${cell};color:#6b7280;white-space:nowrap">last msg ${EmailService.pktTime(it.lastInboundAt)} PKT</td>
        <td style="${cell};text-align:right">${
          it.isOld
            ? '<span style="background:#fef3c7;color:#92400e;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600">Returning</span>'
            : '<span style="background:#e0f2fe;color:#075985;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600">New</span>'
        }</td>
      </tr>`,
        )
        .join('')}</tbody></table>`;
  }

  async sendLeadEmailVerification(opts: {
    to: string;
    leadName: string;
    verifyUrl: string;
  }): Promise<boolean> {
    return this.sendMail({
      to: opts.to,
      subject: 'Verify your email — Tashfeen Immigration',
      html: buildLeadVerificationEmail(opts),
    });
  }

  /** Forgot-password: emails the user a link to the reset page with their
   *  one-hour reset token. */
  async sendPasswordReset(opts: {
    to: string;
    name?: string | null;
    resetUrl: string;
  }): Promise<boolean> {
    return this.sendMail({
      to: opts.to,
      subject: 'Reset your password — Tashfeen Immigration',
      html: buildPasswordResetEmail(opts),
    });
  }

  async sendAppointmentConfirmation(opts: {
    to: string;
    clientName: string;
    date: string;
    time: string;
    consultantName: string;
    notes?: string | null;
  }): Promise<boolean> {
    return this.sendMail({
      to: opts.to,
      subject: `Appointment confirmed — ${opts.date} at ${opts.time}`,
      html: buildAppointmentEmail(opts),
    });
  }

  /** Finance bounced an agreement back to the Sales author with a note. */
  async sendAgreementChangesRequested(opts: {
    to: string;
    salesName: string;
    agreementNumber: string;
    leadName?: string | null;
    note: string;
  }): Promise<boolean> {
    const content = `
      <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a;">Finance requested changes</h2>
      <p style="margin:0 0 18px;font-size:14px;color:#64748b;">Hi ${escHtml(opts.salesName)}, Finance reviewed agreement <b>${escHtml(opts.agreementNumber)}</b>${opts.leadName ? ` for ${escHtml(opts.leadName)}` : ''} and asked for changes before it can be approved.</p>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:20px;">
        <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.04em;">Finance note</p>
        <p style="margin:0;font-size:13px;color:#92400e;white-space:pre-wrap;line-height:1.6;">${escHtml(opts.note)}</p>
      </div>
      <a href="https://tashfeengroup.com/sales/agreements" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">Open the agreement →</a>`;
    return this.sendMail({
      to: opts.to,
      subject: `Changes requested — agreement ${opts.agreementNumber}`,
      html: baseTemplate('Finance requested changes', content),
    });
  }

  /** Finance approved an agreement (locks the plan + creates the ledger). */
  async sendAgreementApproved(opts: {
    to: string;
    salesName: string;
    agreementNumber: string;
    leadName?: string | null;
  }): Promise<boolean> {
    const content = `
      <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a;">Agreement approved</h2>
      <p style="margin:0 0 20px;font-size:14px;color:#64748b;">Hi ${escHtml(opts.salesName)}, Finance approved agreement <b>${escHtml(opts.agreementNumber)}</b>${opts.leadName ? ` for ${escHtml(opts.leadName)}` : ''}. The payment plan is locked and the service contract + installment ledger were created. Finance now takes it forward with the client.</p>
      <a href="https://tashfeengroup.com/sales/agreements" style="display:inline-block;background:#16a34a;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">View agreement →</a>`;
    return this.sendMail({
      to: opts.to,
      subject: `Approved — agreement ${opts.agreementNumber}`,
      html: baseTemplate('Agreement approved', content),
    });
  }

  /** Sales submitted / re-submitted an agreement → alert the finance team. */
  async sendAgreementSubmittedToFinance(opts: {
    to: string | string[];
    agreementNumber: string;
    leadName?: string | null;
    salesName: string;
    resubmitted: boolean;
    note?: string | null;
  }): Promise<boolean> {
    const heading = opts.resubmitted
      ? 'Agreement re-submitted after changes'
      : 'New agreement submitted for review';
    const lead = opts.leadName ? ` for <b>${escHtml(opts.leadName)}</b>` : '';
    const content = `
      <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a;">${heading}</h2>
      <p style="margin:0 0 18px;font-size:14px;color:#64748b;">${escHtml(opts.salesName)} ${
        opts.resubmitted ? 'made the requested changes and re-submitted' : 'submitted'
      } agreement <b>${escHtml(opts.agreementNumber)}</b>${lead}. It's ${
        opts.resubmitted ? 'back in' : 'in'
      } your review queue.</p>
      ${
        opts.resubmitted && opts.note
          ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px;margin-bottom:20px;">
               <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.04em;">Your earlier note</p>
               <p style="margin:0;font-size:13px;color:#92400e;white-space:pre-wrap;line-height:1.6;">${escHtml(opts.note)}</p>
             </div>`
          : ''
      }
      <a href="https://tashfeengroup.com/finance/agreements" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">Review now →</a>`;
    return this.sendMail({
      to: opts.to,
      subject: `${opts.resubmitted ? 'Re-submitted' : 'New'} — agreement ${opts.agreementNumber} to review`,
      html: baseTemplate(heading, content),
    });
  }

  /** Send the approved agreement PDF to the client for review + signature. */
  async sendAgreementToClient(opts: {
    to: string;
    clientName: string;
    agreementNumber: string;
    pdf: Buffer;
    fileName: string;
  }): Promise<boolean> {
    const content = `
      <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a;">Your service agreement</h2>
      <p style="margin:0 0 16px;font-size:14px;color:#64748b;">Dear ${escHtml(opts.clientName)}, please find your service agreement <b>${escHtml(opts.agreementNumber)}</b> attached.</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:20px;">
        <p style="margin:0;font-size:13.5px;color:#0f172a;line-height:1.7;">
          1. Review the attached agreement.<br/>
          2. Sign it.<br/>
          3. Return the signed copy by replying to this email, or to your Tashfeen representative.
        </p>
      </div>
      <p style="font-size:13px;color:#64748b;">If you have any questions, just reply to this email or contact us at
        <a href="mailto:admin@tashfeengroup.com" style="color:#7c3aed;">admin@tashfeengroup.com</a>.</p>`;
    return this.sendMail({
      to: opts.to,
      subject: `Your service agreement — ${opts.agreementNumber}`,
      html: baseTemplate('Your service agreement', content),
      attachments: [{ filename: opts.fileName, content: opts.pdf, contentType: 'application/pdf' }],
    });
  }

  /** Send the official payment receipt PDF to the client. */
  async sendReceiptToClient(opts: {
    to: string;
    clientName: string;
    receiptNumber: string;
    amountLabel: string;
    pdf: Buffer;
    fileName: string;
  }): Promise<boolean> {
    const content = `
      <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a;">Payment received — thank you</h2>
      <p style="margin:0 0 16px;font-size:14px;color:#64748b;">Dear ${escHtml(opts.clientName)}, we confirm receipt of your payment of <b>${escHtml(opts.amountLabel)}</b>. Your official receipt <b>${escHtml(opts.receiptNumber)}</b> is attached.</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:20px;">
        <p style="margin:0;font-size:13.5px;color:#0f172a;line-height:1.7;">Please keep this receipt for your records — it shows the amount received and any balance remaining on your file.</p>
      </div>
      <p style="font-size:13px;color:#64748b;">Any questions? Just reply to this email or contact your Tashfeen representative.</p>`;
    return this.sendMail({
      to: opts.to,
      subject: `Payment receipt — ${opts.receiptNumber}`,
      html: baseTemplate('Payment receipt', content),
      attachments: [{ filename: opts.fileName, content: opts.pdf, contentType: 'application/pdf' }],
    });
  }

  /**
   * A free-form message about a client's processing case. Used by:
   *   - the Processing "Send message" panel when the officer ticks the Email
   *     channel, and
   *   - the client-nudge cron as a fallback when WhatsApp can't deliver (24h
   *     window closed / no conversation yet).
   * `bodyText` is plain text and may contain newlines and bullet characters
   * (the same body we send over WhatsApp); we escape it and turn line breaks
   * into <br/> so it reads cleanly as HTML. Reply-to is admin@ so client
   * replies land in the shared mailbox.
   */
  async sendCaseMessageToClient(opts: {
    to: string;
    cc?: string[];
    bcc?: string[];
    clientName: string;
    subject: string;
    bodyText: string;
    /** Sender's saved signature (plain text — rendered with line breaks). */
    signatureText?: string;
    attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
  }): Promise<boolean> {
    const safeBody = escHtml(opts.bodyText).replace(/\n/g, '<br/>');
    const sig = opts.signatureText?.trim();
    const signatureBlock = sig
      ? `<div style="margin-top:18px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:13px;color:#475569;line-height:1.6;">${escHtml(sig).replace(/\n/g, '<br/>')}</div>`
      : '';
    const content = `
      <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a;">${escHtml(opts.subject)}</h2>
      <p style="margin:0 0 18px;font-size:14px;color:#64748b;">Dear ${escHtml(opts.clientName)},</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:18px;margin-bottom:20px;">
        <p style="margin:0;font-size:14px;color:#0f172a;line-height:1.7;">${safeBody}</p>
      </div>
      ${signatureBlock}
      <p style="font-size:13px;color:#64748b;">You can upload documents and track your application anytime in your client portal. If you have any questions, just reply to this email or contact us at <a href="mailto:admin@tashfeengroup.com" style="color:#7c3aed;">admin@tashfeengroup.com</a>.</p>`;
    return this.sendMail({
      to: opts.to,
      ...(opts.cc?.length ? { cc: opts.cc } : {}),
      ...(opts.bcc?.length ? { bcc: opts.bcc } : {}),
      subject: opts.subject,
      html: baseTemplate(opts.subject, content),
      replyTo: 'admin@tashfeengroup.com',
      ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
    });
  }
}

// ── Email HTML templates ───────────────────────────────────────────────────────

function baseTemplate(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:Inter,Segoe UI,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:#1a1a2e;border-radius:12px 12px 0 0;padding:28px 32px;">
            <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">
              Tashfeen <span style="color:#7c3aed;">Immigration</span>
            </h1>
            <p style="margin:4px 0 0;font-size:12px;color:#94a3b8;letter-spacing:0.05em;text-transform:uppercase;">
              Tashfeen Group · tashfeengroup.com
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#ffffff;padding:32px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
            ${content}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">
              This email was sent by Tashfeen Immigration Solutions platform.<br/>
              &copy; ${new Date().getFullYear()} Tashfeen Group. All rights reserved.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escHtml(str: string | null | undefined): string {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function infoRow(label: string, value: string | null | undefined): string {
  if (!value) return '';
  return `<tr>
    <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;width:140px;font-weight:600;">${escHtml(label)}</td>
    <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;">${escHtml(value)}</td>
  </tr>`;
}

function buildLeadAssignedEmail(opts: {
  consultantName: string;
  leadName: string;
  leadPhone: string;
  leadService?: string | null;
  leadCountry?: string | null;
  source?: string | null;
  notes?: string | null;
}): string {
  const content = `
    <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a;">New lead assigned to you</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;">Hi ${escHtml(opts.consultantName)}, a new lead has been assigned to you. Please follow up promptly.</p>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow('Lead name', opts.leadName)}
        ${infoRow('Phone', opts.leadPhone)}
        ${infoRow('Service', opts.leadService)}
        ${infoRow('Target country', opts.leadCountry)}
        ${infoRow('Source', opts.source)}
        ${opts.notes ? infoRow('Notes', opts.notes) : ''}
      </table>
    </div>

    <a href="https://tashfeengroup.com/sales" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">
      Open in CRM →
    </a>
  `;
  return baseTemplate(`Lead assigned: ${opts.leadName}`, content);
}

/**
 * AI booked an appointment on the agent's behalf. Lives in /sales/appointments
 * already; this just nudges the agent so they don't miss it.
 */
function buildNewAppointmentToAgentEmail(opts: {
  consultantName: string;
  leadName: string;
  leadPhone: string;
  scheduledAt: Date;
  durationMinutes: number;
  appointmentType: string;
  modalityLabel: string;
  notes?: string | null;
  appointmentsUrl?: string;
}): string {
  const url = opts.appointmentsUrl ?? 'https://tashfeengroup.com/sales/appointments';
  const content = `
    <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a;">📅 New appointment auto-booked for you</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;">
      Hi ${escHtml(opts.consultantName)}, our WhatsApp AI assistant just confirmed a consultation booking with one of your leads. It's already on your calendar.
    </p>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow('Client', opts.leadName)}
        ${infoRow('Phone', opts.leadPhone)}
        ${infoRow('When', formatWhen(opts.scheduledAt))}
        ${infoRow('Duration', `${opts.durationMinutes} minutes`)}
        ${infoRow('Format', opts.modalityLabel)}
        ${opts.notes ? infoRow('AI captured', opts.notes) : ''}
      </table>
    </div>

    <p style="margin:0 0 24px;font-size:13.5px;color:#64748b;">
      The time was inferred from what the client said on WhatsApp ("Monday morning" / "tomorrow 3pm" / etc.). Please confirm with the client and adjust if needed.
    </p>

    <a href="${url}" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">
      Open my appointments →
    </a>
  `;
  return baseTemplate(`New appointment: ${opts.leadName}`, content);
}

/** Friendly date+time string: "Monday, 02 Jun 2026 · 10:00 AM PKT". */
function formatWhen(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d) + ' PKT';
}

function buildLeadCreatedEmail(opts: {
  leadName: string;
  leadPhone: string;
  leadService?: string | null;
  leadCountry?: string | null;
  source?: string | null;
  notes?: string | null;
}): string {
  const content = `
    <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a;">New lead received</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;">A new lead has been added to the system and is pending assignment.</p>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow('Lead name', opts.leadName)}
        ${infoRow('Phone', opts.leadPhone)}
        ${infoRow('Service', opts.leadService)}
        ${infoRow('Target country', opts.leadCountry)}
        ${infoRow('Source', opts.source)}
        ${opts.notes ? infoRow('Notes', opts.notes) : ''}
      </table>
    </div>

    <a href="https://tashfeengroup.com/admin/leads" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">
      View lead →
    </a>
  `;
  return baseTemplate(`New lead: ${opts.leadName}`, content);
}

function buildWelcomeEmployeeEmail(opts: {
  firstName: string;
  email: string;
  tempPassword: string;
  loginUrl?: string;
}): string {
  const url = opts.loginUrl ?? 'https://tashfeengroup.com/login';
  const content = `
    <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a;">Welcome to Tashfeen, ${escHtml(opts.firstName)}!</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;">Your employee account has been created. Use the credentials below to sign in for the first time.</p>

    <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:20px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow('Login URL', url)}
        ${infoRow('Email (username)', opts.email)}
        ${infoRow('Temporary password', opts.tempPassword)}
      </table>
      <p style="margin:16px 0 0;font-size:12px;color:#7c3aed;font-weight:600;">
        Please change your password after your first login.
      </p>
    </div>

    <a href="${escHtml(url)}" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">
      Sign in now
    </a>
  `;
  return baseTemplate('Welcome to Tashfeen', content);
}

function buildWelcomeClientEmail(opts: {
  firstName: string;
  email: string;
  tempPassword: string;
  loginUrl?: string;
}): string {
  const url = opts.loginUrl ?? 'https://tashfeengroup.com/login';
  const content = `
    <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a;">Welcome to Tashfeen, ${escHtml(opts.firstName)}!</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;">Your secure client portal is ready. Sign in to track your application, upload documents, and message your case team — all in one place.</p>

    <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:20px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow('Portal URL', url)}
        ${infoRow('Email (username)', opts.email)}
        ${infoRow('Temporary password', opts.tempPassword)}
      </table>
      <p style="margin:16px 0 0;font-size:12px;color:#7c3aed;font-weight:600;">
        For your security, you'll be asked to set a new password the first time you sign in.
      </p>
    </div>

    <a href="${escHtml(url)}" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">
      Open your portal
    </a>

    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">If you didn't expect this email, please contact us at <a href="mailto:admin@tashfeengroup.com" style="color:#7c3aed;">admin@tashfeengroup.com</a>.</p>
  `;
  return baseTemplate('Your Tashfeen client portal', content);
}

function buildAppointmentEmail(opts: {
  clientName: string;
  date: string;
  time: string;
  consultantName: string;
  notes?: string | null;
}): string {
  const content = `
    <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a;">Appointment confirmed</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;">Dear ${escHtml(opts.clientName)}, your appointment has been confirmed.</p>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow('Date', opts.date)}
        ${infoRow('Time', opts.time)}
        ${infoRow('Consultant', opts.consultantName)}
        ${opts.notes ? infoRow('Notes', opts.notes) : ''}
      </table>
    </div>

    <p style="font-size:13px;color:#64748b;">If you need to reschedule, please contact us at <a href="mailto:admin@tashfeengroup.com" style="color:#7c3aed;">admin@tashfeengroup.com</a></p>
  `;
  return baseTemplate('Appointment confirmed', content);
}

function buildLeadVerificationEmail(opts: {
  leadName: string;
  verifyUrl: string;
}): string {
  const content = `
    <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a;">Verify your email address</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;">Hi ${escHtml(opts.leadName)}, please click the button below to confirm your email address for your Tashfeen Immigration enquiry.</p>

    <div style="text-align:center;margin:32px 0;">
      <a href="${escHtml(opts.verifyUrl)}"
         style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:0.01em;">
        Verify email address
      </a>
    </div>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:16px;">
      <p style="margin:0;font-size:12px;color:#64748b;line-height:1.6;">
        If the button above doesn't work, copy and paste this link into your browser:<br/>
        <a href="${escHtml(opts.verifyUrl)}" style="color:#7c3aed;word-break:break-all;">${escHtml(opts.verifyUrl)}</a>
      </p>
    </div>

    <p style="font-size:12px;color:#94a3b8;">This link expires in 48 hours. If you did not request this, you can safely ignore this email.</p>
  `;
  return baseTemplate('Verify your email — Tashfeen', content);
}

function buildPasswordResetEmail(opts: {
  name?: string | null;
  resetUrl: string;
}): string {
  const who = opts.name ? escHtml(opts.name) : 'there';
  const content = `
    <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a;">Reset your password</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;">Hi ${who}, we received a request to reset your Tashfeen account password. Click the button below to choose a new one.</p>

    <div style="text-align:center;margin:32px 0;">
      <a href="${escHtml(opts.resetUrl)}"
         style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:0.01em;">
        Reset password
      </a>
    </div>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:16px;">
      <p style="margin:0;font-size:12px;color:#64748b;line-height:1.6;">
        If the button above doesn't work, copy and paste this link into your browser:<br/>
        <a href="${escHtml(opts.resetUrl)}" style="color:#7c3aed;word-break:break-all;">${escHtml(opts.resetUrl)}</a>
      </p>
    </div>

    <p style="font-size:12px;color:#94a3b8;">This link expires in 1 hour. If you did not request this, you can safely ignore this email — your password will not change.</p>
  `;
  return baseTemplate('Reset your password — Tashfeen', content);
}
