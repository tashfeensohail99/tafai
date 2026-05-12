'use client';

import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { EmptyState, GlassCard } from '@/components/sales-v2/ui';
import { listThreads, type ThreadListItem } from '@/lib/whatsapp';
import { WhatsAppChatPanel } from './WhatsAppChatPanel';

/**
 * The "WhatsApp" tab inside the lead/client detail page.
 *
 * Strategy: look up the WhatsApp thread linked to this lead. Today we do
 * that by searching the inbox by phone, since the dedicated
 * `GET /whatsapp/threads/by-lead/:id` endpoint isn't built yet (one-line
 * follow-up).
 */
export function WhatsAppLeadTab({ leadId, leadPhone }: { leadId: string; leadPhone: string | null }) {
  const [thread, setThread] = useState<ThreadListItem | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Pull a generous page; threads are sorted by lastMessageAt desc.
        // The backend already scopes by role; we just look up by lead id.
        const res = await listThreads({});
        if (cancelled) return;
        const match =
          res.items.find((t) => t.lead?.id === leadId) ??
          (leadPhone ? res.items.find((t) => t.lead?.phone === leadPhone) : undefined) ??
          null;
        setThread(match);
      } catch {
        if (!cancelled) setThread(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [leadId, leadPhone]);

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

  return <WhatsAppChatPanel threadId={thread.id} />;
}
