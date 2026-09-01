'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export type CaseTab = { key: string; label: string; Icon: React.ElementType };

/**
 * Horizontally-scrollable tab strip for the processing case workspace. There are
 * ~12 tabs (Milestones … Corrections … Submissions) which overflow on normal
 * laptop widths — the raw `overflow-x:auto` we had before scrolled, but gave the
 * user no signal it could AND is painful to drive with a mouse. This adds:
 *   - left/right chevron buttons that appear only when there's more that way and
 *     nudge the strip on click,
 *   - fade masks on the overflowing edge(s) so it reads as "there's more",
 *   - vertical mouse-wheel → horizontal scroll (a plain wheel can drive it),
 *   - auto-reveal of the active tab (e.g. opening Finance from the meta bar
 *     scrolls it into view) WITHOUT ever scrolling the page vertically.
 * Styling mirrors the previous inline bar exactly, so the tabs look unchanged.
 */
export function CaseTabBar({
  tabs,
  activeKey,
  onSelect,
  badgeFor,
}: {
  tabs: CaseTab[];
  activeKey: string;
  onSelect: (key: string) => void;
  badgeFor?: (key: string) => number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const firstRun = useRef(true);
  const [overflow, setOverflow] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  const recompute = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setOverflow((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  // Recompute affordances on mount, tab-count change, container resize AND
  // content-width change (ResizeObserver on both the scroller and its row).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild as Element);
    window.addEventListener('resize', recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, [recompute, tabs.length]);

  // Vertical wheel → horizontal scroll. Native non-passive listener so we can
  // preventDefault (React's onWheel is passive and can't). Only hijacks the
  // wheel when the strip actually overflows and the gesture is vertical.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keep the active tab in view. Adjusts ONLY the strip's horizontal scroll (via
  // rects, never scrollIntoView) so it never yanks the page vertically.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const btn = el.querySelector<HTMLElement>(`[data-tabkey="${CSS.escape(activeKey)}"]`);
    if (!btn) return;
    const c = el.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    let delta = 0;
    if (b.left < c.left + 8) delta = b.left - c.left - 8;
    else if (b.right > c.right - 8) delta = b.right - c.right + 8;
    if (delta !== 0) {
      el.scrollTo({ left: el.scrollLeft + delta, behavior: firstRun.current ? 'auto' : 'smooth' });
    }
    firstRun.current = false;
  }, [activeKey]);

  const nudge = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' });
  };

  const arrowStyle = (side: 'left' | 'right'): React.CSSProperties => ({
    position: 'absolute',
    [side]: '3px',
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    border: '1px solid var(--sos-border)',
    background: 'var(--sos-surface-1)',
    color: 'var(--sos-text-primary)',
    cursor: 'pointer',
    boxShadow: 'var(--sos-shadow-sm)',
    zIndex: 3,
    padding: 0,
  });

  const fadeStyle = (side: 'left' | 'right'): React.CSSProperties => ({
    position: 'absolute',
    [side]: 0,
    top: 0,
    bottom: 0,
    width: '44px',
    pointerEvents: 'none',
    zIndex: 2,
    borderRadius: side === 'left' ? 'var(--sos-radius-md) 0 0 var(--sos-radius-md)' : '0 var(--sos-radius-md) var(--sos-radius-md) 0',
    background: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, var(--sos-surface-2), transparent)`,
  });

  return (
    <div style={{ position: 'relative', marginBottom: '12px' }}>
      {/* Hide the native scrollbar — the arrows + fades are the affordance. */}
      <style>{`.case-tabbar-scroll::-webkit-scrollbar{display:none}`}</style>
      <div
        ref={scrollRef}
        className="case-tabbar-scroll"
        onScroll={recompute}
        role="tablist"
        style={{
          display: 'flex',
          gap: '2px',
          padding: '4px',
          background: 'var(--sos-surface-2)',
          borderRadius: 'var(--sos-radius-md)',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          scrollBehavior: 'smooth',
        }}
      >
        {tabs.map((tab) => {
          const Icon = tab.Icon;
          const isActive = activeKey === tab.key;
          const newCount = isActive ? 0 : badgeFor?.(tab.key) ?? 0;
          return (
            <button
              key={tab.key}
              data-tabkey={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(tab.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 14px',
                borderRadius: 'calc(var(--sos-radius-md) - 2px)',
                border: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-muted)',
                background: isActive ? 'var(--sos-brand-primary-soft)' : 'transparent',
                transition: 'all 150ms',
                whiteSpace: 'nowrap',
                flex: '0 0 auto',
              }}
            >
              <Icon size={13} />
              {tab.label}
              {newCount > 0 ? (
                <span
                  aria-label={`${newCount} new`}
                  title={`${newCount} new since you last looked`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: '16px',
                    height: '16px',
                    padding: '0 5px',
                    marginLeft: '1px',
                    borderRadius: '8px',
                    fontSize: '10px',
                    fontWeight: 700,
                    lineHeight: 1,
                    color: '#fff',
                    background: 'var(--sos-status-danger)',
                  }}
                >
                  {newCount > 99 ? '99+' : newCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {overflow.left && (
        <>
          <div aria-hidden style={fadeStyle('left')} />
          <button type="button" aria-label="Scroll tabs left" onClick={() => nudge(-1)} style={arrowStyle('left')}>
            <ChevronLeft size={16} />
          </button>
        </>
      )}
      {overflow.right && (
        <>
          <div aria-hidden style={fadeStyle('right')} />
          <button type="button" aria-label="Scroll tabs right" onClick={() => nudge(1)} style={arrowStyle('right')}>
            <ChevronRight size={16} />
          </button>
        </>
      )}
    </div>
  );
}
