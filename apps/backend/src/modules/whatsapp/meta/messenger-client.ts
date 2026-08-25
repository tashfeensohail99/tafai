import axios, { AxiosError, AxiosInstance } from 'axios';
import { Agent as HttpsAgent } from 'node:https';
import type { MetaSendResponse } from './cloud-client';

/**
 * Facebook Messenger (Page) Send API client — the Messenger counterpart to
 * MetaCloudClient. Built fresh per channel by WhatsAppMetaClientFactory.
 *
 * Differs from the WhatsApp Cloud API on every axis: POSTs to
 * `/<PAGE_ID>/messages` (not `/<PHONE_NUMBER_ID>/messages`), addresses the user
 * by PSID (`recipient.id`) not a phone number, has no `messaging_product` field,
 * and governs proactive sends with `messaging_type` + the `HUMAN_AGENT` tag
 * instead of templates. Responses are `{ recipient_id, message_id }`, which we
 * map onto the shared MetaSendResponse shape so the outbound processor's
 * `res.messages[0].id` handling is unchanged.
 */
const messengerHttpsAgent = new HttpsAgent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 16,
  scheduling: 'lifo',
});

export interface MessengerClientConfig {
  apiVersion: string;
  pageId: string;
  accessToken: string;
  baseUrl?: string;
}

export type MessengerAttachmentType = 'image' | 'video' | 'audio' | 'file';

interface RawMessengerSendResponse {
  recipient_id?: string;
  message_id?: string;
}

export class MessengerCloudClient {
  private readonly http: AxiosInstance;
  private readonly pageId: string;

  constructor(cfg: MessengerClientConfig) {
    this.pageId = cfg.pageId;
    this.http = axios.create({
      baseURL: cfg.baseUrl ?? `https://graph.facebook.com/${cfg.apiVersion}`,
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
      httpsAgent: messengerHttpsAgent,
    });
  }

  /**
   * Send a text message. Inside the 24h window → messaging_type RESPONSE. Outside
   * it a human rep can still reply for up to 7 days via the HUMAN_AGENT tag
   * (Messenger has no template equivalent), so `humanAgent` sets MESSAGE_TAG.
   */
  async sendText(psid: string, text: string, opts?: { humanAgent?: boolean }): Promise<MetaSendResponse> {
    return this.post({
      recipient: { id: psid },
      messaging_type: opts?.humanAgent ? 'MESSAGE_TAG' : 'RESPONSE',
      ...(opts?.humanAgent ? { tag: 'HUMAN_AGENT' } : {}),
      message: { text },
    });
  }

  /** Send a media attachment by (public/signed) URL. */
  async sendAttachment(
    psid: string,
    type: MessengerAttachmentType,
    url: string,
    opts?: { humanAgent?: boolean },
  ): Promise<MetaSendResponse> {
    return this.post({
      recipient: { id: psid },
      messaging_type: opts?.humanAgent ? 'MESSAGE_TAG' : 'RESPONSE',
      ...(opts?.humanAgent ? { tag: 'HUMAN_AGENT' } : {}),
      message: { attachment: { type, payload: { url, is_reusable: false } } },
    });
  }

  private async post(body: Record<string, unknown>): Promise<MetaSendResponse> {
    try {
      const res = await this.http.post<RawMessengerSendResponse>(`/${this.pageId}/messages`, body);
      return {
        messaging_product: 'whatsapp',
        contacts: [],
        messages: res.data?.message_id ? [{ id: res.data.message_id }] : [],
      } as MetaSendResponse;
    } catch (err) {
      const ax = err as AxiosError<{ error?: { message?: string; code?: number } }>;
      const detail = ax.response?.data?.error?.message ?? ax.message;
      throw new Error(`Messenger send failed: ${detail}`);
    }
  }
}
