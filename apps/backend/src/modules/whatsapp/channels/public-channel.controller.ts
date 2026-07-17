import { Controller, Get, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WhatsAppChannelStatus } from '@prisma/client';

/**
 * The public marketing site's click-to-WhatsApp buttons need the number they
 * should open. That number already exists — WhatsAppChannel.displayNumber — and
 * duplicating it into the website's env would create a second source of truth:
 * switch the active channel in the admin panel and the website would silently
 * keep sending customers to the old number, where nothing is listening.
 *
 * So the site reads it from here at build time. One source of truth, the CRM.
 *
 * Unauthenticated by design, like the other public/* controllers: this returns
 * only the business number the firm publishes on its own website anyway. It does
 * NOT expose the WABA id, the phone-number id, or the access token.
 */
@Controller('public/whatsapp')
export class PublicWhatsAppChannelController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The number the website should point at: the ACTIVE channel, oldest first so
   * the answer is stable if a second one is ever added.
   *
   * `digits` is E.164 without the "+", which is the form wa.me requires — the
   * stored displayNumber is human-formatted ("+92 3350001111") and would break
   * the link verbatim.
   */
  @Get('channel')
  async channel(): Promise<{ digits: string; display: string }> {
    const ch = await this.prisma.whatsAppChannel.findFirst({
      where: { status: WhatsAppChannelStatus.ACTIVE },
      orderBy: { createdAt: 'asc' },
      select: { displayNumber: true },
    });
    if (!ch) throw new NotFoundException('No active WhatsApp channel');

    const digits = ch.displayNumber.replace(/\D/g, '');
    return { digits, display: ch.displayNumber };
  }
}
