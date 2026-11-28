import { resolveClientIp, validateClientIpSettings } from './client-ip';

const req = (headers: Record<string, string>, ip = '10.0.0.5') => ({ headers, ip, socket: { remoteAddress: '10.0.0.9' } });
const SECRET = 'proxy-secret-at-least-16';

describe('resolveClientIp (OPS-007)', () => {
  it('falls back to req.ip when nothing is configured, ignoring spoofable headers', () => {
    expect(resolveClientIp(req({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8' }), {})).toEqual({ ip: '10.0.0.5', source: 'request' });
  });

  it('uses the configured platform header, first entry only', () => {
    expect(resolveClientIp(req({ 'x-real-ip': '203.0.113.7' }), { CLIENT_IP_HEADER: 'x-real-ip' })).toEqual({ ip: '203.0.113.7', source: 'platform-header' });
    expect(resolveClientIp(req({ 'x-forwarded-for': '198.51.100.1, 10.1.1.1' }), { CLIENT_IP_HEADER: 'X-Forwarded-For' }))
      .toEqual({ ip: '198.51.100.1', source: 'platform-header' });
  });

  it('accepts the FE-forwarded IP only with the correct proxy secret', () => {
    const headers = { 'x-kn-client-ip': '2001:db8::1', 'x-kn-proxy-secret': SECRET, 'x-real-ip': '203.0.113.7' };
    expect(resolveClientIp(req(headers), { CLIENT_IP_PROXY_SECRET: SECRET, CLIENT_IP_HEADER: 'x-real-ip' })).toEqual({ ip: '2001:db8::1', source: 'trusted-proxy' });
    expect(resolveClientIp(req({ ...headers, 'x-kn-proxy-secret': 'wrong-secret-value!!' }), { CLIENT_IP_PROXY_SECRET: SECRET, CLIENT_IP_HEADER: 'x-real-ip' }))
      .toEqual({ ip: '203.0.113.7', source: 'platform-header' });
    expect(resolveClientIp(req(headers), {})).toEqual({ ip: '10.0.0.5', source: 'request' });
  });

  it('rejects non-IP values and normalises IPv4-mapped IPv6', () => {
    expect(resolveClientIp(req({ 'x-real-ip': 'not-an-ip' }), { CLIENT_IP_HEADER: 'x-real-ip' })).toEqual({ ip: '10.0.0.5', source: 'request' });
    expect(resolveClientIp(req({ 'x-kn-client-ip': '<script>', 'x-kn-proxy-secret': SECRET }), { CLIENT_IP_PROXY_SECRET: SECRET }).source).toBe('request');
    expect(resolveClientIp(req({}, '::ffff:192.0.2.10'), {})).toEqual({ ip: '192.0.2.10', source: 'request' });
  });

  it('validates settings', () => {
    expect(validateClientIpSettings({ CLIENT_IP_HEADER: 'x-real-ip', CLIENT_IP_PROXY_SECRET: SECRET })).toEqual([]);
    expect(validateClientIpSettings({ CLIENT_IP_HEADER: 'x-custom', CLIENT_IP_PROXY_SECRET: 'short' })).toEqual([
      'CLIENT_IP_HEADER must be one of x-real-ip, x-vercel-forwarded-for, x-forwarded-for, cf-connecting-ip',
      'CLIENT_IP_PROXY_SECRET must contain at least 16 characters'
    ]);
  });
});
