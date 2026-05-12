'use client';

import { getAccessToken } from './auth-client';

/**
 * Trigger a CSV download from a protected backend endpoint. Adds the JWT,
 * pulls the blob, and asks the browser to save it under the filename the
 * server sent (falling back to the supplied default).
 */
export async function downloadCsv(path: string, fallbackFilename: string): Promise<void> {
  const token = getAccessToken();
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const res = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Export failed (${res.status})`);
  }
  // Prefer the server-sent filename from Content-Disposition.
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match ? match[1] : fallbackFilename;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
