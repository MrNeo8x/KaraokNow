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
