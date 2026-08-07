import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditCategory, AuditSeverity, LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ActivityTimelineService } from '../activity-timeline/activity-timeline.service';
import { LeadAssignmentService } from '../lead-assignment/lead-assignment.service';
import { generateLeadReferenceCode } from '../../common/reference-codes/reference-codes';
import { MetaGraphService } from './meta-graph.service';
import { mapMetaFields } from './field-mapping';

/** One leadgen change parsed from the Meta `page` webhook payload. */
export interface LeadgenEntry {
  leadgenId: string;
  formId?: string;
  pageId?: string;
  adId?: string;
  createdTime?: number;
}

export interface ProcessResult {
  status: 'created' | 'matched-existing' | 'duplicate-leadgen' | 'no-data';
  leadId?: string;
}

@Injectable()
export class MetaLeadsService {
  private readonly log = new Logger(MetaLeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: MetaGraphService,
    private readonly assignment: LeadAssignmentService,
    private readonly timeline: ActivityTimelineService,
  ) {}

  /** Extract leadgen entries from a Meta `object:"page"` webhook payload. */
  parseWebhookPayload(payload: unknown): LeadgenEntry[] {
    const out: LeadgenEntry[] = [];
    const p = payload as {
      entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: Record<string, unknown> }> }>;
    };
    for (const entry of p?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        if (change?.field !== 'leadgen') continue;
        const v = change.value ?? {};
        const leadgenId = v['leadgen_id'];
        if (!leadgenId) continue;
        out.push({
          leadgenId: String(leadgenId),
          formId: v['form_id'] ? String(v['form_id']) : undefined,
          pageId: v['page_id'] ? String(v['page_id']) : entry.id ? String(entry.id) : undefined,
          adId: v['ad_id'] ? String(v['ad_id']) : undefined,
          createdTime: v['created_time'] ? Number(v['created_time']) : undefined,
        });
      }
    }
    return out;
  }

  /** Process one leadgen entry end-to-end. Idempotent on leadgenId. */
  async processLeadgen(entry: LeadgenEntry): Promise<ProcessResult> {
    // 1. Idempotency — Meta retries webhooks; leadgenId is our unique guard.
    const seen = await this.prisma.metaLeadSubmission.findUnique({
      where: { leadgenId: entry.leadgenId },
      select: { leadId: true },
    });
    if (seen) {
      this.log.log(`leadgen ${entry.leadgenId} already processed → skip`);
      return { status: 'duplicate-leadgen', leadId: seen.leadId };
    }

    // 2. Fetch the full lead from Graph (answers + attribution).
    const detail = await this.graph.fetchLead(entry.leadgenId);
    if (!detail) {
      // Throw so BullMQ retries transient Graph/token errors.
      throw new Error(`Graph returned no data for leadgen ${entry.leadgenId}`);
    }
    const mapped = mapMetaFields(detail.field_data);
    const formName = detail.form_id ? await this.graph.fetchFormName(detail.form_id) : null;
    const campaignLabel = detail.campaign_name || detail.ad_name || formName || 'Meta Lead Form';

    const submission = {
      leadgenId: entry.leadgenId,
      formId: detail.form_id ?? entry.formId ?? null,
      formName,
      adId: detail.ad_id ?? entry.adId ?? null,
      adName: detail.ad_name ?? null,
      adsetId: detail.adset_id ?? null,
      adsetName: detail.adset_name ?? null,
      campaignId: detail.campaign_id ?? null,
      campaignName: detail.campaign_name ?? null,
      pageId: entry.pageId ?? null,
      platform: detail.platform ?? null,
      isOrganic: detail.is_organic ?? null,
      formAnswers: (detail.field_data ?? []) as unknown as Prisma.InputJsonValue,
      rawPayload: detail as unknown as Prisma.InputJsonValue,
      metaCreatedAt: detail.created_time ? new Date(detail.created_time) : null,
    };

    // 3. Identity dedupe — phone (E.164) or email against active leads.
    const orConds: Prisma.LeadWhereInput[] = [];
    if (mapped.phoneE164) orConds.push({ phone: mapped.phoneE164 });
    if (mapped.email) orConds.push({ email: { equals: mapped.email, mode: 'insensitive' } });
    const existing = orConds.length
      ? await this.prisma.lead.findFirst({
          where: { deletedAt: null, OR: orConds },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })
      : null;

    // 3a. Repeat customer → record the submission + a note, keep the assignee.
    if (existing) {
      await this.prisma.metaLeadSubmission.create({
        data: { ...submission, leadId: existing.id, isDuplicate: true },
      });
      await this.timeline.record({
        entityType: 'Lead',
        entityId: existing.id,
        leadId: existing.id,
        eventType: 'META_LEAD_CREATED',
        description: `Repeat Meta Lead Form submission (${campaignLabel}) — matched existing lead; assignee unchanged`,
        metadata: { leadgenId: entry.leadgenId, duplicate: true, formId: submission.formId, campaignId: submission.campaignId },
      });
      this.log.log(`leadgen ${entry.leadgenId} matched existing lead ${existing.id}`);
      return { status: 'matched-existing', leadId: existing.id };
    }

    // 3b. New lead → round-robin assign + create + timeline.
    const branch = await this.prisma.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    const assigneeId = await this.assignment.pickNextAgent();
    const referenceCode = await generateLeadReferenceCode(this.prisma);
    const phone = mapped.phoneE164 ?? (mapped.phoneRaw?.trim() || `meta-${entry.leadgenId}`);

    try {
      const lead = await this.prisma.lead.create({
        data: {
          referenceCode,
          firstName: mapped.firstName,
          lastName: mapped.lastName,
          email: mapped.email,
          phone,
          nationality: mapped.nationality,
          targetCountry: mapped.targetCountry,
          serviceInterest: mapped.serviceInterest,
          notes: mapped.notes,
          sourceChannel: 'meta-lead-form',
          status: LeadStatus.NEW,
          // Durable ad attribution on the lead itself (mirrors the CTWA path).
          // Lead Ads carry the full chain from Graph, so all levels are filled.
          metaSource: 'lead-form',
          metaAdId: submission.adId,
          metaAdName: submission.adName,
          metaAdsetId: submission.adsetId,
          metaAdsetName: submission.adsetName,
          metaCampaignId: submission.campaignId,
          metaCampaignName: submission.campaignName,
          metaFormId: submission.formId,
          metaLeadId: submission.leadgenId,
          ...(assigneeId ? { assignedEmployeeId: assigneeId, preferredEmployeeId: assigneeId } : {}),
          ...(branch ? { branchId: branch.id } : {}),
          metaSubmissions: { create: { ...submission } },
        },
        select: { id: true },
      });

      let assigneeName = 'unassigned';
      if (assigneeId) {
        const emp = await this.prisma.employee.findUnique({
          where: { id: assigneeId },
          select: { firstName: true, lastName: true },
        });
        if (emp) assigneeName = `${emp.firstName} ${emp.lastName}`.trim();
      }

      await this.timeline.record({
        entityType: 'Lead',
        entityId: lead.id,
        leadId: lead.id,
        eventType: 'META_LEAD_CREATED',
        description: `New lead from Meta Lead Form (${campaignLabel}) — ${
          assigneeId ? `assigned to ${assigneeName} by round robin` : 'unassigned (no eligible agent)'
        }`,
        metadata: {
          leadgenId: entry.leadgenId,
          assignedEmployeeId: assigneeId,
          formId: submission.formId,
          formName: submission.formName,
          campaignId: submission.campaignId,
          campaignName: submission.campaignName,
          adId: submission.adId,
          platform: submission.platform,
        },
      });

      // Formal AuditLog entry so auto-intake leads appear in the who/what/when
      // audit trail alongside manually-created/reassigned ones (the
      // ActivityTimeline above is the sales-facing feed; this is the audit log
      // our reports query). actorUserId omitted = system (Meta webhook, no
      // human). Records the round-robin assignee at creation.
      await this.prisma.auditLog.create({
        data: {
          action: AuditAction.LEAD_CREATED,
          entityType: 'Lead',
          entityId: lead.id,
          // Webhook-driven system write (Meta Lead Ads), HIGH = record creation.
          category: AuditCategory.WEBHOOK,
          severity: AuditSeverity.HIGH,
          newValues: {
            assignedEmployeeId: assigneeId ?? null,
            sourceChannel: 'meta-lead-form',
            status: LeadStatus.NEW,
          },
          metadata: {
            autoAssigned: !!assigneeId,
            channel: 'meta-lead-form',
            assignment: 'round-robin',
            assigneeName,
            leadgenId: entry.leadgenId,
          },
        },
      });

      this.log.log(`leadgen ${entry.leadgenId} → new lead ${lead.id} (assignee ${assigneeId ?? 'none'})`);
      return { status: 'created', leadId: lead.id };
    } catch (e) {
      // Unique leadgenId race (two jobs, same submission) → treat as dup.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        this.log.warn(`leadgen ${entry.leadgenId} raced on unique constraint — treating as duplicate`);
        return { status: 'duplicate-leadgen' };
      }
      throw e;
    }
  }
}
