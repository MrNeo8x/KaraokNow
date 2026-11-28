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

// Opening hours (PD-043). Minutes are counted from 00:00 of the selected business day; a window closing at or before
// its opening time ends on the next calendar day (e.g. 18:00–02:00 → 1080..1560). No hours = open 24 h (no end).
export type OpeningWindow = { start: number; end: number; allDay: boolean };
export const START_STEP_MINUTES = 15;

export function toMinutes(time: string): number { const [h, m] = time.split(':').map(Number); return h * 60 + m; }
export function fromMinutes(minutes: number): string { const m = ((minutes % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }

export function openingWindow(opening?: string | null, closing?: string | null): OpeningWindow {
  if (!opening || !closing) return { start: 0, end: Number.POSITIVE_INFINITY, allDay: true };
  const start = toMinutes(opening); let end = toMinutes(closing); if (end <= start) end += 1440;
  return { start, end, allDay: false };
}

/** Offset of a start time within the business day: times before opening in an overnight window belong to the next day. */
export function startOffset(time: string, window: OpeningWindow): number {
  const minutes = toMinutes(time);
  return !window.allDay && window.end > 1440 && minutes < window.start ? minutes + 1440 : minutes;
}

/** Calendar date of the start (next day after midnight in an overnight window) for building startAt. */
export function calendarStart(day: string, time: string, window: OpeningWindow): { date: string; nextDay: boolean } {
  const nextDay = startOffset(time, window) >= 1440;
  if (!nextDay) return { date: day, nextDay };
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { date: next, nextDay };
}

/** Start on the 15-minute grid and [start, start + duration) inside one opening window. */
export function fitsWindow(time: string, duration: number, window: OpeningWindow): boolean {
  if (!/^\d{2}:\d{2}$/.test(time) || toMinutes(time) % START_STEP_MINUTES !== 0) return false;
  const offset = startOffset(time, window);
  return offset >= window.start && offset + duration <= window.end;
}

/** Already started (Vietnam time) for that business day. */
export function isPast(day: string, time: string, window: OpeningWindow, nowMs: number): boolean {
  const { date } = calendarStart(day, time, window);
  return Date.parse(`${date}T${time}:00+07:00`) <= nowMs;
}

/** Hourly quick buttons: every full hour of the window that still fits the duration; 24 h branches keep 09:00–23:00. */
export function quickSlots(window: OpeningWindow, duration: number): string[] {
  if (window.allDay) return Array.from({ length: 15 }, (_, index) => fromMinutes((9 + index) * 60));
  const slots: string[] = [];
  for (let minutes = Math.ceil(window.start / 60) * 60; minutes + duration <= window.end; minutes += 60) slots.push(fromMinutes(minutes));
  return slots;
}

/** Preferred time when it fits and has not started, else the next such quick slot, else the first one; null if none. */
export function pickTime(day: string, preferred: string, window: OpeningWindow, duration: number, nowMs: number): string | null {
  const usable = (time: string) => fitsWindow(time, duration, window) && !isPast(day, time, window, nowMs);
  if (usable(preferred)) return preferred;
  const slots = quickSlots(window, duration).filter(usable);
  return slots.find(slot => startOffset(slot, window) >= startOffset(preferred, window)) ?? slots[0] ?? null;
}

/** Today with a usable start from 20:00, or tomorrow when today has none left. */
export function initialChoice(nowMs: number, window: OpeningWindow = openingWindow(), duration = 120): { date: string; time: string } {
  const [today, tomorrow] = upcomingDates(2, nowMs);
  const time = pickTime(today.value, '20:00', window, duration, nowMs);
  return time ? { date: today.value, time } : { date: tomorrow.value, time: pickTime(tomorrow.value, '20:00', window, duration, nowMs) ?? '20:00' };
}

export type BookingPolicy = { minDurationMinutes: number; maxDurationMinutes: number; durationStepMinutes: number; startStepMinutes?: number };
export const DEFAULT_POLICY: BookingPolicy = { minDurationMinutes: 60, maxDurationMinutes: 480, durationStepMinutes: 30, startStepMinutes: 15 };

/** Valid durations: min + k × step, up to max. */
export function durationOptions(policy: BookingPolicy = DEFAULT_POLICY): number[] {
  const step = Math.max(1, policy.durationStepMinutes); const options: number[] = [];
  for (let value = policy.minDurationMinutes; value <= policy.maxDurationMinutes && options.length < 200; value += step) options.push(value);
  return options.length ? options : [policy.minDurationMinutes];
}

/** Closest valid duration to the preferred one (ties go to the longer option). */
export function nearestDuration(options: number[], preferred: number): number {
  return options.reduce((best, value) => Math.abs(value - preferred) <= Math.abs(best - preferred) ? value : best, options[0]);
}
