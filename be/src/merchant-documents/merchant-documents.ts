import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res,
  UploadedFile, UseGuards, UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiHeader, ApiProduces, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Actor, AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { PG_POOL } from '../platform/database/database.module';
import { PDF_TYPES } from '../platform/storage/file-type';
import { ObjectStorageService, StorageBackend } from '../platform/storage/object-storage.service';
import { UPLOAD_LIMITS, UploadedFileLike, requireFile } from '../platform/storage/uploaded-file';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { PlatformAdminGuard } from '../listing-approval/platform-admin.guard';

/** PD-037: at most 10 PDF documents per merchant. */
export const MAX_MERCHANT_DOCUMENTS = 10;

export class MerchantDocumentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ['application/pdf'] }) contentType!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty({ format: 'uuid' }) uploadedBy!: string;
  @ApiProperty({ format: 'date-time' }) uploadedAt!: string;
}

export class UploadMerchantDocumentDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'PDF, at most 4 MB' }) file!: unknown;
  @ApiProperty({ maxLength: 200, description: 'What the document is (business licence, fire safety…)' }) title!: string;
}

const FIELDS = `id,tenant_id AS "tenantId",title,content_type AS "contentType",size_bytes AS "sizeBytes",uploaded_by AS "uploadedBy",uploaded_at AS "uploadedAt"`;

/** PD-037: merchant PDF documents in the private Blob store. Owner uploads/deletes; Owner and Platform Admin read. */
@Injectable()
export class MerchantDocumentService {
  constructor(@Inject(PG_POOL) private readonly db: Pool, private readonly storage: ObjectStorageService) {}

  async list(tenantId: string) {
    return (await this.db.query(`SELECT ${FIELDS} FROM merchant_documents WHERE tenant_id=$1 ORDER BY uploaded_at DESC,id`, [tenantId])).rows;
  }

  async upload(actor: Actor, file: UploadedFileLike | undefined, title: string | undefined) {
    const cleanTitle = (title ?? '').trim();
    if (!cleanTitle || cleanTitle.length > 200) throw new BadRequestException('title is required (at most 200 characters)');
    const { buffer, type } = requireFile(file, PDF_TYPES);
    const id = randomUUID();
    const stored = await this.storage.put('private', `documents/${actor.tenantId}/${id}.pdf`, buffer, type);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`merchant-documents:${actor.tenantId}`]);
      const count = Number((await client.query('SELECT count(*) FROM merchant_documents WHERE tenant_id=$1', [actor.tenantId])).rows[0].count);
      if (count >= MAX_MERCHANT_DOCUMENTS) throw new ConflictException(`A merchant can have at most ${MAX_MERCHANT_DOCUMENTS} documents`);
      const row = (await client.query(`INSERT INTO merchant_documents(id,tenant_id,title,pathname,content_type,size_bytes,storage_backend,uploaded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${FIELDS}`, [id, actor.tenantId, cleanTitle, stored.pathname, type, buffer.length, stored.backend, actor.userId])).rows[0];
      // The title is free text; the audit keeps structured fields only.
      await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,'MERCHANT_DOCUMENT_UPLOADED','MERCHANT_DOCUMENT',$4,$5)`,
        [randomUUID(), actor.tenantId, actor.userId, id, JSON.stringify({ sizeBytes: buffer.length })]);
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      await this.storage.remove('private', stored.pathname, stored.backend).catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async remove(actor: Actor, id: string): Promise<void> {
    const client = await this.db.connect();
    let removed: { pathname: string; storage_backend: StorageBackend } | undefined;
    try {
      await client.query('BEGIN');
      removed = (await client.query('DELETE FROM merchant_documents WHERE tenant_id=$1 AND id=$2 RETURNING pathname,storage_backend', [actor.tenantId, id])).rows[0];
      if (!removed) throw new NotFoundException('Document not found');
      await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,'MERCHANT_DOCUMENT_DELETED','MERCHANT_DOCUMENT',$4,'{}')`,
        [randomUUID(), actor.tenantId, actor.userId, id]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    await this.storage.remove('private', removed.pathname, removed.storage_backend).catch(() => undefined);
  }

  /** Streams the PDF; never cached by shared caches (private, no-store). */
  async send(tenantId: string, id: string, response: Response): Promise<void> {
    const doc = (await this.db.query('SELECT pathname,content_type,storage_backend FROM merchant_documents WHERE tenant_id=$1 AND id=$2', [tenantId, id])).rows[0];
    if (!doc) throw new NotFoundException('Document not found');
    const file = await this.storage.read('private', doc.pathname, doc.storage_backend, doc.content_type);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Length', String(file.size));
    response.setHeader('Content-Disposition', `inline; filename="document-${id}.pdf"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    file.stream.pipe(response);
  }
}

@ApiTags('merchant files') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/documents')
export class MerchantDocumentController {
  constructor(private readonly documents: MerchantDocumentService) {}

  @Get() @RequireRoles('OWNER')
  @ApiResponse({ status: 200, type: [MerchantDocumentDto] })
  list(@Req() req: AuthenticatedRequest) { return this.documents.list(req.actor.tenantId!); }

  @Post() @RequireRoles('OWNER')
  @UseInterceptors(FileInterceptor('file', UPLOAD_LIMITS)) @ApiConsumes('multipart/form-data') @ApiBody({ type: UploadMerchantDocumentDto })
  @ApiResponse({ status: 201, type: MerchantDocumentDto, description: 'PDF stored in the private Blob store' })
  @ApiResponse({ status: 409, description: 'Merchant already has 10 documents' })
  @ApiResponse({ status: 413, description: 'File larger than 4 MB' })
  @ApiResponse({ status: 422, description: 'Not a PDF' })
  upload(@Req() req: AuthenticatedRequest, @UploadedFile() file: UploadedFileLike | undefined, @Body() body: { title?: string }) {
    return this.documents.upload(req.actor, file, body?.title);
  }

  @Get(':id/file') @RequireRoles('OWNER') @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'PDF bytes', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } })
  async file(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Res() response: Response) {
    await this.documents.send(req.actor.tenantId!, id, response);
  }

  @Delete(':id') @HttpCode(204) @RequireRoles('OWNER')
  @ApiResponse({ status: 204, description: 'Document and its file deleted' })
  remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.documents.remove(req.actor, id); }
}

@ApiTags('platform merchants') @ApiBearerAuth()
@UseGuards(AuthGuard, PlatformAdminGuard) @Controller('platform/merchants/:tenantId/documents')
export class PlatformMerchantDocumentController {
  constructor(private readonly documents: MerchantDocumentService) {}

  @Get()
  @ApiResponse({ status: 200, type: [MerchantDocumentDto], description: 'Documents of any merchant, for listing review' })
  list(@Param('tenantId', ParseUUIDPipe) tenantId: string) { return this.documents.list(tenantId); }

  @Get(':id/file') @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'PDF bytes', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } })
  async file(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Res() response: Response) {
    await this.documents.send(tenantId, id, response);
  }
}
