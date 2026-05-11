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
import { randomUUID } from 'crypto';

export interface UploadResult {
  key: string;
  bucket: string;
  sizeBytes: number;
  mimeType: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly signedUrlExpires: number;
  private readonly serverSideEncryption?: 'AES256' | 'aws:kms';
  private bucketReady = false;

  constructor() {
    this.bucket = process.env.STORAGE_BUCKET ?? 'tafsheen-documents';
    this.signedUrlExpires = parseInt(
      process.env.STORAGE_SIGNED_URL_EXPIRES_SECONDS ?? '300',
      10,
    );
    this.serverSideEncryption = process.env.STORAGE_SERVER_SIDE_ENCRYPTION as 'AES256' | 'aws:kms' | undefined;

    this.s3 = new S3Client({
      endpoint: process.env.STORAGE_ENDPOINT,
      region: process.env.STORAGE_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY ?? '',
        secretAccessKey: process.env.STORAGE_SECRET_KEY ?? '',
      },
      forcePathStyle: true, // Required for MinIO
    });
  }

  /**
   * Upload a file buffer to private storage.
   * Returns the storage key for later retrieval.
   * Never expose this key as a public URL.
   */
  async upload(
    buffer: Buffer,
    mimeType: string,
    folder: string,
    originalFilename?: string,
  ): Promise<UploadResult> {
    await this.ensureBucketExists();

    const ext = originalFilename?.split('.').pop() ?? 'bin';
    const key = `${folder}/${randomUUID()}.${ext}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        // Enforce private ACL — no public access
        ACL: 'private',
        ...(this.serverSideEncryption
          ? { ServerSideEncryption: this.serverSideEncryption }
          : {}),
      }),
    );

    this.logger.log(`Uploaded file: ${key}`);

    return { key, bucket: this.bucket, sizeBytes: buffer.length, mimeType };
  }

  /**
   * Generate a short-lived signed URL for a private object.
   * Always call this AFTER verifying the requesting user
   * has permission to access the document.
   */
  async getSignedUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: this.signedUrlExpires });
  }

  /**
   * Delete a file from storage.
   */
  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.log(`Deleted file: ${key}`);
  }

  /**
   * Check if a file exists in storage.
   */
  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
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
