import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OpenAiService } from './openai.service';

/**
 * On-demand WhatsApp chat "Summary & Suggested reply".
 *
 * Reuses the SAME gpt-4o-mini wrapper ({@link OpenAiService.chat}) the bot uses
 * — no new AI vendor/model — to brief a sales rep on a conversation: a short
 * summary, one recommended next action, and a ready-to-edit draft reply in the
 * client's language. Nothing auto-generates: the panel calls summarize() only
 * when the rep clicks "Summary" / "Regenerate".
 *
 * Billing guard: the result is cached on the thread keyed on the NEWEST message
 * id at generation time (aiSummaryThroughMessageId). Re-opening a thread whose
 * conversation hasn't moved on returns the cached JSON without an AI call; the
 * cache is bypassed when the rep forces a refresh or a newer message exists.
 */
@Injectable()
export class ThreadSummaryService {
  private readonly log = new Logger(ThreadSummaryService.name);

  /** How many most-recent messages feed the brief. */
  private static readonly HISTORY_LIMIT = 40;
  /** Hard cap on the formatted history handed to the model (~chars). */
  private static readonly HISTORY_CHAR_CAP = 6000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly openai: OpenAiService,
  ) {}

  async summarize(
    threadId: string,
    opts: { refresh?: boolean } = {},
  ): Promise<ThreadSummaryResult> {
    const thread = await this.prisma.whatsAppThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        aiSummary: true,
        aiSummaryThroughMessageId: true,
        aiSummaryAt: true,
      },
    });
    if (!thread) throw new NotFoundException('Thread not found');

    // Pull the last N messages (newest first for the cache key + the take),
    // then flip to oldest-first for the transcript the model reads.
    const recent = await this.prisma.whatsAppMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'desc' },
      take: ThreadSummaryService.HISTORY_LIMIT,
      select: { id: true, direction: true, body: true, type: true, createdAt: true },
    });
    const latestMessageId = recent[0]?.id ?? null;
    const messages = [...recent].reverse();

    // No conversation yet → nothing to summarize. Never spend an AI call.
    if (messages.length === 0) {
      return {
        summary: '',
        suggestion: '',
        draftReply: '',
        language: 'en',
        messageCount: 0,
        generatedAt: null,
        throughMessageId: null,
        cached: false,
        empty: true,
      };
    }

    // Cache hit: same newest message + a stored summary + no forced refresh.
    if (
      !opts.refresh &&
      thread.aiSummaryThroughMessageId === latestMessageId &&
      thread.aiSummary
    ) {
      const parsed = this.coerceParsed(thread.aiSummary);
      return {
        ...parsed,
        messageCount: messages.length,
        generatedAt: thread.aiSummaryAt,
        throughMessageId: thread.aiSummaryThroughMessageId,
        cached: true,
      };
    }

    const history = this.formatHistory(messages);
    let res;
    try {
      res = await this.openai.chat(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Conversation (oldest first):\n${history}` },
        ],
        { jsonMode: true, maxTokens: 600 },
      );
    } catch (e) {
      this.log.warn(`summary chat failed: ${(e as Error).message}`);
      throw new BadRequestException('Could not generate a summary, please try again');
    }

    const parsed = this.parseStrictJson(res.reply);
    const generatedAt = new Date();

    await this.prisma.whatsAppThread.update({
      where: { id: threadId },
      data: {
        aiSummary: parsed as unknown as Prisma.InputJsonValue,
        aiSummaryThroughMessageId: latestMessageId,
        aiSummaryAt: generatedAt,
      },
    });

    return {
      ...parsed,
      messageCount: messages.length,
      generatedAt,
      throughMessageId: latestMessageId,
      cached: false,
    };
  }

  /**
   * Oldest-first transcript. INBOUND = the client, OUTBOUND = us (bot or rep,
   * both read as "TIS" — the rep only needs the client's side distinguished).
   * Non-text / empty messages become a bracketed placeholder so the model knows
   * media was exchanged without us leaking a raw payload. Capped to the most
   * recent HISTORY_CHAR_CAP chars so a very long thread can't blow the context.
   */
  private formatHistory(
    messages: Array<{
      direction: string;
      body: string | null;
      type: string;
    }>,
  ): string {
    const lines = messages.map((m) => {
      const label = m.direction === 'INBOUND' ? 'Client' : 'TIS';
      return `${label}: ${this.renderBody(m)}`;
    });
    let joined = lines.join('\n');
    if (joined.length > ThreadSummaryService.HISTORY_CHAR_CAP) {
      joined = joined.slice(joined.length - ThreadSummaryService.HISTORY_CHAR_CAP);
      // Drop the now-partial first line so we start on a clean turn.
      const nl = joined.indexOf('\n');
      if (nl >= 0) joined = joined.slice(nl + 1);
    }
    return joined;
  }

  private renderBody(m: { body: string | null; type: string }): string {
    const body = (m.body ?? '').trim();
    if (body) return body;
    switch (m.type) {
      case 'IMAGE':
        return '[image]';
      case 'VIDEO':
        return '[video]';
      case 'AUDIO':
        return '[voice note]';
      case 'DOCUMENT':
        return '[document]';
      case 'STICKER':
        return '[sticker]';
      case 'LOCATION':
        return '[location]';
      case 'CONTACTS':
        return '[contact card]';
      case 'REACTION':
        return '[reaction]';
      default:
        return `[${m.type.toLowerCase()}]`;
    }
  }

  /** Parse the model's reply into the strict summary shape, or throw cleanly. */
  private parseStrictJson(reply: string): ParsedSummary {
    const cleaned = (reply ?? '').replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let raw: unknown;
    try {
      raw = JSON.parse(cleaned);
    } catch {
      throw new BadRequestException('Could not generate a summary, please try again');
    }
    return this.coerceParsed(raw);
  }

  /** Narrow arbitrary JSON (model output or cached column) to ParsedSummary. */
  private coerceParsed(raw: unknown): ParsedSummary {
    const o = (raw ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    return {
      summary: str(o.summary),
      suggestion: str(o.suggestion),
      draftReply: str(o.draftReply),
      language: o.language === 'ur_roman' ? 'ur_roman' : 'en',
    };
  }
}

const SYSTEM_PROMPT = `You brief a Tashfeen Immigration Solutions (TIS) sales rep on a WhatsApp conversation with a prospective client. Output STRICT JSON ONLY (no markdown, no code fences): {"summary": string, "suggestion": string, "draftReply": string, "language": "en" | "ur_roman"}.
- summary: 3-5 short sentences — what the client wants (country/program/visa), key facts they shared, what's been discussed or agreed, objections/concerns, current status. Ground ONLY in the conversation; NEVER invent fees, timelines, eligibility, or any fact not present.
- suggestion: ONE concrete recommended next action for the rep, specific to THIS conversation (e.g. book a consultation call, send a specific brochure, address a price objection with an installment option, follow up on a pending document).
- draftReply: a ready-to-send next WhatsApp message the rep can edit — in the CLIENT'S language (Roman Urdu if they write Urdu/Roman-Urdu, else English), warm and direct Pakistani business-chat tone, 1-3 short lines. NEVER guarantee visa approval; NEVER invent fees/timelines/eligibility; the initial consultation is FREE.
- language: the client's working language — "ur_roman" or "en".
Output ONLY the JSON object.`;

/** The strict shape persisted in WhatsAppThread.aiSummary + returned to the UI. */
interface ParsedSummary {
  summary: string;
  suggestion: string;
  draftReply: string;
  language: 'en' | 'ur_roman';
}

export interface ThreadSummaryResult extends ParsedSummary {
  /** How many messages were considered (up to HISTORY_LIMIT). */
  messageCount: number;
  /** When the (returned) summary was generated; null for the empty case. */
  generatedAt: Date | null;
  /** Newest message id the summary covers; null for the empty case. */
  throughMessageId: string | null;
  /** True when served from the thread cache (no AI call this request). */
  cached: boolean;
  /** True only for a thread with no messages (no AI call made). */
  empty?: boolean;
}
