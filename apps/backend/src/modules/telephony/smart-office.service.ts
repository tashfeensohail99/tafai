import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditCategory, AuditSeverity, LeadStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { normalisePhone } from '../../common/phone/phone.util';
import { findLeadByNormalizedPhone } from '../../common/phone/lead-dedupe';
import { generateLeadReferenceCode } from '../../common/reference-codes/reference-codes';
import { AuditLogService } from '../audit-log/audit-log.service';
import { LeadAssignmentService } from '../lead-assignment/lead-assignment.service';
import type { ResolveCallDto, SmartOfficeResolveResponse } from './smart-office.dto';

interface ResolveOutcome {
  matched: boolean;
  agentExtension: string | null;
  agentName: string | null;
  leadId: string | null;
  clientId: string | null;
  agentEmployeeId: string | null;
  reason: string | null;
}

/**
 * Resolves an inbound Telenor Smart Office call to the owning salesperson's PBX
 * extension. Mirrors the WhatsApp inbound resolver's precedence: a converted
 * Client wins over a Lead; the most recent Lead is used when a phone repeats.
 *
 * We only ever RESOLVE (caller -> owner -> extension). Availability and
 * fallback (queue/IVR) are Telenor's responsibility — on any no-match we simply
 * return `matched:false` and Smart Office default-routes, so no call is lost.
 */
@Injectable()
export class SmartOfficeService {
  private readonly log = new Logger(SmartOfficeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly leadAssignment: LeadAssignmentService,
  ) {}

  /** Round-robin auto-assign a genuinely-new caller to a rep (and ring that
   *  rep) instead of dropping to Telenor's default queue. Kill switch:
   *  SMARTOFFICE_UAN_AUTOASSIGN_ENABLED=false reverts to unassigned capture. */
  private uanAutoAssignEnabled(): boolean {
    return process.env.SMARTOFFICE_UAN_AUTOASSIGN_ENABLED !== 'false';
  }

  async resolve(dto: ResolveCallDto): Promise<SmartOfficeResolveResponse> {
    const callId = dto.call_id ?? null;
    const norm = normalisePhone(dto.a_party_number, 'PK');
    let outcome = await this.resolveOwner(norm.ok ? norm.e164 ?? null : null, norm.reason);

    // Genuinely-new caller (no lead AND no client). Instead of dropping to
    // Telenor's default queue and parking an UNASSIGNED lead, round-robin the
    // call to a rep who has a PBX extension — the SAME shared cursor every
    // other channel uses — and create the lead already assigned (+ sticky) to
    // that rep. So the call rings that person AND their later WhatsApp sticks
    // to the same person. Falls back gracefully: if nothing is assignable
    // (no rep has an extension yet, kill switch off, or any error) we revert
    // to the old unassigned-capture + matched:false default routing — no call
    // is ever lost. This IS on the response path (we must return the picked
    // extension), but it's a handful of indexed queries, well within 5s.
    if (norm.ok && norm.e164 && outcome.reason === 'no lead or client for caller') {
      if (this.uanAutoAssignEnabled()) {
        const assigned = await this.assignUnknownCaller(norm.e164).catch((e) => {
          this.log.warn(`UAN auto-assign failed, falling back: ${(e as Error).message}`);
          return null;
        });
        if (assigned) {
          outcome = {
            ...outcome,
            matched: true,
            agentExtension: assigned.extension,
            agentName: assigned.name,
            agentEmployeeId: assigned.employeeId,
            leadId: assigned.leadId,
            reason: 'unknown caller — round-robin assigned',
          };
        }
      }
      // Still unmatched after the attempt (disabled / no assignable rep) →
      // keep the safety net: park an UNASSIGNED lead, best-effort + off-path.
      if (!outcome.matched) {
        void this.captureUnknownCaller(norm.e164);
      }
    }

    // Our own inbound-call log (Telenor exposes no CDRs). Fire-and-forget so a
    // logging hiccup never delays or fails the 5-second-budget response.
    void this.logCall({
      callerE164: norm.ok ? norm.e164 ?? null : null,
      callerRaw: dto.a_party_number,
      masterNumber: dto.b_party_number ?? null,
      callId,
      ...outcome,
    });

    if (outcome.matched && outcome.agentExtension) {
      return {
        matched: true,
        agent_extension: outcome.agentExtension,
        agent_name: outcome.agentName ?? undefined,
        call_id: callId,
      };
    }
    return { matched: false, agent_extension: null, call_id: callId };
  }

  private async resolveOwner(
    e164: string | null,
    parseReason?: string,
  ): Promise<ResolveOutcome> {
    const base: ResolveOutcome = {
      matched: false,
      agentExtension: null,
      agentName: null,
      leadId: null,
      clientId: null,
      agentEmployeeId: null,
      reason: null,
    };

    if (!e164) {
      return { ...base, reason: `unparseable caller (${parseReason ?? 'unknown'})` };
    }

    // Converted customers (Client.phone is unique) take precedence; otherwise
    // the matching Lead. The lead is matched by NORMALISED phone (last-10
    // digits) not an exact string, so a caller whose lead was stored in a
    // different format (local "03xx…" vs "+92 3xx…") still resolves to their
    // existing owner instead of "no lead" → default routing.
    const client = await this.prisma.client.findFirst({
      where: { phone: e164, deletedAt: null },
      select: { id: true, assignedEmployeeId: true, blockedAt: true },
    });
    const lead = client
      ? null
      : ((await this.prisma.lead.findFirst({
          where: { phone: e164, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true, assignedEmployeeId: true, blockedAt: true },
        })) ?? (await findLeadByNormalizedPhone(this.prisma, e164)));

    const owner = client ?? lead;
    const ctx: ResolveOutcome = { ...base, clientId: client?.id ?? null, leadId: lead?.id ?? null };

    if (!owner) return { ...ctx, reason: 'no lead or client for caller' };
    if (owner.blockedAt) return { ...ctx, reason: 'caller is blocked' };
    if (!owner.assignedEmployeeId) return { ...ctx, reason: 'no assigned salesperson' };

    const emp = await this.prisma.employee.findFirst({
      where: { id: owner.assignedEmployeeId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, isActive: true, pbxExtension: true },
    });
    if (!emp) return { ...ctx, reason: 'assigned salesperson not found' };

    const name = `${emp.firstName} ${emp.lastName}`.trim();
    if (!emp.isActive) {
      return { ...ctx, agentEmployeeId: emp.id, agentName: name, reason: 'assigned salesperson inactive' };
    }
    if (!emp.pbxExtension) {
      return {
        ...ctx,
        agentEmployeeId: emp.id,
        agentName: name,
        reason: 'salesperson has no PBX extension mapped',
      };
    }

    return {
      ...ctx,
      matched: true,
      agentEmployeeId: emp.id,
      agentName: name,
      agentExtension: emp.pbxExtension,
      reason: null,
    };
  }

  private async logCall(data: {
    callerE164: string | null;
    callerRaw: string | null;
    masterNumber: string | null;
    callId: string | null;
    matched: boolean;
    reason: string | null;
    leadId: string | null;
    clientId: string | null;
    agentEmployeeId: string | null;
    agentExtension: string | null;
    agentName: string | null;
  }): Promise<void> {
    try {
      await this.prisma.smartOfficeCallLog.create({ data });
    } catch (e) {
      this.log.warn(`smart-office call log failed: ${(e as Error).message}`);
    }
  }

  /**
   * Round-robin a genuinely-new caller to a rep who has a PBX extension and
   * create the lead ALREADY ASSIGNED (+ sticky) to that rep — so the live call
   * rings that person and their later WhatsApp sticks to the same owner.
   *
   * Reuses the shared `LeadAssignmentService` cursor (WhatsApp / CSV / Meta /
   * website all rotate on it), but restricted to reps who have an extension
   * (`pickNextAgent(selectedAgentIds)`) — a call can only be routed to a rep we
   * can hand Telenor an extension for. Returns null (caller falls back to the
   * unassigned capture + Telenor default routing) when nothing is assignable.
   *
   * Concurrency: the same advisory lock as captureUnknownCaller serialises
   * same-number calls; if a racing call already created/owns the lead, we route
   * this call to THAT owner's extension so both legs ring one rep. `pickNextAgent`
   * runs in its own tx BEFORE the advisory-lock tx (never nested).
   */
  private async assignUnknownCaller(
    e164: string,
  ): Promise<{ extension: string; name: string; employeeId: string; leadId: string | null } | null> {
    const digits = e164.replace(/\D/g, '');

    // Pool: eligible reps who can actually take a routed call (have an ext).
    // pickNextAgent re-applies the full eligibility predicate (active WhatsApp
    // inbox member, non-finance), so this loose pre-filter just narrows to
    // extension-holders; the intersection is the real pool.
    const extRepIds = (
      await this.prisma.employee.findMany({
        where: { pbxExtension: { not: null }, isActive: true, deletedAt: null },
        select: { id: true },
      })
    ).map((e) => e.id);
    if (extRepIds.length === 0) return null;

    const assigneeId = await this.leadAssignment.pickNextAgent(extRepIds);
    if (!assigneeId) return null;

    const emp = await this.prisma.employee.findUnique({
      where: { id: assigneeId },
      select: { firstName: true, lastName: true, pbxExtension: true, isActive: true },
    });
    if (!emp?.pbxExtension || !emp.isActive) return null;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', digits);

      // Re-check under the lock — a racing call may have created it already.
      const client = await tx.client.findFirst({
        where: { phone: e164, deletedAt: null },
        select: { assignedEmployeeId: true },
      });
      if (client) return { created: false, ownerId: client.assignedEmployeeId, leadId: null as string | null };
      const existingLead =
        (await tx.lead.findFirst({
          where: { phone: e164, deletedAt: null },
          select: { id: true, assignedEmployeeId: true },
        })) ?? (await findLeadByNormalizedPhone(this.prisma, e164));
      if (existingLead) return { created: false, ownerId: existingLead.assignedEmployeeId, leadId: existingLead.id };

      const branch = await tx.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
      const referenceCode = await generateLeadReferenceCode(this.prisma);
      const lead = await tx.lead.create({
        data: {
          referenceCode,
          firstName: 'UAN',
          lastName: digits.slice(-4),
          phone: e164,
          sourceChannel: 'uan',
          status: LeadStatus.NEW,
          assignedEmployeeId: assigneeId,
          // Stick to this rep so the caller's later WhatsApp routes here too.
          preferredEmployeeId: assigneeId,
          ...(branch ? { branchId: branch.id } : {}),
        },
        select: { id: true },
      });
      return { created: true, ownerId: assigneeId, leadId: lead.id };
    });

    // Freshly created and assigned to our round-robin pick — return its ext.
    if (result.created) {
      this.log.log(`UAN caller round-robin assigned to ${emp.firstName} ${emp.lastName} (ext ${emp.pbxExtension}), lead ${result.leadId}`);
      void this.audit
        .log({
          action: AuditAction.LEAD_CREATED,
          entityType: 'Lead',
          entityId: result.leadId!,
          category: AuditCategory.WEBHOOK,
          severity: AuditSeverity.HIGH,
          metadata: { source: 'smartoffice_inbound_call', assigned: true, assignedEmployeeId: assigneeId, phoneLast4: digits.slice(-4) },
        })
        .catch(() => undefined);
      return { extension: emp.pbxExtension, name: `${emp.firstName} ${emp.lastName}`.trim(), employeeId: assigneeId, leadId: result.leadId };
    }

    // A racing call already created/owns the lead — route this leg to that
    // owner's extension so both legs ring one rep. If that owner has no ext,
    // give up (caller default-routes).
    if (!result.ownerId) return null;
    const owner = await this.prisma.employee.findUnique({
      where: { id: result.ownerId },
      select: { firstName: true, lastName: true, pbxExtension: true, isActive: true },
    });
    if (!owner?.pbxExtension || !owner.isActive) return null;
    return { extension: owner.pbxExtension, name: `${owner.firstName} ${owner.lastName}`.trim(), employeeId: result.ownerId, leadId: result.leadId };
  }

  /**
   * Create an UNASSIGNED lead for a first-time UAN caller we don't recognise, so
   * inbound phone demand lands in the sales pipeline for a rep to follow up.
   * Mirrors the WhatsApp-inbound auto-create: unassigned (pickup queue),
   * sourceChannel tags the origin ('uan') so these are easy to triage / exclude
   * from ROI metrics. A Postgres advisory lock keyed on the number serialises
   * concurrent PBX calls from the same caller so they can't race into duplicates
   * (the WhatsApp in-process lock can't help — the resolve endpoint runs in the
   * web process, not the queue worker). Best-effort throughout: any failure is
   * logged and swallowed so the call response is never delayed or failed.
   */
  private async captureUnknownCaller(e164: string): Promise<void> {
    try {
      const digits = e164.replace(/\D/g, '');
      const createdId = await this.prisma.$transaction(async (tx) => {
        // Serialise same-number captures; the lock releases on commit, so a
        // second concurrent caller only proceeds after the first's lead is
        // visible — and then the re-check below finds it and skips.
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', digits);

        // Re-check under the lock. A converted client or an existing lead (exact
        // OR normalised-format) means this isn't an unknown caller after all —
        // never spawn a duplicate.
        const client = await tx.client.findFirst({
          where: { phone: e164, deletedAt: null },
          select: { id: true },
        });
        if (client) return null;
        const existingLead =
          (await tx.lead.findFirst({
            where: { phone: e164, deletedAt: null },
            select: { id: true },
          })) ?? (await findLeadByNormalizedPhone(this.prisma, e164));
        if (existingLead) return null;

        const branch = await tx.branch.findFirst({
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        const referenceCode = await generateLeadReferenceCode(this.prisma);
        const lead = await tx.lead.create({
          data: {
            referenceCode,
            firstName: 'UAN',
            lastName: digits.slice(-4),
            phone: e164,
            sourceChannel: 'uan',
            status: LeadStatus.NEW,
            ...(branch ? { branchId: branch.id } : {}),
          },
          select: { id: true },
        });
        return lead.id;
      });

      if (createdId) {
        this.log.log(`captured unknown UAN caller as unassigned lead ${createdId}`);
        void this.audit
          .log({
            action: AuditAction.LEAD_CREATED,
            entityType: 'Lead',
            entityId: createdId,
            category: AuditCategory.WEBHOOK,
            severity: AuditSeverity.HIGH,
            metadata: { source: 'smartoffice_inbound_call', phoneLast4: digits.slice(-4) },
          })
          .catch(() => undefined);
      }
    } catch (e) {
      this.log.warn(`capture unknown UAN caller failed: ${(e as Error).message}`);
    }
  }
}
