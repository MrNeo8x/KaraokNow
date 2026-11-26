export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.name = 'ApiError'; this.status = status; }
}

// Backend messages that end users see often; translated so the UI stays Vietnamese. Unknown messages pass through.
const FRIENDLY: [RegExp, string][] = [
  [/changed concurrently/i, 'Dữ liệu vừa được thay đổi đồng thời. Vui lòng tải lại rồi thử lại.'],
  [/insufficient role/i, 'Vai trò của bạn không có quyền thực hiện thao tác này.'],
  [/merchant is suspended/i, 'Merchant đang bị Platform khoá: không nhận giữ chỗ mới. Các giữ chỗ và booking hiện có vẫn xử lý được.'],
];
export function friendlyMessage(message: string): string { return FRIENDLY.find(([pattern]) => pattern.test(message))?.[1] ?? message; }

export async function request<T>(path: string, init: RequestInit = {}, token?: string, tenant?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (tenant) headers.set('X-Tenant-ID', tenant);
  const response = await fetch(`/v1${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = response.status >= 500 ? 'Hệ thống tạm thời không thể xử lý yêu cầu. Vui lòng thử lại sau.' : typeof body.error?.message === 'string' ? friendlyMessage(body.error.message) : `Yêu cầu không thành công (${response.status})`;
    const details = response.status < 500 && Array.isArray(body.error?.details) ? body.error.details.filter((item: unknown): item is string => typeof item === 'string') : [];
    const distinctDetails = details.filter((item: string) => item !== message);
    const rawCorrelation = typeof body.correlationId === 'string' ? body.correlationId : response.headers.get('X-Correlation-ID');
    const correlation = rawCorrelation && /^[A-Za-z0-9._-]{1,128}$/.test(rawCorrelation) ? rawCorrelation : null;
    throw new ApiError([message, ...distinctDetails, ...(correlation ? [`Mã tra cứu lỗi: ${correlation}`] : [])].join(' · '), response.status);
  }
  return response.status === 204 ? undefined as T : response.json();
}
