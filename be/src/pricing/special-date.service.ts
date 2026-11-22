import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { CreateSpecialDateDto, UpdateSpecialDateDto } from './special-date.dto';

const fields = `id,code,name,start_date::text AS "startDate",end_date::text AS "endDate",status,created_at AS "createdAt",updated_at AS "updatedAt"`;

@Injectable()
export class SpecialDateService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}
  async list(actor: Actor) {
    return (await this.db.query(`SELECT ${fields} FROM special_dates WHERE tenant_id=$1 ORDER BY start_date,code,id`, [actor.tenantId])).rows;
  }
  async get(actor: Actor, id: string) { return this.find(this.db, actor.tenantId!, id); }
  async create(actor: Actor, dto: CreateSpecialDateDto) {
    this.validateDates(dto.startDate, dto.endDate);
    return this.transaction(async client => {
      const id = randomUUID();
      try {
        await client.query(`INSERT INTO special_dates(id,tenant_id,code,name,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6)`,
          [id, actor.tenantId, dto.code, dto.name, dto.startDate, dto.endDate]);
      } catch (error) {
        if ((error as {code?: string}).code === '23505') throw new ConflictException('Special date code already exists');
        throw error;
      }
      const after = await this.find(client, actor.tenantId!, id);
      await this.audit(client, actor, 'SPECIAL_DATE_CREATED', id, null, after);
      return after;
    });
  }
  async update(actor: Actor, id: string, dto: UpdateSpecialDateDto) {
    this.validateDates(dto.startDate, dto.endDate);
    return this.transaction(async client => {
      const before = await this.find(client, actor.tenantId!, id, true);
      await client.query(`UPDATE special_dates SET name=$3,start_date=$4,end_date=$5,status=$6,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [actor.tenantId, id, dto.name, dto.startDate, dto.endDate, dto.status]);
      const after = await this.find(client, actor.tenantId!, id);
      await this.audit(client, actor, 'SPECIAL_DATE_UPDATED', id, before, after);
      return after;
    });
  }
  private validateDates(from: string, to: string) {
    if (from > to) throw new UnprocessableEntityException('endDate must not precede startDate');
  }
  private async find(db: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>, tenant: string, id: string, lock = false) {
    const result = await db.query(`SELECT ${fields} FROM special_dates WHERE tenant_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [tenant, id]);
    if (!result.rows[0]) throw new NotFoundException('Special date not found');
    return result.rows[0];
  }
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private audit(client: PoolClient, actor: Actor, action: string, id: string, before: unknown, after: unknown) {
    return client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES($1,$2,$3,$4,'SPECIAL_DATE',$5,$6,$7)`,
      [randomUUID(), actor.tenantId, actor.userId, action, id, before ? JSON.stringify(before) : null, JSON.stringify(after)]);
  }
}
