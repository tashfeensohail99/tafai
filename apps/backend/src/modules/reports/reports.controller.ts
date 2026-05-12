import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  @RequirePermissions('reports.view')
  getDashboardSummary() {
    return this.reportsService.getDashboardSummary();
  }

  @Get('workflow-board')
  @RequirePermissions('reports.view')
  getWorkflowBoard() {
    return this.reportsService.getWorkflowBoard();
  }

  /**
   * Per-agent sales KPIs for the admin sales overview page. Permission
   * `reports.view` is sufficient — same gate as the dashboard.
   */
  @Get('sales-overview')
  @RequirePermissions('reports.view')
  getSalesOverview() {
    return this.reportsService.getSalesOverview();
  }
}