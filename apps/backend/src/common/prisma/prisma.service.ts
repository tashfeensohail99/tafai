import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    if (process.env.DATABASE_CONNECT_ON_STARTUP === 'false') {
      this.logger.warn('Skipping startup database connection check');
      return;
    }

    try {
      await this.$connect();
      this.logger.log('Database connected');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Database connection failed on startup; continuing so the service stays online. ${message}`,
      );

      if (process.env.DATABASE_CONNECT_REQUIRED === 'true') {
        throw error;
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }
}
