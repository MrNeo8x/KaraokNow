import { poolConfigFromEnv, validateDbSettings } from './pool-config';

describe('PostgreSQL pool configuration (OPS-004)', () => {
  it('applies bounded defaults when nothing is configured', () => {
    expect(poolConfigFromEnv({ DATABASE_URL: 'postgresql://localhost/db' })).toEqual({
      connectionString: 'postgresql://localhost/db', max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
      statement_timeout: 15000, lock_timeout: 5000, idle_in_transaction_session_timeout: 60000
    });
  });

  it('uses configured values and treats empty strings as unset', () => {
    expect(poolConfigFromEnv({ DATABASE_URL: 'x', PG_POOL_MAX: '25', PG_LOCK_TIMEOUT_MS: '2000', PG_STATEMENT_TIMEOUT_MS: '' }))
      .toMatchObject({ max: 25, lock_timeout: 2000, statement_timeout: 15000 });
  });

  it('reports invalid values with their allowed range', () => {
    expect(validateDbSettings({ PG_POOL_MAX: '0', PG_CONNECTION_TIMEOUT_MS: '5.5', PG_LOCK_TIMEOUT_MS: 'abc', PG_IDLE_TIMEOUT_MS: '' })).toEqual([
      'PG_POOL_MAX must be an integer between 1 and 200',
      'PG_CONNECTION_TIMEOUT_MS must be an integer between 100 and 120000',
      'PG_LOCK_TIMEOUT_MS must be an integer between 100 and 600000'
    ]);
    expect(validateDbSettings({ PG_POOL_MAX: '200', PG_STATEMENT_TIMEOUT_MS: '100' })).toEqual([]);
  });
});
