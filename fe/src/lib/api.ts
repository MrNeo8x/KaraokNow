export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.name = 'ApiError'; this.status = status; }
}

// Backend messages that end users see often; translated so the UI stays Vietnamese. Unknown messages pass through.
const FRIENDLY: [RegExp, string | ((match: RegExpMatchArray) => string)][] = [
  [/15-minute boundary/i, 'Giờ bắt đầu phải theo bước 15 phút (vd 20:00, 20:15).'],
  [/within the branch opening hours \(([^)]*)\)/i, match => `Giờ đặt phải nằm trong giờ mở cửa của chi nhánh (${match[1]}).`],
  [/changed concurrently/i, 'Dữ liệu vừa được thay đổi đồng thời. Vui lòng tải lại rồi thử lại.'],
  [/insufficient role/i, 'Vai trò của bạn không có quyền thực hiện thao tác này.'],
  [/at least one active owner/i, 'Merchant phải còn ít nhất một Owner đang hoạt động.'],
  [/at least one active platform admin/i, 'Phải còn ít nhất một Platform Admin đang hoạt động.'],
  [/on their own account/i, 'Không thực hiện được thao tác này trên chính tài khoản của bạn.'],
  [/memberships of a merchant they belong to/i, 'Không sửa được thành viên của merchant mà bạn cũng là thành viên.'],
  [/enable the user before issuing a temporary password/i, 'Tài khoản đang bị khoá: mở khoá trước khi cấp mật khẩu tạm.'],
  [/only active users can become platform admin/i, 'Chỉ tài khoản đang hoạt động mới được cấp Platform Admin.'],
  [/already a tenant member/i, 'Người dùng này đã là thành viên của merchant.'],
  [/branch-scoped roles require at least one branch/i, 'Vai trò theo chi nhánh cần ít nhất một chi nhánh.'],
  [/^nothing to change$/i, 'Không có thay đổi nào để lưu.'],
  [/support sessions are read-only/i, 'Phiên hỗ trợ chỉ được xem: không thay đổi được dữ liệu của merchant.'],
  [/super admin role is required/i, 'Chỉ Super Admin mới thực hiện được thao tác này.'],
  [/at least one active super admin/i, 'Phải còn ít nhất một Super Admin đang hoạt động.'],
  [/grant platform admin first/i, 'Người dùng phải là Platform Admin trước khi được cấp Super Admin.'],
  [/use your own membership/i, 'Bạn là thành viên của merchant này: mở merchant bằng tài khoản thành viên của mình, không dùng phiên hỗ trợ.'],
  [/no active membership for tenant/i, 'Tài khoản không có quyền trong merchant này (hoặc phiên hỗ trợ đã kết thúc).'],
  [/support session not found/i, 'Không tìm thấy phiên hỗ trợ.'],
  [/merchant is suspended/i, 'Merchant đang bị Platform khoá: không nhận giữ chỗ mới. Các giữ chỗ và booking hiện có vẫn xử lý được.'],
];
export function friendlyMessage(message: string): string {
  for (const [pattern, text] of FRIENDLY) { const match = message.match(pattern); if (match) return typeof text === 'function' ? text(match) : text; }
  return message;
}

/** Builds the user-facing error for a failed response (shared by JSON and binary requests). */
async function toApiError(response: Response): Promise<ApiError> {
  const body = await response.json().catch(() => ({}));
  const message = response.status >= 500 ? 'Hệ thống tạm thời không thể xử lý yêu cầu. Vui lòng thử lại sau.'
    : response.status === 413 ? 'File lớn hơn 4 MB. Hãy chọn file nhỏ hơn.'
    : typeof body.error?.message === 'string' ? friendlyMessage(body.error.message) : `Yêu cầu không thành công (${response.status})`;
  const details = response.status < 500 && Array.isArray(body.error?.details) ? body.error.details.filter((item: unknown): item is string => typeof item === 'string') : [];
  const distinctDetails = details.filter((item: string) => item !== message);
  const rawCorrelation = typeof body.correlationId === 'string' ? body.correlationId : response.headers.get('X-Correlation-ID');
  const correlation = rawCorrelation && /^[A-Za-z0-9._-]{1,128}$/.test(rawCorrelation) ? rawCorrelation : null;
  return new ApiError([message, ...distinctDetails, ...(correlation ? [`Mã tra cứu lỗi: ${correlation}`] : [])].join(' · '), response.status);
}

function buildHeaders(init: RequestInit, token?: string, tenant?: string): Headers {
  const headers = new Headers(init.headers);
  // FormData must let the browser set multipart/form-data with its boundary.
  if (!headers.has('Content-Type') && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (tenant) headers.set('X-Tenant-ID', tenant);
  return headers;
}

// Set by the merchant area while a Super Admin support session is open (PD-045): writes fail fast in the browser.
let readOnlyGuard = false;
export const READ_ONLY_MESSAGE = 'Phiên hỗ trợ chỉ được xem: không thay đổi được dữ liệu của merchant.';
/** Merchant API calls that change data; blocked in the browser while a support session is read-only. */
export function isMerchantWrite(path: string, method = 'GET'): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) && path.startsWith('/merchant/');
}
export function setReadOnlyGuard(on: boolean): void { readOnlyGuard = on; }

export async function request<T>(path: string, init: RequestInit = {}, token?: string, tenant?: string): Promise<T> {
  if (readOnlyGuard && isMerchantWrite(path, init.method)) throw new ApiError(READ_ONLY_MESSAGE, 403);
  const response = await fetch(`/v1${path}`, { ...init, headers: buildHeaders(init, token, tenant) });
  if (!response.ok) throw await toApiError(response);
  return response.status === 204 ? undefined as T : response.json();
}

/** Binary download that needs the Authorization header (e.g. private PDFs), returned as a Blob. */
export async function requestBlob(path: string, token?: string, tenant?: string, init: RequestInit = {}): Promise<Blob> {
  const response = await fetch(`/v1${path}`, { ...init, headers: buildHeaders(init, token, tenant) });
  if (!response.ok) throw await toApiError(response);
  return response.blob();
}
