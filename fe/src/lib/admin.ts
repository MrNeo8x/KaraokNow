export type Role = 'OWNER' | 'BRANCH_MANAGER' | 'RECEPTIONIST' | 'CASHIER';
export const ROLES: Role[] = ['OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST', 'CASHIER'];
export const roleLabel: Record<Role, string> = { OWNER: 'Chủ (Owner)', BRANCH_MANAGER: 'Quản lý chi nhánh', RECEPTIONIST: 'Lễ tân', CASHIER: 'Thu ngân' };

/** Mirrors backend validation: a non-Owner role needs at least one branch unless OWNER is also granted. */
export function membershipError(input: { roles: Role[]; branchIds: string[] }): string | null {
  if (input.roles.length === 0) return 'Chọn ít nhất một vai trò.';
  if (!input.roles.includes('OWNER') && input.branchIds.length === 0) return 'Vai trò theo chi nhánh cần ít nhất một chi nhánh.';
  return null;
}

export function temporaryPasswordError(value: string): string | null {
  return value.length >= 12 ? null : 'Mật khẩu tạm cần ít nhất 12 ký tự.';
}

export function merchantCodeError(value: string): string | null {
  return /^[A-Z0-9][A-Z0-9_-]{0,49}$/.test(value) ? null : 'Mã merchant gồm chữ in hoa, số, "_" hoặc "-", bắt đầu bằng chữ/số, tối đa 50 ký tự.';
}

/** Audit log API returns a bare array; another page may exist only when the page is full. */
export function auditHasMore(count: number, limit: number): boolean { return count >= limit; }

/** Session id (`sid`) of the current access token, used only to label the current device. */
export function currentSessionId(accessToken: string): string | null {
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.sid === 'string' ? payload.sid : null;
  } catch { return null; }
}

export function formatAge(seconds: number | null): string {
  if (seconds === null) return 'không có';
  if (seconds < 60) return `${Math.round(seconds)} giây`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} giờ ${Math.floor((seconds % 3600) / 60)} phút`;
  return `${Math.floor(seconds / 86400)} ngày`;
}

/** User id (`sub`) of the current access token, used only to hide actions an admin may not apply to themselves. */
export function currentUserId(accessToken: string): string | null {
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch { return null; }
}

/** Platform write actions require a reason of 1–500 characters that is not only whitespace (PD-040). */
export function reasonError(value: string): string | null {
  if (!value.trim()) return 'Cần nhập lý do.';
  if (value.length > 500) return 'Lý do tối đa 500 ký tự.';
  return null;
}
