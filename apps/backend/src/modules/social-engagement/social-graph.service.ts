import { Injectable, Logger } from '@nestjs/common';
import { MetaCredentialsService } from '../meta-leads/meta-credentials.service';

/**
 * Graph API reader for team social-engagement verification.
 *
 * The stored system-user token (via MetaCredentialsService) can LIST the
 * business's pages, but reading a New-Pages-experience page's posts/comments
 * needs that PAGE's own access token (a user/system token errors 190/2069032).
 * So we resolve each page token from `/me/accounts` first, then read posts +
 * comments with it. The linked IG business account is read with the same page
 * token.
 *
 * Capability reality (see docs/social-engagement-verification.md):
 *  - IG comments expose `username` → fully verifiable.
 *  - FB comments expose `message` only; the author is silently stripped.
 *  - Likes/reactions expose no per-user list on either platform.
 */

export interface ResolvedPage {
  pageId: string;
  name: string;
  pageToken: string;
  /** Linked IG business account, when the page has one. */
  igUserId?: string;
  igUsername?: string;
}

export interface FbPost {
  id: string;
  message?: string;
  permalink_url?: string;
  created_time?: string;
}

export interface FbComment {
  id: string;
  message?: string;
  created_time?: string;
  // `from` is intentionally NOT requested — Meta strips it for apps without
  // Page Public Content Access, so relying on it would be misleading.
}

export interface IgMedia {
  id: string;
  permalink?: string;
  caption?: string;
  timestamp?: string;
}

export interface IgComment {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  like_count?: number;
}

interface Paged<T> {
  data?: T[];
  paging?: { next?: string };
}

@Injectable()
export class SocialGraphService {
  private readonly log = new Logger(SocialGraphService.name);
  // Page-token resolution is comparatively expensive; cache it briefly.
  private pagesCache: { pages: ResolvedPage[]; at: number } | null = null;
  private static readonly PAGES_TTL_MS = 10 * 60_000;
  // Hard cap on pagination pages per listing, so a runaway `paging.next` can
  // never loop forever or hammer the Graph API.
  private static readonly MAX_PAGES = 20;

  constructor(private readonly creds: MetaCredentialsService) {}

  /** Low-level GET for a path+query against the graph base, with a timeout. */
  private async get<T>(pathWithQuery: string, token: string): Promise<T | null> {
    const sep = pathWithQuery.includes('?') ? '&' : '?';
    const url = `${this.creds.graphBase()}/${pathWithQuery}${sep}access_token=${encodeURIComponent(token)}`;
    return this.getUrl<T>(url);
  }

  /** GET an ABSOLUTE url (used to follow `paging.next`, which embeds the token). */
  private async getUrl<T>(url: string): Promise<T | null> {
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

  /**
   * Resolve the business's pages + their page tokens + linked IG accounts.
   * Returns [] when no system-user token can be resolved (so every caller
   * no-ops quietly instead of throwing).
   */
  async resolvePages(force = false): Promise<ResolvedPage[]> {
    if (!force && this.pagesCache && Date.now() - this.pagesCache.at < SocialGraphService.PAGES_TTL_MS) {
      return this.pagesCache.pages;
    }
    const token = await this.creds.getAccessToken();
    if (!token) {
      this.log.warn('No Meta token resolved — social sweep cannot run');
      return [];
    }
    const res = await this.get<
      Paged<{
        id: string;
        name?: string;
        access_token?: string;
        instagram_business_account?: { id: string; username?: string };
      }>
    >(
      'me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100',
      token,
    );
    const pages: ResolvedPage[] = [];
    for (const p of res?.data ?? []) {
      if (!p.access_token) continue; // can't read a page without its own token
      pages.push({
        pageId: p.id,
        name: p.name ?? p.id,
        pageToken: p.access_token,
        igUserId: p.instagram_business_account?.id,
        igUsername: p.instagram_business_account?.username,
      });
    }
    this.pagesCache = { pages, at: Date.now() };
    return pages;
  }

  /** Walk a paginated edge, following `paging.next`, up to MAX_PAGES. */
  private async collect<T>(first: Paged<T> | null): Promise<T[]> {
    const out: T[] = [];
    let page = first;
    let guard = 0;
    while (page) {
      out.push(...(page.data ?? []));
      const next = page.paging?.next;
      if (!next || ++guard >= SocialGraphService.MAX_PAGES) break;
      page = await this.getUrl<Paged<T>>(next);
    }
    return out;
  }

  /** FB posts on a page newer than `sinceUnix` (page token required). */
  async listFbPosts(pageId: string, pageToken: string, sinceUnix: number): Promise<FbPost[]> {
    const first = await this.get<Paged<FbPost>>(
      `${encodeURIComponent(pageId)}/posts?fields=id,message,permalink_url,created_time&since=${sinceUnix}&limit=50`,
      pageToken,
    );
    return this.collect(first);
  }

  /** Text-only comments on a FB post (author is unavailable to us). */
  async listFbComments(postId: string, pageToken: string): Promise<FbComment[]> {
    const first = await this.get<Paged<FbComment>>(
      `${encodeURIComponent(postId)}/comments?fields=id,message,created_time&filter=stream&limit=100`,
      pageToken,
    );
    return this.collect(first);
  }

  /** IG media on the linked business account newer than `sinceUnix`. */
  async listIgMedia(igUserId: string, pageToken: string, sinceUnix: number): Promise<IgMedia[]> {
    const first = await this.get<Paged<IgMedia>>(
      `${encodeURIComponent(igUserId)}/media?fields=id,permalink,caption,timestamp&since=${sinceUnix}&limit=50`,
      pageToken,
    );
    // The IG `media` edge honours `since` loosely; we also filter client-side.
    return this.collect(first);
  }

  /** IG comments on a media — these DO carry the commenter `username`. */
  async listIgComments(mediaId: string, pageToken: string): Promise<IgComment[]> {
    const first = await this.get<Paged<IgComment>>(
      `${encodeURIComponent(mediaId)}/comments?fields=id,text,username,timestamp,like_count&limit=50`,
      pageToken,
    );
    return this.collect(first);
  }
}
