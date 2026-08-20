import React, { type ReactNode } from 'react';

/** Two-letter initials from a name. */
export function initials(first: string, last: string): string {
  const a = (first || '').trim()[0] ?? '';
  const b = (last || '').trim()[0] ?? '';
  return (a + b).toUpperCase() || '?';
}

/** Deterministic avatar gradient from a name (stable per person). */
export function avatarGradient(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  const h2 = (h + 40) % 360;
  return `linear-gradient(135deg, hsl(${h} 58% 52%), hsl(${h2} 58% 44%))`;
}

/** Round avatar with initials. */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const [fn, ...rest] = name.trim().split(/\s+/);
  return (
    <div className="hr-av" style={{ width: size, height: size, fontSize: size < 36 ? 12.5 : 13, background: avatarGradient(name) }}>
      {initials(fn ?? '', rest.join(' '))}
    </div>
  );
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  return <span className={`hr-pill hr-pill--${tone}`}><i />{children}</span>;
}

/** Premium modal frame (scoped hr-console styling). */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="hr-overlay" onClick={onClose}>
      <div className="hr-modal" style={{ maxWidth: wide ? 640 : 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="hr-modal__head">
          <h2 className="hr-modal__title">{title}</h2>
          <button className="hr-iconbtn" onClick={onClose} aria-label="Close" style={{ color: 'var(--hr-muted)' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
