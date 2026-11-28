// Pure helpers for the unified reception calendar (REC-003): holds + bookings on one room timeline.
export type CalendarHold = { id: string; roomId: string; startAt: string; durationMinutes: number; reservedEndAt: string; status: 'HELD' | 'EXPIRED' | 'CONFIRMED'; channel?: string };
export type CalendarBooking = { id: string; roomId: string; startAt: string; durationMinutes: number; reservedEndAt?: string; status: string; customerPhone?: string; channel?: string };
export type CalendarEntry = { key: string; kind: 'hold' | 'booking'; id: string; roomId: string; start: number; end: number; reservedEnd: number; status: string; closed: boolean; phone?: string; channel?: string };

/** UTC offset (e.g. "+07:00") of an IANA zone on a calendar day, taken at local noon to avoid DST edges. */
export function zoneOffset(day: string, timeZone: string): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date(`${day}T12:00:00Z`)).find(item => item.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-]\d{2}):?(\d{2})?/.exec(part);
  return match ? `${match[1]}:${match[2] ?? '00'}` : '+00:00';
}

/** Calendar day in the branch zone for an instant. */
export function zoneDay(nowMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
}

export const DAY_START_HOUR = 6; // karaoke days run late: the view spans 06:00 → 06:00 next day

export function dayWindow(day: string, timeZone: string): { from: string; to: string; startMs: number; endMs: number } {
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const hour = `${String(DAY_START_HOUR).padStart(2, '0')}:00:00`;
  const from = `${day}T${hour}${zoneOffset(day, timeZone)}`; const to = `${next}T${hour}${zoneOffset(next, timeZone)}`;
  return { from, to, startMs: Date.parse(from), endMs: Date.parse(to) };
}

const CLOSED = new Set(['EXPIRED', 'CANCELLED', 'NO_SHOW']);

/** Bookings plus holds that have not become bookings (a CONFIRMED hold is already represented by its booking). */
export function mergeEntries(holds: CalendarHold[], bookings: CalendarBooking[]): CalendarEntry[] {
  const entries: CalendarEntry[] = [
    ...holds.filter(hold => hold.status !== 'CONFIRMED').map(hold => ({ key: `hold:${hold.id}`, kind: 'hold' as const, id: hold.id, roomId: hold.roomId, start: Date.parse(hold.startAt), end: Date.parse(hold.startAt) + hold.durationMinutes * 60_000, reservedEnd: Date.parse(hold.reservedEndAt), status: hold.status, closed: CLOSED.has(hold.status), channel: hold.channel })),
    ...bookings.map(booking => { const start = Date.parse(booking.startAt); const end = start + booking.durationMinutes * 60_000; return { key: `booking:${booking.id}`, kind: 'booking' as const, id: booking.id, roomId: booking.roomId, start, end, reservedEnd: booking.reservedEndAt ? Date.parse(booking.reservedEndAt) : end, status: booking.status, closed: CLOSED.has(booking.status), phone: booking.customerPhone, channel: booking.channel }; }),
  ];
  return entries.sort((a, b) => a.start - b.start || a.key.localeCompare(b.key));
}

export function visibleEntries(entries: CalendarEntry[], showClosed: boolean): CalendarEntry[] {
  return showClosed ? entries : entries.filter(entry => !entry.closed);
}

/** Horizontal placement as percentages of the window; null when entirely outside. Buffer tail runs to reservedEnd. */
export function placement(entry: CalendarEntry, startMs: number, endMs: number): { left: number; width: number; bufferWidth: number; clippedStart: boolean; clippedEnd: boolean } | null {
  const span = endMs - startMs; const visibleEnd = Math.max(entry.end, entry.reservedEnd);
  if (visibleEnd <= startMs || entry.start >= endMs) return null;
  const from = Math.max(entry.start, startMs); const to = Math.min(entry.end, endMs); const bufferTo = Math.min(visibleEnd, endMs);
  return { left: ((from - startMs) / span) * 100, width: (Math.max(0, to - from) / span) * 100, bufferWidth: (Math.max(0, bufferTo - Math.max(to, from)) / span) * 100, clippedStart: entry.start < startMs, clippedEnd: visibleEnd > endMs };
}

export const entryLabel: Record<string, string> = { HELD: 'Đang giữ chỗ', EXPIRED: 'Hold hết hạn', CONFIRMED: 'Đã xác nhận', CHECKED_IN: 'Đang sử dụng', COMPLETED: 'Hoàn tất', CANCELLED: 'Đã hủy', NO_SHOW: 'Khách không đến' };
export const entryTone: Record<string, string> = { HELD: 'amber', EXPIRED: 'gray', CONFIRMED: 'purple', CHECKED_IN: 'green', COMPLETED: 'gray', CANCELLED: 'rose', NO_SHOW: 'rose' };
