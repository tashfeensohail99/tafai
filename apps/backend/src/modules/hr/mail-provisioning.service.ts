import { Injectable, Logger, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Provisions employee business mailboxes on MXRoute, which runs DirectAdmin.
 *
 * Talks to DirectAdmin's `CMD_API_POP` (create / list / delete email accounts).
 * Contract proven live 2026-08-20:
 *   LIST   GET  ?action=list&domain=…            → `list[]=<localpart>` lines
 *   CREATE POST action=create&user&passwd&passwd2&quota&limit → `error=0&text=…`
 *   DELETE POST action=delete&user                → `error=0&text=…`
 * Auth is HTTP Basic (DirectAdmin user + a Login Key scoped to CMD_API_POP).
 * Responses are URL-encoded query strings; `error=0` is success.
 *
 * Sending mail still goes through Hostinger SMTP (EmailService) — this service
 * only creates/removes the mailboxes themselves.
 */
@Injectable()
export class MailProvisioningService {
  private readonly log = new Logger(MailProvisioningService.name);
  private readonly baseUrl: string;
  private readonly user: string;
  private readonly loginKey: string;
  readonly domain: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (this.config.get<string>('MXROUTE_DA_URL') ?? '').replace(/\/+$/, '');
    this.user = this.config.get<string>('MXROUTE_DA_USER') ?? '';
    this.loginKey = this.config.get<string>('MXROUTE_DA_LOGIN_KEY') ?? '';
    this.domain = this.config.get<string>('MXROUTE_MAIL_DOMAIN') ?? 'tashfeengroup.com';
  }

  /** True only when all DirectAdmin credentials are configured. */
  isConfigured(): boolean {
    return !!(this.baseUrl && this.user && this.loginKey && this.domain);
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Business-email provisioning is not configured (MXROUTE_* env vars missing).',
      );
    }
  }

  private authHeader(): string {
    return 'Basic ' + Buffer.from(`${this.user}:${this.loginKey}`).toString('base64');
  }

  /** Low-level DirectAdmin call. `params` are form-encoded (POST) or query (GET). */
  private async call(
    params: Record<string, string>,
    method: 'GET' | 'POST',
  ): Promise<URLSearchParams> {
    const body = new URLSearchParams(params);
    const url =
      method === 'GET'
        ? `${this.baseUrl}/CMD_API_POP?${body.toString()}`
        : `${this.baseUrl}/CMD_API_POP`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: this.authHeader(),
          ...(method === 'POST'
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}),
        },
        body: method === 'POST' ? body.toString() : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      this.log.error(`DirectAdmin ${params.action} request failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Mail server (MXRoute) is unreachable. Try again.');
    }
    const text = await res.text();
    if (!res.ok) {
      this.log.error(`DirectAdmin ${params.action} HTTP ${res.status}: ${text.slice(0, 200)}`);
      throw new ServiceUnavailableException(`Mail server returned HTTP ${res.status}.`);
    }
    return new URLSearchParams(text);
  }

  /** All local-parts (the bit before @) that already exist on the domain. */
  async listLocalParts(): Promise<string[]> {
    this.assertConfigured();
    const parsed = await this.call({ action: 'list', domain: this.domain }, 'GET');
    // DirectAdmin returns repeated `list[]=<name>` keys.
    const parts = parsed.getAll('list[]');
    return parts.map((p) => p.toLowerCase());
  }

  /**
   * Turn a first name into a free local-part on the domain.
   * `aqsa` → `aqsa`, or `aqsa2`, `aqsa3`… if taken. Non-letters are stripped.
   */
  async allocateLocalPart(firstName: string): Promise<string> {
    const base = (firstName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!base) throw new BadRequestException('First name has no usable letters for an email.');
    const taken = new Set(await this.listLocalParts());
    if (!taken.has(base)) return base;
    for (let i = 2; i < 100; i++) {
      const candidate = `${base}${i}`;
      if (!taken.has(candidate)) return candidate;
    }
    throw new BadRequestException(`Too many mailboxes already named like "${base}".`);
  }

  /** Create a mailbox. Throws with DirectAdmin's message on failure. */
  async createMailbox(
    localPart: string,
    password: string,
    opts?: { quotaMb?: number; sendLimitPerDay?: number },
  ): Promise<string> {
    this.assertConfigured();
    const res = await this.call(
      {
        action: 'create',
        domain: this.domain,
        user: localPart,
        passwd: password,
        passwd2: password,
        quota: String(opts?.quotaMb ?? 2048),
        limit: String(opts?.sendLimitPerDay ?? 200),
      },
      'POST',
    );
    if (res.get('error') !== '0') {
      const msg = res.get('text') || res.get('details') || 'unknown error';
      this.log.error(`createMailbox ${localPart}@${this.domain} failed: ${msg}`);
      throw new BadRequestException(`Could not create mailbox: ${msg}`);
    }
    const email = `${localPart}@${this.domain}`;
    this.log.log(`Created mailbox ${email}`);
    return email;
  }

  /** Reset an EXISTING mailbox's password (used to "activate" a dormant inbox). */
  async resetPassword(localPart: string, password: string): Promise<void> {
    this.assertConfigured();
    const res = await this.call(
      { action: 'modify', domain: this.domain, user: localPart, passwd: password, passwd2: password },
      'POST',
    );
    if (res.get('error') !== '0') {
      const msg = res.get('text') || res.get('details') || 'unknown error';
      this.log.error(`resetPassword ${localPart}@${this.domain} failed: ${msg}`);
      throw new BadRequestException(`Could not reset mailbox password: ${msg}`);
    }
    this.log.log(`Reset password for mailbox ${localPart}@${this.domain}`);
  }

  /** Permanently delete a mailbox (offboarding). Idempotent-ish: logs on failure. */
  async deleteMailbox(localPart: string): Promise<void> {
    this.assertConfigured();
    const res = await this.call(
      { action: 'delete', domain: this.domain, user: localPart },
      'POST',
    );
    if (res.get('error') !== '0') {
      const msg = res.get('text') || res.get('details') || 'unknown error';
      this.log.error(`deleteMailbox ${localPart}@${this.domain} failed: ${msg}`);
      throw new BadRequestException(`Could not delete mailbox: ${msg}`);
    }
    this.log.log(`Deleted mailbox ${localPart}@${this.domain}`);
  }
}
