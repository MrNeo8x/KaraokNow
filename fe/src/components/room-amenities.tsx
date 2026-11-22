'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { request } from '@/lib/api';

type Room = { id: string; name: string };
type Amenity = { id: string; label: string };

export default function RoomAmenities({ token, tenant, rooms }: { token: string; tenant: string; rooms: Room[] }) {
  const [roomId, setRoomId] = useState('');
  const [items, setItems] = useState<Amenity[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState('');
  const [label, setLabel] = useState('');
  const selected = rooms.some(room => room.id === roomId) ? roomId : '';

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    request<Amenity[]>(`/merchant/rooms/${encodeURIComponent(selected)}/amenities`, { signal: controller.signal }, token, tenant)
      .then(setItems)
      .catch(err => { if (!controller.signal.aborted) { setItems([]); setError((err as Error).message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selected, token, tenant, revision]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = label.trim();
    if (!value) { setError('Vui lòng nhập tên tiện nghi.'); return; }
    const roomAtSubmit = selected;
    if (!roomAtSubmit) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const suffix = editing ? `/${encodeURIComponent(editing)}` : '';
      await request(`/merchant/rooms/${encodeURIComponent(roomAtSubmit)}/amenities${suffix}`, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ label: value }) }, token, tenant);
      setLabel(''); setEditing(''); setMessage(editing ? 'Đã cập nhật tiện nghi.' : 'Đã thêm tiện nghi.'); setRevision(value => value + 1);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function remove(item: Amenity) {
    if (!selected || !window.confirm(`Xóa tiện nghi “${item.label}” khỏi phòng này?`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await request(`/merchant/rooms/${encodeURIComponent(selected)}/amenities/${encodeURIComponent(item.id)}`, { method: 'DELETE' }, token, tenant);
      if (editing === item.id) { setEditing(''); setLabel(''); }
      setMessage('Đã xóa tiện nghi.'); setRevision(value => value + 1);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="card amenities" aria-labelledby="amenities-title">
    <h2 id="amenities-title">Tiện nghi phòng</h2><p>Chọn phòng để xem và quản lý các tiện nghi. Quyền thay đổi do backend kiểm tra.</p>
    <label>Phòng<select value={selected} disabled={busy || rooms.length === 0} onChange={event => { setRoomId(event.target.value); setItems([]); setEditing(''); setLabel(''); setError(''); setMessage(''); }}><option value="">Chọn phòng</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
    {error && <div className="error" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}
    {selected && <>{loading ? <p aria-live="polite">Đang tải tiện nghi…</p> : items.length === 0 ? <p>Phòng chưa có tiện nghi.</p> : <ul className="amenity-list">{items.map(item => <li key={item.id}><span>{item.label}</span><div><button type="button" disabled={busy} onClick={() => { setEditing(item.id); setLabel(item.label); setError(''); setMessage(''); }}>Sửa</button><button type="button" disabled={busy} onClick={() => void remove(item)}>Xóa</button></div></li>)}</ul>}
      <form className="action-form" onSubmit={save}><label>{editing ? 'Sửa tên tiện nghi' : 'Thêm tiện nghi'}<input value={label} onChange={event => setLabel(event.target.value)} maxLength={80} required placeholder="Ví dụ: Micro không dây" /></label><div className="amenity-buttons"><button className="primary" disabled={busy || loading}>{busy ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Thêm tiện nghi'}</button>{editing && <button type="button" disabled={busy} onClick={() => { setEditing(''); setLabel(''); }}>Hủy sửa</button>}</div></form></>}
  </section>;
}
