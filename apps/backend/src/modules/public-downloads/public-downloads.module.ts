import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { PublicDownloadsController } from './public-downloads.controller';
import { AppSettingsController } from './app-settings.controller';

@Module({
  imports: [StorageModule],
  controllers: [PublicDownloadsController, AppSettingsController],
})
export class PublicDownloadsModule {}
