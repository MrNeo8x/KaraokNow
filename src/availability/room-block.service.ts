import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { CreateRoomBlockDto, UpdateRoomBlockDto } from './room-block.dto';

export interface RoomBlock {
  id: string; branchId: string; roomId: string; reason: string; status: 'ACTIVE' | 'RELEASED';
  startAt: Date; endAt: Date;
}

@Injectable()
export class RoomBlockService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  async create(actor: Actor, dto: CreateRoomBlockDto): Promise<RoomBlock> {
    const room = await this.roomContext(actor, dto.roomId);
    this.validateRange(dto.startAt, dto.endAt);
    const blockId = randomUUID();
    const occupancyId = randomUUID();
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await this.withConflictMapping(() => client.query(
        `INSERT INTO room_occupancy(id,tenant_id,branch_id,room_id,source_type,source_id,occupied_range,status)
         VALUES ($1,$2,$3,$4,'MAINTENANCE',$5,tstzrange($6,$7,'[)'),'MAINTENANCE')`,
        [occupancyId, actor.tenantId, room.branchId, dto.roomId, blockId, dto.startAt, dto.endAt]));
      await client.query(
        `INSERT INTO room_blocks(id,tenant_id,branch_id,room_id,occupancy_id,reason,status,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7)`,
        [blockId, actor.tenantId, room.branchId, dto.roomId, occupancyId, dto.reason, actor.userId]);
      const created = await this.findById(client, actor.tenantId!, blockId);
      await this.audit(client, actor, 'ROOM_BLOCK_CREATED', blockId, null, created);
      await client.query('COMMIT');
      return created;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async list(actor: Actor, branchId: string): Promise<RoomBlock[]> {
    this.assertBranch(actor, branchId);
    return (await this.db.query<RoomBlock>(`${this.selectSql()} WHERE rb.tenant_id=$1 AND rb.branch_id=$2 ORDER BY lower(o.occupied_range)`,
      [actor.tenantId, branchId])).rows;
  }

  async get(actor: Actor, id: string): Promise<RoomBlock> {
    const block = await this.findById(this.db, actor.tenantId!, id);
    this.assertBranch(actor, block.branchId);
    return block;
  }

  async update(actor: Actor, id: string, dto: UpdateRoomBlockDto): Promise<RoomBlock> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const before = await this.findById(client, actor.tenantId!, id, true);
      this.assertBranch(actor, before.branchId);
      if (before.status !== 'ACTIVE') throw new ConflictException('Released room block cannot be changed');
      const startAt = dto.startAt ?? before.startAt.toISOString();
      const endAt = dto.endAt ?? before.endAt.toISOString();
      this.validateRange(startAt, endAt);
      await this.withConflictMapping(() => client.query(
        `UPDATE room_occupancy SET occupied_range=tstzrange($3,$4,'[)'),updated_at=now()
         WHERE tenant_id=$1 AND source_type='MAINTENANCE' AND source_id=$2`,
        [actor.tenantId, id, startAt, endAt]));
      if (dto.reason !== undefined) await client.query(
        'UPDATE room_blocks SET reason=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2',
        [actor.tenantId, id, dto.reason]);
      const after = await this.findById(client, actor.tenantId!, id);
      await this.audit(client, actor, 'ROOM_BLOCK_UPDATED', id, before, after);
      await client.query('COMMIT');
      return after;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async release(actor: Actor, id: string): Promise<RoomBlock> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const before = await this.findById(client, actor.tenantId!, id, true);
      this.assertBranch(actor, before.branchId);
      if (before.status === 'RELEASED') { await client.query('COMMIT'); return before; }
      await client.query(`UPDATE room_occupancy SET status='RELEASED',updated_at=now()
        WHERE tenant_id=$1 AND source_type='MAINTENANCE' AND source_id=$2`, [actor.tenantId, id]);
      await client.query(`UPDATE room_blocks SET status='RELEASED',updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [actor.tenantId, id]);
      const after = await this.findById(client, actor.tenantId!, id);
      await this.audit(client, actor, 'ROOM_BLOCK_RELEASED', id, before, after);
      await client.query('COMMIT');
      return after;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private async roomContext(actor: Actor, roomId: string): Promise<{ branchId: string }> {
    const result = await this.db.query<{ branchId: string }>(
      `SELECT branch_id AS "branchId" FROM rooms WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, roomId]);
    if (!result.rows[0]) throw new NotFoundException('Room not found');
    this.assertBranch(actor, result.rows[0].branchId);
    return result.rows[0];
  }
  private assertBranch(actor: Actor, branchId: string): void {
    if (!actor.roles.includes('OWNER') && !actor.branchIds.includes(branchId)) throw new ForbiddenException('Branch access denied');
  }
  private validateRange(startAt: string, endAt: string): void {
    if (new Date(startAt).getTime() >= new Date(endAt).getTime()) throw new BadRequestException('endAt must be after startAt');
  }
  private selectSql(): string {
    return `SELECT rb.id,rb.branch_id AS "branchId",rb.room_id AS "roomId",rb.reason,rb.status,
      lower(o.occupied_range) AS "startAt",upper(o.occupied_range) AS "endAt"
      FROM room_blocks rb JOIN room_occupancy o ON o.id=rb.occupancy_id`;
  }
  private async findById(queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>, tenantId: string,
                         id: string, lock = false): Promise<RoomBlock> {
    const result = await queryable.query<RoomBlock>(`${this.selectSql()} WHERE rb.tenant_id=$1 AND rb.id=$2${lock ? ' FOR UPDATE OF rb,o' : ''}`,
      [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException('Room block not found');
    return result.rows[0];
  }
  private async withConflictMapping<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if ((error as { code?: string }).code === '23P01') throw new ConflictException('Room already has an active occupancy in this interval');
      throw error;
    }
  }
  private audit(client: PoolClient, actor: Actor, action: string, id: string, before: unknown, after: unknown) {
    return client.query(
      `INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
       VALUES ($1,$2,$3,$4,'ROOM_BLOCK',$5,$6,$7)`,
      [randomUUID(), actor.tenantId, actor.userId, action, id,
        before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]);
  }
}
