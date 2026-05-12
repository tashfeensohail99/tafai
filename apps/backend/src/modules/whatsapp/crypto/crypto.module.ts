import { Global, Module } from '@nestjs/common';
import { WhatsAppCryptoService } from './crypto.service';

@Global()
@Module({
  providers: [WhatsAppCryptoService],
  exports: [WhatsAppCryptoService],
})
export class WhatsAppCryptoModule {}
