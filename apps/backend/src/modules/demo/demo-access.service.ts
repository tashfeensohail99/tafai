import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { DEMO_ADMIN_USER_ID, DEMO_AGENT_USER_ID } from './demo.constants';

export type DemoRole = 'admin' | 'agent';

/**
 * Per-prospect sign-in links. A link is a random token whose SHA-256 is stored;
 * redeeming it signs the visitor in as the demo admin or demo agent account for
 * as long as the link is valid. Every redemption is recorded (ip, user agent,
 * time) so the sales team knows who looked, and a link can be revoked at any
 * time, which also ends the sessions it created.
 */
@Injectable()
export class DemoAccessService {
  private readonly log = new Logger(DemoAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private frontendUrl(): string {
    return (process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  async create(input: { label: string; role: DemoRole; hours?: number; maxUses?: number | null; createdByUserId?: string | null }) {
    const label = input.label?.trim();
    if (!label) throw new BadRequestException('label is required');
    const hours = Math.min(24 * 30, Math.max(1, Number(input.hours ?? 48)));
    const userId = input.role === 'admin' ? DEMO_ADMIN_USER_ID : DEMO_AGENT_USER_ID;
    const user = await this.prisma.userAccount.findUnique({ where: { id: userId }, select: { id: true, status: true } });
    if (!user || user.status !== 'ACTIVE') {
      throw new BadRequestException(`demo ${input.role} account is missing — run the demo seed first`);
    }
    const token = randomBytes(32).toString('base64url');
    const link = await this.prisma.demoAccessLink.create({
      data: {
        label,
        tokenHash: this.hash(token),
        tokenTail: token.slice(-6),
        userId,
        role: input.role,
        expiresAt: new Date(Date.now() + hours * 3_600_000),
        maxUses: input.maxUses ?? null,
        createdByUserId: input.createdByUserId ?? null,
      },
    });
    this.log.log(`demo access link created: ${label} (${input.role}, ${hours}h, …${link.tokenTail})`);
    return { ...this.view(link), url: `${this.frontendUrl()}/demo/enter?t=${token}` };
  }

  async list() {
    const links = await this.prisma.demoAccessLink.findMany({
      orderBy: { createdAt: 'desc' },
      include: { uses: { orderBy: { usedAt: 'desc' }, take: 20 } },
    });
    return links.map((l) => ({
      ...this.view(l),
      uses: l.uses.map((u) => ({ id: u.id, usedAt: u.usedAt, ipAddress: u.ipAddress, userAgent: u.userAgent })),
    }));
  }

  async revoke(id: string) {
    const link = await this.prisma.demoAccessLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('link not found');
    if (!link.revokedAt) {
      await this.prisma.demoAccessLink.update({ where: { id }, data: { revokedAt: new Date() } });
      // End every session this link opened.
      await this.prisma.loginSession.updateMany({
        where: { userId: link.userId, revokedAt: null, userAgent: { startsWith: `demo-link:${link.id}` } },
        data: { revokedAt: new Date() },
      });
    }
    return { ok: true };
  }

  /** Exchange a link token for a normal session (access + refresh tokens). */
  async redeem(token: string, ipAddress?: string, userAgent?: string) {
    if (!token || token.length < 20) throw new UnauthorizedException('invalid link');
    const link = await this.prisma.demoAccessLink.findUnique({ where: { tokenHash: this.hash(token) } });
    const now = Date.now();
    if (!link) throw new UnauthorizedException('This demo link is not valid.');
    if (link.revokedAt) throw new UnauthorizedException('This demo link has been revoked.');
    if (link.expiresAt.getTime() < now) throw new UnauthorizedException('This demo link has expired.');
    if (link.maxUses != null && link.useCount >= link.maxUses) throw new UnauthorizedException('This demo link has already been used.');

    await this.prisma.$transaction([
      this.prisma.demoAccessLink.update({ where: { id: link.id }, data: { useCount: { increment: 1 }, lastUsedAt: new Date() } }),
      this.prisma.demoAccessLinkUse.create({ data: { linkId: link.id, ipAddress: ipAddress ?? null, userAgent: userAgent ?? null } }),
    ]);
    const session = await this.auth.issueSessionForUser(link.userId, {
      ipAddress,
      // Tag the session with the link so revoking the link can end it.
      userAgent: `demo-link:${link.id} ${userAgent ?? ''}`.trim(),
      sessionExpiresAt: link.expiresAt,
    });
    this.log.log(`demo link redeemed: ${link.label} (…${link.tokenTail}) from ${ipAddress ?? '?'}`);
    return { ...session, role: link.role, label: link.label, expiresAt: link.expiresAt };
  }

  private view(l: { id: string; label: string; role: string; tokenTail: string; expiresAt: Date; revokedAt: Date | null; maxUses: number | null; useCount: number; lastUsedAt: Date | null; createdAt: Date; createdByUserId: string | null }) {
    const active = !l.revokedAt && l.expiresAt.getTime() > Date.now() && (l.maxUses == null || l.useCount < l.maxUses);
    return {
      id: l.id,
      label: l.label,
      role: l.role,
      tokenTail: l.tokenTail,
      expiresAt: l.expiresAt,
      revokedAt: l.revokedAt,
      maxUses: l.maxUses,
      useCount: l.useCount,
      lastUsedAt: l.lastUsedAt,
      createdAt: l.createdAt,
      createdByUserId: l.createdByUserId,
      active,
    };
  }
}
