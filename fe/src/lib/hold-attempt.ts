export type HoldAttempt = { key: string; room: { id: string; name: string; code: string; capacity: number }; input: { roomId: string; startAt: string; durationMinutes: number; channel: string } };
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The JWT subject partitions local recovery data only. The backend still verifies identity and authorization.
export function holdStorageKey(token: string, tenant: string, branch: string): string {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!uuid.test(payload.sub) || !uuid.test(tenant) || !uuid.test(branch)) throw new Error();
    return `karaokenow:hold:v1:${payload.sub}:${tenant}:${branch}`;
  } catch { throw new Error('Không xác định được phạm vi khôi phục hold. Vui lòng đăng nhập lại.'); }
}

export function readHoldAttempt(storage: Store, key: string): HoldAttempt | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  try {
    const data = JSON.parse(raw);
    if (!uuid.test(data.key) || !uuid.test(data.room?.id) || data.input?.roomId !== data.room.id || typeof data.room.name !== 'string' || typeof data.room.code !== 'string' || !Number.isInteger(data.room.capacity) || !Number.isInteger(data.input.durationMinutes) || data.input.durationMinutes < 1 || data.input.durationMinutes > 1440 || data.input.channel !== 'WALK_IN' || typeof data.input.startAt !== 'string' || !/[Tt].*(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(data.input.startAt) || !Number.isFinite(Date.parse(data.input.startAt))) throw new Error();
    return data as HoldAttempt;
  } catch { throw new Error('Dữ liệu khôi phục hold không hợp lệ. Không thể tự động gửi lại; cần kiểm tra danh sách hold.'); }
}

export function writeHoldAttempt(storage: Store, key: string, attempt: HoldAttempt): void { storage.setItem(key, JSON.stringify(attempt)); }
export function clearHoldAttempt(storage: Store, key: string): void { storage.removeItem(key); }
