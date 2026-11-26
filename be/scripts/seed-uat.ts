import { hash } from 'bcryptjs';
import { Pool } from 'pg';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '10000000-0000-4000-8000-000000000002';
const MEMBERSHIP_ID = '10000000-0000-4000-8000-000000000003';
const BRANCH_ID = '10000000-0000-4000-8000-000000000004';
const ROOM_IDS = [
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006'
];
const EMAIL = 'uat.owner@karaokenow.local';
const PASSWORD = 'Uat-owner-password-2026!';
// Platform Admin has no tenant membership so it can approve the UAT merchant (self-review is rejected).
const PLATFORM_ADMIN_ID = '10000000-0000-4000-8000-000000000007';
const PLATFORM_ADMIN_EMAIL = 'uat.platform@karaokenow.local';
const PLATFORM_ADMIN_PASSWORD = 'Uat-platform-password-2026!';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const target = new URL(connectionString);
  if (!['localhost', '127.0.0.1'].includes(target.hostname)) {
    throw new Error('UAT seed is restricted to a local database');
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO tenants(id,code,name,status) VALUES($1,'UAT','KaraokeNow UAT','ACTIVE')
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,status='ACTIVE'`, [TENANT_ID]
    );
    await client.query(
      `INSERT INTO users(id,email,password_hash,display_name,status,must_change_password)
       VALUES($1,$2,$3,'UAT Owner','ACTIVE',false)
       ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,password_hash=EXCLUDED.password_hash,
         display_name=EXCLUDED.display_name,status='ACTIVE',must_change_password=false`,
      [USER_ID, EMAIL, await hash(PASSWORD, 12)]
    );
    await client.query(
      `INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES($1,$2,$3,'ACTIVE')
       ON CONFLICT(id) DO UPDATE SET status='ACTIVE',updated_at=now()`,
      [MEMBERSHIP_ID, TENANT_ID, USER_ID]
    );
    await client.query(
      `INSERT INTO membership_roles(membership_id,role) VALUES($1,'OWNER') ON CONFLICT DO NOTHING`,
      [MEMBERSHIP_ID]
    );
    await client.query(
      `INSERT INTO branches(id,tenant_id,code,name,timezone,status)
       VALUES($1,$2,'UAT-HCM','KaraokeNow UAT Hồ Chí Minh','Asia/Ho_Chi_Minh','ACTIVE')
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,timezone=EXCLUDED.timezone,status='ACTIVE',updated_at=now()`,
      [BRANCH_ID, TENANT_ID]
    );
    await client.query(
      `INSERT INTO rooms(id,tenant_id,branch_id,code,name,capacity,status) VALUES
       ($1,$3,$4,'UAT-VIP-01','Phòng VIP 01',12,'ACTIVE'),
       ($2,$3,$4,'UAT-FAMILY-01','Phòng Gia Đình 01',8,'ACTIVE')
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,capacity=EXCLUDED.capacity,status='ACTIVE',updated_at=now()`,
      [ROOM_IDS[0], ROOM_IDS[1], TENANT_ID, BRANCH_ID]
    );
    await client.query(
      `INSERT INTO tenant_public_catalog(tenant_id,published,platform_approved,updated_by)
       VALUES($1,true,true,$2)
       ON CONFLICT(tenant_id) DO UPDATE SET published=true,platform_approved=true,updated_by=EXCLUDED.updated_by,
         updated_at=clock_timestamp(),version=tenant_public_catalog.version+1`,
      [TENANT_ID, USER_ID]
    );
    await client.query(
      `INSERT INTO users(id,email,password_hash,display_name,status,must_change_password)
       VALUES($1,$2,$3,'UAT Platform Admin','ACTIVE',false)
       ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,password_hash=EXCLUDED.password_hash,
         display_name=EXCLUDED.display_name,status='ACTIVE',must_change_password=false`,
      [PLATFORM_ADMIN_ID, PLATFORM_ADMIN_EMAIL, await hash(PLATFORM_ADMIN_PASSWORD, 12)]
    );
    await client.query(
      `INSERT INTO platform_admins(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET revoked_at=NULL`,
      [PLATFORM_ADMIN_ID]
    );
    await client.query('COMMIT');
    console.log(JSON.stringify({
      platformAdmin: { email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD },
      email: EMAIL,
      password: PASSWORD,
      tenantId: TENANT_ID,
      branchId: BRANCH_ID
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
