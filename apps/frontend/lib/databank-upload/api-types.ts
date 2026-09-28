/**
 * Wire types of the resumable-upload API (backend: databank-upload.service.ts,
 * docs/databank-phase1-resumable-uploads.md). Dates arrive as ISO strings and
 * BigInt sizes as JSON numbers. Kept in one place so the engine and the HTTP
 * transport agree with the server.
 */

export interface InitUploadFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  lastModified?: number;
  relativePath?: string;
  /** Lower-case hex SHA-256 of the whole file. */
  sha256: string;
  /** Upload even though the databank already holds this content. */
  allowDuplicate?: boolean;
  folderId?: string | null;
}

export interface PartUrl {
  partNumber: number;
  url: string;
  headers?: Record<string, string>;
}

export interface ExistingFile {
  id: string;
  fileName: string;
  folderId: string | null;
  folderName: string | null;
  createdAt: string;
}

export type InitResult =
  | {
      index: number;
      status: 'upload';
      uploadId: string;
      strategy: 'SINGLE' | 'MULTIPART';
      /** Byte length of every part except the last (SINGLE: the whole file). */
      partSize: number;
      /** SINGLE uploads are presented as one part. */
      partCount: number;
      /** Parts storage already holds — never re-sent. */
      doneParts: number[];
      urls: PartUrl[];
      urlsExpireAt: string;
      resumed: boolean;
      sessionExpiresAt: string;
    }
  | { index: number; status: 'already-uploaded' | 'duplicate' | 'possible-duplicate'; existing: ExistingFile }
  | { index: number; status: 'in-progress'; uploadId: string }
  | { index: number; status: 'retry'; reason: string }
  | { index: number; status: 'rejected'; reason: string };

/** `proxy` = dev storage without direct uploads: use the legacy streaming path. */
export type InitResponse = { mode: 'proxy' } | { mode: 'direct'; maxBytes: number; results: InitResult[] };

export interface SignPartsResponse {
  parts: PartUrl[];
  urlsExpireAt: string;
}

export type CompleteResult =
  | { id: string; status: 'completed'; file: unknown; relocated?: boolean }
  | { id: string; status: 'in-progress' }
  | { id: string; status: 'missing-parts'; missingParts: number[] }
  | { id: string; status: 'failed'; reason: string }
  | { id: string; status: 'expired' }
  | { id: string; status: 'retry'; reason: string }
  | { id: string; status: 'not-found' };

export interface CompleteResponse {
  results: CompleteResult[];
}

/** Limits the server enforces per request (databank-upload.dto.ts). */
export const MAX_INIT_FILES = 50;
export const MAX_SIGN_PARTS = 100;
export const MAX_COMPLETE_IDS = 50;
