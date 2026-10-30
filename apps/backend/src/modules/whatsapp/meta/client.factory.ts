import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppCryptoService } from '../crypto/crypto.service';
import { MetaCloudClient } from './cloud-client';
import { MessengerCloudClient } from './messenger-client';
import { isOutboundBlocked } from '../../../common/demo-mode';

interface ChannelTokenSource {
  phoneNumberId: string;
  accessTokenEnc: string;
}

interface MessengerChannelTokenSource {
  pageId: string | null;
  phoneNumberId: string;
  accessTokenEnc: string;
}

/** Token marker the demo sync writes instead of a real encrypted token. */
const DEMO_TOKEN_MARKER = 'demo:';

@Injectable()
export class WhatsAppMetaClientFactory {
  private readonly log = new Logger(WhatsAppMetaClientFactory.name);

  constructor(
    private readonly config: ConfigService,
    private readonly crypto: WhatsAppCryptoService,
  ) {}

  forChannel(channel: ChannelTokenSource): MetaCloudClient {
    const demoBlocked = this.isBlocked(channel);
    const accessToken = demoBlocked ? 'demo-blocked' : this.crypto.decrypt(channel.accessTokenEnc);
    return new MetaCloudClient({
      apiVersion: this.config.get<string>('app.whatsapp.metaGraphApiVersion') ?? 'v21.0',
      phoneNumberId: channel.phoneNumberId,
      accessToken,
      demoBlocked,
    });
  }

  /** Build a Facebook Messenger Send-API client for a MESSENGER/INSTAGRAM channel. */
  forMessengerChannel(channel: MessengerChannelTokenSource): MessengerCloudClient {
    const demoBlocked = this.isBlocked(channel);
    const accessToken = demoBlocked ? 'demo-blocked' : this.crypto.decrypt(channel.accessTokenEnc);
    return new MessengerCloudClient({
      apiVersion: this.config.get<string>('app.whatsapp.metaGraphApiVersion') ?? 'v21.0',
      // pageId is the authoritative external id; phoneNumberId mirrors it for
      // Messenger channels (see WhatsAppChannel schema), so fall back to it.
      pageId: channel.pageId ?? channel.phoneNumberId,
      accessToken,
      demoBlocked,
    });
  }

  /**
   * DEMO_MODE: every channel is blocked except the live-lane numbers listed in
   * DEMO_LIVE_PHONE_NUMBER_IDS. A channel whose stored token is the sync's
   * "demo:" marker is blocked regardless of the env (defence in depth — the
   * production token was never copied, so nothing could be sent anyway).
   */
  private isBlocked(channel: ChannelTokenSource): boolean {
    if (channel.accessTokenEnc.startsWith(DEMO_TOKEN_MARKER)) {
      if (!isOutboundBlocked(channel.phoneNumberId)) {
        this.log.warn(`channel ${channel.phoneNumberId} has a demo token marker but is not blocked by env — blocking anyway`);
      }
      return true;
    }
    return isOutboundBlocked(channel.phoneNumberId);
  }
}
