import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { CreatePriceRuleDto, PriceRuleValuesDto, UpdatePriceRuleDto } from './price-rule.dto';

const fields = `id,price_plan_id AS "pricePlanId",special_date_id AS "specialDateId",room_id AS "roomId",code,name,priority,weekdays,start_time::text AS "startTime",end_time::text AS "endTime",min_duration_minutes AS "minDurationMinutes",max_duration_minutes AS "maxDurationMinutes",amount_vnd::text AS "amountVnd",amount_unit AS "amountUnit",status,version::text,created_at AS "createdAt",updated_at AS "updatedAt"`;

@Injectable()
export class PriceRuleService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}
  async list(actor: Actor, planId: string) {
    await this.assertPlan(this.db, actor.tenantId!, planId);
    return (await this.db.query(`SELECT ${fields} FROM price_rules WHERE tenant_id=$1 AND price_plan_id=$2 ORDER BY priority DESC,code,id`, [actor.tenantId, planId])).rows;
  }
  async get(actor: Actor, id: string) { return this.find(this.db, actor.tenantId!, id); }
  async create(actor: Actor, dto: CreatePriceRuleDto) {
    this.validate(dto);
    return this.transaction(async client => {
      await this.assertPlan(client, actor.tenantId!, dto.pricePlanId);
      const id = randomUUID();
      await this.write(() => client.query(`INSERT INTO price_rules(id,tenant_id,price_plan_id,code,name,priority,amount_vnd,amount_unit,weekdays,room_id,special_date_id,start_time,end_time,min_duration_minutes,max_duration_minutes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, actor.tenantId, dto.pricePlanId, dto.code, ...this.values(dto)]));
      const after = await this.find(client, actor.tenantId!, id);
      await this.audit(client, actor, 'PRICE_RULE_CREATED', id, null, after);
      return after;
    });
  }
  async update(actor: Actor, id: string, dto: UpdatePriceRuleDto) {
    this.validate(dto);
    return this.transaction(async client => {
      const before = await this.find(client, actor.tenantId!, id, true);
      await this.write(() => client.query(`UPDATE price_rules SET name=$3,priority=$4,amount_vnd=$5,amount_unit=$6,weekdays=$7,room_id=$8,special_date_id=$9,start_time=$10,end_time=$11,min_duration_minutes=$12,max_duration_minutes=$13,status=$14,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [actor.tenantId, id, ...this.values(dto), dto.status]));
      const after = await this.find(client, actor.tenantId!, id);
      await this.audit(client, actor, 'PRICE_RULE_UPDATED', id, before, after);
      return after;
    });
  }
  private values(dto: PriceRuleValuesDto) {
    return [dto.name, dto.priority, dto.amountVnd, dto.amountUnit, dto.weekdays ?? [], dto.roomId ?? null, dto.specialDateId ?? null,
      dto.startTime ?? null, dto.endTime ?? null, dto.minDurationMinutes ?? null, dto.maxDurationMinutes ?? null];
  }
  private validate(dto: PriceRuleValuesDto) {
    if (BigInt(dto.amountVnd) > 9223372036854775807n) throw new UnprocessableEntityException('amountVnd exceeds database limit');
    const canonicalTime = (value: string) => value.length === 5 ? `${value}:00` : value;
    if (!!dto.startTime !== !!dto.endTime || (dto.startTime && dto.endTime && canonicalTime(dto.startTime) === canonicalTime(dto.endTime))) throw new UnprocessableEntityException('Time window requires distinct start and end times');
    if (dto.minDurationMinutes != null && dto.maxDurationMinutes != null && dto.minDurationMinutes > dto.maxDurationMinutes) throw new UnprocessableEntityException('Maximum duration must be at least minimum duration');
  }
  private async assertPlan(db: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>, tenant: string, id: string) {
    if (!(await db.query('SELECT 1 FROM price_plans WHERE tenant_id=$1 AND id=$2', [tenant, id])).rowCount) throw new NotFoundException('Price plan not found');
  }
  private async find(db: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>, tenant: string, id: string, lock = false) {
    const result = await db.query(`SELECT ${fields} FROM price_rules WHERE tenant_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [tenant, id]);
    if (!result.rows[0]) throw new NotFoundException('Price rule not found');
    return result.rows[0];
  }
  private async write<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') throw new ConflictException('Price rule code already exists in this plan');
      if (code === '23503') throw new UnprocessableEntityException('Referenced room or special date is unavailable in this tenant');
      throw error;
    }
  }
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private audit(client: PoolClient, actor: Actor, action: string, id: string, before: unknown, after: unknown) {
    return client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES($1,$2,$3,$4,'PRICE_RULE',$5,$6,$7)`,
      [randomUUID(), actor.tenantId, actor.userId, action, id, before ? JSON.stringify(before) : null, JSON.stringify(after)]);
  }
}
