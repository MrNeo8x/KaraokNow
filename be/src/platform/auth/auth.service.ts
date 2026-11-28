import { HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash, hashSync } from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database/database.module';
import { ChangePasswordDto, LoginDto } from './auth.dto';

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
/** FE-012: several tabs sharing the refresh cookie may refresh at the same moment; a token rotated this recently is not treated as reuse. */
export const CONCURRENT_REFRESH_GRACE_SECONDS = 10;
export { REFRESH_TTL_SECONDS };
const DUMMY_HASH = hashSync('constant-time-dummy-password', 12);

interface UserRow { id: string; password_hash: string; must_change_password: boolean }
interface SessionRow {
  id: string; user_id: string; family_id: string; expires_at: Date; revoked_at: Date | null;
  replaced_by: string | null; must_change_password: boolean;
}
export interface TokenPair {
  accessToken: string; expiresIn: number; refreshToken: string; refreshExpiresIn: number; mustChangePassword: boolean;
}

@Injectable()
export class AuthService {
  constructor(@Inject(PG_POOL) private readonly db: Pool, private readonly jwt: JwtService) {}

  async login(dto: LoginDto): Promise<TokenPair> {
    const email = dto.email.trim().toLowerCase();
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const user = (await client.query<UserRow>(
        `SELECT id,password_hash,must_change_password FROM users WHERE email=$1 AND status='ACTIVE'`, [email])).rows[0];
      const throttle = (await client.query<{ failed_count: number; window_started_at: Date; locked_until: Date | null }>(
        'SELECT failed_count,window_started_at,locked_until FROM auth_login_throttles WHERE email=$1 FOR UPDATE', [email])).rows[0];
      if (throttle?.locked_until && throttle.locked_until.getTime() > Date.now()) {
        await this.securityEvent(client, user?.id, 'LOGIN_LOCKED');
        await client.query('COMMIT');
        throw new HttpException('Too many login attempts', HttpStatus.TOO_MANY_REQUESTS);
      }
      const valid = await compare(dto.password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !valid) {
        const locked = await this.recordFailure(client, email, throttle);
        await this.securityEvent(client, user?.id, locked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED');
        await client.query('COMMIT');
        if (locked) throw new HttpException('Too many login attempts', HttpStatus.TOO_MANY_REQUESTS);
        throw new UnauthorizedException('Invalid credentials');
      }
      await client.query('DELETE FROM auth_login_throttles WHERE email=$1', [email]);
      const pair = await this.createSession(client, user.id, randomUUID(), user.must_change_password);
      await this.securityEvent(client, user.id, 'LOGIN_SUCCEEDED');
      await client.query('COMMIT');
      return pair;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async refresh(rawToken: string, allowConcurrent = false): Promise<TokenPair> {
    const tokenHash = this.tokenHash(rawToken);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const family = (await client.query<{ family_id: string }>('SELECT family_id FROM auth_sessions WHERE refresh_token_hash=$1', [tokenHash])).rows[0];
      if (!family) throw new UnauthorizedException('Invalid refresh token');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`auth-family:${family.family_id}`]);
      const session = (await client.query<SessionRow>(
        `SELECT s.id,s.user_id,s.family_id,s.expires_at,s.revoked_at,s.replaced_by,u.must_change_password
         FROM auth_sessions s JOIN users u ON u.id=s.user_id
         WHERE s.refresh_token_hash=$1 AND u.status='ACTIVE' FOR UPDATE`, [tokenHash])).rows[0];
      if (!session) throw new UnauthorizedException('Invalid refresh token');
      if (allowConcurrent && session.revoked_at && session.replaced_by) {
        const concurrent = (await client.query(`SELECT 1 FROM auth_sessions r WHERE r.id=$1 AND r.revoked_at IS NULL
          AND $2::timestamptz > clock_timestamp()-($3::integer*interval '1 second')`,
        [session.replaced_by, session.revoked_at, CONCURRENT_REFRESH_GRACE_SECONDS])).rowCount;
        if (concurrent && session.expires_at.getTime() > Date.now()) {
          // Benign race (two tabs, same cookie): issue a sibling session in the same family; the family stays intact.
          const pair = await this.createSession(client, session.user_id, session.family_id, session.must_change_password);
          await client.query('COMMIT');
          return pair;
        }
      }
      if (session.revoked_at) {
        await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=$1', [session.family_id]);
        await this.securityEvent(client, session.user_id, 'REFRESH_TOKEN_REUSE');
        await client.query('COMMIT');
        throw new UnauthorizedException('Refresh token reuse detected');
      }
      if (session.expires_at.getTime() <= Date.now()) {
        await client.query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1', [session.id]);
        await client.query('COMMIT');
        throw new UnauthorizedException('Refresh token expired');
      }
      const replacementId = randomUUID();
      const pair = await this.createSession(client, session.user_id, session.family_id,
        session.must_change_password, replacementId);
      await client.query('UPDATE auth_sessions SET revoked_at=now(),replaced_by=$2,last_used_at=now() WHERE id=$1',
        [session.id, replacementId]);
      await client.query('COMMIT');
      return pair;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async logout(rawToken: string): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const family = (await client.query<{ family_id: string }>('SELECT family_id FROM auth_sessions WHERE refresh_token_hash=$1', [this.tokenHash(rawToken)])).rows[0];
      if (family) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`auth-family:${family.family_id}`]);
        await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=$1', [family.family_id]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async listSessions(userId: string): Promise<unknown[]> {
    return (await this.db.query(
      `SELECT id,created_at AS "createdAt",last_used_at AS "lastUsedAt",expires_at AS "expiresAt",
              (revoked_at IS NOT NULL) AS revoked
       FROM auth_sessions WHERE user_id=$1 ORDER BY created_at DESC`, [userId])).rows;
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    await this.db.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND user_id=$2',
      [sessionId, userId]);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = (await this.db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=$1', [userId])).rows[0];
    if (!user || !(await compare(dto.currentPassword, user.password_hash))) throw new UnauthorizedException('Current password is invalid');
    const passwordHash = await hash(dto.newPassword, 12);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE users SET password_hash=$2,must_change_password=false,password_changed_at=now(),updated_at=now() WHERE id=$1`,
        [userId, passwordHash]);
      await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1', [userId]);
      await this.securityEvent(client, userId, 'PASSWORD_CHANGED');
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private async createSession(client: PoolClient, userId: string, familyId: string,
                              mustChangePassword: boolean, sessionId = randomUUID()): Promise<TokenPair> {
    const refreshToken = randomBytes(48).toString('base64url');
    await client.query(
      `INSERT INTO auth_sessions(id,user_id,family_id,refresh_token_hash,expires_at)
       VALUES ($1,$2,$3,$4,now()+($5 || ' seconds')::interval)`,
      [sessionId, userId, familyId, this.tokenHash(refreshToken), REFRESH_TTL_SECONDS]);
    return {
      accessToken: await this.jwt.signAsync({ sub: userId, sid: sessionId }, { expiresIn: ACCESS_TTL_SECONDS }),
      expiresIn: ACCESS_TTL_SECONDS, refreshToken, refreshExpiresIn: REFRESH_TTL_SECONDS, mustChangePassword
    };
  }

  private async recordFailure(client: PoolClient, email: string,
                              current?: { failed_count: number; window_started_at: Date; locked_until: Date | null }): Promise<boolean> {
    const now = new Date();
    const withinWindow = current && now.getTime() - current.window_started_at.getTime() < FAILURE_WINDOW_MS;
    const count = withinWindow ? current.failed_count + 1 : 1;
    const locked = count >= MAX_FAILURES;
    await client.query(
      `INSERT INTO auth_login_throttles(email,failed_count,window_started_at,locked_until,updated_at)
       VALUES ($1,$2,$3,$4,now()) ON CONFLICT(email) DO UPDATE
       SET failed_count=EXCLUDED.failed_count,window_started_at=EXCLUDED.window_started_at,
           locked_until=EXCLUDED.locked_until,updated_at=now()`,
      [email, count, withinWindow ? current!.window_started_at : now, locked ? new Date(now.getTime() + LOCK_MS) : null]);
    return locked;
  }

  private tokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
  private securityEvent(client: PoolClient, userId: string | undefined, event: string) {
    return client.query('INSERT INTO auth_security_events(id,user_id,event) VALUES ($1,$2,$3)', [randomUUID(), userId ?? null, event]);
  }
}
