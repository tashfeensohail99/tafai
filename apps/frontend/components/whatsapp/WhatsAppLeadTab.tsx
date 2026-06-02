'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { MessageSquare } from 'lucide-react';
import { EmptyState, GlassCard } from '@/components/sales-v2/ui';
import { getThreadForLead, type ThreadListItem } from '@/lib/whatsapp';
import { WhatsAppChatPanel } from './WhatsAppChatPanel';

/**
 * The "WhatsApp" tab inside the lead/client detail page.
 *
 * Strategy: look up the WhatsApp thread linked to this lead. Today we do
 * that by searching the inbox by phone, since the dedicated
 * `GET /whatsapp/threads/by-lead/:id` endpoint isn't built yet (one-line
 * follow-up).
 *
 * Optional `renderHeaderActions(threadId)` slot lets the host page render
 * extra controls above the chat — used by the Finance customer profile to
 * surface a one-click "Send consultation reminder" template button.
 */
export function WhatsAppLeadTab({
  leadId,
  renderHeaderActions,
}: {
  leadId: string;
  /** Accepted for API compatibility; the lookup now resolves by lead + phone server-side. */
  leadPhone?: string | null;
  renderHeaderActions?: (threadId: string) => ReactNode;
}) {
  const [thread, setThread] = useState<ThreadListItem | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Direct lookup by lead (with a server-side phone fallback) — finds the
        // conversation no matter how old, instead of scanning only the most
        // recent inbox page (which missed older chats on busy numbers).
        const t = await getThreadForLead(leadId);
        if (cancelled) return;
        setThread(t);
      } catch {
        if (!cancelled) setThread(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  if (thread === undefined) {
    return (
      <GlassCard variant="default" padded="lg">
        <div className="sos-text-muted" style={{ padding: 24, textAlign: 'center' }}>
          Looking for a WhatsApp conversation…
        </div>
      </GlassCard>
    );
  }

  if (!thread) {
    return (
      <GlassCard variant="default" padded="lg">
        <EmptyState
          Icon={MessageSquare}
          title="No WhatsApp conversation yet"
          description="When this lead messages your business on WhatsApp, the conversation will appear here."
        />
      </GlassCard>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {renderHeaderActions ? renderHeaderActions(thread.id) : null}
      <WhatsAppChatPanel threadId={thread.id} />
    </div>
  );
}
