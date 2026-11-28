import { UnprocessableEntityException } from '@nestjs/common';

/**
 * VEN-004 / PD-042: the Owner pastes a Google Maps link (or plain coordinates); we keep the coordinates so customers get
 * an exact "directions" link. No Maps API key: full links are parsed locally; short links (maps.app.goo.gl, goo.gl/maps)
 * are expanded by following redirects, only over https and only to Google hosts (no SSRF), without reading bodies.
 */
export interface MapsLocation { latitude: number; longitude: number; mapsUrl: string | null }
export type FetchLike = (url: string, init: { method: string; redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> }) =>
  Promise<{ status: number; headers: { get(name: string): string | null }; body?: { cancel?(): unknown } | null }>;

const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);
const GOOGLE_HOST = /^(?:(?:www|maps|consent)\.)?google\.(?:com|com\.vn)$/;
const MAX_HOPS = 5;
const HOP_TIMEOUT_MS = 4000;
const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';

export function directionsUrl(latitude: number | null, longitude: number | null): string | null {
  return latitude === null || longitude === null ? null
    : `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}

function valid(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}
function pair(text: string | null | undefined): { latitude: number; longitude: number } | null {
  if (!text) return null;
  const m = new RegExp(`^\\s*${NUM}\\s*,\\s*\\+?${NUM}\\s*$`).exec(text.replace(/\+/g, ' '));
  if (!m) return null;
  const latitude = Number(m[1]), longitude = Number(m[2]);
  return valid(latitude, longitude) ? { latitude: round(latitude), longitude: round(longitude) } : null;
}
function round(value: number) { return Math.round(value * 1e6) / 1e6; }

/** Extracts coordinates from plain "lat, lng" or a full Google Maps URL; null when none are present. */
export function coordinatesFrom(input: string): { latitude: number; longitude: number } | null {
  const direct = pair(input);
  if (direct) return direct;
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if (!GOOGLE_HOST.test(url.hostname)) return null;
  if (url.hostname.startsWith('consent.')) {
    const next = url.searchParams.get('continue');
    return next ? coordinatesFrom(next) : null;
  }
  const decoded = decodeURIComponent(url.pathname + url.hash);
  // Place pin (!3d lat !4d lng) is more exact than the viewport centre (@lat,lng,zoom).
  const pin = new RegExp(`!3d${NUM}!4d${NUM}`).exec(decoded + url.search);
  if (pin && valid(Number(pin[1]), Number(pin[2]))) return { latitude: round(Number(pin[1])), longitude: round(Number(pin[2])) };
  for (const key of ['q', 'query', 'destination', 'll', 'center', 'daddr']) {
    const found = pair(url.searchParams.get(key));
    if (found) return found;
  }
  const search = new RegExp(`/(?:search|place|dir)/(?:[^/]*/)*?${NUM},\\s*\\+?${NUM}`).exec(decoded);
  if (search && valid(Number(search[1]), Number(search[2]))) return { latitude: round(Number(search[1])), longitude: round(Number(search[2])) };
  const viewport = new RegExp(`@${NUM},${NUM}`).exec(decoded);
  if (viewport && valid(Number(viewport[1]), Number(viewport[2]))) return { latitude: round(Number(viewport[1])), longitude: round(Number(viewport[2])) };
  return null;
}

function allowedHop(url: URL) {
  return url.protocol === 'https:' && (SHORT_HOSTS.has(url.hostname) || GOOGLE_HOST.test(url.hostname));
}

export async function resolveMapsLink(input: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<MapsLocation> {
  const text = input.trim();
  if (!text || text.length > 500) throw new UnprocessableEntityException('Paste a Google Maps link or "latitude, longitude" (max 500 characters)');
  const direct = coordinatesFrom(text);
  let isUrl = false;
  try { isUrl = ['http:', 'https:'].includes(new URL(text).protocol); } catch { /* plain text */ }
  if (direct) return { ...direct, mapsUrl: isUrl ? text : null };
  if (!isUrl) throw new UnprocessableEntityException('Not a Google Maps link or "latitude, longitude"');
  let current = new URL(text);
  if (!allowedHop(current)) throw new UnprocessableEntityException('Only Google Maps links are accepted');
  // Follow redirects (short link → google.com/maps/…, possibly via consent.google.com) until coordinates appear.
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HOP_TIMEOUT_MS);
    let location: string | null;
    try {
      const res = await fetchImpl(current.toString(), { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { 'user-agent': 'KaraokeNow/1.0' } });
      location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      await res.body?.cancel?.();
    } catch {
      throw new UnprocessableEntityException('Could not open the short Google Maps link; paste the full link or coordinates');
    } finally { clearTimeout(timer); }
    if (!location) break;
    const next = new URL(location, current);
    if (!allowedHop(next)) throw new UnprocessableEntityException('Only Google Maps links are accepted');
    const found = coordinatesFrom(next.toString());
    if (found) return { ...found, mapsUrl: text };
    current = next;
  }
  throw new UnprocessableEntityException('The link has no coordinates; open the place in Google Maps and copy the link from the address bar, or paste "latitude, longitude"');
}
