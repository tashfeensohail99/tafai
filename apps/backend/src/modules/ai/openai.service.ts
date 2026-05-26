import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { ApiKeysService } from '../api-keys/api-keys.service';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const CHAT_MODEL = 'gpt-4o-mini';
const TRANSCRIPTION_MODEL = 'whisper-1';

/**
 * Thin wrapper around the OpenAI SDK that:
 *
 *   1. Loads the API key from {@link ApiKeysService} (single source of truth
 *      managed via Admin → API Keys), NOT from an env var. Rotation from the
 *      UI propagates within the service's 30-second cache TTL — no redeploy.
 *   2. Rebuilds the client whenever the cached key changes so we never use
 *      a stale token.
 *   3. Exposes embed() and chat() with shapes the orchestrator can use
 *      directly. Token + latency stats are returned alongside the result so
 *      they can be persisted into `ai.runs` for the cost dashboard.
 */
@Injectable()
export class OpenAiService {
  private readonly log = new Logger(OpenAiService.name);
  private client: OpenAI | null = null;
  private clientForKey: string | null = null;

  constructor(private readonly apiKeys: ApiKeysService) {}

  /** Lazy client with auto-refresh when the stored key changes. */
  private async getClient(): Promise<OpenAI> {
    const key = await this.apiKeys.getActiveKey('openai');
    if (!this.client || this.clientForKey !== key) {
      this.client = new OpenAI({ apiKey: key });
      this.clientForKey = key;
    }
    return this.client;
  }

  /**
   * Embed a piece of text into a 1536-dim vector using
   * text-embedding-3-small. Returns the vector + the input-token count.
   */
  async embed(text: string): Promise<{ embedding: number[]; inputTokens: number }> {
    const c = await this.getClient();
    const t0 = Date.now();
    const res = await c.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    });
    this.log.debug(
      `embed (${text.length} chars) in ${Date.now() - t0}ms, tokens=${res.usage?.total_tokens ?? '?'}`,
    );
    return {
      embedding: res.data[0].embedding,
      inputTokens: res.usage?.total_tokens ?? 0,
    };
  }

  /**
   * Chat completion via gpt-4o-mini. Returns the assistant message + token
   * usage so callers can log it for cost tracking.
   */
  async chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) {
    const c = await this.getClient();
    const t0 = Date.now();
    const res = await c.chat.completions.create({
      model: CHAT_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 350,
    });
    const latencyMs = Date.now() - t0;
    const reply = res.choices[0]?.message?.content?.trim() ?? '';
    return {
      reply,
      model: CHAT_MODEL,
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
      latencyMs,
    };
  }

  /**
   * Transcribe a voice / audio clip via Whisper. Used by the AI reply
   * processor to turn inbound WhatsApp voice notes into text the
   * orchestrator can reason about. Whisper costs $0.006/min — a typical
   * 30-second voice note is ~$0.003, negligible at our volume.
   *
   * `filename` is mostly for Meta + Whisper to sniff the codec; we pass the
   * recorded extension (e.g. "voice.ogg") so the API picks the right
   * decoder. Returns null on failure rather than throwing — a missed
   * transcription should just skip the AI reply, not break the pipeline.
   */
  async transcribe(audio: Buffer, filename: string): Promise<{ text: string; latencyMs: number } | null> {
    try {
      const c = await this.getClient();
      const t0 = Date.now();
      const file = await OpenAI.toFile(audio, filename);
      const res = await c.audio.transcriptions.create({
        file,
        model: TRANSCRIPTION_MODEL,
      });
      return { text: res.text.trim(), latencyMs: Date.now() - t0 };
    } catch (e) {
      this.log.error(`whisper transcribe failed: ${(e as Error).message}`);
      return null;
    }
  }

  static readonly EMBEDDING_MODEL = EMBEDDING_MODEL;
  static readonly CHAT_MODEL = CHAT_MODEL;
  static readonly TRANSCRIPTION_MODEL = TRANSCRIPTION_MODEL;
}
