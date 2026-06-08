import { Global, Module } from '@nestjs/common';
import { PushService } from './push.service';

/**
 * Global so NotificationsService (and any future producer) can fan out to push
 * without importing this module. PrismaService and ApiKeysService come from
 * their own @Global modules.
 */
@Global()
@Module({
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
