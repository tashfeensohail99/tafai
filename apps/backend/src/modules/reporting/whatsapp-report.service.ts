import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Pakistan Standard Time is a fixed UTC+5 (no DST). */
export const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
/** Per-rep cap on the awaiting-contact list so a heavy month can't bloat the
 *  payload/email. A rep's TRUE awaiting count always comes from the summary
 *  query (uncapped); awaitingTruncated flags when any rep exceeds this. */
const PER_REP_AWAITING_CAP = 100;

export type ReportPeriod = 'daily' | 'weekly' | 'monthly';

export interface RepActivity {
  employeeId: string | null;
  name: string;
  texted: number; // distinct contacts who sent an inbound in the window
  replied: number; // of those, how many got a HUMAN reply in the window
  replyPct: number;
  newContacts: number; // contacts whose first-ever inbound was in the window
  newReplied: number;
  oldContacts: number; // existing contacts (first inbound before the window)
  oldReplied: number;
  awaiting: number; // texted − replied (messaged, no human reply yet)
}

export interface AwaitingContact {
  employeeId: string | null;
  repName: string;
  contact: string | null;
  phone: string | null;
  lastInboundAt: string | null; // ISO
  isOld: boolean; // true = existing contact (re-engaged), false = brand-new
}

export interface ActivityReport {
  from: string; // ISO
  to: string; // ISO
  totals: Omit<RepActivity, 'employeeId' | 'name'>;
  reps: RepActivity[];
  awaitingContacts: AwaitingContact[];
  awaitingTruncated: boolean;
}

interface SummaryRow {
  emp: string | null;
  texted: number;
  replied: number;
  newc: number;
  new_replied: number;
}
interface DetailRow {
  emp: string | null;
  contact: string | null;
  phone: string | null;
  last_inb: Date | null;
  is_old: boolean;
}

/**
 * Per-salesperson WhatsApp activity for an arbitrary window. Human replies only
 * (the bot leaves `sentByEmployeeId` null, so it never counts as a reply).
 * Conversations are attributed to the rep the lead/client is assigned to —
 * threads carry no rep of their own. Powers both the 8 AM daily email and the
 * admin Daily/Weekly/Monthly panel, so the numbers are guaranteed identical.
 */
@Injectable()
export class WhatsAppReportService {
  constructor(private readonly prisma: PrismaService) {}

  /** UTC instant of PKT-midnight `daysAgo` days before today. */
  pktMidnightUtc(daysAgo: number): Date {
    const pktNow = new Date(Date.now() + PKT_OFFSET_MS);
    return new Date(
      Date.UTC(pktNow.getUTCFullYear(), pktNow.getUTCMonth(), pktNow.getUTCDate() - daysAgo) - PKT_OFFSET_MS,
    );
  }

  /** PKT calendar date (YYYY-MM-DD) `daysAgo` days before today. */
  pktDateString(daysAgo: number): string {
    const pktNow = new Date(Date.now() + PKT_OFFSET_MS);
    return new Date(Date.UTC(pktNow.getUTCFullYear(), pktNow.getUTCMonth(), pktNow.getUTCDate() - daysAgo))
      .toISOString()
      .slice(0, 10);
  }

  /** Rolling PKT window for a named period, ending "now". */
  windowFor(period: ReportPeriod): { from: Date; to: Date; label: string } {
    const to = new Date();
    if (period === 'weekly') return { from: this.pktMidnightUtc(6), to, label: 'Last 7 days' };
    if (period === 'monthly') return { from: this.pktMidnightUtc(29), to, label: 'Last 30 days' };
    return { from: this.pktMidnightUtc(0), to, label: 'Today' };
  }

  async computeActivity(from: Date, to: Date): Promise<ActivityReport> {
    const summary = await this.prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      WITH msg AS (
        SELECT m."threadId" AS tid,
               count(*) FILTER (WHERE m.direction = 'INBOUND') AS inb,
               count(*) FILTER (WHERE m.direction = 'OUTBOUND' AND m."sentByEmployeeId" IS NOT NULL) AS humrep
        FROM whatsapp.messages m
        WHERE m."createdAt" >= ${from} AND m."createdAt" < ${to}
        GROUP BY m."threadId"
      )
      SELECT COALESCE(l."assignedEmployeeId", c."assignedEmployeeId") AS emp,
             count(*) FILTER (WHERE msg.inb > 0)::int AS texted,
             count(*) FILTER (WHERE msg.inb > 0 AND msg.humrep > 0)::int AS replied,
             count(*) FILTER (WHERE t."firstInboundAt" >= ${from} AND t."firstInboundAt" < ${to})::int AS newc,
             count(*) FILTER (WHERE t."firstInboundAt" >= ${from} AND t."firstInboundAt" < ${to} AND msg.humrep > 0)::int AS new_replied
      FROM whatsapp.threads t
      JOIN msg ON msg.tid = t.id
      LEFT JOIN crm.leads l ON l.id = t."leadId"
      LEFT JOIN crm.clients c ON c.id = t."clientId"
      WHERE (l.id IS NULL OR (l."deletedAt" IS NULL AND l."blockedAt" IS NULL))
        AND (c.id IS NULL OR c."deletedAt" IS NULL)
      GROUP BY COALESCE(l."assignedEmployeeId", c."assignedEmployeeId")`);

    // Awaiting list: contacts who messaged in the window and got NO human reply
    // IN THE WINDOW. NB: "replied" is strictly intra-window, so a customer
    // answered just after midnight (next PKT day) is, by design, listed as
    // awaiting for the day they wrote in — matching the leaderboard's same-day
    // definition. Capped PER REP via row_number so one heavy rep can't dominate.
    const detail = await this.prisma.$queryRaw<DetailRow[]>(Prisma.sql`
      WITH msg AS (
        SELECT m."threadId" AS tid,
               count(*) FILTER (WHERE m.direction = 'INBOUND') AS inb,
               count(*) FILTER (WHERE m.direction = 'OUTBOUND' AND m."sentByEmployeeId" IS NOT NULL) AS humrep,
               max(m."createdAt") FILTER (WHERE m.direction = 'INBOUND') AS last_inb
        FROM whatsapp.messages m
        WHERE m."createdAt" >= ${from} AND m."createdAt" < ${to}
        GROUP BY m."threadId"
      ),
      det AS (
        SELECT COALESCE(l."assignedEmployeeId", c."assignedEmployeeId") AS emp,
               NULLIF(TRIM(COALESCE(l."firstName" || ' ' || l."lastName",
                                    c."firstName" || ' ' || c."lastName", '')), '') AS contact,
               COALESCE(l."phone", c."phone", t."waContactId") AS phone,
               msg.last_inb AS last_inb,
               (t."firstInboundAt" < ${from} OR t."firstInboundAt" IS NULL) AS is_old
        FROM whatsapp.threads t
        JOIN msg ON msg.tid = t.id
        LEFT JOIN crm.leads l ON l.id = t."leadId"
        LEFT JOIN crm.clients c ON c.id = t."clientId"
        WHERE msg.inb > 0 AND msg.humrep = 0
          AND (l.id IS NULL OR (l."deletedAt" IS NULL AND l."blockedAt" IS NULL))
          AND (c.id IS NULL OR c."deletedAt" IS NULL)
      )
      SELECT emp, contact, phone, last_inb, is_old
      FROM (
        SELECT det.*, row_number() OVER (PARTITION BY emp ORDER BY is_old DESC, last_inb DESC NULLS LAST) AS rn
        FROM det
      ) ranked
      WHERE rn <= ${PER_REP_AWAITING_CAP}
      ORDER BY emp, is_old DESC, last_inb DESC NULLS LAST`);

    // Resolve rep display names in one query.
    const ids = [...new Set([...summary, ...detail].map((r) => r.emp).filter((x): x is string => !!x))];
    const emps = ids.length
      ? await this.prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const nameById = new Map(emps.map((e) => [e.id, `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || e.id.slice(0, 8)]));
    const repName = (id: string | null) => (id ? nameById.get(id) ?? id.slice(0, 8) : '— Unassigned');
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

    const reps: RepActivity[] = summary
      .map((r) => {
        const oldContacts = r.texted - r.newc;
        const oldReplied = r.replied - r.new_replied;
        return {
          employeeId: r.emp,
          name: repName(r.emp),
          texted: r.texted,
          replied: r.replied,
          replyPct: pct(r.replied, r.texted),
          newContacts: r.newc,
          newReplied: r.new_replied,
          oldContacts,
          oldReplied,
          awaiting: r.texted - r.replied,
        };
      })
      .sort((a, b) => b.awaiting - a.awaiting || b.texted - a.texted);

    const totalsAgg = reps.reduce(
      (a, r) => ({
        texted: a.texted + r.texted,
        replied: a.replied + r.replied,
        newContacts: a.newContacts + r.newContacts,
        newReplied: a.newReplied + r.newReplied,
        oldContacts: a.oldContacts + r.oldContacts,
        oldReplied: a.oldReplied + r.oldReplied,
        awaiting: a.awaiting + r.awaiting,
      }),
      { texted: 0, replied: 0, newContacts: 0, newReplied: 0, oldContacts: 0, oldReplied: 0, awaiting: 0 },
    );

    // A rep's true awaiting count is rep.awaiting (summary, uncapped); the list
    // is capped per rep, so it's truncated whenever any rep exceeds the cap.
    const awaitingTruncated = reps.some((r) => r.awaiting > PER_REP_AWAITING_CAP);
    const awaitingContacts: AwaitingContact[] = detail.map((d) => ({
      employeeId: d.emp,
      repName: repName(d.emp),
      contact: d.contact,
      phone: d.phone,
      lastInboundAt: d.last_inb ? new Date(d.last_inb).toISOString() : null,
      isOld: Boolean(d.is_old),
    }));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totals: { ...totalsAgg, replyPct: pct(totalsAgg.replied, totalsAgg.texted) },
      reps,
      awaitingContacts,
      awaitingTruncated,
    };
  }
}
