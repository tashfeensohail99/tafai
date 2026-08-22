'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Play,
  Upload,
  X,
} from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import { apiFetch } from '@/lib/api-client';
import {
  previewImport,
  startImport,
  type ColumnMapping,
  type PreviewResult,
} from '@/lib/lead-imports-api';

/**
 * The 3-step admin wizard for uploading a CSV/Excel file of leads.
 *
 * Step 1 — pick the file.
 * Step 2 — review the parsed sample, confirm/edit the column mapping.
 * Step 3 — name the batch, pick agents (or leave blank for "all eligible"),
 *          optionally override the welcome message, and start.
 *
 * Backend handles the heavy lifting async via BullMQ. On submit we get a
 * batch id and route the admin to /admin/lead-imports/{id} to watch
 * progress.
 */

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
  whatsappInboxMember?: boolean;
  user?: { status?: string };
}

// Canonical lead fields the admin can map a column to.
const MAPPABLE_FIELDS: Array<{
  key: keyof ColumnMapping;
  label: string;
  required?: boolean;
}> = [
  { key: 'phone', label: 'Phone (required)', required: true },
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'email', label: 'Email' },
  { key: 'alternatePhone', label: 'Alternate phone' },
  { key: 'targetCountry', label: 'Target country' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'serviceInterest', label: 'Service interest' },
  { key: 'city', label: 'City' },
  { key: 'notes', label: 'Notes' },
  { key: 'sourceLabel', label: 'Source label / campaign' },
];

export function LeadImportNewPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({ phone: '' });
  const [batchName, setBatchName] = useState('');
  const [defaultCountry, setDefaultCountry] = useState('PK');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [agents, setAgents] = useState<EmployeeOption[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── load eligible agents once when we hit step 3 ─────────────────────────
  useEffect(() => {
    if (step !== 3 || agents.length > 0) return;
    void (async () => {
      try {
        const list = await apiFetch<EmployeeOption[]>('/employees');
        setAgents(
          list.filter(
            (e) => e.whatsappInboxMember && e.user?.status === 'ACTIVE',
          ),
        );
      } catch {
        // Non-fatal — admin can still submit with selectedAgentIds empty
        // (= "use whoever is eligible at run time").
      }
    })();
  }, [step, agents.length]);

  // ── Step 1 → Step 2: upload + preview ───────────────────────────────────
  async function handlePreview() {
    if (!file) {
      setError('Pick a CSV or Excel file first.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await previewImport(file);
      setPreview(result);
      setMapping({
        phone: result.suggestedMapping.phone ?? '',
        firstName: result.suggestedMapping.firstName,
        lastName: result.suggestedMapping.lastName,
        email: result.suggestedMapping.email,
        alternatePhone: result.suggestedMapping.alternatePhone,
        nationality: result.suggestedMapping.nationality,
        targetCountry: result.suggestedMapping.targetCountry,
        serviceInterest: result.suggestedMapping.serviceInterest,
        city: result.suggestedMapping.city,
        notes: result.suggestedMapping.notes,
        sourceLabel: result.suggestedMapping.sourceLabel,
      });
      // Default batch name to the filename minus extension.
      if (!batchName) {
        const base = file.name.replace(/\.(csv|xlsx?|xls)$/i, '');
        setBatchName(base);
      }
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  }

  // ── Step 3 → submit: start import ───────────────────────────────────────
  async function handleStart() {
    if (!file) return;
    if (!mapping.phone) {
      setError('A column must be mapped to Phone before importing.');
      return;
    }
    if (!batchName.trim()) {
      setError('Give the batch a name (e.g. "May FB Ads").');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // Strip empty mapping values so backend gets clean undefined for unmapped fields.
      const cleanMapping: ColumnMapping = { phone: mapping.phone };
      for (const f of MAPPABLE_FIELDS) {
        if (f.key === 'phone') continue;
        const v = mapping[f.key];
        if (v && v.trim()) {
          cleanMapping[f.key] = v;
        }
      }
      const batch = await startImport(file, {
        name: batchName.trim(),
        columnMapping: cleanMapping,
        defaultCountry: defaultCountry.trim().toUpperCase() || 'PK',
        selectedAgentIds: selectedAgentIds.length > 0 ? selectedAgentIds : undefined,
        welcomeMessage: welcomeMessage.trim() || undefined,
      });
      router.push(`/admin/lead-imports/${batch.id}` as Route);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start import');
    } finally {
      setLoading(false);
    }
  }

  function toggleAgent(id: string) {
    setSelectedAgentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  // ── render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="Admin · CSV/Excel"
        title="Import leads from spreadsheet"
        description="Upload a file, map the columns, pick the agent pool, and let round-robin do the rest."
        actions={
          <SecondaryButton iconLeft={<ArrowLeft size={14} />} onClick={() => router.back()}>
            Back
          </SecondaryButton>
        }
      />

      <StepIndicator step={step} />

      {error ? (
        <GlassCard
          variant="soft"
          padded="sm"
          style={{
            borderLeft: '4px solid var(--sos-status-danger)',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <AlertCircle size={16} style={{ color: 'var(--sos-status-danger)' }} />
          <span style={{ fontSize: 13.5, color: 'var(--sos-text-primary)', flex: 1 }}>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sos-text-muted)' }}
          >
            <X size={14} />
          </button>
        </GlassCard>
      ) : null}

      {step === 1 ? <Step1Upload file={file} setFile={setFile} /> : null}

      {step === 2 && preview ? (
        <Step2Map
          preview={preview}
          mapping={mapping}
          setMapping={setMapping}
        />
      ) : null}

      {step === 3 ? (
        <Step3Configure
          batchName={batchName}
          setBatchName={setBatchName}
          defaultCountry={defaultCountry}
          setDefaultCountry={setDefaultCountry}
          welcomeMessage={welcomeMessage}
          setWelcomeMessage={setWelcomeMessage}
          agents={agents}
          selectedAgentIds={selectedAgentIds}
          toggleAgent={toggleAgent}
          preview={preview}
        />
      ) : null}

      {/* Footer nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <SecondaryButton
          disabled={step === 1}
          iconLeft={<ArrowLeft size={14} />}
          onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
        >
          Previous
        </SecondaryButton>
        {step < 3 ? (
          <PrimaryButton
            disabled={loading || (step === 1 && !file) || (step === 2 && !mapping.phone)}
            iconLeft={loading ? <Loader2 size={14} className="sos-spin" /> : <ArrowRight size={14} />}
            onClick={() => {
              if (step === 1) void handlePreview();
              else setStep(3);
            }}
          >
            {step === 1 ? (loading ? 'Parsing…' : 'Preview file') : 'Next: configure'}
          </PrimaryButton>
        ) : (
          <PrimaryButton
            disabled={loading || !mapping.phone || !batchName.trim()}
            iconLeft={loading ? <Loader2 size={14} className="sos-spin" /> : <Play size={14} />}
            onClick={() => void handleStart()}
          >
            {loading ? 'Starting…' : 'Start import'}
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}

// ── Step 1 ────────────────────────────────────────────────────────────────

function Step1Upload({ file, setFile }: { file: File | null; setFile: (f: File | null) => void }) {
  return (
    <GlassCard variant="strong" padded="lg">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div className="sos-eyebrow">Step 1</div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--sos-text-primary)', marginTop: 4 }}>
            Pick the spreadsheet
          </h3>
          <p style={{ fontSize: 13, color: 'var(--sos-text-muted)', marginTop: 4 }}>
            Accepts <code>.csv</code>, <code>.xlsx</code>, and <code>.xls</code>. Max 20 MB.
            Up to 50,000 rows per file — split larger lists.
          </p>
        </div>

        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '32px 20px',
            background: 'var(--sos-surface-1)',
            border: '2px dashed var(--sos-border)',
            borderRadius: 'var(--sos-radius-sm)',
            cursor: 'pointer',
            gap: 10,
            textAlign: 'center',
          }}
        >
          <input
            type="file"
            accept=".csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ display: 'none' }}
          />
          {file ? (
            <>
              <FileSpreadsheet size={32} style={{ color: 'var(--sos-brand-primary-strong)' }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{file.name}</div>
              <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
                {(file.size / 1024).toFixed(1)} KB
              </div>
              <SecondaryButton size="sm" onClick={(e) => { e.preventDefault(); setFile(null); }}>
                Choose different file
              </SecondaryButton>
            </>
          ) : (
            <>
              <Upload size={32} style={{ color: 'var(--sos-text-muted)' }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                Click to upload
              </div>
              <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>or drag a CSV / Excel file here</div>
            </>
          )}
        </label>
      </div>
    </GlassCard>
  );
}

// ── Step 2 ────────────────────────────────────────────────────────────────

function Step2Map({
  preview,
  mapping,
  setMapping,
}: {
  preview: PreviewResult;
  mapping: ColumnMapping;
  setMapping: (m: ColumnMapping) => void;
}) {
  function setField(key: keyof ColumnMapping, value: string) {
    setMapping({ ...mapping, [key]: value || undefined } as ColumnMapping);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <GlassCard variant="strong" padded="lg">
        <div className="sos-eyebrow">Step 2</div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--sos-text-primary)', marginTop: 4, marginBottom: 14 }}>
          Confirm column mapping
        </h3>

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {MAPPABLE_FIELDS.map((f) => (
            <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: f.required ? 'var(--sos-status-danger)' : 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {f.label}
              </span>
              <select
                value={mapping[f.key] ?? ''}
                onChange={(e) => setField(f.key, e.target.value)}
                className="sos-select"
              >
                <option value="">— not mapped —</option>
                {preview.headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </GlassCard>

      <GlassCard variant="panel" padded={false}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--sos-divider)' }}>
          <div className="sos-eyebrow">Sample rows</div>
          <h4 className="sos-title" style={{ fontSize: 14, marginTop: 4 }}>
            First {preview.sampleRows.length} rows · {preview.totalRows.toLocaleString()} total · {preview.sourceFormat.toUpperCase()}
          </h4>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'var(--sos-surface-1)' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--sos-divider)' }}>#</th>
                {preview.headers.map((h) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--sos-divider)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sampleRows.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--sos-divider)' }}>
                  <td style={{ padding: '8px 12px', color: 'var(--sos-text-muted)' }}>{i + 1}</td>
                  {preview.headers.map((h) => (
                    <td key={h} style={{ padding: '8px 12px', color: 'var(--sos-text-secondary)', whiteSpace: 'nowrap' }}>
                      {row[h] || <span style={{ color: 'var(--sos-text-faint)' }}>—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  );
}

// ── Step 3 ────────────────────────────────────────────────────────────────

function Step3Configure({
  batchName,
  setBatchName,
  defaultCountry,
  setDefaultCountry,
  welcomeMessage,
  setWelcomeMessage,
  agents,
  selectedAgentIds,
  toggleAgent,
  preview,
}: {
  batchName: string;
  setBatchName: (s: string) => void;
  defaultCountry: string;
  setDefaultCountry: (s: string) => void;
  welcomeMessage: string;
  setWelcomeMessage: (s: string) => void;
  agents: EmployeeOption[];
  selectedAgentIds: string[];
  toggleAgent: (id: string) => void;
  preview: PreviewResult | null;
}) {
  const allSelected = selectedAgentIds.length === 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <GlassCard variant="strong" padded="lg">
        <div className="sos-eyebrow">Step 3</div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--sos-text-primary)', marginTop: 4, marginBottom: 14 }}>
          Name, country code, and welcome message
        </h3>

        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Batch name</span>
            <input
              required
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              placeholder="e.g. May FB Ads"
              className="sos-input"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Default country for phone normalisation</span>
            <input
              value={defaultCountry}
              onChange={(e) => setDefaultCountry(e.target.value.toUpperCase())}
              maxLength={2}
              placeholder="PK"
              className="sos-input"
              style={{ textTransform: 'uppercase' }}
            />
          </label>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Welcome message (optional — uses global default if blank)
          </span>
          <textarea
            value={welcomeMessage}
            onChange={(e) => setWelcomeMessage(e.target.value)}
            rows={6}
            placeholder="Leave blank to use the default Tashfeen welcome. Supports {firstName} and {businessNumber} placeholders."
            className="sos-input"
            style={{ fontFamily: 'monospace', fontSize: 13 }}
          />
        </label>
      </GlassCard>

      <GlassCard variant="strong" padded="lg">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <div className="sos-eyebrow">Agent pool</div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--sos-text-primary)', marginTop: 4 }}>
              Who's in the round-robin for this batch?
            </h3>
            <p style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', marginTop: 4 }}>
              Pick specific agents or leave all unchecked to use every active WhatsApp inbox member.
              Distribution uses the same round-robin cursor as live WhatsApp routing.
            </p>
          </div>
          {allSelected ? (
            <StatusBadge tone="info" size="sm">All eligible agents</StatusBadge>
          ) : (
            <StatusBadge tone="warning" size="sm">{selectedAgentIds.length} selected</StatusBadge>
          )}
        </div>

        {agents.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13 }}>
            Loading active agents…
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {agents.map((a) => {
              const checked = selectedAgentIds.includes(a.id);
              return (
                <label
                  key={a.id}
                  onClick={() => toggleAgent(a.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    borderRadius: 'var(--sos-radius-sm)',
                    background: checked ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-1)',
                    border: `1px solid ${checked ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
                    cursor: 'pointer',
                    transition: 'all 150ms',
                  }}
                >
                  {checked ? (
                    <CheckCircle2 size={16} style={{ color: 'var(--sos-brand-primary-strong)', flexShrink: 0 }} />
                  ) : (
                    <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--sos-border)', flexShrink: 0 }} />
                  )}
                  <span style={{ fontSize: 13, color: 'var(--sos-text-primary)' }}>
                    {a.firstName} {a.lastName}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </GlassCard>

      {preview ? (
        <GlassCard variant="soft" padded="md" style={{ fontSize: 13, color: 'var(--sos-text-secondary)' }}>
          Ready to import <strong>{preview.totalRows.toLocaleString()}</strong> rows. Worker runs async — you'll be taken to the batch detail page to watch progress.
        </GlassCard>
      ) : null}
    </div>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const steps: Array<{ num: 1 | 2 | 3; label: string }> = [
    { num: 1, label: 'Upload' },
    { num: 2, label: 'Map columns' },
    { num: 3, label: 'Configure & start' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {steps.map((s, idx) => {
        const active = step === s.num;
        const done = step > s.num;
        return (
          <div key={s.num} style={{ display: 'flex', alignItems: 'center', flex: idx === steps.length - 1 ? 0 : 1, gap: 4 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: active || done ? 'var(--sos-brand-primary-strong)' : 'var(--sos-surface-1)',
                color: active || done ? '#fff' : 'var(--sos-text-muted)',
                fontSize: 12,
                fontWeight: 700,
                border: `2px solid ${active ? 'var(--sos-brand-primary-strong)' : done ? 'var(--sos-brand-primary-strong)' : 'var(--sos-border)'}`,
                flexShrink: 0,
              }}
            >
              {done ? <CheckCircle2 size={14} /> : s.num}
            </div>
            <span style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? 'var(--sos-text-primary)' : 'var(--sos-text-muted)' }}>
              {s.label}
            </span>
            {idx < steps.length - 1 ? (
              <div style={{ flex: 1, height: 1, background: 'var(--sos-divider)', margin: '0 8px' }} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
