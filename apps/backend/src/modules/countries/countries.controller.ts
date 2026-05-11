import {
  Body,
  Controller,
  Get,
  Param,
  ParseBoolPipe,
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
import { CountriesService } from './countries.service';
import { CreateCountryDto, UpdateCountryDto } from './countries.dto';

@Controller('countries')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CountriesController {
  constructor(private readonly countriesService: CountriesService) {}

  @Get()
  @RequirePermissions('settings.manage')
  findAll(@Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean) {
    return this.countriesService.findAll(includeInactive ?? false);
  }

  @Get(':id')
  @RequirePermissions('settings.manage')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.countriesService.findById(id);
  }

  @Post()
  @RequirePermissions('settings.manage')
  create(@Body() dto: CreateCountryDto, @CurrentUser() user: RequestUser) {
    return this.countriesService.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCountryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.countriesService.update(id, dto, user.id);
  }
}