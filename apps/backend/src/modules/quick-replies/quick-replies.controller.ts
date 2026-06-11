import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequireAnyPermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { QuickRepliesService } from './quick-replies.service';

@Controller('quick-replies')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequireAnyPermissions('whatsapp.send_message', 'whatsapp.view_all_inboxes')
export class QuickRepliesController {
  constructor(private readonly quickReplies: QuickRepliesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.quickReplies.listFor(user);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() body: { title: string; body: string; team?: boolean },
  ) {
    return this.quickReplies.create(user, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { title?: string; body?: string },
  ) {
    return this.quickReplies.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.quickReplies.remove(user, id);
  }
}
