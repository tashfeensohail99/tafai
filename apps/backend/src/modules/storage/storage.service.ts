import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { randomUUID } from 'crypto';

export interface UploadResult {
  key: string;
  bucket: string;
  sizeBytes: number;
  mimeType: string;
}

type StorageMode = 'supabase' | 's3' | 'local';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly signedUrlExpires: number;
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
