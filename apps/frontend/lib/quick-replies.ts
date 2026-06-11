import { apiFetch } from './api-client';

/** Saved chat snippet for the WhatsApp composer (NOT a Meta template). */
export interface QuickReply {
  id: string;
  title: string;
  body: string;
  /** null = team-wide; otherwise personal to that user. */
  ownerUserId: string | null;
}

export interface QuickReplyList {
  team: QuickReply[];
  mine: QuickReply[];
  /** Whether the caller may create/edit/delete team-wide snippets. */
  canManageTeam: boolean;
}

export async function listQuickReplies(): Promise<QuickReplyList> {
  return apiFetch<QuickReplyList>('/quick-replies', { cache: 'no-store' });
}

export async function createQuickReply(input: {
  title: string;
  body: string;
  team?: boolean;
}): Promise<QuickReply> {
  return apiFetch<QuickReply>('/quick-replies', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateQuickReply(
  id: string,
  input: { title?: string; body?: string },
): Promise<QuickReply> {
  return apiFetch<QuickReply>(`/quick-replies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteQuickReply(id: string): Promise<void> {
  await apiFetch(`/quick-replies/${id}`, { method: 'DELETE' });
}

/** Substitute supported placeholders before inserting into the composer. */
export function fillQuickReply(body: string, opts: { name?: string | null }): string {
  return body.replaceAll('{{name}}', (opts.name ?? '').trim());
}
