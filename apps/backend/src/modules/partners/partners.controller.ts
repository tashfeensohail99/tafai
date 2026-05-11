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
import { PartnersService } from './partners.service';
import {
  CreatePartnerDto,
  ListPartnersQueryDto,
  UpdatePartnerDto,
} from './partners.dto';

@Controller('partners')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PartnersController {
  constructor(private readonly partnersService: PartnersService) {}

  @Get()
  @RequirePermissions('partners.view_all')
  findAll(@Query() query: ListPartnersQueryDto) {
    return this.partnersService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('partners.view_all')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.partnersService.findById(id);
  }

  @Post()
  @RequirePermissions('partners.create')
  create(@Body() dto: CreatePartnerDto, @CurrentUser() user: RequestUser) {
    return this.partnersService.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('partners.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartnerDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.partnersService.update(id, dto, user.id);
  }
}