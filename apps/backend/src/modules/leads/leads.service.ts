import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AuditAction, ClientStatus, LeadStatus, Prisma, TimelineEventType } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { generateLeadReferenceCode } from '../../common/reference-codes/reference-codes';
import { RequestUser } from '../../common/types/auth.types';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ActivityTimelineService } from '../activity-timeline/activity-timeline.service';
import { StorageService } from '../storage/storage.service';
import { AssignLeadDto, CreateLeadDto, ListLeadsQueryDto, UpdateLeadDto } from './leads.dto';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertConvertibleEmail } from './leads-conversion.util';

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly activityTimeline: ActivityTimelineService,
    private readonly storage: StorageService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAllAccessible(query: ListLeadsQueryDto, user: RequestUser) {
    const canViewAll = user.permissions.includes('leads.view_all');

    const where: Prisma.LeadWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.assignedEmployeeId ? { assignedEmployeeId: query.assignedEmployeeId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.sourceChannel ? { sourceChannel: { equals: query.sourceChannel, mode: 'insensitive' } } : {}),
      ...(query.serviceInterest ? { serviceInterest: { equals: query.serviceInterest, mode: 'insensitive' } } : {}),
      ...(query.targetCountry ? { targetCountry: { equals: query.targetCountry, mode: 'insensitive' } } : {}),
      ...this.createdRange(query),
      // CSV-origin filter: lead has at least one import-row with a
      // successful (IMPORTED or DUPLICATE) outcome.
      ...(query.fromCsv
        ? { importRows: { some: { outcome: { in: ['IMPORTED', 'DUPLICATE'] } } } }
        : {}),
      ...(!canViewAll
        ? {
            OR: [
              { assignedEmployee: { userId: user.id } },
              { createdByUserId: user.id },
            ],
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    // Ad filters require a join through the WhatsApp thread's JSON referral —
    // resolve the matching lead ids first, then constrain the query.
    if (query.fromAd || query.adSourceId) {
      where.id = { in: await this.adLeadIds(query.adSourceId) };
    }

    // Default 250 rows, capped at 1000. Returning all 1000+ leads in one
    // shot was a real prod perf issue: 1MB payload + 3s DB query made
    // /sales/leads sluggish. The UI filters/searches/counts client-side, so an
    // agent must load their FULL assigned queue or the KPI cards + tab counts
    // (Auto CRM, SLA Active, Overdue…) top out at the page size instead of the
    // real total. A single agent's queue is bounded (a few hundred — well under
    // the 1000 hard cap), so default agents to 1000 → they get every assigned
    // lead and honest totals. Admins with `leads.view_all` see the whole org
    // (thousands), so they keep the lean 250 default to avoid the 1MB/3s
    // payload; they can still pass `?limit=1000` or use the per-agent roster.
    const defaultLimit = canViewAll ? 250 : 1000;
    const rawLimit = query.limit ? parseInt(query.limit, 10) : defaultLimit;
    const take = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : defaultLimit, 1), 1000);

    return this.prisma.lead.findMany({
      where,
      include: {
        assignedEmployee: {
          select: { id: true, firstName: true, lastName: true },
        },
        branch: { select: { id: true, name: true } },
        referralPartner: {
          select: { id: true, companyName: true, referralCode: true },
        },
        // CSV-origin metadata for the CSV LEAD badge on every list view.
        // Always included now (single-row lateral join — negligible cost
        // versus the badge value of "see at a glance where this lead
        // came from"). The frontend renders the badge whenever the array
        // is non-empty.
        importRows: {
          where: { outcome: { in: ['IMPORTED', 'DUPLICATE'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            createdAt: true,
            batch: {
              select: { id: true, batchNumber: true, name: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  private createdRange(query: ListLeadsQueryDto): Prisma.LeadWhereInput {
    if (!query.createdFrom && !query.createdTo) return {};
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.createdFrom) createdAt.gte = new Date(query.createdFrom);
    if (query.createdTo) {
      const to = new Date(query.createdTo);
      to.setHours(23, 59, 59, 999);
      createdAt.lte = to;
    }
    return { createdAt };
  }

  /** Lead ids that arrived via a Click-to-WhatsApp ad (optionally one ad). */
  private async adLeadIds(adSourceId?: string): Promise<string[]> {
    const filter = adSourceId
      ? Prisma.sql`AND t."adReferral"->>'source_id' = ${adSourceId}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT l.id FROM crm.leads l
      JOIN whatsapp.threads t ON t."leadId" = l.id
      WHERE l."deletedAt" IS NULL AND t."adReferral" IS NOT NULL ${filter}
    `);
    return rows.map((r) => r.id);
  }

  /** KPI summary for the admin leads dashboard. */
  async getStats() {
    const byStatusRows = await this.prisma.$queryRaw<Array<{ status: string; n: number }>>(Prisma.sql`
      SELECT status::text AS status, count(*)::int AS n
      FROM crm.leads WHERE "deletedAt" IS NULL GROUP BY status`);
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of byStatusRows) {
      byStatus[r.status] = Number(r.n);
      total += Number(r.n);
    }

    const fromAdsRows = await this.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT count(DISTINCT l.id)::int AS n FROM crm.leads l
      JOIN whatsapp.threads t ON t."leadId" = l.id
      WHERE l."deletedAt" IS NULL AND t."adReferral" IS NOT NULL`);
    const fromAds = Number(fromAdsRows[0]?.n ?? 0);

    const recentRows = await this.prisma.$queryRaw<Array<{ d: string; n: number }>>(Prisma.sql`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS d, count(*)::int AS n
      FROM crm.leads WHERE "deletedAt" IS NULL AND "createdAt" >= now() - interval '14 days'
      GROUP BY 1 ORDER BY 1`);
    const recent = recentRows.map((r) => ({ date: r.d, count: Number(r.n) }));

    const converted = byStatus['CONVERTED'] ?? 0;
    const today = new Date().toISOString().slice(0, 10);
    return {
      total,
      byStatus,
      converted,
      conversionRate: total ? Math.round((converted / total) * 1000) / 10 : 0,
      fromAds,
      newToday: recent.find((r) => r.date === today)?.count ?? 0,
      recent,
    };
  }

  /** Per-ad leaderboard: Click-to-WhatsApp attribution → lead funnel. */
  async getAdPerformance() {
    const rows = await this.prisma.$queryRaw<
      Array<{
        sourceId: string | null;
        headline: string | null;
        sourceType: string | null;
        sourceUrl: string | null;
        leads: number;
        contacted: number;
        converted: number;
      }>
    >(Prisma.sql`
      SELECT mode() WITHIN GROUP (ORDER BY sub.source_id)   AS "sourceId",
             mode() WITHIN GROUP (ORDER BY sub.headline)    AS headline,
             mode() WITHIN GROUP (ORDER BY sub.source_type) AS "sourceType",
             mode() WITHIN GROUP (ORDER BY sub.source_url)  AS "sourceUrl",
             count(DISTINCT sub.lead_id)::int AS leads,
             (count(DISTINCT sub.lead_id) FILTER (WHERE sub.status IN ('CONTACTED','QUALIFIED','PROPOSAL_SENT','FOLLOW_UP','CONVERTED')))::int AS contacted,
             (count(DISTINCT sub.lead_id) FILTER (WHERE sub.status = 'CONVERTED'))::int AS converted
      FROM (
        SELECT l.id AS lead_id,
               l.status::text AS status,
               t."adReferral"->>'source_id'   AS source_id,
               t."adReferral"->>'headline'    AS headline,
               t."adReferral"->>'source_type' AS source_type,
               t."adReferral"->>'source_url'  AS source_url,
               -- Collapse every row for one ad together. source_id is the
               -- stable Meta ad identifier; only when it's absent do we fall
               -- back to the headline (then a single "unknown" bucket) so the
               -- same ad never fragments across source_url / source_type drift.
               COALESCE(
                 t."adReferral"->>'source_id',
                 t."adReferral"->>'headline',
                 'unknown'
               ) AS grp
        FROM crm.leads l
        JOIN whatsapp.threads t ON t."leadId" = l.id
        WHERE l."deletedAt" IS NULL AND t."adReferral" IS NOT NULL
      ) sub
      GROUP BY sub.grp
      ORDER BY leads DESC`);
    return rows.map((r) => ({
      sourceId: r.sourceId,
      headline: r.headline,
      sourceType: r.sourceType,
      sourceUrl: r.sourceUrl,
      leads: Number(r.leads),
      contacted: Number(r.contacted),
      converted: Number(r.converted),
    }));
  }

  async findByIdAccessible(id: string, user: RequestUser) {
    const canViewAll = user.permissions.includes('leads.view_all');

    const lead = await this.prisma.lead.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(!canViewAll
          ? {
              OR: [
                { assignedEmployee: { userId: user.id } },
                { createdByUserId: user.id },
              ],
            }
          : {}),
      },
      include: {
        // Slim selects — full relation rows were bloating the profile
        // payload with fields the UI never reads (employee dateOfBirth,
        // gender, profilePhotoKey; branch addressLine1; partner contact
        // JSON; etc.). Profile load dropped ~40% after this change.
        assignedEmployee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        },
        branch: { select: { id: true, name: true } },
        referralPartner: {
          select: { id: true, companyName: true, referralCode: true },
        },
        appointments: {
          orderBy: { scheduledAt: 'desc' },
          take: 10,
          select: {
            id: true,
            title: true,
            appointmentType: true,
            scheduledAt: true,
            durationMinutes: true,
            status: true,
            location: true,
          },
        },
        invoices: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            totalAmount: true,
            paidAmount: true,
            currency: true,
            createdAt: true,
            dueDate: true,
          },
        },
        // timelineEvents removed: the Activity tab does its own
        // /leads/:id/activity-timeline fetch when opened, so embedding
        // 20 events here was duplicate work on every profile load.
        // CSV-origin history — every batch the contact's phone appeared in.
        // Surfaced in the lead profile header (CSV LEAD badge).
        importRows: {
          where: { outcome: { in: ['IMPORTED', 'DUPLICATE'] } },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            createdAt: true,
            outcome: true,
            batch: {
              select: { id: true, batchNumber: true, name: true, uploadedAt: true },
            },
          },
        },
      },
    });

    if (!lead) throw new NotFoundException('Lead not found');

    return lead;
  }

  async findAll(query: ListLeadsQueryDto) {
    return this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.assignedEmployeeId ? { assignedEmployeeId: query.assignedEmployeeId } : {}),
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.sourceChannel ? { sourceChannel: query.sourceChannel } : {}),
        ...(query.search
          ? {
              OR: [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
                { phone: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        assignedEmployee: {
          select: { id: true, firstName: true, lastName: true },
        },
        branch: { select: { id: true, name: true } },
        referralPartner: {
          select: { id: true, companyName: true, referralCode: true },
        },
        // _count dropped on list endpoints — three extra subqueries per row
        // that nothing was rendering. Detail endpoint still returns them.
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id, deletedAt: null },
      include: {
        assignedEmployee: true,
        branch: true,
        referralPartner: true,
        appointments: { orderBy: { scheduledAt: 'desc' }, take: 10 },
        invoices: { orderBy: { createdAt: 'desc' }, take: 10 },
        timelineEvents: { orderBy: { createdAt: 'desc' }, take: 20 },
        // CSV-origin history — every batch the contact's phone appeared in.
        // Surfaced in the lead profile header (CSV LEAD badge).
        importRows: {
          where: { outcome: { in: ['IMPORTED', 'DUPLICATE'] } },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            createdAt: true,
            outcome: true,
            batch: {
              select: { id: true, batchNumber: true, name: true, uploadedAt: true },
            },
          },
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async create(dto: CreateLeadDto, actorUserId: string) {
    await this.ensureUniqueLead(dto.phone, dto.email);
    const fallbackAssignedEmployeeId = dto.assignedEmployeeId ?? await this.findEmployeeIdByUserId(actorUserId);
    const referenceCode = await generateLeadReferenceCode(this.prisma);

    const lead = await this.prisma.lead.create({
      data: {
        referenceCode,
        branchId: dto.branchId,
        assignedEmployeeId: fallbackAssignedEmployeeId,
        createdByUserId: actorUserId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        alternatePhone: dto.alternatePhone,
        nationality: dto.nationality,
        targetCountry: dto.targetCountry,
        serviceInterest: dto.serviceInterest,
        sourceChannel: dto.sourceChannel,
        referralPartnerId: dto.referralPartnerId,
        status: dto.status ?? LeadStatus.NEW,
        priority: dto.priority,
        notes: dto.notes,
        // Agreed service fee — anchors the single Invoice that future
        // installment Payments roll up to. NULL is fine when the deal
        // isn't finalised yet; finance falls back to the first handover
        // amount as the implicit total.
        ...(dto.serviceFeeAmount !== undefined
          ? { serviceFeeAmount: new Prisma.Decimal(dto.serviceFeeAmount) }
          : {}),
        ...(dto.serviceFeeCurrency !== undefined
          ? { serviceFeeCurrency: dto.serviceFeeCurrency }
          : {}),
      },
      include: {
        assignedEmployee: {
          select: { id: true, firstName: true, lastName: true },
        },
        branch: { select: { id: true, name: true } },
        referralPartner: {
          select: { id: true, companyName: true, referralCode: true },
        },
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.LEAD_CREATED,
      entityType: 'Lead',
      entityId: lead.id,
      newValues: {
        firstName: lead.firstName,
        lastName: lead.lastName,
        phone: lead.phone,
        serviceInterest: lead.serviceInterest,
        targetCountry: lead.targetCountry,
      },
    });

    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: lead.id,
      leadId: lead.id,
      eventType: TimelineEventType.LEAD_CREATED,
      description: `${lead.firstName} ${lead.lastName} created`,
      actorUserId,
      metadata: {
        sourceChannel: lead.sourceChannel,
        serviceInterest: lead.serviceInterest,
        targetCountry: lead.targetCountry,
      },
    });

    // Email — notify the assigned employee (fire-and-forget, non-blocking)
    if (lead.assignedEmployeeId) {
      void this.notifyAssignedEmployee(lead.assignedEmployeeId, {
        leadId: lead.id,
        leadName: `${lead.firstName} ${lead.lastName}`,
        leadPhone: lead.phone,
        leadService: lead.serviceInterest ?? null,
        leadCountry: lead.targetCountry ?? null,
        source: lead.sourceChannel ?? null,
        notes: lead.notes ?? null,
      });
    }

    // Inbox "Convert to Lead" flow: if a raw WhatsApp thread was the
    // source, link it to the new Lead so the chat history continues
    // against the same thread. Best-effort — if the thread is already
    // linked to a different lead/client we leave it alone.
    if (dto.whatsAppThreadId) {
      try {
        await this.prisma.whatsAppThread.updateMany({
          where: {
            id: dto.whatsAppThreadId,
            leadId: null,
            clientId: null,
          },
          data: { leadId: lead.id },
        });
      } catch {
        // Don't fail the whole create if the link step errors out.
      }
    }

    return lead;
  }

  async update(id: string, dto: UpdateLeadDto, user: RequestUser) {
    await this.assertLeadAccess(id, user);
    const actorUserId = user.id;
    const existing = await this.findById(id);

    if (dto.phone || dto.email) {
      await this.ensureUniqueLead(dto.phone, dto.email, id);
    }

    // If Sales changes the email, the old verification becomes meaningless
    // — a new address is by definition unverified. Clear the verified flag
    // + the in-flight token so the Verification tab forces a fresh send.
    // (Same email re-submitted → no-op.)
    const emailChanged =
      dto.email !== undefined && (dto.email ?? '').trim().toLowerCase() !== (existing.email ?? '').trim().toLowerCase();
    const emailVerificationReset = emailChanged
      ? {
          emailVerified: false,
          emailVerifiedAt: null,
          emailVerificationToken: null,
          emailVerificationSentAt: null,
        }
      : {};

    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        ...dto,
        ...emailVerificationReset,
        convertedAt: dto.status === LeadStatus.CONVERTED ? new Date() : undefined,
      },
      include: {
        assignedEmployee: {
          select: { id: true, firstName: true, lastName: true },
        },
        branch: { select: { id: true, name: true } },
        referralPartner: {
          select: { id: true, companyName: true, referralCode: true },
        },
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.LEAD_UPDATED,
      entityType: 'Lead',
      entityId: id,
      oldValues: {
        status: existing.status,
        assignedEmployeeId: existing.assignedEmployeeId,
        phone: existing.phone,
        email: existing.email,
      },
      newValues: dto,
    });

    // Status transition gets its own dedicated timeline event with a
    // status-specific eventType so the lead profile can render an icon
    // tone that matches (CONVERTED = green, others = neutral). When the
    // status didn't change we still record a generic LEAD_UPDATED so the
    // timeline reflects "fields were edited" — diffs which fields the
    // user touched are captured in metadata for forensics.
    if (dto.status && dto.status !== existing.status) {
      await this.activityTimeline.record({
        entityType: 'Lead',
        entityId: updated.id,
        leadId: updated.id,
        clientId: updated.convertedClientId ?? undefined,
        eventType:
          dto.status === LeadStatus.CONVERTED
            ? TimelineEventType.LEAD_CONVERTED
            : dto.status === LeadStatus.CONTACTED
              ? TimelineEventType.LEAD_CONTACTED
              : dto.status === LeadStatus.QUALIFIED
                ? TimelineEventType.LEAD_QUALIFIED
                : TimelineEventType.LEAD_STATUS_CHANGED,
        description:
          dto.status === LeadStatus.CONVERTED
            ? 'Lead marked as converted'
            : `Lead status changed from ${existing.status} to ${dto.status}`,
        actorUserId,
        metadata: { from: existing.status, to: dto.status },
      });
    } else {
      // No status change — record what (if anything) changed instead so the
      // timeline still reflects the edit. Skip if the DTO was effectively a
      // no-op (zero scalar fields supplied besides status === existing).
      const changedFields = Object.entries(dto)
        .filter(([k, v]) => v !== undefined && k !== 'status')
        .map(([k]) => k);
      if (changedFields.length > 0) {
        await this.activityTimeline.record({
          entityType: 'Lead',
          entityId: updated.id,
          leadId: updated.id,
          eventType: TimelineEventType.LEAD_UPDATED,
          description: `Lead updated: ${changedFields.slice(0, 4).join(', ')}${changedFields.length > 4 ? '…' : ''}`,
          actorUserId,
          metadata: { changedFields },
        });
      }
    }

    return updated;
  }

  /**
   * Soft-delete a lead. Sets `deletedAt = NOW()`. Every list / search /
   * detail query already filters `deletedAt: null` so the lead vanishes
   * from sales + admin views, the lead-imports page (via its row's
   * leadId staying intact but the lead itself dropping out), and the
   * WhatsApp inbox queries that filter on `lead.deletedAt`.
   *
   * Related entities (WhatsApp thread, messages, follow-ups, appointments,
   * invoices) are NOT cascade-deleted — their underlying records survive
   * for forensics, but any UI surface that walks through `lead` will skip
   * deleted leads because of the deletedAt filter.
   *
   * Hard delete is not exposed; if recovery is ever needed an admin can
   * clear deletedAt directly in the DB.
   */
  async remove(id: string, user: RequestUser): Promise<void> {
    await this.assertLeadAccess(id, user);
    const actorUserId = user.id;
    // findById filters deletedAt:null, so this throws NotFound for an
    // already-deleted lead — exactly the behaviour we want.
    const existing = await this.findById(id);

    await this.prisma.lead.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.LEAD_UPDATED,
      entityType: 'Lead',
      entityId: id,
      oldValues: { deletedAt: null, status: existing.status },
      newValues: { deletedAt: new Date().toISOString(), action: 'soft-delete' },
    });

    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: id,
      leadId: id,
      eventType: TimelineEventType.LEAD_DELETED,
      description: `Lead ${existing.referenceCode} deleted by admin`,
      actorUserId,
    });
  }

  /**
   * Soft-delete a set of leads in a single transaction. Used by the
   * "Delete selected" bulk action on the admin leads page. Returns the
   * count actually marked deleted (excludes leads already deleted or not
   * found, so the caller can show "Deleted N of M leads" if there were
   * mismatches).
   *
   * Audit log is written once per lead so the trail stays granular —
   * collapsing into a single bulk-event would hide the per-lead detail
   * forensics later, and the volume here is admin-driven not automated
   * so the row count stays sane.
   */
  async removeBulk(ids: string[], user: RequestUser): Promise<{ deleted: number }> {
    if (ids.length === 0) return { deleted: 0 };
    const actorUserId = user.id;
    const canViewAll = user.permissions.includes('leads.view_all');
    const now = new Date();

    // Look up which IDs are actually still alive so we only audit-log the
    // ones we successfully delete. updateMany doesn't tell us which rows
    // matched, so this pre-fetch is cheap insurance. Non-admins are scoped to
    // their own assigned/created leads, so a bulk call can't reach across to
    // another agent's leads by id.
    const targets = await this.prisma.lead.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        ...(!canViewAll
          ? { OR: [{ assignedEmployee: { userId: user.id } }, { createdByUserId: user.id }] }
          : {}),
      },
      select: { id: true, referenceCode: true, status: true },
    });
    if (targets.length === 0) return { deleted: 0 };

    await this.prisma.lead.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: { deletedAt: now },
    });

    // Audit + timeline writes are fire-and-await — each is cheap and we
    // want the trail durable before returning. Both records are written
    // per-lead so the per-lead activity tab still shows the delete event
    // even on bulk operations (admin can't tell from the timeline whether
    // a lead was deleted individually or in a batch — neither hurts).
    await Promise.all(
      targets.flatMap((t) => [
        this.auditLog.log({
          actorUserId,
          action: AuditAction.LEAD_UPDATED,
          entityType: 'Lead',
          entityId: t.id,
          oldValues: { deletedAt: null, status: t.status },
          newValues: { deletedAt: now.toISOString(), action: 'bulk-soft-delete' },
        }),
        this.activityTimeline.record({
          entityType: 'Lead',
          entityId: t.id,
          leadId: t.id,
          eventType: TimelineEventType.LEAD_DELETED,
          description: `Lead ${t.referenceCode} deleted (bulk action)`,
          actorUserId,
          metadata: { bulk: true, batchSize: targets.length },
        }),
      ]),
    );

    return { deleted: targets.length };
  }

  async assign(id: string, dto: AssignLeadDto, user: RequestUser) {
    await this.assertLeadAccess(id, user);
    const actorUserId = user.id;
    const existing = await this.findById(id);

    const updated = await this.prisma.lead.update({
      where: { id },
      data: { assignedEmployeeId: dto.assignedEmployeeId },
      include: {
        assignedEmployee: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    const action = existing.assignedEmployeeId ? AuditAction.LEAD_REASSIGNED : AuditAction.LEAD_ASSIGNED;
    await this.auditLog.log({
      actorUserId,
      action,
      entityType: 'Lead',
      entityId: id,
      oldValues: { assignedEmployeeId: existing.assignedEmployeeId },
      newValues: { assignedEmployeeId: dto.assignedEmployeeId },
    });

    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: id,
      leadId: id,
      eventType: TimelineEventType.LEAD_ASSIGNED,
      description: existing.assignedEmployeeId ? 'Lead reassigned to another employee' : 'Lead assigned to an employee',
      actorUserId,
      metadata: {
        assignedEmployeeId: dto.assignedEmployeeId,
        assignedEmployeeName: updated.assignedEmployee ? `${updated.assignedEmployee.firstName} ${updated.assignedEmployee.lastName}` : null,
      },
    });

    // Email — notify the newly assigned employee (fire-and-forget)
    void this.notifyAssignedEmployee(dto.assignedEmployeeId, {
      leadId: id,
      leadName: `${existing.firstName} ${existing.lastName}`,
      leadPhone: existing.phone,
      leadService: existing.serviceInterest ?? null,
      leadCountry: existing.targetCountry ?? null,
      source: existing.sourceChannel ?? null,
      notes: existing.notes ?? null,
    });

    return this.findById(id);
  }

  async convertToClient(
    id: string,
    actorUserId: string,
    notes?: string,
    tx?: Prisma.TransactionClient,
    opts?: { requireEmailVerified?: boolean },
  ) {
    const prisma = tx ?? this.prisma;
    const lead = await prisma.lead.findUnique({
      where: { id, deletedAt: null },
      include: {
        branch: { select: { id: true, name: true } },
        assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (lead.convertedClientId) {
      const existingClient = await prisma.client.findUnique({ where: { id: lead.convertedClientId } });
      if (!existingClient) {
        throw new NotFoundException('Converted client not found');
      }

      return { lead, client: existingClient, wasExistingClient: false };
    }

    let client = await prisma.client.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { phone: lead.phone },
          ...(lead.email ? [{ email: lead.email }] : []),
        ],
      },
    });

    const wasExistingClient = Boolean(client);
    if (!client) {
      // Conversion rule: the user-facing convert requires a verified email
      // before a NEW client is created. The trusted finance/processing paths
      // pass nothing, so this never blocks a post-agreement auto-convert.
      assertConvertibleEmail({ email: lead.email, emailVerified: lead.emailVerified }, opts);

      client = await prisma.client.create({
        data: {
          // The client inherits the lead's reference code so a single
          // identifier (TIS-YYYY-NNNNN) follows the customer from first
          // contact through every invoice + receipt + case for life.
          // Same code on both rows is enforced by both columns being
          // @unique — duplicate inserts would fail upfront.
          referenceCode: lead.referenceCode,
          branchId: lead.branchId,
          createdByUserId: actorUserId,
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          phone: lead.phone,
          alternatePhone: lead.alternatePhone,
          nationality: lead.nationality,
          // Provenance — preserves where this client came from so admin views,
          // processing officers, and the original sales rep stay linked.
          sourceLeadId: lead.id,
          assignedEmployeeId: lead.assignedEmployeeId,
          serviceType: lead.serviceInterest,
          targetCountry: lead.targetCountry,
          status: ClientStatus.NEW_CLIENT,
          portalAccessEnabled: true,
        },
      });

      await this.auditLog.log({
        actorUserId,
        action: AuditAction.CLIENT_CREATED,
        entityType: 'Client',
        entityId: client.id,
        newValues: {
          firstName: client.firstName,
          lastName: client.lastName,
          phone: client.phone,
          email: client.email,
          sourceLeadId: lead.id,
        },
      });
    }

    const updatedLead = await prisma.lead.update({
      where: { id },
      data: {
        status: LeadStatus.CONVERTED,
        convertedAt: new Date(),
        convertedClientId: client.id,
        notes: notes ? [lead.notes, notes].filter(Boolean).join('\n\n') : lead.notes,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.LEAD_CONVERTED,
      entityType: 'Lead',
      entityId: lead.id,
      oldValues: {
        status: lead.status,
        convertedClientId: lead.convertedClientId,
      },
      newValues: {
        status: LeadStatus.CONVERTED,
        convertedClientId: client.id,
        notes,
      },
    });

    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: lead.id,
      leadId: lead.id,
      clientId: client.id,
      eventType: TimelineEventType.LEAD_CONVERTED,
      description: `${lead.firstName} ${lead.lastName} converted to client`,
      actorUserId,
      metadata: {
        clientId: client.id,
        clientExisted: wasExistingClient,
      },
    });

    await this.activityTimeline.record({
      entityType: 'Client',
      entityId: client.id,
      leadId: lead.id,
      clientId: client.id,
      eventType: TimelineEventType.LEAD_CONVERTED,
      description: `Client record created from lead ${lead.firstName} ${lead.lastName}`,
      actorUserId,
      metadata: {
        leadId: lead.id,
        sourceChannel: lead.sourceChannel,
        serviceInterest: lead.serviceInterest,
        targetCountry: lead.targetCountry,
      },
    });

    return { lead: updatedLead, client, wasExistingClient };
  }

  private async ensureUniqueLead(phone?: string, email?: string, excludeId?: string) {
    if (!phone && !email) return;

    const duplicateLead = await this.prisma.lead.findFirst({
      where: {
        deletedAt: null,
        AND: [excludeId ? { id: { not: excludeId } } : {}],
        OR: [
          ...(phone ? [{ phone }] : []),
          ...(email ? [{ email }] : []),
        ],
      },
      select: { id: true },
    });

    if (duplicateLead) {
      throw new ConflictException('A lead with the same phone or email already exists');
    }
  }

  private async findEmployeeIdByUserId(userId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        userId,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });

    return employee?.id ?? null;
  }

  /**
   * Lightweight per-employee counters for the sales sidebar badges + SLA
   * tracker — assigned leads, open / overdue follow-ups, and the agent's
   * Response-SLA score. Cheap COUNT queries; safe to call on every page load.
   */
  /**
   * Sales dashboard one-shot aggregate. Replaces the previous pattern of
   * fetching all leads + follow-ups + appointments client-side just to
   * compute counts — that was downloading ~260KB to display 7 numbers.
   *
   * Returns counts + the 5 most recent assigned leads in a single
   * round-trip (~5KB). All Prisma calls run in parallel via Promise.all.
   *
   * Scopes to the caller's own book unless they have `leads.view_all`.
   */
  async salesDashboardSummary(user: RequestUser): Promise<{
    activeLeads: number;
    handovers: number;
    adminAssigned: number;
    autoAssigned: number;
    adminToday: number;
    autoToday: number;
    overdue: number;
    pipeline: Array<{ stage: string; count: number }>;
    recentLeads: Array<{
      id: string;
      firstName: string;
      lastName: string;
      phone: string;
      stage: string;
      priority: string | null;
      assignedAt: Date;
      targetCountry: string | null;
      serviceInterest: string | null;
    }>;
  }> {
    const canViewAll = user.permissions.includes('leads.view_all');
    const employeeId = canViewAll ? undefined : await this.findEmployeeIdByUserId(user.id);

    // Common WHERE — applied to every count below so admin sees org-wide,
    // agent sees their own book. Empty result for an agent without an
    // employee row (would be a config error, but we no-op cleanly).
    if (!canViewAll && !employeeId) {
      return {
        activeLeads: 0,
        handovers: 0,
        adminAssigned: 0,
        autoAssigned: 0,
        adminToday: 0,
        autoToday: 0,
        overdue: 0,
        pipeline: [],
        recentLeads: [],
      };
    }
    const scope = canViewAll ? {} : { assignedEmployeeId: employeeId };

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const [
      active,
      handovers,
      totalLeads,
      todayLeads,
      overdue,
      pipelineRows,
      recent,
    ] = await Promise.all([
      this.prisma.lead.count({
        where: { ...scope, deletedAt: null, status: { not: 'CONVERTED' } },
      }),
      // SENT_TO_FINANCE in the UI maps to LeadStatus.CONVERTED.
      this.prisma.lead.count({
        where: { ...scope, deletedAt: null, status: 'CONVERTED' },
      }),
      this.prisma.lead.count({ where: { ...scope, deletedAt: null } }),
      this.prisma.lead.count({
        where: { ...scope, deletedAt: null, createdAt: { gte: startOfToday } },
      }),
      // SLA-overdue = followUps overdue today (matches the sidebar's overdueFollowUps)
      this.prisma.followUp.count({
        where: {
          status: 'OPEN',
          dueAt: { lt: now },
          ...(employeeId ? { assignedEmployeeId: employeeId } : {}),
        },
      }),
      this.prisma.lead.groupBy({
        by: ['status'],
        where: { ...scope, deletedAt: null },
        _count: true,
      }),
      this.prisma.lead.findMany({
        where: { ...scope, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          status: true,
          priority: true,
          createdAt: true,
          targetCountry: true,
          serviceInterest: true,
        },
      }),
    ]);

    return {
      activeLeads: active,
      handovers,
      // The Sales UI hardcodes assignmentType='ADMIN' for every lead today
      // (we don't actually track AUTO_CRM-vs-ADMIN separately yet). Return
      // total + today so the dashboard tile reads accurately, with auto=0
      // to preserve the existing two-tile layout.
      adminAssigned: totalLeads,
      autoAssigned: 0,
      adminToday: todayLeads,
      autoToday: 0,
      overdue,
      pipeline: pipelineRows.map((r) => ({ stage: r.status, count: r._count as unknown as number })),
      recentLeads: recent.map((l) => ({
        id: l.id,
        firstName: l.firstName,
        lastName: l.lastName,
        phone: l.phone,
        stage: l.status,
        priority: l.priority,
        assignedAt: l.createdAt,
        targetCountry: l.targetCountry,
        serviceInterest: l.serviceInterest,
      })),
    };
  }

  async myStats(userId: string): Promise<{
    assignedLeads: number;
    openFollowUps: number;
    overdueFollowUps: number;
    slaScore: number;
  }> {
    const employeeId = await this.findEmployeeIdByUserId(userId);
    if (!employeeId) {
      return { assignedLeads: 0, openFollowUps: 0, overdueFollowUps: 0, slaScore: 100 };
    }
    const now = new Date();
    const [assignedLeads, openFollowUps, overdueFollowUps, emp] = await Promise.all([
      this.prisma.lead.count({ where: { assignedEmployeeId: employeeId, deletedAt: null } }),
      this.prisma.followUp.count({ where: { assignedEmployeeId: employeeId, status: 'OPEN' } }),
      this.prisma.followUp.count({
        where: { assignedEmployeeId: employeeId, status: 'OPEN', dueAt: { lt: now } },
      }),
      this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { slaResponsesMet: true, slaResponsesBreached: true, slaPenaltyPoints: true },
      }),
    ]);
    const total = (emp?.slaResponsesMet ?? 0) + (emp?.slaResponsesBreached ?? 0);
    const base = total === 0 ? 100 : Math.round(((emp?.slaResponsesMet ?? 0) / total) * 100);
    // Subtract the presence penalty (Offline-during-working-hours). Floors at 0;
    // the penalty recovers +1/day so the score climbs back as they stay available.
    const slaScore = Math.max(0, base - (emp?.slaPenaltyPoints ?? 0));
    return { assignedLeads, openFollowUps, overdueFollowUps, slaScore };
  }

  // ---------------------------------------------------------------------------
  // Lead access guard (shared by writes + file attachments)
  // ---------------------------------------------------------------------------

  /**
   * Write/access guard for a single lead. Enforces the SAME ownership rule as
   * reads (findByIdAccessible / findAllAccessible): an admin/manager holding
   * `leads.view_all` may act on any lead; everyone else only on a lead they are
   * assigned to or created. Throws 404 (not 403) for an inaccessible lead so we
   * never confirm its existence to a user who shouldn't see it.
   *
   * Public so it guards both the internal write paths (update / remove / assign)
   * and the controller's convert path (convertToClient itself is shared with the
   * trusted finance auto-convert flow, so the user-facing access check lives at
   * the entry point). This closes the gap where the controller permission alone
   * let an agent reach another agent's lead by id.
   */
  async assertLeadAccess(leadId: string, user: RequestUser): Promise<void> {
    const canViewAll = user.permissions.includes('leads.view_all');
    const lead = await this.prisma.lead.findFirst({
      where: {
        id: leadId,
        deletedAt: null,
        ...(!canViewAll
          ? {
              OR: [
                { assignedEmployee: { userId: user.id } },
                { createdByUserId: user.id },
              ],
            }
          : {}),
      },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException('Lead not found or access denied');
  }

  async uploadLeadFile(
    leadId: string,
    file: Express.Multer.File,
    user: RequestUser,
  ) {
    await this.assertLeadAccess(leadId, user);

    const { key } = await this.storage.upload(
      file.buffer,
      file.mimetype,
      `leads/${leadId}/attachments`,
      file.originalname,
    );

    const employee = await this.findEmployeeIdByUserId(user.id);
    void employee; // employee id not stored in lead_files, use userId directly

    const created = await this.prisma.leadFile.create({
      data: {
        leadId,
        uploadedByUserId: user.id,
        fileName: file.originalname,
        fileKey: key,
        fileMimeType: file.mimetype,
        fileSizeBytes: file.size,
      },
      select: {
        id: true,
        leadId: true,
        fileName: true,
        fileMimeType: true,
        fileSizeBytes: true,
        createdAt: true,
      },
    });

    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: leadId,
      leadId,
      eventType: TimelineEventType.LEAD_FILE_UPLOADED,
      description: `File uploaded: ${file.originalname}`,
      actorUserId: user.id,
      metadata: {
        fileId: created.id,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });

    return created;
  }

  async listLeadFiles(leadId: string, user: RequestUser) {
    await this.assertLeadAccess(leadId, user);

    return this.prisma.leadFile.findMany({
      where: { leadId },
      select: {
        id: true,
        leadId: true,
        fileName: true,
        fileMimeType: true,
        fileSizeBytes: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getLeadFileSignedUrl(leadId: string, fileId: string, user: RequestUser) {
    await this.assertLeadAccess(leadId, user);

    const record = await this.prisma.leadFile.findFirst({
      where: { id: fileId, leadId },
      select: { fileKey: true, fileName: true },
    });
    if (!record) throw new NotFoundException('File not found');

    const url = await this.storage.getSignedUrl(record.fileKey);
    return { url, fileName: record.fileName };
  }

  async deleteLeadFile(leadId: string, fileId: string, user: RequestUser) {
    await this.assertLeadAccess(leadId, user);

    const record = await this.prisma.leadFile.findFirst({
      where: { id: fileId, leadId },
      select: { id: true, fileKey: true, fileName: true, uploadedByUserId: true },
    });
    if (!record) throw new NotFoundException('File not found');

    // Only uploader or someone with leads.view_all can delete
    const canDeleteAny = user.permissions.includes('leads.view_all');
    if (!canDeleteAny && record.uploadedByUserId !== user.id) {
      throw new ForbiddenException('You can only delete files you uploaded');
    }

    await this.storage.delete(record.fileKey);
    await this.prisma.leadFile.delete({ where: { id: fileId } });

    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: leadId,
      leadId,
      eventType: TimelineEventType.LEAD_FILE_DELETED,
      description: `File deleted: ${record.fileName}`,
      actorUserId: user.id,
      metadata: { fileId: record.id, fileName: record.fileName },
    });

    return { deleted: true };
  }

  // ── Email verification ──────────────────────────────────────────────────────

  async sendEmailVerification(leadId: string, actorUserId: string): Promise<{ sent: boolean }> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true, emailVerified: true },
    });

    if (!lead) throw new NotFoundException('Lead not found');
    if (!lead.email) throw new BadRequestException('Lead has no email address on file');
    if (lead.emailVerified) throw new BadRequestException('Email is already verified');

    const token = randomBytes(32).toString('hex');
    const frontendUrl = process.env.FRONTEND_URL ?? 'https://tashfeengroup.com';
    const verifyUrl = `${frontendUrl}/verify-lead-email?token=${token}`;

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        emailVerificationToken: token,
        emailVerificationSentAt: new Date(),
      },
    });

    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: leadId,
      leadId,
      eventType: TimelineEventType.EMAIL_VERIFICATION_SENT,
      description: `Verification email sent to ${lead.email}`,
      actorUserId,
    });

    void this.email.sendLeadEmailVerification({
      to: lead.email,
      leadName: `${lead.firstName} ${lead.lastName}`,
      verifyUrl,
    });

    return { sent: true };
  }

  async verifyLeadEmail(token: string): Promise<{ verified: boolean; leadName: string }> {
    if (!token) throw new BadRequestException('Verification token is required');

    const lead = await this.prisma.lead.findUnique({
      where: { emailVerificationToken: token },
      select: { id: true, firstName: true, lastName: true, emailVerified: true, emailVerificationSentAt: true },
    });

    if (!lead) throw new NotFoundException('Invalid or expired verification link');
    if (lead.emailVerified) {
      return { verified: true, leadName: `${lead.firstName} ${lead.lastName}` };
    }

    // Token expires after 48 hours
    if (lead.emailVerificationSentAt) {
      const ageMs = Date.now() - new Date(lead.emailVerificationSentAt).getTime();
      if (ageMs > 48 * 60 * 60 * 1000) {
        throw new BadRequestException('Verification link has expired. Please request a new one.');
      }
    }

    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
        emailVerificationToken: null,
      },
    });

    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: lead.id,
      leadId: lead.id,
      eventType: TimelineEventType.EMAIL_VERIFIED,
      description: `Email address verified`,
      actorUserId: undefined,
    });

    return { verified: true, leadName: `${lead.firstName} ${lead.lastName}` };
  }

  // ── Email helpers ──────────────────────────────────────────────────────────

  private async notifyAssignedEmployee(
    assignedEmployeeId: string,
    lead: {
      leadId: string;
      leadName: string;
      leadPhone: string;
      leadService: string | null;
      leadCountry: string | null;
      source: string | null;
      notes: string | null;
    },
  ): Promise<void> {
    try {
      const emp = await this.prisma.employee.findUnique({
        where: { id: assignedEmployeeId },
        select: {
          firstName: true,
          lastName: true,
          user: { select: { id: true, email: true } },
        },
      });
      if (!emp?.user) return;

      // In-app notification (also fans out to push). Fired for both the
      // create-with-assignee path ("new lead assigned") and the manual
      // assign/reassign path — neither of which is the bulk-import flow, so
      // this can't spam an agent on a 500-row CSV upload.
      await this.notifications.create({
        userId: emp.user.id,
        type: 'LEAD_ASSIGNED',
        title: `New lead assigned: ${lead.leadName}`,
        body: lead.leadService ? `${lead.leadService}${lead.leadCountry ? ` · ${lead.leadCountry}` : ''}` : lead.leadPhone,
        link: `/sales/leads/${lead.leadId}`,
      });

      if (!emp.user.email) return;
      await this.email.sendLeadAssigned({
        to: emp.user.email,
        consultantName: `${emp.firstName} ${emp.lastName}`,
        leadName: lead.leadName,
        leadPhone: lead.leadPhone,
        leadService: lead.leadService,
        leadCountry: lead.leadCountry,
        source: lead.source,
        notes: lead.notes,
      });
    } catch {
      // Notification/email failure must never break the main request
    }
  }

}