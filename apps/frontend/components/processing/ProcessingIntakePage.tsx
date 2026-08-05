'use client';
// Processing Manager Queue — Phase 5.1.
//
// Per the Processing Manager → Associate workflow, this queue belongs to
// the manager. Cases arrive here from Accounts/Finance; the manager:
//   1. Reviews + (optionally) re-confirms the case category.
//   2. Picks the right Processing Associate to handle the work.
//   3. Acknowledges + assigns in one step. The associate then sees the
//      case in their My Cases queue.
//
// Sales never randomly assigns; associates never self-pick from this queue.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Globe,
  Loader2,
  Phone,
  Search,
  ShieldAlert,
  User,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import {
  ButtonLink,
  EmptyState,
  GlassCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  fmtAmount,
  fmtRelative,
  PRIORITY_LABEL,
} from '@/components/processing/mockData';
import { priorityTone } from './ProcessingDashboardPage';
import {
  acknowledgeIntake,
  casePersonName,
  casePersonPhone,
  fetchIntakeQueue,
  fetchProcessingOfficers,
  type ApiIntakeCaseItem,
  type ApiProcessingOfficer,
} from '@/lib/processing';
import { PICKABLE_SERVICE_TYPES, labelForServiceCode, isCanonicalServiceCode } from '@/lib/service-types';
import { useProcessingSession } from '@/components/layout/ProcessingShell';

// ---------- Acknowledge modal ----------------------------------------------

// Phase F — specific programs that have their own document requirement set
// (seeded in 20260531150000). When the manager picks one, acknowledge builds
// the program-specific checklist; leaving it blank uses the generic service
// list. Extend as more programs are seeded.
const PROGRAMS_BY_SERVICE: Record<string, Array<{ code: string; label: string }>> = {
  WORK_PERMIT: [
    { code: 'C11', label: 'C11 — Entrepreneur / Self-employed (Canada)' },
    { code: 'ICT', label: 'ICT — Intra-Company Transfer (Canada)' },
    { code: 'LMIA', label: 'LMIA — Skilled Worker (Canada)' },
  ],
  VISIT_VISA: [{ code: 'VISIT', label: 'Visitor visa' }],
};

function AcknowledgeModal({
  caseRecord: c,
  officers,
  onClose,
  onConfirm,
}: {
  caseRecord: ApiIntakeCaseItem;
  officers: ApiProcessingOfficer[];
  onClose: () => void;
  onConfirm: () => void;
}) {
  // Pre-pick the only associate if there's exactly one; otherwise leave the
  // manager to choose so we never silently route work to the wrong person.
  const onlyAssociate = officers.filter((o) => o.primaryRole === 'processing');
  const [officerId, setOfficerId] = useState<string>(
    onlyAssociate.length === 1 ? onlyAssociate[0]!.id : '',
  );
  // If the lead's service is a legacy free-text value (e.g. "study") it
  // isn't one of the 9 canonical codes, so the <select> can't show it as a
  // real selection. Start blank in that case and FORCE the manager to pick
  // a canonical category — otherwise the case acknowledges with a service
  // no template matches and gets an empty document checklist.
  const incomingIsCanonical = isCanonicalServiceCode(c.service);
  const [serviceCode, setServiceCode] = useState<string>(
    incomingIsCanonical ? c.service : '',
  );
  // Phase F — optional specific program (C11/ICT/LMIA/VISIT). Drives the
  // program-specific checklist; reset whenever the category changes.
  const [programCode, setProgramCode] = useState<string>('');
  const programOptions = PROGRAMS_BY_SERVICE[serviceCode] ?? [];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!serviceCode) {
      setError('Confirm the case category — it drives the document checklist.');
      return;
    }
    if (!officerId) {
      setError('Pick a Processing Associate to assign this case to.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Always send the (now-guaranteed-canonical) service so the checklist
      // builds correctly, even when the lead arrived with a legacy value.
      await acknowledgeIntake(c.id, {
        assignOfficerId: officerId,
        service: serviceCode,
        ...(programCode ? { programCode } : {}),
      });
      onConfirm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to acknowledge');
      setLoading(false);
    }
  }

  // Warn when the manager's pick differs from the lead's original (canonical)
  // value, or whenever the lead arrived non-canonical (so they know a
  // checklist is about to be attached).
  const serviceChanged = !!serviceCode && serviceCode !== c.service;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="sos-glass sos-glass--strong"
        style={{ width: '100%', maxWidth: 520, padding: 28, borderRadius: 'var(--sos-radius-lg)', position: 'relative' }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{ position: 'absolute', top: 16, right: 16, background: 'transparent', border: 'none', color: 'var(--sos-text-muted)', cursor: 'pointer', padding: 6 }}
        >
          <X size={16} />
        </button>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-brand-primary-strong)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Acknowledge & Assign</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{casePersonName(c)}</div>
          <div style={{ fontSize: 13, color: 'var(--sos-text-muted)', marginTop: 4 }}>{labelForServiceCode(c.service)} · {c.targetCountry}</div>
        </div>

        {/* Case summary */}
        <div className="sos-glass" style={{ padding: '14px 16px', borderRadius: 'var(--sos-radius-md)', marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
          <div>
            <div style={{ color: 'var(--sos-text-muted)', fontSize: 11, marginBottom: 2 }}>Priority</div>
            <StatusBadge tone={priorityTone(c.priority)} size="sm">{PRIORITY_LABEL[c.priority]}</StatusBadge>
          </div>
          <div>
            <div style={{ color: 'var(--sos-text-muted)', fontSize: 11, marginBottom: 2 }}>Amount paid</div>
            <div style={{ fontWeight: 600, color: 'var(--sos-text-primary)' }}>
              {c.financeHandover
                ? fmtAmount(Number(c.financeHandover.submittedAmount), c.financeHandover.currency)
                : 'Manually created'}
            </div>
          </div>
          <div>
            <div style={{ color: 'var(--sos-text-muted)', fontSize: 11, marginBottom: 2 }}>Receipt file</div>
            <div style={{ fontWeight: 500, color: 'var(--sos-text-primary)', fontSize: 12 }}>
              {c.financeHandover?.receiptFileName ?? 'No payment on file'}
            </div>
          </div>
          <div>
            <div style={{ color: 'var(--sos-text-muted)', fontSize: 11, marginBottom: 2 }}>Received</div>
            <div style={{ fontWeight: 500, color: 'var(--sos-text-primary)' }}>{fmtRelative(c.createdAt)}</div>
          </div>
          <div>
            <div style={{ color: 'var(--sos-text-muted)', fontSize: 11, marginBottom: 2 }}>Sales rep</div>
            <div style={{ fontWeight: 500, color: 'var(--sos-text-primary)' }}>
              {c.lead.assignedEmployee ? `${c.lead.assignedEmployee.firstName} ${c.lead.assignedEmployee.lastName}` : 'Unassigned'}
            </div>
          </div>
        </div>

        {c.financeHandoverNote ? (
          <div style={{ padding: '12px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-status-info-soft)', border: '1px solid var(--sos-status-info-border)', fontSize: 13, color: 'var(--sos-text-primary)', marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-status-info)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Finance note</div>
            {c.financeHandoverNote}
          </div>
        ) : null}

        {/* Case-type confirmation */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Confirm case category
          </label>
          <select
            className="sos-input"
            value={serviceCode}
            onChange={(e) => { setServiceCode(e.target.value); setProgramCode(''); }}
            style={{ width: '100%' }}
          >
            <option value="" disabled>Choose a case category…</option>
            {PICKABLE_SERVICE_TYPES.map((s) => (
              <option key={s.code} value={s.code}>{s.label}</option>
            ))}
          </select>
          {!incomingIsCanonical ? (
            <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--sos-status-warning)' }}>
              This lead arrived with a free-text service (&quot;{c.service}&quot;). Pick the matching category so the right document checklist attaches.
            </div>
          ) : serviceChanged ? (
            <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--sos-status-warning)' }}>
              Changing the category will build the document checklist from the {labelForServiceCode(serviceCode)} template.
            </div>
          ) : null}
        </div>

        {/* Phase F — specific program (drives the program-specific checklist) */}
        {programOptions.length > 0 ? (
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              Specific program <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional — builds the exact checklist)</span>
            </label>
            <select
              className="sos-input"
              value={programCode}
              onChange={(e) => setProgramCode(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">Generic {labelForServiceCode(serviceCode)} checklist</option>
              {programOptions.map((p) => (
                <option key={p.code} value={p.code}>{p.label}</option>
              ))}
            </select>
            {programCode ? (
              <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--sos-status-info)' }}>
                Builds the {programCode} document checklist (with attestation + provide-first ordering).
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Officer picker */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Assign to Processing Associate
          </label>
          <select
            className="sos-input"
            value={officerId}
            onChange={(e) => setOfficerId(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="" disabled>Choose an associate…</option>
            {officers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}{o.primaryRole === 'processing_manager' ? ' (Manager)' : o.primaryRole === 'processing' ? '' : ` (${o.primaryRole})`}
              </option>
            ))}
          </select>
          {officers.length === 0 ? (
            <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--sos-status-danger)' }}>
              No processing associates configured. Add one via Admin → Users first.
            </div>
          ) : null}
        </div>

        {error ? (
          <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: 12.5 }}>
            {error}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <SecondaryButton onClick={onClose} disabled={loading}>Cancel</SecondaryButton>
          <PrimaryButton
            onClick={handleConfirm}
            disabled={loading || !officerId || !serviceCode}
            iconLeft={<CheckCircle2 size={15} />}
          >
            {loading ? 'Assigning…' : 'Acknowledge & assign'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ---------- Manager queue page ---------------------------------------------

const PAGE_SIZE = 20;

export function ProcessingIntakePage() {
  const { user } = useProcessingSession();
  const [queue, setQueue] = useState<ApiIntakeCaseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [officers, setOfficers] = useState<ApiProcessingOfficer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<ApiIntakeCaseItem | null>(null);
  const [assignedCount, setAssignedCount] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [reloadTick, setReloadTick] = useState(0);

  // Per the Processing workflow only managers can acknowledge. Associates
  // visiting this URL get a clear access-required state instead of a 403
  // from the backend when they click the action.
  const canManage = user.permissions.includes('processing.intake.acknowledge')
    && (user.permissions.includes('processing.case.assign')
      || user.permissions.includes('processing.case.view_all'));

  // Debounce the search box → server (spans all pages) and jump back to page 1
  // so results start from the top of the filtered set.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Officer roster — fetched once (doesn't change per page).
  useEffect(() => {
    if (!canManage) return;
    fetchProcessingOfficers().then(setOfficers).catch(() => {});
  }, [canManage]);

  // Queue — refetched on page / search / post-acknowledge change.
  useEffect(() => {
    if (!canManage) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetchIntakeQueue({ page, limit: PAGE_SIZE, search: debouncedSearch || undefined })
      .then((res) => {
        if (cancelled) return;
        // If a page emptied out (e.g. the last item was just acknowledged),
        // step back a page rather than showing a blank list.
        if (res.items.length === 0 && res.total > 0 && page > 1) {
          setPage((p) => Math.max(1, p - 1));
          return;
        }
        setQueue(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load queue'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canManage, page, debouncedSearch, reloadTick]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  if (!canManage) {
    return (
      <GlassCard variant="panel" padded="lg">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '40px 20px', textAlign: 'center' }}>
          <ShieldAlert size={40} style={{ color: 'var(--sos-status-warning)' }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Manager access required</div>
          <div style={{ fontSize: 14, color: 'var(--sos-text-muted)' }}>
            New cases land in the Manager Queue. Associates pick up work from <Link href={'/processing/cases' as Route} style={{ color: 'var(--sos-brand-primary-strong)', textDecoration: 'none', fontWeight: 600 }}>My Cases</Link> once a manager has assigned it.
          </div>
        </div>
      </GlassCard>
    );
  }

  return (
    <>
      {activeModal ? (
        <AcknowledgeModal
          caseRecord={activeModal}
          officers={officers}
          onClose={() => setActiveModal(null)}
          onConfirm={() => {
            setActiveModal(null);
            setAssignedCount((n) => n + 1);
            setReloadTick((t) => t + 1);
          }}
        />
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <PageHeader
          eyebrow="Processing — Manager"
          title="Manager Queue"
          description={
            total > 0
              ? `${total} case${total !== 1 ? 's' : ''} from Finance awaiting your review. Confirm the case category and pick the right Associate.`
              : 'Queue is clear. All cases from Finance have been assigned.'
          }
          actions={
            <ButtonLink href={'/processing' as Route} variant="ghost" iconRight={<ArrowRight size={14} />}>
              Back to dashboard
            </ButtonLink>
          }
        />

        {error ? (
          <GlassCard variant="panel" padded="lg">
            <div style={{ padding: 16, color: 'var(--sos-status-danger)' }}>Failed to load: {error}</div>
          </GlassCard>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Search runs server-side, so it spans every page (not just the
                one loaded). Kept above the loading/list area so it stays put
                during page changes and a zero-result search never traps you. */}
            {(total > 0 || debouncedSearch) ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-hover)', maxWidth: 340 }}>
                <Search size={13} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
                <input
                  type="search"
                  placeholder="Search client, phone, reference…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--sos-text-primary)', fontSize: 12.5 }}
                />
              </div>
            ) : null}
            {loading ? (
              <GlassCard variant="panel" padded="lg">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
                  <Loader2 size={16} className="sos-spin" />
                  <span>Loading queue…</span>
                </div>
              </GlassCard>
            ) : queue.length === 0 ? (
              <GlassCard variant="panel" padded="lg">
                <EmptyState
                  Icon={CheckCircle2}
                  title={debouncedSearch ? 'No matches' : 'Queue is clear'}
                  description={
                    debouncedSearch
                      ? `No cases match “${debouncedSearch}”.`
                      : 'No new cases from Finance pending review.'
                  }
                />
              </GlassCard>
            ) : null}
            {!loading && queue.map((c) => (
              <GlassCard
                key={c.id}
                variant="default"
                hover
                padded="md"
                style={{ borderLeft: c.priority === 'CRITICAL' ? '3px solid var(--sos-status-danger)' : c.priority === 'URGENT' ? '3px solid var(--sos-status-warning)' : undefined }}
              >
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                  <div style={{ flexShrink: 0, paddingTop: 2 }}>
                    <StatusBadge tone={priorityTone(c.priority)} size="sm" dot={false}>
                      {PRIORITY_LABEL[c.priority]}
                    </StatusBadge>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sos-text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <User size={14} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
                        {casePersonName(c)}
                      </div>
                      <div style={{ height: 16, width: 1, background: 'var(--sos-border-subtle)' }} />
                      <div style={{ fontSize: 13, color: 'var(--sos-text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Globe size={13} />
                        {labelForServiceCode(c.service)} · {c.targetCountry}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--sos-text-muted)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Phone size={12} /> {casePersonPhone(c)}
                      </span>
                      {c.financeHandover ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Wallet size={12} /> {fmtAmount(Number(c.financeHandover.submittedAmount), c.financeHandover.currency)}
                        </span>
                      ) : null}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CalendarClock size={12} /> Received {fmtRelative(c.createdAt)}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <UserCheck size={12} /> Sales: {c.lead.assignedEmployee ? `${c.lead.assignedEmployee.firstName} ${c.lead.assignedEmployee.lastName}` : 'Unassigned'}
                      </span>
                    </div>

                    {c.financeHandoverNote ? (
                      <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 'var(--sos-radius-sm)', background: 'var(--sos-status-info-soft)', border: '1px solid var(--sos-status-info-border)', fontSize: 12.5, color: 'var(--sos-text-primary)' }}>
                        <span style={{ fontWeight: 600, color: 'var(--sos-status-info)' }}>Finance note: </span>
                        {c.financeHandoverNote}
                      </div>
                    ) : null}
                  </div>

                  <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                    <PrimaryButton
                      onClick={() => setActiveModal(c)}
                      iconLeft={<CheckCircle2 size={14} />}
                    >
                      Acknowledge & assign
                    </PrimaryButton>
                    <Link
                      href={`/processing/cases/${c.id}` as Route}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--sos-text-muted)', textDecoration: 'none' }}
                    >
                      Preview <ArrowRight size={12} />
                    </Link>
                  </div>
                </div>
              </GlassCard>
            ))}
            {/* Pagination — server-driven; only when there's more than one page. */}
            {!loading && totalPages > 1 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, paddingTop: 4 }}>
                <span style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  Showing {from}–{to} of {total}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <SecondaryButton onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                    Previous
                  </SecondaryButton>
                  <span style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    Page {page} of {totalPages}
                  </span>
                  <SecondaryButton onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                    Next
                  </SecondaryButton>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {assignedCount > 0 ? (
          <GlassCard variant="soft" padded="md">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--sos-status-success)' }}>
              <CheckCircle2 size={16} />
              <span style={{ fontWeight: 600 }}>{assignedCount}</span> case{assignedCount !== 1 ? 's' : ''} assigned this session. Track team workload from the{' '}
              <Link href={'/processing/manager' as Route} style={{ color: 'var(--sos-brand-primary-strong)', fontWeight: 600, textDecoration: 'none' }}>
                Manager Dashboard <ArrowRight size={13} style={{ display: 'inline', verticalAlign: 'middle' }} />
              </Link>
            </div>
          </GlassCard>
        ) : null}
      </div>
    </>
  );
}
