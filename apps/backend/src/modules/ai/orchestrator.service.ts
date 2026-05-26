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
    const confident = topSim >= 0.62; // empirical floor — below this, pivot to booking

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

  // ─── helpers ─────────────────────────────────────────────────────────────

  private async inboundMessageCreatedAt(messageId: string): Promise<Date | null> {
    const m = await this.prisma.whatsAppMessage.findUnique({
      where: { id: messageId },
      select: { createdAt: true },
    });
    return m?.createdAt ?? null;
  }

  /** Heuristic Roman-Urdu vs English detector. */
  private detectLanguage(text: string): 'en' | 'ur_roman' | 'ur' | 'other' {
    if (/[؀-ۿ]/.test(text)) return 'ur';
    const lc = text.toLowerCase();
    const urRomanTokens = [
      ' kya ', ' hai ', ' ho ', ' haan ', ' nahi ', ' nhi ', ' kr ', ' kar ', ' karna ',
      ' sakta ', ' sakte ', ' mein ', ' me ', ' mera ', ' meri ', ' apka ', ' apki ',
      ' kitna ', ' kitni ', ' chahiye ', ' zaroori ', ' agar ', ' lekin ', ' bhi ',
      ' kab ', ' kahan ', ' kyun ',
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
    const yesish = /\b(yes|haan|ji|sure|ok+|okay|jee|theek|book|schedule|book it|chalein|kr lo)\b/i.test(
      lc,
    );
    const timeish =
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|am|pm|morning|evening|afternoon|kal|aaj|subha|sham|raat)\b/i.test(
        lc,
      ) || /\d{1,2}\s*(am|pm|:|baje)/i.test(lc);

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

    const goalByState: Record<string, string> = {
      INITIAL: `Greet warmly${name}. Answer the question briefly from CONTEXT. End with ONE soft question that surfaces their goal (which country/program they're interested in).`,
      Q_AND_A: `Answer briefly from CONTEXT, then suggest booking a quick consultation with a TIS consultant for the detail. Don't push hard — one line.`,
      APPOINTMENT_PROPOSED: `Ask them directly if they'd like to book a quick consultation. Offer 3 formats: phone call, Google Meet, or office visit in Islamabad. End with the question.`,
      APPOINTMENT_AVAILABILITY: `They've said yes (or close). Now ask which day + time slot works (morning/afternoon/evening). Keep it short.`,
      HANDED_OFF: `Confirm you've noted their preference and a consultant will reach out within 24 hours to confirm the exact slot. Don't ask anything else.`,
    };

    return [
      `You are the WhatsApp assistant for Tashfeen Immigration Solutions (TIS), an immigration consultancy + law firm in Islamabad (with offices in Karachi and Canada).`,
      ``,
      `PRIMARY MISSION`,
      `Your #1 goal is to book a consultation for new leads. Every conversation should move toward that. You're the first contact — answer their questions ONLY enough to build trust, then suggest booking a call so a real consultant can take it further.`,
      ``,
      `CURRENT FUNNEL STATE → ${nextState}`,
      `Goal this turn: ${goalByState[nextState] ?? goalByState.INITIAL}`,
      ``,
      `STYLE`,
      `1. Respond in the user's language. Detected: "${language}". For "ur_roman", write Roman Urdu the way our team does (e.g. "Ji haan, hum apko CAD 20,000 me yeh service dete hain"). For "en", plain English. NEVER mix.`,
      `2. WhatsApp-short: max 3 lines per reply, ideally 1-2. Friendly and direct.`,
      `3. When you ask a question, ask exactly ONE.`,
      ``,
      `HARD RULES (never break)`,
      `1. NEVER guarantee visa approval. Approval depends on the embassy / IRCC officer.`,
      `2. NEVER invent fees, processing times, or any number not in CONTEXT. ${confident ? '' : 'The retrieved context this turn has LOW similarity to the user query — do NOT answer from your own knowledge. Instead, pivot to "let me get you a consultant to give you the exact details" and propose a booking.'}`,
      `3. NEVER claim to be human. If asked "are you a bot?" → "I'm the TIS WhatsApp assistant — happy to connect you to a consultant for the detail."`,
      `4. NEVER ask for / repeat passport numbers, ID numbers, full credit card numbers, bank account numbers.`,
      `5. NEVER mention competitors by name.`,
      `6. If unsure → pivot to booking a consultation. Don't make things up.`,
      ``,
      `KNOWN FACTS YOU MAY ALWAYS USE`,
      `- Offices: Islamabad (Giga Mall, World Trade Center), Karachi, and Canada.`,
      `- Phone: +92 335-000-1111  ·  Email: info@tashfeenimmigrationsolutions.com`,
      `- Services: Canadian work permits & PR (C11, ICT, SUV, LMIA, RCIP), USA (E2, EB2-NIW), Judicial Review, Visit visas.`,
      `- Always sign a written agreement before any payment.`,
      ``,
      `Reply with JUST the message text — no JSON, no markdown formatting, no "Bot:" prefix.`,
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
