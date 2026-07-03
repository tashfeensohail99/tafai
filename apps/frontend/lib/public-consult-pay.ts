/**
 * Public (unauthenticated) API for the "scan the desk QR and upload your
 * consultation receipt" page. Talks straight to the backend's token-gated
 * /public/consult-pay endpoints — NO auth token is sent. Kept separate from the
 * authed api-client so the public page never pulls in session/refresh logic.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface ConsultPayInfo {
  status: 'AWAITING_PROOF' | 'PENDING_REVIEW' | 'VERIFYING' | 'VERIFIED' | 'REJECTED';
  amount: number;
  currency: string;
  hasProof: boolean;
  bank: { name: string | null; title: string | null; iban: string | null };
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    const m = body?.message;
    return Array.isArray(m) ? m.join(', ') : m || fallback;
  } catch {
    return fallback;
  }
}

export async function getConsultPayInfo(token: string): Promise<ConsultPayInfo> {
  const res = await fetch(`${API_BASE}/public/consult-pay/${encodeURIComponent(token)}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(await readError(res, 'This link is invalid or has expired.'));
  return res.json() as Promise<ConsultPayInfo>;
}

export async function uploadConsultProof(token: string, file: File): Promise<{ ok: boolean }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API_BASE}/public/consult-pay/${encodeURIComponent(token)}/upload`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) throw new Error(await readError(res, 'Upload failed. Please try again.'));
  return res.json() as Promise<{ ok: boolean }>;
}
