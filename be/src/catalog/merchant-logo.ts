import { Controller, Delete, Get, HttpCode, Inject, Injectable, Put, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiHeader, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Actor, AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { PG_POOL } from '../platform/database/database.module';
import { EXTENSIONS, IMAGE_TYPES } from '../platform/storage/file-type';
import { ObjectStorageService, StorageBackend } from '../platform/storage/object-storage.service';
import { UPLOAD_LIMITS, UploadedFileLike, requireFile } from '../platform/storage/uploaded-file';
import { TenantGuard } from '../platform/tenant/tenant.guard';

export class MerchantLogoDto {
  @ApiProperty() configured!: boolean;
  @ApiProperty({ nullable: true, type: String, description: 'Public Blob URL shown in the customer catalog' }) url!: string | null;
  @ApiProperty({ nullable: true, type: String, enum: ['image/jpeg', 'image/png', 'image/webp'] }) contentType!: string | null;
  @ApiProperty({ nullable: true, type: Number }) sizeBytes!: number | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) updatedAt!: string | null;
}

export class UploadLogoDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'JPEG, PNG or WebP, at most 4 MB (PD-037)' }) file!: unknown;
}

const LOGO_FIELDS = `url,content_type AS "contentType",size_bytes AS "sizeBytes",updated_at AS "updatedAt"`;

/** PD-037: one public logo per merchant, managed by the Owner. */
@Injectable()
export class MerchantLogoService {
  constructor(@Inject(PG_POOL) private readonly db: Pool, private readonly storage: ObjectStorageService) {}

  async get(tenantId: string) {
    const row = (await this.db.query(`SELECT ${LOGO_FIELDS} FROM merchant_logos WHERE tenant_id=$1`, [tenantId])).rows[0];
    return row ? { configured: true, ...row } : { configured: false, url: null, contentType: null, sizeBytes: null, updatedAt: null };
  }

  async replace(actor: Actor, file: UploadedFileLike | undefined) {
    const { buffer, type } = requireFile(file, IMAGE_TYPES);
    const stored = await this.storage.put('public', `logos/${actor.tenantId}/${randomUUID()}.${EXTENSIONS[type]}`, buffer, type);
    let previous: { pathname: string; storage_backend: StorageBackend } | undefined;
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`merchant-logo:${actor.tenantId}`]);
      previous = (await client.query('SELECT pathname,storage_backend FROM merchant_logos WHERE tenant_id=$1 FOR UPDATE', [actor.tenantId])).rows[0];
      const row = (await client.query(`INSERT INTO merchant_logos(tenant_id,pathname,url,content_type,size_bytes,storage_backend,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id) DO UPDATE SET pathname=EXCLUDED.pathname,url=EXCLUDED.url,content_type=EXCLUDED.content_type,
          size_bytes=EXCLUDED.size_bytes,storage_backend=EXCLUDED.storage_backend,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()
        RETURNING ${LOGO_FIELDS}`, [actor.tenantId, stored.pathname, stored.url, type, buffer.length, stored.backend, actor.userId])).rows[0];
      await this.audit(client, actor, 'MERCHANT_LOGO_UPDATED', { contentType: type, sizeBytes: buffer.length });
      await client.query('COMMIT');
      if (previous) await this.storage.remove('public', previous.pathname, previous.storage_backend).catch(() => undefined);
      return { configured: true, ...row };
    } catch (error) {
      await client.query('ROLLBACK');
      await this.storage.remove('public', stored.pathname, stored.backend).catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async remove(actor: Actor): Promise<void> {
    const client = await this.db.connect();
    let previous: { pathname: string; storage_backend: StorageBackend } | undefined;
    try {
      await client.query('BEGIN');
      previous = (await client.query('DELETE FROM merchant_logos WHERE tenant_id=$1 RETURNING pathname,storage_backend', [actor.tenantId])).rows[0];
      if (previous) await this.audit(client, actor, 'MERCHANT_LOGO_REMOVED', {});
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    if (previous) await this.storage.remove('public', previous.pathname, previous.storage_backend).catch(() => undefined);
  }

  private async audit(client: { query: Pool['query'] }, actor: Actor, action: string, after: Record<string, unknown>) {
    await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,$4,'MERCHANT_LOGO',$2,$5)`,
      [randomUUID(), actor.tenantId, actor.userId, action, JSON.stringify(after)]);
  }
}

@ApiTags('merchant files') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/catalog/logo')
export class MerchantLogoController {
  constructor(private readonly logos: MerchantLogoService) {}

  @Get() @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST', 'CASHIER')
  @ApiResponse({ status: 200, type: MerchantLogoDto })
  get(@Req() req: AuthenticatedRequest) { return this.logos.get(req.actor.tenantId!); }

  @Put() @RequireRoles('OWNER')
  @UseInterceptors(FileInterceptor('file', UPLOAD_LIMITS)) @ApiConsumes('multipart/form-data') @ApiBody({ type: UploadLogoDto })
  @ApiResponse({ status: 200, type: MerchantLogoDto, description: 'Replaces the logo; the previous file is deleted' })
  @ApiResponse({ status: 413, description: 'File larger than 4 MB' })
  @ApiResponse({ status: 422, description: 'Not a JPEG, PNG or WebP image' })
  replace(@Req() req: AuthenticatedRequest, @UploadedFile() file: UploadedFileLike | undefined) { return this.logos.replace(req.actor, file); }

  @Delete() @HttpCode(204) @RequireRoles('OWNER')
  @ApiResponse({ status: 204, description: 'Logo removed (no-op when none)' })
  remove(@Req() req: AuthenticatedRequest) { return this.logos.remove(req.actor); }
}
