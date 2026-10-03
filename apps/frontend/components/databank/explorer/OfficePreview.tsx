'use client';

/**
 * In-browser preview for modern Office files, used by the databank explorer's
 * PreviewModal. The rendering libraries (docx-preview, SheetJS) are loaded via
 * dynamic import() so they are code-split out of the main bundle and fetched
 * only the first time someone previews an Office file.
 *
 * PRIVACY: the document bytes are fetched client-side from the short-lived
 * signed URL and parsed locally — nothing is ever sent to a third-party viewer
 * (Microsoft/Google). SECURITY: the .xlsx grid is rendered as a React table
 * (text nodes are auto-escaped), and .docx hyperlinks using the javascript:
 * scheme — the only active-content vector in OOXML — are neutralized after render.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, Download, FileText } from 'lucide-react';

const muted = 'var(--sos-text-muted, #64748b)';
const primary = 'var(--sos-text-primary, #0f172a)';
const accent = 'var(--sos-accent, #b8860b)';
const surfaceSolid = 'var(--sos-surface-solid, #fff)';
const border = '1px solid var(--sos-border, rgba(148,163,184,0.25))';

/** Bare GET so it stays a CORS "simple request" (no preflight) — the signed URL
 *  carries its own auth in the query string; adding headers would break it. */
async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the file (${res.status}).`);
  return res.arrayBuffer();
}

const downloadBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  margin: '12px auto 0',
  border,
  borderRadius: 8,
  background: 'transparent',
  color: primary,
  fontSize: 12.5,
  fontWeight: 600,
  padding: '7px 14px',
  cursor: 'pointer',
};

function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: muted, fontSize: 13, padding: 24 }}>
      <Loader2 size={16} className="animate-spin" /> Loading preview…
    </div>
  );
}

function Fallback({ onDownload, msg }: { onDownload: () => void; msg: string }) {
  return (
    <div style={{ textAlign: 'center', color: muted, padding: 24 }}>
      <FileText size={30} />
      <div style={{ marginTop: 8, fontSize: 13 }}>{msg}</div>
      <button type="button" onClick={onDownload} style={downloadBtn}>
        <Download size={14} /> Download to open
      </button>
    </div>
  );
}

export function DocxView({ url, onDownload }: { url: string; onDownload: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    void (async () => {
      try {
        const [{ renderAsync }, buf] = await Promise.all([import('docx-preview'), fetchBytes(url)]);
        if (cancelled || !host) return;
        host.innerHTML = '';
        await renderAsync(buf, host, undefined, {
          inWrapper: true,
          ignoreLastRenderedPageBreak: true,
          className: 'dbx-docx',
        });
        if (cancelled) return;
        // Neutralize javascript: links; make the rest open safely in a new tab.
        host.querySelectorAll('a[href]').forEach((a) => {
          const href = a.getAttribute('href') ?? '';
          if (/^\s*javascript:/i.test(href)) a.removeAttribute('href');
          else {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
          }
        });
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'auto', background: '#f1f5f9' }}>
      {status === 'loading' ? <Spinner /> : null}
      {status === 'error' ? <Fallback onDownload={onDownload} msg="Couldn’t render this document — download it to open." /> : null}
      <div ref={hostRef} style={{ display: status === 'ready' ? 'block' : 'none', padding: 16 }} />
    </div>
  );
}

const tabBtn: React.CSSProperties = {
  border,
  borderRadius: 7,
  background: 'transparent',
  color: muted,
  fontSize: 12,
  fontWeight: 600,
  padding: '5px 10px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
const tabActive: React.CSSProperties = { color: '#fff', background: accent, borderColor: accent };

export function XlsxView({ url, onDownload }: { url: string; onDownload: () => void }) {
  const [sheets, setSheets] = useState<{ name: string; rows: unknown[][] }[] | null>(null);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [XLSX, buf] = await Promise.all([import('xlsx'), fetchBytes(url)]);
        if (cancelled) return;
        const wb = XLSX.read(buf, { type: 'array' });
        const parsed = wb.SheetNames.map((name) => ({
          name,
          rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: '' }) as unknown[][],
        }));
        if (cancelled) return;
        setSheets(parsed);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (status === 'loading') return <Spinner />;
  if (status === 'error' || !sheets) {
    return <Fallback onDownload={onDownload} msg="Couldn’t render this spreadsheet — download it to open." />;
  }

  const rows = sheets[active]?.rows ?? [];
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: surfaceSolid }}>
      {sheets.length > 1 ? (
        <div style={{ display: 'flex', gap: 4, padding: 8, borderBottom: border, overflowX: 'auto', flexShrink: 0 }}>
          {sheets.map((s, i) => (
            <button key={`${s.name}-${i}`} type="button" onClick={() => setActive(i)} style={{ ...tabBtn, ...(i === active ? tabActive : null) }}>
              {s.name || `Sheet ${i + 1}`}
            </button>
          ))}
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12.5, color: primary }}>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {(Array.isArray(r) ? r : []).map((c, ci) => (
                  <td
                    key={ci}
                    style={{
                      border,
                      padding: '4px 8px',
                      whiteSpace: 'nowrap',
                      background: ri === 0 ? 'var(--sos-surface, #f8fafc)' : undefined,
                      fontWeight: ri === 0 ? 600 : 400,
                    }}
                  >
                    {c === null || c === undefined ? '' : String(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
