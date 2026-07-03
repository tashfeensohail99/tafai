import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditCategory, AuditSeverity, LeadStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { normalisePhone } from '../../common/phone/phone.util';
import { findLeadByNormalizedPhone } from '../../common/phone/lead-dedupe';
import { generateLeadReferenceCode } from '../../common/reference-codes/reference-codes';
import { AuditLogService } from '../audit-log/audit-log.service';
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
  ) {}

  async resolve(dto: ResolveCallDto): Promise<SmartOfficeResolveResponse> {
    const callId = dto.call_id ?? null;
    const norm = normalisePhone(dto.a_party_number, 'PK');
    const outcome = await this.resolveOwner(norm.ok ? norm.e164 ?? null : null, norm.reason);

    // Our own inbound-call log (Telenor exposes no CDRs). Fire-and-forget so a
    // logging hiccup never delays or fails the 5-second-budget response.
    void this.logCall({
      callerE164: norm.ok ? norm.e164 ?? null : null,
      callerRaw: dto.a_party_number,
      masterNumber: dto.b_party_number ?? null,
      callId,
      ...outcome,
    });

    // Capture a genuinely-unknown caller (no lead AND no client) as a new
    // UNASSIGNED lead so real phone demand isn't lost — a rep picks it up from
    // the pipeline. Fire-and-forget: the live call still default-routes via
    // matched:false below; we never delay/fail the 5s-budget response for a
    // capture write. ONLY on the "no lead or client" outcome — a blocked /
    // unassigned / inactive OWNER already exists and must not spawn a duplicate.
    if (norm.ok && norm.e164 && outcome.reason === 'no lead or client for caller') {
      void this.captureUnknownCaller(norm.e164);
    }

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
