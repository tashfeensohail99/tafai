import { Injectable, Logger } from '@nestjs/common';
import { createSign } from 'crypto';
import * as https from 'https';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import {
  base64url,
  buildFcmMessage,
  buildFcmDataMessage,
  buildJwtClaims,
  isStaleTokenError,
  parseServiceAccount,
  type ServiceAccount,
} from './push.util';

/**
 * Push delivery over FCM HTTP v1 — the second channel behind every in-app
 * Notification (NotificationsService.create fans out to here).
 *
 * Credentials live in the encrypted ApiKeys store under provider `fcm` (the
 * Google service-account JSON). With NO key configured this service is a
 * complete no-op — safe to ship before any mobile client or Firebase project
 * exists. Once a key is set and devices register, the same call path delivers
 * to Android now and iOS later (FCM bridges to APNs).
 *
 * All methods are best-effort and never throw into the caller: a push failure
 * must never break the business event that produced the notification.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger(PushService.name);
  private tokenCache: { accessToken: string; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  /** Deliver a notification to every device the user has registered. */
  async sendToUser(
    userId: string,
    msg: { title: string; body?: string | null; link?: string | null; type?: string | null },
  ): Promise<void> {
    try {
      const devices = await this.prisma.deviceToken.findMany({
        where: { userId },
        select: { id: true, token: true },
      });
      if (devices.length === 0) return; // nobody to push to

      const sa = await this.getServiceAccount();
      if (!sa) return; // push not configured — silent no-op

      const accessToken = await this.getAccessToken(sa);
      if (!accessToken) return;

      await Promise.all(
        devices.map((d) => this.sendOne(sa, accessToken, d.id, d.token, msg)),
      );
    } catch (e) {
      this.log.warn(`push sendToUser failed (${userId}): ${(e as Error).message}`);
    }
  }

  /**
   * Deliver a **data-only** high-priority message to every device the user has
   * registered. Unlike [sendToUser], this carries no `notification` block, so
   * Android hands it to the app's background message handler — used to ring an
   * incoming call (CallKit / ConnectionService) even when backgrounded/locked.
   */
  async sendDataToUser(
    userId: string,
    data: Record<string, string>,
    opts?: { ttlSeconds?: number },
  ): Promise<void> {
    try {
      const devices = await this.prisma.deviceToken.findMany({
        where: { userId },
        select: { id: true, token: true },
      });
      if (devices.length === 0) return;

      const sa = await this.getServiceAccount();
      if (!sa) return; // push not configured — silent no-op

      const accessToken = await this.getAccessToken(sa);
      if (!accessToken) return;

      await Promise.all(
        devices.map((d) =>
          this.sendOneData(sa, accessToken, d.id, d.token, data, opts?.ttlSeconds),
        ),
      );
    } catch (e) {
      this.log.warn(`push sendDataToUser failed (${userId}): ${(e as Error).message}`);
    }
  }

  /** Ring the rep's devices for an incoming WhatsApp call (wakes the app). */
  async sendCallInvite(
    userId: string,
    call: {
      callId: string;
      from: string;
      leadName?: string | null;
      leadId?: string | null;
      threadId?: string | null;
    },
  ): Promise<void> {
    await this.sendDataToUser(
      userId,
      {
        type: 'incoming_call',
        callId: call.callId,
        // NOTE: `from` is a RESERVED FCM data key — using it gets the whole
        // message rejected with 400 "Invalid data payload key: from".
        callerPhone: call.from ?? '',
        leadName: call.leadName ?? '',
        leadId: call.leadId ?? '',
        threadId: call.threadId ?? '',
      },
      { ttlSeconds: 45 },
    );
  }

  /** Tell the rep's devices to stop ringing (answered elsewhere / cancelled). */
  async sendCallCancel(userId: string, callId: string): Promise<void> {
    await this.sendDataToUser(
      userId,
      { type: 'call_cancelled', callId },
      { ttlSeconds: 30 },
    );
  }

  // ── Credentials / auth ──

  private async getServiceAccount(): Promise<ServiceAccount | null> {
    try {
      if (!(await this.apiKeys.hasActiveKey('fcm'))) return null;
      const json = await this.apiKeys.getActiveKey('fcm');
      const sa = parseServiceAccount(json);
      if (!sa) this.log.warn('FCM service-account key is present but unparseable');
      return sa;
    } catch {
      return null;
    }
  }

  /** Mint (and cache ~55 min) a Google OAuth access token for FCM. */
  private async getAccessToken(sa: ServiceAccount): Promise<string | null> {
    const nowMs = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > nowMs) {
      return this.tokenCache.accessToken;
    }
    try {
      const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claims = base64url(
        JSON.stringify(buildJwtClaims(sa.clientEmail, sa.tokenUri, Math.floor(nowMs / 1000))),
      );
      const signingInput = `${header}.${claims}`;
      const signature = base64url(
        createSign('RSA-SHA256').update(signingInput).sign(sa.privateKey),
      );
      const jwt = `${signingInput}.${signature}`;

      const form = `grant_type=${encodeURIComponent(
        'urn:ietf:params:oauth:grant-type:jwt-bearer',
      )}&assertion=${encodeURIComponent(jwt)}`;
      const res = await this.httpsPost(
        sa.tokenUri,
        { 'Content-Type': 'application/x-www-form-urlencoded' },
        form,
      );
      if (res.status !== 200) {
        this.log.warn(`FCM token mint failed (${res.status}): ${res.body.slice(0, 200)}`);
        return null;
      }
      const parsed = JSON.parse(res.body) as { access_token?: string; expires_in?: number };
      if (!parsed.access_token) return null;
      const ttlMs = (parsed.expires_in ?? 3600) * 1000;
      this.tokenCache = {
        accessToken: parsed.access_token,
        expiresAt: nowMs + ttlMs - 300_000, // refresh 5 min early
      };
      return parsed.access_token;
    } catch (e) {
      this.log.warn(`FCM token mint error: ${(e as Error).message}`);
      return null;
    }
  }

  // ── Send ──

  private async sendOne(
    sa: ServiceAccount,
    accessToken: string,
    deviceRowId: string,
    deviceToken: string,
    msg: { title: string; body?: string | null; link?: string | null; type?: string | null },
  ): Promise<void> {
    try {
      const url = `https://fcm.googleapis.com/v1/projects/${sa.projectId}/messages:send`;
      const body = JSON.stringify(
        buildFcmMessage({
          token: deviceToken,
          title: msg.title,
          body: msg.body,
          link: msg.link,
          type: msg.type,
        }),
      );
      const res = await this.httpsPost(
        url,
        { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body,
      );
      if (res.status === 200) return;
      if (isStaleTokenError(res.status, res.body)) {
        // Token is permanently dead (app uninstalled / token rotated) — prune it.
        await this.prisma.deviceToken.delete({ where: { id: deviceRowId } }).catch(() => undefined);
        return;
      }
      this.log.warn(`FCM send failed (${res.status}): ${res.body.slice(0, 200)}`);
    } catch (e) {
      this.log.warn(`FCM send error: ${(e as Error).message}`);
    }
  }

  private async sendOneData(
    sa: ServiceAccount,
    accessToken: string,
    deviceRowId: string,
    deviceToken: string,
    data: Record<string, string>,
    ttlSeconds?: number,
  ): Promise<void> {
    try {
      const url = `https://fcm.googleapis.com/v1/projects/${sa.projectId}/messages:send`;
      const body = JSON.stringify(
        buildFcmDataMessage({ token: deviceToken, data, ttlSeconds }),
      );
      const res = await this.httpsPost(
        url,
        { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body,
      );
      if (res.status === 200) return;
      if (isStaleTokenError(res.status, res.body)) {
        await this.prisma.deviceToken
          .delete({ where: { id: deviceRowId } })
          .catch(() => undefined);
        return;
      }
      this.log.warn(`FCM data send failed (${res.status}): ${res.body.slice(0, 200)}`);
    } catch (e) {
      this.log.warn(`FCM data send error: ${(e as Error).message}`);
    }
  }

  private httpsPost(
    urlString: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(urlString);
      } catch (e) {
        return reject(e as Error);
      }
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'POST',
          headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
        },
      );
      req.on('error', reject);
      req.setTimeout(10_000, () => req.destroy(new Error('FCM request timeout')));
      req.write(body);
      req.end();
    });
  }
}
