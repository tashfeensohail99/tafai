import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { WhatsAppRealtimePublisher } from './publisher.service';
import { WhatsAppRealtimeGateway } from './realtime.gateway';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('app.jwt.secret'),
      }),
    }),
  ],
  providers: [WhatsAppRealtimePublisher, WhatsAppRealtimeGateway],
  exports: [WhatsAppRealtimePublisher],
})
export class WhatsAppRealtimeModule {}
