import { Inject, Logger, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import IORedis, { Redis } from 'ioredis';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { redisOrgChannel, redisEmpChannel } from '../queues/queue-contracts';

interface AgentSocketData {
  userId: string;
  employeeId: string | null;
  organizationId: string;
  roles: string[];
}

declare module 'socket.io' {
  interface SocketData extends AgentSocketData {}
}

/**
 * Realtime push for the WhatsApp inbox.
 *
 * Lifecycle:
 *  - Mounted at `/whatsapp/realtime`. Each connected agent passes a JWT.
 *  - On connect, we verify the token, look up the employee, and join the
 *    socket to a room named `org:<organizationId>`.
 *  - A single Redis subscriber listens on `whatsapp:org:*` channels. Every
 *    message published by a processor is fanned out to the matching room.
 *
 * This means every processor (ingest, outbound) just calls
 * `WhatsAppRealtimePublisher.publishToOrg(...)` and every agent in that
 * org receives the event immediately, regardless of which backend
 * instance they're connected to.
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },
  path: '/whatsapp/realtime',
})
export class WhatsAppRealtimeGateway
  implements OnModuleInit, OnModuleDestroy, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly log = new Logger(WhatsAppRealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  private subscriber: Redis | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('app.redis.url') ?? 'redis://localhost:6379';
    this.subscriber = new IORedis(url, { maxRetriesPerRequest: null });
    this.subscriber.on('error', (err) => this.log.error(`redis sub error: ${err.message}`));
    await this.subscriber.psubscribe('whatsapp:org:*', 'whatsapp:emp:*');
    this.subscriber.on('pmessage', (_pattern, channel, payload) => {
      try {
        const parsed = JSON.parse(payload) as { event: string; data: unknown };
        this.server.to(channel).emit(parsed.event, parsed.data);
      } catch (err) {
        this.log.error(`fanout parse failed on ${channel}: ${(err as Error).message}`);
      }
    });
    this.log.log('WhatsApp realtime gateway online');
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit();
    this.subscriber = null;
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token =
        (client.handshake.auth?.['token'] as string | undefined) ??
        client.handshake.headers.authorization?.toString().replace(/^Bearer\s+/i, '');
      if (!token) throw new UnauthorizedException('Missing JWT');

      const secret = this.config.get<string>('app.jwt.secret');
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        email?: string;
        roles?: string[];
      }>(token, { secret });

      // Look up the user + their employee profile + their organization. For
      // single-tenant Tashfeen there's exactly one organization row; we still
      // resolve it explicitly so multi-tenancy is a future flag flip.
      const user = await this.prisma.userAccount.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          status: true,
          employee: { select: { id: true, branchId: true } },
        },
      });
      if (!user || user.status !== 'ACTIVE') {
        throw new UnauthorizedException('Inactive user');
      }

      const org = await this.prisma.organization.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!org) throw new UnauthorizedException('No organization configured');

      client.data = {
        userId: user.id,
        employeeId: user.employee?.id ?? null,
        organizationId: org.id,
        roles: payload.roles ?? [],
      };

      const room = redisOrgChannel(org.id);
      await client.join(room);
      // Also join a per-employee room so we can ring just this rep (calls).
      if (user.employee?.id) {
        await client.join(redisEmpChannel(user.employee.id));
      }
      client.emit('connected', { ok: true, room });
      this.log.log(`agent ${user.id} connected → ${room}`);
    } catch (err) {
      this.log.warn(`rejected socket: ${(err as Error).message}`);
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: Socket): void {
    // Rooms are cleared automatically. No-op.
  }
}
