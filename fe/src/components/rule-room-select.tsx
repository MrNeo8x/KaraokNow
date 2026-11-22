'use client';
import { useEffect, useState } from 'react';
import { request } from '@/lib/api';

type Branch = { id: string; name: string };
type Room = { id: string; name: string };
export default function RuleRoomSelect({ token, tenant, branches, currentBranch, value, onChange }: { token: string; tenant: string; branches: Branch[]; currentBranch: string; value: string; onChange: (value: string) => void }) {
  const [branchId, setBranchId] = useState(currentBranch);
  const [rooms, setRooms] = useState<Room[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    if (!branchId || !branches.some(branch => branch.id === branchId)) { setRooms([]); return; }
    const controller = new AbortController(); setLoading(true); setError(''); setRooms([]);
    request<Room[]>(`/merchant/branches/${encodeURIComponent(branchId)}/rooms`, { signal: controller.signal }, token, tenant).then(setRooms).catch(err => { if (!controller.signal.aborted) setError((err as Error).message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [branchId, branches, token, tenant]);
  return <div><label>Chi nhánh để chọn phòng<select value={branches.some(branch => branch.id === branchId) ? branchId : ''} onChange={event => setBranchId(event.target.value)}><option value="">Chọn chi nhánh</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
    <label>Phòng áp dụng<select name="roomId" value={value} onChange={event => onChange(event.target.value)}><option value="">Mọi phòng</option>{value && !rooms.some(room => room.id === value) && <option value={value}>Phòng đã chọn ngoài danh sách: {value}</option>}{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
    {loading && <p aria-live="polite">Đang tải phòng…</p>}{error && <div className="error" role="alert">{error} · Giá trị đã chọn được giữ nguyên.</div>}
  </div>;
}
