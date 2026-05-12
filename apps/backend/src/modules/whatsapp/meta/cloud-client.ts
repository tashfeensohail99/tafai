import axios, { AxiosError, AxiosInstance } from 'axios';

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

  constructor(cfg: MetaClientConfig) {
    this.phoneNumberId = cfg.phoneNumberId;
    this.http = axios.create({
      baseURL: cfg.baseUrl ?? `https://graph.facebook.com/${cfg.apiVersion}`,
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

  async listTemplates(wabaId: string): Promise<unknown[]> {
    try {
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
