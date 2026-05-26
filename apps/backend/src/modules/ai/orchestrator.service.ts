import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OpenAiService } from './openai.service';
import { KnowledgeService, type KnowledgeMatch } from './knowledge.service';

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
const HUMAN_LOCKOUT_MS = 4 * 60 * 60 * 1000;
const HISTORY_TURNS = 10;
const APPOINTMENT_NUDGE_AFTER_TURNS = 2;
/**
 * Hard ceiling on bot replies per thread. Once we've sent this many OUTBOUND
 * messages with sentByEmployeeId=null on the thread, the orchestrator
 * silences itself regardless of funnel state — prevents runaway loops if a
 * customer keeps asking questions and no human ever steps in.
 */
const BOT_REPLY_CEILING = 5;

export type RunMode = 'AUTO' | 'SKIPPED';

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
}

@Injectable()
export class OrchestratorService {
  private readonly log = new Logger(OrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openai: OpenAiService,
    private readonly knowledge: KnowledgeService,
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
          },
        },
      },
    });
    if (!thread) return { mode: 'SKIPPED', skipReason: 'thread-not-found' };
    if (!thread.aiEnabled) return { mode: 'SKIPPED', skipReason: 'ai-disabled-on-thread' };

    if (thread.aiDisabledAt && Date.now() - thread.aiDisabledAt.getTime() < HUMAN_LOCKOUT_MS) {
      return { mode: 'SKIPPED', skipReason: 'within-human-lockout' };
    }

    // Funnel-state stop: once we've handed off to a real consultant, the bot
    // stays out of the way. Any further reply would be either "consultant
    // will reach out" (already said) or noise.
    if (thread.aiState === 'HANDED_OFF') {
      return { mode: 'SKIPPED', skipReason: 'handed-off' };
    }

    // Hard ceiling: never send more than N bot replies on a single thread.
    // Defense against runaway loops if a customer keeps probing without
    // anyone stepping in. Counts OUTBOUND messages with NULL sentByEmployeeId
    // (bot messages — humans always have a non-null sender).
    const botRepliesSoFar = await this.prisma.whatsAppMessage.count({
      where: {
        threadId: thread.id,
        direction: 'OUTBOUND',
        sentByEmployeeId: null,
      },
    });
    if (botRepliesSoFar >= BOT_REPLY_CEILING) {
      return { mode: 'SKIPPED', skipReason: 'reply-ceiling-reached' };
    }

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

    const systemPrompt = this.systemPrompt({
      language,
      currentState: thread.aiState,
      nextState: nextAiState,
      confident,
      leadFirstName: thread.lead?.firstName ?? null,
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

    await this.prisma.appointmentRequest.create({
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
      return 'APPOINTMENT_PROPOSED';
    }
    if (current === 'APPOINTMENT_PROPOSED') {
      if (yesish) return 'APPOINTMENT_AVAILABILITY';
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
    leadFirstName: string | null;
  }): string {
    const { language, nextState, confident, leadFirstName } = opts;
    const name = leadFirstName ? `, ${leadFirstName}` : '';
    const isUrdu = language === 'ur_roman';

    const goalByState: Record<string, string> = {
      INITIAL: `Greet warmly${name}. Answer the question briefly from CONTEXT. End with ONE soft question that surfaces their goal (which country/program they're interested in).`,
      Q_AND_A: `Answer briefly from CONTEXT, then suggest booking a quick consultation with our manager for the detail. Don't push hard — one line.`,
      APPOINTMENT_PROPOSED: `Ask them directly if they'd like to book a quick call with the manager. Offer 3 formats: phone call, Google Meet, or office visit in Islamabad. End with the question.`,
      APPOINTMENT_AVAILABILITY: `They've said yes (or close). Now ask which day + time slot works (morning/afternoon/evening). Keep it short.`,
      HANDED_OFF: `Confirm you've noted their preference and the manager will reach out within 24 hours to confirm the exact slot. Don't ask anything else.`,
    };

    return [
      `You are a WhatsApp sales rep at Tashfeen Immigration Solutions (TIS), an immigration consultancy + law firm in Islamabad. You chat with prospective clients — your goal is to answer their first questions and book them a consultation call with our manager.`,
      ``,
      `PRIMARY MISSION`,
      `Your #1 goal is booking a consultation. Answer questions enough to build trust, then move toward booking. You're the first contact, NOT the consultant who closes — that's the manager's job.`,
      ``,
      `CURRENT FUNNEL STATE → ${nextState}`,
      `Goal this turn: ${goalByState[nextState] ?? goalByState.INITIAL}`,
      ``,
      `VOICE & STYLE (this is the most important part)`,
      `Detected language: "${language}".`,
      ``,
      isUrdu
        ? [
            `Write back in **Roman Urdu** (Urdu in Latin letters) — even if the customer typed in native Urdu script. This is house style: real Pakistani business chat is Roman Urdu with English business words freely mixed in. Native-script replies sound stilted and translation-y.`,
            ``,
            `Use natural everyday English nouns for business terms — DON'T translate them:`,
            `  • "manager"      (not مشیر / mushir / advisor)`,
            `  • "consultant"   (when you mean a specialist)`,
            `  • "office"       (not daftar)`,
            `  • "work permit", "visa", "PR", "agreement", "business plan", "document", "appointment", "consultation", "booking", "process", "fees", "branch", "case"`,
            ``,
            `Good examples (copy this tone):`,
            `  ✓ "Walaikum Assalam${name}! Bolen kaisay help kar saktay hain — Canada ke work permits, visit visa, ya kuch aur explore karna hai?"`,
            `  ✓ "Hum Canada me C11, ICT, LMIA jaise work permits karte hain. Apko konsa interest karta hai?"`,
            `  ✓ "Hamare offices Islamabad (Giga Mall) aur Karachi me hain, aur Canada me bhi ek office hai."`,
            `  ✓ "Sahi process aur exact fees k liye behtar hai aap apne manager se ek short call ker lain. Phone, Google Meet, ya office visit — kya prefer karenge?"`,
            `  ✓ "Theek hai, manager aap se 24 ghante ke andar contact karenge confirm karne ke liye."`,
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
            `  ✓ "Best is a quick call with our manager — phone, Google Meet, or in-person at our Islamabad office. What works?"`,
          ].join('\n'),
      ``,
      `FORMAT RULES`,
      `1. WhatsApp-short: max 3 lines per reply, ideally 1-2. Each line should be < 80 chars.`,
      `2. When you ask a question, ask exactly ONE.`,
      `3. No markdown. No bullet points unless absolutely necessary. No "Bot:" prefix. Just the message text.`,
      ``,
      `HARD RULES (never break)`,
      `1. NEVER guarantee visa approval — say it depends on the embassy / IRCC officer.`,
      `2. NEVER invent fees, processing times, or any number not in CONTEXT. ${confident ? '' : 'Top retrieved context similarity is LOW for this turn — do NOT answer specifics from your own knowledge. Pivot to "let me get the manager on a quick call so they can share the exact figures."'}`,
      `3. NEVER claim to be human. If asked "are you a bot?" → "I'm the TIS WhatsApp assistant — happy to connect you to the manager for detail."`,
      `4. NEVER ask for / repeat passport numbers, ID numbers, full credit card numbers, bank account numbers.`,
      `5. NEVER mention competitors by name.`,
      `6. If you don't know, pivot to booking. Don't make things up.`,
      ``,
      `KNOWN FACTS YOU MAY ALWAYS USE`,
      `- Offices: Islamabad (Giga Mall, World Trade Center), Karachi, and Canada.`,
      `- Phone: +92 335-000-1111  ·  Email: info@tashfeenimmigrationsolutions.com`,
      `- Services: Canadian work permits & PR (C11, ICT, SUV, LMIA, RCIP), USA (E2, EB2-NIW), Judicial Review, Visit visas (Canada/UK/Schengen).`,
      `- Written agreement always signed before any payment.`,
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
      return 'Aapka sawal hum apke consultant tak forward kar dete hain — kya hum aaj ya kal ek short call schedule kar lein?';
    }
    return "I'll loop in our consultant for the exact details — can we schedule a short call today or tomorrow?";
  }
}
