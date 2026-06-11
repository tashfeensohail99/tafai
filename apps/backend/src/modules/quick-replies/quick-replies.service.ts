import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../common/types/auth.types';

const MANAGE_TEAM_PERM = 'whatsapp.manage_templates';

/**
 * Quick replies = saved chat snippets for the WhatsApp composer. Two scopes:
 * team-wide rows (ownerUserId NULL, managed by template admins so the shared
 * wording stays controlled) and personal rows every rep manages for
 * themselves. Deliberately tiny — no soft delete, no audit: these are typing
 * shortcuts, not business records.
 */
@Injectable()
export class QuickRepliesService {
  constructor(private readonly prisma: PrismaService) {}

  private canManageTeam(user: RequestUser): boolean {
    return user.permissions.includes(MANAGE_TEAM_PERM);
  }

  async listFor(user: RequestUser) {
    const rows = await this.prisma.quickReply.findMany({
      where: { OR: [{ ownerUserId: null }, { ownerUserId: user.id }] },
      orderBy: [{ title: 'asc' }],
    });
    return {
      team: rows.filter((r) => r.ownerUserId === null),
      mine: rows.filter((r) => r.ownerUserId === user.id),
      canManageTeam: this.canManageTeam(user),
    };
  }

  async create(user: RequestUser, input: { title: string; body: string; team?: boolean }) {
    const title = input.title?.trim();
    const body = input.body?.trim();
    if (!title || !body) throw new ForbiddenException('Title and text are required.');
    if (input.team && !this.canManageTeam(user)) {
      throw new ForbiddenException('Only template managers can create team quick replies.');
    }
    return this.prisma.quickReply.create({
      data: { title, body, ownerUserId: input.team ? null : user.id },
    });
  }

  /** Own rows always; team rows only with the manage permission. */
  private async assertEditable(user: RequestUser, id: string) {
    const row = await this.prisma.quickReply.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Quick reply not found');
    const isTeam = row.ownerUserId === null;
    if (isTeam && !this.canManageTeam(user)) {
      throw new ForbiddenException('Only template managers can edit team quick replies.');
    }
    if (!isTeam && row.ownerUserId !== user.id) {
      throw new ForbiddenException('This quick reply belongs to another user.');
    }
    return row;
  }

  async update(user: RequestUser, id: string, input: { title?: string; body?: string }) {
    await this.assertEditable(user, id);
    return this.prisma.quickReply.update({
      where: { id },
      data: {
        ...(input.title?.trim() ? { title: input.title.trim() } : {}),
        ...(input.body?.trim() ? { body: input.body.trim() } : {}),
      },
    });
  }

  async remove(user: RequestUser, id: string) {
    await this.assertEditable(user, id);
    await this.prisma.quickReply.delete({ where: { id } });
    return { ok: true };
  }
}
