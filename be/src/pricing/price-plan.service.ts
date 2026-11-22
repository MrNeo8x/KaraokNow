import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { CreatePricePlanDto, UpdatePricePlanDto } from './price-plan.dto';

const fields = `id,code,name,status,effective_from::text AS "effectiveFrom",effective_to::text AS "effectiveTo",version::text,created_at AS "createdAt",updated_at AS "updatedAt"`;

@Injectable()
export class PricePlanService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}
  async list(actor: Actor) {
    return (await this.db.query(`SELECT ${fields} FROM price_plans WHERE tenant_id=$1 ORDER BY code,id`, [actor.tenantId])).rows;
  }
  async get(actor: Actor, id: string) {
    return this.find(this.db, actor.tenantId!, id);
  }
  async create(actor: Actor, dto: CreatePricePlanDto) {
    this.validateDates(dto.effectiveFrom, dto.effectiveTo);
    return this.transaction(async client => {
      const id = randomUUID();
      try {
        await client.query(`INSERT INTO price_plans(id,tenant_id,code,name,effective_from,effective_to) VALUES($1,$2,$3,$4,$5,$6)`,
          [id, actor.tenantId, dto.code, dto.name, dto.effectiveFrom ?? null, dto.effectiveTo ?? null]);
      } catch (error) {
        if ((error as {code?: string}).code === '23505') throw new ConflictException('Price plan code already exists');
        throw error;
      }
      const after = await this.find(client, actor.tenantId!, id);
      await this.audit(client, actor, 'PRICE_PLAN_CREATED', id, null, after);
      return after;
    });
  }
  async update(actor: Actor, id: string, dto: UpdatePricePlanDto) {
    this.validateDates(dto.effectiveFrom, dto.effectiveTo);
    return this.transaction(async client => {
      const before = await this.find(client, actor.tenantId!, id, true);
      await client.query(`UPDATE price_plans SET name=$3,status=$4,effective_from=$5,effective_to=$6,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [actor.tenantId, id, dto.name, dto.status, dto.effectiveFrom ?? null, dto.effectiveTo ?? null]);
      const after = await this.find(client, actor.tenantId!, id);
      await this.audit(client, actor, 'PRICE_PLAN_UPDATED', id, before, after);
      return after;
    });
  }
  private validateDates(from?: string | null, to?: string | null) {
    if (from && to && from > to) throw new UnprocessableEntityException('effectiveTo must not precede effectiveFrom');
  }
  private async find(db: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>, tenant: string, id: string, lock = false) {
    const result = await db.query(`SELECT ${fields} FROM price_plans WHERE tenant_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [tenant, id]);
    if (!result.rows[0]) throw new NotFoundException('Price plan not found');
    return result.rows[0];
  }
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private audit(client: PoolClient, actor: Actor, action: string, id: string, before: unknown, after: unknown) {
    return client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES($1,$2,$3,$4,'PRICE_PLAN',$5,$6,$7)`,
      [randomUUID(), actor.tenantId, actor.userId, action, id, before ? JSON.stringify(before) : null, JSON.stringify(after)]);
  }
}
