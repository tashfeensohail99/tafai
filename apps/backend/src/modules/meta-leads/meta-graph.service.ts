import { Injectable, Logger } from '@nestjs/common';
import { MetaCredentialsService } from './meta-credentials.service';

export interface MetaLeadFieldDatum {
  name: string;
  values: string[];
}

/** Subset of the Graph leadgen node we read. All fields optional per Meta. */
export interface MetaLeadDetail {
  id: string;
  created_time?: string;
  field_data?: MetaLeadFieldDatum[];
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  platform?: string;
  is_organic?: boolean;
}

/**
 * Thin Graph API client for Lead Ads retrieval. Uses global fetch (no axios
 * dependency) with a hard timeout. Token comes from MetaCredentialsService
 * (reuses the stored System User token).
 */
@Injectable()
export class MetaGraphService {
  private readonly log = new Logger(MetaGraphService.name);

  constructor(private readonly creds: MetaCredentialsService) {}

  private async get<T>(pathWithQuery: string, token: string): Promise<T | null> {
    const sep = pathWithQuery.includes('?') ? '&' : '?';
    const url = `${this.creds.graphBase()}/${pathWithQuery}${sep}access_token=${encodeURIComponent(token)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        const err = (body as { error?: unknown })?.error ?? body;
        this.log.error(`Graph ${res.status}: ${JSON.stringify(err)}`);
        return null;
      }
      return body as T;
    } catch (e) {
      this.log.error(`Graph fetch failed: ${(e as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Fetch the full lead (answers + campaign/ad attribution) by leadgen id. */
  async fetchLead(leadgenId: string): Promise<MetaLeadDetail | null> {
    const token = await this.creds.getAccessToken();
    if (!token) return null;
    const fields =
      'id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic';
    return this.get<MetaLeadDetail>(`${encodeURIComponent(leadgenId)}?fields=${fields}`, token);
  }

  /** Best-effort form name (the leadgen node only carries form_id). */
  async fetchFormName(formId: string): Promise<string | null> {
    const token = await this.creds.getAccessToken();
    if (!token) return null;
    const form = await this.get<{ id: string; name?: string }>(
      `${encodeURIComponent(formId)}?fields=name`,
      token,
    );
    return form?.name ?? null;
  }

  /**
   * Subscribe a Page to this app's `leadgen` webhook field. One-time go-live
   * step — needs `pages_manage_metadata` (the stored System User token has it).
   */
  async subscribePageToLeadgen(pageId: string): Promise<{ ok: boolean; detail?: unknown }> {
    const token = await this.creds.getAccessToken();
    if (!token) return { ok: false, detail: 'no token' };
    const url = `${this.creds.graphBase()}/${encodeURIComponent(pageId)}/subscribed_apps?subscribed_fields=leadgen&access_token=${encodeURIComponent(token)}`;
    try {
      const res = await fetch(url, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as { success?: boolean; error?: unknown } | null;
      if (!res.ok) return { ok: false, detail: body?.error ?? body };
      return { ok: body?.success === true, detail: body };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
