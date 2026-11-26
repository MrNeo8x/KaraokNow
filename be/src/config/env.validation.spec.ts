import { validateEnvironment } from './env.validation';

describe('environment validation', () => {
  const validConfig = {
    DATABASE_URL: 'postgresql://karaokenow:local@localhost:5432/karaokenow',
    JWT_SECRET: 'local-development-secret-at-least-32-characters'
  };

  it('applies the default port', () => {
    expect(validateEnvironment(validConfig)).toEqual(expect.objectContaining({ PORT: 3000 }));
  });

  it('reports all invalid required settings together', () => {
    expect(() => validateEnvironment({ PORT: '70000' })).toThrow(
      /DATABASE_URL is required[\s\S]*JWT_SECRET must contain at least 32 characters[\s\S]*PORT must be an integer/
    );
  });

  it('defaults TRUST_PROXY_HOPS to 0 and parses a configured value', () => {
    expect(validateEnvironment(validConfig)).toEqual(expect.objectContaining({ TRUST_PROXY_HOPS: 0 }));
    expect(validateEnvironment({ ...validConfig, TRUST_PROXY_HOPS: '2' })).toEqual(expect.objectContaining({ TRUST_PROXY_HOPS: 2 }));
  });

  it.each(['-1', '11', '1.5', 'abc'])('rejects TRUST_PROXY_HOPS=%s', (value) => {
    expect(() => validateEnvironment({ ...validConfig, TRUST_PROXY_HOPS: value }))
      .toThrow('TRUST_PROXY_HOPS must be an integer between 0 and 10');
  });

  it('accepts unset or empty public rate-limit settings and valid overrides', () => {
    expect(() => validateEnvironment({ ...validConfig, PUBLIC_HOLD_IP_LIMIT: '', PUBLIC_LOOKUP_PHONE_LIMIT: '10000' })).not.toThrow();
  });

  it.each(['0', '10001', '2.5', 'many'])('rejects public rate-limit value %s', (value) => {
    expect(() => validateEnvironment({ ...validConfig, PUBLIC_HOLD_PHONE_LIMIT: value }))
      .toThrow('PUBLIC_HOLD_PHONE_LIMIT must be an integer between 1 and 10000');
  });

  it('accepts SWAGGER_ENABLED true/false/unset and rejects other values', () => {
    for (const value of ['true', 'false', '', undefined]) expect(() => validateEnvironment({ ...validConfig, SWAGGER_ENABLED: value })).not.toThrow();
    expect(() => validateEnvironment({ ...validConfig, SWAGGER_ENABLED: 'no' })).toThrow('SWAGGER_ENABLED must be true or false');
  });

  it('rejects a non-PostgreSQL database URL', () => {
    expect(() => validateEnvironment({ ...validConfig, DATABASE_URL: 'mysql://localhost/karaokenow' }))
      .toThrow('DATABASE_URL must use the postgres:// or postgresql:// protocol');
  });
});
