import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WhatsAppMetaClientFactory } from './client.factory';

/**
 * One-shot enabler for WhatsApp user-initiated **calling** + the in-chat call
 * button. Gated by the `WHATSAPP_ENABLE_CALLING` env flag so it only runs when
 * we mean it to: set the flag → redeploy → it logs the current calling settings,
 * enables calling (`status=ENABLED`, `call_icon_visibility=DEFAULT`) on every
 * ACTIVE channel, logs the result → then unset the flag.
 *
 * Setting calling status requires the number's OWN access token (not the
 * app-level token), which only the backend can decrypt — hence this runs here.
 * Idempotent and fully guarded; a failure never blocks boot.
 */
@Injectable()
export class CallingBootstrapService implements OnModuleInit {
  private readonly log = new Logger(CallingBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaFactory: WhatsAppMetaClientFactory,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.WHATSAPP_ENABLE_CALLING !== 'true') return;
    this.log.log('enable-calling: WHATSAPP_ENABLE_CALLING=true — enabling calling on ACTIVE channels');
    try {
      const channels = await this.prisma.whatsAppChannel.findMany({
        where: { status: 'ACTIVE' },
      });
      if (channels.length === 0) {
        this.log.warn('enable-calling: no ACTIVE channels found');
        return;
      }
      for (const channel of channels) {
        const tag = `enable-calling[${channel.displayNumber}]`;
        try {
          const client = this.metaFactory.forChannel(channel);
          const before = await client.getPhoneSettings();
          this.log.log(`${tag} BEFORE calling=${JSON.stringify((before as { calling?: unknown }).calling ?? null)}`);
          const res = await client.enableCalling();
          this.log.log(`${tag} update response=${JSON.stringify(res)}`);
          const after = await client.getPhoneSettings();
          this.log.log(`${tag} AFTER calling=${JSON.stringify((after as { calling?: unknown }).calling ?? null)}`);
        } catch (err) {
          this.log.error(`${tag} FAILED: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.log.error(`enable-calling bootstrap failed: ${(err as Error).message}`);
    }
  }
}
