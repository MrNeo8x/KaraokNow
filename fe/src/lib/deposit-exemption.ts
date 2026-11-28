// Case-level deposit exemptions (FE-024, BKG-008, PD-050): labels and policy form ⇄ payload with the backend's limits.
import type { Role } from './admin';

export type ExemptionReason = 'AMOUNT' | 'OFF_PEAK' | 'REGULAR_CUSTOMER' | 'MANUAL_WAIVER';
export type OffPeakWindow = { weekdays: number[]; from: string; to: string };
export type ExemptionPolicy = { configured: boolean; maxAmountVnd: string | null; offPeakWindows: OffPeakWindow[]; regularMinCompleted: number | null; regularLookbackDays: number; waiverRoles: Role[]; version: string | null };
export type ExemptionForm = { maxAmount: string; windows: OffPeakWindow[]; regularMin: string; lookback: string; waiverRoles: Role[] };
export type ExemptionPayload = { maxAmountVnd: string | null; offPeakWindows: OffPeakWindow[]; regularMinCompleted: number | null; regularLookbackDays: number; waiverRoles: Role[] };

export const EXEMPTION_LABEL: Record<ExemptionReason, string> = { AMOUNT: 'giá trị nhỏ', OFF_PEAK: 'giờ vắng', REGULAR_CUSTOMER: 'khách quen', MANUAL_WAIVER: 'duyệt miễn thủ công' };
export const WEEKDAY_LABEL = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "Được miễn cọc: giá trị nhỏ, giờ vắng" (empty string when no reason). */
export function exemptionText(reasons: readonly string[] | null | undefined): string {
  const labels = (reasons ?? []).map(reason => EXEMPTION_LABEL[reason as ExemptionReason] ?? reason);
  return labels.length ? `Được miễn cọc: ${labels.join(', ')}` : '';
}

export function toForm(policy: ExemptionPolicy): ExemptionForm {
  return { maxAmount: policy.maxAmountVnd ?? '', windows: policy.offPeakWindows.map(window => ({ ...window, weekdays: [...window.weekdays] })), regularMin: policy.regularMinCompleted === null ? '' : String(policy.regularMinCompleted), lookback: String(policy.regularLookbackDays), waiverRoles: [...policy.waiverRoles] };
}

/** Validates like the backend DTO (amount 1–15 digits, ≤ 14 windows ending after they start, 1–100 visits, 7–730 days). */
export function exemptionPayload(form: ExemptionForm): { payload: ExemptionPayload } | { error: string } {
  const amount = form.maxAmount.trim().replace(/[.,\s]/g, '');
  if (amount && !/^[1-9]\d{0,14}$/.test(amount)) return { error: 'Ngưỡng tiền phải là số nguyên VND dương (bỏ trống để tắt).' };
  if (form.windows.length > 14) return { error: 'Tối đa 14 khung giờ vắng.' };
  for (const [index, window] of form.windows.entries()) {
    if (window.weekdays.length === 0) return { error: `Khung giờ vắng ${index + 1}: chọn ít nhất một ngày.` };
    if (!TIME.test(window.from) || !TIME.test(window.to)) return { error: `Khung giờ vắng ${index + 1}: giờ phải dạng HH:mm.` };
    if (window.to <= window.from) return { error: `Khung giờ vắng ${index + 1}: giờ kết thúc phải sau giờ bắt đầu trong cùng ngày (không qua nửa đêm).` };
  }
  const regular = form.regularMin.trim();
  if (regular && !(/^\d+$/.test(regular) && Number(regular) >= 1 && Number(regular) <= 100)) return { error: 'Số lần đến để tính khách quen là số nguyên 1–100 (bỏ trống để tắt).' };
  const lookback = form.lookback.trim();
  if (!(/^\d+$/.test(lookback) && Number(lookback) >= 7 && Number(lookback) <= 730)) return { error: 'Khoảng thời gian xét khách quen là 7–730 ngày.' };
  const roles = Array.from(new Set<Role>(['OWNER', ...form.waiverRoles]));
  return { payload: { maxAmountVnd: amount || null, offPeakWindows: form.windows.map(window => ({ weekdays: [...new Set(window.weekdays)].sort((a, b) => a - b), from: window.from, to: window.to })), regularMinCompleted: regular ? Number(regular) : null, regularLookbackDays: Number(lookback), waiverRoles: roles } };
}
