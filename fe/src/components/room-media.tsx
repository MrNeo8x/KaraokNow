'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { request } from '@/lib/api';

type Media = { id: string; assetRef: string; altText: string | null; displayOrder: number };
export default function RoomMedia({ token, tenant, rooms }: { token: string; tenant: string; rooms: { id: string; name: string }[] }) {
  const [roomId, setRoomId] = useState(''); const [items, setItems] = useState<Media[]>([]); const [revision, setRevision] = useState(0);
  const [editId, setEditId] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const selected = rooms.some(room => room.id === roomId) ? roomId : ''; const item = items.find(media => media.id === editId);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController(); setLoading(true); setError('');
    request<Media[]>(`/merchant/rooms/${encodeURIComponent(selected)}/media`, { signal: controller.signal }, token, tenant).then(setItems).catch(err => { if (!controller.signal.aborted) { setItems([]); setError((err as Error).message); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selected, token, tenant, revision]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const assetRef = String(data.get('assetRef')).trim(); const altText = String(data.get('altText')).trim();
    if (!assetRef) { setError('Vui lòng nhập mã tham chiếu tài sản.'); return; }
    setBusy(true); setError(''); setMessage('');
    try { await request(`/merchant/rooms/${encodeURIComponent(selected)}/media${item ? `/${encodeURIComponent(item.id)}` : ''}`, { method: item ? 'PATCH' : 'POST', body: JSON.stringify({ assetRef, ...(item ? { altText: altText || null } : altText ? { altText } : {}), displayOrder: Number(data.get('displayOrder')) }) }, token, tenant); form.reset(); setEditId(''); setMessage(item ? 'Đã cập nhật metadata.' : 'Đã thêm metadata.'); setRevision(value => value + 1); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function remove(media: Media) {
    if (!window.confirm('Xóa metadata hình ảnh này khỏi phòng?')) return;
    setBusy(true); setError(''); setMessage('');
    try { await request(`/merchant/rooms/${encodeURIComponent(selected)}/media/${encodeURIComponent(media.id)}`, { method: 'DELETE' }, token, tenant); setEditId(''); setMessage('Đã xóa metadata.'); setRevision(value => value + 1); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <section className="card amenities" aria-labelledby="media-title"><h2 id="media-title">Metadata hình ảnh phòng</h2><p>Chỉ quản lý mã tham chiếu, mô tả và thứ tự; chưa tải ảnh lên hoặc hiển thị file ảnh.</p>
    <label>Phòng<select value={selected} disabled={busy || !rooms.length} onChange={event => { setRoomId(event.target.value); setItems([]); setEditId(''); setError(''); setMessage(''); }}><option value="">Chọn phòng</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
    {error && <div className="error" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}
    {selected && <>{loading ? <p aria-live="polite">Đang tải metadata…</p> : items.length === 0 ? <p>Chưa có metadata hình ảnh.</p> : <ul className="amenity-list">{items.map(media => <li key={media.id}><span>{media.assetRef}<br />Mô tả: {media.altText || '—'} · Thứ tự: {media.displayOrder}</span><div><button type="button" disabled={busy} onClick={() => { setEditId(media.id); setMessage(''); setError(''); }}>Sửa</button><button type="button" disabled={busy} onClick={() => void remove(media)}>Xóa</button></div></li>)}</ul>}
      <form className="action-form" key={item?.id ?? 'new'} onSubmit={save}><h3>{item ? 'Sửa metadata' : 'Thêm metadata'}</h3><label>Mã tham chiếu (không phải URL)<input name="assetRef" defaultValue={item?.assetRef} required maxLength={500} /></label><label>Mô tả ảnh<input name="altText" defaultValue={item?.altText ?? ''} maxLength={200} /></label><label>Thứ tự hiển thị<input name="displayOrder" type="number" min={0} max={10000} defaultValue={item?.displayOrder ?? 0} required /></label><div className="amenity-buttons"><button className="primary" disabled={busy || loading}>{busy ? 'Đang lưu…' : 'Lưu metadata'}</button>{item && <button type="button" disabled={busy} onClick={() => setEditId('')}>Hủy sửa</button>}</div></form></>}
  </section>;
}
