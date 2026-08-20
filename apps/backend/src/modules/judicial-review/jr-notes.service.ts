import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../common/types/auth.types';
import { StorageService } from '../storage/storage.service';
import { OpenAiService } from '../ai/openai.service';
import { JudicialReviewService } from './judicial-review.service';
import { CreateJrNoteDto, UpdateJrNoteDto } from './judicial-review.dto';

/** Notes may carry a single voice/image attachment; 25 MB is ample for either. */
const MAX_NOTE_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Audio containers a browser MediaRecorder / mobile recorder can realistically
 * emit. `video/webm` is deliberately included — some browsers label an audio-only
 * MediaRecorder blob that way (§workspace note-taking).
 */
const AUDIO_MIME_TYPES = new Set<string>([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/x-m4a',
  'audio/aac',
  'audio/3gpp',
  'video/webm',
]);

const IMAGE_MIME_TYPES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/tiff',
]);

/** A note loaded with its attachments — the enrichment input shape. */
type NoteWithAttachments = Prisma.JrNoteGetPayload<{ include: { attachments: true } }>;

/**
 * The JR case-workspace note store. Notes live under the matter (never the shared
 * client databank) and can carry a text body plus a single voice or image
 * attachment; voice clips are transcribed best-effort to Roman Urdu at upload
 * time. Notes are soft-deleted via deletedAt. Every mutation is access-checked
 * against the owning matter and writes a JrAuditLog row inside the same
 * transaction (mirrors {@link JrArtifactsService}).
 */
@Injectable()
export class JrNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly openai: OpenAiService,
    private readonly jr: JudicialReviewService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read surface
  // ---------------------------------------------------------------------------

  /** List a matter's notes (excludes soft-deleted), pinned first then newest. */
  async listForMatter(matterId: string, user: RequestUser) {
    await this.jr.assertMatterAccess(matterId, user);
    const notes = await this.prisma.jrNote.findMany({
      where: { matterId, deletedAt: null },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      include: { attachments: { orderBy: { createdAt: 'asc' } } },
    });
    return { notes: await this.enrichMany(notes) };
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  /** Create a plain text note. */
  async createText(matterId: string, dto: CreateJrNoteDto, user: RequestUser) {
    await this.jr.assertMatterAccess(matterId, user);

    const note = await this.prisma.$transaction(async (tx) => {
      const created = await tx.jrNote.create({
        data: {
          matterId,
          content: dto.content,
          noteType: dto.noteType ?? 'GENERAL',
          isPinned: dto.isPinned ?? false,
          authorUserId: user.id,
        },
      });
      await this.writeAudit(tx, {
        matterId,
        actorUserId: user.id,
        action: 'note_created',
        entityId: created.id,
        newValues: { noteType: created.noteType, hasText: true },
      });
      return created;
    });

    return this.enrichOne(note.id);
  }

  /**
   * Create a voice note. The clip is uploaded, then transcribed best-effort
   * inline (Whisper + Roman-Urdu transliteration; never throws, may be null). The
   * note + its AUDIO attachment + the audit row are written in one transaction.
   */
  async createVoice(
    matterId: string,
    file: Express.Multer.File | undefined,
    user: RequestUser,
    opts: { content?: string; durationMs?: number },
  ) {
    await this.jr.assertMatterAccess(matterId, user);
    this.assertUploadable(file, AUDIO_MIME_TYPES);

    const uploaded = await this.storage.upload(
      file!.buffer,
      file!.mimetype,
      `jr/matters/${matterId}/notes`,
      file!.originalname,
    );

    // Best-effort transcription — a missed read just leaves transcript null.
    const tr = await this.openai.transcribe(file!.buffer, file!.originalname || 'note.webm');

    const note = await this.prisma.$transaction(async (tx) => {
      const created = await tx.jrNote.create({
        data: {
          matterId,
          content: opts.content ?? '',
          noteType: 'GENERAL',
          authorUserId: user.id,
        },
      });
      await tx.jrNoteAttachment.create({
        data: {
          noteId: created.id,
          kind: 'AUDIO',
          storageKey: uploaded.key,
          fileName: file!.originalname || 'voice-note',
          mimeType: uploaded.mimeType,
          fileSizeBytes: uploaded.sizeBytes,
          durationMs: opts.durationMs ?? null,
          transcript: tr?.text ?? null,
          transcriptLang: tr ? 'ur' : null,
        },
      });
      await this.writeAudit(tx, {
        matterId,
        actorUserId: user.id,
        action: 'note_voice_added',
        entityId: created.id,
        newValues: { transcribed: !!tr },
      });
      return created;
    });

    return this.enrichOne(note.id);
  }

  /** Create an image note (the note + its IMAGE attachment + the audit row). */
  async createImage(
    matterId: string,
    file: Express.Multer.File | undefined,
    user: RequestUser,
    opts: { content?: string },
  ) {
    await this.jr.assertMatterAccess(matterId, user);
    this.assertUploadable(file, IMAGE_MIME_TYPES);

    const uploaded = await this.storage.upload(
      file!.buffer,
      file!.mimetype,
      `jr/matters/${matterId}/notes`,
      file!.originalname,
    );

    const note = await this.prisma.$transaction(async (tx) => {
      const created = await tx.jrNote.create({
        data: {
          matterId,
          content: opts.content ?? '',
          noteType: 'GENERAL',
          authorUserId: user.id,
        },
      });
      await tx.jrNoteAttachment.create({
        data: {
          noteId: created.id,
          kind: 'IMAGE',
          storageKey: uploaded.key,
          fileName: file!.originalname || 'image',
          mimeType: uploaded.mimeType,
          fileSizeBytes: uploaded.sizeBytes,
        },
      });
      await this.writeAudit(tx, {
        matterId,
        actorUserId: user.id,
        action: 'note_image_added',
        entityId: created.id,
        newValues: { hasImage: true },
      });
      return created;
    });

    return this.enrichOne(note.id);
  }

  // ---------------------------------------------------------------------------
  // Update + delete
  // ---------------------------------------------------------------------------

  /** Edit a note's body and/or pin state (author OR jr.matter.view_all only). */
  async update(noteId: string, dto: UpdateJrNoteDto, user: RequestUser) {
    const note = await this.resolveNote(noteId);
    await this.jr.assertMatterAccess(note.matterId, user);
    this.assertCanMutate(note, user);

    const data: Prisma.JrNoteUpdateInput = {};
    if (dto.content !== undefined) {
      data.content = dto.content;
      data.editedAt = new Date();
    }
    if (dto.isPinned !== undefined) data.isPinned = dto.isPinned;

    await this.prisma.$transaction(async (tx) => {
      await tx.jrNote.update({ where: { id: noteId }, data });
      await this.writeAudit(tx, {
        matterId: note.matterId,
        actorUserId: user.id,
        action: 'note_updated',
        entityId: noteId,
        oldValues: { content: note.content, isPinned: note.isPinned },
        newValues: {
          content: dto.content ?? note.content,
          isPinned: dto.isPinned ?? note.isPinned,
        },
      });
    });

    return this.enrichOne(noteId);
  }

  /** Soft-delete a note (author OR jr.matter.view_all only). */
  async softDelete(noteId: string, user: RequestUser): Promise<{ ok: true }> {
    const note = await this.resolveNote(noteId);
    await this.jr.assertMatterAccess(note.matterId, user);
    this.assertCanMutate(note, user);

    await this.prisma.$transaction(async (tx) => {
      await tx.jrNote.update({
        where: { id: noteId },
        data: { deletedAt: new Date(), deletedByUserId: user.id },
      });
      await this.writeAudit(tx, {
        matterId: note.matterId,
        actorUserId: user.id,
        action: 'note_deleted',
        entityId: noteId,
      });
    });

    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async resolveNote(noteId: string) {
    const note = await this.prisma.jrNote.findFirst({
      where: { id: noteId, deletedAt: null },
    });
    if (!note) throw new NotFoundException('Note not found');
    return note;
  }

  /**
   * Only the note's author OR a user with the cross-matter view_all permission
   * (the JR Head) may edit or delete a note — an associate cannot rewrite a
   * colleague's record of a call or a counsel exchange.
   */
  private assertCanMutate(note: { authorUserId: string }, user: RequestUser): void {
    const isAuthor = note.authorUserId === user.id;
    const isHead = user.permissions?.includes('jr.matter.view_all') ?? false;
    if (!isAuthor && !isHead) {
      throw new ForbiddenException('Only the note author can edit or delete this note');
    }
  }

  /** Refetch a single note with attachments and enrich it (post-mutation shape). */
  private async enrichOne(noteId: string) {
    const note = await this.prisma.jrNote.findUnique({
      where: { id: noteId },
      include: { attachments: { orderBy: { createdAt: 'asc' } } },
    });
    if (!note) throw new NotFoundException('Note not found');
    const [enriched] = await this.enrichMany([note]);
    return enriched;
  }

  /**
   * Batch-enrich notes: resolve author display names in one query and mint a
   * short-lived signed URL per attachment. URL minting is per-attachment
   * try/catch → url:null, so a missing object (LOCAL mode) never 500s the list.
   */
  private async enrichMany(notes: NoteWithAttachments[]) {
    const authorIds = [...new Set(notes.map((n) => n.authorUserId))];
    const authors = authorIds.length
      ? await this.prisma.userAccount.findMany({
          where: { id: { in: authorIds } },
          select: {
            id: true,
            email: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        })
      : [];
    const nameById = new Map<string, string>();
    for (const a of authors) {
      const full = a.employee ? `${a.employee.firstName} ${a.employee.lastName}`.trim() : '';
      nameById.set(a.id, full || a.email || 'User');
    }

    return Promise.all(
      notes.map(async (note) => ({
        id: note.id,
        content: note.content,
        noteType: note.noteType,
        isPinned: note.isPinned,
        authorUserId: note.authorUserId,
        authorName: nameById.get(note.authorUserId) ?? 'User',
        createdAt: note.createdAt,
        editedAt: note.editedAt,
        attachments: await Promise.all(
          note.attachments.map(async (att) => {
            let url: string | null = null;
            try {
              url = await this.storage.getSignedUrl(att.storageKey);
            } catch {
              url = null;
            }
            return {
              id: att.id,
              kind: att.kind,
              fileName: att.fileName,
              mimeType: att.mimeType,
              fileSizeBytes: att.fileSizeBytes,
              durationMs: att.durationMs,
              transcript: att.transcript,
              url,
            };
          }),
        ),
      })),
    );
  }

  private assertUploadable(
    file: Express.Multer.File | undefined,
    allowed: Set<string>,
  ): asserts file is Express.Multer.File {
    if (!file) {
      throw new BadRequestException(
        'No file provided. Use multipart/form-data with field name "file".',
      );
    }
    if (file.size > MAX_NOTE_FILE_BYTES) {
      throw new BadRequestException('File exceeds the 25 MB limit.');
    }
    if (!allowed.has(file.mimetype)) {
      throw new BadRequestException(
        `Files of type ${file.mimetype} are not allowed. Allowed: ${[...allowed].join(', ')}.`,
      );
    }
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    input: {
      matterId: string;
      actorUserId: string;
      action: string;
      entityId: string;
      oldValues?: Prisma.InputJsonValue;
      newValues?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await tx.jrAuditLog.create({
      data: {
        matterId: input.matterId,
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: 'JrNote',
        entityId: input.entityId,
        oldValues: input.oldValues,
        newValues: input.newValues,
      },
    });
  }
}
