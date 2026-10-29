import { Injectable, Logger } from '@nestjs/common';
import { SocialPlatform } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SocialGraphService } from '../social-engagement/social-graph.service';
import { SocialAlertConfigService } from './social-alert-config.service';

export interface PollSummary {
  ranAt: string;
  skippedReason?: string;
  postsSeen: number;
  alertsSent: number;
  recipients: number;
}

interface CandidatePost {
  platform: SocialPlatform;
  externalId: string;
  permalink: string | null;
  caption: string | null;
  postedAt: Date | null;
}

const ALL_CHANNELS = ['EMAIL', 'BELL', 'BANNER'] as const;

@Injectable()
export class SocialAlertService {
  private readonly log = new Logger(SocialAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SocialAlertConfigService,
    private readonly graph: SocialGraphService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  private maxAgeHours(): number {
    const n = Number(process.env.SOCIAL_ALERT_MAX_POST_AGE_HOURS ?? '24');
    return Number.isFinite(n) && n > 0 ? Math.min(n, 168) : 24;
  }
  private bannerTtlHours(): number {
    const n = Number(process.env.SOCIAL_ALERT_BANNER_TTL_HOURS ?? '8');
    return Number.isFinite(n) && n > 0 ? Math.min(n, 72) : 8;
  }

  /** Current Asia/Karachi hour (UTC+5, no DST). */
  private pktHour(): number {
    return (new Date().getUTCHours() + 5) % 24;
  }

  private inQuietHours(start: number | null, end: number | null): boolean {
    if (start === null || end === null || start === end) return false;
    const h = this.pktHour();
    return start < end ? h >= start && h < end : h >= start || h < end;
  }

  // ---------------------------------------------------------------------------
  // Poll
  // ---------------------------------------------------------------------------

  async runPoll(): Promise<PollSummary> {
    const ranAt = new Date().toISOString();
    const cfg = await this.config.get();

    // Expire stale banners regardless of enabled state (so turning the feature
    // off doesn't leave a banner stuck up).
    await this.expireBanners();

    if (!cfg.enabled) {
      return { ranAt, skippedReason: 'disabled', postsSeen: 0, alertsSent: 0, recipients: 0 };
    }

    const pages = await this.graph.resolvePages();
    if (pages.length === 0) {
      return { ranAt, skippedReason: 'no token/pages', postsSeen: 0, alertsSent: 0, recipients: 0 };
    }

    const platforms = cfg.platforms.length ? cfg.platforms : [SocialPlatform.FACEBOOK, SocialPlatform.INSTAGRAM];
    const enabledAt = cfg.enabledAt ?? cfg.updatedAt;
    const ageCutoff = new Date(Date.now() - this.maxAgeHours() * 3600_000);
    const sinceUnix = Math.floor((Date.now() - 2 * 24 * 3600_000) / 1000);
    const quiet = this.inQuietHours(cfg.quietStartHour, cfg.quietEndHour);

    // Collect candidate posts across pages.
    const candidates: CandidatePost[] = [];
    for (const page of pages) {
      if (platforms.includes(SocialPlatform.FACEBOOK)) {
        try {
          const posts = await this.graph.listFbPosts(page.pageId, page.pageToken, sinceUnix);
          for (const p of posts) {
            candidates.push({
              platform: SocialPlatform.FACEBOOK,
              externalId: p.id,
              permalink: p.permalink_url ?? null,
              caption: p.message ?? null,
              postedAt: p.created_time ? new Date(p.created_time) : null,
            });
          }
        } catch (e) {
          this.log.error(`FB poll failed for ${page.pageId}: ${(e as Error).message}`);
        }
      }
      if (platforms.includes(SocialPlatform.INSTAGRAM) && page.igUserId) {
        try {
          const media = await this.graph.listIgMedia(page.igUserId, page.pageToken, sinceUnix);
          for (const m of media) {
            candidates.push({
              platform: SocialPlatform.INSTAGRAM,
              externalId: m.id,
              permalink: m.permalink ?? null,
              caption: m.caption ?? null,
              postedAt: m.timestamp ? new Date(m.timestamp) : null,
            });
          }
        } catch (e) {
          this.log.error(`IG poll failed for ${page.igUserId}: ${(e as Error).message}`);
        }
      }
    }

    let alertsSent = 0;
    let recipientsTotal = 0;
    let recipients: { userId: string; email: string | null }[] | null = null;

    for (const post of candidates) {
      // Only alert posts published AFTER the feature was enabled and still
      // within the freshness window — never backfill the existing feed.
      if (!post.postedAt || post.postedAt < enabledAt || post.postedAt < ageCutoff) continue;

      const existing = await this.prisma.socialPostAlert.findUnique({
        where: { platform_externalId: { platform: post.platform, externalId: post.externalId } },
        select: { id: true, alerted: true },
      });
      if (existing?.alerted) continue; // already alerted once

      // Quiet hours: defer — don't record, so it re-qualifies once the window
      // ends (still bounded by the freshness window).
      if (quiet) continue;

      // Resolve recipients lazily (once per poll that actually alerts).
      if (recipients === null) recipients = await this.resolveRecipients(cfg.departments);
      if (recipients.length === 0) {
        this.log.warn('social post alert: no recipients match the configured departments');
      }

      const channels = cfg.channels.length ? cfg.channels : [...ALL_CHANNELS];
      const bannerKey = await this.deliver(post, recipients, channels);

      await this.prisma.socialPostAlert.upsert({
        where: { platform_externalId: { platform: post.platform, externalId: post.externalId } },
        create: {
          platform: post.platform,
          externalId: post.externalId,
          permalink: post.permalink,
          caption: post.caption?.slice(0, 500) ?? null,
          postedAt: post.postedAt,
          alerted: true,
          alertedAt: new Date(),
          recipients: recipients.length,
          bannerAlertKey: bannerKey,
        },
        update: { alerted: true, alertedAt: new Date(), recipients: recipients.length, bannerAlertKey: bannerKey },
      });
      alertsSent += 1;
      recipientsTotal += recipients.length;
    }

    this.log.log(`social post alert poll: ${candidates.length} seen, ${alertsSent} alerted`);
    return { ranAt, postsSeen: candidates.length, alertsSent, recipients: recipientsTotal };
  }

  private async resolveRecipients(departments: string[]): Promise<{ userId: string; email: string | null }[]> {
    const employees = await this.prisma.employee.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        ...(departments.length ? { department: { name: { in: departments } } } : {}),
        user: { status: 'ACTIVE' },
      },
      select: { userId: true, user: { select: { email: true } } },
    });
    const seen = new Set<string>();
    const out: { userId: string; email: string | null }[] = [];
    for (const e of employees) {
      if (seen.has(e.userId)) continue;
      seen.add(e.userId);
      out.push({ userId: e.userId, email: e.user?.email ?? null });
    }
    return out;
  }

  /** Fan a post out across the enabled channels. Returns the banner key (if raised). */
  private async deliver(
    post: CandidatePost,
    recipients: { userId: string; email: string | null }[],
    channels: string[],
  ): Promise<string | null> {
    const platformName = post.platform === SocialPlatform.INSTAGRAM ? 'Instagram' : 'Facebook';
    const snippet = (post.caption ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
    const url = post.permalink ?? '';
    const title = `📣 New ${platformName} post is live`;
    const body = snippet ? `Like & comment now: “${snippet}”` : 'Like & comment now.';

    // BELL (+ mobile push + in-app, via NotificationsService) — one per recipient.
    if (channels.includes('BELL')) {
      await Promise.allSettled(
        recipients.map((r) =>
          this.notifications.create({
            userId: r.userId,
            type: 'social_post',
            title,
            body,
            link: url || null,
            pushData: url ? { url } : undefined,
            pushTag: 'social_post',
          }),
        ),
      );
    }

    // EMAIL — per recipient (so nobody sees everyone else's address).
    if (channels.includes('EMAIL')) {
      const html = this.emailHtml(platformName, snippet, url);
      const subject = `📣 New ${platformName} post — please like & comment`;
      await Promise.allSettled(
        recipients
          .filter((r) => r.email)
          .map((r) => this.email.sendMail({ to: r.email as string, subject, html })),
      );
    }

    // BANNER — one org-wide SystemAlert row the shells already render.
    let bannerKey: string | null = null;
    if (channels.includes('BANNER')) {
      bannerKey = `social_post_${post.platform.toLowerCase()}_${post.externalId}`.slice(0, 190);
      const message = url ? `Like & comment now — ${url}` : 'Like & comment now.';
      try {
        await this.prisma.systemAlert.upsert({
          where: { key: bannerKey },
          create: {
            id: randomUUID(),
            key: bannerKey,
            active: true,
            severity: 'info',
            title,
            message,
            startedAt: new Date(),
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          },
          update: { active: true, severity: 'info', title, message, lastSeenAt: new Date(), resolvedAt: null, updatedAt: new Date() },
        });
      } catch (e) {
        this.log.warn(`banner raise failed: ${(e as Error).message}`);
        bannerKey = null;
      }
    }
    return bannerKey;
  }

  private emailHtml(platform: string, snippet: string, url: string): string {
    const cta = url
      ? `<p style="margin:20px 0"><a href="${url}" style="background:#2563eb;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open the post & engage →</a></p>`
      : '';
    return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#0f2a4a">
      <h2 style="font-size:18px">📣 New ${platform} post is live</h2>
      <p style="font-size:14px;line-height:1.5;color:#334155">Please head over and <strong>like &amp; comment</strong> to support our page.</p>
      ${snippet ? `<p style="font-size:13px;color:#64748b;border-left:3px solid #e2e8f0;padding-left:10px">“${snippet}”</p>` : ''}
      ${cta}
      <p style="font-size:11px;color:#94a3b8">Tashfeen — team engagement</p>
    </div>`;
  }

  /** Deactivate post-alert banners older than the TTL. */
  private async expireBanners(): Promise<void> {
    const cutoff = new Date(Date.now() - this.bannerTtlHours() * 3600_000);
    try {
      await this.prisma.systemAlert.updateMany({
        where: { key: { startsWith: 'social_post_' }, active: true, startedAt: { lt: cutoff } },
        data: { active: false, resolvedAt: new Date() },
      });
    } catch (e) {
      this.log.warn(`banner expiry sweep failed: ${(e as Error).message}`);
    }
  }

  /** Recent alert log for the admin page. */
  async recentAlerts(limit = 50) {
    const rows = await this.prisma.socialPostAlert.findMany({
      where: { alerted: true },
      orderBy: { alertedAt: 'desc' },
      take: Math.min(limit, 200),
    });
    return rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      externalId: r.externalId,
      permalink: r.permalink,
      caption: r.caption,
      postedAt: r.postedAt,
      alertedAt: r.alertedAt,
      recipients: r.recipients,
    }));
  }
}
