const DEFAULT_PORT = 3000;

export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];
  const databaseUrl = typeof config.DATABASE_URL === 'string' ? config.DATABASE_URL.trim() : '';
  const jwtSecret = typeof config.JWT_SECRET === 'string' ? config.JWT_SECRET : '';
  const portValue = config.PORT ?? DEFAULT_PORT;
  const port = Number(portValue);
  const trustProxyHops = Number(config.TRUST_PROXY_HOPS ?? 0);
  const positiveIntegerSettings = ['PUBLIC_RATE_LIMIT_WINDOW_MINUTES', 'PUBLIC_HOLD_IP_LIMIT', 'PUBLIC_HOLD_PHONE_LIMIT',
    'PUBLIC_LOOKUP_IP_LIMIT', 'PUBLIC_LOOKUP_PHONE_LIMIT'];

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
  if (config.SWAGGER_ENABLED !== undefined && config.SWAGGER_ENABLED !== '' && !['true', 'false'].includes(String(config.SWAGGER_ENABLED))) {
    errors.push('SWAGGER_ENABLED must be true or false');
  }
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 10) {
    errors.push('TRUST_PROXY_HOPS must be an integer between 0 and 10');
  }
  for (const name of positiveIntegerSettings) {
    if (config[name] === undefined || config[name] === '') continue;
    const value = Number(config[name]);
    if (!Number.isInteger(value) || value < 1 || value > 10000) errors.push(`${name} must be an integer between 1 and 10000`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
  }

  return { ...config, DATABASE_URL: databaseUrl, PORT: port, TRUST_PROXY_HOPS: trustProxyHops };
}
