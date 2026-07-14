'use client';

// Premium searchable country picker. A button shows the current selection;
// clicking opens a dark-glass dropdown with a search box + scrollable list of
// every country. Type to filter, click (or Enter) to pick, Esc / outside-click
// to close. Styled with the sos-* design tokens so it matches the rest of the
// sales UI.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, ChevronDown, Globe2, Search, X } from 'lucide-react';
import { ALL_COUNTRIES } from '@/lib/countries';

interface CountrySelectProps {
  value: string;
  onChange: (country: string) => void;
  placeholder?: string;
  /** Optional id for label association. */
  id?: string;
  /** Allow clearing back to empty. */
  clearable?: boolean;
}

export function CountrySelect({
  value,
  onChange,
  placeholder = 'Search all countries…',
  id,
  clearable = true,
}: CountrySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_COUNTRIES;
    // Prefix matches first, then substring — so "uni" surfaces United Kingdom
    // / United States / United Arab Emirates at the top.
    const starts: string[] = [];
    const contains: string[] = [];
    for (const c of ALL_COUNTRIES) {
      const lc = c.toLowerCase();
      if (lc.startsWith(q)) starts.push(c);
      else if (lc.includes(q)) contains.push(c);
    }
    return [...starts, ...contains];
  }, [query]);

  // Close on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Focus the search field + reset highlight when opening.
  useEffect(() => {
    if (open) {
      setActiveIdx(0);
      // defer so the input is mounted
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery('');
    }
  }, [open]);

  const pick = (c: string) => {
    onChange(c);
    setOpen(false);
  };

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = filtered[activeIdx];
      if (c) pick(c);
    }
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', width: '100%' }}>
      {/* Trigger button */}
      <button
        type="button"
        id={id}
        onClick={() => setOpen((o) => !o)}
        className="sos-input"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <Globe2 size={15} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
        <span
          style={{
            flex: 1,
            color: value ? 'var(--sos-text-primary)' : 'var(--sos-text-faint)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {value || placeholder}
        </span>
        {value && clearable ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear country"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            style={{ display: 'flex', color: 'var(--sos-text-muted)', flexShrink: 0 }}
          >
            <X size={14} />
          </span>
        ) : (
          <ChevronDown size={15} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
        )}
      </button>

      {/* Dropdown */}
      {open ? (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 60,
            // OPAQUE popover surface. --sos-surface-2 is only ~4% opacity, so
            // the dropdown was see-through and the Priority pills / "Add finance
            // details" behind it bled through (looked like overlapping content).
            background: 'var(--sos-bg-elevated, #0a1530)',
            border: '1px solid var(--sos-border-subtle, rgba(255,255,255,0.10))',
            borderRadius: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            overflow: 'hidden',
          }}
        >
          {/* Search box */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderBottom: '1px solid var(--sos-divider, rgba(255,255,255,0.08))',
            }}
          >
            <Search size={14} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIdx(0);
              }}
              onKeyDown={onInputKeyDown}
              placeholder="Type a country…"
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--sos-text-primary)',
                fontSize: 14,
              }}
            />
          </div>

          {/* List */}
          <div
            ref={listRef}
            className="sos-scroll"
            style={{ maxHeight: 260, overflowY: 'auto', padding: 4 }}
          >
            {filtered.length === 0 ? (
              <div
                style={{
                  padding: '16px 12px',
                  textAlign: 'center',
                  color: 'var(--sos-text-muted)',
                  fontSize: 13,
                }}
              >
                No country matches “{query}”.
              </div>
            ) : (
              filtered.map((c, i) => {
                const selected = c === value;
                const active = i === activeIdx;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => pick(c)}
                    onMouseEnter={() => setActiveIdx(i)}
                    style={{
                      all: 'unset',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 13.5,
                      color: 'var(--sos-text-primary)',
                      background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                    }}
                  >
                    <span>{c}</span>
                    {selected ? (
                      <Check size={14} style={{ color: 'var(--sos-brand-primary-strong)' }} />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
