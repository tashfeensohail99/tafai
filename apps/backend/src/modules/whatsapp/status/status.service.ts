import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WhatsAppStatusMediaType,
  WhatsAppStatusState,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { RequestUser } from '../../../common/types/auth.types';
import { processStatusVideo } from './video-processor';

const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp']);
const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

function allowlistedEmails(): Set<string> {
  // Default pilot list: the sales rep testing it (Iffat Hanif) plus the
  // owner. Override at runtime with STATUS_FEATURE_EMAILS (comma-separated,
  // e.g. "a@x.com,b@x.com") to widen or narrow the pilot without a deploy.
  const raw = process.env.STATUS_FEATURE_EMAILS
    ?? 'iffat@tashfeenimmigrationsolutions.com,admin@fdm-summit-systems.com';
  return new Set(
    raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  );
}

export function isStatusFeatureUser(user: RequestUser | null | undefined): boolean {
  if (!user?.email) return false;
  return allowlistedEmails().has(user.email.toLowerCase());
}

export interface CreateStatusInput {
  file: Buffer;
  mimeType: string;
  originalFilename?: string;
  caption?: string;
  state?: WhatsAppStatusState;
  scheduledAt?: Date;
}

export interface ListStatusFilters {
  state?: WhatsAppStatusState;
  search?: string;
  limit?: number;
}

export interface PatchStatusInput {
  caption?: string;
  state?: WhatsAppStatusState;
  scheduledAt?: Date | null;
}

@Injectable()
export class WhatsAppStatusService {
  private readonly log = new Logger(WhatsAppStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async requireEmployeeId(user: RequestUser): Promise<string> {
    if (!isStatusFeatureUser(user)) {
      throw new ForbiddenException('Status feature not enabled for this account');
    }
    const emp = await this.prisma.employee.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!emp) throw new ForbiddenException('No employee profile linked to this account');
    return emp.id;
  }

  async create(user: RequestUser, input: CreateStatusInput) {
    const employeeId = await this.requireEmployeeId(user);
    const mediaType = classifyMedia(input.mimeType);
    if (input.file.length > MAX_MEDIA_BYTES) {
      throw new BadRequestException(`File exceeds ${MAX_MEDIA_BYTES / (1024 * 1024)} MB limit`);
    }
    const state = input.state ?? WhatsAppStatusState.DRAFT;
    if (state === WhatsAppStatusState.SCHEDULED && !input.scheduledAt) {
      throw new BadRequestException('scheduledAt required when state is SCHEDULED');
    }
    if (state !== WhatsAppStatusState.DRAFT
        && state !== WhatsAppStatusState.SCHEDULED
        && state !== WhatsAppStatusState.POSTED) {
      throw new BadRequestException(`Invalid initial state: ${state}`);
    }

    // WhatsApp Status caps videos at 30 s and 16 MB. Long clips are split
    // into multiple status posts; large clips are transcoded down. Images
    // pass through untouched.
    const uploads = await this.prepareUploads(input, mediaType);

    const now = new Date();
    const postedAt = state === WhatsAppStatusState.POSTED ? now : null;
    const expiresAt = postedAt ? new Date(postedAt.getTime() + STATUS_TTL_MS) : null;
    const baseCaption = input.caption?.trim() || null;

    const rows = [];
    for (let i = 0; i < uploads.length; i++) {
      const part = uploads[i];
      // When one upload became several chunks, mark each with "(part n/N)"
      // so viewers landing on any single Status know it's a series.
      const partCaption = uploads.length > 1
        ? (baseCaption
          ? `${baseCaption} (part ${i + 1}/${uploads.length})`
          : `Part ${i + 1}/${uploads.length}`)
        : baseCaption;

      const stored = await this.storage.upload(
        part.buffer,
        part.mimeType,
        'whatsapp/status',
        input.originalFilename,
      );

      const row = await this.prisma.whatsAppStatus.create({
        data: {
          employeeId,
          mediaKey: stored.key,
          mediaType,
          mediaMimeType: part.mimeType,
          mediaSizeBytes: stored.sizeBytes,
          caption: partCaption,
          state,
          scheduledAt: state === WhatsAppStatusState.SCHEDULED ? input.scheduledAt : null,
          postedAt,
          expiresAt,
        },
      });
      rows.push(row);
    }
    return Promise.all(rows.map((r) => this.toDto(r)));
  }

  /**
   * Split + compress the upload as needed. Images pass through untouched
   * (WhatsApp Status accepts JPEG/PNG at any reasonable size). Videos go
   * through ffmpeg only when they exceed the 30 s / 16 MB / non-MP4 rules.
   */
  private async prepareUploads(
    input: CreateStatusInput,
    mediaType: WhatsAppStatusMediaType,
  ): Promise<Array<{ buffer: Buffer; mimeType: string }>> {
    if (mediaType !== WhatsAppStatusMediaType.VIDEO) {
      return [{ buffer: input.file, mimeType: input.mimeType }];
    }
    try {
      const chunks = await processStatusVideo(input.file, input.mimeType);
      if (chunks.length === 0) throw new Error('processor returned no chunks');
      return chunks.map((c) => ({ buffer: c.buffer, mimeType: c.mimeType }));
    } catch (e) {
      this.log.warn(
        `Video processing failed for status upload (${input.file.length} bytes, ${input.mimeType}): ${(e as Error).message}. ` +
        `Falling back to original bytes.`,
      );
      return [{ buffer: input.file, mimeType: input.mimeType }];
    }
  }

  async list(user: RequestUser, filters: ListStatusFilters) {
    const employeeId = await this.requireEmployeeId(user);
    const where: Prisma.WhatsAppStatusWhereInput = {
      employeeId,
      deletedAt: null,
      ...(filters.state ? { state: filters.state } : {}),
      ...(filters.search
        ? { caption: { contains: filters.search, mode: 'insensitive' } }
        : {}),
    };
    const rows = await this.prisma.whatsAppStatus.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: Math.min(filters.limit ?? 100, 200),
    });
    return Promise.all(rows.map((r) => this.toDto(r)));
  }

  async findOne(user: RequestUser, id: string) {
    const employeeId = await this.requireEmployeeId(user);
    const row = await this.prisma.whatsAppStatus.findFirst({
      where: { id, employeeId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Status not found');
    return this.toDto(row);
  }

  async patch(user: RequestUser, id: string, input: PatchStatusInput) {
    const employeeId = await this.requireEmployeeId(user);
    const existing = await this.prisma.whatsAppStatus.findFirst({
      where: { id, employeeId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Status not found');
    if (existing.state === WhatsAppStatusState.POSTED
        || existing.state === WhatsAppStatusState.EXPIRED) {
      throw new BadRequestException('Cannot edit posted or expired status');
    }

    const data: Prisma.WhatsAppStatusUpdateInput = {};
    if (input.caption !== undefined) data.caption = input.caption.trim() || null;
    if (input.state !== undefined) {
      if (input.state !== WhatsAppStatusState.DRAFT
          && input.state !== WhatsAppStatusState.SCHEDULED) {
        throw new BadRequestException('patch only accepts state DRAFT or SCHEDULED — use /post to mark posted');
      }
      if (input.state === WhatsAppStatusState.SCHEDULED) {
        const at = input.scheduledAt ?? existing.scheduledAt;
        if (!at) throw new BadRequestException('scheduledAt required when moving to SCHEDULED');
        data.scheduledAt = at;
      } else {
        data.scheduledAt = null;
      }
      data.state = input.state;
    } else if (input.scheduledAt !== undefined) {
      data.scheduledAt = input.scheduledAt;
    }

    const row = await this.prisma.whatsAppStatus.update({ where: { id }, data });
    return this.toDto(row);
  }

  async markPosted(user: RequestUser, id: string) {
    const employeeId = await this.requireEmployeeId(user);
    const existing = await this.prisma.whatsAppStatus.findFirst({
      where: { id, employeeId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Status not found');
    if (existing.state === WhatsAppStatusState.POSTED
        || existing.state === WhatsAppStatusState.EXPIRED) {
      throw new BadRequestException(`Already ${existing.state.toLowerCase()}`);
    }
    const now = new Date();
    const row = await this.prisma.whatsAppStatus.update({
      where: { id },
      data: {
        state: WhatsAppStatusState.POSTED,
        postedAt: now,
        expiresAt: new Date(now.getTime() + STATUS_TTL_MS),
        scheduledAt: null,
      },
    });
    return this.toDto(row);
  }

  async remove(user: RequestUser, id: string) {
    const employeeId = await this.requireEmployeeId(user);
    const existing = await this.prisma.whatsAppStatus.findFirst({
      where: { id, employeeId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Status not found');
    await this.prisma.whatsAppStatus.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  private async toDto(row: {
    id: string;
    mediaKey: string;
    mediaType: WhatsAppStatusMediaType;
    mediaMimeType: string;
    mediaSizeBytes: number;
    caption: string | null;
    state: WhatsAppStatusState;
    scheduledAt: Date | null;
    postedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const mediaUrl = await this.storage.getSignedUrl(row.mediaKey);
    return {
      id: row.id,
      state: row.state,
      mediaType: row.mediaType,
      mediaMimeType: row.mediaMimeType,
      mediaSizeBytes: row.mediaSizeBytes,
      mediaUrl,
      caption: row.caption,
      scheduledAt: row.scheduledAt?.toISOString() ?? null,
      postedAt: row.postedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function classifyMedia(mimeType: string): WhatsAppStatusMediaType {
  if (IMAGE_MIME.has(mimeType)) return WhatsAppStatusMediaType.IMAGE;
  if (VIDEO_MIME.has(mimeType)) return WhatsAppStatusMediaType.VIDEO;
  throw new BadRequestException(`Unsupported media type: ${mimeType}`);
}
