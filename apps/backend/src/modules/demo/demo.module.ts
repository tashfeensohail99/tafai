import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DemoAccessService } from './demo-access.service';
import { DemoSyncService } from './demo-sync.service';
import { DemoAdminController, DemoPublicController, PublicConfigController } from './demo.controller';

/**
 * Sales-demo support: public /config, prospect sign-in links, and the
 * production → demo masked sync. Always registered; everything that could do
 * harm is gated on DEMO_MODE / DEMO_SYNC_ENABLED so production is unaffected.
 */
@Module({
  imports: [AuthModule],
  controllers: [PublicConfigController, DemoPublicController, DemoAdminController],
  providers: [DemoSyncService, DemoAccessService],
  exports: [DemoSyncService],
})
export class DemoModule {}
