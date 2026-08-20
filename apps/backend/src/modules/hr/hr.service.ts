import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { UsersService } from '../users/users.service';
import { MailProvisioningService } from './mail-provisioning.service';
import { OnboardEmployeeDto, OffboardEmployeeDto } from './hr.dto';
import { AuditAction } from '@prisma/client';

@Injectable()
export class HrService {
  private readonly log = new Logger(HrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly users: UsersService,
    private readonly mail: MailProvisioningService,
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
    // Shuffle so the guaranteed classes aren't always in the first 4 slots.
    return pw
      .split('')
      .sort(() => randomInt(3) - 1)
      .join('');
  }

  /**
   * Create login account + employee profile (+ optional business mailbox) in
   * one call. Returns the credentials ONCE so HR can hand them to the new hire.
   */
  async onboard(dto: OnboardEmployeeDto, actorUserId: string) {
    const password = this.generatePassword();

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
      if (mailboxCreated) {
        const localPart = email.split('@')[0];
        await this.mail.deleteMailbox(localPart).catch((err) =>
          this.log.error(`rollback deleteMailbox ${localPart} failed: ${(err as Error).message}`),
        );
      }
      throw e;
    }

    // 3) Create the employee profile with an auto employee code + HR fields.
    const employeeCode = await this.nextEmployeeCode();
    const emp = await this.prisma.employee.create({
      data: {
        userId: user.id,
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

    await this.audit.log({
      actorUserId,
      action: AuditAction.USER_CREATED,
      entityType: 'Employee',
      entityId: emp.id,
      newValues: { employeeCode, email, mailboxCreated, name: `${dto.firstName} ${dto.lastName}` },
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
    dto: { employeeId: string; setAsLogin?: boolean },
    actorUserId: string,
  ) {
    const emp = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { id: true, firstName: true, lastName: true, userId: true, user: { select: { email: true } } },
    });
    if (!emp) throw new NotFoundException('Employee not found');

    const domain = this.mail.domain;
    const boxes = new Set(await this.mail.listLocalParts());
    const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const loginLocal = (emp.user?.email ?? '').toLowerCase().split('@')[0] ?? '';

    // Prefer an existing name-matching mailbox; otherwise allocate a fresh one.
    const existing = [loginLocal, norm(emp.firstName), `${norm(emp.firstName)}.${norm(emp.lastName)}`]
      .filter(Boolean)
      .find((c) => boxes.has(c));
    const localPart = existing ?? (await this.mail.allocateLocalPart(emp.firstName));
    const email = `${localPart}@${domain}`;
    const password = this.generatePassword();

    let action: 'created' | 'reset';
    if (existing) {
      await this.mail.resetPassword(localPart, password);
      action = 'reset';
    } else {
      await this.mail.createMailbox(localPart, password);
      action = 'created';
    }

    // Optionally switch the CRM login to the business email.
    let loginUpdated = false;
    if (dto.setAsLogin && (emp.user?.email ?? '').toLowerCase() !== email) {
      const clash = await this.prisma.userAccount.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, id: { not: emp.userId } },
        select: { id: true },
      });
      if (clash) {
        throw new BadRequestException(`${email} is already another account's login.`);
      }
      await this.prisma.userAccount.update({ where: { id: emp.userId }, data: { email } });
      loginUpdated = true;
    }

    await this.audit.log({
      actorUserId,
      action: AuditAction.USER_UPDATED,
      entityType: 'Employee',
      entityId: emp.id,
      newValues: { mailbox: email, mailboxAction: action, loginUpdated },
    });

    return { employeeId: emp.id, email, password, action, loginUpdated };
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
        user: { select: { email: true, phone: true, status: true } },
        department: { select: { name: true } },
        branch: { select: { name: true } },
        designation: { select: { name: true } },
      },
      orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }],
    });
  }
}
