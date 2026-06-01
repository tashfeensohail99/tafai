'use client';
// One-off admin tool: preview + shift future appointments that fall outside
// office hours (9 AM–6 PM PKT) into the working day. Preview is read-only;
// Apply performs the shift and returns the list so the team can confirm the
// new times with each client (no auto-messaging).

import { useState, type CSSProperties } from 'react';
import { apiFetch } from '@/lib/api-client';

interface ReshiftItem {
  id: string;
  who: string;
  phone: string | null;
  appointmentType: string;
  status: string;
  currentPkt: string;
  newPkt: string;
}
interface ReshiftResult {
  applied: boolean;
  count: number;
  items: ReshiftItem[];
}

const btn = (primary = false): CSSProperties => ({
  padding: '6px 12px',
  borderRadius: 8,
  border: `1px solid ${primary ? '#2563eb' : '#d1d5db'}`,
  background: primary ? '#2563eb' : '#fff',
  color: primary ? '#fff' : '#111827',
  fontSize: 12.5,
  cursor: 'pointer',
});
const th: CSSProperties = { padding: '6px 8px', fontWeight: 600 };
const td: CSSProperties = { padding: '6px 8px' };

export function OfficeHoursCleanupCard() {
  const [result, setResult] = useState<ReshiftResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function preview() {
    setLoading(true);
    setErr(null);
    try {
      setResult(await apiFetch<ReshiftResult>('/appointments/admin/out-of-hours'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    if (!result || result.count === 0) return;
    if (
      !window.confirm(
        `Shift ${result.count} appointment(s) into office hours?\n\nClients are NOT auto-notified — your team should confirm the new time with each one.`,
      )
    )
      return;
    setApplying(true);
    setErr(null);
    try {
      setResult(
        await apiFetch<ReshiftResult>('/appointments/admin/reshift-office-hours', { method: 'POST' }),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to apply');
    } finally {
      setApplying(false);
    }
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 15 }}>⏰ Out-of-hours appointment cleanup</strong>
        <span style={{ fontSize: 12.5, color: '#6b7280' }}>
          Find upcoming appointments outside 9 AM–6 PM PKT and shift them into office hours.
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" onClick={preview} disabled={loading} style={btn(false)}>
            {loading ? 'Checking…' : 'Preview'}
          </button>
          {result && !result.applied && result.count > 0 ? (
            <button type="button" onClick={apply} disabled={applying} style={btn(true)}>
              {applying ? 'Shifting…' : `Shift ${result.count} into office hours`}
            </button>
          ) : null}
        </div>
      </div>

      {err ? <div style={{ color: '#b91c1c', fontSize: 12.5, marginTop: 8 }}>{err}</div> : null}

      {result ? (
        <div style={{ marginTop: 12 }}>
          {result.count === 0 ? (
            <div style={{ fontSize: 13, color: '#059669' }}>
              ✓ No upcoming appointments are outside office hours.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, marginBottom: 8, color: '#374151' }}>
                {result.applied
                  ? `✓ Shifted ${result.count} appointment(s) into office hours — confirm the new times with these clients:`
                  : `${result.count} appointment(s) are outside 9–6 PKT. Review below, then click “Shift”. Clients are not auto-notified.`}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: '#6b7280' }}>
                      <th style={th}>Client</th>
                      <th style={th}>Phone</th>
                      <th style={th}>Type</th>
                      <th style={th}>Current (PKT)</th>
                      <th style={th}>New (PKT)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((i) => (
                      <tr key={i.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                        <td style={td}>{i.who}</td>
                        <td style={td}>{i.phone ?? '—'}</td>
                        <td style={td}>{i.appointmentType}</td>
                        <td style={td}>{i.currentPkt}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{i.newPkt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
