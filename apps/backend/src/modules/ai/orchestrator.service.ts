import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OpenAiService } from './openai.service';
import { KnowledgeService, type KnowledgeMatch } from './knowledge.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WhatsAppAppointmentNotifierService } from '../whatsapp/notifications/appointment-notifier.service';
import { AppointmentBookingService } from '../appointments/appointment-booking.service';

/**
 * The bot's brain. One call per inbound TEXT message after a 60-second
 * debounce (see webhook-ingest.processor). Decides whether to send an
 * automatic reply, then composes one focused on the firm's funnel goal —
 * book a consultation for new leads.
 *
 *   Pre-flight skip (any of these → don't reply):
 *     • Bot disabled at org level (botMode === 'DISABLED')
 *     • Bot not enabled yet at org level (botEnabledAt null/future)
 *     • Lead has a ProcessingCase OR a FinanceHandover ("paid client" rule —
 *       only humans on these threads)
 *     • Thread's `aiEnabled` flag is OFF (someone manually disabled AI here)
 *     • A human agent sent outbound in the last 4 hours OR `aiDisabledAt`
 *       is within 4 hours (same rule, different sources)
 *     • Another inbound came in AFTER ours (debounce: only reply to the
 *       most recent message in the burst)
 *     • Empty / single-emoji message
 *
 *   Compose:
 *     Pulls the last 10 messages on the thread for context, the top-5 RAG
 *     matches from `ai.knowledge`, and runs gpt-4o-mini with an appointment-
 *     funnel system prompt. The reply is always:
 *
 *       1. Deterministic — if the answer isn't in the retrieved CONTEXT
 *          the bot pivots to "let me book you a call with our consultant"
 *          instead of guessing.
 *       2. In the user's language (English / Roman Urdu).
 *       3. Funnel-aware — earlier turns answer questions, later turns
 *          (3+ inbound messages on the thread) move toward booking.
 */
/**
 * Bot reply policy (per business decision):
 *
 *   • New inbound: webhook enqueues an AI reply with a 60-second delay.
 *     When the job fires, we check whether a HUMAN agent has replied to
 *     (or after) this exact inbound. If yes → skip; if no → bot replies.
 *     This gives sales a 1-minute grace window on every customer message
 *     without locking the bot out for hours.
 *
 *   • Safety net: a periodic backfill sweep picks up any inbound that's
 *     been waiting > 20 hours with no human reply — the bot then jumps
 *     in so we don't blow the WhatsApp 24-hour customer-service window.
 *
 * We deliberately do NOT keep a multi-hour "human lockout" any more: it
 * was blocking the bot even when sales had drifted away from the
 * conversation. The "human-replied-since-this-inbound?" check is precise
 * and self-resetting — every new inbound gets a fresh 1-minute grace.
 */
const STALE_INBOUND_BACKFILL_MS = 20 * 60 * 60 * 1000;
const HISTORY_TURNS = 10;
const APPOINTMENT_NUDGE_AFTER_TURNS = 2;

/**
 * Holiday booking floor. When set to a FUTURE instant, the bot still books
 * end-to-end but floors every slot to this cutoff AND the LLM is told to say
 * consultations resume then (see `eidNotice`). When set to a PAST instant —
 * the normal state — the window is inactive: no holiday notice, no flooring.
 *
 * Eid 2026 is over and we're back to normal hours (Mon–Sat), so this is parked
 * in the past and the holiday notice is OFF. To re-enable for a future holiday,
 * set it to the return date as a fixed UTC instant (e.g. a Monday 00:00 PKT ===
 * the preceding Sunday 19:00 UTC). No other change needed.
 */
const APPOINTMENT_BOOKING_FLOOR = new Date('2020-01-01T00:00:00.000Z');
const APPOINTMENT_BOOKING_FLOOR_DEFAULT_HOUR_PKT = 10; // 10:00 AM (only used while a future floor is active)

/** True while we're still before the booking floor (Eid window active). */
function inEidBookingWindow(now: Date = new Date()): boolean {
  return now.getTime() < APPOINTMENT_BOOKING_FLOOR.getTime();
}

/**
 * If the proposed slot is before the Eid floor, bump it forward to the
 * floor — preserving the customer's preferred HOUR when possible (so
 * "Tuesday 3pm" before the floor lands on the floor-day at 3pm, not the
 * default morning). When no time component is set on the original (e.g.
 * we floored a midnight-only date), use the default morning hour.
 */
function applyEidFloor(proposed: Date): Date {
  if (proposed.getTime() >= APPOINTMENT_BOOKING_FLOOR.getTime()) return proposed;
  const floor = new Date(APPOINTMENT_BOOKING_FLOOR);
  const hours = proposed.getHours();
  const minutes = proposed.getMinutes();
  // If the proposed slot has a meaningful hour (not 00:00), keep it on the
  // floor day. Otherwise default to 10:00 AM PKT.
  if (hours === 0 && minutes === 0) {
    floor.setHours(APPOINTMENT_BOOKING_FLOOR_DEFAULT_HOUR_PKT, 0, 0, 0);
  } else {
    floor.setHours(hours, minutes, 0, 0);
  }
  return floor;
}

// Office hours — every auto-booked consultation (phone / Google Meet / office
// visit) must land inside the working day. Interpreted in the server's local
// timezone (Asia/Karachi / PKT) — the same convention applyEidFloor uses.
const OFFICE_OPEN_HOUR = 9; // 09:00
const OFFICE_CLOSE_HOUR = 18; // 18:00 (6 PM); bookable window is [09:00, 18:00)
const OFFICE_HOURS = 'Monday–Saturday, 9 AM–6 PM (Pakistan time)';
const OFFICE_ADDRESS =
  'Office No. 3029B, 3rd Floor, World Trade Centre, Giga Mall, Sector F, DHA Phase 2, Islamabad';

/**
 * Clamp a proposed slot into office hours AND working days. Before opening →
 * 09:00 the same day; at/after closing → 09:00 the next day; minutes within an
 * open hour are kept. Working days are Monday–Saturday, so a slot that lands on
 * Sunday (getDay() === 0) is pushed to Monday, keeping the in-range hour.
 */
function clampToOfficeHours(proposed: Date): Date {
  const d = new Date(proposed);
  const h = d.getHours();
  if (h < OFFICE_OPEN_HOUR) {
    d.setHours(OFFICE_OPEN_HOUR, 0, 0, 0);
  } else if (h >= OFFICE_CLOSE_HOUR) {
    d.setDate(d.getDate() + 1);
    d.setHours(OFFICE_OPEN_HOUR, 0, 0, 0);
  }
  // Closed Sunday — working week is Mon–Sat. Push Sunday → Monday (same hour).
  if (d.getDay() === 0) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

// The "roll forward to the next free slot" search (firstFreeSlot) now lives in
// the shared appointments.util and is driven by AppointmentBookingService — the
// bot books through that engine (conflict:'advance'), passing clampToOfficeHours
// above as its office-hours policy. One double-booking authority platform-wide.

/**
 * Jaccard similarity threshold above which a freshly-composed reply is
 * treated as a duplicate of the last bot outbound on the thread. Token
 * overlap above this means "we're about to say the same thing again" — we
 * skip rather than spam. 0.7 is strict (most words shared); occasional
 * legit repeats (e.g. the canned HANDED_OFF confirmation) won't trip it.
 */
const DUPLICATE_REPLY_JACCARD = 0.7;

export type RunMode = 'AUTO' | 'SKIPPED' | 'OPT_OUT';

export interface OrchestratorInput {
  threadId: string;
  inboundMessageId: string;
  inboundText: string;
  language?: string;
}

export interface OrchestratorDecision {
  mode: RunMode;
  skipReason?: string;
  reply?: string;
  topMatch?: KnowledgeMatch;
  retrieved?: KnowledgeMatch[];
  language?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  model?: string;
  /** Next-turn state for the thread's `aiState` column. */
  nextAiState?: string;
  /**
   * When set, the AI reply processor sends this brochure as a follow-up
   * DOCUMENT message after the text reply. Programs are matched from the
   * customer's inbound via regex + a one-shot extraction call. Already-sent
   * brochures (recorded in past message payloads) won't repeat.
   */
  attachBrochure?: {
    programKey: string;
    s3Key: string;
    displayTitle: string;
    mimeType: string;
  };
}

@Injectable()
export class OrchestratorService {
  private readonly log = new Logger(OrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openai: OpenAiService,
    private readonly knowledge: KnowledgeService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly whatsappNotifier: WhatsAppAppointmentNotifierService,
    private readonly booking: AppointmentBookingService,
  ) {}

  async decide(input: OrchestratorInput): Promise<OrchestratorDecision> {
    // ── 1. Org-level enable check ──────────────────────────────────────────
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true, timezone: true, botEnabledAt: true, botMode: true },
    });
    if (!org) return { mode: 'SKIPPED', skipReason: 'no-organization' };
    if (org.botMode === 'DISABLED') return { mode: 'SKIPPED', skipReason: 'bot-disabled' };
    if (!org.botEnabledAt || org.botEnabledAt.getTime() > Date.now()) {
      return { mode: 'SKIPPED', skipReason: 'bot-not-yet-enabled' };
    }

    // ── 2. Load thread + paid-client status (one query each) ───────────────
    const thread = await this.prisma.whatsAppThread.findUnique({
      where: { id: input.threadId },
      select: {
        id: true,
        leadId: true,
        clientId: true,
        aiEnabled: true,
        aiDisabledAt: true,
        aiState: true,
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            convertedClientId: true,
            // Assigned agent's first name — used in the bot's welcome line
            // so the customer sees a real human's name behind the bot:
            // "Welcome to Tashfeen Immigration Solutions. I'm Iffat,
            // Immigration Solutions Associate…"
            assignedEmployee: {
              select: { firstName: true },
            },
          },
        },
      },
    });
    if (!thread) return { mode: 'SKIPPED', skipReason: 'thread-not-found' };
    if (!thread.aiEnabled) return { mode: 'SKIPPED', skipReason: 'ai-disabled-on-thread' };

    // Per-inbound human-reply check: did a real agent already respond to
    // (or after) the message we're about to answer? If yes, sales has it
    // covered — stay out. This replaces the old multi-hour "human lockout"
    // window: that was too coarse, locking the bot out long after sales
    // had drifted away. Now every new inbound earns its own 1-minute grace
    // (via the webhook's 60s delay) and the bot fills in only when sales
    // really didn't reply.
    const inboundAt = await this.inboundMessageCreatedAt(input.inboundMessageId);
    if (inboundAt) {
      const humanReplied = await this.prisma.whatsAppMessage.findFirst({
        where: {
          threadId: thread.id,
          direction: 'OUTBOUND',
          sentByEmployeeId: { not: null },  // human send (bot is null)
          createdAt: { gte: inboundAt },
        },
        select: { id: true },
      });
      if (humanReplied) {
        return { mode: 'SKIPPED', skipReason: 'human-replied-after-inbound' };
      }
    }

    // Funnel-state stop: once we've handed off to a real consultant, the bot
    // stays out of the way. Any further reply would be either "consultant
    // will reach out" (already said) or noise.
    if (thread.aiState === 'HANDED_OFF') {
      return { mode: 'SKIPPED', skipReason: 'handed-off' };
    }

    // No bot-reply count cap. The bot keeps engaging the lead for as long as
    // the lead keeps replying and no human steps in — we'd rather nurture the
    // lead than go silent at an arbitrary message count. The loop protections
    // are instead:
    //   • per-inbound human-reply check above — the bot yields the moment an
    //     agent replies, and only fills back in if the lead messages again and
    //     the agent stays silent;
    //   • HANDED_OFF stop — once an appointment is booked / the lead opts out /
    //     media is received, the bot goes quiet for good;
    //   • the duplicate-reply guard below — the bot never repeats itself, so a
    //     probing loop can't produce the same message twice;
    //   • the 60s debounce + reply-only-to-latest-inbound — one reply per turn.

    // ── 3. Paid client = has a ProcessingCase OR any FinanceHandover ───────
    //    Per user's spec: "paid clients are those who are in processing or
    //    in finance, only humans". We treat ANY FinanceHandover (regardless
    //    of status) and ANY ProcessingCase as the "money is in motion" mark.
    if (thread.lead?.id) {
      const [proc, handover] = await Promise.all([
        this.prisma.processingCase.findFirst({
          where: { leadId: thread.lead.id },
          select: { id: true },
        }),
        this.prisma.financeHandover.findFirst({
          where: { leadId: thread.lead.id },
          select: { id: true },
        }),
      ]);
      if (proc) return { mode: 'SKIPPED', skipReason: 'in-processing' };
      if (handover) return { mode: 'SKIPPED', skipReason: 'in-finance' };
    }
    if (thread.clientId || thread.lead?.convertedClientId) {
      return { mode: 'SKIPPED', skipReason: 'converted-client' };
    }

    // ── 3.5 Opt-out: customer asked us to stop. Send one final ack + disable
    //    AI on this thread permanently. The processor flips thread.aiEnabled
    //    based on mode='OPT_OUT'.
    if (this.isOptOutIntent(input.inboundText)) {
      const language = this.detectLanguage(input.inboundText);
      return {
        mode: 'OPT_OUT',
        reply: this.optOutAcknowledgement(language),
        language,
        nextAiState: 'HANDED_OFF',
      };
    }

    // ── 4. Debounce: only reply to the latest message in a burst ───────────
    //    If a newer inbound arrived after ours we abort — the newer one's
    //    own delayed job will take over with the merged context.
    const newer = await this.prisma.whatsAppMessage.findFirst({
      where: {
        threadId: thread.id,
        direction: 'INBOUND',
        createdAt: { gt: (await this.inboundMessageCreatedAt(input.inboundMessageId)) ?? new Date(0) },
        id: { not: input.inboundMessageId },
      },
      select: { id: true },
    });
    if (newer) return { mode: 'SKIPPED', skipReason: 'newer-inbound-superseded' };

    // ── 5. Pull recent conversation history for multi-turn context ─────────
    const history = await this.prisma.whatsAppMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TURNS,
      select: {
        direction: true,
        body: true,
        sentByEmployeeId: true,
        createdAt: true,
      },
    });
    history.reverse();

    // ── 6. Retrieve top-5 knowledge matches ────────────────────────────────
    let retrieved: KnowledgeMatch[];
    try {
      retrieved = await this.knowledge.search(input.inboundText, 5);
    } catch (e) {
      this.log.error(`retrieval failed: ${(e as Error).message}`);
      return { mode: 'SKIPPED', skipReason: 'retrieval-failed' };
    }

    // ── 7. Decide funnel phase + compose ───────────────────────────────────
    const language = input.language ?? this.detectLanguage(input.inboundText);
    const inboundCount = history.filter((m) => m.direction === 'INBOUND').length;
    const nextAiState = this.decideNextState(thread.aiState, inboundCount, input.inboundText);
    const topSim = retrieved[0]?.similarity ?? 0;
    // Confidence floor: below this we tell the LLM to skip answering from
    // its own knowledge and just push toward booking. Started at 0.62 but
    // that was too aggressive — straightforward questions like "Pakistan
    // mein office kahaan hai" landed at ~0.55 similarity and the bot
    // pivoted instead of just answering with "Islamabad + Karachi" which
    // is right there in CONTEXT. 0.50 is a calmer floor.
    const confident = topSim >= 0.50;

    // First-ever bot reply on this thread? Used to drive a proper welcome
    // template ("Welcome to Tashfeen Immigration Solutions. I'm <agent>,
    // Immigration Solutions Associate…"). We treat "no prior OUTBOUND bot
    // message in history" as the trigger — works for new leads AND for
    // existing-lead threads that just got bot-enabled.
    const isFirstBotReply = !history.some(
      (m) => m.direction === 'OUTBOUND' && m.sentByEmployeeId === null,
    );
    // Bare greeting detection: customer said "hi" / "hello" / "salam" / etc.
    // with no actual question attached. Drives the "how can we assist you
    // today?" branch of the welcome.
    const isBareGreeting = this.isBareGreeting(input.inboundText);

    // ── Strict grounding gate ──────────────────────────────────────────────
    // For a substantive question with NO confident, on-point KB match, the bot
    // is NOT allowed to answer from its own (parametric) knowledge — it must
    // clarify or book instead. This deterministically kills the "improvise"
    // path that produced wrong program facts (e.g. "C11 is for skilled
    // workers", "a doctor may be eligible for C11"). Exemptions: bare greetings
    // and the booking-flow states (giving a time / confirming) don't need KB
    // grounding, and the persona's KNOWN FACTS (office, hours, service NAMES)
    // stay answerable regardless. STRICT_GROUNDING_FLOOR is the main tuning
    // knob — raise it for stricter, lower it for chattier.
    const STRICT_GROUNDING_FLOOR = 0.62;
    const strictGate =
      topSim < STRICT_GROUNDING_FLOOR &&
      !isBareGreeting &&
      nextAiState !== 'HANDED_OFF' &&
      nextAiState !== 'APPOINTMENT_AVAILABILITY';

    // Resolved once here so the welcome can be prepended DETERMINISTICALLY below
    // (the LLM must not author the rep's name — it drifted to other reps).
    // Sanitize: empty / placeholder / digit-only first names get dropped so the
    // bot doesn't greet "Hi Customer 1234" or "Hi +92345…". Imports sometimes
    // leave junk in firstName until sales cleans it up.
    const leadFirstName = this.sanitizedFirstName(thread.lead?.firstName);
    const agentFirstName = thread.lead?.assignedEmployee?.firstName ?? null;
    const systemPrompt = this.systemPrompt({
      language,
      currentState: thread.aiState,
      nextState: nextAiState,
      confident,
      strictGate,
      leadFirstName,
      agentFirstName,
      isFirstBotReply,
      isBareGreeting,
    });
    const contextBlock = this.formatContext(retrieved);
    const historyBlock = this.formatHistory(history, input.inboundText);

    let res;
    try {
      res = await this.openai.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${contextBlock}\n\n${historyBlock}` },
      ]);
    } catch (e) {
      this.log.error(`chat failed: ${(e as Error).message}`);
      return { mode: 'SKIPPED', skipReason: `chat-failed: ${(e as Error).message}` };
    }

    let reply = res.reply.trim();
    if (!reply) return { mode: 'SKIPPED', skipReason: 'empty-reply' };
    if (this.looksLikeGuarantee(reply)) {
      this.log.warn(`Guarantee phrase detected, escalating instead: "${reply.slice(0, 80)}…"`);
      reply = this.escalationFallback(language);
    }

    // Strict-grounding backstop. In a gated turn the model was told to ONLY
    // clarify or book. If it nonetheless leaked an eligibility claim or a
    // fee/amount, we deterministically swap in the safe pivot rather than let a
    // guess reach the customer — the belt to the prompt's braces.
    if (strictGate && this.leaksSpecifics(reply)) {
      this.log.warn(`Strict-grounding backstop tripped: "${reply.slice(0, 80)}…"`);
      reply = this.groundingFallback(language);
    }

    // Consultation-fee backstop (ALWAYS on, not just gated turns). The initial
    // consultation is FREE, but the model has repeatedly invented a
    // "consultation fee" when asked — especially after a booking (54 such
    // messages to 42 leads before this guard). If a reply ties a fee/charge to
    // the consultation and doesn't say it's free, deterministically replace it
    // with the correct free-consultation line. Negation-aware: a correct
    // "no consultation fee / it's free" reply is never clobbered.
    if (this.impliesPaidConsultation(reply)) {
      this.log.warn(`Consultation-fee backstop tripped: "${reply.slice(0, 80)}…"`);
      reply = this.consultationFreeReply(language);
    }

    // Dedup guard: don't repeat ourselves verbatim if the bot just sent a
    // near-identical message on this thread. Catches the loop failure mode
    // where retrieval returns the same top-1 + the LLM riffs almost the
    // same response. Jaccard token overlap > 0.7 → SKIP.
    const lastBotOutbound = await this.prisma.whatsAppMessage.findFirst({
      where: {
        threadId: thread.id,
        direction: 'OUTBOUND',
        sentByEmployeeId: null, // bot-sent messages only
        body: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    });
    if (lastBotOutbound?.body && this.tooSimilar(lastBotOutbound.body, reply)) {
      this.log.warn(`Duplicate-reply skip: "${reply.slice(0, 60)}…" vs last "${lastBotOutbound.body.slice(0, 60)}…"`);
      return { mode: 'SKIPPED', skipReason: 'duplicate-reply' };
    }

    // Prepend the house welcome DETERMINISTICALLY on the first bot reply, with
    // the lead's ACTUAL assigned rep — never an LLM-written name (which drifted
    // to other reps ~4% of the time). agentFirstName is the live-read assignee;
    // if the lead is unassigned we greet without a name rather than guess.
    if (isFirstBotReply) {
      const greetName = leadFirstName ? `, ${leadFirstName}` : '';
      const intro = agentFirstName
        ? ` I'm ${agentFirstName}, Immigration Solutions Associate.`
        : '';
      reply =
        `Welcome to Tashfeen Immigration Solutions${greetName}!${intro}\n\n${reply}`.trim();
    }

    // Brochure intent: if the customer asked for a brochure / PDF / details,
    // figure out which program they meant + look up the file. The AI reply
    // processor sends the brochure as a follow-up DOCUMENT message after the
    // text reply lands. Dedup: same brochure already on this thread → skip.
    let attachBrochure: OrchestratorDecision['attachBrochure'] | undefined;
    if (this.mentionsBrochure(input.inboundText)) {
      try {
        attachBrochure = await this.resolveBrochureToAttach(
          input.inboundText,
          history.map((m) => ({ direction: m.direction, body: m.body })),
          thread.id,
        );
      } catch (e) {
        this.log.warn(`brochure resolve failed: ${(e as Error).message}`);
      }
    }

    // If the funnel just landed on HANDED_OFF this turn, extract structured
    // appointment intent from the customer's message and write a row to
    // crm.appointment_requests. Sales picks it up from the chat panel banner
    // and uses it to pre-fill the existing "Book Appointment" modal.
    if (nextAiState === 'HANDED_OFF' && thread.aiState !== 'HANDED_OFF' && thread.lead?.id) {
      // Fire-and-forget: a failure to extract should NOT block the reply.
      void this.extractAndSaveAppointmentRequest({
        leadId: thread.lead.id,
        threadId: thread.id,
        inboundMessageId: input.inboundMessageId,
        rawText: input.inboundText,
      }).catch((e) =>
        this.log.warn(`appointment-request extract failed: ${(e as Error).message}`),
      );
    }

    return {
      mode: 'AUTO',
      reply,
      topMatch: retrieved[0],
      retrieved,
      language,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      latencyMs: res.latencyMs,
      model: res.model,
      nextAiState,
      attachBrochure,
    };
  }

  /**
   * Second OpenAI call (small, ~150 tokens) that parses the customer's
   * scheduling message into structured fields. We don't try to be clever in
   * regex — natural-language schedule parsing across English + Roman Urdu
   * is a job for the LLM, and gpt-4o-mini is cheap enough that one extra
   * call per HANDED_OFF transition is a non-issue.
   *
   * Returns nothing — writes the AppointmentRequest row as a side effect.
   * Safe to fail silently: the customer still gets the reply, sales still
   * gets the conversation, the "pending request" badge just won't appear.
   */
  private async extractAndSaveAppointmentRequest(opts: {
    leadId: string;
    threadId: string;
    inboundMessageId: string;
    rawText: string;
  }): Promise<void> {
    const prompt = [
      `Extract appointment-booking intent from the customer's message.`,
      `Return STRICT JSON with exactly these keys:`,
      `  preferredDay: string | null  // "Monday", "Tuesday", … or "today", "tomorrow", or a date "2026-06-03", or null`,
      `  preferredTime: string | null // "morning", "afternoon", "evening", or "15:00" / "3pm", or null`,
      `  modality: "CALL" | "VIDEO" | "IN_PERSON" | "UNKNOWN"`,
      `Rules:`,
      `- "call" / "phone" → CALL; "meet" / "google meet" / "video" / "zoom" → VIDEO; "office" / "visit" / "visit office" → IN_PERSON; otherwise UNKNOWN.`,
      `- Roman Urdu: "subha"=morning, "sham"=evening, "kal"=tomorrow, "aaj"=today, "Monday"="Monday" etc.`,
      `- Output ONLY the JSON. No code fences, no commentary.`,
      ``,
      `Customer message: """${opts.rawText.slice(0, 500)}"""`,
    ].join('\n');

    const res = await this.openai.chat([
      { role: 'system', content: 'You extract structured fields from chat messages. Always output strict JSON.' },
      { role: 'user', content: prompt },
    ]);
    let parsed: { preferredDay?: string | null; preferredTime?: string | null; modality?: string } | null = null;
    try {
      const cleaned = (res.reply ?? '').replace(/^```(json)?|```$/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = null;
    }
    const modality = ['CALL', 'VIDEO', 'IN_PERSON'].includes(parsed?.modality ?? '')
      ? (parsed!.modality as string)
      : 'UNKNOWN';

    const requestRow = await this.prisma.appointmentRequest.create({
      data: {
        leadId: opts.leadId,
        threadId: opts.threadId,
        extractedFromMessageId: opts.inboundMessageId,
        rawText: opts.rawText.slice(0, 1000),
        preferredDay: parsed?.preferredDay ?? null,
        preferredTime: parsed?.preferredTime ?? null,
        modality,
        status: 'PENDING',
      },
    });

    // Auto-book attempt: if we can parse the day + time AND the lead has an
    // assigned agent AND the parsed date is in the future, create the
    // Appointment directly and notify the agent by email + bell. Any failure
    // (no agent / unparseable / past date / DB) falls back to the existing
    // PENDING flow so sales can book manually from the chat-panel banner.
    await this.tryAutoBookFromRequest({
      requestId: requestRow.id,
      leadId: opts.leadId,
      preferredDay: parsed?.preferredDay ?? null,
      preferredTime: parsed?.preferredTime ?? null,
      modality,
      rawText: opts.rawText.slice(0, 200),
    });
  }

  /**
   * Materialise an AppointmentRequest into a real Appointment + notify the
   * assigned agent. Side effects, in order:
   *   1. Parse preferredDay + preferredTime → concrete Date
   *   2. Create the Appointment (status SCHEDULED, assigned to lead's agent)
   *   3. Flip the request to CONFIRMED + link the appointment id
   *   4. Email the agent
   *   5. Create an in-app Notification (bell badge)
   *
   * Every step is best-effort: failure anywhere is logged and we exit
   * silently. The PENDING request still exists on the chat-panel banner so
   * sales can book manually if anything went wrong.
   */
  private async tryAutoBookFromRequest(opts: {
    requestId: string;
    leadId: string;
    preferredDay: string | null;
    preferredTime: string | null;
    modality: string;
    rawText: string;
  }): Promise<void> {
    try {
      const rawScheduledAt = this.parsePreferredDateTime(opts.preferredDay, opts.preferredTime);
      if (!rawScheduledAt) {
        this.log.debug(`auto-book: can't parse "${opts.preferredDay}" + "${opts.preferredTime}", staying PENDING`);
        return;
      }
      // Eid holiday floor: if the customer asked for a slot before the
      // floor (i.e. before Monday 09:00 PKT during the holiday window),
      // bump it forward to the floor. The bot's HANDED_OFF reply prompt
      // tells the customer slots resume Monday-onwards, so this stays
      // honest end-to-end.
      const flooredAt = applyEidFloor(rawScheduledAt);
      if (rawScheduledAt.getTime() !== flooredAt.getTime()) {
        this.log.log(
          `auto-book: Eid floor applied — moved ${rawScheduledAt.toISOString()} → ${flooredAt.toISOString()}`,
        );
      }
      // Keep every consultation inside office hours (9 AM–6 PM PKT).
      const scheduledAt = clampToOfficeHours(flooredAt);
      if (flooredAt.getTime() !== scheduledAt.getTime()) {
        this.log.log(
          `auto-book: office-hours clamp — moved ${flooredAt.toISOString()} → ${scheduledAt.toISOString()}`,
        );
      }
      if (scheduledAt.getTime() < Date.now() - 60_000) {
        this.log.debug(`auto-book: floored date ${scheduledAt.toISOString()} is still in the past, staying PENDING`);
        return;
      }
      const lead = await this.prisma.lead.findUnique({
        where: { id: opts.leadId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          assignedEmployeeId: true,
          convertedClientId: true,
          assignedEmployee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              user: { select: { id: true, email: true } },
            },
          },
        },
      });
      if (!lead) return;
      if (!lead.assignedEmployee) {
        this.log.debug(`auto-book: lead ${opts.leadId} has no assigned employee, staying PENDING`);
        return;
      }

      const appointmentType = this.modalityToAppointmentType(opts.modality);
      const leadFullName = `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() || 'WhatsApp lead';
      const modalityLabel = this.modalityLabel(opts.modality);

      const empId = lead.assignedEmployee.id;
      const durationMinutes = 30;

      // Availability-aware booking — the fix for "3 customers booked into the
      // same 10:00 with the same rep". Lock the rep row (serialises concurrent
      // bookings, like the lead-assignment engine), read their already-booked
      // intervals, and roll the requested time forward to the next FREE slot.
      // The confirmation message + agent email below use created.scheduledAt, so
      // the customer is always told the actual time we booked.
      // Book through the SHARED double-booking engine — the same
      // AppointmentBookingService the web/app uses, so there is one conflict
      // authority platform-wide. conflict:'advance' rolls the requested time
      // forward to the next FREE slot rather than erroring (the bot can't show a
      // 409 mid-chat); we pass the bot's own office-hours clamp so the slot
      // search is byte-for-byte what it was before. The rep row-lock + the
      // create commit atomically inside the engine's transaction.
      const { result: created, bookedAt, advanced } = await this.booking.withResolvedSlot({
        employeeId: empId,
        desiredAt: scheduledAt,
        durationMinutes,
        conflict: 'advance',
        clamp: clampToOfficeHours,
        run: (slotAt, tx) =>
          tx.appointment.create({
            data: {
              leadId: lead.id,
              clientId: lead.convertedClientId ?? null,
              assignedEmployeeId: empId,
              title: `Consultation with ${leadFullName}`,
              appointmentType,
              scheduledAt: slotAt,
              durationMinutes,
              // Office visits carry the office address so the confirmation tells
              // the client exactly where to come; calls/Meets have no location.
              location: opts.modality === 'IN_PERSON' ? OFFICE_ADDRESS : null,
              notes: `Auto-booked by AI assistant. Client said: "${opts.rawText}"`,
            },
            select: { id: true, scheduledAt: true, durationMinutes: true, appointmentType: true },
          }),
      });
      if (advanced) {
        this.log.log(
          `auto-book: ${scheduledAt.toISOString()} is taken for employee ${empId} → next free slot ${bookedAt.toISOString()}`,
        );
      }

      await this.prisma.appointmentRequest.updateMany({
        where: { id: opts.requestId, status: 'PENDING' },
        data: {
          status: 'CONFIRMED',
          linkedAppointmentId: created.id,
          closedAt: new Date(),
        },
      });

      // Email the agent — fire-and-forget.
      const agentEmail = lead.assignedEmployee.user?.email;
      const agentName = `${lead.assignedEmployee.firstName ?? ''} ${lead.assignedEmployee.lastName ?? ''}`.trim() || 'there';
      if (agentEmail) {
        void this.email
          .sendNewAppointmentToAgent({
            to: agentEmail,
            consultantName: agentName,
            leadName: leadFullName,
            leadPhone: lead.phone,
            scheduledAt: created.scheduledAt,
            durationMinutes: created.durationMinutes,
            appointmentType: created.appointmentType,
            modalityLabel,
            notes: opts.rawText,
          })
          .catch((e) => this.log.warn(`auto-book email failed: ${(e as Error).message}`));
      }

      // In-app bell notification.
      if (lead.assignedEmployee.user?.id) {
        await this.notifications.create({
          userId: lead.assignedEmployee.user.id,
          type: 'APPOINTMENT_BOOKED',
          title: `New appointment with ${leadFullName}`,
          body: `${modalityLabel} · ${this.formatWhen(created.scheduledAt)}`,
          link: '/sales/appointments',
        });
      }

      this.log.log(
        `auto-booked appointment ${created.id} for lead ${lead.id} with agent ${lead.assignedEmployee.id} at ${created.scheduledAt.toISOString()}`,
      );

      // Send the formal WhatsApp confirmation to the lead/client (Date /
      // Time / Duration / Location / Meeting / Notes block). Fire-and-forget
      // — the bot's inline HANDED_OFF ack already went out via the AI reply
      // path, and this notifier is best-effort (no_thread / window_expired
      // surface as a logged skip, never throw).
      void this.whatsappNotifier
        .sendConfirmationFor(created.id, '')
        .then((res) => {
          if (res.sent) {
            this.log.log(`auto-book confirmation sent (message ${res.messageId})`);
          } else {
            this.log.debug(`auto-book confirmation skipped: ${res.reason}`);
          }
        })
        .catch((e) =>
          this.log.warn(`auto-book confirmation failed: ${(e as Error).message}`),
        );
    } catch (e) {
      this.log.warn(`auto-book failed: ${(e as Error).message}`);
    }
  }

  /**
   * Mirror of the BookAppointmentModal frontend helpers — resolves
   * "Monday morning" / "kal subha" / "tomorrow 3pm" / "15:00" into a real
   * Date. Returns null when the bot's parser was too vague.
   *
   * Day-default behaviour: customers often say only a time ("3pm") without
   * specifying a day. In that case we assume "today" if the resulting slot
   * is still in the future, else "tomorrow" — that matches what a human
   * receptionist would do. Returns null only if BOTH day and time are
   * unparseable.
   */
  private parsePreferredDateTime(day: string | null, time: string | null): Date | null {
    let date = this.resolveDay(day);
    const hasTime = !!(time && time.trim());
    if (!date) {
      if (!hasTime) return null; // nothing usable at all
      date = new Date(); // default to today
    }
    const { hh, mm } = this.resolveTime(time);
    date.setHours(hh, mm, 0, 0);
    // If we defaulted day to today but the slot already passed, bump to tomorrow.
    if (!this.resolveDay(day) && date.getTime() <= Date.now()) {
      date.setDate(date.getDate() + 1);
    }
    return date;
  }

  private resolveDay(preferred: string | null): Date | null {
    if (!preferred) return null;
    const p = preferred.trim().toLowerCase();
    const now = new Date();
    if (p === 'today' || p === 'aaj' || p === 'آج') {
      return new Date(now);
    }
    if (p === 'tomorrow' || p === 'kal' || p === 'کل') {
      const t = new Date(now);
      t.setDate(t.getDate() + 1);
      return t;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) {
      const d = new Date(`${p}T00:00:00`);
      return Number.isFinite(d.getTime()) ? d : null;
    }
    const weekdayMap: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
      اتوار: 0, پیر: 1, منگل: 2, بدھ: 3, جمعرات: 4, جمعہ: 5, ہفتہ: 6,
    };
    const targetDow = weekdayMap[p];
    if (targetDow === undefined) return null;
    const currentDow = now.getDay();
    const delta = ((targetDow - currentDow + 7) % 7) || 7; // next occurrence; never today
    const target = new Date(now);
    target.setDate(target.getDate() + delta);
    return target;
  }

  private resolveTime(preferred: string | null): { hh: number; mm: number } {
    if (!preferred) return { hh: 10, mm: 0 };
    const p = preferred.trim().toLowerCase();
    if (/morning|subha|صبح/.test(p))         return { hh: 10, mm: 0 };
    if (/afternoon|dopahar|دوپہر/.test(p))   return { hh: 14, mm: 0 };
    if (/evening|sham|شام/.test(p))           return { hh: 17, mm: 0 };
    if (/night|raat|رات/.test(p))             return { hh: 19, mm: 0 };
    const hhmm = p.match(/^(\d{1,2}):(\d{2})$/);
    if (hhmm) return { hh: Math.min(23, parseInt(hhmm[1], 10)), mm: parseInt(hhmm[2], 10) };
    const ampm = p.replace(/\s+/g, '').match(/^(\d{1,2})(am|pm)$/);
    if (ampm) {
      let hh = parseInt(ampm[1], 10);
      if (ampm[2] === 'pm' && hh < 12) hh += 12;
      if (ampm[2] === 'am' && hh === 12) hh = 0;
      return { hh, mm: 0 };
    }
    const baje = p.match(/^(\d{1,2})\s*(baje|بجے)?$/);
    if (baje) {
      let hh = parseInt(baje[1], 10);
      if (hh >= 1 && hh <= 7) hh += 12;
      return { hh, mm: 0 };
    }
    return { hh: 10, mm: 0 };
  }

  private modalityToAppointmentType(modality: string): string {
    switch (modality) {
      case 'IN_PERSON': return 'IN_PERSON';
      case 'CALL':
      case 'VIDEO':
      default:          return 'CONSULTATION';
    }
  }

  private modalityLabel(modality: string): string {
    switch (modality) {
      case 'CALL':      return 'Phone call';
      case 'VIDEO':     return 'Google Meet';
      case 'IN_PERSON': return 'Office visit';
      default:          return 'Consultation';
    }
  }

  private formatWhen(d: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Karachi',
      weekday: 'long',
      day: '2-digit',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d) + ' PKT';
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  private async inboundMessageCreatedAt(messageId: string): Promise<Date | null> {
    const m = await this.prisma.whatsAppMessage.findUnique({
      where: { id: messageId },
      select: { createdAt: true },
    });
    return m?.createdAt ?? null;
  }

  /**
   * Language detector. Returns one of:
   *   'en'       — write back in English
   *   'ur_roman' — write back in Roman Urdu (Latin letters)
   *
   * Note: even when the customer writes in native Urdu script, we still
   * route to 'ur_roman' for OUTPUT — that's the house style at TIS
   * (matches how real sales agents reply on WhatsApp: Roman Urdu mixed
   * with English business terms). The customer can read Roman Urdu fine
   * either way; native script replies sound stilted and translation-y.
   */
  private detectLanguage(text: string): 'en' | 'ur_roman' {
    if (/[؀-ۿ]/.test(text)) return 'ur_roman'; // native script in → Roman Urdu out
    const lc = text.toLowerCase();
    const urRomanTokens = [
      ' kya ', ' hai ', ' ho ', ' haan ', ' nahi ', ' nhi ', ' kr ', ' kar ', ' karna ',
      ' sakta ', ' sakte ', ' mein ', ' me ', ' mera ', ' meri ', ' apka ', ' apki ',
      ' kitna ', ' kitni ', ' chahiye ', ' zaroori ', ' agar ', ' lekin ', ' bhi ',
      ' kab ', ' kahan ', ' kyun ', ' acha ', ' theek ',
    ];
    if (urRomanTokens.some((t) => ` ${lc} `.includes(t))) return 'ur_roman';
    return 'en';
  }

  /**
   * Funnel state machine — drives the appointment-booking pacing.
   *   INITIAL                 → first turn; greet + answer
   *   Q_AND_A                 → answer questions but already 2+ turns in;
   *                             start nudging toward booking
   *   APPOINTMENT_PROPOSED    → bot has asked "want to book a call?"
   *   APPOINTMENT_AVAILABILITY→ user said yes; now collecting time prefs
   *   HANDED_OFF              → preferences captured; bot stays quiet
   */
  private decideNextState(current: string, inboundCount: number, text: string): string {
    const lc = text.toLowerCase();
    // English + Roman-Urdu affirmatives.
    const yesishLatin = /\b(yes|haan|ji|jee|sure|ok+|okay|theek|book|schedule|chalein|kr lo|kar do|krwa do|please|plz)\b/i.test(
      lc,
    );
    // Urdu-script affirmatives. Important: WhatsApp users in Pakistan very
    // often switch from Roman Urdu to script mid-conversation, and the funnel
    // was previously getting stuck in APPOINTMENT_PROPOSED because "جی جی بک
    // کروا دیں" matched none of the Latin patterns above.
    const yesishUrdu = /(جی|ہاں|بالکل|ٹھیک|بک|بک کر|بکنگ|پلیز|شیڈول)/.test(text);
    const yesish = yesishLatin || yesishUrdu;

    // Modality picks count as forward progress out of PROPOSED — when the bot
    // asked "phone call, Google Meet, or office visit?" and the customer
    // replied just "phone call would be nice", there's no "yes" in there, but
    // it's clearly a yes. Without this we used to ping-pong PROPOSED ↔ Q_AND_A
    // and never reach HANDED_OFF.
    const modalityish =
      /\b(phone\s*call|call|video|google\s*meet|gmeet|meet|zoom|office|in[\s-]?person|visit)\b/i.test(
        lc,
      ) || /(کال|ویڈیو|گوگل|آفس|ملاقات)/.test(text);

    // Time / day mentions in any of English, Roman Urdu, or Urdu script.
    const timeishLatin =
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|am|pm|morning|evening|afternoon|night|kal|aaj|subha|sham|raat|dopahar)\b/i.test(
        lc,
      ) || /\d{1,2}\s*(am|pm|:|baje)/i.test(lc);
    const timeishUrdu =
      /(پیر|منگل|بدھ|جمعرات|جمعہ|ہفتہ|اتوار|کل|آج|صبح|شام|رات|دوپہر|بجے)/.test(text) ||
      /\d{1,2}\s*بجے/.test(text);
    const timeish = timeishLatin || timeishUrdu;

    if (current === 'INITIAL') {
      return inboundCount >= APPOINTMENT_NUDGE_AFTER_TURNS ? 'Q_AND_A' : 'INITIAL';
    }
    if (current === 'Q_AND_A') {
      // From Q_AND_A: if customer is already volunteering modality+time
      // ("phone call at 3pm"), skip straight to HANDED_OFF. If they're just
      // selecting modality, jump to AVAILABILITY. Otherwise nudge toward
      // PROPOSED.
      if (timeish && modalityish) return 'HANDED_OFF';
      if (modalityish || yesish) return 'APPOINTMENT_AVAILABILITY';
      return 'APPOINTMENT_PROPOSED';
    }
    if (current === 'APPOINTMENT_PROPOSED') {
      // Modality selection OR a time hint OR a plain yes all push forward.
      // We treat any of those as the customer engaging with the booking
      // flow — pushing them back to Q_AND_A on "phone call would be nice"
      // was a real bug we hit in prod.
      if (timeish && modalityish) return 'HANDED_OFF';
      if (yesish || modalityish || timeish) return 'APPOINTMENT_AVAILABILITY';
      return 'Q_AND_A'; // they kept asking; loop back
    }
    if (current === 'APPOINTMENT_AVAILABILITY') {
      if (timeish) return 'HANDED_OFF';
      return 'APPOINTMENT_AVAILABILITY';
    }
    return current;
  }

  private systemPrompt(opts: {
    language: string;
    currentState: string;
    nextState: string;
    confident: boolean;
    strictGate: boolean;
    leadFirstName: string | null;
    agentFirstName: string | null;
    isFirstBotReply: boolean;
    isBareGreeting: boolean;
  }): string {
    const {
      language,
      nextState,
      confident,
      strictGate,
      leadFirstName,
      isFirstBotReply,
      isBareGreeting,
    } = opts;
    const name = leadFirstName ? `, ${leadFirstName}` : '';
    const isUrdu = language === 'ur_roman';
    // The house welcome line — INCLUDING the assigned rep's name — is prepended
    // to the reply DETERMINISTICALLY in code (see orchestrate()). The LLM must
    // NOT write it: when the model authored "I'm <rep>" it occasionally drifted
    // to a DIFFERENT real rep's name (~4% of welcomes). So we tell it to skip the
    // greeting entirely and write only the body.
    const welcomeLead = `A welcome line is added to the START of your reply automatically — so do NOT greet, do NOT write "Welcome", and do NOT introduce yourself or state any name. Write ONLY the text that comes after the greeting:`;
    // Bare-greeting follow-up. Locked to house-approved phrasing so the bot
    // doesn't free-style something stilted. Pakistani business chat: an open
    // invitation reads warmer than a transactional "how can I help?".
    const bareGreetingFollow = isUrdu
      ? `Since the customer just said hi/salam (no real question), your reply is ONLY this line, VERBATIM (no greeting — the welcome is already prepended):\n  "Immigration sa related koi b question ha to ap discuss ker saktay hain."\nDo NOT pitch anything yet. Do NOT rephrase.`
      : `Since the customer just said hi/hello (no real question), your reply is ONLY this line, VERBATIM (no greeting — the welcome is already prepended):\n  "If you have any immigration-related questions, feel free to discuss."\nDo NOT pitch anything yet. Do NOT rephrase.`;
    const followUp = isBareGreeting
      ? bareGreetingFollow
      : `Answer their question briefly from CONTEXT (no greeting — the welcome is already prepended). End with ONE soft question that surfaces their goal (which country/program they're interested in).`;

    const initialGoal = `Greet warmly${name}. Answer the question briefly from CONTEXT. End with ONE soft question that surfaces their goal (which country/program they're interested in).`;

    // Eid holiday window — applies until APPOINTMENT_BOOKING_FLOOR.
    // We're still open for *booking*, but every slot lands on Monday or
    // later. The bot must tell the customer this in the same breath as
    // confirming, so we slot in a one-liner on every appointment-flow
    // state.
    const eidNotice = inEidBookingWindow()
      ? ` IMPORTANT: We're closed for Eid holidays until next Monday — confirm any time the customer suggests, but say clearly that the actual consultation will be from Monday onwards (e.g. "perfect, Monday 3pm works — Eid mubarak, I'll call you then to confirm").`
      : '';

    const goalByState: Record<string, string> = {
      INITIAL: initialGoal,
      Q_AND_A: `Answer briefly from CONTEXT, then invite them to book a consultation call appointment so you can go through the details together. Frame it as booking an appointment — NEVER call it a "quick call". Don't push hard — one line.${eidNotice}`,
      APPOINTMENT_PROPOSED: `Invite them to book a consultation call appointment so you can discuss their case in detail — NEVER a "quick call". (e.g. RU: "Kya aap ek call appointment book karna chahenge taake hum detail se baat kar sakein?" · EN: "Would you like to book a call appointment so we can go through the details?") Offer 3 formats: phone call, Google Meet, or office visit in Islamabad, and mention we're available ${OFFICE_HOURS}. End with ONE question.${eidNotice}`,
      APPOINTMENT_AVAILABILITY: `They've said yes (or close). Ask what day + time suits them, and in the SAME message proactively suggest our available window (${OFFICE_HOURS}) as a concrete option so they can simply pick a slot. Keep it short — one question. NEVER call it a "quick call".${eidNotice}`,
      // Proper booking acknowledgement: warm, complete, gives the client an
      // overall picture — what's been done, what comes next, that they can
      // reply here anytime. No "manager will reach out" deflection.
      HANDED_OFF: `Confirm the booking with a warm, complete acknowledgement: thank them by first name if known, restate their preference (day/time and format — phone/Meet/office — if mentioned), tell them you've added them to your consultation calendar, and that the exact slot + meeting link or office address will follow shortly. Make clear they can reply here anytime with questions. Don't ask anything else.${eidNotice}`,
    };

    return [
      // STRICT GROUNDING GATE — prepended (and therefore dominant) only on a
      // substantive question we have no confident KB match for. Locks the bot
      // to clarify-or-book so it can never improvise program facts/eligibility.
      ...(strictGate
        ? [
            `⛔ GROUNDING GATE — ACTIVE THIS TURN (this overrides answering).`,
            `The knowledge base has NO confident match for this question — it is NOT in the CONTEXT below. You therefore do NOT have reliable information to answer it, and you MUST NOT answer it or state ANY specifics.`,
            `Do EXACTLY ONE of these (in the house voice/language described further down):`,
            `  (a) Ask ONE short clarifying question to pin down what they need — e.g. which service: work permit / PR / study permit / visit visa; OR`,
            `  (b) Invite them to book a consultation call appointment to go through the exact details together (ask what time suits them and suggest our hours).`,
            `FORBIDDEN this turn: naming a program as the answer, saying what a program "is for", any eligibility ("you qualify" / "you may be eligible" / "you can apply"), any fees / minimum funds / timelines / requirements, and any guess. If even slightly unsure, choose (b). (You MAY still greet and use the KNOWN FACTS below — office, hours, phone, the service-name list — normally.)`,
            ``,
          ]
        : []),
      `You are an Immigration Solutions Associate at Tashfeen Immigration Solutions (TIS), an immigration consultancy + law firm in Islamabad. You chat with prospective clients yourself on WhatsApp — answering their questions and booking consultation calls directly with you. You ARE the consultant they'll be talking to; never defer to a separate "manager" as if it's someone else.`,
      ``,
      `PRIMARY MISSION`,
      `Your #1 goal is booking a consultation with yourself. Answer questions enough to build trust, then move toward booking. You handle the booking AND the consultation — no "I'll get the manager to call you" handoff.`,
      ``,
      `CURRENT FUNNEL STATE → ${nextState}`,
      // First-ever bot reply on this thread: the welcome template takes
      // priority over whatever the funnel state would normally say. We keep
      // the funnel-state goal afterwards so the bot still nudges toward
      // booking on the same turn if the customer asked a real question.
      isFirstBotReply
        ? `Goal this turn (FIRST REPLY — welcome overrides):\n${welcomeLead}\n${followUp}`
        : `Goal this turn: ${goalByState[nextState] ?? goalByState.INITIAL}`,
      ``,
      `VOICE & STYLE (this is the most important part)`,
      `Detected language: "${language}".`,
      ``,
      isUrdu
        ? [
            `Write back in **Roman Urdu** (Urdu in Latin letters) — even if the customer typed in native Urdu script. This is house style: real Pakistani business chat is Roman Urdu with English business words freely mixed in. Native-script replies sound stilted and translation-y.`,
            ``,
            `Use natural everyday English nouns for business terms — DON'T translate them:`,
            `  • "consultant" / "associate"   (your own role — speak in first person, not as if a separate "manager" handles things)`,
            `  • "office"       (not daftar)`,
            `  • "work permit", "visa", "PR", "agreement", "business plan", "document", "appointment", "consultation", "booking", "process", "fees", "branch", "case"`,
            ``,
            `Good examples (copy this tone):`,
            `  ✓ "Walaikum Assalam${name}! Bolen kaisay help kar saktay hain — Canada ke work permits, visit visa, ya kuch aur explore karna hai?"`,
            `  ✓ "Hum Canada me C11, ICT, LMIA jaise work permits karte hain. Apko konsa interest karta hai?"`,
            `  ✓ "Hamara office Islamabad me hai (World Trade Centre, Giga Mall, 3rd Floor), aur Canada me bhi ek office hai. Aap visit kar saktay hain ya phone/Google Meet set kar lain."`,
            `  ✓ "Behtar hoga hum ek call appointment book kar lain taake main aap ko detail se sab samjha sakoon — phone, Google Meet, ya office visit. Hum ${OFFICE_HOURS} available hote hain; aap ko kaunsa din/time suit karta hai?"`,
            `  ✓ "Theek hai, main aap ka slot lock kar k 24 ghante k andar exact time + meeting details bhej dunga."`,
            ``,
            `BAD — don't write like this:`,
            `  ✗ "میں آپ کو ایک مشیر سے بات کروانا چاہتا ہوں" (translation-y, formal, native script)`,
            `  ✗ "ہم کینیڈا کے ورک پرمٹس کی خدمات فراہم کرتے ہیں"`,
            `  ✗ "براہ کرم..."  (overly polite)`,
            `Keep the warmth of casual Pakistani business chat — friendly, direct, light.`,
          ].join('\n')
        : [
            `Write back in clear, conversational English. No corporate jargon, no flowery phrases ("we are dedicated to..."). Match the tone of a sharp Pakistani sales rep on WhatsApp.`,
            ``,
            `Good examples:`,
            `  ✓ "Hey${name}! We do Canada work permits — C11, ICT, LMIA. What's your situation?"`,
            `  ✓ "Best is to book a call appointment so we can go through your case in detail — phone, Google Meet, or our Islamabad office. We're available ${OFFICE_HOURS}; what day/time suits you?"`,
          ].join('\n'),
      ``,
      `FORMAT RULES`,
      `1. WhatsApp-short: max 3 lines per reply, ideally 1-2. Each line should be < 80 chars.`,
      `2. When you ask a question, ask exactly ONE.`,
      `3. No markdown. No bullet points unless absolutely necessary. No "Bot:" prefix. Just the message text.`,
      ``,
      `HARD RULES (never break)`,
      `1. NEVER guarantee visa approval — say it depends on the embassy / IRCC officer.`,
      `2. NEVER invent fees, processing times, minimum funds, eligibility criteria, required documents, or ANY number/requirement not in CONTEXT. Do NOT say a program has "no minimum" or "no requirement" unless CONTEXT says so. ${confident ? '' : 'Top retrieved context similarity is LOW for this turn — do NOT answer specifics from your own knowledge. Pivot to inviting them to book a consultation call appointment so you can walk them through the exact details for their situation (ask their preferred time and suggest our hours).'}`,
      `3. NEVER claim to be human. If asked "are you a bot?" → "I'm Tashfeen Immigration's WhatsApp assistant — I can answer your questions here and set up a consultation call to go through your case in detail."`,
      `4. NEVER ask for / repeat passport numbers, ID numbers, full credit card numbers, bank account numbers.`,
      `5. NEVER mention competitors by name.`,
      `6. If you don't know, pivot to booking. Don't make things up.`,
      `7. NEVER assume which service, program, or visa type the customer wants. If their message is general or ambiguous ("criteria for Canada", "I want PR", "I'm a doctor"), ASK which service/program they mean (or briefly name the main areas) — never pick one for them and never start explaining a program they did not name.`,
      `8. When the customer NAMES a program (e.g. C11, ICT, SUV, LMIA, RCIP, E2, EB2-NIW), do NOT describe who it is for, its eligibility, or its sub-categories from your own knowledge — only state what is in CONTEXT. If it is not in CONTEXT, say you will go through the exact details together on a consultation call appointment. (For example: do NOT claim C11 is "for skilled workers" — if you are not certain from CONTEXT, ask or book.)`,
      `9. NEVER tell someone they "qualify" or "may be eligible", and NEVER map a profession (doctor, engineer, nurse, etc.) to a program. Who fits which program is the consultant's assessment on the call — pivot to booking.`,
      `10. The initial CONSULTATION IS FREE. If the customer asks about a consultation / booking / meeting fee, or "kya consultation ki fees hai", tell them the consultation is free — there is no charge to talk to us. NEVER say or imply the consultation is paid. (Service/case fees for the actual work are only discussed during that free consultation.)`,
      ``,
      `KNOWN FACTS YOU MAY ALWAYS USE`,
      `- Offices: Pakistan (Islamabad) — ${OFFICE_ADDRESS}; plus an office in Canada. We do NOT have a Karachi office — never mention one.`,
      `- Office hours: ${OFFICE_HOURS} for the Pakistan office. Phone, Google Meet, and office-visit consultations are all booked within these hours.`,
      `- Phone: +92 335-000-1111  ·  Email: info@tashfeenimmigrationsolutions.com`,
      `- Services: Canadian work permits & PR (C11, ICT, SUV, LMIA, RCIP), USA (E2, EB2-NIW), Judicial Review, Visit visas (Canada/UK/Schengen).`,
      `- Written agreement always signed before any payment.`,
      `- The initial CONSULTATION IS FREE — there is NO consultation, booking, or meeting fee (phone, Google Meet, or office visit). Service/case fees for the actual work are only discussed during that free consultation.`,
      ``,
      `Reply with JUST the message text — no JSON, no markdown, no prefix.`,
    ].join('\n');
  }

  private formatContext(matches: KnowledgeMatch[]): string {
    if (matches.length === 0) return 'CONTEXT: (no knowledge retrieved — must pivot to booking)';
    const blocks = matches.slice(0, 5).map((m, i) => {
      const en = m.answerEn?.trim() ?? '';
      const ur = m.answerUr?.trim() ?? '';
      return [
        `[${i + 1}] source: ${m.sourceFile}${m.programKey ? ` (${m.programKey})` : ''} — similarity ${(m.similarity * 100).toFixed(1)}%`,
        m.queryEn ? `Q: ${m.queryEn}` : null,
        en ? `A (EN): ${en}` : null,
        ur ? `A (UR-roman): ${ur}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    });
    return `CONTEXT (top retrieved knowledge):\n\n${blocks.join('\n\n---\n\n')}`;
  }

  private formatHistory(
    history: Array<{ direction: string; body: string | null; sentByEmployeeId: string | null }>,
    currentInbound: string,
  ): string {
    if (history.length <= 1) return `Client just said:\n"""\n${currentInbound}\n"""`;
    const lines = history
      .filter((m) => (m.body ?? '').trim().length > 0)
      .map((m) => {
        if (m.direction === 'INBOUND') return `Client: ${m.body}`;
        const who = m.sentByEmployeeId ? 'Agent' : 'Bot';
        return `${who}: ${m.body}`;
      });
    return `Conversation so far (oldest first):\n${lines.join('\n')}\n\nLast client message (reply to this one):\n"""\n${currentInbound}\n"""`;
  }

  private looksLikeGuarantee(text: string): boolean {
    const lc = text.toLowerCase();
    const banned = [
      '100% approval',
      '100 % approval',
      'guaranteed visa',
      'guarantee approval',
      'guarantee your visa',
      'we guarantee',
      'definitely get',
      'definite approval',
    ];
    return banned.some((b) => lc.includes(b));
  }

  private escalationFallback(language: string): string {
    if (language === 'ur_roman') {
      return `Apke case ki detail discuss karne k liye ek call appointment book kar lete hain — main personally help karunga. Hum ${OFFICE_HOURS} available hote hain; aap ko kaunsa din/time suit karta hai?`;
    }
    return `Let's book a call appointment so I can walk you through the exact details — we're available ${OFFICE_HOURS}. What day/time suits you?`;
  }

  /**
   * Cheap pre-filter: did the customer mention wanting a brochure / PDF /
   * details? Catches English, Roman Urdu and Urdu script equivalents.
   * Only triggers the (more expensive) program-extraction call when this
   * returns true — most messages won't.
   */
  private mentionsBrochure(text: string): boolean {
    const lc = text.toLowerCase();
    if (/\b(brochure|pdf|leaflet|details|info\s*pack|booklet|company\s*profile)\b/.test(lc)) return true;
    if (/\b(tafseel|maloomat|pamphlet)\b/.test(lc)) return true;
    if (/(بروشر|پی\s*ڈی\s*ایف|تفصیل|معلومات|پروفائل)/.test(text)) return true;
    return false;
  }

  /**
   * The customer asked for a brochure. Figure out WHICH program (from the
   * current inbound + recent conversation context), look it up in
   * ai.brochures, and confirm we haven't already sent it on this thread.
   *
   * Approach: a tiny gpt-4o-mini extraction call that returns just a
   * `programKey` string. The model has the full context so it can resolve
   * "the work permit one" from earlier turns. Cheap (~$0.0002) and reliable.
   */
  private async resolveBrochureToAttach(
    inboundText: string,
    history: Array<{ direction: string; body: string | null }>,
    threadId: string,
  ): Promise<OrchestratorDecision['attachBrochure'] | undefined> {
    const programKeys = [
      'C11', 'ICT', 'SUV', 'EB2_NIW', 'RCIP', 'LMIA', 'JR', 'E2', 'VISIT', 'COMPANY_PROFILE',
    ] as const;
    const histText = history
      .map((m) => `${m.direction === 'INBOUND' ? 'Client' : 'TIS'}: ${(m.body ?? '').trim()}`)
      .filter((line) => line.length > 10)
      .slice(-8)
      .join('\n');

    const prompt = [
      `Pick the SINGLE most relevant brochure for the customer's latest message, using the conversation for context.`,
      `Return ONLY the JSON: { "programKey": "<one of: ${programKeys.join(' | ')}>" }`,
      `If the customer is asking generically (just "send brochure" with no specific program mentioned) → COMPANY_PROFILE.`,
      `Use C11 for "work permit / business setup in Canada", SUV for "startup", ICT for "company transfer", LMIA for "skilled worker job offer", RCIP for "rural Canada", EB2_NIW for "USA / Green Card", E2 for "USA investor visa", JR for "appeal / refusal challenge / judicial review", VISIT for "visit / tourist / family visit visa".`,
      ``,
      `Conversation:`,
      histText,
      ``,
      `Latest client message: """${inboundText.slice(0, 400)}"""`,
    ].join('\n');

    const res = await this.openai.chat([
      { role: 'system', content: 'You output strict JSON only. No prose, no code fences.' },
      { role: 'user', content: prompt },
    ]);
    let parsed: { programKey?: string } | null = null;
    try {
      parsed = JSON.parse((res.reply ?? '').replace(/^```(json)?|```$/g, '').trim());
    } catch {
      return undefined;
    }
    if (!parsed?.programKey || !(programKeys as readonly string[]).includes(parsed.programKey)) {
      return undefined;
    }

    // Don't repeat ourselves: check the thread for a previous OUTBOUND
    // DOCUMENT carrying the same programKey in its payload.
    const alreadySent = await this.prisma.whatsAppMessage.findFirst({
      where: {
        threadId,
        direction: 'OUTBOUND',
        type: 'DOCUMENT',
        payload: { path: ['brochureProgramKey'], equals: parsed.programKey },
      },
      select: { id: true },
    });
    if (alreadySent) {
      this.log.debug(`brochure ${parsed.programKey} already sent on thread ${threadId}, skip`);
      return undefined;
    }

    const brochure = await this.prisma.botBrochure.findUnique({
      where: { programKey: parsed.programKey },
      select: { programKey: true, s3Key: true, displayTitle: true, mimeType: true },
    });
    if (!brochure) return undefined;

    return {
      programKey: brochure.programKey,
      s3Key: brochure.s3Key,
      displayTitle: brochure.displayTitle,
      mimeType: brochure.mimeType,
    };
  }

  /**
   * Detect customer asking us to stop messaging. Conservative — only matches
   * unambiguous opt-out phrases. False positives here are very bad ("I'm
   * stopping by the office tomorrow" must NOT trigger it).
   *
   * Covers English, Roman Urdu, and Urdu script. Whole-word boundaries where
   * possible.
   */
  private isOptOutIntent(text: string): boolean {
    const lc = text.toLowerCase();

    // English phrases (whole-word / phrase boundaries).
    const enPhrases = [
      /\bunsubscribe\b/,
      /\bstop\s+(messag|sending|contact|texting|calling)/,
      /\bdon'?t\s+(message|text|call|contact|disturb)\s+me\b/,
      /\bdo\s+not\s+(message|text|call|contact)\s+me\b/,
      /\bleave\s+me\s+alone\b/,
      /\bno\s+more\s+messages\b/,
      /\bblock\s+me\b/,
      /\bremove\s+me\s+from\s+(your\s+)?list\b/,
    ];
    if (enPhrases.some((re) => re.test(lc))) return true;

    // Roman Urdu opt-outs.
    const rUrduPhrases = [
      /\bband\s+kar(o|do|den|dein)\b/,
      /\brok\s+(do|den|dein)\b/,
      /\bmessage\s+(mat|na)\s+(karo|karen|bhejo|bhejen)\b/,
      /\bpareshan\s+(mat|na)\s+(karo|karen)\b/,
      /\btang\s+(mat|na)\s+karo\b/,
      /\bblock\s+kar(o|do|den)\b/,
      /\bcall\s+(mat|na)\s+(karo|karen)\b/,
    ];
    if (rUrduPhrases.some((re) => re.test(lc))) return true;

    // Urdu script — narrower, just the most direct phrasings.
    if (/(بند\s*کرو|روک\s*دو|پریشان\s*نہ|تنگ\s*نہ|بلاک\s*کرو|بلاک\s*کریں)/.test(text)) return true;

    return false;
  }

  /**
   * Narrow leak detector for the strict-grounding backstop. Flags the two
   * highest-risk hallucination signals that should NEVER appear on an
   * ungrounded turn: an eligibility/qualification assertion, or a concrete
   * fee/amount. Kept deliberately narrow so it doesn't trip on a legitimate
   * clarifying question (which names services but asserts nothing).
   */
  private leaksSpecifics(text: string): boolean {
    const t = text.toLowerCase();
    if (/\b(eligible|eligibility|qualif(?:y|ies|ied))\b/.test(t)) return true;
    if (/(?:cad|usd|pkr|rs\.?|\$)\s?\d/.test(t)) return true;
    return false;
  }

  /**
   * True if the reply implies the CONSULTATION ITSELF is paid — and does NOT
   * also say it's free. Tight phrasing match (a fee/charge tied to the word
   * "consultation") so a legitimate "service/case fees discussed during the
   * consultation" line is NOT caught. Negation-aware so "no consultation fee /
   * it's free / muft" passes through untouched.
   */
  private impliesPaidConsultation(text: string): boolean {
    const t = text.toLowerCase();
    const tiesFeeToConsult =
      /(consultation|consult)\s*(fee|fees|charge|charges)/.test(t) ||
      /fees?\s+for\s+(the\s+|a\s+)?consultation/.test(t) ||
      /consultation\s+ki\s+fees?/.test(t) ||
      /charge\s+(a\s+)?fee\s+for\s+(the\s+)?consultation/.test(t);
    if (!tiesFeeToConsult) return false;
    const saysFree =
      /\bfree\b|\bmuft\b|don'?t charge|do not charge|no (consultation )?(fee|charge)|koi (fee|charge)\s*nahi|fee\s*nahi/.test(t);
    return !saysFree;
  }

  /** Correct line: the initial consultation is free. Language-aware. */
  private consultationFreeReply(language: string): string {
    return language === 'ur_roman'
      ? `Achi baat ye hai ke initial consultation bilkul FREE hai — koi consultation fee nahi. Call par aap kya discuss karna chahenge?`
      : `Good news — the initial consultation is completely free; there's no consultation fee at all. What would you like to cover on the call?`;
  }

  /** Safe pivot used when the strict gate / backstop blocks an answer. */
  private groundingFallback(language: string): string {
    return language === 'ur_roman'
      ? 'Is ka exact answer main aap ko ek call appointment par accurately bata sakta hoon. Phone, Google Meet ya office visit — kya prefer karenge?'
      : "I'd rather give you the exact answer on a booked call appointment so it's accurate for your case. Phone, Google Meet, or office visit — what works?";
  }

  private optOutAcknowledgement(language: string): string {
    if (language === 'ur_roman' || language === 'ur') {
      return 'Theek hai. Aapka message receive hua — hum aap ko zaroorat hone par hi contact karenge. Khayal rakhein!';
    }
    return "Got it — we'll stop messaging you and only reach out if needed. Take care!";
  }

  /**
   * Drop firstName values that would make the bot look broken when used in a
   * greeting:
   *   - empty / whitespace-only
   *   - single character
   *   - common placeholders (Unknown, Customer, Guest, Test, NA, …)
   *   - digit-only or phone-shaped strings (CSV imports sometimes put the
   *     phone in firstName until sales cleans it up)
   * Returns the cleaned name or null — the system prompt then renders no
   * name suffix at all instead of "Hi ,".
   */
  private sanitizedFirstName(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const t = raw.trim();
    if (!t || t.length < 2) return null;
    if (/^(unknown|customer|guest|client|lead|test|na|n\/a|new lead|whatsapp)$/i.test(t)) return null;
    if (/^[\d\s+\-()]+$/.test(t)) return null; // pure digits / phone
    if (/^\+?\d/.test(t)) return null;          // starts with digit / +
    return t;
  }

  /**
   * Is the customer's first message a bare greeting (no actual question)?
   * Drives the welcome branch: "how can we assist you today?" vs
   * "let me answer your question, here's the answer + a soft nudge".
   *
   * Matches English greetings, Roman Urdu, and Urdu script — single or
   * stacked ("salam bhai", "hi hello", "assalamualaikum") with no
   * trailing question content.
   */
  private isBareGreeting(text: string): boolean {
    const t = text.trim().toLowerCase();
    if (!t) return false;
    // Strip greeting tokens; if what's left has zero substantive content,
    // it's a bare greeting.
    const stripped = t
      .replace(
        /\b(hi+|hello+|hey+|heyy+|yo|salam|salaam|assalam(?:u)?(?:\s*)?(?:o|wa)?(?:\s*)?alaikum|aoa|asalamualaikum|walaikum|good\s*(morning|afternoon|evening|night)|bhai|sir|sis|madam|please|plz)\b/g,
        '',
      )
      .replace(/[!?.,👋🙏]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    // Same for Urdu script
    const strippedUrdu = stripped
      .replace(/(السلام\s*علیکم|وعلیکم\s*السلام|ہیلو|السلام)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return strippedUrdu.length === 0 || strippedUrdu.length <= 2;
  }

  /**
   * Jaccard token-set similarity. Cheap, language-agnostic check used by the
   * duplicate-reply guard. Tokens are lowercase, length > 2 (drops Urdu/En
   * stop-words like "hai", "ji", "is", "to").
   */
  private tooSimilar(a: string, b: string): boolean {
    const tokens = (s: string) =>
      new Set(s.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
    const ta = tokens(a);
    const tb = tokens(b);
    if (ta.size === 0 || tb.size === 0) return false;
    let intersect = 0;
    for (const t of ta) if (tb.has(t)) intersect++;
    const union = ta.size + tb.size - intersect;
    return intersect / union >= DUPLICATE_REPLY_JACCARD;
  }
}
