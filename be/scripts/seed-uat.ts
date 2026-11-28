/**
 * Local UAT seed (UAT-001). Idempotent: fixed IDs + upserts; re-running restores the sample configuration.
 * Restricted to a local database. Credentials below are for local UAT only.
 *
 * Merchant UAT  — published and Platform-approved; WEB requires a 30% deposit, PHONE/WALK_IN may confirm without deposit;
 *                 Owner, Branch Manager, Receptionist and Cashier accounts.
 * Merchant UAT2 — published but awaiting Platform approval (approval is set only on first insert, so testers can re-test it
 *                 by revoking); WEB may confirm without deposit.
 * Platform Admin — no merchant membership, so it may approve both merchants.
 */
import { hash } from 'bcryptjs';
import { Pool, PoolClient } from 'pg';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const UAT = {
  tenantId: id(1), code: 'UAT', name: 'KaraokeNow UAT', branchId: id(4), branchCode: 'UAT-HCM', branchName: 'KaraokeNow UAT Hồ Chí Minh',
  rooms: [
    { id: id(5), code: 'UAT-VIP-01', name: 'Phòng VIP 01', capacity: 12, ruleId: id(11), amountVnd: 150000 },
    { id: id(6), code: 'UAT-FAMILY-01', name: 'Phòng Gia Đình 01', capacity: 8, ruleId: id(12), amountVnd: 100000 }
  ],
  planId: id(10)
};
const UAT2 = {
  tenantId: id(101), code: 'UAT2', name: 'KaraokeNow UAT Thứ Hai', branchId: id(104), branchCode: 'UAT2-HN', branchName: 'KaraokeNow UAT Hà Nội',
  rooms: [{ id: id(105), code: 'UAT2-STD-01', name: 'Phòng Tiêu Chuẩn 01', capacity: 6, ruleId: id(111), amountVnd: 120000 }],
  planId: id(110)
};
const ACCOUNTS = {
  owner: { userId: id(2), membershipId: id(3), email: 'uat.owner@karaokenow.local', password: 'Uat-owner-password-2026!', name: 'UAT Owner' },
  manager: { userId: id(20), membershipId: id(30), email: 'uat.manager@karaokenow.local', password: 'Uat-manager-password-2026!', name: 'UAT Branch Manager', role: 'BRANCH_MANAGER' },
  receptionist: { userId: id(21), membershipId: id(31), email: 'uat.reception@karaokenow.local', password: 'Uat-reception-password-2026!', name: 'UAT Receptionist', role: 'RECEPTIONIST' },
  cashier: { userId: id(22), membershipId: id(32), email: 'uat.cashier@karaokenow.local', password: 'Uat-cashier-password-2026!', name: 'UAT Cashier', role: 'CASHIER' },
  owner2: { userId: id(102), membershipId: id(103), email: 'uat2.owner@karaokenow.local', password: 'Uat2-owner-password-2026!', name: 'UAT2 Owner' },
  platform: { userId: id(7), email: 'uat.platform@karaokenow.local', password: 'Uat-platform-password-2026!', name: 'UAT Platform Admin' }
};
const TERMS = 'Khách hủy hoặc đổi giờ vui lòng gọi chi nhánh trước giờ đặt ít nhất 2 giờ. Tiền cọc được nhân viên xem xét hoàn lại theo từng trường hợp.';

async function upsertUser(client: PoolClient, account: { userId: string; email: string; password: string; name: string }) {
  await client.query(
    `INSERT INTO users(id,email,password_hash,display_name,status,must_change_password) VALUES($1,$2,$3,$4,'ACTIVE',false)
     ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,password_hash=EXCLUDED.password_hash,display_name=EXCLUDED.display_name,status='ACTIVE',must_change_password=false`,
    [account.userId, account.email, await hash(account.password, 12), account.name]);
}

async function upsertMembership(client: PoolClient, membershipId: string, tenantId: string, userId: string, role: string, branchId?: string) {
  await client.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES($1,$2,$3,'ACTIVE') ON CONFLICT(id) DO UPDATE SET status='ACTIVE',updated_at=now()`,
    [membershipId, tenantId, userId]);
  await client.query(`DELETE FROM membership_roles WHERE membership_id=$1`, [membershipId]);
  await client.query(`INSERT INTO membership_roles(membership_id,role) VALUES($1,$2)`, [membershipId, role]);
  await client.query(`DELETE FROM membership_branches WHERE membership_id=$1`, [membershipId]);
  if (branchId) await client.query(`INSERT INTO membership_branches(membership_id,tenant_id,branch_id) VALUES($1,$2,$3)`, [membershipId, tenantId, branchId]);
}

async function upsertMerchant(client: PoolClient, merchant: typeof UAT, ownerId: string, approvedOnInsert: boolean) {
  await client.query(`INSERT INTO tenants(id,code,name,status) VALUES($1,$2,$3,'ACTIVE') ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,status='ACTIVE'`,
    [merchant.tenantId, merchant.code, merchant.name]);
  await client.query(`INSERT INTO branches(id,tenant_id,code,name,timezone,status) VALUES($1,$2,$3,$4,'Asia/Ho_Chi_Minh','ACTIVE')
    ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,timezone=EXCLUDED.timezone,status='ACTIVE',updated_at=now()`,
  [merchant.branchId, merchant.tenantId, merchant.branchCode, merchant.branchName]);
  for (const room of merchant.rooms) {
    await client.query(`INSERT INTO rooms(id,tenant_id,branch_id,code,name,capacity,status) VALUES($1,$2,$3,$4,$5,$6,'ACTIVE')
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,capacity=EXCLUDED.capacity,status='ACTIVE',updated_at=now()`,
    [room.id, merchant.tenantId, merchant.branchId, room.code, room.name, room.capacity]);
  }
  await client.query(`INSERT INTO price_plans(id,tenant_id,code,name,status) VALUES($1,$2,$3,$4,'ACTIVE')
    ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,status='ACTIVE',updated_at=now()`, [merchant.planId, merchant.tenantId, `${merchant.code}-STANDARD`, 'Bảng giá chuẩn UAT']);
  for (const [index, room] of merchant.rooms.entries()) {
    await client.query(`INSERT INTO price_rules(id,tenant_id,price_plan_id,room_id,code,name,priority,amount_vnd,amount_unit,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PER_HOUR','ACTIVE')
      ON CONFLICT(id) DO UPDATE SET amount_vnd=EXCLUDED.amount_vnd,amount_unit='PER_HOUR',status='ACTIVE',updated_at=now()`,
    [room.ruleId, merchant.tenantId, merchant.planId, room.id, `${room.code}-HOURLY`, `${room.name} theo giờ`, 100 + index, room.amountVnd]);
  }
  await client.query(`INSERT INTO tenant_public_catalog(tenant_id,published,platform_approved,updated_by,public_booking_terms,public_booking_terms_version,public_booking_terms_updated_at)
    VALUES($1,true,$2,$3,$4,1,clock_timestamp())
    ON CONFLICT(tenant_id) DO UPDATE SET published=true,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp(),version=tenant_public_catalog.version+1,
      public_booking_terms=COALESCE(tenant_public_catalog.public_booking_terms,EXCLUDED.public_booking_terms),
      public_booking_terms_version=GREATEST(tenant_public_catalog.public_booking_terms_version,1),
      public_booking_terms_updated_at=COALESCE(tenant_public_catalog.public_booking_terms_updated_at,EXCLUDED.public_booking_terms_updated_at)`,
  [merchant.tenantId, approvedOnInsert, ownerId, TERMS]);
}

async function upsertDepositPolicy(client: PoolClient, tenantId: string, channel: string, mode: 'NONE' | 'PERCENT', percent: string | null, by: string) {
  await client.query(`INSERT INTO tenant_deposit_policies(tenant_id,channel,mode,fixed_amount_vnd,percent,updated_by) VALUES($1,$2,$3,NULL,$4,$5)
    ON CONFLICT(tenant_id,channel) DO UPDATE SET mode=EXCLUDED.mode,fixed_amount_vnd=NULL,percent=EXCLUDED.percent,updated_by=EXCLUDED.updated_by,updated_at=now(),version=tenant_deposit_policies.version+1`,
  [tenantId, channel, mode, percent, by]);
}

async function allowNoDeposit(client: PoolClient, tenantId: string, channel: string, by: string) {
  await client.query(`INSERT INTO tenant_no_deposit_confirmation_policies(tenant_id,channel,allowed,updated_by) VALUES($1,$2,true,$3)
    ON CONFLICT(tenant_id,channel) DO UPDATE SET allowed=true,updated_by=EXCLUDED.updated_by,updated_at=now(),version=tenant_no_deposit_confirmation_policies.version+1`,
  [tenantId, channel, by]);
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const target = new URL(connectionString);
  if (!['localhost', '127.0.0.1'].includes(target.hostname)) throw new Error('UAT seed is restricted to a local database');

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const account of Object.values(ACCOUNTS)) await upsertUser(client, account);

    await upsertMerchant(client, UAT, ACCOUNTS.owner.userId, true);
    await client.query(`UPDATE tenant_public_catalog SET platform_approved=true WHERE tenant_id=$1`, [UAT.tenantId]);
    await upsertMembership(client, ACCOUNTS.owner.membershipId, UAT.tenantId, ACCOUNTS.owner.userId, 'OWNER');
    for (const staff of [ACCOUNTS.manager, ACCOUNTS.receptionist, ACCOUNTS.cashier]) {
      await upsertMembership(client, staff.membershipId, UAT.tenantId, staff.userId, staff.role, UAT.branchId);
    }
    await upsertDepositPolicy(client, UAT.tenantId, 'WEB', 'PERCENT', '30', ACCOUNTS.owner.userId);
    await upsertDepositPolicy(client, UAT.tenantId, 'PHONE', 'NONE', null, ACCOUNTS.owner.userId);
    await allowNoDeposit(client, UAT.tenantId, 'PHONE', ACCOUNTS.owner.userId);
    await allowNoDeposit(client, UAT.tenantId, 'WALK_IN', ACCOUNTS.owner.userId);

    await upsertMerchant(client, UAT2, ACCOUNTS.owner2.userId, false);
    await upsertMembership(client, ACCOUNTS.owner2.membershipId, UAT2.tenantId, ACCOUNTS.owner2.userId, 'OWNER');
    await upsertDepositPolicy(client, UAT2.tenantId, 'WEB', 'NONE', null, ACCOUNTS.owner2.userId);
    await allowNoDeposit(client, UAT2.tenantId, 'WEB', ACCOUNTS.owner2.userId);

    // UAT Platform Admin is also Super Admin (PD-045) so support sessions can be tried locally. Never run this seed on production.
    await client.query(`INSERT INTO platform_admins(user_id,super_admin) VALUES($1,true) ON CONFLICT(user_id) DO UPDATE SET revoked_at=NULL,super_admin=true`, [ACCOUNTS.platform.userId]);
    await client.query('COMMIT');

    const approval2 = (await client.query(`SELECT platform_approved FROM tenant_public_catalog WHERE tenant_id=$1`, [UAT2.tenantId])).rows[0].platform_approved;
    console.log(JSON.stringify({
      platformAdmin: { email: ACCOUNTS.platform.email, password: ACCOUNTS.platform.password },
      merchants: [
        { code: UAT.code, tenantId: UAT.tenantId, branchId: UAT.branchId, platformApproved: true, webDeposit: 'PERCENT 30%', noDepositChannels: ['PHONE', 'WALK_IN'],
          accounts: [ACCOUNTS.owner, ACCOUNTS.manager, ACCOUNTS.receptionist, ACCOUNTS.cashier].map(a => ({ email: a.email, password: a.password, role: 'role' in a ? a.role : 'OWNER' })) },
        { code: UAT2.code, tenantId: UAT2.tenantId, branchId: UAT2.branchId, platformApproved: approval2, webDeposit: 'NONE', noDepositChannels: ['WEB'],
          accounts: [{ email: ACCOUNTS.owner2.email, password: ACCOUNTS.owner2.password, role: 'OWNER' }] }
      ],
      // Backward-compatible fields for existing scripts/docs.
      email: ACCOUNTS.owner.email, password: ACCOUNTS.owner.password, tenantId: UAT.tenantId, branchId: UAT.branchId
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
