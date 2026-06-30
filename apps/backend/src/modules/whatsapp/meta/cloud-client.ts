import axios, { AxiosError, AxiosInstance } from 'axios';
import FormData from 'form-data';
import { Agent as HttpsAgent } from 'node:https';

/**
 * Module-scoped HTTPS agent with TCP keep-alive enabled. Every MetaCloudClient
 * instance (one per channel, built fresh on every send by the factory) hands
 * its axios call this same agent, so the socket pool to graph.facebook.com is
 * shared across the whole process.
 *
 * Without keep-alive each send did a fresh TCP + TLS 1.3 handshake (~200-500ms
 * of pure overhead on top of the actual request). With keep-alive the first
 * send pays that once, subsequent sends reuse the warm socket and the
 * worker→Meta leg drops to roughly one round-trip latency.
 *
 *   maxSockets: 16  — matches the BullMQ outbound concurrency, so a burst of
 *                     parallel sends can each hold their own warm connection
 *                     instead of fighting over a smaller pool.
 *   keepAliveMsecs: send a TCP keep-alive probe every 30s on idle sockets so
 *                     Meta's load balancer doesn't quietly drop them; cheap.
 *   scheduling 'lifo': prefer the most-recently-used socket, which is the one
 *                     most likely still alive on Meta's side.
 *
 * If Meta's edge closes a socket between sends, Node detects the dead socket
 * on the next write and transparently opens a fresh one — worst case that
 * single send is as slow as today (no benefit), then everything resumes warm.
 *
 * Safety: keep-alive is encouraged by Meta's docs for high-volume integrations
 * and is the default for every browser. No rate-limit, no policy, no semantic
 * change — same Authorization header, same payload, same retry behaviour.
 */
const metaHttpsAgent = new HttpsAgent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 16,
  scheduling: 'lifo',
});

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
      // Share the module-level keep-alive pool so we don't pay a TLS handshake
      // on every send. See metaHttpsAgent at the top of this file.
      httpsAgent: metaHttpsAgent,
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
      // BARE mime on the file part too (not the parameterised "audio/ogg;
      // codecs=opus"): Meta's media processor can't match a parameterised
      // content-type and stores the object as application/octet-stream,
      // which then fails delivery with 131053. knownLength lets form-data
      // report an accurate part size.
      form.append('file', file, {
        filename,
        contentType: baseMime,
        knownLength: file.length,
      });

      // Use a fresh `axios` call (not `this.http`) so we don't inherit
      // the shared instance's `Content-Type: application/json` default
      // and end up with a header collision against the multipart
      // boundary that form.getHeaders() supplies. Auth + base URL are
      // pulled from instance fields — not from axios defaults, whose
      // shape isn't stable across axios v1 minors.
      // Compute an explicit Content-Length. Without it axios streams the
      // multipart with Transfer-Encoding: chunked, and Meta's media
      // endpoint can mis-store a chunked body as application/octet-stream
      // (→ 131053 on send). getLengthSync is exact here: every part is a
      // Buffer or string with a known length.
      const contentLength = form.getLengthSync();
      const res = await axios.post<{ id: string }>(
        `${this.baseURL}/${this.phoneNumberId}/media`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Content-Length': contentLength,
            Authorization: `Bearer ${this.accessToken}`,
          },
          timeout: 60_000,
          maxBodyLength: 32 * 1024 * 1024,
          maxContentLength: 32 * 1024 * 1024,
          // Share the keep-alive pool — multipart uploads benefit too, especially
          // for back-to-back voice notes and image bursts.
          httpsAgent: metaHttpsAgent,
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

  /**
   * Read this phone number's settings, including the `calling` config
   * (status + call_icon_visibility). Requires the number's own access token.
   */
  async getPhoneSettings(): Promise<Record<string, unknown>> {
    try {
      const res = await this.http.get<Record<string, unknown>>(`/${this.phoneNumberId}/settings`);
      return res.data;
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  /**
   * Enable user-initiated calling on this number and surface the in-chat call
   * button (`call_icon_visibility=DEFAULT`). Idempotent on Meta's side.
   */
  async enableCalling(): Promise<Record<string, unknown>> {
    try {
      const res = await this.http.post<Record<string, unknown>>(`/${this.phoneNumberId}/settings`, {
        calling: { status: 'ENABLED', call_icon_visibility: 'DEFAULT' },
      });
      return res.data;
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  /**
   * Control an inbound WhatsApp call (Meta Calling API). One endpoint covers
   * every action:
   *   POST /{phoneNumberId}/calls
   *   { messaging_product, call_id, action, session?: { sdp_type:'answer', sdp } }
   * `session` (the SDP answer) is sent only for `accept` / `pre_accept`.
   */
  async respondToCall(input: {
    callId: string;
    action: 'pre_accept' | 'accept' | 'reject' | 'terminate';
    sdpAnswer?: string;
  }): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      call_id: input.callId,
      action: input.action,
    };
    if (input.sdpAnswer && (input.action === 'accept' || input.action === 'pre_accept')) {
      body.session = { sdp_type: 'answer', sdp: input.sdpAnswer };
    }
    // Bounded retry with backoff on TRANSIENT failures only. A lost `accept`
    // means Meta never receives the SDP answer → media never confirms → the
    // call drops ~5-6s in; a lost `terminate` leaves a zombie leg. A 4xx (e.g.
    // "call already accepted/terminated") is deterministic and is NOT retried.
    const delays = [50, 150, 400];
    let lastErr: unknown;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.http.post<Record<string, unknown>>(`/${this.phoneNumberId}/calls`, body);
        return res.data;
      } catch (err) {
        lastErr = err;
        if (attempt >= delays.length || !this.isRetryablePostError(err)) break;
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
    throw this.normalizeError(lastErr);
  }

  /**
   * A call-control POST is worth a quick retry only when the failure is
   * transient: a network/timeout error (no HTTP response) or a 5xx / 429 from
   * Meta. A 4xx is a deterministic rejection (bad state / bad request) and must
   * not be retried.
   */
  private isRetryablePostError(err: unknown): boolean {
    if (err instanceof AxiosError) {
      const status = err.response?.status;
      if (status == null) return true; // network / timeout / connection reset
      return status >= 500 || status === 429;
    }
    return false;
  }

  /**
   * Initiate a BUSINESS-initiated (outbound) call. The business is the offerer:
   * we send an SDP OFFER; Meta rings the user; on accept, the user's SDP ANSWER
   * arrives on the Connect webhook (calls[].session.sdp, sdp_type 'answer'),
   * which the caller's browser applies as the remote description.
   *   POST /{phoneNumberId}/calls
   *   { messaging_product, to, action:'connect', session:{ sdp_type:'offer', sdp } }
   * REQUIRES prior user call-permission — Meta rejects the call otherwise, which
   * surfaces here as a MetaApiError the caller can act on.
   */
  async initiateCall(input: { to: string; sdpOffer: string }): Promise<{
    callId: string;
    raw: Record<string, unknown>;
  }> {
    try {
      const res = await this.http.post<Record<string, unknown>>(`/${this.phoneNumberId}/calls`, {
        messaging_product: 'whatsapp',
        to: input.to,
        action: 'connect',
        session: { sdp_type: 'offer', sdp: input.sdpOffer },
      });
      const data = res.data as {
        id?: string;
        calls?: Array<{ id?: string }>;
        messages?: Array<{ id?: string }>;
      };
      const callId = data.calls?.[0]?.id ?? data.id ?? data.messages?.[0]?.id ?? '';
      return { callId, raw: res.data };
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  /**
   * Request permission to call a user (required before any business-initiated
   * call — an inbound call from them does NOT grant it). Sent as a free-form
   * interactive message, so it needs an open 24h window. The user taps
   * Allow/Decline in their WhatsApp client; their response arrives on the
   * webhook.
   *   POST /{phoneNumberId}/messages
   *   { type:'interactive', interactive:{ type:'call_permission_request', ... } }
   */
  async sendCallPermissionRequest(input: { to: string; bodyText: string }): Promise<MetaSendResponse> {
    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to,
      type: 'interactive',
      interactive: {
        type: 'call_permission_request',
        action: { name: 'call_permission_request' },
        body: { text: input.bodyText },
      },
    });
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
