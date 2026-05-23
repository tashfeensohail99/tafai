import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AgreementRenderService } from './agreement-render.service';
import {
  CreateAgreementTemplateDto,
  PreviewTemplateDto,
  UpdateAgreementTemplateDto,
} from './agreements.dto';

@Injectable()
export class AgreementTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly render: AgreementRenderService,
  ) {}

  list(includeInactive = false) {
    return this.prisma.agreementTemplate.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async get(id: string) {
    const template = await this.prisma.agreementTemplate.findUnique({
      where: { id },
    });
    if (!template) throw new NotFoundException('Agreement template not found');
    return template;
  }

  async create(dto: CreateAgreementTemplateDto) {
    const existing = await this.prisma.agreementTemplate.findUnique({
      where: { categoryKey: dto.categoryKey },
    });
    if (existing) {
      throw new ConflictException(
        `A template already exists for category "${dto.categoryKey}"`,
      );
    }
    return this.prisma.agreementTemplate.create({
      data: {
        categoryKey: dto.categoryKey,
        name: dto.name,
        programTitle: dto.programTitle,
        bodyHtml: dto.bodyHtml,
        defaultStages: this.toJson(dto.defaultStages),
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(id: string, dto: UpdateAgreementTemplateDto) {
    await this.get(id); // 404 if missing
    return this.prisma.agreementTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.programTitle !== undefined
          ? { programTitle: dto.programTitle }
          : {}),
        ...(dto.bodyHtml !== undefined ? { bodyHtml: dto.bodyHtml } : {}),
        ...(dto.defaultStages !== undefined
          ? { defaultStages: this.toJson(dto.defaultStages) }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
  }

  /** Render a (possibly unsaved) template to a preview PDF buffer. */
  previewPdf(dto: PreviewTemplateDto): Promise<Buffer> {
    return this.render.renderTemplatePreviewPdf(
      dto.programTitle,
      dto.bodyHtml,
      dto.defaultStages?.map((s) => ({
        label: s.label,
        amount: s.amount ?? null,
        trigger: s.trigger ?? null,
      })),
    );
  }

  /** The list of {{TOKENS}} authors may use, surfaced to the editor UI. */
  supportedTokens(): string[] {
    return [...AgreementRenderService.SUPPORTED_TOKENS];
  }

  private toJson(
    stages: CreateAgreementTemplateDto['defaultStages'],
  ): Prisma.InputJsonValue | undefined {
    if (stages === undefined) return undefined;
    return stages as unknown as Prisma.InputJsonValue;
  }
}
