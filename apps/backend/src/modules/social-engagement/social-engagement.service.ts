import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, SocialEngagementStatus, SocialPlatform } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SocialGraphService, type ResolvedPage } from './social-graph.service';
import type { PublicIntakeDto, SubmitClaimDto } from './social-engagement.dto';
import { instagramUrl, normalizeSocial, tiktokUrl } from './social-normalize';

export interface SweepSummary {
  ranAt: string;
  pagesScanned: number;
  fbPosts: number;
  igPosts: number;
  igCommentsMatched: number;
  claimsResolved: number;
  skippedReason?: string;
}

/** Shared capability matrix shown in the UI so numbers are read correctly. */
const CAPABILITY = {
  instagramComments: 'verifiable', // username → handle, passive
  facebookComments: 'text-only', // author withheld by Meta
  likes: 'unverifiable', // no per-user list on either platform
} as const;

/** Normalise an IG handle for matching: lowercase, no '@', trimmed. */
export function normaliseHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const h = raw.trim().replace(/^@+/, '').toLowerCase();
  return h.length ? h : null;
}

/** Normalise comment/claim text for a tolerant substring match. */
function normaliseText(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

@Injectable()
export class SocialEngagementService {
  private readonly log = new Logger(SocialEngagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: SocialGraphService,
    private readonly storage: StorageService,
  ) {}

  private sweepDays(): number {
    const n = Number(process.env.SOCIAL_ENGAGEMENT_SWEEP_DAYS ?? '14');
    return Number.isFinite(n) && n > 0 ? Math.min(n, 90) : 14;
  }

  // ---------------------------------------------------------------------------
  // Handle registry
  // ---------------------------------------------------------------------------

  async listHandles() {
    const employees = await this.prisma.employee.findMany({
      where: { deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        isActive: true,
        instagramHandle: true,
        facebookProfileUrl: true,
        facebookDisplayName: true,
        linkedinUrl: true,
        tiktokHandle: true,
        youtubeChannelUrl: true,
        socialHandlesSubmittedAt: true,
      },
    });
    return employees.map((e) => ({
      employeeId: e.id,
      name: `${e.firstName} ${e.lastName}`.trim(),
      isActive: e.isActive,
      instagramHandle: e.instagramHandle,
      facebookProfileUrl: e.facebookProfileUrl,
      facebookDisplayName: e.facebookDisplayName,
      linkedinUrl: e.linkedinUrl,
      tiktokHandle: e.tiktokHandle,
      youtubeChannelUrl: e.youtubeChannelUrl,
      instagramUrl: instagramUrl(e.instagramHandle),
      tiktokUrl: tiktokUrl(e.tiktokHandle),
      submittedAt: e.socialHandlesSubmittedAt,
      // Per-employee signed link for the public self-submit form. The admin
      // page builds `${origin}/onboarding/social-handles/${formToken}`.
      formToken: this.tokenForEmployee(e.id),
    }));
  }

  async updateHandle(
    employeeId: string,
    dto: {
      instagramHandle?: string | null;
      facebookProfileUrl?: string | null;
      facebookDisplayName?: string | null;
      linkedinUrl?: string | null;
      tiktokHandle?: string | null;
      youtubeChannelUrl?: string | null;
    },
  ) {
    const exists = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Employee not found');

    const data: Prisma.EmployeeUpdateInput = {};
    if (dto.instagramHandle !== undefined) data.instagramHandle = normalizeSocial('instagram', dto.instagramHandle)?.handle ?? null;
    if (dto.facebookProfileUrl !== undefined) data.facebookProfileUrl = normalizeSocial('facebook', dto.facebookProfileUrl)?.url ?? null;
    if (dto.facebookDisplayName !== undefined) data.facebookDisplayName = dto.facebookDisplayName?.trim() || null;
    if (dto.linkedinUrl !== undefined) data.linkedinUrl = normalizeSocial('linkedin', dto.linkedinUrl)?.url ?? null;
    if (dto.tiktokHandle !== undefined) data.tiktokHandle = normalizeSocial('tiktok', dto.tiktokHandle)?.handle ?? null;
    if (dto.youtubeChannelUrl !== undefined) data.youtubeChannelUrl = normalizeSocial('youtube', dto.youtubeChannelUrl)?.url ?? null;

    await this.prisma.employee.update({ where: { id: employeeId }, data });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Public self-submit intake (tokenized, no CRM login)
  // ---------------------------------------------------------------------------

  private formSecret(): string {
    // Dedicated secret if set, else derive from the always-present JWT secret
    // so the link works without new config. Namespaced so it can't collide
    // with a real auth token.
    const base = process.env.SOCIAL_HANDLE_FORM_SECRET || process.env.JWT_SECRET || '';
    return `social-handle-form:${base}`;
  }

  /** Stateless HMAC-signed token: base64url(employeeId).base64url(sig). */
  tokenForEmployee(employeeId: string): string {
    const payload = Buffer.from(employeeId, 'utf8').toString('base64url');
    const sig = createHmac('sha256', this.formSecret()).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  private verifyFormToken(token: string): string {
    const [payload, sig] = (token ?? '').split('.');
    if (!payload || !sig) throw new BadRequestException('This link is invalid or has expired.');
    const expected = createHmac('sha256', this.formSecret()).update(payload).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new BadRequestException('This link is invalid or has expired.');
    }
    try {
      return Buffer.from(payload, 'base64url').toString('utf8');
    } catch {
      throw new BadRequestException('This link is invalid or has expired.');
    }
  }

  /** Prefill payload for the public form — name + any current handles. */
  async getPublicIntake(token: string) {
    const employeeId = this.verifyFormToken(token);
    const e = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: {
        firstName: true,
        lastName: true,
        instagramHandle: true,
        facebookProfileUrl: true,
        linkedinUrl: true,
        tiktokHandle: true,
        youtubeChannelUrl: true,
        socialHandlesSubmittedAt: true,
      },
    });
    if (!e) throw new NotFoundException('This link is no longer valid.');
    return {
      name: `${e.firstName} ${e.lastName}`.trim(),
      instagram: e.instagramHandle,
      facebookUrl: e.facebookProfileUrl,
      linkedinUrl: e.linkedinUrl,
      tiktok: e.tiktokHandle,
      youtube: e.youtubeChannelUrl,
      submittedAt: e.socialHandlesSubmittedAt,
    };
  }

  /** Validate + normalize + upsert handles submitted via the public form. */
  async submitPublicIntake(token: string, dto: PublicIntakeDto) {
    const employeeId = this.verifyFormToken(token);
    const exists = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('This link is no longer valid.');

    // Instagram is required (it's what the verification engine matches on).
    const ig = normalizeSocial('instagram', dto.instagram);
    if (!ig) throw new BadRequestException('Instagram username is required.');
    const fb = normalizeSocial('facebook', dto.facebookUrl);
    const li = normalizeSocial('linkedin', dto.linkedinUrl);
    const tt = normalizeSocial('tiktok', dto.tiktok);
    const yt = normalizeSocial('youtube', dto.youtube);

    await this.prisma.employee.update({
      where: { id: employeeId },
      data: {
        instagramHandle: ig.handle ?? null,
        facebookProfileUrl: fb?.url ?? null,
        linkedinUrl: li?.url ?? null,
        tiktokHandle: tt?.handle ?? null,
        youtubeChannelUrl: yt?.url ?? null,
        socialHandlesSubmittedAt: new Date(),
      },
    });
    return {
      ok: true,
      normalized: {
        instagramUrl: ig.url,
        facebookUrl: fb?.url ?? null,
        linkedinUrl: li?.url ?? null,
        tiktokUrl: tt?.url ?? null,
        youtubeUrl: yt?.url ?? null,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Scoreboard + detail reads
  // ---------------------------------------------------------------------------

  private windowStart(days: number): Date {
    const d = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 7;
    return new Date(Date.now() - d * 24 * 60 * 60 * 1000);
  }

  async getScoreboard(days = 7) {
    const from = this.windowStart(days);
    const engagements = await this.prisma.socialEngagement.findMany({
      where: {
        OR: [{ commentedAt: { gte: from } }, { AND: [{ commentedAt: null }, { createdAt: { gte: from } }] }],
      },
      select: {
        employeeId: true,
        platform: true,
        status: true,
        employee: { select: { firstName: true, lastName: true, isActive: true, instagramHandle: true } },
      },
    });

    const byRep = new Map<
      string,
      { employeeId: string; name: string; isActive: boolean; instagramHandle: string | null; verifiedIg: number; textVerifiedFb: number; notFound: number }
    >();
    let verifiedIg = 0;
    let textVerifiedFb = 0;
    let notFound = 0;

    for (const e of engagements) {
      const key = e.employeeId;
      if (!byRep.has(key)) {
        byRep.set(key, {
          employeeId: key,
          name: `${e.employee.firstName} ${e.employee.lastName}`.trim(),
          isActive: e.employee.isActive,
          instagramHandle: e.employee.instagramHandle,
          verifiedIg: 0,
          textVerifiedFb: 0,
          notFound: 0,
        });
      }
      const row = byRep.get(key)!;
      if (e.status === SocialEngagementStatus.VERIFIED) {
        row.verifiedIg += 1;
        verifiedIg += 1;
      } else if (e.status === SocialEngagementStatus.TEXT_VERIFIED_AUTHOR_UNCONFIRMED) {
        row.textVerifiedFb += 1;
        textVerifiedFb += 1;
      } else if (e.status === SocialEngagementStatus.NOT_FOUND) {
        row.notFound += 1;
        notFound += 1;
      }
    }

    const reps = [...byRep.values()]
      .map((r) => ({ ...r, total: r.verifiedIg + r.textVerifiedFb }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    return {
      window: { from: from.toISOString(), to: new Date().toISOString(), days: Math.min(days, 365) },
      capability: CAPABILITY,
      totals: { verifiedIg, textVerifiedFb, notFound, reps: reps.length },
      reps,
    };
  }

  async listEngagements(opts: { days?: number; employeeId?: string; platform?: SocialPlatform; status?: SocialEngagementStatus }) {
    const from = this.windowStart(opts.days ?? 30);
    const rows = await this.prisma.socialEngagement.findMany({
      where: {
        createdAt: { gte: from },
        ...(opts.employeeId ? { employeeId: opts.employeeId } : {}),
        ...(opts.platform ? { platform: opts.platform } : {}),
        ...(opts.status ? { status: opts.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        platform: true,
        status: true,
        source: true,
        postExternalId: true,
        postUrl: true,
        commentExternalId: true,
        commentText: true,
        commentedAt: true,
        screenshotKey: true,
        createdAt: true,
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      status: r.status,
      source: r.source,
      postExternalId: r.postExternalId,
      postUrl: r.postUrl,
      commentExternalId: r.commentExternalId,
      commentText: r.commentText,
      commentedAt: r.commentedAt,
      hasScreenshot: !!r.screenshotKey,
      createdAt: r.createdAt,
      employeeId: r.employee.id,
      employeeName: `${r.employee.firstName} ${r.employee.lastName}`.trim(),
    }));
  }

  async listPosts(opts: { days?: number; platform?: SocialPlatform }) {
    const from = this.windowStart(opts.days ?? 30);
    const rows = await this.prisma.socialPost.findMany({
      where: {
        ...(opts.platform ? { platform: opts.platform } : {}),
        OR: [{ postedAt: { gte: from } }, { AND: [{ postedAt: null }, { createdAt: { gte: from } }] }],
      },
      orderBy: [{ postedAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return rows.map((p) => ({
      id: p.id,
      platform: p.platform,
      externalId: p.externalId,
      permalink: p.permalink,
      caption: p.caption,
      postedAt: p.postedAt,
    }));
  }

  /** Token/page health + capability matrix for the UI banner. */
  async getStatus() {
    const pages = await this.graph.resolvePages();
    return {
      tokenResolved: pages.length > 0,
      capability: CAPABILITY,
      sweepEnabled: process.env.SOCIAL_ENGAGEMENT_SWEEP_ENABLED !== 'false',
      sweepDays: this.sweepDays(),
      pages: pages.map((p) => ({ pageId: p.pageId, name: p.name, hasInstagram: !!p.igUserId, igUsername: p.igUsername })),
    };
  }

  // ---------------------------------------------------------------------------
  // Facebook claim submission (text-verified, author-unconfirmed)
  // ---------------------------------------------------------------------------

  async submitClaim(dto: SubmitClaimDto, file: Express.Multer.File | undefined, claimedByUserId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const claimText = normaliseText(dto.commentText);
    if (claimText.length < 3) {
      throw new BadRequestException('Comment text is too short to verify (min 3 characters).');
    }

    // Optional screenshot (secondary evidence only — never "validated").
    let screenshotKey: string | undefined;
    if (file?.buffer?.length) {
      const up = await this.storage.upload(file.buffer, file.mimetype || 'image/jpeg', 'social-engagement', file.originalname);
      screenshotKey = up.key;
    }

    // Try to verify against the live post comments right now.
    const match = await this.findFbCommentMatch(dto.postExternalId, claimText);
    const status: SocialEngagementStatus =
      match === 'unavailable'
        ? SocialEngagementStatus.PENDING
        : match
          ? SocialEngagementStatus.TEXT_VERIFIED_AUTHOR_UNCONFIRMED
          : SocialEngagementStatus.NOT_FOUND;

    const row = await this.prisma.socialEngagement.create({
      data: {
        employeeId: dto.employeeId,
        platform: SocialPlatform.FACEBOOK,
        status,
        source: 'REP_CLAIM',
        postExternalId: dto.postExternalId,
        postUrl: dto.postUrl?.trim() || null,
        commentExternalId: match && match !== 'unavailable' ? match.id : null,
        commentText: dto.commentText.trim(),
        commentedAt: match && match !== 'unavailable' ? (match.created_time ? new Date(match.created_time) : null) : null,
        screenshotKey: screenshotKey ?? null,
        claimedByUserId,
      },
      select: { id: true, status: true },
    });
    return { id: row.id, status: row.status };
  }

  /**
   * Fetch a FB post's comments and look for the claim text.
   * Returns the matched comment, `false` if not found, or `'unavailable'` when
   * the comments couldn't be fetched (no token / API error) so the caller can
   * mark the claim PENDING for the sweep to retry.
   */
  private async findFbCommentMatch(
    postExternalId: string,
    claimTextNorm: string,
  ): Promise<{ id: string; created_time?: string } | false | 'unavailable'> {
    const pages = await this.graph.resolvePages();
    const fbPages = pages.filter((p) => p.pageId);
    if (fbPages.length === 0) return 'unavailable';

    // FB post ids are usually `{pageId}_{postId}`; prefer the owning page.
    const owning = fbPages.find((p) => postExternalId.startsWith(`${p.pageId}_`));
    const candidates = owning ? [owning] : fbPages;

    let anyFetched = false;
    for (const page of candidates) {
      const comments = await this.graph.listFbComments(postExternalId, page.pageToken);
      if (comments.length === 0) continue;
      anyFetched = true;
      for (const c of comments) {
        const norm = normaliseText(c.message);
        if (norm && (norm === claimTextNorm || norm.includes(claimTextNorm))) {
          return { id: c.id, created_time: c.created_time };
        }
      }
    }
    // Distinguish "fetched but not present" (NOT_FOUND) from "couldn't fetch".
    return anyFetched ? false : 'unavailable';
  }

  // ---------------------------------------------------------------------------
  // Sweep (IG passive auto-verification + FB claim resolution + post cache)
  // ---------------------------------------------------------------------------

  async runSweep(): Promise<SweepSummary> {
    const ranAt = new Date().toISOString();
    const pages = await this.graph.resolvePages(true);
    if (pages.length === 0) {
      return { ranAt, pagesScanned: 0, fbPosts: 0, igPosts: 0, igCommentsMatched: 0, claimsResolved: 0, skippedReason: 'no token/pages' };
    }

    const days = this.sweepDays();
    const sinceUnix = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    const sinceDate = new Date(sinceUnix * 1000);

    // IG handle → employeeId map.
    const withHandles = await this.prisma.employee.findMany({
      where: { instagramHandle: { not: null } },
      select: { id: true, instagramHandle: true },
    });
    const handleMap = new Map<string, string>();
    for (const e of withHandles) {
      const h = normaliseHandle(e.instagramHandle);
      if (h) handleMap.set(h, e.id);
    }

    let fbPosts = 0;
    let igPosts = 0;
    let igCommentsMatched = 0;
    let claimsResolved = 0;

    for (const page of pages) {
      // ---- Facebook: cache posts + resolve pending claims ----
      try {
        const posts = await this.graph.listFbPosts(page.pageId, page.pageToken, sinceUnix);
        for (const post of posts) {
          fbPosts += 1;
          await this.upsertPost(SocialPlatform.FACEBOOK, page.pageId, post.id, post.permalink_url, post.message, post.created_time);
          claimsResolved += await this.resolvePendingFbClaims(post.id, page);
        }
      } catch (e) {
        this.log.error(`FB sweep failed for page ${page.pageId}: ${(e as Error).message}`);
      }

      // ---- Instagram: passive comment verification ----
      if (page.igUserId && handleMap.size > 0) {
        try {
          const media = await this.graph.listIgMedia(page.igUserId, page.pageToken, sinceUnix);
          for (const m of media) {
            if (m.timestamp && new Date(m.timestamp) < sinceDate) continue;
            igPosts += 1;
            await this.upsertPost(SocialPlatform.INSTAGRAM, page.igUserId, m.id, m.permalink, m.caption, m.timestamp);
            const comments = await this.graph.listIgComments(m.id, page.pageToken);
            for (const c of comments) {
              const handle = normaliseHandle(c.username);
              if (!handle) continue;
              const employeeId = handleMap.get(handle);
              if (!employeeId) continue;
              const credited = await this.creditIgComment(employeeId, m.id, m.permalink, c);
              if (credited) igCommentsMatched += 1;
            }
          }
        } catch (e) {
          this.log.error(`IG sweep failed for ${page.igUserId}: ${(e as Error).message}`);
        }
      }
    }

    this.log.log(
      `social sweep: ${pages.length} pages, ${fbPosts} FB posts, ${igPosts} IG posts, ${igCommentsMatched} IG matches, ${claimsResolved} claims resolved`,
    );
    return { ranAt, pagesScanned: pages.length, fbPosts, igPosts, igCommentsMatched, claimsResolved };
  }

  private async upsertPost(
    platform: SocialPlatform,
    pageId: string,
    externalId: string,
    permalink?: string,
    caption?: string,
    postedAt?: string,
  ): Promise<void> {
    const cap = caption ? caption.slice(0, 500) : null;
    await this.prisma.socialPost.upsert({
      where: { platform_externalId: { platform, externalId } },
      create: {
        platform,
        pageId,
        externalId,
        permalink: permalink ?? null,
        caption: cap,
        postedAt: postedAt ? new Date(postedAt) : null,
      },
      update: { permalink: permalink ?? null, caption: cap, lastSweptAt: new Date() },
    });
  }

  /** Upsert a VERIFIED IG engagement; returns true if a NEW row was created. */
  private async creditIgComment(
    employeeId: string,
    mediaId: string,
    permalink: string | undefined,
    c: { id: string; text?: string; timestamp?: string },
  ): Promise<boolean> {
    const existing = await this.prisma.socialEngagement.findUnique({
      where: { platform_commentExternalId: { platform: SocialPlatform.INSTAGRAM, commentExternalId: c.id } },
      select: { id: true },
    });
    if (existing) return false;
    await this.prisma.socialEngagement.create({
      data: {
        employeeId,
        platform: SocialPlatform.INSTAGRAM,
        status: SocialEngagementStatus.VERIFIED,
        source: 'AUTO_SWEEP',
        postExternalId: mediaId,
        postUrl: permalink ?? null,
        commentExternalId: c.id,
        commentText: c.text ?? null,
        commentedAt: c.timestamp ? new Date(c.timestamp) : null,
      },
    });
    return true;
  }

  /** For a freshly-swept FB post, try to resolve its PENDING claims. */
  private async resolvePendingFbClaims(postExternalId: string, page: ResolvedPage): Promise<number> {
    const pending = await this.prisma.socialEngagement.findMany({
      where: { platform: SocialPlatform.FACEBOOK, status: SocialEngagementStatus.PENDING, postExternalId },
      select: { id: true, commentText: true, createdAt: true },
    });
    if (pending.length === 0) return 0;

    const comments = await this.graph.listFbComments(postExternalId, page.pageToken);
    let resolved = 0;
    for (const claim of pending) {
      const claimNorm = normaliseText(claim.commentText);
      const match = comments.find((c) => {
        const norm = normaliseText(c.message);
        return norm && (norm === claimNorm || norm.includes(claimNorm));
      });
      if (match) {
        await this.prisma.socialEngagement.update({
          where: { id: claim.id },
          data: {
            status: SocialEngagementStatus.TEXT_VERIFIED_AUTHOR_UNCONFIRMED,
            commentExternalId: match.id,
            commentedAt: match.created_time ? new Date(match.created_time) : null,
          },
        });
        resolved += 1;
      } else if (Date.now() - claim.createdAt.getTime() > 24 * 60 * 60 * 1000) {
        // Swept the post, text still absent, and the claim is >24h old → give up.
        await this.prisma.socialEngagement.update({
          where: { id: claim.id },
          data: { status: SocialEngagementStatus.NOT_FOUND },
        });
      }
    }
    return resolved;
  }
}
