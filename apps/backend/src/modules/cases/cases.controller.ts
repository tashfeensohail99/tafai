import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { CasesService } from './cases.service';
import {
  ChangeCaseStatusDto,
  CreateCaseDto,
  HandoverCaseDto,
  ListCasesQueryDto,
  UpdateCaseDto,
} from './cases.dto';

@Controller('cases')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Get()
  @RequirePermissions('cases.view_all')
  findAll(@Query() query: ListCasesQueryDto) {
    return this.casesService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('cases.view_all')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.casesService.findById(id);
  }

  @Post()
  @RequirePermissions('cases.create')
  create(@Body() dto: CreateCaseDto, @CurrentUser() user: RequestUser) {
    return this.casesService.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('cases.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCaseDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.casesService.update(id, dto, user.id);
  }

  @Post(':id/status')
  @RequirePermissions('cases.change_status')
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeCaseStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.casesService.changeStatus(id, dto, user.id);
  }

  @Post(':id/handover')
  @RequirePermissions('cases.handover')
  handover(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HandoverCaseDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.casesService.handover(id, dto, user.id);
  }
}