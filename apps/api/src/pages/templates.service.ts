import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { TemplateConfigSchema, TemplateInputSchema, TemplateUpdateSchema, type TemplateConfig } from '@booking/shared';
import { PrismaService } from '../common/prisma.service';
import { AppError, isUniqueViolation } from '../common/errors';
import { AuditService } from '../common/audit.service';
import type { ActorContext } from '../common/request-context';
import type { Prisma } from '../generated/prisma/client';

/** Каталог шаблонов публичных страниц (§13.4). Управляет суперадминистратор. */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Опубликованный каталог для владельцев. */
  async catalog() {
    const rows = await this.prisma.pageTemplate.findMany({
      where: { status: 'published' },
      include: { currentVersion: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.filter((r) => r.currentVersion).map((r) => this.view(r));
  }

  view(r: { id: string; key: string; name: string; description: string | null; status: string; previewAssetId: string | null; createdAt: Date; currentVersion: { id: string; version: number; config: unknown } | null }) {
    return {
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      status: r.status,
      previewAssetId: r.previewAssetId,
      /** Новинка магазина оформлений — шаблон добавлен в последние 30 дней. */
      isNew: Date.now() - r.createdAt.getTime() < 30 * 86400_000,
      createdAt: r.createdAt,
      version: r.currentVersion?.version ?? null,
      versionId: r.currentVersion?.id ?? null,
      config: (r.currentVersion?.config ?? null) as TemplateConfig | null,
    };
  }

  async adminList() {
    const rows = await this.prisma.pageTemplate.findMany({ include: { currentVersion: true, _count: { select: { publications: true } } }, orderBy: { sortOrder: 'asc' } });
    return rows.map((r) => ({ ...this.view(r), publications: r._count.publications }));
  }

  async create(input: z.infer<typeof TemplateInputSchema>, actor: ActorContext) {
    this.assertConfig(input.config);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const t = await tx.pageTemplate.create({ data: { key: input.key, name: input.name, description: input.description, previewAssetId: input.previewAssetId ?? null } });
        const v = await tx.pageTemplateVersion.create({ data: { templateId: t.id, version: 1, config: input.config as Prisma.InputJsonValue, createdByUserId: actor.userId } });
        const updated = await tx.pageTemplate.update({ where: { id: t.id }, data: { currentVersionId: v.id }, include: { currentVersion: true } });
        await this.audit.log(actor, 'template.created', 'page_template', t.id, { after: input }, tx);
        return this.view(updated);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw AppError.conflict('Шаблон с таким ключом уже существует');
      throw e;
    }
  }

  /** Изменение конфигурации создаёт новую версию; опубликованные страницы ссылаются на свою версию. */
  async update(id: string, input: z.infer<typeof TemplateUpdateSchema>, actor: ActorContext) {
    const t = await this.prisma.pageTemplate.findUnique({ where: { id }, include: { currentVersion: true } });
    if (!t) throw AppError.notFound('Шаблон');
    return this.prisma.$transaction(async (tx) => {
      let versionId = t.currentVersionId;
      if (input.config) {
        this.assertConfig(input.config);
        const last = await tx.pageTemplateVersion.findFirst({ where: { templateId: id }, orderBy: { version: 'desc' } });
        const v = await tx.pageTemplateVersion.create({
          data: { templateId: id, version: (last?.version ?? 0) + 1, config: input.config as Prisma.InputJsonValue, createdByUserId: actor.userId },
        });
        versionId = v.id;
      }
      const updated = await tx.pageTemplate.update({
        where: { id },
        data: { name: input.name, description: input.description, currentVersionId: versionId },
        include: { currentVersion: true },
      });
      await this.audit.log(actor, 'template.updated', 'page_template', id, { before: this.view(t), after: this.view(updated) }, tx);
      return this.view(updated);
    });
  }

  async setStatus(id: string, status: 'published' | 'disabled' | 'draft', actor: ActorContext) {
    const t = await this.prisma.pageTemplate.findUnique({ where: { id } });
    if (!t) throw AppError.notFound('Шаблон');
    const updated = await this.prisma.pageTemplate.update({ where: { id }, data: { status }, include: { currentVersion: true } });
    await this.audit.log(actor, `template.${status}`, 'page_template', id, { before: { status: t.status }, after: { status } });
    return this.view(updated);
  }

  private assertConfig(config: TemplateConfig) {
    TemplateConfigSchema.parse(config);
    const keys = config.colorSchemes.map((c) => c.key);
    if (new Set(keys).size !== keys.length) throw AppError.badRequest('VALIDATION_ERROR', 'Ключи цветовых схем должны быть уникальны');
    if (new Set(config.sectionOrder).size !== config.sectionOrder.length) throw AppError.badRequest('VALIDATION_ERROR', 'Раздел указан дважды');
  }
}
