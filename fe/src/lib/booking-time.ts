// Time-dependent booking helpers. Callers pass `nowMs` explicitly so nothing is computed at build/prerender time.
export const SLOTS = Array.from({ length: 15 }, (_, index) => `${String(9 + index).padStart(2, '0')}:00`);
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const VN_OFFSET_MS = 7 * 3600_000;

/** Calendar dates in Vietnam time (UTC+7), today first. */
export function upcomingDates(count: number, nowMs: number): { value: string; weekday: string; label: string }[] {
  const now = new Date(nowMs + VN_OFFSET_MS);
  return Array.from({ length: count }, (_, offset) => {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
    return { value: day.toISOString().slice(0, 10), weekday: offset === 0 ? 'Hôm nay' : offset === 1 ? 'Ngày mai' : WEEKDAYS[day.getUTCDay()], label: `${String(day.getUTCDate()).padStart(2, '0')}/${String(day.getUTCMonth() + 1).padStart(2, '0')}` };
  });
}

export function vietnamHour(nowMs: number): number { return new Date(nowMs + VN_OFFSET_MS).getUTCHours(); }

/** A slot is bookable unless it is today and its hour has already started. */
export function slotOpen(date: string, slot: string, nowMs: number): boolean {
  return date !== upcomingDates(1, nowMs)[0].value || Number(slot.slice(0, 2)) > vietnamHour(nowMs);
}

/** Preferred slot if open on that date, else the next open one, else the first open one; null when none is left. */
export function firstSlot(date: string, preferred: string, nowMs: number): string | null {
  const open = SLOTS.filter(slot => slotOpen(date, slot, nowMs));
  return open.includes(preferred) ? preferred : open.find(slot => slot >= preferred) ?? open[0] ?? null;
}

/** Today with the first open slot from 20:00, or tomorrow at 20:00 when today has no slot left. */
export function initialChoice(nowMs: number): { date: string; time: string } {
  const [today, tomorrow] = upcomingDates(2, nowMs);
  const time = firstSlot(today.value, '20:00', nowMs);
  return time ? { date: today.value, time } : { date: tomorrow.value, time: '20:00' };
}
