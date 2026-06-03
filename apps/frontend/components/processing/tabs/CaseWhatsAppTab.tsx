'use client';
// Mounts the EXACT Sales WhatsApp chat panel on a processing case. Unlike the
// Sales WhatsAppLeadTab (which resolves the thread by leadId only), processing
// clients are frequently CLIENT-linked (leadId null) — especially manually
// created ones — so we resolve the thread via the case endpoint, which matches
// by lead OR client, then hand the resolved threadId to the unmodified panel.

import { useEffect, useState } from 'react';
import { Loader2, MessageCircle } from 'lucide-react';
import { GlassCard, EmptyState } from '@/components/sales-v2/ui';
import { WhatsAppChatPanel } from '@/components/whatsapp/WhatsAppChatPanel';
import { type MockProcessingCase } from '@/components/processing/mockData';
import { fetchCaseWhatsApp } from '@/lib/processing';

export function CaseWhatsAppTab({ c }: { c: MockProcessingCase }) {
  // undefined = loading, null = no conversation, string = thread id
  const [threadId, setThreadId] = useState<string | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setThreadId(undefined);
    setErr(null);
    fetchCaseWhatsApp(c.id)
      .then((d) => { if (!cancelled) setThreadId(d.threadId); })
      .catch((e: unknown) => {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : 'Failed to load WhatsApp');
          setThreadId(null);
        }
      });
    return () => { cancelled = true; };
  }, [c.id]);

  if (threadId === undefined) {
    return (
      <GlassCard variant="panel" padded="lg">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
          <Loader2 size={16} className="sos-spin" />
          <span>Loading WhatsApp…</span>
        </div>
      </GlassCard>
    );
  }

  if (!threadId) {
    return (
      <GlassCard variant="panel" padded="lg">
        <EmptyState
          Icon={MessageCircle}
          title="No WhatsApp conversation yet"
          description={err ?? 'When this client messages your business number on WhatsApp, the conversation appears here.'}
        />
      </GlassCard>
    );
  }

  // hideSidePanel: the panel's side actions (Convert to client / Book appointment)
  // are Sales-workflow CTAs that don't apply to an already-converted processing
  // client — hide them, keep the full chat (history, media, voice, templates, ticks).
  return (
    <div style={{ minHeight: 560 }}>
      <WhatsAppChatPanel threadId={threadId} hideSidePanel />
    </div>
  );
}
