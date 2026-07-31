import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { ApiKeysService } from '../api-keys/api-keys.service';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const CHAT_MODEL = 'gpt-4o-mini';
const TRANSCRIPTION_MODEL = 'whisper-1';
// gpt-4o-mini is multimodal — the same "gpt4o_mini_vision" tier the document
// parser already uses for field extraction. Reused here to OCR bank receipts.
const VISION_MODEL = 'gpt-4o-mini';

/** Advisory fields lifted off a bank-transfer receipt / payment screenshot. */
export interface ReceiptOcrFields {
  amount: number | null;
  currency: string | null;
  /** Transaction date as YYYY-MM-DD, or null if not clearly printed. */
  paidAt: string | null;
  sender: string | null;
  bankName: string | null;
  reference: string | null;
  rawText: string | null;
  /** 0..1 — the model's confidence this is a genuine receipt for the amount. */
  confidence: number | null;
}

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
   * Vision-extract the key fields from a bank-transfer RECEIPT / payment-app
   * screenshot (amount, date, sender, bank, reference) as strict JSON. Used by
   * the reception module to give finance an advisory read of a QR-uploaded
   * consultation receipt — the officer still verifies the payment by hand, so a
   * wrong or missing read is harmless. Returns null on ANY failure (no key,
   * transport, non-JSON) rather than throwing: a missed read just hides the hint.
   *
   * The read is deliberately INDEPENDENT of what the desk expects — no expected
   * amount is fed to the model, so a doctored image can't be nudged into
   * "confirming" the desk's figure; a real discrepancy surfaces as a mismatch.
   */
  async readReceiptImage(image: Buffer, mimeType: string): Promise<ReceiptOcrFields | null> {
    try {
      const c = await this.getClient();
      const dataUrl = `data:${mimeType};base64,${image.toString('base64')}`;
      const res = await c.chat.completions.create({
        model: VISION_MODEL,
        temperature: 0,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You read Pakistani and international bank-transfer receipts and payment-app screenshots (UBL, HBL, Meezan, Bank Alfalah, JazzCash, Easypaisa, Raast, SWIFT wire slips). Extract ONLY what is literally printed; never guess. Always reply with a single JSON object.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'Return a JSON object with exactly these keys: ' +
                  'amount (number — the transferred/paid amount, digits only, no thousands separators; null if unreadable), ' +
                  'currency (ISO code like PKR/USD/AED if shown, else null), ' +
                  'paidAt (transaction date as YYYY-MM-DD if present, else null), ' +
                  'sender (payer / from-account holder name if shown, else null), ' +
                  'bankName (bank or wallet name, e.g. UBL / HBL / JazzCash, else null), ' +
                  'reference (transaction id / TID / reference / trace number, else null), ' +
                  'confidence (0..1 — how sure you are this is a genuine payment receipt AND the amount is correct), ' +
                  'rawText (all text you can read as one string). ' +
                  'The transferred amount is usually the figure labelled Amount / Transfer / Debit / Paid — not an account or reference number. ' +
                  'Use null for anything not clearly present.',
              },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } },
            ],
          },
        ],
      });
      const txt = res.choices[0]?.message?.content?.trim();
      if (!txt) return null;
      const p = JSON.parse(txt) as Record<string, unknown>;
      const num = (v: unknown): number | null => {
        if (typeof v === 'number') return Number.isFinite(v) ? v : null;
        if (typeof v === 'string') {
          const n = parseFloat(v.replace(/[^0-9.]/g, ''));
          return Number.isFinite(n) ? n : null;
        }
        return null;
      };
      const str = (v: unknown): string | null =>
        typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null;
      const conf = num(p.confidence);
      return {
        amount: num(p.amount),
        currency: str(p.currency),
        paidAt: str(p.paidAt),
        sender: str(p.sender),
        bankName: str(p.bankName),
        reference: str(p.reference),
        rawText: typeof p.rawText === 'string' ? p.rawText.slice(0, 4000) : null,
        confidence: conf != null ? Math.max(0, Math.min(1, conf)) : null,
      };
    } catch (e) {
      this.log.warn(`receipt OCR failed: ${(e as Error).message}`);
      return null;
    }
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
   *
   * If Whisper returns Urdu-script text (nearly all Pakistani speakers), the
   * transcript is transliterated to Roman Urdu via a cheap gpt-4o-mini pass
   * — reps read Roman Urdu ~10× faster than the native script. English +
   * numbers pass through untouched. Failure of the transliteration step
   * falls back to the raw Urdu-script text — better than nothing.
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
      const raw = res.text.trim();
      const romanised = await this.toRomanUrduIfNeeded(raw);
      return { text: romanised, latencyMs: Date.now() - t0 };
    } catch (e) {
      this.log.error(`whisper transcribe failed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * If the text contains Arabic-script characters (Urdu uses the Arabic
   * script), transliterate to Roman Urdu — Urdu spelled with Latin letters
   * (e.g. "میں آپ کا شکرگزار ہوں" → "mein aap ka shukar guzar hoon").
   * English, digits, and punctuation are preserved as-is; the model is
   * instructed not to translate to English. Returns the input unchanged
   * when nothing looks like Urdu script, or when the model call fails.
   */
  private async toRomanUrduIfNeeded(text: string): Promise<string> {
    // U+0600..U+06FF = Arabic (covers Urdu); U+0750..U+077F = Arabic Supplement.
    if (!/[؀-ۿݐ-ݿ]/.test(text)) return text;
    try {
      const c = await this.getClient();
      const res = await c.chat.completions.create({
        model: CHAT_MODEL,
        temperature: 0,
        max_tokens: Math.min(1024, Math.ceil(text.length * 2) + 64),
        messages: [
          {
            role: 'system',
            content:
              'You transliterate Urdu text (written in the Arabic-derived Urdu script) into Roman Urdu — Urdu spelled with English letters, phonetically. ' +
              'Keep English words, numbers, and punctuation exactly as written. ' +
              'Do NOT translate to English. Do NOT add commentary, quotes, or explanations. ' +
              'Return only the Roman Urdu transliteration.',
          },
          { role: 'user', content: text },
        ],
      });
      const out = res.choices[0]?.message?.content?.trim();
      return out && out.length > 0 ? out : text;
    } catch (e) {
      this.log.warn(`roman-urdu transliteration failed, using raw: ${(e as Error).message}`);
      return text;
    }
  }

  static readonly EMBEDDING_MODEL = EMBEDDING_MODEL;
  static readonly CHAT_MODEL = CHAT_MODEL;
  static readonly TRANSCRIPTION_MODEL = TRANSCRIPTION_MODEL;
}
