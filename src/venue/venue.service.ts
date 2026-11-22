import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { BranchStatusDto, CreateBranchDto, CreateRoomDto, RoomStatusDto, UpdateBranchDto, UpdateRoomDto } from './dto';

export interface Branch { id: string; code: string; name: string; timezone: string; status: string }
export interface Room { id: string; branchId: string; code: string; name: string; capacity: number; status: string }

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

  private assertBranchAccess(actor: Actor, branchId: string): void {
    if (!actor.roles.includes('OWNER') && !actor.branchIds.includes(branchId)) throw new ForbiddenException('Branch access denied');
  }
  private validateTimezone(timezone: string): void {
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); }
    catch { throw new BadRequestException('Invalid timezone'); }
  }
  private async updateEntity<T extends QueryResultRow>(actor: Actor, action: string, type: string, id: string,
                                selectSql: string, updateSql: string, values: unknown[]): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const before = (await client.query<T>(selectSql, [actor.tenantId, id])).rows[0];
      if (!before) throw new NotFoundException(type === 'ROOM' ? 'Room not found' : 'Branch not found');
      const after = (await this.safeWrite(() => client.query<T>(updateSql, [actor.tenantId, id, ...values]))).rows[0];
      await this.insertAudit(client, actor, action, type, id, before, after);
      await client.query('COMMIT');
      return after;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
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
