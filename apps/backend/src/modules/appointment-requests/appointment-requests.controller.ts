import { Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequireAnyPermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Audit } from '../../common/decorators/audit.decorator';

class ListQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED'])
  status?: string;
  @IsOptional()
  @IsString()
  search?: string;
}

/**
 * Sales-facing inbox of bot-captured appointment requests across all
 * threads. Lives at /sales/appointment-requests for both the API and the
 * frontend page. Defaults to PENDING — the actionable list. Sales clicks
 * through to the chat to book the actual appointment (the existing
 * BookAppointmentModal flow + auto-CONFIRMED handshake from Phase 1).
 */
@Controller('sales/appointment-requests')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AppointmentRequestsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequireAnyPermissions('appointments.view_all', 'appointments.view_assigned')
  async list(
    @CurrentUser() user: RequestUser,
    @Query() q: ListQueryDto,
  ) {
    const status = q.status ?? 'PENDING';
    const where: {
      status: string;
      lead?: {
        OR?: Array<Record<string, unknown>>;
        assignedEmployeeId?: string;
      };
    } = { status };

    // Permission gate: if the caller has only "view_assigned" (not
    // "view_all"), they should see only requests on leads assigned to
    // their employee. Mirrors how /appointments enforces scope.
    const canViewAll = (user.permissions ?? []).includes('appointments.view_all');
    if (!canViewAll) {
      const employee = await this.prisma.employee.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (!employee) return [];
      where.lead = { assignedEmployeeId: employee.id };
    }

    if (q.search) {
      const s = q.search.trim();
      const orFilters: Array<Record<string, unknown>> = [
        { firstName: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s.replace(/\D/g, '') } },
      ];
      where.lead = { ...(where.lead ?? {}), OR: orFilters };
    }

    return this.prisma.appointmentRequest.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    }).then(async (rows) => {
      // Attach the lead so the page can render name + phone + assigned agent.
      const leadIds = [...new Set(rows.map((r) => r.leadId))];
      const leads = await this.prisma.lead.findMany({
        where: { id: { in: leadIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          assignedEmployee: { select: { firstName: true, lastName: true } },
        },
      });
      const leadMap = new Map(leads.map((l) => [l.id, l]));
      return rows.map((r) => ({
        ...r,
        lead: leadMap.get(r.leadId) ?? null,
      }));
    });
  }

  /** Mark a PENDING request as REJECTED — sales decided not to book. */
  @Audit({ entityType: 'AppointmentRequest', category: 'MUTATION', severity: 'MEDIUM', idParam: 'id' })
  @Patch(':id/reject')
  @RequireAnyPermissions('appointments.view_all', 'appointments.view_assigned')
  async reject(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const updated = await this.prisma.appointmentRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', closedAt: new Date(), closedByUserId: user.id },
    });
    return { rejected: updated.count > 0 };
  }
}
