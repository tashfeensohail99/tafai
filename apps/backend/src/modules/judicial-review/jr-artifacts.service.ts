import { Injectable, NotFoundException } from '@nestjs/common';
import { JrArtifact, JrArtifactVersion } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * The JR artifact store. JR documents live in their OWN store — under the key
 * prefix jr/matters/${matterId} — never the shared client databank, so a
 * processing officer on the same client can't read counsel correspondence,
 * draft memoranda or merits opinions. Versions are append-only; artifacts are
 * soft-deleted via deletedAt.
 *
 * PR 1 provides the store primitives (add version, signed-URL read, list,
 * soft-delete). The lifecycle transitions land in PR 2.
 */
@Injectable()
export class JrArtifactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** List a matter's artifacts (excludes soft-deleted), in filing order. */
  async listForMatter(matterId: string): Promise<JrArtifact[]> {
    return this.prisma.jrArtifact.findMany({
      where: { matterId, deletedAt: null },
      orderBy: [{ folder: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  /**
   * Upload a new, current version of an artifact. Never deletes prior versions;
   * the previous current row is simply flipped to isCurrent=false. The file is
   * stored under the matter's JR prefix.
   */
  async addVersion(
    artifactId: string,
    file: { buffer: Buffer; mimeType: string; originalName: string },
    uploadedByUserId: string,
    changeNote?: string,
  ): Promise<JrArtifactVersion> {
    const artifact = await this.prisma.jrArtifact.findFirst({
      where: { id: artifactId, deletedAt: null },
    });
    if (!artifact) throw new NotFoundException('Artifact not found');

    const uploaded = await this.storage.upload(
      file.buffer,
      file.mimeType,
      `jr/matters/${artifact.matterId}`,
      file.originalName,
    );

    return this.prisma.$transaction(async (tx) => {
      const last = await tx.jrArtifactVersion.findFirst({
        where: { artifactId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const versionNumber = (last?.versionNumber ?? 0) + 1;

      await tx.jrArtifactVersion.updateMany({
        where: { artifactId, isCurrent: true },
        data: { isCurrent: false },
      });

      return tx.jrArtifactVersion.create({
        data: {
          artifactId,
          versionNumber,
          storageKey: uploaded.key,
          fileName: file.originalName,
          mimeType: uploaded.mimeType,
          fileSizeBytes: uploaded.sizeBytes,
          changeNote: changeNote ?? null,
          uploadedByUserId,
          isCurrent: true,
        },
      });
    });
  }

  /** Mint a short-lived signed URL for a specific version's stored file. */
  async getVersionUrl(versionId: string): Promise<{ url: string; fileName: string; mimeType: string }> {
    const version = await this.prisma.jrArtifactVersion.findFirst({ where: { id: versionId } });
    if (!version) throw new NotFoundException('Version not found');
    const url = await this.storage.getSignedUrl(version.storageKey);
    return { url, fileName: version.fileName, mimeType: version.mimeType };
  }

  /** Soft-delete an artifact. Versions are retained (never physically deleted). */
  async softDelete(artifactId: string): Promise<JrArtifact> {
    const artifact = await this.prisma.jrArtifact.findFirst({
      where: { id: artifactId, deletedAt: null },
    });
    if (!artifact) throw new NotFoundException('Artifact not found');
    return this.prisma.jrArtifact.update({
      where: { id: artifactId },
      data: { deletedAt: new Date() },
    });
  }
}
