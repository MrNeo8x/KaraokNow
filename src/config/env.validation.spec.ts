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

  it('rejects a non-PostgreSQL database URL', () => {
    expect(() => validateEnvironment({ ...validConfig, DATABASE_URL: 'mysql://localhost/karaokenow' }))
      .toThrow('DATABASE_URL must use the postgres:// or postgresql:// protocol');
  });
});
