import type { PoolConfig } from 'pg';

/**
 * OPS-004: explicit PostgreSQL pool and timeout limits. Every value can be overridden by environment
 * variable; defaults keep the previous pool size and add bounds where there were none (waiting for a
 * pooled connection, statements, lock waits and abandoned transactions were all unbounded).
 */
export const DB_SETTINGS = {
  PG_POOL_MAX: { default: 10, min: 1, max: 200 },
  PG_CONNECTION_TIMEOUT_MS: { default: 5_000, min: 100, max: 120_000 },
  PG_IDLE_TIMEOUT_MS: { default: 30_000, min: 1_000, max: 600_000 },
  PG_STATEMENT_TIMEOUT_MS: { default: 15_000, min: 100, max: 600_000 },
  PG_LOCK_TIMEOUT_MS: { default: 5_000, min: 100, max: 600_000 },
  PG_IDLE_IN_TRANSACTION_TIMEOUT_MS: { default: 60_000, min: 1_000, max: 3_600_000 }
} as const;

export type DbSettingName = keyof typeof DB_SETTINGS;

/** Returns an error message per invalid setting; unset or empty values fall back to defaults. */
export function validateDbSettings(env: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const [name, rule] of Object.entries(DB_SETTINGS)) {
    const raw = env[name];
    if (raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < rule.min || value > rule.max) errors.push(`${name} must be an integer between ${rule.min} and ${rule.max}`);
  }
  return errors;
}

export function dbSetting(env: Record<string, unknown>, name: DbSettingName): number {
  const raw = env[name];
  return raw === undefined || raw === '' ? DB_SETTINGS[name].default : Number(raw);
}

export function poolConfigFromEnv(env: Record<string, unknown>): PoolConfig {
  return {
    connectionString: String(env.DATABASE_URL ?? ''),
    max: dbSetting(env, 'PG_POOL_MAX'),
    connectionTimeoutMillis: dbSetting(env, 'PG_CONNECTION_TIMEOUT_MS'),
    idleTimeoutMillis: dbSetting(env, 'PG_IDLE_TIMEOUT_MS'),
    statement_timeout: dbSetting(env, 'PG_STATEMENT_TIMEOUT_MS'),
    lock_timeout: dbSetting(env, 'PG_LOCK_TIMEOUT_MS'),
    idle_in_transaction_session_timeout: dbSetting(env, 'PG_IDLE_IN_TRANSACTION_TIMEOUT_MS')
  };
}
