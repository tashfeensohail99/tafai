import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { WhatsAppMetaClientFactory } from '../../meta/client.factory';
import { WHATSAPP_QUEUE, type MediaDownloadJob } from '../queue-contracts';

/**
 * Meta media URLs expire (~5 min). We re-host every inbound media asset on
 * S3-compatible storage (R2 in production) so the dashboard can render it
 * indefinitely.
 *
 * Falls back to the shared `app.storage.*` config if WhatsApp-specific R2
 * vars are not set. If neither is configured we skip with a warning so dev
 * environments don't crash on media events.
 */
@Processor(WHATSAPP_QUEUE.MEDIA_DOWNLOAD, { concurrency: 4 })
export class MediaDownloadProcessor extends WorkerHost {
  private readonly log = new Logger(MediaDownloadProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaFactory: WhatsAppMetaClientFactory,
    private readonly config: ConfigService,
  ) {
    super();
  }

  override async process(job: Job<MediaDownloadJob>): Promise<void> {
    const { messageId, metaMediaId } = job.data;
    try {
      const message = await this.prisma.whatsAppMessage.findUnique({
        where: { id: messageId },
        include: { channel: true },
      });
      if (!message) {
        this.log.warn(`media-download skipped: message ${messageId} not found`);
        return;
      }

      const s3 = this.makeS3Client();
      const bucket =
        this.config.get<string>('app.whatsapp.mediaBucket') ||
        this.config.get<string>('app.storage.bucket');
      if (!s3 || !bucket) {
        // This is a config bug, not a per-message error — throw so BullMQ
        // marks the job failed loudly instead of swallowing silently. Hard
        // to notice when otherwise: messages just stay with mediaUrl=null.
        const reason = !s3
          ? 'S3 client unavailable (missing STORAGE_ENDPOINT/ACCESS_KEY/SECRET_KEY)'
          : 'No bucket configured (set WHATSAPP_MEDIA_BUCKET or STORAGE_BUCKET)';
        throw new Error(`media-download config error for message ${messageId}: ${reason}`);
      }

      const client = this.metaFactory.forChannel(message.channel);
      const meta = await client.getMediaUrl(metaMediaId);
      const bytes = await client.downloadMedia(meta.url);

      const ext = meta.mime_type.split('/')[1] ?? 'bin';
      const key = `whatsapp/media/${message.id}.${ext}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: meta.mime_type,
        }),
      );
      const publicBase =
        this.config.get<string>('app.whatsapp.mediaPublicBaseUrl') ||
        // No fallback for storage.publicBaseUrl exists; we leave just the key
        // here and let the frontend prepend if needed.
        '';
      await this.prisma.whatsAppMessage.update({
        where: { id: message.id },
        data: {
          mediaUrl: publicBase ? `${publicBase.replace(/\/$/, '')}/${key}` : key,
          mediaMimeType: meta.mime_type,
          mediaSizeBytes: meta.file_size,
          mediaSha256: meta.sha256,
        },
      });
      this.log.log(`media-download ok: message=${messageId} key=${key} bytes=${bytes.length}`);
    } catch (err) {
      // Log the actual error so it shows up in Railway logs. Re-throw so
      // BullMQ records the job as failed (retries per the job's attempts
      // config) and operators can see it in the failed-jobs view.
      const message = (err as Error).message ?? String(err);
      this.log.error(
        `media-download FAILED: message=${messageId} metaMediaId=${metaMediaId} attempt=${job.attemptsMade + 1}/${job.opts.attempts ?? 1}: ${message}`,
      );
      throw err;
    }
  }

  private makeS3Client(): S3Client | null {
    const endpoint = this.config.get<string>('app.storage.endpoint');
    const accessKey = this.config.get<string>('app.storage.accessKey');
    const secretKey = this.config.get<string>('app.storage.secretKey');
    const region = this.config.get<string>('app.storage.region') ?? 'auto';
    if (!endpoint || !accessKey || !secretKey) return null;
    return new S3Client({
      region,
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    });
  }
}
