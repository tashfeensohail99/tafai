import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppCryptoService } from '../crypto/crypto.service';
import { MetaCloudClient } from './cloud-client';
import { MessengerCloudClient } from './messenger-client';

interface ChannelTokenSource {
  phoneNumberId: string;
  accessTokenEnc: string;
}

interface MessengerChannelTokenSource {
  pageId: string | null;
  phoneNumberId: string;
  accessTokenEnc: string;
}

@Injectable()
export class WhatsAppMetaClientFactory {
  constructor(
    private readonly config: ConfigService,
    private readonly crypto: WhatsAppCryptoService,
  ) {}

  forChannel(channel: ChannelTokenSource): MetaCloudClient {
    const accessToken = this.crypto.decrypt(channel.accessTokenEnc);
    return new MetaCloudClient({
      apiVersion: this.config.get<string>('app.whatsapp.metaGraphApiVersion') ?? 'v21.0',
      phoneNumberId: channel.phoneNumberId,
      accessToken,
    });
  }

  /** Build a Facebook Messenger Send-API client for a MESSENGER/INSTAGRAM channel. */
  forMessengerChannel(channel: MessengerChannelTokenSource): MessengerCloudClient {
    const accessToken = this.crypto.decrypt(channel.accessTokenEnc);
    return new MessengerCloudClient({
      apiVersion: this.config.get<string>('app.whatsapp.metaGraphApiVersion') ?? 'v21.0',
      // pageId is the authoritative external id; phoneNumberId mirrors it for
      // Messenger channels (see WhatsAppChannel schema), so fall back to it.
      pageId: channel.pageId ?? channel.phoneNumberId,
      accessToken,
    });
  }
}
