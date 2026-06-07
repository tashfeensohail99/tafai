import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequireAnyPermissions } from '../../common/decorators/require-permissions.decorator';
import { AuditDocumentAccess } from '../../common/decorators/audit-document-access.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './expenses.dto';

/** Finance writes; reuses the finance permission set Finance already holds. */
const WRITE = ['finance.record_payment', 'finance.create_invoice', 'settings.manage'] as const;

@Controller('finance/expenses')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Post()
  @RequireAnyPermissions(...WRITE)
  create(@Body() dto: CreateExpenseDto, @CurrentUser() user: RequestUser) {
    return this.expenses.create(dto, user.id);
  }

  @Get(':id/receipt-url')
  @RequireAnyPermissions('finance.view_all', ...WRITE)
  @AuditDocumentAccess('ExpenseReceipt', 'id')
  receiptUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.expenses.getReceiptUrl(id);
  }

  @Delete(':id')
  @RequireAnyPermissions(...WRITE)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.expenses.remove(id, user.id);
  }
}
