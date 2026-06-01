import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { Redis } from 'ioredis';
import { WHATSAPP_WS_EVENTS, redisOrgChannel, redisEmpChannel, type WhatsAppWsEvent } from '../queues/queue-contracts';

/**
 * Single Redis client for publishing WhatsApp realtime events from the
 * processors → the WebSocket gateway. The gateway runs its own subscriber
 * on the same Redis instance and fans out to connected agent sockets.
 *
 * Using Redis pub/sub keeps things simple and horizontally scalable: every
 * backend instance can publish; every gateway instance can subscribe; agents
 * always receive events regardless of which instance they're connected to.
 */
@Injectable()
export class WhatsAppRealtimePublisher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WhatsAppRealtimePublisher.name);
  private client: Redis | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('app.redis.url') ?? 'redis://localhost:6379';
    this.client = new IORedis(url, { maxRetriesPerRequest: null });
    this.client.on('error', (err) => this.log.error(`redis publisher error: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
    this.client = null;
  }

  /**
   * Publish an event scoped to an organization. Every connected agent in
   * that org receives it via the Socket.IO gateway.
   */
  async publishToOrg(
    organizationId: string,
    event: WhatsAppWsEvent,
    data: unknown,
  ): Promise<void> {
    if (!this.client) {
      this.log.warn('publish before init — dropping event');
      return;
    }
    const channel = redisOrgChannel(organizationId);
    await this.client.publish(channel, JSON.stringify({ event, data }));
  }

  /**
   * Publish an event to a SINGLE employee (all their connected sockets), e.g.
   * ringing the assigned rep for an inbound call. The gateway joins each socket
   * to `whatsapp:emp:{employeeId}` on connect.
   */
  async publishToEmployee(
    employeeId: string,
    event: WhatsAppWsEvent,
    data: unknown,
  ): Promise<void> {
    if (!this.client) {
      this.log.warn('publish (emp) before init — dropping event');
      return;
    }
    await this.client.publish(redisEmpChannel(employeeId), JSON.stringify({ event, data }));
  }
}

export { WHATSAPP_WS_EVENTS };
