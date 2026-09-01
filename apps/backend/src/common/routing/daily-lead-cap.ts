/**
 * Per-rep DAILY new-lead cap. An admin can wind a rep down to at most N fresh
 * leads per day (e.g. easing someone back in after a pause) WITHOUT fully
 * pausing them — unlike `presenceLocked`, a capped rep still receives leads,
 * just no more than their cap. `Employee.dailyLeadCap = null` means unlimited.
 *
 * Shared by BOTH assignment engines (the live WhatsApp/Messenger engine and the
 * async CSV/Meta engine) so the cap can't be bypassed through one of them.
 */

/**
 * Pakistan Standard Time is a fixed UTC+5 (no DST since 2009). Returns the UTC
 * instant of Karachi-local midnight for the day containing `now` — the quota
 * window resets at local midnight regardless of server timezone. Mirrors the
 * explicit-offset convention in appointments.util (pktWorkingWindowUtc).
 */
export function startOfPktDayUtc(now: Date = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // "YYYY-MM-DD" in PKT
  return new Date(`${ymd}T00:00:00+05:00`);
}

/** Row shape we read back from the grouped COUNT below. */
type LeadCountRow = { assignedEmployeeId: string | null; _count: number };

/** Any Prisma surface with `.lead.groupBy` — a PrismaService OR a `$transaction`
 *  client. Typed loose on purpose: Prisma's generated groupBy is a heavily
 *  overloaded generic, so a precise structural type here fights strict variance
 *  for no benefit in an internal helper. The result is annotated explicitly. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LeadGroupByClient = { lead: { groupBy: (args: any) => Promise<unknown> } };

/**
 * The subset of the eligible pool that has ALREADY hit its per-rep daily cap for
 * the current PKT day, so the round-robin can drop them from NEW-lead picks.
 *
 * - Reps with a null cap are unlimited and never returned.
 * - Runs ONE grouped COUNT, and only when at least one rep in the pool actually
 *   has a cap — so the common all-uncapped case adds zero queries to the hot path.
 * - "New leads today" = leads CURRENTLY assigned to the rep whose
 *   `createdAt >= PKT-midnight` — i.e. leads that ARRIVED today and are hers now.
 *   The lead being routed isn't yet assigned, so it isn't counted — a rep at N-1
 *   still gets exactly one more, reaching N. Two deliberate semantic edges:
 *     • Point-in-time holdings, not cumulative receipts: if a lead is later
 *       reassigned AWAY from the rep, her count drops and she can receive another
 *       — so heavy admin reassignment churn can let her exceed N in a day. Fine
 *       for the "ease a rep back in" intent; it is not a billing-grade hard cap.
 *     • Keyed on `createdAt`, not assignment time (there is no assignedAt column):
 *       it throttles leads that AROSE today (the CTWA/inbound flow the cap is for);
 *       a backlog of OLD unassigned leads drained today does not count against it.
 * - EXISTING chats are unaffected: the caller keeps a lead with its current
 *   still-eligible owner before this is ever consulted.
 *
 * Soft cap: under a burst of simultaneous inbounds (webhook worker concurrency),
 * several may all read N-1 before any commits, so a rep can end up to
 * +(concurrency-1) over on a busy instant. Still bounded, never a crash, and the
 * cap is never ignored — the intent is throttling proactive distribution, not
 * billing-grade enforcement.
 */
export async function cappedOutEmployeeIds(
  db: LeadGroupByClient,
  eligible: ReadonlyArray<{ id: string; dailyLeadCap: number | null }>,
  now: Date = new Date(),
): Promise<Set<string>> {
  const capped = eligible.filter((e) => e.dailyLeadCap != null && e.dailyLeadCap >= 0);
  if (capped.length === 0) return new Set();
  const since = startOfPktDayUtc(now);
  const rows = (await db.lead.groupBy({
    by: ['assignedEmployeeId'],
    where: {
      assignedEmployeeId: { in: capped.map((e) => e.id) },
      createdAt: { gte: since },
      deletedAt: null,
    },
    _count: true,
  })) as LeadCountRow[];
  const todays = new Map<string, number>();
  for (const r of rows) if (r.assignedEmployeeId) todays.set(r.assignedEmployeeId, r._count);
  const out = new Set<string>();
  for (const e of capped) {
    if ((todays.get(e.id) ?? 0) >= (e.dailyLeadCap as number)) out.add(e.id);
  }
  return out;
}
