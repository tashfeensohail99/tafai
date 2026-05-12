'use client';

import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  FileText,
  MessageSquare,
} from 'lucide-react';
import { GlassCard, StatusBadge, type BadgeTone } from '@/components/sales-v2/ui';
import {
  CLIENT_STAGE_LABEL,
  CLIENT_STAGE_TONE,
  CLIENT_NEXT_ACTION,
  fmtDate,
  type ProcessingCaseStage,
} from '@/lib/portal';
import { useClientSession } from '@/components/layout/ClientPortalShell';

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '10px 0',
        borderBottom: '1px solid var(--sos-border-subtle)',
      }}
    >
      <span style={{ fontSize: '12.5px', color: 'var(--sos-text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--sos-text-primary)', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function initialsFromName(name: string | null): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '');
}

interface ActionCardProps {
  tone: BadgeTone;
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
  cta: string;
}

function ActionCard({ tone, icon, title, description, href, cta }: ActionCardProps) {
  const borderColors: Record<BadgeTone, string> = {
    warning: 'var(--sos-status-warning)',
    danger: 'var(--sos-status-danger)',
    info: 'var(--sos-status-info)',
    success: 'var(--sos-status-success)',
    accent: 'var(--sos-brand-primary-strong)',
    neutral: 'var(--sos-border-subtle)',
    warm: 'var(--sos-brand-accent)',
    violet: 'var(--sos-status-violet)',
    cyan: 'var(--sos-status-cyan)',
    pink: 'var(--sos-status-pink)',
  };
  const bgColors: Record<BadgeTone, string> = {
    warning: 'var(--sos-status-warning-soft)',
    danger: 'var(--sos-status-danger-soft)',
    info: 'var(--sos-status-info-soft)',
    success: 'var(--sos-status-success-soft)',
    accent: 'var(--sos-brand-primary-soft)',
    neutral: 'var(--sos-surface-2)',
    warm: 'var(--sos-brand-accent-soft)',
    violet: 'var(--sos-status-violet-soft)',
    cyan: 'var(--sos-status-cyan-soft)',
    pink: 'var(--sos-status-pink-soft)',
  };

  return (
    <GlassCard variant="panel" padded="md" style={{ borderLeft: `3px solid ${borderColors[tone]}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <div
          style={{
            flexShrink: 0,
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: bgColors[tone],
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: '3px' }}>{title}</div>
          <div style={{ fontSize: '12.5px', color: 'var(--sos-text-muted)', marginBottom: '12px' }}>{description}</div>
          <Link
            href={href as Route}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '13px',
              fontWeight: 600,
              color: borderColors[tone],
              textDecoration: 'none',
            }}
          >
            {cta} <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </GlassCard>
  );
}

export function ClientCaseOverviewPage() {
  const { user, activeCase } = useClientSession();

  if (!activeCase) {
    return (
      <GlassCard variant="panel" padded="lg">
        <div className="sos-text-muted" style={{ textAlign: 'center', padding: 24 }}>
          No active case yet. We'll let you know as soon as your file moves into processing.
        </div>
      </GlassCard>
    );
  }

  const stage = activeCase.stage as ProcessingCaseStage;
  const stageTone = CLIENT_STAGE_TONE[stage] as BadgeTone;
  const stageLabel = CLIENT_STAGE_LABEL[stage];
  const nextAction = CLIENT_NEXT_ACTION[stage];
  const docPct = activeCase.docsTotal === 0
    ? 0
    : Math.round((activeCase.docsAccepted / activeCase.docsTotal) * 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--sos-brand-primary-strong)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>
          Welcome back
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--sos-text-primary)', margin: 0 }}>
          {user.email}
        </h1>
        <div style={{ fontSize: '14px', color: 'var(--sos-text-muted)', marginTop: '4px' }}>
          {activeCase.service} · {activeCase.targetCountry ?? '—'}
        </div>
      </div>

      <GlassCard variant="strong" padded="lg">
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
            marginBottom: '16px',
          }}
        >
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
              Application status
            </div>
            <StatusBadge tone={stageTone} size="lg">{stageLabel}</StatusBadge>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginBottom: '4px' }}>Documents</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>
              {activeCase.docsAccepted}/{activeCase.docsTotal}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--sos-text-muted)' }}>accepted</div>
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <div style={{ flex: 1, height: '8px', background: 'var(--sos-surface-hover)', borderRadius: '999px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${docPct}%`,
                  height: '100%',
                  background: docPct === 100 ? 'var(--sos-status-success)' : 'var(--sos-brand-gradient)',
                  borderRadius: '999px',
                  transition: 'width 400ms ease',
                }}
              />
            </div>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--sos-text-primary)', minWidth: '36px', textAlign: 'right' }}>{docPct}%</span>
          </div>
        </div>

        {nextAction ? (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--sos-radius-md)',
              background:
                stageTone === 'warning' || stageTone === 'danger'
                  ? 'var(--sos-status-warning-soft)'
                  : 'var(--sos-status-info-soft)',
              border: `1px solid ${
                stageTone === 'warning' || stageTone === 'danger'
                  ? 'var(--sos-status-warning-border)'
                  : 'var(--sos-status-info-border)'
              }`,
              fontSize: '13px',
              color: 'var(--sos-text-primary)',
              lineHeight: 1.55,
            }}
          >
            {nextAction}
          </div>
        ) : null}
      </GlassCard>

      {(activeCase.docsActionRequired > 0 || activeCase.unreadMessages > 0) && (
        <div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
            Action required
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {activeCase.docsActionRequired > 0 && (
              <ActionCard
                tone="warning"
                icon={<AlertTriangle size={16} style={{ color: 'var(--sos-status-warning)' }} />}
                title={`${activeCase.docsActionRequired} document${activeCase.docsActionRequired !== 1 ? 's' : ''} need${activeCase.docsActionRequired === 1 ? 's' : ''} your attention`}
                description="Review the Documents tab to upload or correct"
                href="/portal/case/documents"
                cta="Go to Documents"
              />
            )}
            {activeCase.unreadMessages > 0 && (
              <ActionCard
                tone="info"
                icon={<MessageSquare size={16} style={{ color: 'var(--sos-status-info)' }} />}
                title={`${activeCase.unreadMessages} unread message${activeCase.unreadMessages !== 1 ? 's' : ''} from your officer`}
                description="Your processing officer has sent you a message"
                href="/portal/case/messages"
                cta="View messages"
              />
            )}
          </div>
        </div>
      )}

      <GlassCard variant="panel" padded="md">
        <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
          Case details
        </div>
        <div>
          <InfoRow label="Service" value={activeCase.service} />
          <InfoRow label="Country" value={activeCase.targetCountry ?? '—'} />
          <InfoRow label="Case opened" value={fmtDate(activeCase.createdAt)} />
          <InfoRow
            label="Assigned officer"
            value={
              activeCase.assignedOfficerName ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      background: 'var(--sos-brand-primary-soft)',
                      border: '1px solid var(--sos-brand-primary-border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '9px',
                      fontWeight: 700,
                      color: 'var(--sos-brand-primary-strong)',
                    }}
                  >
                    {initialsFromName(activeCase.assignedOfficerName)}
                  </div>
                  {activeCase.assignedOfficerName}
                </div>
              ) : (
                <span className="sos-text-muted">Not yet assigned</span>
              )
            }
          />
        </div>
      </GlassCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
        {[
          { href: '/portal/case/documents', icon: <FileText size={18} />, label: 'Documents', count: `${activeCase.docsAccepted}/${activeCase.docsTotal}` },
          { href: '/portal/case/messages', icon: <MessageSquare size={18} />, label: 'Messages', count: activeCase.unreadMessages > 0 ? `${activeCase.unreadMessages} unread` : '' },
          { href: '/portal/case/timeline', icon: <Clock size={18} />, label: 'Timeline', count: '' },
        ].map((q) => (
          <Link key={q.href} href={q.href as Route} style={{ textDecoration: 'none' }}>
            <GlassCard variant="soft" padded="md" style={{ cursor: 'pointer', transition: 'all 150ms', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ color: 'var(--sos-brand-primary-strong)' }}>{q.icon}</div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{q.label}</div>
                {q.count ? <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>{q.count}</div> : null}
              </div>
              <ArrowRight size={14} style={{ marginLeft: 'auto', color: 'var(--sos-text-muted)' }} />
            </GlassCard>
          </Link>
        ))}
      </div>
    </div>
  );
}
