const DEFAULT_PORT = 3000;

export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];
  const databaseUrl = typeof config.DATABASE_URL === 'string' ? config.DATABASE_URL.trim() : '';
  const jwtSecret = typeof config.JWT_SECRET === 'string' ? config.JWT_SECRET : '';
  const portValue = config.PORT ?? DEFAULT_PORT;
  const port = Number(portValue);

  if (!databaseUrl) {
    errors.push('DATABASE_URL is required');
  } else {
    try {
      const parsed = new URL(databaseUrl);
      if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
        errors.push('DATABASE_URL must use the postgres:// or postgresql:// protocol');
      }
    } catch {
      errors.push('DATABASE_URL must be a valid URL');
    }
  }

  if (jwtSecret.length < 32) {
    errors.push('JWT_SECRET must contain at least 32 characters');
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT must be an integer between 1 and 65535');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
  }

  return { ...config, DATABASE_URL: databaseUrl, PORT: port };
}
