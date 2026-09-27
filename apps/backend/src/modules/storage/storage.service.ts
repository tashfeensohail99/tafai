import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'crypto';

export interface UploadResult {
  key: string;
  bucket: string;
  sizeBytes: number;
  mimeType: string;
}

export interface PresignedUpload {
  /** 'direct-put' when the browser uploads STRAIGHT to storage (S3/R2); 'proxy'
   *  in dev storage modes (local/supabase) with no direct-PUT path — the caller
   *  then falls back to the streaming multipart upload endpoint. */
  strategy: 'direct-put' | 'proxy';
  /** The object key the file will live at (returned for both strategies so the
   *  caller can record the DB row after a direct PUT). */
  storageKey: string;
  /** direct-put only: the URL the browser PUTs the raw bytes to. */
  url?: string;
  /** direct-put only: headers the browser MUST send on the PUT so the request
   *  matches the signature (Content-Type, plus SSE when configured). */
  headers?: Record<string, string>;
}

type StorageMode = 'supabase' | 's3' | 'local';

/** True for S3/R2's "that multipart upload no longer exists" — it was
 *  completed, aborted, or auto-expired (R2 aborts after 7 days by default).
 *  Recognised by the SDK error name or the raw S3 error Code. */
export function isNoSuchUploadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: unknown; Code?: unknown };
  return e.name === 'NoSuchUpload' || e.Code === 'NoSuchUpload';
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly signedUrlExpires: number;
  private readonly uploadUrlExpires: number;
  private readonly serverSideEncryption?: 'AES256' | 'aws:kms';
  private bucketReady = false;
  private supabaseBucketReady = false;
  private readonly mode: StorageMode;
  private readonly supabaseUrl?: string;
  private readonly supabaseServiceKey?: string;

  constructor() {
    this.bucket = process.env.STORAGE_BUCKET ?? 'receipts';
    this.signedUrlExpires = parseInt(
      process.env.STORAGE_SIGNED_URL_EXPIRES_SECONDS ?? '300',
      10,
    );
    // Direct-upload PUT URLs must outlive a multi-GB upload on a slow line, so
    // they default to 6h (vs the 5-min read default). SigV4 allows up to 7 days.
    this.uploadUrlExpires = parseInt(
      process.env.STORAGE_UPLOAD_URL_EXPIRES_SECONDS ?? '21600',
      10,
    );
    this.serverSideEncryption = process.env.STORAGE_SERVER_SIDE_ENCRYPTION as 'AES256' | 'aws:kms' | undefined;

    // Mode priority: supabase > s3 > local
    if (process.env.SUPABASE_STORAGE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      this.mode = 'supabase';
      this.supabaseUrl = process.env.SUPABASE_STORAGE_URL;
      this.supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      this.logger.log('StorageService running in SUPABASE mode');
    } else if (process.env.STORAGE_ACCESS_KEY && process.env.STORAGE_SECRET_KEY) {
      this.mode = 's3';
      this.logger.log('StorageService running in S3 mode');
    } else {
      this.mode = 'local';
      this.logger.warn('StorageService running in LOCAL mode — files are not persisted.');
    }

    this.s3 = new S3Client({
      endpoint: process.env.STORAGE_ENDPOINT,
      region: process.env.STORAGE_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY ?? '',
        secretAccessKey: process.env.STORAGE_SECRET_KEY ?? '',
      },
      forcePathStyle: true,
      // Only add checksums when an operation REQUIRES one. Since aws-sdk-js-v3
      // 3.729 the default ('WHEN_SUPPORTED') bakes a CRC32 of an EMPTY body
      // (x-amz-checksum-crc32=AAAAAA==) into every presigned PutObject /
      // UploadPart URL; the browser then PUTs the real file, the checksum
      // doesn't match and R2 rejects the upload. Cloudflare's R2 docs recommend
      // WHEN_REQUIRED for aws-sdk-js-v3. This restores the pre-3.729 behaviour
      // for server-side uploads too (plain body + ContentLength), which R2
      // accepted for years.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async upload(
    buffer: Buffer,
    mimeType: string,
    folder: string,
    originalFilename?: string,
  ): Promise<UploadResult> {
    const ext = originalFilename?.split('.').pop() ?? 'bin';
    return this.uploadAt(`${folder}/${randomUUID()}.${ext}`, buffer, mimeType);
  }

  /**
   * Stream a file from a local path straight to storage WITHOUT buffering the
   * whole thing in memory. Used by the databank for large uploads (up to
   * 1 GB) — the request is written to a Multer temp file on disk, then this
   * streams it to R2 with a known ContentLength, so backend RAM stays flat
   * regardless of file size. The caller owns the temp file and deletes it after.
   */
  async uploadStreamFromFile(
    filePath: string,
    sizeBytes: number,
    mimeType: string,
    folder: string,
    originalFilename?: string,
  ): Promise<UploadResult> {
    const ext = originalFilename?.split('.').pop() ?? 'bin';
    const key = `${folder}/${randomUUID()}.${ext}`;

    if (this.mode === 'local') {
      this.logger.log(`[LOCAL] Skipped stream upload, stub key: ${key}`);
      return { key, bucket: this.bucket, sizeBytes, mimeType };
    }

    if (this.mode === 'supabase') {
      // Supabase (dev fallback) has no streaming path here — read the temp file
      // once. Prod uses S3/R2 (the streaming branch below).
      const buf = await readFile(filePath);
      return this.uploadAt(key, buf, mimeType);
    }

    await this.ensureBucketExists();
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(filePath),
        // ContentLength is REQUIRED with a stream Body so the SDK streams the
        // bytes instead of buffering them to compute the length.
        ContentLength: sizeBytes,
        ContentType: mimeType,
        ...(this.serverSideEncryption
          ? { ServerSideEncryption: this.serverSideEncryption }
          : {}),
      }),
    );
    this.logger.log(`[S3] Stream-uploaded (${sizeBytes} bytes): ${key}`);
    return { key, bucket: this.bucket, sizeBytes, mimeType };
  }

  /**
   * Server-side copy of an existing object to a fresh key — the bytes never
   * pass through the backend (no download+reupload), so duplicating even a
   * 1 GB databank file uses no backend memory. `sizeBytes`/`mimeType` are
   * carried from the source row (a copy preserves them).
   */
  async copyObject(
    sourceKey: string,
    folder: string,
    sizeBytes: number,
    mimeType: string,
    originalFilename?: string,
  ): Promise<UploadResult> {
    const ext = originalFilename?.split('.').pop() ?? 'bin';
    const key = `${folder}/${randomUUID()}.${ext}`;

    if (this.mode === 'local') {
      this.logger.log(`[LOCAL] Skipped copy, stub key: ${key}`);
      return { key, bucket: this.bucket, sizeBytes, mimeType };
    }

    if (this.mode === 'supabase') {
      const src = await this.download(sourceKey);
      return this.uploadAt(key, src.bytes, mimeType);
    }

    await this.ensureBucketExists();
    await this.s3.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: key,
        CopySource: `${this.bucket}/${sourceKey}`,
        ...(this.serverSideEncryption
          ? { ServerSideEncryption: this.serverSideEncryption }
          : {}),
      }),
    );
    this.logger.log(`[S3] Server-side copied: ${sourceKey} → ${key}`);
    return { key, bucket: this.bucket, sizeBytes, mimeType };
  }

  /**
   * Presign a direct browser→storage upload for a NEW object under `folder`.
   * The browser PUTs the raw file to the returned URL with the returned headers,
   * bypassing the backend entirely — no bytes flow through Railway — so folders
   * of multi-GB files (the Google Drive migration) upload without pressuring the
   * backend. The caller records the DB row afterwards via a commit step.
   *
   * S3/R2 only. In dev storage modes (local/supabase) there is no direct-PUT
   * path, so we return { strategy: 'proxy' } and the caller falls back to the
   * streaming multipart upload. The bucket needs a CORS rule allowing PUT from
   * the site origin for the browser request to succeed.
   */
  async presignPutUrl(
    folder: string,
    mimeType: string,
    originalFilename?: string,
  ): Promise<PresignedUpload> {
    const ext = originalFilename?.split('.').pop() ?? 'bin';
    const key = `${folder}/${randomUUID()}.${ext}`;

    if (this.mode !== 's3') {
      return { strategy: 'proxy', storageKey: key };
    }

    await this.ensureBucketExists();
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
      ...(this.serverSideEncryption
        ? { ServerSideEncryption: this.serverSideEncryption }
        : {}),
    });
    const url = await getSignedUrl(this.s3, command, { expiresIn: this.uploadUrlExpires });
    // The browser MUST send exactly the headers that were signed, or SigV4
    // rejects the PUT. Content-Type is always signed; SSE only when configured.
    const headers: Record<string, string> = { 'Content-Type': mimeType };
    if (this.serverSideEncryption) {
      headers['x-amz-server-side-encryption'] = this.serverSideEncryption;
    }
    this.logger.log(`[S3] Presigned direct upload: ${key}`);
    return { strategy: 'direct-put', storageKey: key, url, headers };
  }

  /**
   * Object metadata (existence + size) — used to VERIFY a direct upload actually
   * landed before we commit its DB row, and to record the true byte size. Never
   * throws: a missing object returns { exists: false }.
   */
  async headObjectMeta(
    key: string,
  ): Promise<{ exists: boolean; sizeBytes?: number; contentType?: string; etag?: string }> {
    if (this.mode === 'local') return { exists: true };

    if (this.mode === 'supabase') {
      const res = await fetch(
        `${this.supabaseUrl}/storage/v1/object/info/${this.bucket}/${key}`,
        { headers: { Authorization: `Bearer ${this.supabaseServiceKey}` } },
      );
      if (!res.ok) return { exists: false };
      const info = (await res.json().catch(() => null)) as
        | { size?: number; contentType?: string; metadata?: { size?: number; mimetype?: string } }
        | null;
      return {
        exists: true,
        sizeBytes: info?.size ?? info?.metadata?.size,
        contentType: info?.contentType ?? info?.metadata?.mimetype,
      };
    }

    try {
      const out = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        exists: true,
        sizeBytes: out.ContentLength,
        contentType: out.ContentType,
        etag: out.ETag,
      };
    } catch {
      return { exists: false };
    }
  }

  // ---------------------------------------------------------------------------
  // Multipart — resumable browser→R2 uploads (Databank Phase 1). S3/R2 mode
  // only: callers check `supportsDirectUpload` first; dev storage modes
  // (local / supabase) use the backend proxy upload instead. The browser PUTs
  // each part straight to R2 with a presigned URL — no bytes touch the backend.
  // ---------------------------------------------------------------------------

  /** True when browsers can upload straight to storage (S3/R2 mode). */
  get supportsDirectUpload(): boolean {
    return this.mode === 's3';
  }

  private assertS3(op: string): void {
    if (this.mode !== 's3') {
      throw new Error(`${op} requires S3/R2 storage mode (current mode: ${this.mode})`);
    }
  }

  /** Start a multipart upload at a caller-chosen key; returns R2's uploadId. */
  async createMultipartUpload(key: string, mimeType: string): Promise<string> {
    this.assertS3('createMultipartUpload');
    await this.ensureBucketExists();
    const out = await this.s3.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mimeType,
        ...(this.serverSideEncryption
          ? { ServerSideEncryption: this.serverSideEncryption }
          : {}),
      }),
    );
    if (!out.UploadId) throw new Error(`CreateMultipartUpload returned no UploadId (key: ${key})`);
    return out.UploadId;
  }

  /**
   * Presigned PUT for ONE part. Only `host` is signed and (with the client's
   * WHEN_REQUIRED checksum setting, #412) no checksum params are baked in, so
   * the browser sends the raw slice with NO extra headers. Local SigV4 — no
   * network call, cheap to mint many.
   */
  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds?: number,
  ): Promise<string> {
    this.assertS3('presignUploadPart');
    return getSignedUrl(
      this.s3,
      new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
      { expiresIn: expiresInSeconds ?? this.uploadUrlExpires },
    );
  }

  /**
   * Every part R2 holds for an upload, following ListParts pagination (1,000
   * per page). ETags are returned EXACTLY as R2 sent them — quotes included —
   * because CompleteMultipartUpload rejects them otherwise.
   */
  async listAllParts(
    key: string,
    uploadId: string,
  ): Promise<{ partNumber: number; etag: string; sizeBytes: number }[]> {
    this.assertS3('listAllParts');
    const parts: { partNumber: number; etag: string; sizeBytes: number }[] = [];
    let marker: string | undefined;
    // 11 pages × 1,000 covers R2's 10,000-part maximum with room to spare.
    for (let page = 0; page < 11; page++) {
      // eslint-disable-next-line no-await-in-loop
      const out = await this.s3.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MaxParts: 1000,
          ...(marker ? { PartNumberMarker: marker } : {}),
        }),
      );
      for (const p of out.Parts ?? []) {
        if (p.PartNumber && p.ETag) {
          parts.push({ partNumber: p.PartNumber, etag: p.ETag, sizeBytes: p.Size ?? 0 });
        }
      }
      if (!out.IsTruncated || !out.NextPartNumberMarker) break;
      marker = String(out.NextPartNumberMarker);
    }
    return parts;
  }

  /** Assemble the object from its parts — sorted by part number, ETags verbatim. */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void> {
    this.assertS3('completeMultipartUpload');
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: sorted.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
      }),
    );
    this.logger.log(`[S3] Completed multipart upload (${sorted.length} parts): ${key}`);
  }

  /** Abort an upload and free its parts. Already gone (NoSuchUpload) = success. */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    this.assertS3('abortMultipartUpload');
    try {
      await this.s3.send(
        new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
      );
    } catch (error) {
      if (isNoSuchUploadError(error)) return;
      throw error;
    }
  }

  /** In-progress multipart uploads under a prefix — for the orphan reconciler
   *  (uploads R2 knows about but the DB doesn't). Follows pagination. */
  async listMultipartUploads(
    prefix: string,
  ): Promise<{ key: string; uploadId: string; initiated?: Date }[]> {
    this.assertS3('listMultipartUploads');
    const uploads: { key: string; uploadId: string; initiated?: Date }[] = [];
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    for (let page = 0; page < 100; page++) {
      // eslint-disable-next-line no-await-in-loop
      const out = await this.s3.send(
        new ListMultipartUploadsCommand({
          Bucket: this.bucket,
          Prefix: prefix,
          ...(keyMarker ? { KeyMarker: keyMarker } : {}),
          ...(uploadIdMarker ? { UploadIdMarker: uploadIdMarker } : {}),
        }),
      );
      for (const u of out.Uploads ?? []) {
        if (u.Key && u.UploadId) uploads.push({ key: u.Key, uploadId: u.UploadId, initiated: u.Initiated });
      }
      if (!out.IsTruncated) break;
      keyMarker = out.NextKeyMarker;
      uploadIdMarker = out.NextUploadIdMarker;
      if (!keyMarker && !uploadIdMarker) break;
    }
    return uploads;
  }

  /**
   * Upload at a caller-chosen stable key (overwrites any existing object).
   * For published artifacts — e.g. the Android app behind /downloads —
   * where the same key must keep pointing at the latest version.
   */
  async uploadAt(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<UploadResult> {
    if (this.mode === 'local') {
      this.logger.log(`[LOCAL] Skipped upload, stub key: ${key}`);
      return { key, bucket: this.bucket, sizeBytes: buffer.length, mimeType };
    }

    if (this.mode === 'supabase') {
      await this.supabaseEnsureBucket();
      const res = await fetch(
        `${this.supabaseUrl}/storage/v1/object/${this.bucket}/${key}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.supabaseServiceKey}`,
            'Content-Type': mimeType,
            'x-upsert': 'true',
          },
          body: new Uint8Array(buffer),
        },
      );
      if (!res.ok) {
        throw new Error(`Supabase upload failed: ${res.status} ${await res.text()}`);
      }
      this.logger.log(`[SUPABASE] Uploaded: ${key}`);
      return { key, bucket: this.bucket, sizeBytes: buffer.length, mimeType };
    }

    await this.ensureBucketExists();
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ...(this.serverSideEncryption
          ? { ServerSideEncryption: this.serverSideEncryption }
          : {}),
      }),
    );
    this.logger.log(`[S3] Uploaded: ${key}`);
    return { key, bucket: this.bucket, sizeBytes: buffer.length, mimeType };
  }

  /**
   * Signed download URL. [expiresInSeconds] overrides the default TTL for a
   * single call — needed for LARGE public downloads (the ~100MB APK): the
   * 5-minute default expires MID-DOWNLOAD on slow mobile data, and when the
   * phone's download manager retries/resumes against the now-dead URL it saves
   * a TRUNCATED file, which Android then rejects with "package appears to be
   * invalid". Private document URLs keep the short default.
   */
  async getSignedUrl(key: string, expiresInSeconds?: number): Promise<string> {
    const expiresIn = expiresInSeconds ?? this.signedUrlExpires;
    if (this.mode === 'local') {
      return `/storage/local/${encodeURIComponent(key)}`;
    }

    if (this.mode === 'supabase') {
      const res = await fetch(
        `${this.supabaseUrl}/storage/v1/object/sign/${this.bucket}/${key}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expiresIn }),
        },
      );
      if (!res.ok) {
        throw new Error(`Supabase sign failed: ${res.status} ${await res.text()}`);
      }
      const data = await res.json() as { signedURL?: string; signedUrl?: string };
      const signed = data.signedURL ?? data.signedUrl ?? '';
      return signed.startsWith('http') ? signed : `${this.supabaseUrl}${signed}`;
    }

    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn });
  }

  /**
   * Read object bytes back into memory. Counterpart to upload(); used by
   * WhatsApp media streaming where the message's mediaUrl is an S3 key
   * (from the media-download worker) and we want to serve the bytes
   * through our authenticated endpoint rather than expose a signed URL.
   */
  async download(key: string): Promise<{ bytes: Buffer; mimeType: string | null }> {
    if (this.mode === 'local') {
      throw new Error(`[LOCAL] download not supported (key: ${key})`);
    }

    if (this.mode === 'supabase') {
      const res = await fetch(
        `${this.supabaseUrl}/storage/v1/object/${this.bucket}/${key}`,
        { headers: { Authorization: `Bearer ${this.supabaseServiceKey}` } },
      );
      if (!res.ok) {
        throw new Error(`Supabase download failed: ${res.status} ${await res.text()}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return { bytes: buf, mimeType: res.headers.get('content-type') };
    }

    const out = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = out.Body as Readable | undefined;
    if (!body) throw new Error(`S3 object body empty (key: ${key})`);
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return { bytes: Buffer.concat(chunks), mimeType: out.ContentType ?? null };
  }

  async delete(key: string): Promise<void> {
    if (this.mode === 'local') {
      this.logger.log(`[LOCAL] Skipped delete: ${key}`);
      return;
    }

    if (this.mode === 'supabase') {
      await fetch(`${this.supabaseUrl}/storage/v1/object/${this.bucket}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prefixes: [key] }),
      });
      this.logger.log(`[SUPABASE] Deleted: ${key}`);
      return;
    }

    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.log(`[S3] Deleted: ${key}`);
  }

  async exists(key: string): Promise<boolean> {
    if (this.mode === 'local') return true;

    if (this.mode === 'supabase') {
      const res = await fetch(
        `${this.supabaseUrl}/storage/v1/object/info/${this.bucket}/${key}`,
        { headers: { Authorization: `Bearer ${this.supabaseServiceKey}` } },
      );
      return res.ok;
    }

    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  private async supabaseEnsureBucket(): Promise<void> {
    if (this.supabaseBucketReady) return;
    const checkRes = await fetch(
      `${this.supabaseUrl}/storage/v1/bucket/${this.bucket}`,
      { headers: { Authorization: `Bearer ${this.supabaseServiceKey}` } },
    );
    if (checkRes.ok) {
      this.supabaseBucketReady = true;
      return;
    }
    const createRes = await fetch(`${this.supabaseUrl}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: this.bucket, name: this.bucket, public: false }),
    });
    if (!createRes.ok) {
      const err = await createRes.text();
      if (!err.includes('already exists') && !err.includes('Duplicate')) {
        throw new Error(`Failed to create Supabase bucket: ${err}`);
      }
    }
    this.logger.log(`[SUPABASE] Bucket ready: ${this.bucket}`);
    this.supabaseBucketReady = true;
  }

  private async ensureBucketExists(): Promise<void> {
    if (this.bucketReady) {
      return;
    }

    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.bucketReady = true;
      return;
    } catch (error) {
      const errorName = error instanceof Error ? error.name : '';
      const statusCode = typeof error === 'object' && error && '$metadata' in error
        ? ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ?? 0)
        : 0;

      if (!['NotFound', 'NoSuchBucket'].includes(errorName) && statusCode !== 404) {
        throw error;
      }
    }

    try {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created storage bucket: ${this.bucket}`);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : '';
      if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(errorName)) {
        throw error;
      }
    }

    this.bucketReady = true;
  }
}
