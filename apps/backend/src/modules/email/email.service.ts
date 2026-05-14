import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
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
      const info = await this.transporter.sendMail({
        from:    this.from,
        to:      Array.isArray(opts.to) ? opts.to.join(', ') : opts.to,
        subject: opts.subject,
        html:    opts.html,
        replyTo: opts.replyTo,
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
