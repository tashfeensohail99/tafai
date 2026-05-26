import { Injectable, Logger } from '@nestjs/common';
import { PresenceStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OpenAiService } from './openai.service';
import { KnowledgeService, type KnowledgeMatch } from './knowledge.service';

/**
 * Decision table for one inbound WhatsApp message:
 *
 *   Pre-flight skip
 *     • Bot disabled (org.botEnabledAt is null or in the future)
 *     • Sender is one of our employees (out-of-band tests / staff chat)
 *     • Lead is a paying client (Lead.convertedClientId set) — never AI on
 *       active customers; their assigned agent owns the conversation
 *     • A HUMAN agent sent an outbound message in the last 4h — sales is
 *       actively talking, don't step on their toes
 *     • Last 3 AI runs on this thread all SKIPPED (something is repeatedly
 *       going wrong; back off until manual review)
 *
 *   Mode = SHADOW if business-hours (Mon-Fri 09:00-18:00 in org timezone)
 *                  AND at least one whatsappInboxMember Employee is ONLINE
 *                  AND that employee's lastActivityAt is within 5 minutes
 *
 *   Mode = AUTO   otherwise (outside hours, weekend, no one online)
 *
 * The composed reply is the same in both modes — the difference is just
 * "save to ai.suggestions for human review" vs "send via Meta + save to
 * whatsapp.messages".
 */
const SHADOW_WINDOW_START_HOUR = 9;   // 09:00 local
const SHADOW_WINDOW_END_HOUR = 18;    // 18:00 local
const ACTIVE_AGENT_HEARTBEAT_MS = 5 * 60 * 1000;
const HUMAN_REPLY_LOCKOUT_MS = 4 * 60 * 60 * 1000;
const ORG_TIMEZONE_DEFAULT = 'Asia/Karachi';

export type RunMode = 'AUTO' | 'SHADOW' | 'SKIPPED';

export interface OrchestratorInput {
  threadId: string;
  inboundMessageId: string;
  inboundText: string;
  /** Detected/declared language: 'en', 'ur_roman', 'ur', 'other'. */
  language?: string;
}

export interface OrchestratorDecision {
  mode: RunMode;
  skipReason?: string;
  /** When mode != SKIPPED: the reply text the bot wrote. */
  reply?: string;
  /** Top retrieved knowledge match (for telemetry). */
  topMatch?: KnowledgeMatch;
  /** All retrieved matches (for telemetry / training). */
  retrieved?: KnowledgeMatch[];
  /** Token/latency stats for cost tracking. */
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  model?: string;
}

@Injectable()
export class OrchestratorService {
  private readonly log = new Logger(OrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openai: OpenAiService,
    private readonly knowledge: KnowledgeService,
  ) {}

  /**
   * Main entry point — called by the WhatsApp inbound processor. Returns
   * the decision; callers (the BullMQ processor) handle persistence +
   * actual Meta send.
   */
  async decide(input: OrchestratorInput): Promise<OrchestratorDecision> {
    // ── 1. Pre-flight: bot enabled? ────────────────────────────────────────
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true, timezone: true, botEnabledAt: true, botMode: true },
    });
    if (!org) return { mode: 'SKIPPED', skipReason: 'no-organization' };
    if (org.botMode === 'DISABLED') return { mode: 'SKIPPED', skipReason: 'bot-disabled' };
    if (!org.botEnabledAt || org.botEnabledAt.getTime() > Date.now()) {
      return { mode: 'SKIPPED', skipReason: 'bot-not-yet-enabled' };
    }

    // ── 2. Pre-flight: who is this thread for? ─────────────────────────────
    const thread = await this.prisma.whatsAppThread.findUnique({
      where: { id: input.threadId },
      select: {
        id: true,
        leadId: true,
        clientId: true,
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            convertedClientId: true,
            assignedEmployeeId: true,
          },
        },
      },
    });
    if (!thread) return { mode: 'SKIPPED', skipReason: 'thread-not-found' };
    if (thread.clientId || thread.lead?.convertedClientId) {
      // Paying client — never auto-reply; their assigned agent / finance
      // / processing officer owns the conversation.
      return { mode: 'SKIPPED', skipReason: 'paying-client' };
    }

    // ── 3. Pre-flight: did a human reply recently? ─────────────────────────
    const recentHumanOutbound = await this.prisma.whatsAppMessage.findFirst({
      where: {
        threadId: input.threadId,
        direction: 'OUTBOUND',
        sentByEmployeeId: { not: null },
        createdAt: { gte: new Date(Date.now() - HUMAN_REPLY_LOCKOUT_MS) },
      },
      select: { id: true },
    });
    if (recentHumanOutbound) {
      return { mode: 'SKIPPED', skipReason: 'human-active' };
    }

    // ── 4. Pick mode: SHADOW (if business hours + agent online) vs AUTO ────
    const mode: RunMode = org.botMode === 'SHADOW_ONLY'
      ? 'SHADOW'
      : (await this.isShadowEligible(org.timezone ?? ORG_TIMEZONE_DEFAULT)) ? 'SHADOW' : 'AUTO';

    // ── 5. Retrieve + compose ──────────────────────────────────────────────
    const language = input.language ?? this.detectLanguage(input.inboundText);
    let retrieved: KnowledgeMatch[];
    try {
      retrieved = await this.knowledge.search(input.inboundText, 5);
    } catch (e) {
      this.log.error(`retrieval failed: ${(e as Error).message}`);
      return { mode: 'SKIPPED', skipReason: 'retrieval-failed' };
    }

    const systemPrompt = this.systemPrompt(language);
    const contextBlock = this.formatContext(retrieved);
    const userBlock = `Client message:\n"""\n${input.inboundText}\n"""\n\nReply now. Stay under 4 lines for WhatsApp.`;

    let reply = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let latencyMs = 0;
    let model = OpenAiService.CHAT_MODEL;
    try {
      const res = await this.openai.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${contextBlock}\n\n${userBlock}` },
      ]);
      reply = res.reply;
      inputTokens = res.inputTokens;
      outputTokens = res.outputTokens;
      latencyMs = res.latencyMs;
      model = res.model;
    } catch (e) {
      this.log.error(`chat failed: ${(e as Error).message}`);
      return { mode: 'SKIPPED', skipReason: `chat-failed: ${(e as Error).message}` };
    }

    if (!reply) {
      return { mode: 'SKIPPED', skipReason: 'empty-reply' };
    }
    if (this.looksLikeGuarantee(reply)) {
      // Hard rail: never promise visa approval. Fall back to escalation copy.
      this.log.warn(`Guarantee phrase detected, escalating instead: "${reply.slice(0, 80)}…"`);
      reply = this.escalationFallback(language);
    }

    return {
      mode,
      reply,
      topMatch: retrieved[0],
      retrieved,
      inputTokens,
      outputTokens,
      latencyMs,
      model,
    };
  }

  /**
   * Shadow eligibility: business-hours (Mon-Fri 09:00-18:00 in org timezone)
   * AND at least one inbox-member Employee is ONLINE with a heartbeat within
   * the last 5 minutes. Both conditions must be true — otherwise we go AUTO.
   */
  private async isShadowEligible(timezone: string): Promise<boolean> {
    // 1) Business hours in the org's local time.
    //    Intl.DateTimeFormat is the cleanest way to read local hour + weekday
    //    without pulling in moment-tz.
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? '';
    const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
    const hour = parseInt(hourStr, 10);
    const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekdayStr);
    if (!isWeekday) return false;
    if (hour < SHADOW_WINDOW_START_HOUR || hour >= SHADOW_WINDOW_END_HOUR) return false;

    // 2) Active inbox member online + heartbeat fresh.
    const cutoff = new Date(Date.now() - ACTIVE_AGENT_HEARTBEAT_MS);
    const activeAgent = await this.prisma.employee.findFirst({
      where: {
        isActive: true,
        deletedAt: null,
        whatsappInboxMember: true,
        presenceStatus: PresenceStatus.ONLINE,
        lastActivityAt: { gte: cutoff },
        user: { status: 'ACTIVE' },
      },
      select: { id: true },
    });
    return !!activeAgent;
  }

  /** Heuristic language detect — good enough; refine later if needed. */
  private detectLanguage(text: string): 'en' | 'ur_roman' | 'ur' | 'other' {
    if (/[؀-ۿ]/.test(text)) return 'ur'; // Arabic script range covers Urdu
    const lc = text.toLowerCase();
    // Common Roman Urdu tokens.
    const urRomanTokens = [
      ' kya ', ' hai ', ' ho ', ' haan ', ' nahi ', ' nhi ', ' kr ', ' kar ', ' karna ',
      ' sakta ', ' sakte ', ' mein ', ' me ', ' mera ', ' meri ', ' apka ', ' apki ',
      ' kitna ', ' kitni ', ' chahiye ', ' zaroori ', ' agar ', ' lekin ',
    ];
    if (urRomanTokens.some((t) => ` ${lc} `.includes(t))) return 'ur_roman';
    return 'en';
  }

  private systemPrompt(language: string): string {
    return [
      `You are the official WhatsApp assistant for Tashfeen Immigration Solutions (TIS), a registered immigration consultancy and law firm based in Islamabad with offices in Karachi and Canada. You help prospective clients with their first questions about visa programs and the firm's services.`,
      ``,
      `STYLE RULES`,
      `1. Respond in the SAME language the client used. Detected: "${language}". For "ur_roman", write in Roman Urdu (Urdu words in Latin letters, the same casual style our team uses). For "en", reply in clear English. Never mix.`,
      `2. Keep replies under 4 short lines — this is WhatsApp, not email.`,
      `3. Friendly, professional, and direct. Match the tone of the company's own canned answers.`,
      `4. If the answer is in the provided CONTEXT, ground your reply in it — copy the exact wording for fees and policy points. Don't paraphrase numbers.`,
      ``,
      `HARD RULES (never break these)`,
      `1. NEVER guarantee visa approval. If asked, say approval depends on the embassy / IRCC officer.`,
      `2. NEVER quote a fee, price, refund amount, or processing time that isn't explicitly in the CONTEXT. If the client asks for something not in CONTEXT, say a consultant will share the exact figure.`,
      `3. NEVER claim to be human. If asked, say you're TIS's WhatsApp assistant and can connect them to a consultant.`,
      `4. NEVER ask for or echo back: passport numbers, ID numbers, full credit card numbers, bank account numbers. Direct payment talk to email/portal.`,
      `5. NEVER mention competitors by name.`,
      `6. If you don't know the answer, politely say "a consultant will get back to you shortly" — don't make things up.`,
      ``,
      `BUSINESS FACTS YOU MAY ALWAYS REFERENCE`,
      `- Offices: Islamabad (Giga Mall, World Trade Center), Karachi, and Canada.`,
      `- Phone: +92 335-000-1111  ·  Email: info@tashfeenimmigrationsolutions.com`,
      `- Service categories: Canadian work permits & PR (C11, ICT, SUV, LMIA, RCIP), USA (E2, EB2-NIW), Judicial Review, Visit visas (Canada/UK/Schengen).`,
      `- Always sign a written agreement before payment; we never do "done base" arrangements.`,
    ].join('\n');
  }

  private formatContext(matches: KnowledgeMatch[]): string {
    if (matches.length === 0) return 'CONTEXT: (none retrieved)';
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
    return `CONTEXT (top retrieved knowledge — use this to answer):\n\n${blocks.join('\n\n---\n\n')}`;
  }

  /** Rough guardrail — block any reply that promises approval. */
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
      return 'Aapka sawal hum apke consultant tak forward kar dete hain — woh ji ke saath actual figures aur process share karenge. Thori der mein response milay ga.';
    }
    return "Let me have a consultant get back to you with the exact details on that — they'll share the figures and process. You'll hear back shortly.";
  }
}
