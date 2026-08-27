import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { UsersService } from '../users/users.service';
import { MailProvisioningService } from './mail-provisioning.service';
import { EmailService } from '../email/email.service';
import { OnboardEmployeeDto, OffboardEmployeeDto } from './hr.dto';
import { AuditAction, Prisma } from '@prisma/client';

// Fixed recipients that always receive a copy of any credentials HR sends (a
// records/handover trail). Overridable via env without a code change.
const CREDENTIAL_CC = (process.env.HR_CREDENTIAL_CC ??
  'iffat@tashfeengroup.com,contact@summitautomates.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

@Injectable()
export class HrService {
  private readonly log = new Logger(HrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly users: UsersService,
    private readonly mail: MailProvisioningService,
    private readonly email: EmailService,
  ) {}

  /** Is the MXRoute integration wired up? Drives the UI's "generate email" button. */
  mailConfigured(): boolean {
    return this.mail.isConfigured();
  }

  /** Preview the business email that WOULD be generated — no mailbox is created. */
  async suggestEmail(firstName: string): Promise<{ email: string; localPart: string }> {
    const localPart = await this.mail.allocateLocalPart(firstName);
    return { localPart, email: `${localPart}@${this.mail.domain}` };
  }

  /**
   * Next employee code in the TIS-#### sequence. Reads the current max numeric
   * suffix and increments; starts at TIS-0001. Not transaction-locked — a rare
   * concurrent onboard could collide on the unique code, which surfaces as a
   * clean error the HR user simply retries.
   */
  private async nextEmployeeCode(): Promise<string> {
    const rows = await this.prisma.employee.findMany({
      where: { employeeCode: { startsWith: 'TIS-' } },
      select: { employeeCode: true },
    });
    let max = 0;
    for (const r of rows) {
      const n = parseInt((r.employeeCode ?? '').replace('TIS-', ''), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return `TIS-${String(max + 1).padStart(4, '0')}`;
  }

  /** Strong password used for BOTH the mailbox and the CRM login. */
  private generatePassword(): string {
    // Avoid ambiguous chars (0/O, 1/l/I). Guarantee upper+lower+digit+symbol.
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnpqrstuvwxyz';
    const digit = '23456789';
    const sym = '!@#$%&*?';
    const all = upper + lower + digit + sym;
    const pick = (s: string) => s[randomInt(s.length)];
    let pw = pick(upper) + pick(lower) + pick(digit) + pick(sym);
    for (let i = 0; i < 10; i++) pw += pick(all);
    // Uniform Fisher–Yates shuffle (CSPRNG) so the guaranteed classes aren't
    // always in the first 4 slots — a `sort()` with a random comparator does
    // NOT produce a uniform permutation.
    const a = pw.split('');
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.join('');
  }

  /**
   * Create login account + employee profile (+ optional business mailbox) in
   * one call. Returns the credentials ONCE so HR can hand them to the new hire.
   */
  async onboard(dto: OnboardEmployeeDto, actorUserId: string) {
    // HR may set a password explicitly; otherwise generate a strong one.
    const password = dto.password?.trim() || this.generatePassword();

    // 0) Validate FK references BEFORE any side effect. A stale/deleted dropdown
    //    id passes @IsUUID() but would only fail at employee.create — i.e. AFTER
    //    the mailbox + login account are already created, orphaning both. Fail
    //    here so nothing gets created.
    await this.assertRefsExist(dto);

    // 1) Resolve the email — generate a mailbox, or use a supplied address.
    let email: string;
    let mailboxCreated = false;
    if (dto.generateBusinessEmail) {
      const localPart = await this.mail.allocateLocalPart(dto.firstName);
      email = await this.mail.createMailbox(localPart, password);
      mailboxCreated = true;
    } else {
      if (!dto.email) {
        throw new BadRequestException('Provide an email, or enable "generate business email".');
      }
      email = dto.email.toLowerCase();
    }

    const rollbackMailbox = async () => {
      if (!mailboxCreated) return;
      const localPart = email.split('@')[0];
      await this.mail.deleteMailbox(localPart).catch((err) =>
        this.log.error(`rollback deleteMailbox ${localPart} failed: ${(err as Error).message}`),
      );
    };

    // 2) Create the login account (hashes password, attaches roles, audits).
    //    If this fails after a mailbox was created, roll the mailbox back so we
    //    don't leave an orphaned inbox.
    let user: { id: string };
    try {
      user = await this.users.create(
        { email, phone: dto.phone, password, roleNames: dto.roleNames },
        actorUserId,
      );
    } catch (e) {
      await rollbackMailbox();
      throw e;
    }

    // 3) Create the employee profile. If this fails, COMPENSATE: delete the
    //    just-created login account (a fresh account's only child rows are its
    //    userRoles, which cascade) AND the mailbox — otherwise both are orphaned
    //    and the unique email blocks HR from ever retrying this person.
    let emp: { id: string; employeeCode: string | null; firstName: string; lastName: string };
    try {
      emp = await this.createEmployeeProfile(user.id, dto);
    } catch (e) {
      await this.prisma.userAccount.delete({ where: { id: user.id } }).catch((err) =>
        this.log.error(`rollback delete user ${user.id} failed: ${(err as Error).message}`),
      );
      await rollbackMailbox();
      throw this.toCleanError(e);
    }

    await this.audit.log({
      actorUserId,
      action: AuditAction.USER_CREATED,
      entityType: 'Employee',
      entityId: emp.id,
      newValues: { employeeCode: emp.employeeCode, email, mailboxCreated, name: `${dto.firstName} ${dto.lastName}` },
    });

    // Credentials are returned ONCE — never stored in plaintext.
    return {
      employeeId: emp.id,
      employeeCode: emp.employeeCode,
      name: `${emp.firstName} ${emp.lastName}`,
      email,
      password,
      mailboxCreated,
    };
  }

  /** Verify any provided department/branch/designation ids actually exist, so a
   *  stale dropdown id fails cleanly (400) before any mailbox/account is made. */
  private async assertRefsExist(dto: OnboardEmployeeDto): Promise<void> {
    if (dto.departmentId && (await this.prisma.department.count({ where: { id: dto.departmentId } })) === 0) {
      throw new BadRequestException('Selected department no longer exists — refresh and try again.');
    }
    if (dto.branchId && (await this.prisma.branch.count({ where: { id: dto.branchId } })) === 0) {
      throw new BadRequestException('Selected branch no longer exists — refresh and try again.');
    }
    if (dto.designationId && (await this.prisma.designation.count({ where: { id: dto.designationId } })) === 0) {
      throw new BadRequestException('Selected designation no longer exists — refresh and try again.');
    }
  }

  /** Create the employee profile, retrying on a concurrent employeeCode
   *  collision (the TIS-#### sequence is deliberately not row-locked). */
  private async createEmployeeProfile(userId: string, dto: OnboardEmployeeDto) {
    for (let attempt = 0; ; attempt++) {
      const employeeCode = await this.nextEmployeeCode();
      try {
        return await this.prisma.employee.create({
          data: {
            userId,
            firstName: dto.firstName,
            lastName: dto.lastName,
            employeeCode,
            departmentId: dto.departmentId,
            branchId: dto.branchId,
            designationId: dto.designationId,
            gender: dto.gender,
            dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
            nationalId: dto.nationalId,
            passportNumber: dto.passportNumber,
            nationality: dto.nationality,
            joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : undefined,
            whatsappInboxMember: dto.whatsappInboxMember ?? false,
            pbxExtension: dto.pbxExtension,
          },
          select: { id: true, employeeCode: true, firstName: true, lastName: true },
        });
      } catch (e) {
        const target =
          e instanceof Prisma.PrismaClientKnownRequestError ? e.meta?.target : undefined;
        const targetStr = Array.isArray(target) ? target.join(',') : String(target ?? '');
        const isCodeCollision =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          /employeecode/i.test(targetStr);
        if (isCodeCollision && attempt < 4) continue; // recompute the next code and retry
        throw e;
      }
    }
  }

  /** Map raw Prisma constraint errors to a clean 400 instead of a leaked 500. */
  private toCleanError(e: unknown): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2003') return new BadRequestException('A selected department, branch, or designation is invalid.');
      if (e.code === 'P2002') return new BadRequestException('That employee already exists (duplicate code or email).');
    }
    return e;
  }

  /** Disable the CRM login (+ optionally delete the mailbox). */
  async offboard(dto: OffboardEmployeeDto, actorUserId: string) {
    const emp = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { id: true, userId: true, firstName: true, lastName: true, user: { select: { email: true } } },
    });
    if (!emp) throw new NotFoundException('Employee not found');

    await this.users.deactivate(emp.userId, actorUserId);

    let mailboxDeleted = false;
    const email = emp.user?.email ?? '';
    if (dto.deleteMailbox && email.endsWith(`@${this.mail.domain}`) && this.mail.isConfigured()) {
      const localPart = email.split('@')[0];
      await this.mail.deleteMailbox(localPart);
      mailboxDeleted = true;
    }

    await this.audit.log({
      actorUserId,
      action: AuditAction.USER_DEACTIVATED,
      entityType: 'Employee',
      entityId: emp.id,
      newValues: { offboarded: true, mailboxDeleted, name: `${emp.firstName} ${emp.lastName}` },
    });

    return { employeeId: emp.id, deactivated: true, mailboxDeleted };
  }

  /**
   * Business-email reconciliation: cross-references every active employee against
   * the live MXRoute mailbox list and buckets them —
   *   linked   : their CRM login IS a @domain address whose mailbox exists
   *   unlinked : a name-matching mailbox EXISTS but they log in with another
   *              address (the "has an email but never activated it" case)
   *   missing  : no business mailbox at all
   */
  async emailAccounts() {
    const domain = this.mail.domain;
    const configured = this.mail.isConfigured();
    const boxes = configured ? new Set(await this.mail.listLocalParts()) : new Set<string>();

    const emps = await this.prisma.employee.findMany({
      where: { isActive: true, deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true,
        branch: { select: { name: true } },
        user: { select: { email: true } },
      },
      orderBy: [{ branch: { name: 'asc' } }, { firstName: 'asc' }],
    });

    const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const rows = emps.map((e) => {
      const email = (e.user?.email ?? '').toLowerCase();
      const loginLocal = email.split('@')[0] ?? '';
      const isBiz = email.endsWith(`@${domain}`);
      const candidates = [loginLocal, norm(e.firstName), `${norm(e.firstName)}.${norm(e.lastName)}`].filter(Boolean);
      const matched = candidates.find((c) => boxes.has(c));
      let status: 'linked' | 'unlinked' | 'missing';
      let mailbox: string | null = null;
      if (isBiz && boxes.has(loginLocal)) { status = 'linked'; mailbox = email; }
      else if (matched) { status = 'unlinked'; mailbox = `${matched}@${domain}`; }
      else { status = 'missing'; mailbox = null; }
      // Suggested local-part for a "missing" employee (clash-checked locally).
      let suggestion: string | null = null;
      if (status === 'missing') {
        const base = norm(e.firstName) || norm(e.lastName);
        let s = base;
        for (let i = 2; base && boxes.has(s); i++) s = `${base}${i}`;
        suggestion = base ? `${s}@${domain}` : null;
      }
      return {
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        branch: e.branch?.name ?? null,
        loginEmail: e.user?.email ?? null,
        status,
        mailbox,
        suggestion,
      };
    });

    return {
      domain,
      configured,
      counts: {
        linked: rows.filter((r) => r.status === 'linked').length,
        unlinked: rows.filter((r) => r.status === 'unlinked').length,
        missing: rows.filter((r) => r.status === 'missing').length,
      },
      rows,
    };
  }

  /**
   * Give an employee a working @domain mailbox and (optionally) make it their
   * CRM login. Creates the mailbox if absent, or resets the password if it
   * already exists (activating a dormant one). Returns the credentials ONCE.
   */
  async provisionMailbox(
    dto: { employeeId?: string; localPart?: string; setAsLogin?: boolean; resetPassword?: boolean },
    actorUserId: string,
  ) {
    const domain = this.mail.domain;
    const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9.]/g, '');

    let emp: { id: string; firstName: string; lastName: string; userId: string; user: { email: string } | null } | null = null;
    if (dto.employeeId) {
      emp = await this.prisma.employee.findUnique({
        where: { id: dto.employeeId },
        select: { id: true, firstName: true, lastName: true, userId: true, user: { select: { email: true } } },
      });
      if (!emp) throw new NotFoundException('Employee not found');
    }
    if (!emp && !dto.localPart) {
      throw new BadRequestException('Provide an employee or a mailbox name.');
    }

    const boxes = new Set(await this.mail.listLocalParts());

    // Resolve which local-part we're acting on.
    let localPart: string;
    if (dto.localPart) {
      localPart = norm(dto.localPart);
      if (!localPart) throw new BadRequestException('That mailbox name has no usable letters.');
    } else {
      const loginLocal = (emp!.user?.email ?? '').toLowerCase().split('@')[0] ?? '';
      localPart =
        [loginLocal, norm(emp!.firstName), `${norm(emp!.firstName)}.${norm(emp!.lastName)}`]
          .filter(Boolean)
          .find((c) => boxes.has(c)) ?? (await this.mail.allocateLocalPart(emp!.firstName));
    }
    const email = `${localPart}@${domain}`;
    const exists = boxes.has(localPart);
    const wantReset = dto.resetPassword ?? true;

    // Decide the mailbox action.
    //  - exists + don't reset  → LINK ONLY (mailbox untouched, no new password)
    //  - exists + reset        → reset its password
    //  - doesn't exist         → create it
    let action: 'created' | 'reset' | 'linked';
    let password: string | null = null;
    if (exists && !wantReset) {
      action = 'linked';
    } else if (exists) {
      password = this.generatePassword();
      await this.mail.resetPassword(localPart, password);
      action = 'reset';
    } else {
      password = this.generatePassword();
      await this.mail.createMailbox(localPart, password);
      action = 'created';
    }

    // Optionally point the employee's CRM login at this business email.
    let loginUpdated = false;
    if (dto.setAsLogin && emp && (emp.user?.email ?? '').toLowerCase() !== email) {
      const clash = await this.prisma.userAccount.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, id: { not: emp.userId } },
        select: { id: true },
      });
      if (clash) throw new BadRequestException(`${email} is already another account's login.`);
      await this.prisma.userAccount.update({ where: { id: emp.userId }, data: { email } });
      loginUpdated = true;
    }

    await this.audit.log({
      actorUserId,
      action: AuditAction.USER_UPDATED,
      entityType: emp ? 'Employee' : 'Mailbox',
      entityId: emp?.id ?? email,
      newValues: { mailbox: email, mailboxAction: action, loginUpdated },
    });

    return { employeeId: emp?.id ?? null, email, password, action, loginUpdated };
  }

  /**
   * Email a credential pack (CRM login + business email + how-to-sign-in) to a
   * recipient, always CC'ing the fixed records addresses. HR triggers this from
   * the credential card after creating/resetting an account.
   */
  async sendCredentials(
    dto: {
      to?: string;
      name: string;
      crmEmail?: string;
      crmPassword?: string;
      mailboxEmail?: string;
      mailboxPassword?: string;
    },
    actorUserId: string,
  ) {
    const to = dto.to?.trim();
    if (!to && CREDENTIAL_CC.length === 0) {
      throw new BadRequestException('No recipient and no records addresses configured.');
    }

    // The full pack (with plaintext passwords) goes ONLY to the new hire. The
    // fixed records addresses get a passwords-REDACTED "credentials issued"
    // notice — secrets must not sit in a shared/external records inbox. If HR
    // gave no hire address, this is an explicit records-only issuance, so the
    // pack goes to the records addresses as the sole recipient.
    let result: { ok: boolean; error?: string; notConfigured?: boolean };
    let recipients: string[];
    if (to) {
      recipients = [to];
      result = await this.email.sendMailResult({
        to,
        subject: `Your Tashfeen access — ${dto.name}`,
        html: this.credentialsHtml(dto),
      });
      // Best-effort records notice (no secrets) — never fail the op on this.
      if (result.ok && CREDENTIAL_CC.length) {
        await this.email
          .sendMail({
            to: CREDENTIAL_CC,
            subject: `Credentials issued — ${dto.name}`,
            html: this.credentialsIssuedNotice(dto),
          })
          .catch(() => undefined);
      }
    } else {
      recipients = [...CREDENTIAL_CC];
      result = await this.email.sendMailResult({
        to: CREDENTIAL_CC,
        subject: `Your Tashfeen access — ${dto.name}`,
        html: this.credentialsHtml(dto),
      });
    }

    await this.audit.log({
      actorUserId,
      action: AuditAction.USER_UPDATED,
      entityType: 'Employee',
      entityId: dto.crmEmail ?? dto.mailboxEmail ?? dto.name,
      newValues: {
        credentialsEmailedTo: recipients,
        recordsNotified: Boolean(to && CREDENTIAL_CC.length),
        sent: result.ok,
      },
    });

    if (!result.ok) {
      if (result.notConfigured) {
        throw new ServiceUnavailableException(
          'Email is not configured on the server (SMTP_HOST/USER/PASS). Ask an admin to set it up.',
        );
      }
      // Surface the REAL provider reason (bad recipient, 554/535, connection…)
      // instead of the old catch-all "SMTP not configured or send failed".
      throw new BadRequestException(`Email could not be sent: ${result.error ?? 'the mail server rejected the message.'}`);
    }
    return { sent: result.ok, recipients };
  }

  /** Records-copy notice: confirms credentials were issued, WITHOUT any password. */
  private credentialsIssuedNotice(dto: { name: string; crmEmail?: string; mailboxEmail?: string }): string {
    const line = (k: string, v?: string) =>
      v
        ? `<tr><td style="padding:6px 14px;color:#5b6472;font-size:13px;width:140px">${k}</td>` +
          `<td style="padding:6px 14px;font-size:14px;color:#101828">${v}</td></tr>`
        : '';
    return (
      `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#101828">` +
      `<p style="font-size:15px">Credentials were issued for <strong>${dto.name}</strong>.</p>` +
      `<table style="width:100%;border-collapse:collapse;background:#f6f8fb;border:1px solid #e3e8f0;border-radius:10px;margin:8px 0 16px">` +
      line('CRM login', dto.crmEmail) +
      line('Business email', dto.mailboxEmail) +
      `</table>` +
      `<p style="font-size:13px;color:#5b6472">Passwords were sent directly to the recipient and are intentionally omitted here. This copy is for your records.</p>` +
      `</div>`
    );
  }

  private credentialsHtml(dto: {
    name: string; crmEmail?: string; crmPassword?: string; mailboxEmail?: string; mailboxPassword?: string;
  }): string {
    const box = (rows: string) =>
      `<table style="width:100%;border-collapse:collapse;background:#f6f8fb;border:1px solid #e3e8f0;border-radius:10px;margin:8px 0 14px">${rows}</table>`;
    const row = (k: string, v: string) =>
      `<tr><td style="padding:8px 14px;color:#5b6472;font-size:13px;width:150px;vertical-align:top">${k}</td>` +
      `<td style="padding:8px 14px;font-family:monospace;font-size:14px;color:#101828;word-break:break-all">${v}</td></tr>`;
    const heading = (n: string, t: string) =>
      `<h3 style="margin:24px 0 6px;font-size:16px;color:#101828">` +
      `<span style="display:inline-block;min-width:22px;height:22px;line-height:22px;text-align:center;background:#1d4ed8;color:#ffffff;border-radius:11px;font-size:12px;margin-right:8px">${n}</span>${t}</h3>`;
    const sub = (t: string) => `<p style="margin:12px 0 4px;font-weight:600;font-size:14px;color:#101828">${t}</p>`;
    const p = (t: string) => `<p style="margin:0 0 8px;color:#3a4250;font-size:14px;line-height:1.5">${t}</p>`;
    const link = (href: string, label?: string) =>
      `<a href="${href}" style="color:#1d4ed8;text-decoration:none">${label ?? href}</a>`;

    // Section 1 — CRM: how to sign in on both web and the Android app.
    const crm = dto.crmEmail
      ? heading('1', 'Your CRM account') +
        box(
          row('Email', dto.crmEmail) +
          (dto.crmPassword ? row('Password', dto.crmPassword) : '') +
          row('Note', 'You will be asked to set your own password on first sign-in.'),
        ) +
        sub('On a computer (web)') +
        p(`Go to ${link('https://tashfeengroup.com/login')} and sign in with the email and password above.`) +
        sub('On your phone (Android app)') +
        p(
          `Open ${link('https://tashfeengroup.com/downloads')} on your phone, tap <b>Download the app</b>, ` +
          `install it, then open <b>Tashfeen CRM</b> and sign in with the <b>same</b> email and password.`,
        )
      : '';

    // Section 2 — business email: webmail in a browser + IMAP/SMTP for phone/Outlook.
    const mailbox = dto.mailboxEmail
      ? heading(dto.crmEmail ? '2' : '1', 'Your business email') +
        box(
          row('Email address', dto.mailboxEmail) +
          (dto.mailboxPassword ? row('Password', dto.mailboxPassword) : ''),
        ) +
        sub('In a web browser (webmail)') +
        p(
          `Go to ${link('https://tuesday.mxrouting.net/webmail')} — the username is your full email address above, ` +
          `and the password is the email password above.`,
        ) +
        sub('On your phone or in Outlook / Gmail (IMAP)') +
        p('Add a new mail account, choose "Other" / "IMAP", and use these settings:') +
        box(
          row('Incoming (IMAP)', 'tuesday.mxrouting.net &middot; port 993 &middot; SSL/TLS') +
          row('Outgoing (SMTP)', 'tuesday.mxrouting.net &middot; port 465 &middot; SSL/TLS') +
          row('Username', dto.mailboxEmail) +
          row('Password', 'the email password above'),
        ) +
        p('Tip: change your email password after your first sign-in (in webmail, go to Settings then Password).')
      : '';

    return (
      `<div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#101828">` +
      `<p style="font-size:16px;font-weight:600;margin:0 0 6px">Hi ${dto.name},</p>` +
      `<p style="font-size:14px;color:#3a4250;line-height:1.5;margin:0 0 4px">Welcome to Tashfeen. Below is everything you need to sign in to the CRM and your company email — on both computer and phone. Please keep these details private.</p>` +
      crm +
      mailbox +
      `<p style="font-size:12px;color:#98a2b3;margin-top:24px;border-top:1px solid #eef1f5;padding-top:12px">Sent by Tashfeen HR. If you weren't expecting this, contact your administrator.</p>` +
      `</div>`
    );
  }

  /** HR directory — active + inactive employees with the fields HR cares about. */
  async directory(search?: string) {
    return this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { employeeCode: { contains: search, mode: 'insensitive' } },
                { user: { email: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        isActive: true,
        pbxExtension: true,
        whatsappInboxMember: true,
        joiningDate: true,
        user: {
          select: {
            email: true, phone: true, status: true,
            userRoles: { select: { role: { select: { name: true, displayName: true } } } },
          },
        },
        department: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        designation: { select: { id: true, name: true } },
      },
      orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }],
    });
  }

  /**
   * Reset an employee's CRM LOGIN password. HR may set one explicitly, else a
   * strong one is generated. Revokes active sessions and forces a change on
   * next login (reuses UsersService.resetPassword). Returns the new password once.
   */
  async resetPassword(employeeId: string, password: string | undefined, actorUserId: string) {
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, userId: true, firstName: true, lastName: true, user: { select: { email: true } } },
    });
    if (!emp) throw new NotFoundException('Employee not found');

    const newPassword = password?.trim() || this.generatePassword();
    await this.users.resetPassword(emp.userId, newPassword, actorUserId);

    return {
      employeeId: emp.id,
      name: `${emp.firstName} ${emp.lastName}`.trim(),
      email: emp.user?.email ?? '',
      password: newPassword,
    };
  }

  /** Edit an existing employee's HR fields (+ optional role reassignment). */
  async updateEmployee(
    id: string,
    dto: {
      firstName?: string; lastName?: string;
      departmentId?: string | null; branchId?: string | null; designationId?: string | null;
      phone?: string | null; pbxExtension?: string | null; whatsappInboxMember?: boolean;
      roleNames?: string[];
    },
    actorUserId: string,
  ) {
    const emp = await this.prisma.employee.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!emp) throw new NotFoundException('Employee not found');

    const has = (k: keyof typeof dto) => Object.prototype.hasOwnProperty.call(dto, k);
    await this.prisma.employee.update({
      where: { id },
      data: {
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
        ...(has('departmentId') ? { departmentId: dto.departmentId || null } : {}),
        ...(has('branchId') ? { branchId: dto.branchId || null } : {}),
        ...(has('designationId') ? { designationId: dto.designationId || null } : {}),
        ...(has('pbxExtension') ? { pbxExtension: dto.pbxExtension || null } : {}),
        ...(dto.whatsappInboxMember !== undefined ? { whatsappInboxMember: dto.whatsappInboxMember } : {}),
      },
    });

    if (has('phone')) {
      await this.prisma.userAccount.update({ where: { id: emp.userId }, data: { phone: dto.phone || null } });
    }

    // Role reassignment: replace the user's roles with the chosen set.
    if (dto.roleNames) {
      const roles = await this.prisma.role.findMany({ where: { name: { in: dto.roleNames }, isActive: true }, select: { id: true } });
      await this.prisma.userRole.deleteMany({ where: { userId: emp.userId } });
      if (roles.length) {
        await this.prisma.userRole.createMany({ data: roles.map((r) => ({ userId: emp.userId, roleId: r.id })), skipDuplicates: true });
      }
    }

    await this.audit.log({
      actorUserId,
      action: AuditAction.USER_UPDATED,
      entityType: 'Employee',
      entityId: id,
      newValues: { edited: Object.keys(dto) },
    });
    return { id, updated: true };
  }
}
