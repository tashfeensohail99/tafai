'use client';
// Admin appointments dashboard — at-a-glance counts over upcoming appointments:
// timeframe windows, per-salesperson load, by-status, unassigned + out-of-hours.

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';

interface Overview {
  total: number;
  next24: number;
  next7: number;
  outsideHours: number;
  unassigned: number;
  byStatus: Record<string, number>;
  byEmployee: { name: string; count: number }[];
}

export function AppointmentsDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Overview>('/appointments/admin/overview')
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load overview'));
  }, []);

  if (err) {
    return <div style={{ color: '#b91c1c', fontSize: 12.5, marginBottom: 16 }}>{err}</div>;
  }
  if (!data) return null;

  const tiles = [
    { label: 'Upcoming', value: data.total, warn: false },
    { label: 'Next 24h', value: data.next24, warn: false },
    { label: 'Next 7 days', value: data.next7, warn: false },
    { label: 'Out of hours', value: data.outsideHours, warn: data.outsideHours > 0 },
    { label: 'Unassigned', value: data.unassigned, warn: data.unassigned > 0 },
  ];

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16, background: '#fff' }}>
      <strong style={{ fontSize: 15 }}>📅 Appointments overview</strong>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
        {tiles.map((t) => (
          <div
            key={t.label}
            style={{
              minWidth: 110,
              padding: '10px 14px',
              borderRadius: 10,
              background: t.warn ? '#fef3c7' : '#f9fafb',
              border: `1px solid ${t.warn ? '#fde68a' : '#eeeeee'}`,
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700, color: t.warn ? '#92400e' : '#111827' }}>{t.value}</div>
            <div style={{ fontSize: 11.5, color: '#6b7280' }}>{t.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 16 }}>
        <div style={{ minWidth: 240, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Upcoming by salesperson</div>
          {data.byEmployee.length === 0 && data.unassigned === 0 ? (
            <div style={{ fontSize: 12, color: '#6b7280' }}>No upcoming appointments.</div>
          ) : (
            <>
              {data.byEmployee.map((e) => (
                <div
                  key={e.name}
                  style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0', borderBottom: '1px solid #f3f4f6' }}
                >
                  <span>{e.name || 'Unknown'}</span>
                  <strong>{e.count}</strong>
                </div>
              ))}
              {data.unassigned > 0 ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0', color: '#92400e' }}>
                  <span>Unassigned</span>
                  <strong>{data.unassigned}</strong>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div style={{ minWidth: 200 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>By status</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.keys(data.byStatus).length === 0 ? (
              <span style={{ fontSize: 12, color: '#6b7280' }}>—</span>
            ) : (
              Object.entries(data.byStatus).map(([s, n]) => (
                <span key={s} style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 999, background: '#f3f4f6', color: '#374151' }}>
                  {s}: {n}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
