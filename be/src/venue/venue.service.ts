import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import {
  BranchStatusDto, CreateBranchDto, CreateRoomAmenityDto, CreateRoomDto,
  CreateRoomMediaDto, RoomStatusDto, UpdateBranchDto, UpdateRoomAmenityDto, UpdateRoomDto, UpdateRoomMediaDto
} from './dto';

export interface Branch { id: string; code: string; name: string; timezone: string; status: string }
export interface Room { id: string; branchId: string; code: string; name: string; capacity: number; status: string }
export interface RoomAmenity { id: string; roomId: string; label: string; createdAt: Date }
export interface RoomMedia { id: string; roomId: string; assetRef: string; altText: string | null; displayOrder: number }

@Injectable()
export class VenueService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  async createBranch(actor: Actor, dto: CreateBranchDto): Promise<Branch> {
    this.validateTimezone(dto.timezone);
    return this.mutate(actor, 'BRANCH_CREATED', 'BRANCH', randomUUID(), async (client, id) => {
      const result = await this.safeWrite(() => client.query<Branch>(
        `INSERT INTO branches(id,tenant_id,code,name,timezone,status) VALUES ($1,$2,$3,$4,$5,'ACTIVE')
         RETURNING id,code,name,timezone,status`, [id, actor.tenantId, dto.code, dto.name, dto.timezone]));
      return result.rows[0];
    });
  }

  async listBranches(actor: Actor): Promise<Branch[]> {
    return (await this.db.query<Branch>(
      `SELECT id,code,name,timezone,status FROM branches
       WHERE tenant_id=$1 AND ($2::boolean OR id=ANY($3::uuid[])) ORDER BY name`,
      [actor.tenantId, actor.roles.includes('OWNER'), actor.branchIds])).rows;
  }

  async getBranch(actor: Actor, id: string): Promise<Branch> {
    this.assertBranchAccess(actor, id);
    const result = await this.db.query<Branch>(
      'SELECT id,code,name,timezone,status FROM branches WHERE tenant_id=$1 AND id=$2', [actor.tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException('Branch not found');
    return result.rows[0];
  }

  async updateBranch(actor: Actor, id: string, dto: UpdateBranchDto): Promise<Branch> {
    this.assertBranchAccess(actor, id);
    if (dto.timezone) this.validateTimezone(dto.timezone);
    return this.updateEntity<Branch>(actor, 'BRANCH_UPDATED', 'BRANCH', id,
      'SELECT id,code,name,timezone,status FROM branches WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      `UPDATE branches SET name=COALESCE($3,name),timezone=COALESCE($4,timezone),updated_at=now(),version=version+1
       WHERE tenant_id=$1 AND id=$2 RETURNING id,code,name,timezone,status`, [dto.name ?? null, dto.timezone ?? null]);
  }

  async setBranchStatus(actor: Actor, id: string, dto: BranchStatusDto): Promise<Branch> {
    this.assertBranchAccess(actor, id);
    return this.updateEntity<Branch>(actor, 'BRANCH_STATUS_CHANGED', 'BRANCH', id,
      'SELECT id,code,name,timezone,status FROM branches WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      `UPDATE branches SET status=$3,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2
       RETURNING id,code,name,timezone,status`, [dto.status]);
  }

  async createRoom(actor: Actor, dto: CreateRoomDto): Promise<Room> {
    this.assertBranchAccess(actor, dto.branchId);
    const branch = await this.db.query('SELECT 1 FROM branches WHERE id=$1 AND tenant_id=$2', [dto.branchId, actor.tenantId]);
    if (branch.rowCount !== 1) throw new NotFoundException('Branch not found');
    return this.mutate(actor, 'ROOM_CREATED', 'ROOM', randomUUID(), async (client, id) => {
      const result = await this.safeWrite(() => client.query<Room>(
        `INSERT INTO rooms(id,tenant_id,branch_id,code,name,capacity,status) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE')
         RETURNING id,branch_id AS "branchId",code,name,capacity,status`,
        [id, actor.tenantId, dto.branchId, dto.code, dto.name, dto.capacity]));
      return result.rows[0];
    });
  }

  async listRooms(actor: Actor, branchId: string): Promise<Room[]> {
    await this.getBranch(actor, branchId);
    return (await this.db.query<Room>(
      `SELECT id,branch_id AS "branchId",code,name,capacity,status FROM rooms
       WHERE tenant_id=$1 AND branch_id=$2 ORDER BY name`, [actor.tenantId, branchId])).rows;
  }

  async getRoom(actor: Actor, id: string): Promise<Room> {
    const result = await this.db.query<Room>(
      `SELECT id,branch_id AS "branchId",code,name,capacity,status FROM rooms WHERE tenant_id=$1 AND id=$2`,
      [actor.tenantId, id]);
    const room = result.rows[0];
    if (!room) throw new NotFoundException('Room not found');
    this.assertBranchAccess(actor, room.branchId);
    return room;
  }

  async updateRoom(actor: Actor, id: string, dto: UpdateRoomDto): Promise<Room> {
    const room = await this.getRoom(actor, id);
    this.assertBranchAccess(actor, room.branchId);
    return this.updateEntity<Room>(actor, 'ROOM_UPDATED', 'ROOM', id,
      `SELECT id,branch_id AS "branchId",code,name,capacity,status FROM rooms WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      `UPDATE rooms SET name=COALESCE($3,name),capacity=COALESCE($4,capacity),updated_at=now(),version=version+1
       WHERE tenant_id=$1 AND id=$2 RETURNING id,branch_id AS "branchId",code,name,capacity,status`,
      [dto.name ?? null, dto.capacity ?? null]);
  }

  async setRoomStatus(actor: Actor, id: string, dto: RoomStatusDto): Promise<Room> {
    const room = await this.getRoom(actor, id);
    this.assertBranchAccess(actor, room.branchId);
    return this.updateEntity<Room>(actor, 'ROOM_STATUS_CHANGED', 'ROOM', id,
      `SELECT id,branch_id AS "branchId",code,name,capacity,status FROM rooms WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      `UPDATE rooms SET status=$3,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2
       RETURNING id,branch_id AS "branchId",code,name,capacity,status`, [dto.status]);
  }

  async listRoomAmenities(actor: Actor, roomId: string): Promise<RoomAmenity[]> {
    await this.getRoom(actor, roomId);
    return (await this.db.query<RoomAmenity>(
      `SELECT id,room_id AS "roomId",label,created_at AS "createdAt" FROM room_amenities
       WHERE tenant_id=$1 AND room_id=$2 ORDER BY label,id`, [actor.tenantId, roomId])).rows;
  }

  async createRoomAmenity(actor: Actor, roomId: string, dto: CreateRoomAmenityDto): Promise<RoomAmenity> {
    const room = await this.getRoom(actor, roomId);
    const label = dto.label.trim();
    return this.mutate(actor, 'ROOM_AMENITY_CREATED', 'ROOM_AMENITY', randomUUID(), async (client, id) => {
      const result = await this.safeWrite(() => client.query<RoomAmenity>(
        `INSERT INTO room_amenities(id,tenant_id,branch_id,room_id,label)
         VALUES ($1,$2,$3,$4,$5) RETURNING id,room_id AS "roomId",label,created_at AS "createdAt"`,
        [id, actor.tenantId, room.branchId, roomId, label]));
      return result.rows[0];
    });
  }

  async updateRoomAmenity(actor: Actor, roomId: string, amenityId: string, dto: UpdateRoomAmenityDto): Promise<RoomAmenity> {
    await this.getRoom(actor, roomId);
    return this.updateEntity<RoomAmenity>(actor, 'ROOM_AMENITY_UPDATED', 'ROOM_AMENITY', amenityId,
      `SELECT id,room_id AS "roomId",label,created_at AS "createdAt" FROM room_amenities
       WHERE tenant_id=$1 AND room_id=$2 AND id=$3 FOR UPDATE`,
      `UPDATE room_amenities SET label=$4 WHERE tenant_id=$1 AND room_id=$2 AND id=$3
       RETURNING id,room_id AS "roomId",label,created_at AS "createdAt"`,
      [dto.label.trim()], [roomId, amenityId]);
  }

  async deleteRoomAmenity(actor: Actor, roomId: string, amenityId: string): Promise<void> {
    await this.getRoom(actor, roomId);
    await this.deleteEntity(actor, 'ROOM_AMENITY_DELETED', 'ROOM_AMENITY', amenityId,
      `SELECT id,room_id AS "roomId",label,created_at AS "createdAt" FROM room_amenities
       WHERE tenant_id=$1 AND room_id=$2 AND id=$3 FOR UPDATE`,
      'DELETE FROM room_amenities WHERE tenant_id=$1 AND room_id=$2 AND id=$3', [roomId, amenityId]);
  }

  async listRoomMedia(actor: Actor, roomId: string): Promise<RoomMedia[]> {
    await this.getRoom(actor, roomId);
    return (await this.db.query<RoomMedia>(
      `SELECT id,room_id AS "roomId",asset_ref AS "assetRef",alt_text AS "altText",display_order AS "displayOrder"
       FROM room_media WHERE tenant_id=$1 AND room_id=$2 ORDER BY display_order,created_at,id`,
      [actor.tenantId, roomId])).rows;
  }

  async createRoomMedia(actor: Actor, roomId: string, dto: CreateRoomMediaDto): Promise<RoomMedia> {
    const room = await this.getRoom(actor, roomId);
    return this.mutate(actor, 'ROOM_MEDIA_CREATED', 'ROOM_MEDIA', randomUUID(), async (client, id) => {
      const result = await client.query<RoomMedia>(
        `INSERT INTO room_media(id,tenant_id,branch_id,room_id,asset_ref,alt_text,display_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id,room_id AS "roomId",asset_ref AS "assetRef",alt_text AS "altText",display_order AS "displayOrder"`,
        [id, actor.tenantId, room.branchId, roomId, dto.assetRef.trim(), dto.altText ?? null, dto.displayOrder ?? 0]);
      return result.rows[0];
    });
  }

  async updateRoomMedia(actor: Actor, roomId: string, mediaId: string, dto: UpdateRoomMediaDto): Promise<RoomMedia> {
    await this.getRoom(actor, roomId);
    return this.updateEntity<RoomMedia>(actor, 'ROOM_MEDIA_UPDATED', 'ROOM_MEDIA', mediaId,
      `SELECT id,room_id AS "roomId",asset_ref AS "assetRef",alt_text AS "altText",display_order AS "displayOrder"
       FROM room_media WHERE tenant_id=$1 AND room_id=$2 AND id=$3 FOR UPDATE`,
      `UPDATE room_media SET asset_ref=COALESCE($4,asset_ref),
         alt_text=CASE WHEN $5::boolean THEN $6::varchar ELSE alt_text END,
         display_order=COALESCE($7,display_order),updated_at=now()
       WHERE tenant_id=$1 AND room_id=$2 AND id=$3
       RETURNING id,room_id AS "roomId",asset_ref AS "assetRef",alt_text AS "altText",display_order AS "displayOrder"`,
      [dto.assetRef?.trim() ?? null, dto.altText !== undefined, dto.altText ?? null, dto.displayOrder ?? null],
      [roomId, mediaId]);
  }

  async deleteRoomMedia(actor: Actor, roomId: string, mediaId: string): Promise<void> {
    await this.getRoom(actor, roomId);
    await this.deleteEntity(actor, 'ROOM_MEDIA_DELETED', 'ROOM_MEDIA', mediaId,
      `SELECT id,room_id AS "roomId",asset_ref AS "assetRef",alt_text AS "altText",display_order AS "displayOrder"
       FROM room_media WHERE tenant_id=$1 AND room_id=$2 AND id=$3 FOR UPDATE`,
      'DELETE FROM room_media WHERE tenant_id=$1 AND room_id=$2 AND id=$3', [roomId, mediaId]);
  }

  private assertBranchAccess(actor: Actor, branchId: string): void {
    if (!actor.roles.includes('OWNER') && !actor.branchIds.includes(branchId)) throw new ForbiddenException('Branch access denied');
  }
  private validateTimezone(timezone: string): void {
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); }
    catch { throw new BadRequestException('Invalid timezone'); }
  }
  private async updateEntity<T extends QueryResultRow>(actor: Actor, action: string, type: string, id: string,
                                selectSql: string, updateSql: string, values: unknown[], keyValues: unknown[] = [id]): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const keys = [actor.tenantId, ...keyValues];
      const before = (await client.query<T>(selectSql, keys)).rows[0];
      if (!before) throw new NotFoundException(this.notFoundMessage(type));
      const after = (await this.safeWrite(() => client.query<T>(updateSql, [...keys, ...values]))).rows[0];
      await this.insertAudit(client, actor, action, type, id, before, after);
      await client.query('COMMIT');
      return after;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private async deleteEntity(actor: Actor, action: string, type: string, id: string,
                             selectSql: string, deleteSql: string, keyValues: unknown[]): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const keys = [actor.tenantId, ...keyValues];
      const before = (await client.query<QueryResultRow>(selectSql, keys)).rows[0];
      if (!before) throw new NotFoundException(this.notFoundMessage(type));
      await client.query(deleteSql, keys);
      await this.insertAudit(client, actor, action, type, id, before, null);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private notFoundMessage(type: string): string {
    if (type === 'ROOM') return 'Room not found';
    if (type === 'ROOM_AMENITY') return 'Room amenity not found';
    if (type === 'ROOM_MEDIA') return 'Room media not found';
    return 'Branch not found';
  }
  private async mutate<T>(actor: Actor, action: string, type: string, id: string,
                          operation: (client: PoolClient, id: string) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const after = await operation(client, id);
      await this.insertAudit(client, actor, action, type, id, null, after);
      await client.query('COMMIT');
      return after;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private insertAudit(client: PoolClient, actor: Actor, action: string, type: string, id: string, before: unknown, after: unknown) {
    return client.query(
      `INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [randomUUID(), actor.tenantId, actor.userId, action, type, id,
        before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]);
  }
  private async safeWrite<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('Code already exists in this scope');
      throw error;
    }
  }
}
