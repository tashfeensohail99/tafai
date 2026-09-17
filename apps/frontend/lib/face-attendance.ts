// Admin API for the NVR face-capture review list — the evidence behind each punch.
import { apiFetch, apiFetchBlob } from './api-client';

export type FaceCaptureStatus = 'PENDING' | 'MATCHED' | 'UNMATCHED' | 'DUPLICATE' | 'ERROR';

export interface FaceCapture {
  id: string;
  channelId: string | null;
  status: FaceCaptureStatus;
  /** Cosine similarity of the best match, 3dp. Null until the capture is processed. */
  similarity: number | null;
  capturedAt: string;
  /** Null unless status is MATCHED. */
  employeeName: string | null;
  hasImage: boolean;
}

export function fetchFaceCaptures(limit = 60, matchedOnly = false): Promise<FaceCapture[]> {
  const qs = `?limit=${limit}${matchedOnly ? '&matchedOnly=true' : ''}`;
  return apiFetch<FaceCapture[]>(`/attendance/face/events${qs}`, { cache: 'no-store' });
}

/**
 * The stored JPEG for one capture. The media bucket is private, so the backend
 * proxies the bytes behind the same permission as the list — which means a plain
 * <img src> would 401. Fetch as a blob and hand back an object URL instead.
 * Callers own the URL and must revokeObjectURL it.
 */
export async function fetchFaceCaptureImageUrl(id: string): Promise<string> {
  const blob = await apiFetchBlob(`/attendance/face/events/${id}/image`);
  return URL.createObjectURL(blob);
}

export interface EnrolledEmployee {
  employeeId: string;
  name: string;
  code: string | null;
  /** 0 means this employee can never be matched — they have no face samples. */
  samples: number;
}

export function fetchEnrolledEmployees(): Promise<EnrolledEmployee[]> {
  return apiFetch<EnrolledEmployee[]>('/attendance/face/enrolled', { cache: 'no-store' });
}
