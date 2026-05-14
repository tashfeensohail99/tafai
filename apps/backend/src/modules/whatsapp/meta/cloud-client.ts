import axios, { AxiosError, AxiosInstance } from 'axios';
import FormData from 'form-data';

export interface MetaClientConfig {
  apiVersion: string;
  phoneNumberId: string;
  accessToken: string;
  baseUrl?: string;
}

export interface SendTextInput {
  to: string;
  body: string;
  previewUrl?: boolean;
  contextWaMessageId?: string;
}

export interface SendTemplateInput {
  to: string;
  templateName: string;
  language: string;
  components?: Array<Record<string, unknown>>;
}

export interface SendMediaInput {
  to: string;
  type: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  link?: string;
  mediaId?: string;
  caption?: string;
  filename?: string;
  /** Set to true when sending a voice note. Meta requires voice: true in the
   *  audio object to render the message as a voice note (waveform + auto-play)
   *  rather than a basic audio attachment. File MUST be OGG/OPUS format. */
  voice?: boolean;
}

export interface MetaSendResponse {
  messaging_product: 'whatsapp';
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string; message_status?: string }>;
}

export interface MetaErrorDetail {
  code: number;
  title?: string;
  message: string;
  type?: string;
  fbtrace_id?: string;
}

export class MetaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: MetaErrorDetail,
    public readonly raw: unknown,
  ) {
    super(detail.message);
  }
}

/**
 * Thin Meta Cloud API client scoped to a single `phone_number_id`. One
 * instance per WhatsAppChannel; created by MetaClientFactory from a stored
 * encrypted token.
 *
 * No retries here — the BullMQ worker layer owns retry policy.
 */
export class MetaCloudClient {
  private readonly http: AxiosInstance;
  private readonly phoneNumberId: string;
  // Stored explicitly so multipart paths (uploadMedia) don't have to
  // introspect axios defaults to recover the bearer — `defaults.headers`
  // shape differs across axios v1 minors and can return undefined.
  private readonly accessToken: string;
  private readonly baseURL: string;

  constructor(cfg: MetaClientConfig) {
    this.phoneNumberId = cfg.phoneNumberId;
    this.accessToken = cfg.accessToken;
    this.baseURL = cfg.baseUrl ?? `https://graph.facebook.com/${cfg.apiVersion}`;
    this.http = axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });
  }

  async sendText(input: SendTextInput): Promise<MetaSendResponse> {
    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to,
      type: 'text',
      text: { body: input.body, preview_url: input.previewUrl ?? false },
    };
    if (input.contextWaMessageId) {
      body.context = { message_id: input.contextWaMessageId };
    }
    return this.post(body);
  }

  async sendTemplate(input: SendTemplateInput): Promise<MetaSendResponse> {
    const body = {
      messaging_product: 'whatsapp',
      to: input.to,
      type: 'template',
      template: {
        name: input.templateName,
        language: { code: input.language },
        components: input.components ?? [],
      },
    };
    return this.post(body);
  }

  async sendMedia(input: SendMediaInput): Promise<MetaSendResponse> {
    const media: Record<string, unknown> = {};
    if (input.link) media.link = input.link;
    if (input.mediaId) media.id = input.mediaId;
    if (input.caption) media.caption = input.caption;
    if (input.filename) media.filename = input.filename;
    // voice: true is required by Meta to render as a voice note (waveform,
    // auto-play, transcription). Without it the message arrives as a basic
    // audio attachment (music-note icon, manual download). Only set when the
    // caller explicitly marks this as a voice note — file must be OGG/OPUS.
    if (input.voice) media.voice = true;

    const body = {
      messaging_product: 'whatsapp',
      to: input.to,
      type: input.type,
      [input.type]: media,
    };
    return this.post(body);
  }

  async markAsRead(waMessageId: string): Promise<void> {
    await this.post({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: waMessageId,
    });
  }

  async getMediaUrl(metaMediaId: string): Promise<{
    url: string;
    mime_type: string;
    sha256: string;
    file_size: number;
  }> {
    try {
      const res = await this.http.get<{
        url: string;
        mime_type: string;
        sha256: string;
        file_size: number;
      }>(`/${metaMediaId}`);
      return res.data;
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  async downloadMedia(mediaUrl: string): Promise<Buffer> {
    try {
      const res = await this.http.get<ArrayBuffer>(mediaUrl, { responseType: 'arraybuffer' });
      return Buffer.from(res.data);
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  /**
   * Fetch the phone-number-level metadata Meta exposes about a connected
   * business number. Used by the admin Settings → Integrations page to
   * verify saved credentials actually work end-to-end, and to surface
   * the real verified name / quality rating / messaging tier back to
   * the operator instead of just "saved, hope it works".
   *
   * Endpoint: GET /{phone_number_id}?fields=...
   * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/phone-numbers
   */
  async getPhoneNumberInfo(): Promise<{
    verified_name: string | null;
    display_phone_number: string | null;
    quality_rating: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN' | null;
    messaging_limit_tier:
      | 'TIER_50'
      | 'TIER_250'
      | 'TIER_1K'
      | 'TIER_10K'
      | 'TIER_100K'
      | 'TIER_UNLIMITED'
      | null;
    code_verification_status: 'VERIFIED' | 'NOT_VERIFIED' | 'EXPIRED' | null;
    platform_type: string | null;
  }> {
    try {
      const res = await this.http.get<{
        verified_name?: string;
        display_phone_number?: string;
        quality_rating?: string;
        messaging_limit_tier?: string;
        code_verification_status?: string;
        platform_type?: string;
      }>(
        `/${this.phoneNumberId}?fields=verified_name,display_phone_number,quality_rating,messaging_limit_tier,code_verification_status,platform_type`,
      );
      return {
        verified_name: res.data.verified_name ?? null,
        display_phone_number: res.data.display_phone_number ?? null,
        quality_rating:
          (res.data.quality_rating as 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN') ?? null,
        messaging_limit_tier:
          (res.data.messaging_limit_tier as
            | 'TIER_50'
            | 'TIER_250'
            | 'TIER_1K'
            | 'TIER_10K'
            | 'TIER_100K'
            | 'TIER_UNLIMITED') ?? null,
        code_verification_status:
          (res.data.code_verification_status as 'VERIFIED' | 'NOT_VERIFIED' | 'EXPIRED') ??
          null,
        platform_type: res.data.platform_type ?? null,
      };
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  /**
   * Upload a media file to Meta's media API and return the reusable media_id.
   * The id is valid for ~30 days and can be passed to sendMedia({ mediaId }).
   *
   * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
   *
   * Two non-obvious bits this function gets right:
   *
   *   1. The `type` form field must be a bare MIME (e.g. "audio/ogg"), not
   *      a parameterised one ("audio/ogg;codecs=opus"). Voice notes coming
   *      from MediaRecorder in Chrome/Firefox arrive with the codecs param
   *      attached; Meta rejects those with "(#100) Param type must be one
   *      of {…}". We strip the params off the `type` field but keep the
   *      original (with codecs) on the file part so the file is still
   *      recognised correctly.
   *
   *   2. The shared axios instance has `Content-Type: application/json`
   *      as a default header. Multipart uploads need
   *      "multipart/form-data; boundary=…" instead — leaving the JSON
   *      default in place can collide with the boundary header and Meta
   *      either rejects or silently mis-parses the body. We pass
   *      `Content-Type: undefined` in the per-request headers to delete
   *      the inherited default, then set the multipart header from
   *      form.getHeaders() right after.
   *
   *   3. The default 15s instance timeout is too short for larger media
   *      (a 5MB document over a 3G uplink takes longer); bump to 60s for
   *      the upload path only.
   */
  async uploadMedia(file: Buffer, mimeType: string, filename: string): Promise<string> {
    try {
      const baseMime = mimeType.split(';')[0].trim().toLowerCase();
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', baseMime);
      form.append('file', file, { filename, contentType: mimeType });

      // Use a fresh `axios` call (not `this.http`) so we don't inherit
      // the shared instance's `Content-Type: application/json` default
      // and end up with a header collision against the multipart
      // boundary that form.getHeaders() supplies. Auth + base URL are
      // pulled from instance fields — not from axios defaults, whose
      // shape isn't stable across axios v1 minors.
      const res = await axios.post<{ id: string }>(
        `${this.baseURL}/${this.phoneNumberId}/media`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${this.accessToken}`,
          },
          timeout: 60_000,
          maxBodyLength: 32 * 1024 * 1024,
          maxContentLength: 32 * 1024 * 1024,
        },
      );
      return res.data.id;
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  async listTemplates(wabaId: string): Promise<unknown[]> {    try {
      const out: unknown[] = [];
      let next: string | undefined = `/${wabaId}/message_templates?limit=100`;
      while (next) {
        const res: { data: { data: unknown[]; paging?: { next?: string } } } =
          await this.http.get(next);
        out.push(...res.data.data);
        next = res.data.paging?.next;
      }
      return out;
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  private async post(body: Record<string, unknown>): Promise<MetaSendResponse> {
    try {
      const res = await this.http.post<MetaSendResponse>(`/${this.phoneNumberId}/messages`, body);
      return res.data;
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  private normalizeError(err: unknown): MetaApiError {
    if (err instanceof AxiosError && err.response) {
      const data = err.response.data as { error?: MetaErrorDetail };
      const detail: MetaErrorDetail = data.error ?? {
        code: err.response.status,
        message: err.message,
      };
      return new MetaApiError(err.response.status, detail, err.response.data);
    }
    if (err instanceof Error) {
      return new MetaApiError(0, { code: 0, message: err.message }, err);
    }
    return new MetaApiError(0, { code: 0, message: 'Unknown error' }, err);
  }
}
