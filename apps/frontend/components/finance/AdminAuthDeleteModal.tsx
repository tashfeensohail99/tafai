'use client';

/**
 * Step-up admin authentication modal for destructive finance actions.
 *
 * The finance user clicks Delete on a record. This modal opens and
 * asks for an admin's email + password + reason. The admin walks over,
 * types their credentials live — the modal sends them straight to the
 * backend, which bcrypt-verifies the admin against UserAccount and
 * only proceeds if the matched account is ACTIVE and holds an admin
 * role.
 *
 * Reusable: pass an `onConfirm({ adminEmail, adminPassword, reason })`
 * that returns a Promise. The modal handles the loading + error UX +
 * closing on success. Parent owns the actual API call so this stays
 * decoupled from any one endpoint shape.
 */

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import {
  Field,
  FormInput,
  FormTextarea,
  GhostButton,
  PrimaryButton,
} from '@/components/sales-v2/ui';
import { Modal } from '@/components/whatsapp/Modal';

export interface AdminAuthDeleteSubmit {
  adminEmail: string;
  adminPassword: string;
  reason: string;
}

export function AdminAuthDeleteModal(props: {
  open: boolean;
  onClose: () => void;
  /** Title shown in the modal header. */
  title?: string;
  /** Sub-headline shown above the form — describe what's being deleted. */
  subject?: string;
  /** Called with the admin credentials + reason when the operator confirms.
   *  Should throw / reject on backend failure so this modal can surface the
   *  error inline. */
  onConfirm: (values: AdminAuthDeleteSubmit) => Promise<void>;
}) {
  const { open, onClose, title, subject, onConfirm } = props;

  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [reason, setReason] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time the modal opens — never persist credentials in
  // local state across opens/closes for any longer than necessary.
  useEffect(() => {
    if (!open) return;
    setAdminEmail('');
    setAdminPassword('');
    setReason('');
    setShowPassword(false);
    setError(null);
    setSubmitting(false);
  }, [open]);

  /**
   * Per-field validation. The previous single-error pattern was
   * collapsing three different problems ("missing email" / "weak
   * password" / "no reason") into one ambiguous message, which sent
   * operators chasing the wrong field. Now we surface the FIRST
   * specific failure so the user knows exactly what to fix.
   */
  async function handleConfirm() {
    const trimmedEmail = adminEmail.trim();
    const trimmedReason = reason.trim();

    if (!trimmedEmail) {
      setError('Admin email is required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Admin email looks malformed — double-check before submitting.');
      return;
    }
    if (!adminPassword) {
      setError('Admin password is required.');
      return;
    }
    if (adminPassword.length < 8) {
      setError('Admin password must be at least 8 characters.');
      return;
    }
    if (!trimmedReason) {
      setError(
        'Reason for deletion is required — the grey text in the box is just a placeholder. Type your own reason.',
      );
      return;
    }
    if (trimmedReason.length < 5) {
      setError(
        `Reason must be at least 5 characters (you have ${trimmedReason.length}). Be specific so the audit trail is meaningful.`,
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({
        adminEmail: trimmedEmail,
        adminPassword,
        reason: trimmedReason,
      });
      // Parent handles the close on success — but if they don't, fall
      // through and clear the form locally so the modal returns to a
      // clean state.
      setAdminPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deletion failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => (submitting ? undefined : onClose())}
      title={title ?? 'Delete with admin authorisation'}
      width={560}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={submitting}>
            Cancel
          </GhostButton>
          <PrimaryButton
            onClick={() => void handleConfirm()}
            disabled={submitting}
            iconLeft={
              submitting ? (
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <Trash2 size={14} />
              )
            }
          >
            {submitting ? 'Authorising…' : 'Authorise & delete'}
          </PrimaryButton>
        </>
      }
    >
      {/* Subject line — describe exactly what's about to be deleted so the
          admin standing at the desk knows what they're authorising. */}
      {subject ? (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--sos-radius-sm)',
            background: 'var(--sos-status-warning-soft)',
            border: '1px solid var(--sos-status-warning)',
            color: 'var(--sos-text-primary)',
            fontSize: 13,
            marginBottom: 14,
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
          }}
        >
          <ShieldAlert size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>About to delete:</strong> {subject}
          </div>
        </div>
      ) : null}

      <div className="sos-text-secondary" style={{ fontSize: 'var(--sos-text-sm)' }}>
        An admin must type their credentials below to authorise this
        deletion. Both you (the finance officer initiating) and the
        authorising admin will be recorded on the audit log and the
        lead&apos;s timeline along with the reason.
      </div>

      <div
        style={{
          marginTop: 16,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
        }}
      >
        <Field label="Admin email" required>
          <FormInput
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            type="email"
            autoComplete="off"
            placeholder="admin@tashfeen.com"
          />
        </Field>
        <Field label="Admin password" required>
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              className="sos-input"
              autoComplete="off"
              placeholder="••••••••"
              style={{ width: '100%', paddingRight: 40 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--sos-text-faint)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 4,
              }}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>
      </div>

      <div style={{ marginTop: 12 }}>
        <Field
          label="Reason for deletion"
          required
          hint={
            reason.trim().length === 0
              ? 'Type the reason here — at least 5 characters. The audit log and the lead timeline both record it.'
              : reason.trim().length < 5
                ? `${5 - reason.trim().length} more character${5 - reason.trim().length === 1 ? '' : 's'} needed.`
                : `${reason.trim().length} characters · audit trail will capture this verbatim.`
          }
        >
          <FormTextarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Type your reason here…"
          />
        </Field>
      </div>

      {error ? (
        <div
          className="sos-banner sos-banner--danger"
          style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      ) : null}
    </Modal>
  );
}
