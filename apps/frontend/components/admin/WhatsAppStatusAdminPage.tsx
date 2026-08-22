'use client';

/**
 * Admin WhatsApp Status composer + list. Employees prepare an image/video +
 * caption in the CRM, save as draft, schedule for later, or mark posted now.
 * Because Meta doesn't expose a WhatsApp Status API, actual posting always
 * happens on the employee's own phone — the CRM prepares + tracks; the
 * employee taps through in WhatsApp Business and returns to mark it posted.
 *
 * MVP is gated to a small email allowlist (backend env
 * STATUS_FEATURE_EMAILS). Any user outside that list sees a friendly
 * "not enabled" panel and no data. When we're ready to roll wider, swap the
 * allowlist for a real permission — no page changes needed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Calendar,
  Check,
  Clock,
  Edit3,
  FileImage,
  Film,
  Loader2,
  MessageSquare,
  PhoneCall,
  Play,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  createStatus,
  deleteStatus,
  getStatusAccess,
  listStatuses,
  markStatusPosted,
  patchStatus,
  type WhatsAppStatusItem,
  type WhatsAppStatusState,
} from '@/lib/whatsapp-status';

type Filter = 'ALL' | WhatsAppStatusState;

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'DRAFT', label: 'Draft' },
  { key: 'SCHEDULED', label: 'Scheduled' },
  { key: 'POSTED', label: 'Posted' },
  { key: 'EXPIRED', label: 'Expired' },
];

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

interface WhatsAppStatusAdminPageProps {
  /**
   * Hide the "Chats / Calls / Status" sub-nav bar. The sub-nav's Chats/Calls
   * links point at /admin routes, so on the sales portal (where reps don't
   * have admin access) we suppress it entirely.
   */
  hideSubNav?: boolean;
}

export function WhatsAppStatusAdminPage(props: WhatsAppStatusAdminPageProps = {}) {
  const [access, setAccess] = useState<'checking' | 'enabled' | 'denied'>('checking');
  const [items, setItems] = useState<WhatsAppStatusItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 400);

  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { enabled } = await getStatusAccess();
        setAccess(enabled ? 'enabled' : 'denied');
      } catch {
        setAccess('denied');
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (access !== 'enabled') return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listStatuses({
        ...(filter !== 'ALL' ? { state: filter } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      });
      setItems(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load statuses');
    } finally {
      setLoading(false);
    }
  }, [access, filter, debouncedSearch]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const handlePickFile = () => fileInputRef.current?.click();
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_UPLOAD_BYTES) {
      setError(`File too large (${formatSize(f.size)}). Max ${formatSize(MAX_UPLOAD_BYTES)}.`);
      return;
    }
    setError(null);
    setFile(f);
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFilePreview(URL.createObjectURL(f));
  };
  const clearComposer = () => {
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFile(null);
    setFilePreview(null);
    setCaption('');
    setScheduledAt('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const submit = async (initialState: 'DRAFT' | 'SCHEDULED' | 'POSTED') => {
    if (!file) { setError('Pick an image or video first'); return; }
    if (initialState === 'SCHEDULED' && !scheduledAt) {
      setError('Choose a schedule time');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await createStatus({
        file,
        filename: file.name,
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        initialState,
        ...(initialState === 'SCHEDULED' && scheduledAt
          ? { scheduledAt: new Date(scheduledAt) }
          : {}),
      });
      clearComposer();
      const partsSuffix = created.length > 1 ? ` — split into ${created.length} parts` : '';
      setNotice(
        initialState === 'DRAFT' ? `Saved as draft${partsSuffix}`
          : initialState === 'SCHEDULED' ? `Scheduled${partsSuffix}`
            : `Posted${partsSuffix} — remember to publish on your phone`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create status');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkPosted = async (id: string) => {
    try {
      await markStatusPosted(id);
      setNotice('Marked as posted');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this status?')) return;
    try {
      await deleteStatus(id);
      setNotice('Deleted');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };
  const handleReschedule = async (id: string, newAt: string) => {
    try {
      await patchStatus(id, { state: 'SCHEDULED', scheduledAt: new Date(newAt) });
      setNotice('Rescheduled');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      {!props.hideSubNav && <SubNav active="status" />}

      {access === 'checking' && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Checking access…
        </div>
      )}

      {access === 'denied' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          <p className="font-semibold">Status feature is not enabled for your account.</p>
          <p className="mt-1 text-amber-800">
            This is a pilot — ask an admin to add your email to <code>STATUS_FEATURE_EMAILS</code>.
          </p>
        </div>
      )}

      {access === 'enabled' && (
        <>
          <ComposerCard
            file={file}
            filePreview={filePreview}
            caption={caption}
            scheduledAt={scheduledAt}
            submitting={submitting}
            onPickFile={handlePickFile}
            onCaptionChange={setCaption}
            onScheduledAtChange={setScheduledAt}
            onSubmit={submit}
            onClear={clearComposer}
            fileInputRef={fileInputRef}
            onFileChange={handleFileChange}
          />

          {notice && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
              {notice}
            </div>
          )}
          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-3 py-1 text-sm ${
                  filter === f.key
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            ))}
            <div className="ml-auto">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search captions…"
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {loading && items.length === 0 && (
              <div className="col-span-full flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            )}
            {!loading && items.length === 0 && (
              <div className="col-span-full rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                No statuses yet in this view. Upload an image or video above to get started.
              </div>
            )}
            {items.map((it) => (
              <StatusCard
                key={it.id}
                item={it}
                onMarkPosted={() => void handleMarkPosted(it.id)}
                onDelete={() => void handleDelete(it.id)}
                onReschedule={(newAt) => void handleReschedule(it.id, newAt)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Sub-nav ──────────────────────────────────────────────────────────────────

function SubNav({ active }: { active: 'chats' | 'calls' | 'status' }) {
  const tabs: Array<{ key: 'chats' | 'calls' | 'status'; label: string; href: string; icon: typeof MessageSquare }> = [
    { key: 'chats', label: 'Chats', href: '/admin/whatsapp', icon: MessageSquare },
    { key: 'calls', label: 'Calls', href: '/admin/calls', icon: PhoneCall },
    { key: 'status', label: 'Status', href: '/admin/whatsapp/status', icon: Play },
  ];
  return (
    <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
              isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Icon className="h-4 w-4" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────────

function ComposerCard(props: {
  file: File | null;
  filePreview: string | null;
  caption: string;
  scheduledAt: string;
  submitting: boolean;
  onPickFile: () => void;
  onCaptionChange: (v: string) => void;
  onScheduledAtChange: (v: string) => void;
  onSubmit: (initialState: 'DRAFT' | 'SCHEDULED' | 'POSTED') => void;
  onClear: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const isVideo = props.file?.type.startsWith('video/');
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">New Status</h2>
        <p className="text-xs text-slate-500">
          Draft, schedule, or post now. Publishing to WhatsApp Status still happens on your phone.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[220px,1fr]">
        <div>
          <div
            onClick={props.onPickFile}
            className="flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 hover:border-slate-400"
          >
            {props.filePreview ? (
              isVideo ? (
                <video src={props.filePreview} className="h-full w-full object-cover" muted />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={props.filePreview} alt="preview" className="h-full w-full object-cover" />
              )
            ) : (
              <div className="flex flex-col items-center gap-2 text-slate-400">
                <Upload className="h-8 w-8" />
                <span className="text-xs">Click to upload image or video</span>
              </div>
            )}
          </div>
          {props.file && (
            <p className="mt-2 truncate text-xs text-slate-500">
              {props.file.name} · {formatSize(props.file.size)}
            </p>
          )}
          <p className="mt-2 text-[11px] leading-snug text-slate-400">
            Videos over 30 s are split into multiple Status posts automatically. Videos over ~18 MB are compressed to fit WhatsApp&apos;s 16 MB cap.
          </p>
          <input
            ref={props.fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,video/3gpp"
            className="hidden"
            onChange={props.onFileChange}
          />
        </div>

        <div className="flex flex-col gap-3">
          <textarea
            value={props.caption}
            onChange={(e) => props.onCaptionChange(e.target.value)}
            placeholder="Add a caption (optional)…"
            className="min-h-[100px] rounded-md border border-slate-200 bg-white p-3 text-sm placeholder:text-slate-400"
          />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <Calendar className="h-4 w-4 text-slate-500" />
            Schedule for
            <input
              type="datetime-local"
              value={props.scheduledAt}
              onChange={(e) => props.onScheduledAtChange(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
            />
            <span className="text-xs text-slate-400">(optional)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={!props.file || props.submitting}
              onClick={() => props.onSubmit('DRAFT')}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Save Draft
            </button>
            <button
              disabled={!props.file || !props.scheduledAt || props.submitting}
              onClick={() => props.onSubmit('SCHEDULED')}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Schedule
            </button>
            <button
              disabled={!props.file || props.submitting}
              onClick={() => props.onSubmit('POSTED')}
              className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {props.submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Post Now
            </button>
            {props.file && (
              <button
                onClick={props.onClear}
                className="ml-auto rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Status card ──────────────────────────────────────────────────────────────

function StatusCard(props: {
  item: WhatsAppStatusItem;
  onMarkPosted: () => void;
  onDelete: () => void;
  onReschedule: (newAt: string) => void;
}) {
  const { item } = props;
  const [rescheduling, setRescheduling] = useState(false);
  const [newAt, setNewAt] = useState('');

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="aspect-square overflow-hidden bg-slate-100">
        {item.mediaType === 'VIDEO' ? (
          <video src={item.mediaUrl} controls className="h-full w-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.mediaUrl} alt="status" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <StateBadge state={item.state} />
          <span className="text-xs text-slate-400">
            {item.mediaType === 'VIDEO' ? <Film className="inline h-3.5 w-3.5" /> : <FileImage className="inline h-3.5 w-3.5" />}
            {' '}
            {formatSize(item.mediaSizeBytes)}
          </span>
        </div>
        {item.caption && (
          <p className="line-clamp-3 text-sm text-slate-700">{item.caption}</p>
        )}
        <p className="text-xs text-slate-500">
          {timelineLine(item)}
        </p>
        {rescheduling ? (
          <div className="mt-1 flex items-center gap-2">
            <input
              type="datetime-local"
              value={newAt}
              onChange={(e) => setNewAt(e.target.value)}
              className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs"
            />
            <button
              disabled={!newAt}
              onClick={() => { props.onReschedule(newAt); setRescheduling(false); }}
              className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
            >Save</button>
            <button
              onClick={() => setRescheduling(false)}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
            >Cancel</button>
          </div>
        ) : (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
            {(item.state === 'DRAFT' || item.state === 'SCHEDULED') && (
              <button
                onClick={props.onMarkPosted}
                className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800"
                title="Publish it to WhatsApp Status on your phone first, then tap this"
              >
                <Check className="h-3.5 w-3.5" />
                Mark as Posted
              </button>
            )}
            {(item.state === 'DRAFT' || item.state === 'SCHEDULED') && (
              <a
                href={item.mediaUrl}
                target="_blank"
                rel="noreferrer"
                download
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                title="Download the media so you can share it to WhatsApp Status"
              >
                <Send className="h-3.5 w-3.5" />
                Download to Post
              </a>
            )}
            {item.state === 'DRAFT' && (
              <button
                onClick={() => setRescheduling(true)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Calendar className="h-3.5 w-3.5" />
                Schedule
              </button>
            )}
            {item.state === 'SCHEDULED' && (
              <button
                onClick={() => setRescheduling(true)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Edit3 className="h-3.5 w-3.5" />
                Reschedule
              </button>
            )}
            <button
              onClick={props.onDelete}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: WhatsAppStatusState }) {
  const cls = state === 'DRAFT' ? 'bg-slate-100 text-slate-700'
    : state === 'SCHEDULED' ? 'bg-amber-100 text-amber-800'
      : state === 'POSTED' ? 'bg-emerald-100 text-emerald-800'
        : state === 'EXPIRED' ? 'bg-slate-100 text-slate-500'
          : 'bg-rose-100 text-rose-800';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {state === 'SCHEDULED' && <Clock className="h-3 w-3" />}
      {state === 'POSTED' && <Check className="h-3 w-3" />}
      {state.charAt(0) + state.slice(1).toLowerCase()}
    </span>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function timelineLine(item: WhatsAppStatusItem): string {
  if (item.state === 'POSTED') {
    const posted = new Date(item.postedAt ?? item.createdAt);
    const exp = item.expiresAt ? new Date(item.expiresAt) : null;
    const now = new Date();
    if (exp && exp.getTime() > now.getTime()) {
      return `Posted ${formatWhen(posted)} · expires in ${formatRelative(exp, now)}`;
    }
    return `Posted ${formatWhen(posted)}`;
  }
  if (item.state === 'SCHEDULED' && item.scheduledAt) {
    const at = new Date(item.scheduledAt);
    const now = new Date();
    const label = at.getTime() > now.getTime()
      ? `Scheduled ${formatWhen(at)} (in ${formatRelative(at, now)})`
      : `Was due ${formatWhen(at)}`;
    return label;
  }
  if (item.state === 'EXPIRED') {
    return `Expired ${item.expiresAt ? formatWhen(new Date(item.expiresAt)) : ''}`;
  }
  return `Draft · created ${formatWhen(new Date(item.createdAt))}`;
}

function formatWhen(d: Date): string {
  return d.toLocaleString('en-PK', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' });
}
function formatRelative(target: Date, from: Date): string {
  const diff = Math.abs(target.getTime() - from.getTime());
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function useDebouncedValue<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}
