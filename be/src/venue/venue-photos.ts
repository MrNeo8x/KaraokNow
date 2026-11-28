import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, Injectable, NotFoundException, Param, ParseUUIDPipe,
  Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiHeader, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor, AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { PG_POOL } from '../platform/database/database.module';
import { EXTENSIONS, IMAGE_TYPES } from '../platform/storage/file-type';
import { ObjectStorageService, StorageBackend } from '../platform/storage/object-storage.service';
import { UPLOAD_LIMITS, UploadedFileLike, requireFile } from '../platform/storage/uploaded-file';
import { TenantGuard } from '../platform/tenant/tenant.guard';

/** PD-048: at most 10 photos for the merchant and 10 per branch. */
export const MAX_VENUE_PHOTOS = 10;

export class VenuePhotoDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String, description: 'null = merchant gallery' }) branchId!: string | null;
  @ApiProperty({ description: 'Public URL (Blob CDN on production, /v1/files/public/… locally)' }) url!: string;
  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp'] }) contentType!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty({ nullable: true, type: String }) altText!: string | null;
  @ApiProperty() displayOrder!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class UploadVenuePhotoDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'JPEG, PNG or WebP, at most 4 MB (compress in the browser first)' }) file!: unknown;
  @ApiPropertyOptional({ maxLength: 300 }) @IsOptional() @IsString() @MaxLength(300) altText?: string;
  @ApiPropertyOptional({ minimum: 0, maximum: 1000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) displayOrder?: number;
}
export class UpdateVenuePhotoDto {
  @ApiPropertyOptional({ maxLength: 300, nullable: true, type: String }) @IsOptional() @IsString() @MaxLength(300) altText?: string | null;
  @ApiPropertyOptional({ minimum: 0, maximum: 1000 }) @IsOptional() @IsInt() @Min(0) @Max(1000) displayOrder?: number;
}

const FIELDS = `id,branch_id AS "branchId",url,content_type AS "contentType",size_bytes AS "sizeBytes",alt_text AS "altText",display_order AS "displayOrder",created_at AS "createdAt"`;

@Injectable()
export class VenuePhotoService {
  constructor(@Inject(PG_POOL) private readonly db: Pool, private readonly storage: ObjectStorageService) {}

  async list(actor: Actor, branchId: string | null) {
    if (branchId) await this.assertBranch(actor, branchId);
    return (await this.db.query(`SELECT ${FIELDS} FROM venue_photos WHERE tenant_id=$1 AND branch_id IS NOT DISTINCT FROM $2
      ORDER BY display_order,created_at,id`, [actor.tenantId, branchId])).rows;
  }

  async upload(actor: Actor, branchId: string | null, file: UploadedFileLike | undefined, altText?: string, displayOrder?: number) {
    if (branchId) await this.assertBranch(actor, branchId);
    const { buffer, type } = requireFile(file, IMAGE_TYPES);
    if (await this.count(this.db, actor, branchId) >= MAX_VENUE_PHOTOS) throw this.full(branchId);
    const id = randomUUID();
    const pathname = branchId ? `branches/${actor.tenantId}/${branchId}/${id}.${EXTENSIONS[type]}` : `merchants/${actor.tenantId}/photos/${id}.${EXTENSIONS[type]}`;
    const stored = await this.storage.put('public', pathname, buffer, type);
    try {
      return await this.tx(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`venue-photos:${actor.tenantId}:${branchId ?? 'merchant'}`]);
        const current = await this.count(client, actor, branchId);
        if (current >= MAX_VENUE_PHOTOS) throw this.full(branchId);
        const row = (await client.query(`INSERT INTO venue_photos(id,tenant_id,branch_id,pathname,url,content_type,size_bytes,storage_backend,alt_text,display_order,uploaded_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${FIELDS}`,
        [id, actor.tenantId, branchId, stored.pathname, stored.url, type, buffer.length, stored.backend, altText?.trim() || null, displayOrder ?? current, actor.userId])).rows[0];
        await this.audit(client, actor, branchId ? 'BRANCH_PHOTO_UPLOADED' : 'MERCHANT_PHOTO_UPLOADED', id, { branchId, contentType: type, sizeBytes: buffer.length });
        return row;
      });
    } catch (error) {
      await this.storage.remove('public', stored.pathname, stored.backend).catch(() => undefined);
      throw error;
    }
  }

  async update(actor: Actor, branchId: string | null, photoId: string, dto: UpdateVenuePhotoDto) {
    if (branchId) await this.assertBranch(actor, branchId);
    return this.tx(async (client) => {
      const before = await this.lock(client, actor, branchId, photoId);
      const row = (await client.query(`UPDATE venue_photos SET alt_text=CASE WHEN $3::boolean THEN $4 ELSE alt_text END,
          display_order=COALESCE($5,display_order) WHERE tenant_id=$1 AND id=$2 RETURNING ${FIELDS}`,
      [actor.tenantId, photoId, dto.altText !== undefined, dto.altText?.trim() || null, dto.displayOrder ?? null])).rows[0];
      await this.audit(client, actor, branchId ? 'BRANCH_PHOTO_UPDATED' : 'MERCHANT_PHOTO_UPDATED', photoId,
        { branchId, displayOrder: row.displayOrder, altTextChanged: before.alt_text !== row.altText });
      return row;
    });
  }

  async remove(actor: Actor, branchId: string | null, photoId: string) {
    if (branchId) await this.assertBranch(actor, branchId);
    const removed = await this.tx(async (client) => {
      const before = await this.lock(client, actor, branchId, photoId);
      await client.query('DELETE FROM venue_photos WHERE tenant_id=$1 AND id=$2', [actor.tenantId, photoId]);
      await this.audit(client, actor, branchId ? 'BRANCH_PHOTO_DELETED' : 'MERCHANT_PHOTO_DELETED', photoId, { branchId });
      return before;
    });
    // After commit: an orphaned object is preferable to a row pointing at a deleted file.
    await this.storage.remove('public', removed.pathname, removed.storage_backend as StorageBackend).catch(() => undefined);
  }

  private async lock(client: PoolClient, actor: Actor, branchId: string | null, photoId: string) {
    const row = (await client.query(`SELECT pathname,storage_backend,alt_text FROM venue_photos WHERE tenant_id=$1 AND id=$2 AND branch_id IS NOT DISTINCT FROM $3 FOR UPDATE`,
      [actor.tenantId, photoId, branchId])).rows[0];
    if (!row) throw new NotFoundException('Photo not found');
    return row;
  }
  private async count(db: Pick<Pool | PoolClient, 'query'>, actor: Actor, branchId: string | null) {
    return Number((await db.query('SELECT count(*) FROM venue_photos WHERE tenant_id=$1 AND branch_id IS NOT DISTINCT FROM $2', [actor.tenantId, branchId])).rows[0].count);
  }
  private full(branchId: string | null) {
    return new ConflictException(`${branchId ? 'A branch' : 'The merchant'} can have at most ${MAX_VENUE_PHOTOS} photos`);
  }
  /** Branch of this tenant (404) that the caller may see/manage (403 unless Owner or assigned). */
  private async assertBranch(actor: Actor, branchId: string) {
    if (!(await this.db.query('SELECT 1 FROM branches WHERE tenant_id=$1 AND id=$2', [actor.tenantId, branchId])).rowCount) throw new NotFoundException('Branch not found');
    if (!actor.roles.includes('OWNER') && !actor.branchIds.includes(branchId)) throw new ForbiddenException('Branch access denied');
  }
  private audit(client: PoolClient, actor: Actor, action: string, id: string, data: Record<string, unknown>) {
    return client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES ($1,$2,$3,$4,'VENUE_PHOTO',$5,$6)`,
      [randomUUID(), actor.tenantId, actor.userId, action, id, JSON.stringify(data)]);
  }
  private async tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try { await client.query('BEGIN'); const r = await work(client); await client.query('COMMIT'); return r; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}

const ALL = ['OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST', 'CASHIER'] as const;
const TOO_MANY = 'Already 10 photos';

/** PD-048: merchant gallery (Owner manages; every role reads). */
@ApiTags('venue photos') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/catalog/photos')
export class MerchantPhotoController {
  constructor(private readonly photos: VenuePhotoService) {}
  @Get() @RequireRoles(...ALL) @ApiResponse({ status: 200, type: [VenuePhotoDto] })
  list(@Req() req: AuthenticatedRequest) { return this.photos.list(req.actor, null); }
  @Post() @RequireRoles('OWNER')
  @UseInterceptors(FileInterceptor('file', UPLOAD_LIMITS)) @ApiConsumes('multipart/form-data') @ApiBody({ type: UploadVenuePhotoDto })
  @ApiResponse({ status: 201, type: VenuePhotoDto }) @ApiResponse({ status: 409, description: TOO_MANY })
  @ApiResponse({ status: 413, description: 'File larger than 4 MB' }) @ApiResponse({ status: 422, description: 'Not a JPEG/PNG/WebP image' })
  upload(@Req() req: AuthenticatedRequest, @UploadedFile() file: UploadedFileLike | undefined, @Body() dto: UploadVenuePhotoDto) {
    return this.photos.upload(req.actor, null, file, dto.altText, dto.displayOrder);
  }
  @Patch(':photoId') @RequireRoles('OWNER') @ApiResponse({ status: 200, type: VenuePhotoDto })
  update(@Req() req: AuthenticatedRequest, @Param('photoId', ParseUUIDPipe) photoId: string, @Body() dto: UpdateVenuePhotoDto) {
    return this.photos.update(req.actor, null, photoId, dto);
  }
  @Delete(':photoId') @HttpCode(204) @RequireRoles('OWNER') @ApiResponse({ status: 204, description: 'Photo and its file removed' })
  remove(@Req() req: AuthenticatedRequest, @Param('photoId', ParseUUIDPipe) photoId: string) { return this.photos.remove(req.actor, null, photoId); }
}

/** PD-048: branch gallery (Owner, or Branch Manager of that branch, manages; staff of the branch read). */
@ApiTags('venue photos') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/branches/:branchId/photos')
export class BranchPhotoController {
  constructor(private readonly photos: VenuePhotoService) {}
  @Get() @RequireRoles(...ALL) @ApiResponse({ status: 200, type: [VenuePhotoDto] })
  list(@Req() req: AuthenticatedRequest, @Param('branchId', ParseUUIDPipe) branchId: string) { return this.photos.list(req.actor, branchId); }
  @Post() @RequireRoles('OWNER', 'BRANCH_MANAGER')
  @UseInterceptors(FileInterceptor('file', UPLOAD_LIMITS)) @ApiConsumes('multipart/form-data') @ApiBody({ type: UploadVenuePhotoDto })
  @ApiResponse({ status: 201, type: VenuePhotoDto }) @ApiResponse({ status: 409, description: TOO_MANY })
  @ApiResponse({ status: 413, description: 'File larger than 4 MB' }) @ApiResponse({ status: 422, description: 'Not a JPEG/PNG/WebP image' })
  upload(@Req() req: AuthenticatedRequest, @Param('branchId', ParseUUIDPipe) branchId: string, @UploadedFile() file: UploadedFileLike | undefined, @Body() dto: UploadVenuePhotoDto) {
    return this.photos.upload(req.actor, branchId, file, dto.altText, dto.displayOrder);
  }
  @Patch(':photoId') @RequireRoles('OWNER', 'BRANCH_MANAGER') @ApiResponse({ status: 200, type: VenuePhotoDto })
  update(@Req() req: AuthenticatedRequest, @Param('branchId', ParseUUIDPipe) branchId: string, @Param('photoId', ParseUUIDPipe) photoId: string, @Body() dto: UpdateVenuePhotoDto) {
    return this.photos.update(req.actor, branchId, photoId, dto);
  }
  @Delete(':photoId') @HttpCode(204) @RequireRoles('OWNER', 'BRANCH_MANAGER') @ApiResponse({ status: 204, description: 'Photo and its file removed' })
  remove(@Req() req: AuthenticatedRequest, @Param('branchId', ParseUUIDPipe) branchId: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    return this.photos.remove(req.actor, branchId, photoId);
  }
}
