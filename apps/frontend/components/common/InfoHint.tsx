'use client';

import { useState, type CSSProperties } from 'react';
import { Info } from 'lucide-react';

export interface InfoHintItem {
  term: string;
  desc: string;
}

/**
 * A small ⓘ icon that reveals an explanatory tooltip on hover / focus / tap.
 * Used to document the inbox tabs and the Sales Overview metrics (Pending vs
 * Uncontacted, etc.). Self-contained — no external tooltip dependency, inline
 * dark-themed styles that suit both the admin (sales-v2) and the WhatsApp inbox.
 */
export function InfoHint({
  items,
  title,
  size = 14,
  align = 'left',
  width = 300,
}: {
  items: InfoHintItem[];
  title?: string;
  size?: number;
  align?: 'left' | 'right';
  width?: number;
}) {
  const [open, setOpen] = useState(false);

  const pop: CSSProperties = {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    zIndex: 60,
    width,
    padding: '10px 12px',
    borderRadius: 10,
    background: '#0f172a',
    color: '#e2e8f0',
    border: '1px solid rgba(148,163,184,0.28)',
    boxShadow: '0 10px 28px rgba(0,0,0,0.4)',
    fontSize: 12,
    lineHeight: 1.5,
    textAlign: 'left',
    whiteSpace: 'normal',
    cursor: 'default',
  };
  if (align === 'right') pop.right = 0;
  else pop.left = 0;

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', lineHeight: 0 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={title ?? 'What do these mean?'}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          margin: 0,
          cursor: 'help',
          display: 'inline-flex',
          color: 'inherit',
          opacity: 0.6,
        }}
      >
        <Info size={size} />
      </button>
      {open ? (
        <div role="tooltip" style={pop}>
          {title ? <div style={{ fontWeight: 600, marginBottom: 6, color: '#fff' }}>{title}</div> : null}
          {items.map((it) => (
            <div key={it.term} style={{ marginBottom: 4 }}>
              <strong style={{ color: '#fff' }}>{it.term}</strong> — {it.desc}
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
}
