import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppCryptoService } from '../crypto/crypto.service';
import { MetaCloudClient } from './cloud-client';

interface ChannelTokenSource {
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
}
