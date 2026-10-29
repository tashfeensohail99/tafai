import { Injectable } from '@nestjs/common';
import { Prisma, SocialPlatform } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface SocialAlertConfigView {
  enabled: boolean;
  enabledAt: Date | null;
  departments: string[];
  platforms: SocialPlatform[];
  channels: string[];
  quietStartHour: number | null;
  quietEndHour: number | null;
  updatedAt: Date;
}

/**
 * The new-post alert config is a single row. This service owns reading it
 * (creating the default, disabled row on first access) and updating it —
 * stamping `enabledAt` the moment it flips on so enabling never back-blasts
 * the existing feed.
 */
@Injectable()
export class SocialAlertConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const existing = await this.prisma.socialAlertConfig.findFirst();
    if (existing) return existing;
    return this.prisma.socialAlertConfig.create({ data: {} });
  }

  async update(patch: {
    enabled?: boolean;
    departments?: string[];
    platforms?: SocialPlatform[];
    channels?: string[];
    quietStartHour?: number | null;
    quietEndHour?: number | null;
  }) {
    const current = await this.get();
    const data: Prisma.SocialAlertConfigUpdateInput = {};
    if (patch.departments !== undefined) data.departments = patch.departments;
    if (patch.platforms !== undefined) data.platforms = patch.platforms;
    if (patch.channels !== undefined) data.channels = patch.channels;
    if (patch.quietStartHour !== undefined) data.quietStartHour = patch.quietStartHour;
    if (patch.quietEndHour !== undefined) data.quietEndHour = patch.quietEndHour;
    if (patch.enabled !== undefined) {
      data.enabled = patch.enabled;
      // Stamp enabledAt only on the OFF→ON transition, so posts already live
      // when alerts are switched on do not all fire at once.
      if (patch.enabled && !current.enabled) data.enabledAt = new Date();
    }
    return this.prisma.socialAlertConfig.update({ where: { id: current.id }, data });
  }

  /** Active department names, for the admin targeting picker. */
  async listDepartments(): Promise<string[]> {
    const rows = await this.prisma.department.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { name: true },
    });
    return [...new Set(rows.map((r) => r.name))];
  }
}
