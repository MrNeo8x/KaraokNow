export type Session = { accessToken: string; refreshToken: string; expiresIn: number; mustChangePassword: boolean };

export function parseSession(value: unknown): Session {
  if (!value || typeof value !== 'object') throw new Error('Phản hồi phiên không hợp lệ. Vui lòng đăng nhập lại.');
  const data = value as Record<string, unknown>;
  if (typeof data.accessToken !== 'string' || !data.accessToken || typeof data.refreshToken !== 'string' || !data.refreshToken || typeof data.expiresIn !== 'number' || !Number.isSafeInteger(data.expiresIn) || data.expiresIn <= 0 || data.expiresIn > 86400 || typeof data.mustChangePassword !== 'boolean') throw new Error('Phản hồi phiên không hợp lệ. Vui lòng đăng nhập lại.');
  return { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresIn: data.expiresIn, mustChangePassword: data.mustChangePassword };
}

export function refreshDelay(expiresIn: number): number { return Math.max(1000, (expiresIn - 60) * 1000); }
