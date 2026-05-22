import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { UpdateWhatsAppSettingsDto } from './settings.dto';

/**
 * Read/update the org-level WhatsApp + SLA configuration powering the admin
 * "Working hours & SLA" settings page. Single-org system, so we operate on the
 * earliest-created Organization row (same convention the rest of the WhatsApp
 * code uses).
 */
@Injectable()
export class WhatsAppSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async org() {
    const org = await this.prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!org) throw new NotFoundException('Organization not configured');
    return org;
  }

  async get() {
    const o = await this.org();
    return {
      timezone: o.timezone,
      hoursOpen: o.hoursOpen,
      hoursClose: o.hoursClose,
      breakStart: o.breakStart,
      breakEnd: o.breakEnd,
      workingDays: o.workingDays,
      slaResponseSeconds: o.slaResponseSeconds,
      slaWarnBeforeSeconds: o.slaWarnBeforeSeconds,
      slaReassignThreshold: o.slaReassignThreshold,
      slaHandoverBonus: o.slaHandoverBonus,
      autoAckEnabled: o.autoAckEnabled,
      autoAckTemplate: o.autoAckTemplate,
      afterHoursTemplate: o.afterHoursTemplate,
    };
  }

  async update(dto: UpdateWhatsAppSettingsDto) {
    const o = await this.org();
    // Normalise break: an empty string means "no break" → store null on both
    // ends so business-hours math treats the day as one continuous window.
    const breakStart =
      dto.breakStart === undefined ? undefined : dto.breakStart?.trim() ? dto.breakStart.trim() : null;
    const breakEnd =
      dto.breakEnd === undefined ? undefined : dto.breakEnd?.trim() ? dto.breakEnd.trim() : null;

    await this.prisma.organization.update({
      where: { id: o.id },
      data: {
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.hoursOpen !== undefined ? { hoursOpen: dto.hoursOpen } : {}),
        ...(dto.hoursClose !== undefined ? { hoursClose: dto.hoursClose } : {}),
        ...(breakStart !== undefined ? { breakStart } : {}),
        ...(breakEnd !== undefined ? { breakEnd } : {}),
        ...(dto.workingDays !== undefined ? { workingDays: dto.workingDays } : {}),
        ...(dto.slaResponseSeconds !== undefined ? { slaResponseSeconds: dto.slaResponseSeconds } : {}),
        ...(dto.slaWarnBeforeSeconds !== undefined ? { slaWarnBeforeSeconds: dto.slaWarnBeforeSeconds } : {}),
        ...(dto.slaReassignThreshold !== undefined ? { slaReassignThreshold: dto.slaReassignThreshold } : {}),
        ...(dto.slaHandoverBonus !== undefined ? { slaHandoverBonus: dto.slaHandoverBonus } : {}),
        ...(dto.autoAckEnabled !== undefined ? { autoAckEnabled: dto.autoAckEnabled } : {}),
        ...(dto.autoAckTemplate !== undefined ? { autoAckTemplate: dto.autoAckTemplate } : {}),
        ...(dto.afterHoursTemplate !== undefined ? { afterHoursTemplate: dto.afterHoursTemplate } : {}),
      },
    });
    return this.get();
  }
}
