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
    // HR may set a password explicitly; otherwise generate a strong one.
    const password = dto.password?.trim() || this.generatePassword();

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
