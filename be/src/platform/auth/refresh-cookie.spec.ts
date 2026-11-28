import { readRefreshCookie, refreshTokenFrom } from './refresh-cookie';

describe('refresh cookie (FE-012)', () => {
  const req = (headers: Record<string, string>) => ({ headers });

  it('reads the kn_refresh cookie among others', () => {
    expect(readRefreshCookie(req({ cookie: 'a=1; kn_refresh=abc%2Ddef; b=2' }))).toBe('abc-def');
    expect(readRefreshCookie(req({ cookie: 'kn_refresh_other=x' }))).toBeUndefined();
    expect(readRefreshCookie(req({}))).toBeUndefined();
  });

  it('uses the cookie only with X-KN-Session: 1; a body token wins', () => {
    const cookie = 'kn_refresh=' + 'c'.repeat(64);
    expect(refreshTokenFrom(req({ cookie }), undefined, false)).toBeUndefined();
    expect(refreshTokenFrom(req({ cookie, 'x-kn-session': '1' }), undefined, true)).toBe('c'.repeat(64));
    expect(refreshTokenFrom(req({ cookie, 'x-kn-session': '1' }), 'b'.repeat(64), true)).toBe('b'.repeat(64));
    expect(() => refreshTokenFrom(req({ cookie }), undefined, true)).toThrow('Refresh token is missing');
  });
});
