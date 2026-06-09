import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
  Get,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import {
  LoginDto,
  RefreshTokenDto,
  RequestPasswordResetDto,
  CompletePasswordResetDto,
  ChangePasswordDto,
} from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(
      dto,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body() dto: RefreshTokenDto,
    @CurrentUser() user: RequestUser,
  ) {
    await this.authService.logout(dto.refreshToken, user.id);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: RequestUser) {
    // Enriched profile: id/email/roles/permissions PLUS mustChangePassword +
    // employee{name,department} that the mobile app needs (additive — web is
    // unaffected).
    return this.authService.getProfile(user);
  }

  // Change own password (authenticated). Used by the mobile/web settings screen
  // and the force-change-on-first-login flow (mustChangePassword).
  @Post('password/change')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: RequestUser,
  ) {
    await this.authService.changePassword(user.id, dto);
    return { message: 'Password changed successfully' };
  }

  // Canonical paths are `password/reset-request` + `password/reset` (what the
  // mobile app expects); the legacy `password-reset/*` paths are kept as aliases
  // so nothing already pointing at them breaks.
  @Post(['password/reset-request', 'password-reset/request'])
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    await this.authService.requestPasswordReset(dto);
    return { message: 'If that email exists, a reset link has been sent.' };
  }

  @Post(['password/reset', 'password-reset/complete'])
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  async completePasswordReset(@Body() dto: CompletePasswordResetDto) {
    await this.authService.completePasswordReset(dto);
    return { message: 'Password reset successfully' };
  }
}
