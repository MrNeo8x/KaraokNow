// PD-042 helpers: branch phone display/tel links and PATCH semantics (omit = keep, null = clear).

/** "+84989015619" → "0989 015 619"; other numbers are returned unchanged. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const local = phone.startsWith('+84') ? `0${phone.slice(3)}` : phone;
  return /^0\d{9}$/.test(local) ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}` : local;
}

/** tel: link with only digits and a leading +. */
export function telHref(phone: string): string { return `tel:${phone.replace(/[^\d+]/g, '')}`; }

/**
 * Value to send for an optional text field on PATCH: undefined when unchanged (field omitted), null when the user
 * cleared a previous value, otherwise the trimmed text.
 */
export function patchText(input: string, previous: string | null | undefined): string | null | undefined {
  const next = input.trim(); const before = (previous ?? '').trim();
  if (next === before) return undefined;
  return next === '' ? null : next;
}

/** Message shown when the BE cannot read coordinates from the pasted link (422). */
export const MAPS_LINK_HELP = 'Mở đúng quán trên Google Maps rồi bấm Chia sẻ → Sao chép liên kết, hoặc dán toạ độ (vd 21.0285, 105.8542).';

export type HoursInput = { allDay: boolean; openingTime: string; closingTime: string };
export type HoursPayload = { openingTime: string | null; closingTime: string | null };

/**
 * Opening hours for POST/PATCH (PD-043): both fields together, both null = open 24 h. Returns undefined when nothing
 * changed versus `previous` (edit) or when creating a 24 h branch (BE default), or an error message.
 */
export function hoursPayload(input: HoursInput, previous?: { openingTime?: string | null; closingTime?: string | null }): HoursPayload | undefined | { error: string } {
  const next: HoursPayload = input.allDay ? { openingTime: null, closingTime: null } : { openingTime: input.openingTime || null, closingTime: input.closingTime || null };
  if (!input.allDay) {
    if (!next.openingTime || !next.closingTime) return { error: 'Nhập cả giờ mở và giờ đóng cửa, hoặc chọn mở 24 giờ.' };
    if (next.openingTime === next.closingTime) return { error: 'Giờ mở và giờ đóng cửa không được trùng nhau. Mở cả ngày thì chọn "Mở 24 giờ".' };
  }
  const before: HoursPayload = { openingTime: previous?.openingTime ?? null, closingTime: previous?.closingTime ?? null };
  if (!previous && input.allDay) return undefined;
  return next.openingTime === before.openingTime && next.closingTime === before.closingTime ? undefined : next;
}
