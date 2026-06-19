'use client';

/**
 * Admin "Blocked numbers" screen. Lists every currently-blocked WhatsApp
 * contact (Lead + Client) via listBlockedNumbers() and lets an admin unblock
 * each one in place. Gated on whatsapp.view_all_inboxes (read) and
 * whatsapp.block (the Unblock action), mirroring the shared block API contract.
 *
 * Unblock is keyed by the contact's backing thread (unblockContact takes a
 * threadId), so a row without a resolvable thread shows a disabled control.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldOff } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../shared/DataTable';
import { ErrorState } from '../shared/ErrorState';
import { LoadingState } from '../shared/LoadingState';
import { PageHeader } from '../shared/PageHeader';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { useAdminSession } from '../layout/AdminShell';
import { listBlockedNumbers, unblockContact, type BlockedNumber } from '@/lib/whatsapp';

export function BlockedNumbersPage() {
  const { user } = useAdminSession();
  const canView = user.permissions.includes('whatsapp.view_all_inboxes');
  const canBlock = user.permissions.includes('whatsapp.block');

  const [rows, setRows] = useState<BlockedNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listBlockedNumbers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load blocked numbers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canView) return;
    void load();
  }, [canView, load]);

  // Auto-clear the success notice.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const handleUnblock = useCallback(
    async (row: BlockedNumber) => {
      if (!row.threadId) return;
      setBusyId(row.contactId);
      try {
        await unblockContact(row.threadId);
        setNotice(`Unblocked ${row.name || row.phone}.`);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unblock failed');
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const columns: DataTableColumn<BlockedNumber>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--sos-text-primary)', fontWeight: 600 }}>
            {row.name || '—'}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              padding: '1px 6px',
              borderRadius: 4,
              background: 'var(--sos-surface-2)',
              color: 'var(--sos-text-muted)',
            }}
          >
            {row.contactType}
          </span>
        </span>
      ),
    },
    { key: 'phone', header: 'Phone', render: (row) => row.phone || '—' },
    {
      key: 'blockedReason',
      header: 'Reason',
      render: (row) => row.blockedReason || <span style={{ color: 'var(--sos-text-faint)' }}>—</span>,
    },
    {
      key: 'blockedAt',
      header: 'Blocked at',
      render: (row) => (row.blockedAt ? new Date(row.blockedAt).toLocaleString() : '—'),
    },
    { key: 'blockedByName', header: 'Blocked by', render: (row) => row.blockedByName || 'System' },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        canBlock ? (
          <button
            type="button"
            className="sos-btn sos-btn--ghost"
            disabled={busyId === row.contactId || !row.threadId}
            title={row.threadId ? 'Unblock this contact' : 'No conversation to unblock from'}
            onClick={() => void handleUnblock(row)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              fontSize: 12.5,
            }}
          >
            <ShieldOff size={13} />
            {busyId === row.contactId ? 'Unblocking…' : 'Unblock'}
          </button>
        ) : null,
    },
  ];

  if (!canView) return <PermissionDeniedState />;
  if (loading && rows.length === 0) return <LoadingState message="Loading blocked numbers…" />;
  if (error && rows.length === 0) {
    return <ErrorState message="Unable to load blocked numbers" details={error} onRetry={() => void load()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Blocked numbers"
        description="WhatsApp contacts (leads and clients) that have been blocked. Unblock to let their conversations return to the active inbox."
        actions={
          <Link
            href="/admin/whatsapp"
            className="sos-btn sos-btn--ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12.5 }}
          >
            <ArrowLeft size={13} />
            Back to inbox
          </Link>
        }
      />
      {notice ? (
        <div className="sos-banner sos-banner--success" style={{ fontSize: 13 }}>
          {notice}
        </div>
      ) : null}
      {error && rows.length > 0 ? (
        <div className="sos-banner sos-banner--danger" style={{ fontSize: 13 }}>
          {error}
        </div>
      ) : null}
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => `${row.contactType}:${row.contactId}`}
        emptyMessage="No blocked numbers."
      />
    </div>
  );
}
