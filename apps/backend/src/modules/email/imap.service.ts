import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImapFlow } from 'imapflow';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ActivityTimelineService } from '../activity-timeline/activity-timeline.service';
import { TimelineEventType } from '@prisma/client';

// imapflow doesn't ship a complete TS types file; declare what we use
interface FetchedMessage {
  uid: number;
  envelope: {
    messageId?: string;
    date?: Date;
    from?: Array<{ address?: string; name?: string }>;
    to?: Array<{ address?: string }>;
    subject?: string;
  };
  bodyText?: string;
  bodyHTML?: string;
}

const POLL_INTERVAL_MS = 3 * 60 * 1_000; // 3 minutes
/** Max messages processed per poll — bounds how long the IMAP connection is
 *  held open so a big backlog can't trip the socket timeout. The rest drain on
 *  subsequent polls. */
const MAX_PER_POLL = 30;

@Injectable()
export class ImapService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ImapService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly timeline: ActivityTimelineService,
  ) {}

  onModuleInit() {
    const host = this.config.get<string>('IMAP_HOST');
    const user = this.config.get<string>('IMAP_USER') ?? this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('IMAP_PASS') ?? this.config.get<string>('SMTP_PASS');

    if (!host || !user || !pass) {
      this.log.warn('IMAP_HOST / IMAP_USER / IMAP_PASS not set — inbound email polling disabled');
      return;
    }

    // Initial poll after 30s (let the app fully boot first), then every 3 min
    setTimeout(() => void this.poll(), 30_000);
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    this.log.log(`Inbound email polling started (every ${POLL_INTERVAL_MS / 60_000} min)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ── Main poll ─────────────────────────────────────────────────────────────

  async poll(): Promise<void> {
    const host = this.config.get<string>('IMAP_HOST') ?? 'imap.hostinger.com';
    const port = parseInt(this.config.get<string>('IMAP_PORT') ?? '993', 10);
    const secure = (this.config.get<string>('IMAP_SECURE') ?? 'true') !== 'false';
    const user = (this.config.get<string>('IMAP_USER') ?? this.config.get<string>('SMTP_USER'))!;
    const pass = (this.config.get<string>('IMAP_PASS') ?? this.config.get<string>('SMTP_PASS'))!;

    const client = new ImapFlow({
      host,
      port,
      secure,
      auth: { user, pass },
      logger: false, // suppress imapflow's default console output
      // Fail fast on a dead connection, and give the socket a generous idle
      // budget so a normal batch never trips Hostinger's "Socket timeout".
      connectionTimeout: 20_000,
      greetingTimeout: 15_000,
      socketTimeout: 120_000,
    });

    // ImapFlow emits 'error' on async socket failures (ETIMEOUT, ECONNRESET,
    // TLS handshake aborts) *outside* the try/catch around connect/fetch.
    // Without a listener, Node's default unhandled-'error' rule kills the
    // whole process — that's what was crashing the backend roughly every
    // 3 minutes when Hostinger's IMAP TLS connection idled out. Logging-
    // only handler keeps the process alive; the try/catch below already
    // surfaces the same error on the await chain so we don't lose
    // diagnosis quality.
    client.on('error', (err: Error) => {
      this.log.warn(
        `IMAP socket error (will recover on next poll): ${err.message}`,
      );
    });

    try {
      await client.connect();
      const fetched: FetchedMessage[] = [];
      const lock = await client.getMailboxLock('INBOX');

      try {
        // Only fetch UNSEEN messages to avoid reprocessing.
        const uids = await client.search({ seen: false }, { uid: true });
        if (!uids || uids.length === 0) return;

        // Bound work per poll so a large backlog can't hold the connection open
        // long enough to time out; the remainder drains on subsequent polls.
        const batch = uids.slice(0, MAX_PER_POLL);
        this.log.debug(`Found ${uids.length} unseen message(s); processing ${batch.length}`);

        // Drain the fetch stream into memory FIRST. The old code awaited the DB
        // write (processMessage) *inside* the fetch loop — so while Postgres was
        // slow (pool contention) the IMAP socket sat idle, Hostinger dropped it
        // ("Socket timeout" → "Connection not available"), and the whole backlog
        // was re-found unprocessed on every poll. Draining first keeps the IMAP
        // read fast and contiguous; the slow DB work happens after.
        for await (const msg of client.fetch(
          batch.join(','),
          { uid: true, envelope: true, bodyText: true, bodyHTML: true } as Parameters<typeof client.fetch>[1],
          { uid: true },
        ) as AsyncIterable<FetchedMessage>) {
          fetched.push(msg);
        }
      } finally {
        lock.release();
      }

      // Store each (idempotent — dedup by messageId), collecting successes. A
      // single bad message is logged and skipped, never aborting the batch.
      // Anything stored-but-not-flagged simply gets re-flagged next poll, so no
      // inbound email is ever lost.
      const processedUids: number[] = [];
      for (const msg of fetched) {
        try {
          await this.processMessage(msg);
          processedUids.push(msg.uid);
        } catch (e) {
          this.log.warn(
            `IMAP message uid=${msg.uid} failed (will retry next poll): ${(e as Error).message}`,
          );
        }
      }

      // Mark Seen in ONE batched call — minimal time on the wire.
      if (processedUids.length > 0) {
        await client.messageFlagsAdd({ uid: processedUids.join(',') }, ['\\Seen'], { uid: true });
        this.log.debug(`Processed + marked Seen: ${processedUids.length} message(s)`);
      }

      await client.logout();
    } catch (err) {
      this.log.error(`IMAP poll failed: ${(err as Error).message}`);
      // Always try to logout cleanly
      try {
        await client.logout();
      } catch {
        // ignore
      }
    }
  }

  // ── Process a single message ──────────────────────────────────────────────

  private async processMessage(msg: FetchedMessage): Promise<void> {
    const rawMessageId = msg.envelope?.messageId ?? `uid-${msg.uid}-${Date.now()}`;
    const fromAddress = msg.envelope?.from?.[0]?.address?.toLowerCase() ?? '';
    const fromName = msg.envelope?.from?.[0]?.name ?? null;
    const toAddress = msg.envelope?.to?.[0]?.address ?? '';
    const subject = msg.envelope?.subject ?? null;
    const receivedAt = msg.envelope?.date ?? new Date();
    const bodyText = msg.bodyText ?? null;
    const bodyHtml = msg.bodyHTML ?? null;

    // Deduplication: skip if already stored
    const existing = await this.prisma.incomingEmail.findUnique({
      where: { messageId: rawMessageId },
      select: { id: true },
    });
    if (existing) return;

    // Match sender email → lead or client
    let leadId: string | null = null;
    let clientId: string | null = null;

    if (fromAddress) {
      const matchedClient = await this.prisma.client.findFirst({
        where: { email: fromAddress, deletedAt: null },
        select: { id: true },
      });
      if (matchedClient) {
        clientId = matchedClient.id;
      } else {
        const matchedLead = await this.prisma.lead.findFirst({
          where: { email: fromAddress, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (matchedLead) leadId = matchedLead.id;
      }
    }

    // Store the email
    await this.prisma.incomingEmail.create({
      data: {
        messageId: rawMessageId,
        fromAddress,
        fromName,
        toAddress,
        subject,
        bodyText,
        bodyHtml,
        receivedAt,
        leadId,
        clientId,
      },
    });

    // Activity timeline entry (only if we matched a lead or client)
    if (leadId || clientId) {
      const snippet = (bodyText ?? subject ?? '(no content)').slice(0, 120).replace(/\n/g, ' ');
      await this.timeline.record({
        entityType: clientId ? 'Client' : 'Lead',
        entityId: (clientId ?? leadId)!,
        leadId: leadId ?? undefined,
        clientId: clientId ?? undefined,
        eventType: TimelineEventType.EMAIL_RECEIVED,
        description: `Email received from ${fromName ? `${fromName} <${fromAddress}>` : fromAddress}: "${subject ?? '(no subject)'}" — ${snippet}`,
        actorUserId: undefined,
        metadata: {
          fromAddress,
          fromName,
          subject,
          receivedAt: receivedAt.toISOString(),
        },
      });
    }

    this.log.debug(
      `Processed email from ${fromAddress} — ${leadId ? 'lead ' + leadId : clientId ? 'client ' + clientId : 'unmatched'}`,
    );
  }
}
