import { coordinatesFrom, directionsUrl, resolveMapsLink, type FetchLike } from './branch-location';

describe('branch location from a Google Maps link (PD-042)', () => {
  it('parses plain coordinates and full Google Maps URLs', () => {
    expect(coordinatesFrom('20.9786, 105.7569')).toEqual({ latitude: 20.9786, longitude: 105.7569 });
    expect(coordinatesFrom('https://www.google.com/maps/place/Karaoke/@20.97,105.75,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d20.9786123!4d105.7569456')).toEqual({ latitude: 20.978612, longitude: 105.756946 });
    expect(coordinatesFrom('https://www.google.com/maps/@21.0285,105.8542,15z')).toEqual({ latitude: 21.0285, longitude: 105.8542 });
    expect(coordinatesFrom('https://maps.google.com/?q=21.0285,105.8542')).toEqual({ latitude: 21.0285, longitude: 105.8542 });
    expect(coordinatesFrom('https://www.google.com/maps/search/?api=1&query=21.0285%2C105.8542')).toEqual({ latitude: 21.0285, longitude: 105.8542 });
    expect(coordinatesFrom('https://www.google.com/maps/search/21.0285,+105.8542')).toEqual({ latitude: 21.0285, longitude: 105.8542 });
    expect(coordinatesFrom('https://consent.google.com/m?continue=https%3A%2F%2Fwww.google.com%2Fmaps%2F%4021.0285%2C105.8542%2C15z')).toEqual({ latitude: 21.0285, longitude: 105.8542 });
  });

  it('rejects non-Google hosts, out-of-range and missing coordinates', () => {
    expect(coordinatesFrom('https://evil.example/maps/@21.0,105.8,15z')).toBeNull();
    expect(coordinatesFrom('95, 200')).toBeNull();
    expect(coordinatesFrom('0, 0')).toBeNull();
    expect(coordinatesFrom('https://www.google.com/maps/place/Karaoke+Majestic')).toBeNull();
    expect(directionsUrl(21.0285, 105.8542)).toBe('https://www.google.com/maps/dir/?api=1&destination=21.0285,105.8542');
    expect(directionsUrl(null, null)).toBeNull();
  });

  const redirecting = (chain: Record<string, string | null>): FetchLike & { calls: string[] } => {
    const calls: string[] = [];
    const fn = (async (url: string) => {
      calls.push(url);
      const location = chain[url] ?? null;
      return { status: location ? 302 : 200, headers: { get: (n: string) => (n === 'location' ? location : null) }, body: null };
    }) as unknown as FetchLike & { calls: string[] };
    fn.calls = calls;
    return fn;
  };

  it('expands short links by following Google redirects only', async () => {
    const fetchFn = redirecting({ 'https://maps.app.goo.gl/abc': 'https://www.google.com/maps/place/X/@21.0285,105.8542,17z' });
    await expect(resolveMapsLink('https://maps.app.goo.gl/abc', fetchFn)).resolves.toEqual({ latitude: 21.0285, longitude: 105.8542, mapsUrl: 'https://maps.app.goo.gl/abc' });
    await expect(resolveMapsLink('https://maps.app.goo.gl/evil', redirecting({ 'https://maps.app.goo.gl/evil': 'http://169.254.169.254/latest' })))
      .rejects.toThrow('Only Google Maps links are accepted');
    await expect(resolveMapsLink('https://evil.example/x', redirecting({}))).rejects.toThrow('Only Google Maps links are accepted');
    await expect(resolveMapsLink('https://maps.app.goo.gl/none', redirecting({ 'https://maps.app.goo.gl/none': 'https://www.google.com/maps/place/Karaoke' })))
      .rejects.toThrow('no coordinates');
    await expect(resolveMapsLink('21.0285, 105.8542', redirecting({}))).resolves.toEqual({ latitude: 21.0285, longitude: 105.8542, mapsUrl: null });
    await expect(resolveMapsLink('hello', redirecting({}))).rejects.toThrow('Not a Google Maps link');
  });
});
