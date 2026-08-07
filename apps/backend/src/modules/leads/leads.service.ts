import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  AuditAction,
  ClientStatus,
  LeadDisposition,
  LeadStatus,
  PaymentStatus,
  Prisma,
  TimelineEventType,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { generateLeadReferenceCode } from '../../common/reference-codes/reference-codes';
import { normalisePhone } from '../../common/phone/phone.util';
import { findLeadByNormalizedPhone } from '../../common/phone/lead-dedupe';
import {
  looksLikePhoneSearch,
  phoneSearchCandidates,
} from '../../common/phone/phone-search.util';
import { RequestUser } from '../../common/types/auth.types';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ActivityTimelineService } from '../activity-timeline/activity-timeline.service';
import { StorageService } from '../storage/storage.service';
import { AssignLeadDto, CreateLeadDto, ListLeadsQueryDto, UpdateLeadDto } from './leads.dto';
import { CreateWebsiteLeadDto } from './public-lead.dto';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertConvertibleEmail } from './leads-conversion.util';
import { LeadAssignmentService } from '../lead-assignment/lead-assignment.service';

/**
 * How website enquiries are stamped. UPPERCASE deliberately: the sales UI's
 * create-lead picker already writes 'WEBSITE', and the admin leads page builds
 * its source filter from raw DB values — so a lowercase variant would show up
 * as a second, separate facet for the same thing.
 */
const WEBSITE_SOURCE = 'WEBSITE';

/** A human cannot read the form and type a real enquiry faster than this. */
const MIN_FORM_ELAPSED_MS = 3000;

/**
 * Ceiling on a lead's `notes` past which the public form stops appending.
 * Generous — a genuinely chatty customer will never reach it — but it bounds
 * what an unauthenticated caller can add to a row that is read on every open.
 */
const MAX_PUBLIC_NOTES_CHARS = 20_000;

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly activityTimeline: ActivityTimelineService,
    private readonly storage: StorageService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly leadAssignment: LeadAssignmentService,
  ) {}

  /**
   * Create a lead from the public website enquiry form.
   *
   * The ONLY unauthenticated write path into this table, so the rules differ
   * from the staff-facing create:
   *
   *  - The caller chooses NOTHING that matters. Source, status, branch and
   *    assignee are all set here. The DTO cannot express them.
   *  - Silent spam rejection. A honeypot hit or an impossibly fast submission
   *    returns the SAME success shape as a real enquiry. Telling a bot why it
   *    failed just teaches it to pass next time, and a human who somehow trips
   *    it can still reach us on WhatsApp, which is the primary channel anyway.
   *  - Duplicates do not create a second lead. Same rule as the Meta path:
   *    match on phone OR email, keep the existing owner, append a note so the
   *    rep can see they enquired again rather than getting a fresh record with
   *    no history.
   *
   * Returns only { ok } — never a lead id, an assignee, or whether a duplicate
   * was found. A public endpoint must not let anyone probe who is in the CRM.
   */
  async createWebsiteLead(dto: CreateWebsiteLeadDto): Promise<{ ok: true }> {
    // Honeypot: hidden field, so any content at all means a bot.
    if (dto.company && dto.company.trim() !== '') return { ok: true };
    // Timing floor. Absent value = older client or JS disabled; allow it.
    if (typeof dto.elapsedMs === 'number' && dto.elapsedMs < MIN_FORM_ELAPSED_MS) {
      return { ok: true };
    }

    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const email = dto.email?.trim() || undefined;

    // E.164, exactly like the staff create form (createLead) and the Meta path
    // (field-mapping). Storing the raw typed string would put "03331120001"
    // beside the "+923331120001" every other channel writes: the dedupe below
    // could never match, and the WhatsApp thread lookup would miss the same
    // person. An unparseable number is still captured rather than rejected —
    // losing a real enquiry over formatting is worse than a number a rep tidies.
    const parsed = normalisePhone(dto.phone, 'PK');
    const phone = parsed.e164 ?? dto.phone.replace(/[\s()\-.]/g, '');

    const noteLines = [
      // Labelled as public and unverified. Anyone who knows a customer's number
      // can reach the append branch below, so a rep must be able to tell this
      // text from something the customer actually said to them.
      'Website enquiry (public form — unverified).',
      dto.page ? `Page: ${dto.page}` : null,
      dto.targetCountry ? `Destination: ${dto.targetCountry}` : null,
      dto.serviceInterest ? `Interest: ${dto.serviceInterest}` : null,
      dto.message ? `\nWhat they said:\n${dto.message.trim()}` : null,
    ].filter(Boolean);
    const notes = noteLines.join('\n');

    // Phone matching goes through the shared matcher rather than an exact-string
    // compare: it reconciles the local / national / E.164 spellings the same
    // number gets stored in, returns the OLDEST hit so the original owner keeps
    // the customer, and is served by the leads_phone_digits_idx expression
    // index. A plain `{ phone }` filter would miss those variants AND seq-scan.
    const byPhone = parsed.e164
      ? await findLeadByNormalizedPhone(this.prisma, parsed.e164)
      : null;
    const byEmail =
      !byPhone && email
        ? await this.prisma.lead.findFirst({
            where: { deletedAt: null, email: { equals: email, mode: 'insensitive' } },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          })
        : null;
    const existingId = byPhone?.id ?? byEmail?.id;
    const existing = existingId
      ? await this.prisma.lead.findUnique({
          where: { id: existingId },
          select: { id: true, notes: true },
        })
      : null;

    if (existing) {
      // Append rather than overwrite — the rep's own notes matter more than ours.
      //
      // Bounded, because this is an unauthenticated write onto an existing
      // record: `notes` is an uncapped column that is loaded every time someone
      // opens the lead, so a script submitting on a known number could grow one
      // row indefinitely. Past the ceiling we stop adding and let the timeline
      // carry the signal instead. It never truncates what a rep wrote.
      const stamped = `[${new Date().toISOString().slice(0, 10)}] ${notes}`;
      if ((existing.notes?.length ?? 0) < MAX_PUBLIC_NOTES_CHARS) {
        await this.prisma.lead.update({
          where: { id: existing.id },
          data: { notes: existing.notes ? `${existing.notes}\n\n${stamped}` : stamped },
        });
      }
      await this.activityTimeline
        .record({
          entityType: 'lead',
          entityId: existing.id,
          leadId: existing.id,
          eventType: TimelineEventType.NOTE_ADDED,
          description: 'Enquired again via the website form',
        })
        // Timeline is a nice-to-have here; never fail a public submission
        // because an audit write hiccuped.
        .catch(() => undefined);
      return { ok: true };
    }

    const [branch, assigneeId, referenceCode] = await Promise.all([
      this.prisma.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }),
      this.leadAssignment.pickNextAgent(),
      generateLeadReferenceCode(this.prisma),
    ]);

    try {
      await this.prisma.lead.create({
        data: {
          referenceCode,
          firstName,
          lastName,
          email,
          phone,
          targetCountry: dto.targetCountry?.trim() || undefined,
          serviceInterest: dto.serviceInterest?.trim() || undefined,
          notes,
          sourceChannel: WEBSITE_SOURCE,
          status: LeadStatus.NEW,
          ...(assigneeId ? { assignedEmployeeId: assigneeId, preferredEmployeeId: assigneeId } : {}),
          ...(branch ? { branchId: branch.id } : {}),
        },
        select: { id: true },
      });
    } catch (err) {
      // A referenceCode collision under concurrent submissions is a race, not a
      // client error. Swallow it the way the Meta path does rather than showing
      // a stranger a 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { ok: true };
      }
      throw err;
    }

    return { ok: true };
  }

  /**
   * Lead ids whose stored phone is the SAME NUMBER as the typed term, whatever
   * format either is written in. Reception records `03219566502` on the visit
   * slip, the lead is saved as `+923219566502`, and a substring search finds
   * neither from the other — staff concluded such leads were "missing" or
   * deleted when they were sitting in plain sight.
   *
   * Equality `IN (…)` on the digits expression so it uses
   * `leads_phone_digits_idx`; an unanchored LIKE would reintroduce the
   * full-table regex scan that cost 21s before that index existed.
   *
   * Returns [] for anything that isn't a phone number, so name and
   * reference-code searches are untouched.
   */
  private async phoneSearchLeadIds(term: string): Promise<string[]> {
    if (!looksLikePhoneSearch(term)) return [];
    const candidates = phoneSearchCandidates(term);
    if (!candidates.length) return [];
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM crm.leads
      WHERE regexp_replace(phone, '[^0-9]', '', 'g') IN (${Prisma.join(candidates)})
        AND "deletedAt" IS NULL
      LIMIT 500`;
    return rows.map((r) => r.id);
  }

  /**
   * Lead ids whose CONVERTED CLIENT's name matches the search term. The
   * assign-lead / leads-list search only sees Lead.firstName/lastName, but a
   * client's name is frequently CORRECTED on the Client record after conversion
   * (passport/CNIC auto-fill, Processing edits) and there is NO back-sync to the
   * Lead — so a rep searching the name they actually know matches no lead and
   * "can't find the client". Matching the linked client's name here closes that
   * gap. Mirrors phoneSearchLeadIds: returns a set of ids folded into the OR.
   */
  private async clientNameLeadIds(term: string): Promise<string[]> {
    const t = term.trim();
    if (t.length < 2) return []; // a single char would match half the table
    const like = `%${t}%`;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT l.id
      FROM crm.leads l
      JOIN crm.clients c ON c.id = l."convertedClientId"
      WHERE l."deletedAt" IS NULL
        AND c."deletedAt" IS NULL
        AND (
          c."firstName" ILIKE ${like}
          OR c."lastName" ILIKE ${like}
          OR (c."firstName" || ' ' || c."lastName") ILIKE ${like}
        )
      LIMIT 500`;
    return rows.map((r) => r.id);
  }

  async findAllAccessible(query: ListLeadsQueryDto, user: RequestUser) {
    const canViewAll = user.permissions.includes('leads.view_all');
    // Resolved before the where-clause is built: a phone term has to become a
    // set of ids, because Prisma can't express the digits-only comparison.
    const phoneMatchIds = query.search ? await this.phoneSearchLeadIds(query.search) : [];
    // Also fold in leads whose converted CLIENT's name matches — see
    // clientNameLeadIds (the client name is often the one the rep knows).
    const clientNameIds = query.search ? await this.clientNameLeadIds(query.search) : [];

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
      // successful (IMPORTED or DUPLICATE) outcome. A lead drops off this
      // worklist once it is genuinely handled, which is EITHER:
      //   - the customer REPLIED (thread has a first inbound) → it's now a live
      //     inbox conversation, or
      //   - a REP has messaged them (thread.lastHumanReplyAt) → first contact is
      //     made, so it is no longer "still to reach".
      // lastHumanReplyAt is the org-wide "we contacted them" key (the inbox's
      // Uncontacted filter and the re-engagement blast both key on it) and is
      // stamped only for sends with a real sender — the CSV drip's bot template
      // has sentByEmployeeId null, so a lead mid-drip (touch sent, no reply)
      // correctly STAYS on the list until a human picks it up. NOT (vs a
      // top-level OR) so it composes with the rep-scope / search OR clauses.
      ...(query.fromCsv
        ? {
            importRows: { some: { outcome: { in: ['IMPORTED', 'DUPLICATE'] } } },
            NOT: {
              whatsappThread: {
                is: {
                  OR: [
                    { firstInboundAt: { not: null } },
                    { lastHumanReplyAt: { not: null } },
                  ],
                },
              },
            },
          }
        : {}),
      // Rep-scope AND search each need their own OR group — and BOTH must hold.
      // They go inside a single `AND` array, NOT as two sibling `OR:` keys on
      // this object: object spread means a second `OR:` key silently CLOBBERS
      // the first, so `{...repScopeOR, ...searchOR}` would drop the rep scope and
      // let a `view_assigned` rep search across EVERY rep's leads. Access
      // scoping must survive a search — an agent only ever sees their own book.
      AND: [
        ...(!canViewAll
          ? [
              {
                OR: [
                  { assignedEmployee: { userId: user.id } },
                  { createdByUserId: user.id },
                ],
              } satisfies Prisma.LeadWhereInput,
            ]
          : []),
        ...(query.search
          ? [
              {
                OR: [
                  { firstName: { contains: query.search, mode: 'insensitive' } },
                  { lastName: { contains: query.search, mode: 'insensitive' } },
                  { email: { contains: query.search, mode: 'insensitive' } },
                  // Raw substring kept so a partial number still behaves as
                  // before; the id term makes 0321… find a stored +92321….
                  { phone: { contains: query.search, mode: 'insensitive' } },
                  ...(phoneMatchIds.length ? [{ id: { in: phoneMatchIds } }] : []),
                  ...(clientNameIds.length ? [{ id: { in: clientNameIds } }] : []),
                ],
              } satisfies Prisma.LeadWhereInput,
            ]
          : []),
      ],
    };

    // Ad filters require a join through the WhatsApp thread's JSON referral —
    // resolve the matching lead ids first, then constrain the query.
    if (query.fromAd || query.adSourceId) {
      where.id = { in: await this.adLeadIds(query.adSourceId) };
    }

    // Admins default to 250 rows; agents default to 10000. The UI
    // filters/searches/counts client-side, so an agent must load their FULL
    // assigned queue or the KPI cards + tab counts (Auto CRM, SLA Active,
    // Overdue…) top out at the page size instead of the real total. Agents
    // therefore default to 10000 → they get every assigned lead and honest
    // totals no matter how large their book (raised from 1000 so high-volume
    // reps are never silently truncated). Admins with `leads.view_all` see the
    // whole org (thousands), so they keep the lean 250 default to avoid a heavy
    // payload; they can pass `?limit=` (clamped at 10000) or use the per-agent
    // roster. The clamp still stops a curious agent from pulling the entire org
    // with `?limit=999999`.
    const defaultLimit = canViewAll ? 250 : 10000;
    const rawLimit = query.limit ? parseInt(query.limit, 10) : defaultLimit;
    const take = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : defaultLimit, 1), 10000);

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

  /**
   * Funnel counts for the CSV-leads page KPIs — the full picture the filtered
   * list can't show (the list only shows still-cold leads). Scoped to the caller
   * (their assigned/created CSV leads; admins see the whole org). `contacted` =
   * we've reached them (a drip template went out) OR they replied; `remaining` =
   * still cold (what the list shows); `deleted` is surfaced so the record count
   * reconciles and nothing appears to silently vanish.
   */
  async csvStats(
    user: RequestUser,
  ): Promise<{ total: number; contacted: number; remaining: number; deleted: number }> {
    const canViewAll = user.permissions.includes('leads.view_all');
    const csvOrigin: Prisma.LeadWhereInput = {
      importRows: { some: { outcome: { in: ['IMPORTED', 'DUPLICATE'] } } },
    };
    // Nested inside an AND so the rep-scope OR isn't clobbered by another OR.
    const repScope: Prisma.LeadWhereInput[] = canViewAll
      ? []
      : [{ OR: [{ assignedEmployee: { userId: user.id } }, { createdByUserId: user.id }] }];
    // Contacted = drip template sent OR a rep messaged them OR customer replied.
    // MUST stay in step with the list filter in findAllAccessible (fromCsv), or
    // "Remaining" stops reconciling with the rows actually shown. The extra
    // dripTouch1At term is why it isn't literally the same predicate: a
    // mid-drip lead counts as contacted for the KPI but stays ON the list, so
    // the rep can still take it over manually.
    const contactedCond: Prisma.LeadWhereInput = {
      OR: [
        { dripTouch1At: { not: null } },
        { whatsappThread: { is: { firstInboundAt: { not: null } } } },
        { whatsappThread: { is: { lastHumanReplyAt: { not: null } } } },
      ],
    };

    const [total, contacted, deleted] = await Promise.all([
      this.prisma.lead.count({ where: { AND: [csvOrigin, { deletedAt: null }, ...repScope] } }),
      this.prisma.lead.count({
        where: { AND: [csvOrigin, { deletedAt: null }, ...repScope, contactedCond] },
      }),
      this.prisma.lead.count({ where: { AND: [csvOrigin, { deletedAt: { not: null } }, ...repScope] } }),
    ]);
    return { total, contacted, remaining: Math.max(total - contacted, 0), deleted };
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

    // Revenue (agreed service fee): won = CONVERTED, pipeline = still-open stages.
    // Grouped by currency so PKR and CAD are never summed together. Cast to
    // float8 so the JSON carries plain numbers, not Prisma Decimal objects.
    const revenueRows = await this.prisma.$queryRaw<
      Array<{ cur: string; won: number; pipeline: number }>
    >(Prisma.sql`
      SELECT COALESCE(NULLIF(TRIM("serviceFeeCurrency"), ''), 'PKR') AS cur,
             COALESCE(SUM(CASE WHEN status = 'CONVERTED' THEN "serviceFeeAmount" END), 0)::float8 AS won,
             COALESCE(SUM(CASE WHEN status IN ('NEW','CONTACTED','QUALIFIED','PROPOSAL_SENT','FOLLOW_UP')
                          THEN "serviceFeeAmount" END), 0)::float8 AS pipeline
      FROM crm.leads
      WHERE "deletedAt" IS NULL AND "serviceFeeAmount" IS NOT NULL
      GROUP BY 1`);
    const revenueWon = revenueRows
      .filter((r) => Number(r.won) > 0)
      .map((r) => ({ currency: r.cur, amount: Math.round(Number(r.won)) }));
    const revenuePipeline = revenueRows
      .filter((r) => Number(r.pipeline) > 0)
      .map((r) => ({ currency: r.cur, amount: Math.round(Number(r.pipeline)) }));

    // Real cash received: confirmed payments (PAID/PARTIAL) booked against an
    // invoice whose client originated from a lead. This is actual money in the
    // door — distinct from the agreed service fee above, which is only a promise.
    const receivedPayments = await this.prisma.payment.findMany({
      where: {
        status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIAL] },
        invoice: { client: { sourceLeadId: { not: null } } },
      },
      select: { amount: true, currency: true },
    });
    const receivedByCur = new Map<string, number>();
    for (const p of receivedPayments) {
      const cur = (p.currency || 'CAD').trim() || 'CAD';
      receivedByCur.set(cur, (receivedByCur.get(cur) ?? 0) + Number(p.amount));
    }
    const revenueReceived = [...receivedByCur.entries()]
      .map(([currency, amount]) => ({ currency, amount: Math.round(amount) }))
      .filter((r) => r.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    // Top reasons we lose deals (LOST leads, by reason).
    const lostRows = await this.prisma.$queryRaw<Array<{ reason: string; n: number }>>(Prisma.sql`
      SELECT COALESCE(NULLIF(TRIM("lostReason"), ''), 'Not specified') AS reason, count(*)::int AS n
      FROM crm.leads WHERE "deletedAt" IS NULL AND status = 'LOST'
      GROUP BY 1 ORDER BY n DESC LIMIT 8`);
    const lostReasons = lostRows.map((r) => ({ reason: r.reason, count: Number(r.n) }));

    // Speed-to-lead (HUMAN): minutes from the customer's first message to the
    // first reply sent by a real employee — NOT the AI bot. We derive the first
    // human reply from the earliest OUTBOUND message that carries a
    // sentByEmployeeId (the bot leaves it null), so the auto-responder no longer
    // flatters this number. Median + % under 5m over leads' threads, last 30 days.
    const speedRows = await this.prisma.$queryRaw<
      Array<{ median_min: number | null; sample: number; under5: number }>
    >(Prisma.sql`
      SELECT
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (hr.first_human - t."firstInboundAt")) / 60.0
        )::float8 AS median_min,
        count(*)::int AS sample,
        SUM(CASE WHEN hr.first_human - t."firstInboundAt" <= interval '5 minutes'
                 THEN 1 ELSE 0 END)::int AS under5
      FROM whatsapp.threads t
      JOIN crm.leads l ON l.id = t."leadId"
      JOIN LATERAL (
        SELECT min(m."createdAt") AS first_human
        FROM whatsapp.messages m
        WHERE m."threadId" = t.id
          AND m.direction = 'OUTBOUND'
          AND m."sentByEmployeeId" IS NOT NULL
      ) hr ON true
      WHERE l."deletedAt" IS NULL
        AND t."firstInboundAt" IS NOT NULL
        AND hr.first_human IS NOT NULL
        AND hr.first_human >= t."firstInboundAt"
        AND t."firstInboundAt" >= now() - interval '30 days'`);
    const sp = speedRows[0];
    const speedSample = Number(sp?.sample ?? 0);
    const speedToLead = {
      medianMinutes: sp?.median_min != null ? Math.round(Number(sp.median_min)) : null,
      pctUnder5min: speedSample ? Math.round((Number(sp.under5) / speedSample) * 100) : null,
      sample: speedSample,
    };

    // ── Ad spend → blended efficiency. Spend reads tolerate the table being
    //    absent (pre-migration) or empty (no meta_ads credential). ────────────
    // All ad metrics use a trailing 30-day window so spend, leads and revenue
    // line up — a ratio mixing 30d spend with all-time leads would mislead.
    const adWindowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const adSpend: Array<{ currency: string; amount: number }> = [];
    let adSpendBaseCad = 0;
    try {
      const spendByCur = await this.prisma.adSpendDaily.groupBy({
        by: ['currency'],
        where: { date: { gte: adWindowStart } },
        _sum: { spend: true, baseSpend: true },
      });
      for (const s of spendByCur) {
        const amt = Math.round(Number(s._sum.spend ?? 0));
        if (amt > 0) adSpend.push({ currency: s.currency, amount: amt });
        adSpendBaseCad += Number(s._sum.baseSpend ?? 0);
      }
      adSpend.sort((a, b) => b.amount - a.amount);
    } catch {
      /* ad_spend_daily not migrated yet */
    }
    adSpendBaseCad = Math.round(adSpendBaseCad);

    // 30-day cohort: ad-sourced leads whose ad click landed in the window, plus
    // the received revenue (CAD) from the clients they became. Both the lead
    // count and the revenue are scoped to the same window as the spend above.
    let adLeads30 = 0;
    let adRevenueBaseCad = 0;
    try {
      const rows = await this.prisma.$queryRaw<Array<{ leads: number; revenue_base: number }>>(Prisma.sql`
        SELECT count(*)::int AS leads, COALESCE(SUM(r.rev_base), 0)::float8 AS revenue_base
        FROM (
          SELECT DISTINCT ON (l.id) l.id AS lead_id
          FROM crm.leads l
          JOIN whatsapp.threads t ON t."leadId" = l.id
          WHERE l."deletedAt" IS NULL AND t."adReferral" IS NOT NULL
            AND COALESCE(t."adReferralAt", l."createdAt") >= now() - interval '30 days'
        ) led
        JOIN LATERAL (
          SELECT COALESCE(SUM(p."baseAmount"), 0) AS rev_base
          FROM crm.clients c
          JOIN finance.invoices i ON i."clientId" = c.id
          JOIN finance.payments p ON p."invoiceId" = i.id
          WHERE c."sourceLeadId" = led.lead_id AND p.status IN ('PAID', 'PARTIAL')
        ) r ON true`);
      adLeads30 = Number(rows[0]?.leads ?? 0);
      adRevenueBaseCad = Math.round(Number(rows[0]?.revenue_base ?? 0));
    } catch {
      /* revenue join unavailable */
    }

    const blendedCpl =
      adLeads30 > 0 && adSpendBaseCad > 0 ? Math.round((adSpendBaseCad / adLeads30) * 100) / 100 : null;
    const blendedRoas =
      adSpendBaseCad > 0 ? Math.round((adRevenueBaseCad / adSpendBaseCad) * 100) / 100 : null;

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
      revenueReceived,
      revenueWon,
      revenuePipeline,
      lostReasons,
      speedToLead,
      adSpend,
      adSpendBaseCad,
      adRevenueBaseCad,
      blendedCpl,
      blendedRoas,
    };
  }

  /**
   * Per-ad leaderboard: Click-to-WhatsApp attribution → lead funnel. Spend +
   * lead-cohort metrics are scoped to [from, to] (YYYY-MM-DD); when omitted,
   * the window defaults to the trailing 30 days. The Leads/Contacted/Converted
   * volume columns remain all-time.
   */
  async getAdPerformance(opts?: { from?: string; to?: string }) {
    // Parse the window defensively; fall back to a trailing 30 days. `to` is
    // inclusive of its whole day; guard against an inverted range.
    const parse = (s: string | undefined, end: boolean): Date | null => {
      if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
      const d = new Date(`${s}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    let toDate = parse(opts?.to, true) ?? new Date();
    let fromDate = parse(opts?.from, false) ?? new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (fromDate > toDate) [fromDate, toDate] = [toDate, fromDate];

    const rows = await this.prisma.$queryRaw<
      Array<{
        grp: string;
        sourceId: string | null;
        headline: string | null;
        sourceType: string | null;
        sourceUrl: string | null;
        leads: number;
        contacted: number;
        converted: number;
      }>
    >(Prisma.sql`
      SELECT sub.grp                                        AS grp,
             mode() WITHIN GROUP (ORDER BY sub.source_id)   AS "sourceId",
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

    // Meta ad spend per ad over [fromDate, toDate] (native currency + CAD
    // base). Tolerant of the table being absent (pre-migration) or empty.
    type SpendEntry = { byCur: Map<string, number>; baseSpend: number; impressions: number; clicks: number };
    const spendByAd = new Map<string, SpendEntry>();
    try {
      const spendRows = await this.prisma.adSpendDaily.groupBy({
        by: ['adId', 'currency'],
        where: { date: { gte: fromDate, lte: toDate } },
        _sum: { spend: true, baseSpend: true, impressions: true, clicks: true },
      });
      for (const s of spendRows) {
        const entry: SpendEntry =
          spendByAd.get(s.adId) ?? { byCur: new Map<string, number>(), baseSpend: 0, impressions: 0, clicks: 0 };
        entry.byCur.set(s.currency, (entry.byCur.get(s.currency) ?? 0) + Number(s._sum.spend ?? 0));
        entry.baseSpend += Number(s._sum.baseSpend ?? 0);
        entry.impressions += Number(s._sum.impressions ?? 0);
        entry.clicks += Number(s._sum.clicks ?? 0);
        spendByAd.set(s.adId, entry);
      }
    } catch {
      /* ad_spend_daily not migrated yet — leave spend empty */
    }

    // 30-day cohort per ad group: leads acquired in the window (deduped to their
    // latest ad), how many converted, and the received revenue (CAD) from them.
    // These power CPL/CPA/ROAS so the ratios match the 30-day spend window — the
    // all-time leads/contacted/converted columns above stay for volume context.
    const winByGrp = new Map<string, { leads30: number; conv30: number; rev30: number }>();
    try {
      const winRows = await this.prisma.$queryRaw<
        Array<{ grp: string; leads30: number; conv30: number; rev30: number }>
      >(Prisma.sql`
        SELECT led.grp AS grp,
               count(*)::int AS leads30,
               count(*) FILTER (WHERE led.status = 'CONVERTED')::int AS conv30,
               COALESCE(SUM(r.rev_base), 0)::float8 AS rev30
        FROM (
          SELECT DISTINCT ON (l.id)
            l.id AS lead_id,
            l.status::text AS status,
            COALESCE(t."adReferral"->>'source_id', t."adReferral"->>'headline', 'unknown') AS grp
          FROM crm.leads l
          JOIN whatsapp.threads t ON t."leadId" = l.id
          WHERE l."deletedAt" IS NULL AND t."adReferral" IS NOT NULL
            AND COALESCE(t."adReferralAt", l."createdAt") >= ${fromDate}
            AND COALESCE(t."adReferralAt", l."createdAt") <= ${toDate}
          ORDER BY l.id, t."adReferralAt" DESC NULLS LAST
        ) led
        JOIN LATERAL (
          SELECT COALESCE(SUM(p."baseAmount"), 0) AS rev_base
          FROM crm.clients c
          JOIN finance.invoices i ON i."clientId" = c.id
          JOIN finance.payments p ON p."invoiceId" = i.id
          WHERE c."sourceLeadId" = led.lead_id AND p.status IN ('PAID', 'PARTIAL')
        ) r ON true
        GROUP BY led.grp`);
      for (const w of winRows)
        winByGrp.set(w.grp, { leads30: Number(w.leads30), conv30: Number(w.conv30), rev30: Number(w.rev30) });
    } catch {
      /* revenue join unavailable — leave ratios null */
    }

    // Names for ads with spend, so spend-only ads (paid for but no attributed
    // leads in the window) can still display a real ad name.
    const adNameById = new Map<string, string | null>();
    if (spendByAd.size > 0) {
      try {
        const names = await this.prisma.adSpendDaily.findMany({
          where: { adId: { in: [...spendByAd.keys()] } },
          select: { adId: true, adName: true },
          distinct: ['adId'],
        });
        for (const n of names) adNameById.set(n.adId, n.adName);
      } catch {
        /* tolerate */
      }
    }

    const mapped = rows.map((r) => {
      // One consistent key: the SQL group key. Spend is keyed by ad_id, which
      // equals grp exactly when the ad carried a source_id; headline-only groups
      // have no Meta spend to match (spend is keyed on ad_id).
      const grp = r.grp;
      const leads = Number(r.leads); // all-time volume (display)
      const converted = Number(r.converted); // all-time volume (display)
      // 30-day cohort drives the cost ratios so they line up with 30d spend.
      const win = winByGrp.get(grp);
      const leads30 = win?.leads30 ?? 0;
      const conv30 = win?.conv30 ?? 0;
      const rev30 = win?.rev30 ?? 0;

      const sp = spendByAd.get(grp);
      let spend: number | null = null;
      let spendCurrency: string | null = null;
      let baseSpend = 0;
      if (sp) {
        baseSpend = sp.baseSpend;
        const curs = [...sp.byCur.entries()];
        if (curs.length === 1) {
          [spendCurrency, spend] = curs[0];
        } else {
          // Mixed currencies for one ad — never sum across currencies under one
          // label; fall back to the CAD base so CPL/CPA stay single-currency.
          spendCurrency = 'CAD';
          spend = baseSpend;
        }
      }

      const impressions = sp?.impressions ?? null;
      const clicks = sp?.clicks ?? null;

      return {
        sourceId: r.sourceId,
        headline: r.headline,
        sourceType: r.sourceType,
        sourceUrl: r.sourceUrl,
        leads,
        contacted: Number(r.contacted),
        converted,
        // 30-day funnel (matches the spend window).
        leads30,
        spend: spend != null ? Math.round(spend * 100) / 100 : null,
        spendCurrency,
        impressions,
        clicks,
        ctr: impressions && impressions > 0 && clicks != null ? Math.round((clicks / impressions) * 10000) / 100 : null,
        cpc: spend != null && clicks && clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : null,
        revenueBaseCad: Math.round(rev30),
        cpl: spend != null && leads30 > 0 ? Math.round((spend / leads30) * 100) / 100 : null,
        cpa: spend != null && conv30 > 0 ? Math.round((spend / conv30) * 100) / 100 : null,
        roas: baseSpend > 0 ? Math.round((rev30 / baseSpend) * 100) / 100 : null,
      };
    });

    // Ads we PAID for in the window but that brought no attributed leads still
    // belong on a spend view — append them so EVERY ad with spend shows (leads
    // and cost-per-lead null). Keyed by ad_id, the same key spend is stored on.
    const coveredGrps = new Set(rows.map((r) => r.grp));
    const spendOnly = [...spendByAd.entries()]
      .filter(([adId]) => !coveredGrps.has(adId))
      .map(([adId, sp]) => {
        const curs = [...sp.byCur.entries()];
        let spend = sp.baseSpend;
        let spendCurrency: string | null = 'CAD';
        if (curs.length === 1) [spendCurrency, spend] = curs[0];
        return {
          sourceId: adId,
          headline: adNameById.get(adId) ?? null,
          sourceType: 'ad' as string | null,
          sourceUrl: null as string | null,
          leads: 0,
          contacted: 0,
          converted: 0,
          leads30: 0,
          spend: Math.round(spend * 100) / 100,
          spendCurrency,
          impressions: sp.impressions,
          clicks: sp.clicks,
          ctr: sp.impressions > 0 ? Math.round((sp.clicks / sp.impressions) * 10000) / 100 : null,
          cpc: sp.clicks > 0 ? Math.round((spend / sp.clicks) * 100) / 100 : null,
          revenueBaseCad: 0,
          cpl: null as number | null,
          cpa: null as number | null,
          roas: null as number | null,
        };
      });

    return [...mapped, ...spendOnly];
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
    const phoneMatchIds = query.search ? await this.phoneSearchLeadIds(query.search) : [];
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
                ...(phoneMatchIds.length ? [{ id: { in: phoneMatchIds } }] : []),
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
    // Canonicalise the phone to E.164 so a manually-entered local number
    // (e.g. 03xx…) is stored in the SAME format inbound WhatsApp/calls arrive in
    // (+92 3xx…). Without this, an inbound from the customer fails to exact-match
    // the manual lead, spawns a duplicate, and round-robins it to another rep —
    // silently stealing the lead from its creator. International numbers keep
    // their own country code (+1/+44/+971 → their E.164); a bare number defaults
    // to PK (as everywhere else in the system); unparseable input is stored as
    // typed so a create is never blocked.
    const norm = normalisePhone(dto.phone, 'PK');
    const phone = norm.ok && norm.e164 ? norm.e164 : dto.phone;
    await this.ensureUniqueLead(phone, dto.email);
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
        phone,
        alternatePhone: dto.alternatePhone,
        nationality: dto.nationality,
        targetCountry: dto.targetCountry,
        serviceInterest: dto.serviceInterest,
        sourceChannel: dto.sourceChannel,
        referralPartnerId: dto.referralPartnerId,
        status: dto.status ?? LeadStatus.NEW,
        ...(dto.priority ? { priority: dto.priority } : {}),
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
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.alternatePhone !== undefined && { alternatePhone: dto.alternatePhone }),
        ...(dto.nationality !== undefined && { nationality: dto.nationality }),
        ...(dto.targetCountry !== undefined && { targetCountry: dto.targetCountry }),
        ...(dto.serviceInterest !== undefined && { serviceInterest: dto.serviceInterest }),
        ...(dto.sourceChannel !== undefined && { sourceChannel: dto.sourceChannel }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
        ...(dto.assignedEmployeeId !== undefined && { assignedEmployeeId: dto.assignedEmployeeId }),
        ...(dto.referralPartnerId !== undefined && { referralPartnerId: dto.referralPartnerId }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.lostReason !== undefined && { lostReason: dto.lostReason }),
        ...(dto.serviceFeeAmount !== undefined && { serviceFeeAmount: new Prisma.Decimal(dto.serviceFeeAmount) }),
        ...(dto.serviceFeeCurrency !== undefined && { serviceFeeCurrency: dto.serviceFeeCurrency }),
        ...emailVerificationReset,
        convertedAt: dto.status === LeadStatus.CONVERTED ? new Date() : undefined,
        // Stamp lostAt when the lead is marked LOST; clear it if it's revived to
        // any other status. Untouched when the update doesn't change status.
        lostAt:
          dto.status === LeadStatus.LOST
            ? new Date()
            : dto.status
              ? null
              : undefined,
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

    // A converted lead has already been COPIED into a Client, and downstream
    // (Processing) renders the CLIENT — so a rename here would otherwise never
    // surface there (the lead read "Muhammad Shahbaz" while the case still said
    // "Ak Khan"). Propagate the corrected name to that client.
    //
    // GUARDED: only when the client still carries the lead's OLD name, i.e. it
    // is an untouched copy from conversion. If the client was corrected
    // independently — via clients.update, or the passport auto-fill in
    // crm-auto-fill.helper which writes firstName/lastName off the real
    // document — that name is more authoritative than a sales-entered lead, so
    // leave it alone. Best-effort: the lead update has already committed, so a
    // sync failure must never fail the request.
    if (
      existing.convertedClientId &&
      (updated.firstName !== existing.firstName || updated.lastName !== existing.lastName)
    ) {
      try {
        const client = await this.prisma.client.findUnique({
          where: { id: existing.convertedClientId },
          select: { id: true, firstName: true, lastName: true },
        });
        if (
          client &&
          client.firstName === existing.firstName &&
          client.lastName === existing.lastName
        ) {
          await this.prisma.client.update({
            where: { id: client.id },
            data: { firstName: updated.firstName, lastName: updated.lastName },
          });
          this.logger.log(
            `Lead ${id} renamed — synced client ${client.id}: "${existing.firstName} ${existing.lastName}" → "${updated.firstName} ${updated.lastName}"`,
          );
        } else if (client) {
          this.logger.log(
            `Lead ${id} renamed but client ${client.id} keeps its own name ("${client.firstName} ${client.lastName}") — not overwritten.`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Client name sync failed for lead ${id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

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

    // Semantic audit events for terminal status transitions, so "marked lost"
    // and "marked duplicate" are first-class in the audit trail rather than
    // buried inside a generic LEAD_UPDATED diff.
    if (dto.status && dto.status !== existing.status) {
      const semanticAction =
        dto.status === LeadStatus.LOST
          ? AuditAction.LEAD_LOST
          : dto.status === LeadStatus.DUPLICATE
            ? AuditAction.LEAD_DUPLICATE_MARKED
            : null;
      if (semanticAction) {
        await this.auditLog.log({
          actorUserId,
          action: semanticAction,
          entityType: 'Lead',
          entityId: id,
          oldValues: { status: existing.status },
          newValues: { status: dto.status },
        });
      }
    }

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

    // Common WHERE — applied to every lead count below so admin sees org-wide,
    // a rep sees their own book. Empty result for an agent without an employee
    // row (would be a config error, but we no-op cleanly).
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
    // Scope MUST match the /sales/leads list (findAllAccessible) exactly so the
    // dashboard tiles and the leads page agree: a non-admin sees leads assigned
    // to them OR created by them (e.g. front-desk staff who entered/imported
    // them), not just the ones currently assigned to them.
    const scope: Prisma.LeadWhereInput = canViewAll
      ? {}
      : { OR: [{ assignedEmployee: { userId: user.id } }, { createdByUserId: user.id }] };

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const [
      active,
      handovers,
      sourceAll,
      sourceToday,
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
      // Admin vs Auto-CRM split by sourceChannel — SAME classification the
      // /sales/leads page uses (deriveAssignmentType), so the dashboard tiles
      // match it exactly. groupBy keeps it to one round-trip (a few dozen
      // distinct channel values) instead of loading every lead.
      this.prisma.lead.groupBy({
        by: ['sourceChannel'],
        where: { ...scope, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ['sourceChannel'],
        where: { ...scope, deletedAt: null, createdAt: { gte: startOfToday } },
        _count: { _all: true },
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

    // Classify each sourceChannel as Auto-CRM (auto-captured digital inflow) vs
    // Admin (manual entry / CSV import / blank) — the SAME rule the leads list
    // uses (deriveAssignmentType), so the dashboard tiles match /sales/leads.
    const AUTO_CRM_SOURCE_KEYWORDS = ['whatsapp', 'meta', 'facebook', 'instagram', 'web', 'uan', 'phone', 'call'];
    const splitBySource = (rows: Array<{ sourceChannel: string | null; _count: { _all: number } }>) => {
      let auto = 0;
      let admin = 0;
      for (const r of rows) {
        const v = (r.sourceChannel ?? '').toLowerCase().trim();
        if (v.length > 0 && AUTO_CRM_SOURCE_KEYWORDS.some((k) => v.includes(k))) auto += r._count._all;
        else admin += r._count._all;
      }
      return { auto, admin };
    };
    const allSplit = splitBySource(sourceAll);
    const todaySplit = splitBySource(sourceToday);

    return {
      activeLeads: active,
      handovers,
      adminAssigned: allSplit.admin,
      autoAssigned: allSplit.auto,
      adminToday: todaySplit.admin,
      autoToday: todaySplit.auto,
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
  /**
   * Set the sales DISPOSITION on a lead — the rep's call-outcome tag, SEPARATE
   * from the pipeline `status` (which reports/finance/routing depend on and this
   * NEVER touches). Persists the denormalized latest on the lead, appends an
   * immutable history row (who + when), and — for FOLLOW_UP / CONTACT_LATER with
   * a `reminderAt` — creates a FollowUp so the existing ReminderDispatcher fires
   * an on-time reminder. Scoped via assertLeadAccess (rep = own leads).
   */
  async setDisposition(
    id: string,
    dto: { disposition: LeadDisposition; note?: string; reminderAt?: string },
    user: RequestUser,
  ) {
    await this.assertLeadAccess(id, user);
    const disposition = dto.disposition;
    const note = dto.note?.trim() || null;
    const now = new Date();

    // Denormalized latest + immutable history row, atomically.
    const [updated] = await this.prisma.$transaction([
      this.prisma.lead.update({
        where: { id },
        data: { disposition, dispositionAt: now, dispositionByUserId: user.id },
        select: { id: true, disposition: true, dispositionAt: true, assignedEmployeeId: true },
      }),
      this.prisma.leadDispositionHistory.create({
        data: { leadId: id, disposition, note, byUserId: user.id },
      }),
    ]);

    // Reminder: only FOLLOW_UP / CONTACT_LATER carry one. Reuse the FollowUp +
    // ReminderDispatcher path (a FollowUp with dueAt is reconciled into an
    // on-time notification) rather than a parallel reminder system.
    let followUpId: string | null = null;
    const wantsReminder =
      disposition === LeadDisposition.FOLLOW_UP || disposition === LeadDisposition.CONTACT_LATER;
    if (dto.reminderAt && wantsReminder) {
      const dueAt = new Date(dto.reminderAt);
      if (!Number.isNaN(dueAt.getTime())) {
        const assignedEmployeeId =
          updated.assignedEmployeeId ?? (await this.findEmployeeIdByUserId(user.id));
        // The ReminderDispatcher only materializes follow-ups that HAVE an
        // assignee (it filters assignedEmployeeId != null), so a null-assignee
        // follow-up would be a silent no-op reminder. Only create one we can
        // actually deliver; otherwise leave followUpId null (no false promise).
        if (assignedEmployeeId) {
          const label = disposition === LeadDisposition.CONTACT_LATER ? 'Contact later' : 'Follow up';
          const fu = await this.prisma.followUp.create({
            data: {
              leadId: id,
              assignedEmployeeId,
              createdByUserId: user.id,
              title: note ? `${label}: ${note.slice(0, 140)}` : label,
              dueAt,
              status: 'OPEN',
            },
            select: { id: true },
          });
          followUpId = fu.id;
        }
      }
    }

    // A lead marked JUNK / DEAD is out of play — cancel any OPEN follow-ups so a
    // stale reminder can't fire on a dead lead and so the "Due" surfaces don't
    // keep counting it. (Best-effort; never blocks the disposition write.)
    if (disposition === LeadDisposition.JUNK || disposition === LeadDisposition.DEAD) {
      await this.prisma.followUp
        .updateMany({ where: { leadId: id, status: 'OPEN' }, data: { status: 'CANCELLED' } })
        .catch(() => undefined);
    }

    // Audit + timeline (reuse LEAD_UPDATED; metadata.kind='disposition' keeps it
    // distinct from a pipeline status change in the activity feed).
    await this.auditLog.log({
      actorUserId: user.id,
      action: AuditAction.LEAD_UPDATED,
      entityType: 'Lead',
      entityId: id,
      newValues: { disposition, reminderAt: dto.reminderAt ?? null },
    });
    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: id,
      leadId: id,
      eventType: TimelineEventType.LEAD_UPDATED,
      description: `Disposition set to "${disposition.replace(/_/g, ' ').toLowerCase()}"`,
      actorUserId: user.id,
      metadata: { kind: 'disposition', disposition, note, followUpId },
    });

    return { ...updated, followUpId };
  }

  /**
   * Full disposition history for a lead (who + when, most recent first),
   * actor names resolved. Scoped via assertLeadAccess.
   */
  async getDispositionHistory(id: string, user: RequestUser) {
    await this.assertLeadAccess(id, user);
    const rows = await this.prisma.leadDispositionHistory.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, disposition: true, note: true, byUserId: true, createdAt: true },
    });
    // byUserId is a UserAccount id; the display name lives on the linked Employee.
    const actorIds = Array.from(new Set(rows.map((r) => r.byUserId)));
    const actors = actorIds.length
      ? await this.prisma.userAccount.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, employee: { select: { firstName: true, lastName: true } } },
        })
      : [];
    const nameById = new Map(
      actors.map((a) => [
        a.id,
        a.employee ? `${a.employee.firstName} ${a.employee.lastName}`.trim() || null : null,
      ]),
    );
    return rows.map((r) => ({
      id: r.id,
      disposition: r.disposition,
      note: r.note,
      at: r.createdAt,
      byName: nameById.get(r.byUserId) ?? null,
    }));
  }

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

    await this.auditLog.log({
      actorUserId: user.id,
      action: AuditAction.LEAD_FILE_UPLOADED,
      entityType: 'LeadFile',
      entityId: created.id,
      metadata: {
        leadId,
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

    await this.auditLog.log({
      actorUserId: user.id,
      action: AuditAction.LEAD_FILE_DELETED,
      entityType: 'LeadFile',
      entityId: record.id,
      metadata: { leadId, fileName: record.fileName },
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