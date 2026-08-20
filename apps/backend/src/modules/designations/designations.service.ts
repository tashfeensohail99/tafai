import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateDesignationDto, UpdateDesignationDto } from './designations.dto';

@Injectable()
export class DesignationsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.designation.findMany({
      where: { isActive: true },
      include: { _count: { select: { employees: true } } },
      orderBy: { name: 'asc' },
    });
  }

  create(dto: CreateDesignationDto) {
    return this.prisma.designation.create({
      data: {
        name: dto.name,
        description: dto.description,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateDesignationDto) {
    const existing = await this.prisma.designation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Designation not found');
    return this.prisma.designation.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        isActive: dto.isActive,
      },
    });
  }
}
