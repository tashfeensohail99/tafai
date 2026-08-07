import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LeadDisposition, WhatsAppAssignmentReason, type Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WhatsAppMetaClientFactory } from '../meta/client.factory';

/**
 * A ~120-char window of `text` centered on the first case-insensitive
 * occurrence of `q`, with ellipses when clipped. Powers the "found in message"
 * snippet for content search so a rep sees WHY a chat matched. Never throws on
 * odd input (empty/short/no-match) — falls back to the head of the text.
 */
function snippetAround(text: string, q: string, radius = 55): string {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + q.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

interface ThreadListOptions {
  status?: 'OPEN' | 'PENDING' | 'RESOLVED' | 'ARCHIVED';
  assignedToMe?: boolean;
  unassigned?: boolean;
  /**
   * "SLA clock is running on the agent" filter — `responseDeadlineAt` is set
   * when a customer message is awaiting an agent reply. This is what the
   * inbox "Pending" tab actually means (the WhatsAppThreadStatus PENDING
   * value is never written anywhere, so a literal status filter is dead).
   */
  needsReply?: boolean;
  /**
   * "Uncontacted" tab — pending threads where NO human has ever replied
   * (awaitingReply=true AND lastHumanReplyAt IS NULL). The bot greeting doesn't
   * count, so these are leads still awaiting a salesperson's first reply.
   */
  uncontacted?: boolean;
  /**
   * "Open" tab — the complement of Uncontacted: threads where a human HAS
   * replied at least once (lastHumanReplyAt IS NOT NULL). Live, being-handled
   * conversations. Open + Uncontacted partition every chat.
   */
  contacted?: boolean;
  /**
   * "Due follow-ups" filter — only threads whose lead has an OPEN CRM follow-up
   * that is due or overdue (dueAt <= now). Powers the inbox "Due (N)" chip so a
   * rep can pull up exactly the chats that need a scheduled follow-up today,
   * regardless of the active tab.
   */
  followUpDue?: boolean;
  /** Admin filter: only threads whose lead is assigned to this employee. */
  employeeId?: string;
  /**
   * "Archived" filter — show ONLY archived threads (status=ARCHIVED). When set
   * the default exclusion of archived threads is lifted for this list.
   */
  archived?: boolean;
  /**
   * "Blocked" filter — show ONLY threads whose contact (lead OR client) is
   * blocked (blockedAt set). When set the default exclusion of blocked threads
   * is lifted for this list.
   */
  blocked?: boolean;
  /**
   * "Unread" chip — threads with unreadCount > 0 (rep hasn't opened them since
   * the last inbound). Literal WhatsApp unread; opening clears it (markRead).
   * Server-side kill-switch: WA_UNREAD_FILTER_ENABLED=false makes it a no-op.
   */
  unread?: boolean;
  /**
   * "Disposition" filter (inbox funnel) — only threads whose LEAD carries this
   * sales disposition. Client-only threads never match (disposition is lead-
   * only). Stacks with the tab/search filters. When set to JUNK or DEAD it also
   * lifts the default active-inbox hygiene that normally hides those, so a rep
   * can deliberately pull up their Junk/Dead pile.
   */
  disposition?: LeadDisposition;
  search?: string;
  limit?: number;
  cursor?: string;
}

interface CallerContext {
  userId: string;
  employeeId: string | null;
  /** Whether the caller is allowed to see threads not assigned to them. */
  canViewAll: boolean;
  /**
   * Finance closed-loop scope: caller may see threads only for leads
   * where Sales has already sent an agreement (status != DRAFT). Narrower
   * than `canViewAll` — pre-agreement Sales negotiations stay private.
   * Implies the caller is NEVER part of the round-robin assignment pool.
   */
  canViewFinanceScope: boolean;
  /**
   * Processing closed-loop scope: caller may open threads for leads/clients
   * that have a ProcessingCase (i.e. the client reached processing). Lets the
   * processing team use the WhatsApp chat for their own clients without
   * full-inbox access. Additive — never widens Sales/Finance scope.
   */
  canViewProcessingScope: boolean;
}

/**
 * Relations selected for a thread-list row. Hoisted to a shared constant so
 * the single-row endpoint (getListItem) returns a row IDENTICAL in shape to
 * the rows list() returns — the realtime "patch one row" path splices these
 * straight into the same array, so any shape drift would corrupt the list.
 * Change the list shape by changing only this.
 */
const THREAD_LIST_INCLUDE = {
  channel: { select: { id: true, label: true, displayNumber: true } },
  lead: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      status: true,
      // Sales disposition (call-outcome tag) — surfaced in the chat panel so the
      // rep sees + updates the current disposition without leaving the chat.
      disposition: true,
      dispositionAt: true,
      assignedEmployeeId: true,
      assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
      // Most-recent CSV import touch — drives the CSV LEAD badge on the
      // thread row in the WhatsApp inbox. Tooltip uses batch.name.
      importRows: {
        where: { outcome: { in: ['IMPORTED', 'DUPLICATE'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          batch: { select: { id: true, batchNumber: true, name: true } },
        },
      },
    },
  },
  client: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      status: true,
      // A converted contact's thread has no lead, so the inbox row's "assigned
      // to" must fall back to the client's owner (set by a client-thread
      // reassign) — otherwise it shows "Unassigned" despite having an owner.
      assignedEmployeeId: true,
      assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.WhatsAppThreadInclude;

/**
 * Null-safe "this thread's lead is NOT dispositioned JUNK/DEAD" filter.
 *
 * A plain `NOT { lead: { is: { disposition: { in: [JUNK, DEAD] } } } }` is
 * WRONG on this NULLABLE to-one relation: against real data Prisma translates
 * the negated `is` in a way that ALSO excludes every thread whose lead has a
 * NULL disposition — i.e. virtually the entire inbox (a JUNK/DEAD disposition
 * is rare; NULL is the norm). That silently emptied the inbox to only the
 * handful of lead-less (client-only) threads.
 *
 * Express the intent positively instead: KEEP a thread when it has no lead, OR
 * its lead has no disposition, OR its lead's disposition is anything other than
 * JUNK/DEAD. Each branch is a positive match, so NULLs are handled explicitly.
 */
const LEAD_NOT_JUNK_OR_DEAD: Prisma.WhatsAppThreadWhereInput = {
  OR: [
    { leadId: null },
    { lead: { is: { disposition: null } } },
    {
      lead: {
        is: { disposition: { notIn: [LeadDisposition.JUNK, LeadDisposition.DEAD] } },
      },
    },
  ],
};

/**
 * Read-side API for WhatsApp threads — what the inbox UI calls.
 *
 * Access rules:
 *   - "agent" (has whatsapp.view_inbox only): only threads whose
 *     Lead.assignedEmployeeId = caller's employee.
 *   - "finance" (has whatsapp.view_finance_scope): only threads whose
 *     lead has a non-DRAFT agreement on file (closed-loop comms).
 *   - "manager/admin" (has whatsapp.view_all_inboxes): every thread in
 *     the org.
 *
 * Lead-rooted and client-rooted threads are both returned; the caller-side
 * filter on "my assigned" walks via Lead.assignedEmployeeId. After a
 * lead→client conversion the thread keeps its leadId, so the same agent
 * keeps seeing the chat history.
 */
@Injectable()
export class WhatsAppThreadsService {
  constructor(
    private readonly prisma: PrismaService,
    // Injected to ack inbound messages read to Meta on thread-open (blue ticks).
    // Available app-wide because WhatsAppMetaModule is @Global.
    private readonly metaFactory: WhatsAppMetaClientFactory,
  ) {}

  /**
   * Distinct lead ids that currently have at least one non-DRAFT agreement
   * on file — i.e. Sales has submitted the agreement to Finance. Used to
   * scope the WhatsApp inbox for finance-role callers (see `canViewFinanceScope`).
   *
   * Agreement.leadId is declared without a Prisma FK relation (kept
   * decoupled per the schema's note), so we pre-resolve the id set here
   * rather than using a nested relation filter on `lead`.
   */
  private async eligibleLeadIdsForFinance(): Promise<string[]> {
    const rows = await this.prisma.agreement.findMany({
      where: { status: { not: 'DRAFT' }, deletedAt: null },
      select: { leadId: true },
      distinct: ['leadId'],
    });
    return rows.map((r) => r.leadId);
  }

  async list(caller: CallerContext, opts: ThreadListOptions = {}) {
    // Default 100 (bumped from 30) so agents see their full inbox without
    // having to scroll/page; the DTO caps at 100 anyway.
    const limit = Math.min(opts.limit ?? 100, 100);

    const where: Prisma.WhatsAppThreadWhereInput = {};
    if (opts.status) where.status = opts.status;

    // Compound conditions are collected in an AND array so they COMPOSE rather
    // than clobber each other. The soft-delete guard and the search filter both
    // want an `OR`; assigning `where.OR` twice silently dropped the first —
    // which let an admin search surface threads of soft-deleted leads. Keeping
    // each as its own AND entry guarantees the delete guard always applies.
    const and: Prisma.WhatsAppThreadWhereInput[] = [];

    // Hide threads whose lead has been soft-deleted (admin deletes a lead
    // or a whole CSV import batch → the lead's row stays in the DB but
    // gets deletedAt stamped, so the inbox should drop the thread). We use
    // `OR` so we don't accidentally hide threads that have a client but no
    // lead — those still show up.
    and.push({ OR: [{ lead: { is: { deletedAt: null } } }, { lead: null }] });

    // Scope to caller's assigned leads unless they're allowed to see all
    // AND haven't explicitly asked for "mine only".
    if ((!caller.canViewAll && !caller.canViewFinanceScope) || opts.assignedToMe) {
      if (!caller.employeeId) {
        // A user with whatsapp.view_inbox but no Employee row — return nothing
        // rather than throw, so the UI doesn't break.
        return { items: [], nextCursor: null };
      }
      // Rep inbox: their assigned LEADS, plus (for converted contacts) their
      // assigned CLIENTS — a client thread can now be routed to a rep via
      // reassign, so it must surface here too. Pushed as AND-of-OR so it
      // composes with the other filters (the client branch can't be expressed
      // by the single `where.lead` the lead-only path used).
      and.push({
        OR: [
          { lead: { assignedEmployeeId: caller.employeeId, deletedAt: null } },
          // Lead-less client thread assigned to this rep. `leadId: null` keeps a
          // dual-linked thread scoped by its lead alone (matches getOrFail +
          // reassign); `deletedAt: null` drops soft-deleted clients like the
          // lead guard above.
          { leadId: null, client: { assignedEmployeeId: caller.employeeId, deletedAt: null } },
        ],
      });
    } else if (caller.canViewFinanceScope) {
      // Finance closed-loop scope — only threads whose lead has a
      // non-DRAFT agreement on file (i.e., Sales has sent it to Finance).
      // Pre-agreement Sales conversations stay private to Sales.
      // Note: Agreement.leadId has no Prisma FK relation (decoupled by
      // design), so we pre-resolve the eligible lead-id set instead of
      // using a nested relation filter.
      const eligibleLeadIds = await this.eligibleLeadIdsForFinance();
      if (eligibleLeadIds.length === 0) return { items: [], nextCursor: null };
      where.lead = { id: { in: eligibleLeadIds }, deletedAt: null };
    } else if (opts.unassigned) {
      // Admin-only filter — only meaningful when canViewAll is true.
      where.lead = { assignedEmployeeId: null, deletedAt: null };
    } else if (opts.employeeId) {
      // Admin-only filter — show only one agent's conversations.
      where.lead = { assignedEmployeeId: opts.employeeId, deletedAt: null };
    }

    if (opts.needsReply) {
      // "Pending" tab = FOLLOW-UPS only: awaiting a human reply AND a human has
      // replied at least once before (lastHumanReplyAt != null). The chats no
      // human has ever touched live in the separate "Uncontacted" tab below, so
      // Pending and Uncontacted are now MUTUALLY EXCLUSIVE — a chat is in
      // exactly one. (awaitingReply is stamped true on every inbound and false
      // only on a manual human send; bot/auto/templates never clear it.)
      and.push({ awaitingReply: true, lastHumanReplyAt: { not: null } });
    }

    if (opts.uncontacted) {
      // "Uncontacted" tab: NO human has EVER replied (lastHumanReplyAt IS NULL),
      // across ALL chats — the AI bot's auto-reply does not count. Independent of
      // awaitingReply; disjoint from Pending (which requires a prior human reply).
      and.push({ lastHumanReplyAt: null });
    }

    if (opts.contacted) {
      // "Open" tab: the complement — a human HAS replied at least once. Together
      // with Uncontacted this partitions every chat the caller can see.
      and.push({ lastHumanReplyAt: { not: null } });
    }

    if (opts.unread && process.env.WA_UNREAD_FILTER_ENABLED !== 'false') {
      // "Unread" chip — literal WhatsApp unread: the rep hasn't opened the chat
      // since the last inbound (unreadCount > 0). Opening it calls markRead(),
      // which resets the count, so the row drops off this filter — even if the
      // customer's last message needed no reply ("thanks/ok"). Kill-switch:
      // WA_UNREAD_FILTER_ENABLED=false turns the param into a no-op.
      and.push({ unreadCount: { gt: 0 } });
    }

    if (opts.followUpDue) {
      // "Due (N)" chip: only chats whose lead has an OPEN CRM follow-up that is
      // due or overdue right now. Live relation query — always accurate, no
      // denormalized field to keep in sync.
      and.push({ lead: { is: { followUps: { some: { status: 'OPEN', dueAt: { lte: new Date() } } } } } });
    }

    // Archived / blocked are OPT-IN views. The DEFAULT list (neither flag set)
    // MUST exclude both — an archived or blocked conversation should never
    // resurface in the working inbox. When a flag is set we show ONLY that set.
    if (opts.archived) {
      // Show ONLY archived threads.
      and.push({ status: 'ARCHIVED' });
    } else if (opts.blocked) {
      // Show ONLY blocked threads — block lives on the CONTACT, so match a
      // thread whose lead OR client has blockedAt set.
      and.push({
        OR: [
          { lead: { is: { blockedAt: { not: null } } } },
          { client: { is: { blockedAt: { not: null } } } },
        ],
      });
    } else {
      // Default working inbox: hide archived threads AND blocked contacts.
      // Block lives on the CONTACT, and a thread may have only a lead, only a
      // client, or (rarely) both — so for EACH relation we keep the thread when
      // the relation is either absent OR present-and-not-blocked. Same nullable-
      // relation pattern as the soft-delete guard above.
      and.push({ status: { not: 'ARCHIVED' } });
      and.push({ OR: [{ lead: { is: { blockedAt: null } } }, { lead: null }] });
      and.push({ OR: [{ client: { is: { blockedAt: null } } }, { client: null }] });
      // Sales-disposition hygiene: JUNK / DEAD leads drop out of the active
      // inbox views (they stay in the DB + still reachable by direct lookup).
      // Uses the null-safe positive filter — a naive NOT+is emptied the inbox.
      // EXCEPTION: if the caller is explicitly filtering TO Junk or Dead, honour
      // that — the disposition filter below constrains it, and applying the
      // hygiene exclusion too would always return nothing.
      const wantsJunkOrDead =
        opts.disposition === LeadDisposition.JUNK ||
        opts.disposition === LeadDisposition.DEAD;
      if (!wantsJunkOrDead) and.push(LEAD_NOT_JUNK_OR_DEAD);
    }

    if (opts.disposition) {
      // Inbox "disposition" funnel — only threads whose lead carries this tag.
      // A to-one relation match, so a client-only thread (lead null) is
      // correctly excluded. Composes (AND) with the tab/search filters.
      and.push({ lead: { is: { disposition: opts.disposition } } });
    }

    if (opts.search) {
      const q = opts.search.trim();
      const digits = q.replace(/\D/g, '');
      // Name search (works for partial first/last name, case-insensitive).
      const or: Prisma.WhatsAppThreadWhereInput[] = [
        { lead: { firstName: { contains: q, mode: 'insensitive' } } },
        { lead: { lastName: { contains: q, mode: 'insensitive' } } },
        { client: { firstName: { contains: q, mode: 'insensitive' } } },
        { client: { lastName: { contains: q, mode: 'insensitive' } } },
      ];
      // Number search — ONLY when the query actually contains digits. The old
      // code always added `waContactId contains digitsOf(q)`, which for a NAME
      // query became `contains ''` → matches EVERY row → search returned
      // everything (the "search not working" bug). Require >= 3 digits so a
      // stray digit in a name doesn't broaden the match either.
      if (digits.length >= 3) {
        // Local vs international format: numbers are stored international
        // (923008641218 / +923008641218), but reps type the local 0-prefixed
        // form (03008641218). A raw substring match then fails because the
        // stored "92" is where the typed "0" is. Strip leading zero(s) and match
        // on BOTH forms so either "03008641218" or "923008641218" resolves.
        const variants = new Set<string>([digits]);
        const bare = digits.replace(/^0+/, '');
        if (bare.length >= 3) variants.add(bare);
        for (const d of variants) {
          or.push({ waContactId: { contains: d } });
          or.push({ lead: { phone: { contains: d } } });
          or.push({ client: { phone: { contains: d } } });
        }
      }
      and.push({ OR: or });
    }

    where.AND = and;

    // --- Personal pins (WhatsApp-style "pin to top") -------------------------
    // Each agent keeps their OWN pinned chats (capped at 6 in pin()). Pinned
    // threads are lifted to the very top of the FIRST page and removed from the
    // normal ordered stream on EVERY page, so a pinned chat can never appear
    // twice (page 1 top section) nor resurface later via the cursor. Pins only
    // apply when the caller has an employee identity.
    let pinnedIds: string[] = [];
    if (caller.employeeId) {
      const pinRows = await this.prisma.whatsAppThreadPin.findMany({
        where: { employeeId: caller.employeeId },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { threadId: true },
      });
      pinnedIds = pinRows.map((p) => p.threadId);
    }

    // Ordering. DEFAULT (today's behavior, flag off): ACTION-REQUIRED FIRST —
    //   awaitingReply pinned to the top, then newest real human activity, so an
    //   unanswered lead can never get buried. WHATSAPP-PARITY (WA_ALL_NEWEST_FIRST
    //   = 'true'): strictly newest MESSAGE on top, exactly like the real app —
    //   the awaitingReply pin is dropped for the general lists (the "who's
    //   waiting" signal moves to the Unread chip + the per-row badge). The
    //   Pending tab (needsReply) is an action queue by definition, so it KEEPS
    //   the pin regardless of the flag. `id` is the stable cursor tiebreaker
    //   (timestamps aren't unique; paging a non-unique sort can otherwise
    //   skip/duplicate rows). Flag defaults OFF — deploying this changes nothing
    //   until it is explicitly flipped to 'true'.
    const newestFirst =
      process.env.WA_ALL_NEWEST_FIRST === 'true' && !opts.needsReply;
    const orderBy: Prisma.WhatsAppThreadOrderByWithRelationInput[] = newestFirst
      ? [
          { lastMessageAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ]
      : [
          { awaitingReply: 'desc' },
          { lastHumanActivityAt: { sort: 'desc', nulls: 'last' } },
          { lastMessageAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ];

    // Main stream excludes pinned threads on EVERY page (so they never dupe).
    const mainWhere: Prisma.WhatsAppThreadWhereInput =
      pinnedIds.length > 0 ? { ...where, AND: [...and, { id: { notIn: pinnedIds } }] } : where;

    const rows = await this.prisma.whatsAppThread.findMany({
      where: mainWhere,
      orderBy,
      take: limit + 1,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
      include: THREAD_LIST_INCLUDE,
    });

    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);

    // Pinned section — only on the FIRST page (no cursor). Applies the SAME
    // tab/visibility filters as the main list (so a pinned chat that the active
    // tab would hide stays hidden), just restricted to the pinned id set and
    // without the notIn exclusion. Ordered by pin recency (pinnedIds is already
    // most-recently-pinned first).
    let pinnedRows: typeof pageRows = [];
    if (!opts.cursor && pinnedIds.length > 0) {
      const fetched = await this.prisma.whatsAppThread.findMany({
        where: { ...where, AND: [...and, { id: { in: pinnedIds } }] },
        include: THREAD_LIST_INCLUDE,
      });
      const rank = new Map(pinnedIds.map((id, i) => [id, i]));
      fetched.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
      pinnedRows = fetched;
    }

    const items = [
      ...pinnedRows.map((r) => ({ ...r, isPinnedByMe: true })),
      // Main rows are already pin-excluded, so isPinnedByMe is always false.
      ...pageRows.map((r) => ({ ...r, isPinnedByMe: false })),
    ];

    return {
      items,
      nextCursor: hasMore ? rows[limit - 1]!.id : null,
    };
  }

  /**
   * Base authorization scope for a caller — which threads they may see AT
   * ALL, independent of any UI filter. Mirrors the scope branches in list():
   *   agent   → only their own assigned leads
   *   finance → only leads with a non-DRAFT agreement on file
   *   admin   → everything
   * Returns 'all' (no lead constraint), 'none' (caller sees nothing), or a
   * Lead where-filter to constrain by.
   */
  private async resolveCallerLeadScope(
    caller: CallerContext,
  ): Promise<'all' | 'none' | Prisma.LeadWhereInput> {
    if (caller.canViewAll) return 'all';
    // Finance: per-lead / per-thread resolution (opening a specific lead's
    // profile WhatsApp tab) is NOT agreement-gated — Finance may reach any lead
    // they open. The closed-loop agreement gate only governs the finance INBOX
    // LIST (scoped separately in list()/stats()), so this doesn't expose the
    // whole inbox; it just lets the per-lead tab load the chat + send.
    if (caller.canViewFinanceScope) return 'all';
    if (caller.canViewProcessingScope) {
      // Only leads that have reached processing (have a case) — this covers the
      // client's thread for the processing team without exposing the inbox.
      return { processingCases: { some: {} }, deletedAt: null };
    }
    if (!caller.employeeId) return 'none';
    return { assignedEmployeeId: caller.employeeId, deletedAt: null };
  }

  /** True when a thread's lead/client has a ProcessingCase — the processing
   *  team's closed-loop WhatsApp scope. */
  private async threadInProcessingScope(
    leadId: string | null,
    clientId: string | null,
  ): Promise<boolean> {
    if (!leadId && !clientId) return false;
    const pc = await this.prisma.processingCase.findFirst({
      where: {
        OR: [
          ...(leadId ? [{ leadId }] : []),
          ...(clientId ? [{ clientId }] : []),
        ],
      },
      select: { id: true },
    });
    return !!pc;
  }

  /**
   * Fetch a SINGLE thread in the exact list-row shape, applying the caller's
   * authorization scope. Returns null when the thread doesn't exist or the
   * caller isn't allowed to see it.
   *
   * Backs the realtime "patch one row" path: on a socket event the client
   * refetches just this row (one indexed lookup) instead of the whole list,
   * and a null result tells it to drop the row. Authorization is re-applied
   * here per caller, so this stays safe even though the socket event that
   * triggered it was an org-wide broadcast.
   */
  async getListItem(caller: CallerContext, threadId: string) {
    const scope = await this.resolveCallerLeadScope(caller);
    if (scope === 'none') return null;
    const where: Prisma.WhatsAppThreadWhereInput = {
      id: threadId,
      // Same soft-delete guard the list uses (hide threads of soft-deleted
      // leads; still allow client-only threads with no lead).
      AND: [
        { OR: [{ lead: { is: { deletedAt: null } } }, { lead: null }] },
        // Mirror list()/stats(): a JUNK/DEAD-dispositioned lead's row must NOT
        // resolve here either, or a socket-triggered single-row refetch would
        // splice the (excluded-from-the-list) chat back into the active inbox
        // while the counts still omit it. Returning null makes the realtime
        // patch drop the row, keeping list + stats + rows consistent. Uses the
        // null-safe positive filter — a naive NOT+is emptied the inbox.
        LEAD_NOT_JUNK_OR_DEAD,
      ],
    };
    if (scope !== 'all') where.lead = scope;
    const row = await this.prisma.whatsAppThread.findFirst({ where, include: THREAD_LIST_INCLUDE });
    if (!row) return null;
    // Carry the personal pin flag so the realtime "patch one row" path keeps a
    // pinned chat pinned (the list rows include it too — same shape contract).
    let isPinnedByMe = false;
    if (caller.employeeId) {
      const pin = await this.prisma.whatsAppThreadPin.findUnique({
        where: { threadId_employeeId: { threadId: row.id, employeeId: caller.employeeId } },
        select: { id: true },
      });
      isPinnedByMe = !!pin;
    }
    return { ...row, isPinnedByMe };
  }

  /**
   * Resolve the WhatsApp thread for a given lead DIRECTLY — by leadId, with a
   * phone-number fallback (covers front-desk / duplicate leads whose thread got
   * linked to a different lead record). Unlike scanning the recent inbox page,
   * this finds the conversation no matter how old or how busy the inbox is —
   * which is why the lead-profile WhatsApp tab uses it. Applies the caller's
   * authorization scope; returns null when none is found or visible.
   */
  async findForLead(caller: CallerContext, leadId: string) {
    const scope = await this.resolveCallerLeadScope(caller);
    if (scope === 'none') return null;

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { phone: true },
    });
    const digits = lead?.phone ? lead.phone.replace(/\D/g, '') : '';

    const orMatch: Prisma.WhatsAppThreadWhereInput[] = [{ leadId }];
    // Phone fallback — a thread for the same number that got linked to a
    // different (e.g. auto-created or duplicate) lead. Require a real number so
    // we never match on an empty string. Scoped callers are still constrained
    // by `where.lead` below, so this only broadens what an admin can resolve.
    if (digits.length >= 6) orMatch.push({ waContactId: { contains: digits } });

    const where: Prisma.WhatsAppThreadWhereInput = {
      AND: [
        { OR: [{ lead: { is: { deletedAt: null } } }, { lead: null }] },
        { OR: orMatch },
      ],
    };
    if (scope !== 'all') where.lead = scope;

    return this.prisma.whatsAppThread.findFirst({
      where,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      include: THREAD_LIST_INCLUDE,
    });
  }

  /**
   * Content search — find chats by what was SAID, not just the contact name.
   * Searches message BODIES (case-insensitive substring; pg_trgm-indexed) and
   * returns the matching threads in list-row shape, each with a `searchSnippet`
   * of the most-recent matching message so the UI can show WHY it matched
   * ("…we can offer a small discount…"). Applies the caller's scope + the same
   * working-inbox exclusions the list uses (no soft-deleted leads, no blocked
   * contacts, no archived threads). Query must be >= 2 chars.
   */
  async searchMessages(
    caller: CallerContext,
    rawQuery: string,
    limit = 30,
  ): Promise<{ items: Array<Record<string, unknown>> }> {
    const q = (rawQuery ?? '').trim();
    if (q.length < 2) return { items: [] };
    const take = Math.min(Math.max(limit, 1), 50);

    // Scope EXACTLY like the inbox LIST (NOT the looser per-thread-open scope),
    // as a thread-level clause (mirrors list()):
    //   admin   → no constraint (just hide soft-deleted leads' threads)
    //   finance → only leads with a non-DRAFT agreement (pre-agreement Sales
    //             negotiations stay private — same gate list()/stats() use)
    //   agent   → their assigned leads, PLUS lead-less threads for their
    //             assigned clients (converted contacts) — the client branch the
    //             old lead-only filter dropped, so a rep's converted-client
    //             chats are now searchable, matching list()/stats().
    // Using the per-thread-open scope here would let finance see snippets of
    // pre-agreement Sales chats they can't actually open.
    let scopeClause: Prisma.WhatsAppThreadWhereInput | null = null; // null = admin
    if (caller.canViewAll) {
      scopeClause = null;
    } else if (caller.canViewFinanceScope) {
      const eligible = await this.eligibleLeadIdsForFinance();
      if (eligible.length === 0) return { items: [] };
      scopeClause = { lead: { id: { in: eligible }, deletedAt: null } };
    } else {
      if (!caller.employeeId) return { items: [] };
      scopeClause = {
        OR: [
          { lead: { assignedEmployeeId: caller.employeeId, deletedAt: null } },
          { leadId: null, client: { assignedEmployeeId: caller.employeeId, deletedAt: null } },
        ],
      };
    }

    // Working-inbox visibility (mirrors list()'s default branch): live chats
    // only — skip blocked contacts and archived threads.
    const and: Prisma.WhatsAppThreadWhereInput[] = [
      { status: { not: 'ARCHIVED' } },
      { OR: [{ lead: { is: { blockedAt: null } } }, { lead: null }] },
      { OR: [{ client: { is: { blockedAt: null } } }, { client: null }] },
    ];
    if (scopeClause) {
      and.push(scopeClause);
    } else {
      // Admin: still hide threads of soft-deleted leads (lead-less kept).
      and.push({ OR: [{ lead: { is: { deletedAt: null } } }, { lead: null }] });
    }
    const threadWhere: Prisma.WhatsAppThreadWhereInput = { AND: and };

    // Newest matching messages first; cap the scan and dedup to threads below.
    const matches = await this.prisma.whatsAppMessage.findMany({
      where: {
        body: { contains: q, mode: 'insensitive' },
        thread: { is: threadWhere },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: { threadId: true, body: true, createdAt: true },
    });

    // One row per thread — keep the most-recent matching message as the snippet.
    const byThread = new Map<string, string>();
    for (const m of matches) {
      if (byThread.size >= take) break;
      if (m.body && !byThread.has(m.threadId)) byThread.set(m.threadId, m.body);
    }
    const threadIds = [...byThread.keys()];
    if (threadIds.length === 0) return { items: [] };

    // Fetch the thread rows (already scope-verified via the message filter).
    const rows = await this.prisma.whatsAppThread.findMany({
      where: { id: { in: threadIds } },
      include: THREAD_LIST_INCLUDE,
    });
    // Preserve match-recency order (byThread insertion order = createdAt desc).
    const rank = new Map(threadIds.map((id, i) => [id, i]));
    rows.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));

    return {
      items: rows.map((r) => ({
        ...r,
        isPinnedByMe: false,
        searchSnippet: snippetAround(byThread.get(r.id) ?? '', q),
      })),
    };
  }

  /**
   * True inbox counters for the KPI chips. Computed with COUNT queries over
   * the whole table (scoped to the caller) — NOT from the paginated list —
   * so "Active 30" stops being a lie that just reflected the first page size.
   *
   * Returns:
   *   total           — every non-deleted thread the caller can see
   *   active          — status OPEN (the working set)
   *   unassigned      — admin-only: threads whose lead has no assignee yet
   *   slaBreached     — threads flagged slaBreached (legacy first-response)
   *   unread          — threads with unreadCount > 0
   *   awaitingReply   — Response-SLA clock running (agent's turn)
   *   approaching     — within the warn window, not yet overdue
   *   overdue         — Response-SLA deadline already passed, still unanswered
   *   slaScore        — on-time %. For an agent: their own. For an admin /
   *                     manager (canViewAll): the ORG-WIDE aggregate across
   *                     every agent, so the dashboard shows a useful team
   *                     number instead of a meaningless 100.
   *   slaScoreScope   — 'self' | 'org' | null, so the UI can label it right.
   */
  async stats(caller: CallerContext): Promise<{
    total: number;
    active: number;
    resolved: number;
    unassigned: number;
    slaBreached: number;
    unread: number;
    /** Unread AND a human has replied at least once — backs the funnel "Unread"
     *  chip (engaged chats only; a never-contacted lead stays in Uncontacted). */
    unreadEngaged: number;
    awaitingReply: number;
    uncontacted: number;
    /** Chats whose lead has an OPEN follow-up due/overdue now — powers "Due (N)". */
    followUpDue: number;
    /** Threads parked as ARCHIVED — powers the "Archived" chip. */
    archived: number;
    /** Threads whose contact (lead OR client) is blocked — powers the "Blocked" chip. */
    blocked: number;
    approaching: number;
    overdue: number;
    slaScore: number | null;
    slaScoreScope: 'self' | 'org' | null;
  }> {
    const empty = {
      total: 0, active: 0, resolved: 0, unassigned: 0, slaBreached: 0, unread: 0,
      unreadEngaged: 0,
      awaitingReply: 0, uncontacted: 0, followUpDue: 0, archived: 0, blocked: 0,
      approaching: 0, overdue: 0,
      slaScore: null as number | null, slaScoreScope: null as 'self' | 'org' | null,
    };
    // Base visibility filter mirrors list(): drop soft-deleted leads, and
    // scope to the caller's own assigned leads when they can't view all.
    const base: Prisma.WhatsAppThreadWhereInput = {
      OR: [{ lead: { is: { deletedAt: null } } }, { lead: null }],
    };
    if (caller.canViewFinanceScope && !caller.canViewAll) {
      // Finance closed-loop scope — only threads whose lead has a
      // non-DRAFT agreement (see list() for rationale).
      const eligibleLeadIds = await this.eligibleLeadIdsForFinance();
      if (eligibleLeadIds.length === 0) return empty;
      base.lead = { id: { in: eligibleLeadIds }, deletedAt: null };
      delete base.OR;
    } else if (!caller.canViewAll) {
      if (!caller.employeeId) return empty;
      // Rep scope mirrors list(): their assigned leads, PLUS lead-less threads
      // for their assigned clients (converted contacts a reassign routed to
      // them). Replaces the deletedAt-only OR — the lead branch already carries
      // deletedAt: null and the client branch is lead-less, so no soft-deleted
      // lead slips through. (Backs the followUp/archived/blocked/unreadEngaged
      // Prisma counts; the main badge counts use the raw-SQL scope below.)
      base.OR = [
        { lead: { assignedEmployeeId: caller.employeeId, deletedAt: null } },
        { leadId: null, client: { assignedEmployeeId: caller.employeeId, deletedAt: null } },
      ];
    }

    const and = (extra: Prisma.WhatsAppThreadWhereInput): Prisma.WhatsAppThreadWhereInput => ({
      AND: [base, extra],
    });
    // Working-inbox exclusion (mirrors list()'s default branch): no ARCHIVED
    // threads and no BLOCKED contacts. Used by the counts that back the default
    // tabs so the badges match the rows the default list actually renders.
    const notArchivedBlocked: Prisma.WhatsAppThreadWhereInput = {
      status: { not: 'ARCHIVED' },
      AND: [
        { OR: [{ lead: { is: { blockedAt: null } } }, { lead: null }] },
        { OR: [{ client: { is: { blockedAt: null } } }, { client: null }] },
        // Keep JUNK/DEAD-dispositioned leads out of the working-inbox counts so
        // the badges match the (junk/dead-excluded) rows list() renders. Uses
        // the null-safe positive filter — a naive NOT+is zeroed finance counts.
        LEAD_NOT_JUNK_OR_DEAD,
      ],
    };
    const andLive = (extra: Prisma.WhatsAppThreadWhereInput): Prisma.WhatsAppThreadWhereInput => ({
      AND: [base, notArchivedBlocked, extra],
    });

    const now = new Date();
    // Pull warn window from org config so "approaching" matches the sweeper.
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { slaWarnBeforeSeconds: true },
    });
    const warnCutoff = new Date(now.getTime() + (org?.slaWarnBeforeSeconds ?? 60) * 1000);

    // PERF: the inbox badge counts used to be 10 separate COUNT() queries fired
    // in parallel. Against a remote DB that's 10 cross-region round-trips PER
    // stats call AND a momentary grab of up to 10 pooled connections (the pool
    // is only 10), so a single stats refresh could starve concurrent chat
    // opens. We now collapse them into ONE conditional-aggregation query for
    // the admin/agent paths (verified identical to the per-count results).
    // Finance keeps the per-count path: its scope is an id-array over the small
    // agreement-lead set, so it isn't a hot path worth the raw-SQL branch.
    const financeScoped = caller.canViewFinanceScope && !caller.canViewAll;
    let total: number, active: number, slaBreached: number, unread: number,
      unassigned: number, awaitingReply: number, uncontacted: number,
      overdue: number, approaching: number, resolved: number;

    if (financeScoped) {
      [total, active, slaBreached, unread, unassigned, awaitingReply, uncontacted, overdue, approaching, resolved] =
        await Promise.all([
          this.prisma.whatsAppThread.count({ where: andLive({}) }),
          this.prisma.whatsAppThread.count({ where: andLive({ status: 'OPEN' }) }),
          this.prisma.whatsAppThread.count({ where: andLive({ slaBreached: true }) }),
          this.prisma.whatsAppThread.count({ where: andLive({ unreadCount: { gt: 0 } }) }),
          Promise.resolve(0), // finance never sees the "unassigned" chip
          // Pending = follow-ups (awaiting + a human replied before).
          this.prisma.whatsAppThread.count({ where: andLive({ awaitingReply: true, lastHumanReplyAt: { not: null } }) }),
          // Uncontacted = NO human has ever replied (over all chats, bot ignored).
          this.prisma.whatsAppThread.count({ where: andLive({ lastHumanReplyAt: null }) }),
          this.prisma.whatsAppThread.count({ where: andLive({ responseDeadlineAt: { not: null, lte: now } }) }),
          this.prisma.whatsAppThread.count({ where: andLive({ responseDeadlineAt: { gt: now, lte: warnCutoff } }) }),
          this.prisma.whatsAppThread.count({ where: andLive({ status: 'RESOLVED' }) }),
        ]);
    } else {
      // Mirrors the `base`/`and` filter above: exclude soft-deleted leads
      // (lead-less threads kept), and for a plain agent restrict to their own
      // assigned leads. $1=now, $2=warnCutoff, $3=employeeId (agent only).
      const params: unknown[] = [now, warnCutoff];
      let scope = 'l."deletedAt" IS NULL';
      if (!caller.canViewAll) {
        params.push(caller.employeeId);
        // Rep scope mirrors list(): their assigned leads OR lead-less threads
        // for their assigned clients (converted contacts). c is LEFT JOINed
        // below, so a client thread (leadId NULL) matches on c."assignedEmployeeId".
        scope += ` AND (l."assignedEmployeeId" = $${params.length} OR (t."leadId" IS NULL AND c."assignedEmployeeId" = $${params.length}))`;
      }
      // Mirror list()'s default working inbox: exclude ARCHIVED threads and
      // BLOCKED contacts so the All/Open/Uncontacted badge counts match the rows.
      // Also drop JUNK/DEAD-dispositioned leads (null disposition + lead-less
      // threads stay in — IS DISTINCT FROM handles the NULLs correctly).
      scope += ` AND t.status::text <> 'ARCHIVED' AND l."blockedAt" IS NULL AND (t."clientId" IS NULL OR c."blockedAt" IS NULL)`;
      scope += ` AND l."disposition"::text IS DISTINCT FROM 'JUNK' AND l."disposition"::text IS DISTINCT FROM 'DEAD'`;
      const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, number | bigint | null>>>(
        `SELECT
           count(*)::int AS total,
           count(*) FILTER (WHERE t.status::text = 'OPEN')::int AS active,
           count(*) FILTER (WHERE t."slaBreached")::int AS "slaBreached",
           count(*) FILTER (WHERE t."unreadCount" > 0)::int AS unread,
           count(*) FILTER (WHERE l.id IS NOT NULL AND l."assignedEmployeeId" IS NULL)::int AS unassigned,
           count(*) FILTER (WHERE t."awaitingReply" AND t."lastHumanReplyAt" IS NOT NULL)::int AS "awaitingReply",
           count(*) FILTER (WHERE t."lastHumanReplyAt" IS NULL)::int AS uncontacted,
           count(*) FILTER (WHERE t."responseDeadlineAt" IS NOT NULL AND t."responseDeadlineAt" <= $1)::int AS overdue,
           count(*) FILTER (WHERE t."responseDeadlineAt" > $1 AND t."responseDeadlineAt" <= $2)::int AS approaching,
           count(*) FILTER (WHERE t.status::text = 'RESOLVED')::int AS resolved
         FROM whatsapp.threads t
         LEFT JOIN crm.leads l ON l.id = t."leadId"
         LEFT JOIN crm.clients c ON c.id = t."clientId"
         WHERE ${scope}`,
        ...params,
      );
      const r = rows[0] ?? {};
      const num = (v: number | bigint | null | undefined): number => (v == null ? 0 : Number(v));
      total = num(r.total); active = num(r.active); slaBreached = num(r.slaBreached);
      unread = num(r.unread); unassigned = num(r.unassigned); awaitingReply = num(r.awaitingReply);
      uncontacted = num(r.uncontacted); overdue = num(r.overdue); approaching = num(r.approaching);
      resolved = num(r.resolved);
    }

    // SLA score. Admins / managers (canViewAll) get the ORG-WIDE aggregate so
    // their dashboard shows a real team number rather than the personal-score
    // fallback of 100. A plain agent gets their own score.
    let slaScore: number | null = null;
    let slaScoreScope: 'self' | 'org' | null = null;
    if (caller.canViewAll) {
      const agg = await this.prisma.employee.aggregate({
        where: { deletedAt: null },
        _sum: { slaResponsesMet: true, slaResponsesBreached: true },
        // Org-wide presence penalty = the average across agents, so the team
        // score dips when people sit Offline during working hours.
        _avg: { slaPenaltyPoints: true },
      });
      const met = agg._sum.slaResponsesMet ?? 0;
      const breached = agg._sum.slaResponsesBreached ?? 0;
      const totalResp = met + breached;
      const base = totalResp === 0 ? 100 : Math.round((met / totalResp) * 100);
      slaScore = Math.max(0, base - Math.round(agg._avg.slaPenaltyPoints ?? 0));
      slaScoreScope = 'org';
    } else if (caller.employeeId) {
      const emp = await this.prisma.employee.findUnique({
        where: { id: caller.employeeId },
        select: { slaResponsesMet: true, slaResponsesBreached: true, slaPenaltyPoints: true },
      });
      if (emp) {
        const totalResp = emp.slaResponsesMet + emp.slaResponsesBreached;
        const base = totalResp === 0 ? 100 : Math.round((emp.slaResponsesMet / totalResp) * 100);
        slaScore = Math.max(0, base - emp.slaPenaltyPoints);
        slaScoreScope = 'self';
      }
    }

    // "Due (N)" chip: chats whose lead has an OPEN CRM follow-up due/overdue now.
    // A separate live relation count (cheap — follow_ups is indexed on dueAt and
    // status) so it's always accurate without a denormalized field to maintain.
    // Archived/blocked chips ride alongside — both are cheap indexed counts
    // (whatsapp.threads.status; crm.{leads,clients}.blockedAt) scoped to the
    // caller via the same `base` filter the other counts use.
    const [followUpDue, archived, blocked, unreadEngaged] = await Promise.all([
      // Use andLive (not and) so the "Due (N)" chip excludes ARCHIVED / blocked /
      // JUNK-DEAD threads — exactly as the Due LIST does (list()'s default
      // branch). Otherwise a JUNK/DEAD lead with an open due follow-up would be
      // counted by the badge but hidden from the list (count ≠ rows).
      this.prisma.whatsAppThread.count({
        where: andLive({ lead: { is: { followUps: { some: { status: 'OPEN', dueAt: { lte: now } } } } } }),
      }),
      this.prisma.whatsAppThread.count({ where: and({ status: 'ARCHIVED' }) }),
      this.prisma.whatsAppThread.count({
        where: and({
          OR: [
            { lead: { is: { blockedAt: { not: null } } } },
            { client: { is: { blockedAt: { not: null } } } },
          ],
        }),
      }),
      // Funnel "Unread" = engaged (a human has replied) AND unread. Uses andLive
      // so it matches the Unread chip's list (active, non-blocked). A brand-new
      // lead stays in Uncontacted, never here.
      this.prisma.whatsAppThread.count({
        where: andLive({ unreadCount: { gt: 0 }, lastHumanReplyAt: { not: null } }),
      }),
    ]);

    return {
      total, active, resolved, unassigned, slaBreached, unread, unreadEngaged,
      awaitingReply, uncontacted, followUpDue, archived, blocked,
      approaching, overdue, slaScore, slaScoreScope,
    };
  }

  async getOrFail(caller: CallerContext, threadId: string) {
    const t = await this.prisma.whatsAppThread.findUnique({
      where: { id: threadId },
      include: {
        channel: { select: { id: true, label: true, displayNumber: true, phoneNumberId: true } },
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            nationality: true,
            targetCountry: true,
            status: true,
            disposition: true,
            dispositionAt: true,
            blockedAt: true,
            assignedEmployeeId: true,
            preferredEmployeeId: true,
            convertedClientId: true,
            assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
            // CSV-origin badge data — shown in the chat header.
            importRows: {
              where: { outcome: { in: ['IMPORTED', 'DUPLICATE'] } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                id: true,
                batch: { select: { id: true, batchNumber: true, name: true } },
              },
            },
          },
        },
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            nationality: true,
            status: true,
            blockedAt: true,
            assignedEmployeeId: true,
          },
        },
      },
    });
    if (!t) throw new NotFoundException('Thread not found');
    if (!caller.canViewAll) {
      if (caller.canViewFinanceScope) {
        // Finance can only open threads whose lead has a non-DRAFT
        // agreement on file (Sales has sent it to Finance). Pre-agreement
        // negotiations stay private to Sales.
        if (!t.lead?.id) throw new ForbiddenException('Thread not visible to Finance');
        const hasAgreement = await this.prisma.agreement.findFirst({
          where: { leadId: t.lead.id, status: { not: 'DRAFT' }, deletedAt: null },
          select: { id: true },
        });
        if (!hasAgreement) {
          throw new ForbiddenException('Thread not visible to Finance until Sales sends an agreement');
        }
      } else if (caller.canViewProcessingScope) {
        // Processing can open a thread only for one of their own clients
        // (lead/client has a ProcessingCase).
        const inScope = await this.threadInProcessingScope(t.lead?.id ?? null, t.client?.id ?? null);
        if (!inScope) throw new ForbiddenException('Thread not in your processing scope');
      } else {
        // A thread with a lead is scoped by the LEAD's owner (unchanged). A
        // converted contact's lead-less thread is scoped by the CLIENT's owner
        // (set by a client-thread reassign). When both exist the lead wins, so
        // client ownership never overrides lead scoping.
        const owner = t.leadId
          ? t.lead?.assignedEmployeeId
          : t.client?.assignedEmployeeId;
        if (!caller.employeeId || owner !== caller.employeeId) {
          throw new ForbiddenException('Thread not assigned to you');
        }
      }
    }
    return t;
  }

  /**
   * Mark a thread as read by the calling agent. Resets the local unreadCount
   * (drives the inbox badge + the new "Unread" chip) AND — best-effort — acks
   * the latest inbound message to Meta so the CUSTOMER sees blue double-ticks,
   * exactly like opening the chat in the real WhatsApp app.
   *
   * The Meta ack is FIRE-AND-FORGET: never awaited into the request path and
   * fully swallowed, so a Meta outage or a stale wamid can never break opening
   * a thread. Gated by WA_MARK_READ_META so it can be killed instantly. Note
   * the local unread clear (which the UI depends on) is INDEPENDENT of the ack,
   * so the Unread chip keeps working even if Meta errors.
   */
  async markRead(caller: CallerContext, threadId: string): Promise<void> {
    const t = await this.getOrFail(caller, threadId);
    if (t.unreadCount === 0) return;
    await this.prisma.whatsAppThread.update({
      where: { id: threadId },
      data: { unreadCount: 0 },
    });
    if (process.env.WA_MARK_READ_META !== 'false') {
      void this.ackReadToMeta(threadId);
    }
  }

  /**
   * Best-effort "send blue ticks to the customer": ack the latest inbound
   * message on this thread to Meta. Marking the NEWEST inbound read marks all
   * earlier ones read too (WhatsApp semantics), so one call suffices. Only
   * reached when there WAS unread mail (markRead early-returns otherwise), so
   * it can't spam Meta on every open. Any failure (Meta down, expired token,
   * missing wamid) is swallowed — thread open + the local unread clear already
   * succeeded, and the only cost is the customer not seeing blue ticks once.
   */
  private async ackReadToMeta(threadId: string): Promise<void> {
    try {
      const thread = await this.prisma.whatsAppThread.findUnique({
        where: { id: threadId },
        select: { channel: { select: { phoneNumberId: true, accessTokenEnc: true } } },
      });
      if (!thread?.channel?.accessTokenEnc) return;
      const lastInbound = await this.prisma.whatsAppMessage.findFirst({
        where: { threadId, direction: 'INBOUND', waMessageId: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { waMessageId: true },
      });
      const wamid = lastInbound?.waMessageId;
      if (!wamid) return;
      await this.metaFactory.forChannel(thread.channel).markAsRead(wamid);
    } catch {
      // Best-effort only — never rethrow into the read path.
    }
  }

  /**
   * Admin override — route this thread's Lead to a specific employee.
   * Updates both `Lead.assignedEmployeeId` (current) and
   * `Lead.preferredEmployeeId` (sticky) so any future inbound on the same
   * lead returns to the same agent. Bypasses the round-robin engine, but
   * the engine still applies when the next NEW lead arrives.
   *
   * Caller must have whatsapp.reassign (PermissionGuard already enforces).
   */
  async reassign(caller: CallerContext, threadId: string, employeeId: string) {
    const t = await this.prisma.whatsAppThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        leadId: true,
        lead: { select: { id: true, assignedEmployeeId: true } },
        // A converted contact's thread has a client (leadId null) instead of a
        // lead. Reassigning it moves the CLIENT's owner so the same picker works
        // for post-conversion chats, not just leads.
        clientId: true,
        client: { select: { id: true, assignedEmployeeId: true } },
      },
    });
    if (!t || (!t.lead && !t.client)) throw new NotFoundException('Thread not found');

    const target = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        isActive: true,
        whatsappInboxMember: true,
        deletedAt: null,
        // Same rule as the auto-assignment engine — never reassign to a
        // user whose account is deactivated/suspended.
        user: { status: 'ACTIVE' },
      },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!target) {
      throw new BadRequestException(
        'Target employee is not eligible (must be active, in the WhatsApp inbox pool, and have an active user account).',
      );
    }

    // A thread with a lead is owned via the LEAD (unchanged); a converted
    // contact's lead-less thread is owned via the CLIENT. When both exist the
    // lead wins — reassign, list() and getOrFail() all key off this same rule so
    // a dual-linked thread's two owners can never diverge.
    const onLead = !!(t.leadId && t.lead);
    const previousAssignee =
      (onLead ? t.lead?.assignedEmployeeId : t.client?.assignedEmployeeId) ?? null;

    await this.prisma.$transaction([
      // Reassign the owner on whichever contact backs the thread. A lead also
      // gets preferredEmployeeId (the round-robin sticky preference); a client
      // has no round-robin so we only move assignedEmployeeId.
      onLead
        ? this.prisma.lead.update({
            where: { id: t.leadId! },
            data: {
              assignedEmployeeId: employeeId,
              preferredEmployeeId: employeeId,
            },
          })
        : this.prisma.client.update({
            where: { id: t.clientId! },
            data: { assignedEmployeeId: employeeId },
          }),
      this.prisma.whatsAppThread.update({
        where: { id: threadId },
        data: { lastAssignmentReason: WhatsAppAssignmentReason.REASSIGN },
      }),
      this.prisma.activityTimeline.create({
        data: {
          entityType: onLead ? 'Lead' : 'Client',
          entityId: (onLead ? t.leadId : t.clientId)!,
          leadId: onLead ? t.leadId : null,
          clientId: onLead ? null : t.clientId,
          // Existing WHATSAPP_ASSIGNED enum covers both initial assignment
          // and admin overrides; metadata.via='admin_override' is how we
          // tell them apart in audit views.
          eventType: 'WHATSAPP_ASSIGNED',
          description: `WhatsApp thread manually reassigned to ${target.firstName} ${target.lastName}`.trim(),
          actorUserId: caller.userId,
          metadata: {
            threadId,
            employeeId,
            previousAssignee,
            via: 'admin_override',
          },
        },
      }),
    ]);

    return {
      threadId,
      leadId: t.leadId ?? null,
      clientId: t.clientId ?? null,
      assignedEmployeeId: employeeId,
      assignedEmployeeName: `${target.firstName} ${target.lastName}`.trim(),
      previousAssignee,
    };
  }

  /**
   * Block the thread's contact. Block lives on the CONTACT (Lead + Client),
   * so we stamp blockedAt/blockedReason/blockedByUserId on BOTH the thread's
   * Lead AND Client (whichever exist) and ARCHIVE the thread in the same
   * transaction. Once blocked, the webhook ingest drops inbound messages and
   * calls (no thread/message/ring) and the bot stays silent.
   *
   * Scoped through getOrFail — sales may only block their OWN assigned leads;
   * admin (canViewAll) may block any. Caller must have whatsapp.block
   * (PermissionGuard already enforces).
   */
  async block(caller: CallerContext, threadId: string, reason?: string) {
    // getOrFail applies the same ownership scoping as a read (sales = own
    // leads only, admin = any) and 404s a thread the caller can't see.
    const t = await this.getOrFail(caller, threadId);
    const now = new Date();
    const leadId = t.lead?.id ?? null;
    const clientId = t.client?.id ?? null;
    if (!leadId && !clientId) {
      throw new BadRequestException('This conversation has no linked contact to block.');
    }

    const blockData = {
      blockedAt: now,
      blockedReason: reason ?? null,
      blockedByUserId: caller.userId,
    };

    // Stamp the block on whichever contact rows exist, archive the thread, and
    // write the audit timeline — all atomically (mirror reassign's $transaction).
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (leadId) {
      ops.push(this.prisma.lead.update({ where: { id: leadId }, data: blockData }));
    }
    if (clientId) {
      ops.push(this.prisma.client.update({ where: { id: clientId }, data: blockData }));
    }
    ops.push(
      this.prisma.whatsAppThread.update({
        where: { id: threadId },
        data: { status: 'ARCHIVED' },
      }),
    );
    // Timeline entry on the contact (Client-rooted if converted, else Lead).
    ops.push(
      this.prisma.activityTimeline.create({
        data: {
          entityType: clientId ? 'Client' : 'Lead',
          entityId: (clientId ?? leadId)!,
          leadId: leadId ?? undefined,
          clientId: clientId ?? undefined,
          // No dedicated block enum value (would need a migration); reuse the
          // WhatsApp opt-out event + disambiguate via metadata.action — same
          // pattern reassign uses with WHATSAPP_ASSIGNED + metadata.via.
          eventType: 'WHATSAPP_OPTED_OUT',
          description: reason
            ? `WhatsApp contact blocked: ${reason}`
            : 'WhatsApp contact blocked',
          actorUserId: caller.userId,
          metadata: { threadId, action: 'block', reason: reason ?? null },
        },
      }),
    );
    await this.prisma.$transaction(ops);

    return { threadId, leadId, clientId, blocked: true };
  }

  /**
   * Unblock the thread's contact — clears blockedAt/blockedReason/
   * blockedByUserId on the Lead + Client (whichever exist). Does NOT
   * un-archive the thread (archive is an independent thread-level state).
   * Same getOrFail scoping + whatsapp.block permission as block().
   */
  async unblock(caller: CallerContext, threadId: string) {
    const t = await this.getOrFail(caller, threadId);
    const leadId = t.lead?.id ?? null;
    const clientId = t.client?.id ?? null;
    if (!leadId && !clientId) {
      throw new BadRequestException('This conversation has no linked contact to unblock.');
    }

    const clearData = {
      blockedAt: null,
      blockedReason: null,
      blockedByUserId: null,
    };

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (leadId) {
      ops.push(this.prisma.lead.update({ where: { id: leadId }, data: clearData }));
    }
    if (clientId) {
      ops.push(this.prisma.client.update({ where: { id: clientId }, data: clearData }));
    }
    ops.push(
      this.prisma.activityTimeline.create({
        data: {
          entityType: clientId ? 'Client' : 'Lead',
          entityId: (clientId ?? leadId)!,
          leadId: leadId ?? undefined,
          clientId: clientId ?? undefined,
          eventType: 'WHATSAPP_OPTED_OUT',
          description: 'WhatsApp contact unblocked',
          actorUserId: caller.userId,
          metadata: { threadId, action: 'unblock' },
        },
      }),
    );
    await this.prisma.$transaction(ops);

    return { threadId, blocked: false };
  }

  /**
   * Archive the thread (status=ARCHIVED) — parks it out of the working inbox
   * without blocking the contact. Thread-level only; no contact change.
   * Scoped through getOrFail; caller must have whatsapp.send_message.
   */
  async archive(caller: CallerContext, threadId: string) {
    const t = await this.getOrFail(caller, threadId);
    const leadId = t.lead?.id ?? null;
    const clientId = t.client?.id ?? null;
    if (!leadId && !clientId) {
      throw new BadRequestException('This conversation has no linked contact to act on.');
    }

    await this.prisma.$transaction([
      this.prisma.whatsAppThread.update({
        where: { id: threadId },
        data: { status: 'ARCHIVED' },
      }),
      this.prisma.activityTimeline.create({
        data: {
          entityType: clientId ? 'Client' : 'Lead',
          entityId: (clientId ?? leadId)!,
          leadId: leadId ?? undefined,
          clientId: clientId ?? undefined,
          // Reuse the conversation-resolved event (archiving parks the chat);
          // metadata.action distinguishes archive from a true resolve.
          eventType: 'WHATSAPP_CONVERSATION_RESOLVED',
          description: 'WhatsApp thread archived',
          actorUserId: caller.userId,
          metadata: { threadId, action: 'archive' },
        },
      }),
    ]);

    return { threadId, status: 'ARCHIVED' as const };
  }

  /**
   * Un-archive the thread (status back to OPEN). Scoped through getOrFail;
   * caller must have whatsapp.send_message.
   */
  async unarchive(caller: CallerContext, threadId: string) {
    const t = await this.getOrFail(caller, threadId);
    const leadId = t.lead?.id ?? null;
    const clientId = t.client?.id ?? null;
    if (!leadId && !clientId) {
      throw new BadRequestException('This conversation has no linked contact to act on.');
    }

    await this.prisma.$transaction([
      this.prisma.whatsAppThread.update({
        where: { id: threadId },
        data: { status: 'OPEN' },
      }),
      this.prisma.activityTimeline.create({
        data: {
          entityType: clientId ? 'Client' : 'Lead',
          entityId: (clientId ?? leadId)!,
          leadId: leadId ?? undefined,
          clientId: clientId ?? undefined,
          eventType: 'WHATSAPP_CONVERSATION_RESOLVED',
          description: 'WhatsApp thread unarchived',
          actorUserId: caller.userId,
          metadata: { threadId, action: 'unarchive' },
        },
      }),
    ]);

    return { threadId, status: 'OPEN' as const };
  }

  /**
   * Pin a thread to the top of the CALLING agent's inbox — personal (each rep
   * has their own set), WhatsApp-style, capped at 6. Idempotent: pinning an
   * already-pinned chat is a no-op success. Scoped through getOrFail so an agent
   * can only pin a chat they're allowed to see. Permission: whatsapp.view_inbox
   * (viewing/pinning is a personal read-side action).
   */
  async pin(caller: CallerContext, threadId: string): Promise<{ threadId: string; pinned: true }> {
    // getOrFail applies the caller's scope + 404s a thread they can't see.
    await this.getOrFail(caller, threadId);
    if (!caller.employeeId) {
      throw new BadRequestException('Only an employee account can pin chats.');
    }
    const existing = await this.prisma.whatsAppThreadPin.findUnique({
      where: { threadId_employeeId: { threadId, employeeId: caller.employeeId } },
      select: { id: true },
    });
    if (existing) return { threadId, pinned: true };
    const count = await this.prisma.whatsAppThreadPin.count({
      where: { employeeId: caller.employeeId },
    });
    if (count >= 6) {
      throw new BadRequestException('You can pin up to 6 chats — unpin one first.');
    }
    try {
      await this.prisma.whatsAppThreadPin.create({
        data: { threadId, employeeId: caller.employeeId },
      });
    } catch (e) {
      // Unique race (two tabs pin the same chat at once) — treat as success.
      if ((e as { code?: string }).code !== 'P2002') throw e;
    }
    return { threadId, pinned: true };
  }

  /**
   * Unpin a thread from the calling agent's inbox. Idempotent — unpinning a
   * chat that isn't pinned is a no-op success. Only touches THIS agent's pin.
   */
  async unpin(caller: CallerContext, threadId: string): Promise<{ threadId: string; pinned: false }> {
    if (!caller.employeeId) return { threadId, pinned: false };
    await this.prisma.whatsAppThreadPin.deleteMany({
      where: { threadId, employeeId: caller.employeeId },
    });
    return { threadId, pinned: false };
  }

  /**
   * Every currently-blocked contact (Lead + Client) for the blocked-numbers
   * admin view. Returns a flat list of { contactType, contactId, name, phone,
   * blockedAt, blockedReason, blockedByName }. Caller must have
   * whatsapp.view_all_inboxes (PermissionGuard enforces) — this is an org-wide
   * audit view, not scoped per agent.
   */
  async blockedNumbers(): Promise<
    Array<{
      contactType: 'lead' | 'client';
      contactId: string;
      name: string;
      phone: string;
      blockedAt: Date;
      blockedReason: string | null;
      blockedByName: string | null;
      threadId: string | null;
    }>
  > {
    const [leads, clients] = await Promise.all([
      this.prisma.lead.findMany({
        where: { blockedAt: { not: null }, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          blockedAt: true,
          blockedReason: true,
          blockedByUserId: true,
          whatsappThread: { select: { id: true } },
        },
        orderBy: { blockedAt: 'desc' },
      }),
      this.prisma.client.findMany({
        where: { blockedAt: { not: null }, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          blockedAt: true,
          blockedReason: true,
          blockedByUserId: true,
          whatsappThreads: { select: { id: true }, orderBy: { lastMessageAt: 'desc' }, take: 1 },
        },
        orderBy: { blockedAt: 'desc' },
      }),
    ]);

    // Resolve the actor names in one batch (blockedByUserId has no FK relation
    // — it's an id reference only, same convention as the schema note).
    const actorIds = Array.from(
      new Set(
        [...leads, ...clients]
          .map((r) => r.blockedByUserId)
          .filter((id): id is string => !!id),
      ),
    );
    const actors = actorIds.length
      ? await this.prisma.userAccount.findMany({
          where: { id: { in: actorIds } },
          // The display name lives on the linked Employee, not the UserAccount
          // (which only carries email/phone). blockedByUserId is a UserAccount id.
          select: { id: true, employee: { select: { firstName: true, lastName: true } } },
        })
      : [];
    const actorName = new Map(
      actors.map((a) => [
        a.id,
        a.employee ? `${a.employee.firstName} ${a.employee.lastName}`.trim() || null : null,
      ]),
    );

    const rows = [
      ...leads.map((l) => ({
        contactType: 'lead' as const,
        contactId: l.id,
        name: `${l.firstName} ${l.lastName}`.trim(),
        phone: l.phone,
        blockedAt: l.blockedAt!,
        blockedReason: l.blockedReason,
        blockedByName: l.blockedByUserId ? actorName.get(l.blockedByUserId) ?? null : null,
        threadId: l.whatsappThread?.id ?? null,
      })),
      ...clients.map((c) => ({
        contactType: 'client' as const,
        contactId: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        phone: c.phone,
        blockedAt: c.blockedAt!,
        blockedReason: c.blockedReason,
        blockedByName: c.blockedByUserId ? actorName.get(c.blockedByUserId) ?? null : null,
        threadId: c.whatsappThreads[0]?.id ?? null,
      })),
    ];
    // Newest block first across both contact types.
    rows.sort((a, b) => b.blockedAt.getTime() - a.blockedAt.getTime());
    return rows;
  }
}
