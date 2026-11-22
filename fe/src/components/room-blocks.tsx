'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { request } from '@/lib/api';

type Block = { id: string; roomId: string; reason: string; status: 'ACTIVE' | 'RELEASED'; startAt: string; endAt: string };
type Room = { id: string; name: string };
export default function RoomBlocks({ token, tenant, branchId, timezone, rooms }: { token: string; tenant: string; branchId: string; timezone: string; rooms: Room[] }) {
  const [blocks, setBlocks] = useState<Block[]>([]); const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [editing, setEditing] = useState(''); const [reason, setReason] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    request<Block[]>(`/merchant/branches/${encodeURIComponent(branchId)}/room-blocks`, { signal: controller.signal }, token, tenant).then(setBlocks).catch(err => { if (!controller.signal.aborted) setError((err as Error).message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, tenant, branchId, revision]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const offset = String(data.get('offset')); const startAt = `${data.get('start')}:00${offset}`; const endAt = `${data.get('end')}:00${offset}`; const text = String(data.get('reason')).trim();
    if (!/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset) || (offset.slice(1, 3) === '14' && offset.slice(4) !== '00') || !Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt)) || Date.parse(startAt) >= Date.parse(endAt)) { setError('Kiểm tra độ lệch UTC và thời gian kết thúc phải sau thời gian bắt đầu.'); return; }
    if (!text) { setError('Vui lòng nhập lý do bảo trì.'); return; }
    setBusy(true); setError(''); setMessage('');
    try { await request('/merchant/room-blocks', { method: 'POST', body: JSON.stringify({ roomId: data.get('roomId'), startAt, endAt, reason: text }) }, token, tenant); form.reset(); setMessage('Đã tạo khoảng bảo trì.'); setRevision(value => value + 1); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function update(block: Block, release: boolean, interval?: { startAt: string; endAt: string }) {
    if (release && !window.confirm('Kết thúc khoảng bảo trì này? Phòng có thể được tìm thấy khi không còn xung đột khác.')) return;
    if (!release && !reason.trim()) { setError('Vui lòng nhập lý do bảo trì.'); return; }
    setBusy(true); setError(''); setMessage('');
    try { await request(`/merchant/room-blocks/${encodeURIComponent(block.id)}${release ? '/release' : ''}`, { method: release ? 'POST' : 'PATCH', ...(!release ? { body: JSON.stringify({ reason: reason.trim(), ...interval }) } : {}) }, token, tenant); setEditing(''); setReason(''); setMessage(release ? 'Đã kết thúc bảo trì.' : 'Đã cập nhật khoảng bảo trì.'); setRevision(value => value + 1); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  function saveEdit(event: FormEvent<HTMLFormElement>, block: Block) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const startAt = String(data.get('startAt')).trim(); const endAt = String(data.get('endAt')).trim();
    const zone = /[Tt].*(?:[Zz]|[+-]\d{2}:?\d{2})$/;
    if (!zone.test(startAt) || !zone.test(endAt) || !Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt)) || Date.parse(startAt) >= Date.parse(endAt)) { setError('Nhập thời gian ISO có múi giờ; kết thúc phải sau bắt đầu.'); return; }
    void update(block, false, { startAt, endAt });
  }
  return <section className="card availability" aria-labelledby="blocks-title"><h2 id="blocks-title">Lịch khóa phòng bảo trì</h2><p>Chi nhánh đang chọn · múi giờ {timezone}. Khoảng bảo trì được kiểm tra xung đột với khoảng chiếm dụng hiện có.</p>
    {error && <div className="error" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}
    {loading ? <p aria-live="polite">Đang tải lịch bảo trì…</p> : blocks.length === 0 ? <p>Chưa có khoảng bảo trì.</p> : <ul className="amenity-list">{blocks.map(block => <li key={block.id}><div><strong>{rooms.find(room => room.id === block.roomId)?.name ?? block.roomId}</strong> · {block.status === 'ACTIVE' ? 'Đang áp dụng' : 'Đã kết thúc'}<br />{new Date(block.startAt).toLocaleString('vi-VN', { timeZone: timezone })} – {new Date(block.endAt).toLocaleString('vi-VN', { timeZone: timezone })}<br />{block.reason}{editing === block.id && <form className="action-form" onSubmit={event => saveEdit(event, block)}><p>Nhập thời gian ISO kèm múi giờ, ví dụ 2036-01-01T18:00:00+07:00. Giá trị hiện tại là UTC.</p><label>Bắt đầu<input name="startAt" defaultValue={block.startAt} required /></label><label>Kết thúc<input name="endAt" defaultValue={block.endAt} required /></label><label>Lý do<input value={reason} onChange={event => setReason(event.target.value)} maxLength={500} required /></label><div><button type="submit" disabled={busy}>Lưu</button><button type="button" disabled={busy} onClick={() => setEditing('')}>Hủy</button></div></form>}</div>{block.status === 'ACTIVE' && <div><button type="button" disabled={busy} onClick={() => { setEditing(block.id); setReason(block.reason); }}>Sửa khoảng bảo trì</button><button type="button" disabled={busy} onClick={() => void update(block, true)}>Kết thúc</button></div>}</li>)}</ul>}
    <details><summary>Tạo khoảng bảo trì</summary><form className="action-form pricing-grid" onSubmit={create}><label>Phòng<select name="roomId" required defaultValue=""><option value="" disabled>Chọn phòng</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label><label>Bắt đầu<input name="start" type="datetime-local" required /></label><label>Kết thúc<input name="end" type="datetime-local" required /></label><label>Độ lệch UTC<input name="offset" defaultValue="+07:00" pattern="[+-][0-9]{2}:[0-9]{2}" required /></label><label>Lý do<input name="reason" maxLength={500} required /></label><button className="primary" disabled={busy || loading || rooms.length === 0}>Tạo khoảng bảo trì</button></form></details>
  </section>;
}
