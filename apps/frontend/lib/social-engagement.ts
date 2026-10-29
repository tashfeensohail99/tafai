'use client';

import { apiFetch, buildQuery } from './api-client';

/**
 * Team social-engagement verification API client.
 *
 * IG comments are fully verifiable (username → employee handle); FB comments
 * are text-verified only (Meta withholds the author); likes are unverifiable.
 * See docs/social-engagement-verification.md.
 */

export type SocialPlatform = 'INSTAGRAM' | 'FACEBOOK';
export type SocialEngagementStatus =
  | 'VERIFIED'
  | 'TEXT_VERIFIED_AUTHOR_UNCONFIRMED'
  | 'NOT_FOUND'
  | 'PENDING';
export type SocialEngagementSource = 'AUTO_SWEEP' | 'REP_CLAIM';

export interface ScoreboardRep {
  employeeId: string;
  name: string;
  isActive: boolean;
  instagramHandle: string | null;
  verifiedIg: number;
  textVerifiedFb: number;
  notFound: number;
  total: number;
}

export interface Scoreboard {
  window: { from: string; to: string; days: number };
  capability: { instagramComments: string; facebookComments: string; likes: string };
  totals: { verifiedIg: number; textVerifiedFb: number; notFound: number; reps: number };
  reps: ScoreboardRep[];
}

export interface EngagementRow {
  id: string;
  platform: SocialPlatform;
  status: SocialEngagementStatus;
  source: SocialEngagementSource;
  postExternalId: string;
  postUrl: string | null;
  commentExternalId: string | null;
  commentText: string | null;
  commentedAt: string | null;
  hasScreenshot: boolean;
  createdAt: string;
  employeeId: string;
  employeeName: string;
}

export interface SocialPostRow {
  id: string;
  platform: SocialPlatform;
  externalId: string;
  permalink: string | null;
  caption: string | null;
  postedAt: string | null;
}

export interface HandleRow {
  employeeId: string;
  name: string;
  isActive: boolean;
  instagramHandle: string | null;
  facebookProfileUrl: string | null;
  facebookDisplayName: string | null;
}

export interface SocialStatus {
  tokenResolved: boolean;
  capability: { instagramComments: string; facebookComments: string; likes: string };
  sweepEnabled: boolean;
  sweepDays: number;
  pages: { pageId: string; name: string; hasInstagram: boolean; igUsername?: string }[];
}

const BASE = '/admin/social-engagement';

export function getScoreboard(days = 7): Promise<Scoreboard> {
  return apiFetch<Scoreboard>(`${BASE}/scoreboard${buildQuery({ days })}`);
}

export function getEngagements(params: {
  days?: number;
  employeeId?: string;
  platform?: SocialPlatform;
  status?: SocialEngagementStatus;
}): Promise<EngagementRow[]> {
  return apiFetch<EngagementRow[]>(`${BASE}/engagements${buildQuery(params)}`);
}

export function getPosts(params: { days?: number; platform?: SocialPlatform }): Promise<SocialPostRow[]> {
  return apiFetch<SocialPostRow[]>(`${BASE}/posts${buildQuery(params)}`);
}

export function getSocialStatus(): Promise<SocialStatus> {
  return apiFetch<SocialStatus>(`${BASE}/status`);
}

export function getHandles(): Promise<HandleRow[]> {
  return apiFetch<HandleRow[]>(`${BASE}/handles`);
}

export function updateHandle(
  employeeId: string,
  body: { instagramHandle?: string | null; facebookProfileUrl?: string | null; facebookDisplayName?: string | null },
): Promise<{ ok: boolean }> {
  return apiFetch(`${BASE}/handles/${employeeId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function submitClaim(input: {
  employeeId: string;
  postExternalId: string;
  postUrl?: string;
  commentText: string;
  screenshot?: File | null;
}): Promise<{ id: string; status: SocialEngagementStatus }> {
  const fd = new FormData();
  fd.set('employeeId', input.employeeId);
  fd.set('postExternalId', input.postExternalId);
  if (input.postUrl) fd.set('postUrl', input.postUrl);
  fd.set('commentText', input.commentText);
  if (input.screenshot) fd.set('file', input.screenshot);
  return apiFetch(`${BASE}/claims`, { method: 'POST', body: fd });
}

export function runSweep(): Promise<{ ranAt: string; pagesScanned: number; fbPosts: number; igPosts: number; igCommentsMatched: number; claimsResolved: number; skippedReason?: string }> {
  return apiFetch(`${BASE}/sweep`, { method: 'POST' });
}

export function statusLabel(s: SocialEngagementStatus): string {
  switch (s) {
    case 'VERIFIED':
      return 'Verified';
    case 'TEXT_VERIFIED_AUTHOR_UNCONFIRMED':
      return 'Text-verified';
    case 'NOT_FOUND':
      return 'Not found';
    case 'PENDING':
      return 'Pending';
  }
}
