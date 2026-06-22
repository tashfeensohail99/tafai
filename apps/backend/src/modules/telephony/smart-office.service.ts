import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { normalisePhone } from '../../common/phone/phone.util';
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

  constructor(private readonly prisma: PrismaService) {}

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
    // the most recent matching Lead (Lead.phone is indexed but not unique).
    const client = await this.prisma.client.findFirst({
      where: { phone: e164, deletedAt: null },
      select: { id: true, assignedEmployeeId: true, blockedAt: true },
    });
    const lead = client
      ? null
      : await this.prisma.lead.findFirst({
          where: { phone: e164, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true, assignedEmployeeId: true, blockedAt: true },
        });

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
}
