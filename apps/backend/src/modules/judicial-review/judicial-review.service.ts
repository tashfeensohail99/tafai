import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JrMatter, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../common/types/auth.types';
import { ListMattersQueryDto } from './judicial-review.dto';

/**
 * Core Judicial Review service (PR 1 foundation). Holds the matter-access guard
 * and a read surface for matters. The stage machine, route tree and deadline
 * engine land in later PRs.
 */
@Injectable()
export class JudicialReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List JR matters visible to the caller. `jr.matter.view_all` sees every
   * matter; everyone else is scoped to the matters assigned to them. The scope
   * constraint is ALWAYS ANDed in via an AND: [] array so an added filter can
   * never silently drop it (the double-OR-spread leak, #253).
   */
  async listMatters(query: ListMattersQueryDto, user: RequestUser): Promise<JrMatter[]> {
    const scopeConstraint: Prisma.JrMatterWhereInput = user.permissions.includes(
      'jr.matter.view_all',
    )
      ? {}
      : { assignedAssociateUserId: user.id };

    const filters: Prisma.JrMatterWhereInput[] = [];
    if (query.stage) filters.push({ stage: query.stage });
    if (query.intakeType) filters.push({ intakeType: query.intakeType });
    if (query.search) {
      filters.push({
        OR: [
          { matterNumber: { contains: query.search, mode: 'insensitive' } },
          { styleOfCause: { contains: query.search, mode: 'insensitive' } },
          { courtFileNumber: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.JrMatterWhereInput = {
      AND: [scopeConstraint, ...filters],
    };

    return this.prisma.jrMatter.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.take ?? 50,
    });
  }

  /** Load a single matter, enforcing per-matter access. */
  async getMatter(matterId: string, user: RequestUser): Promise<JrMatter> {
    return this.assertMatterAccess(matterId, user);
  }

  /**
   * Enforce per-matter access and return the matter. Public so the artifact
   * lifecycle service can gate every artifact mutation on the owning matter
   * (never relies on list scoping alone — #253/#255).
   */
  async assertMatterAccess(matterId: string, user: RequestUser): Promise<JrMatter> {
    const matter = await this.prisma.jrMatter.findFirst({ where: { id: matterId } });
    if (!matter) throw new NotFoundException('Matter not found');
    if (user.permissions.includes('jr.matter.view_all')) return matter;
    if (matter.assignedAssociateUserId !== user.id) {
      throw new ForbiddenException('You are not assigned to this matter');
    }
    return matter;
  }
}
