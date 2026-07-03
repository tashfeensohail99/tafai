import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  Param,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { MulterError } from 'multer';
import type { Response } from 'express';
import { ReceptionService } from './reception.service';

/**
 * Multer aborts an oversize/too-many-files upload with a MulterError, which is
 * NOT an HttpException — the global AllExceptionsFilter would map it to a 500.
 * Turn it into a clean 4xx with a customer-friendly message instead.
 */
@Catch(MulterError)
class MulterUploadExceptionFilter implements ExceptionFilter {
  catch(err: MulterError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    const status = tooBig ? 413 : 400;
    res.status(status).json({
      statusCode: status,
      message: tooBig
        ? 'That image is too large — please upload a photo under 8 MB.'
        : 'We could not read that file — please try another image.',
    });
  }
}

/**
 * PUBLIC (no auth) endpoints backing the "scan the desk QR and upload your
 * transfer receipt" page. Gated by the opaque, expiring, single-payment token
 * only — no login. The token carries no PII; a valid one lets the holder read
 * the fee + our receiving-bank details and attach a receipt image to that one
 * pending payment, which finance still verifies. Deliberately has NO
 * @UseGuards, so it is reachable without a CRM session (auth is per-controller
 * in this app — see PublicDownloadsController). Rate-limited via ThrottlerGuard
 * (default 100 req / 60s per IP) since it is unauthenticated.
 */
@UseGuards(ThrottlerGuard)
@Controller('public/consult-pay')
export class PublicConsultPayController {
  constructor(private readonly reception: ReceptionService) {}

  /** Fee + receiving-bank details for the public page to render. */
  @Get(':token')
  info(@Param('token') token: string) {
    return this.reception.getConsultPayInfo(token);
  }

  /** Store the customer's uploaded receipt/screenshot on the pending payment. */
  @Post(':token/upload')
  // A receipt upload triggers a billed OCR read; cap it tighter than the
  // controller default (a customer needs one or two tries, not a page-nav budget).
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @UseFilters(MulterUploadExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 8 * 1024 * 1024, files: 1 }, // 8 MB — a phone screenshot/photo
    }),
  )
  upload(
    @Param('token') token: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('note') _note?: string,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded.');
    return this.reception.uploadConsultProof(token, file.buffer, file.mimetype, file.originalname);
  }
}
