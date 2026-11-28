// Pure helpers for the hand-rolled SVG charts on the report screens (FE-020).

/** Axis maximum rounded up to 1/2/5 × 10^n so gridlines land on round numbers; 0 data → 1. */
export function niceMax(values: number[]): number {
  const max = Math.max(0, ...values); if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max)); const scaled = max / power;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * power;
}

/** Axis maximum for counts: a multiple of 4 (≥ 4) so the 4 gridline intervals stay whole numbers (0 data → 4). */
export function countMax(values: number[]): number { return Math.max(4, Math.ceil(niceMax(values) / 4) * 4); }

/** Evenly spaced ticks 0..max (count intervals). */
export function ticks(max: number, count = 4): number[] { return Array.from({ length: count + 1 }, (_, index) => (max / count) * index); }

/** Indices of x labels to show so at most `maxLabels` appear (first and last always kept). */
export function labelIndices(length: number, maxLabels: number): number[] {
  if (length <= maxLabels) return Array.from({ length }, (_, index) => index);
  const step = Math.ceil((length - 1) / (maxLabels - 1)); const picked: number[] = [];
  for (let index = 0; index < length; index += step) picked.push(index);
  if (picked.at(-1) !== length - 1) picked.push(length - 1);
  return picked;
}

/** Sequential bucket 0..steps-1 for a heatmap cell; 0 is reserved for "no bookings". */
export function heatLevel(value: number, max: number, steps = 5): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(steps - 1, 1 + Math.floor((value / max) * (steps - 1) - 1e-9));
}

/** Compact VND for axes: 1.250.000 → "1,25 tr"; 12.000 → "12 k". Full values stay in tooltips and tables. */
export function compactVnd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`;
  if (abs >= 1e6) return `${(value / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tr`;
  if (abs >= 1e3) return `${(value / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} k`;
  return value.toLocaleString('vi-VN');
}

export function percent(rate: number): string { return `${(rate * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`; }

/** Default report range: the last 30 days ending today (Vietnam time), as YYYY-MM-DD. */
export function defaultRange(nowMs: number, days = 30): { from: string; to: string } {
  const today = new Date(nowMs + 7 * 3600_000).toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to: today };
}

/** Period label: day "28/11", week "Tuần 24/11", month "11/2026". */
export function periodLabel(period: string, groupBy: 'day' | 'week' | 'month'): string {
  const [y, m, d] = period.split('-');
  return groupBy === 'month' ? `${m}/${y}` : groupBy === 'week' ? `Tuần ${d}/${m}` : `${d}/${m}`;
}
