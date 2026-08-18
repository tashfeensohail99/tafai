'use client';

import { useMemo, useState } from 'react';
import type { DailyPoint } from '@/lib/marketing';
import { fmtMoney, fmtInt } from '@/lib/marketing';

/**
 * Inline SVG line chart of spend (native currency, e.g. PKR) and leads on a
 * shared date axis.
 *
 * Two independent Y-axes so the two magnitudes (money vs counts) can share
 * a plot without one squashing the other. No chart library — one dep-free
 * component; the whole thing is ~150 lines and knows exactly what we render.
 * Theme-aware (uses --sos-* CSS vars); pointer-tracked to show a per-day
 * tooltip. Responsive via viewBox — the parent controls width.
 */
export function SpendLeadsChart({ points, currency = 'PKR' }: { points: DailyPoint[]; currency?: string }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const geom = useMemo(() => {
    const W = 900;
    const H = 260;
    const padL = 44;
    const padR = 44;
    const padT = 20;
    const padB = 34;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const n = points.length;
    const step = n > 1 ? innerW / (n - 1) : 0;

    const spendMax = Math.max(1, ...points.map((p) => p.spend));
    const leadsMax = Math.max(1, ...points.map((p) => p.leads));

    const xAt = (i: number) => padL + (n > 1 ? i * step : innerW / 2);
    const ySpend = (v: number) => padT + innerH - (v / spendMax) * innerH;
    const yLeads = (v: number) => padT + innerH - (v / leadsMax) * innerH;

    const spendPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(2)},${ySpend(p.spend).toFixed(2)}`).join(' ');
    const leadsPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(2)},${yLeads(p.leads).toFixed(2)}`).join(' ');

    // Area under the spend curve — soft fill so the axis chart doesn't feel bare on quiet ranges.
    const spendArea =
      n > 0
        ? `${spendPath} L${xAt(n - 1).toFixed(2)},${(padT + innerH).toFixed(2)} L${xAt(0).toFixed(2)},${(padT + innerH).toFixed(2)} Z`
        : '';

    // X-axis ticks — 5 evenly spaced label indexes.
    const tickIdx = n <= 1 ? [0] : [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1].filter((v, i, arr) => arr.indexOf(v) === i);

    return { W, H, padL, padR, padT, padB, innerW, innerH, xAt, ySpend, yLeads, spendPath, leadsPath, spendArea, tickIdx, spendMax, leadsMax };
  }, [points]);

  const trackPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    if (points.length === 0) return setHoverIdx(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const xIn = xRatio * geom.W - geom.padL;
    if (xIn < 0 || xIn > geom.innerW) return setHoverIdx(null);
    const step = points.length > 1 ? geom.innerW / (points.length - 1) : geom.innerW;
    const i = Math.round(xIn / step);
    setHoverIdx(Math.max(0, Math.min(points.length - 1, i)));
  };

  const hover = hoverIdx != null ? points[hoverIdx] : null;
  const shortDate = (iso: string) => iso.slice(5); // MM-DD

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        viewBox={`0 0 ${geom.W} ${geom.H}`}
        width="100%"
        height="auto"
        role="img"
        aria-label="Daily spend and leads"
        onPointerMove={trackPointer}
        onPointerLeave={() => setHoverIdx(null)}
        style={{ display: 'block', touchAction: 'none' }}
      >
        {/* horizontal gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={t}
            x1={geom.padL}
            x2={geom.padL + geom.innerW}
            y1={geom.padT + geom.innerH * t}
            y2={geom.padT + geom.innerH * t}
            stroke="var(--sos-border-subtle, rgba(0,0,0,0.08))"
            strokeDasharray={t === 1 ? undefined : '2,3'}
          />
        ))}

        {/* spend area + line */}
        <path d={geom.spendArea} fill="var(--sos-brand-primary-soft, rgba(59,130,246,0.10))" />
        <path d={geom.spendPath} fill="none" stroke="var(--sos-brand-primary-strong, #2563eb)" strokeWidth={2} />

        {/* leads line (secondary axis, dashed) */}
        <path d={geom.leadsPath} fill="none" stroke="var(--sos-brand-accent, #ea580c)" strokeWidth={2} strokeDasharray="4,3" />

        {/* left-axis (spend) labels: 0, mid, max */}
        {[0, 0.5, 1].map((t) => (
          <text
            key={`ls-${t}`}
            x={geom.padL - 6}
            y={geom.padT + geom.innerH * (1 - t) + 4}
            fill="var(--sos-text-tertiary, #6b7280)"
            fontSize="10"
            textAnchor="end"
          >
            {fmtMoney(geom.spendMax * t, currency, { compact: true })}
          </text>
        ))}
        {/* right-axis (leads) labels */}
        {[0, 0.5, 1].map((t) => (
          <text
            key={`ll-${t}`}
            x={geom.padL + geom.innerW + 6}
            y={geom.padT + geom.innerH * (1 - t) + 4}
            fill="var(--sos-text-tertiary, #6b7280)"
            fontSize="10"
            textAnchor="start"
          >
            {fmtInt(Math.round(geom.leadsMax * t))}
          </text>
        ))}
        {/* x-axis date labels */}
        {geom.tickIdx.map((i) => (
          <text key={`x-${i}`} x={geom.xAt(i)} y={geom.padT + geom.innerH + 16} fill="var(--sos-text-tertiary, #6b7280)" fontSize="10" textAnchor="middle">
            {points[i] ? shortDate(points[i].date) : ''}
          </text>
        ))}

        {/* hover marker */}
        {hover ? (
          <g pointerEvents="none">
            <line x1={geom.xAt(hoverIdx!)} x2={geom.xAt(hoverIdx!)} y1={geom.padT} y2={geom.padT + geom.innerH} stroke="var(--sos-border-strong, rgba(0,0,0,0.25))" strokeWidth={1} />
            <circle cx={geom.xAt(hoverIdx!)} cy={geom.ySpend(hover.spend)} r={4} fill="var(--sos-brand-primary-strong, #2563eb)" />
            <circle cx={geom.xAt(hoverIdx!)} cy={geom.yLeads(hover.leads)} r={4} fill="var(--sos-brand-accent, #ea580c)" />
          </g>
        ) : null}
      </svg>

      {/* legend + tooltip strip */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 3, background: 'var(--sos-brand-primary-strong, #2563eb)', borderRadius: 2 }} /> Spend ({currency})
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 12,
                height: 3,
                background:
                  'repeating-linear-gradient(90deg, var(--sos-brand-accent, #ea580c) 0 4px, transparent 4px 7px)',
                borderRadius: 2,
              }}
            />{' '}
            Leads
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)', minHeight: 18 }}>
          {hover ? (
            <span>
              <strong>{hover.date}</strong> — {fmtMoney(hover.spend, currency)} / {fmtInt(hover.leads)} leads
            </span>
          ) : (
            <span>Hover to inspect a day</span>
          )}
        </div>
      </div>
    </div>
  );
}
