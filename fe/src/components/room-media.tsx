'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { ApiError, request } from '@/lib/api';
import { compressImage, formatBytes, imageTypeError, type CompressedImage } from '@/lib/image-compress';
import { useCan } from './permissions-context';

export type Media = { id: string; roomId: string; assetRef: string; altText: string | null; displayOrder: number; url: string | null; contentType: string | null; sizeBytes: number | null };
const MAX_PER_ROOM = 10;

/** Room photo gallery (FILE-001, PD-037): images are compressed in the browser before upload. */
export default function RoomMedia({ token, tenant, rooms }: { token: string; tenant: string; rooms: { id: string; name: string }[] }) {
  const canManage = useCan()('venue.manage');
  const [roomId, setRoomId] = useState(''); const [items, setItems] = useState<Media[]>([]); const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [prepared, setPrepared] = useState<(CompressedImage & { preview: string }) | null>(null); const [altText, setAltText] = useState(''); const [preparing, setPreparing] = useState(false);
  const [editing, setEditing] = useState<{ id: string; altText: string; displayOrder: string } | null>(null);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const selected = rooms.some(room => room.id === roomId) ? roomId : rooms[0]?.id ?? '';

  useEffect(() => {
    if (!selected) { setItems([]); return; }
    const controller = new AbortController(); setLoading(true); setError('');
    request<Media[]>(`/merchant/rooms/${encodeURIComponent(selected)}/media`, { signal: controller.signal }, token, tenant)
      .then(value => setItems([...value].sort((a, b) => a.displayOrder - b.displayOrder)))
      .catch(err => { if (!controller.signal.aborted) { setItems([]); setError((err as Error).message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selected, token, tenant, revision]);

  useEffect(() => () => { if (prepared) URL.revokeObjectURL(prepared.preview); }, [prepared]);

  async function choose(file: File | undefined) {
    setError(''); setMessage(''); setPrepared(null);
    if (!file) return;
    const invalid = imageTypeError(file); if (invalid) { setError(invalid); return; }
    setPreparing(true);
    try { const result = await compressImage(file); setPrepared({ ...result, preview: URL.createObjectURL(result.file) }); if (!altText) setAltText(file.name.replace(/\.[^.]+$/, '')); }
    catch (err) { setError((err as Error).message || 'Không đọc được ảnh này.'); }
    finally { setPreparing(false); }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!prepared || !selected) return;
    setBusy('upload'); setError(''); setMessage('');
    const form = new FormData(); form.append('file', prepared.file); if (altText.trim()) form.append('altText', altText.trim().slice(0, 200));
    form.append('displayOrder', String(items.length ? Math.max(...items.map(item => item.displayOrder)) + 1 : 0));
    try {
      await request(`/merchant/rooms/${encodeURIComponent(selected)}/media/upload`, { method: 'POST', body: form }, token, tenant);
      setPrepared(null); setAltText(''); setMessage(`Đã tải ảnh lên (${formatBytes(prepared.file.size)}).`); setRevision(value => value + 1);
    } catch (err) { const status = err instanceof ApiError ? err.status : undefined; setError(status === 409 ? `Mỗi phòng tối đa ${MAX_PER_ROOM} ảnh. Xoá bớt ảnh cũ trước khi thêm.` : status === 503 ? 'Kho lưu ảnh chưa sẵn sàng trên môi trường này. Liên hệ quản trị hệ thống.' : (err as Error).message); }
    finally { setBusy(''); }
  }

  async function saveEdit(media: Media) {
    if (!editing) return; const order = Number(editing.displayOrder);
    if (!Number.isInteger(order) || order < 0 || order > 10000) { setError('Thứ tự hiển thị là số nguyên 0–10000.'); return; }
    setBusy(media.id); setError(''); setMessage('');
    try { await request(`/merchant/rooms/${encodeURIComponent(selected)}/media/${encodeURIComponent(media.id)}`, { method: 'PATCH', body: JSON.stringify({ altText: editing.altText.trim() || null, displayOrder: order }) }, token, tenant); setEditing(null); setMessage('Đã cập nhật ảnh.'); setRevision(value => value + 1); }
    catch (err) { setError((err as Error).message); } finally { setBusy(''); }
  }

  async function remove(media: Media) {
    if (!window.confirm(media.url ? 'Xoá ảnh này? File ảnh cũng bị xoá khỏi kho lưu trữ.' : 'Xoá mục metadata này?')) return;
    setBusy(media.id); setError(''); setMessage('');
    try { await request(`/merchant/rooms/${encodeURIComponent(selected)}/media/${encodeURIComponent(media.id)}`, { method: 'DELETE' }, token, tenant); setMessage('Đã xoá.'); setRevision(value => value + 1); }
    catch (err) { setError((err as Error).message); } finally { setBusy(''); }
  }

  const full = items.length >= MAX_PER_ROOM;
  return <section className="card amenities" aria-labelledby="media-title">
    <div className="section-head"><h2 id="media-title">Ảnh phòng</h2>{selected && <span className="pill purple">{items.length}/{MAX_PER_ROOM} ảnh</span>}</div>
    <p>Ảnh được nén trên trình duyệt (cạnh dài tối đa 1600 px, khoảng 300–500 KB) và xoá thông tin vị trí trước khi tải lên.</p>
    <label>Phòng<select value={selected} disabled={!rooms.length} onChange={event => { setRoomId(event.target.value); setPrepared(null); setEditing(null); setError(''); setMessage(''); }}>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
    {error && <div className="error" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}
    {selected && (loading ? <p role="status">Đang tải ảnh…</p> : items.length === 0 ? <div className="empty">Phòng này chưa có ảnh.</div> : <div className="media-grid">{items.map(media => <figure key={media.id} className="media-item">
      {media.url && !broken[media.id] ? <img src={media.url} alt={media.altText ?? 'Ảnh phòng'} loading="lazy" onError={() => setBroken(current => ({ ...current, [media.id]: true }))} /> : <div className="media-placeholder">{media.url ? <>Không tải được ảnh<br /><small>Thử tải lại trang sau</small></> : <>Chỉ có metadata<br /><small>{media.assetRef}</small></>}</div>}
      <figcaption>{editing?.id === media.id ? <div className="media-edit"><input aria-label="Mô tả ảnh" maxLength={200} value={editing.altText} onChange={event => setEditing({ ...editing, altText: event.target.value })} /><input aria-label="Thứ tự hiển thị" type="number" min={0} max={10000} value={editing.displayOrder} onChange={event => setEditing({ ...editing, displayOrder: event.target.value })} /><div className="hold-actions"><button type="button" className="primary" disabled={busy === media.id} onClick={() => void saveEdit(media)}>Lưu</button><button type="button" className="link-button" onClick={() => setEditing(null)}>Huỷ</button></div></div>
        : <><span>{media.altText || 'Chưa có mô tả'}</span><small>Thứ tự {media.displayOrder}{media.sizeBytes ? ` · ${formatBytes(media.sizeBytes)}` : ''}</small>{canManage && <div className="hold-actions"><button type="button" className="link-button" onClick={() => setEditing({ id: media.id, altText: media.altText ?? '', displayOrder: String(media.displayOrder) })}>Sửa</button><button type="button" className="link-button danger" disabled={busy === media.id} onClick={() => void remove(media)} aria-label={`Xoá ảnh ${media.altText ?? ''}`}><Trash2 size={14} aria-hidden /> Xoá</button></div>}</>}</figcaption>
    </figure>)}</div>)}
    {selected && canManage && (full ? <p className="notice">Đã đủ {MAX_PER_ROOM} ảnh cho phòng này.</p> : <form className="media-upload" onSubmit={upload}>
      <label className="file-drop"><ImagePlus size={22} aria-hidden /><span>{preparing ? 'Đang nén ảnh…' : 'Chọn ảnh JPEG, PNG hoặc WebP'}</span><input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Chọn ảnh phòng" onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} disabled={preparing || busy === 'upload'} /></label>
      {prepared && <div className="media-preview"><img src={prepared.preview} alt="Xem trước ảnh đã nén" /><div><p>{prepared.width}×{prepared.height} px · {formatBytes(prepared.originalBytes)} → <strong>{formatBytes(prepared.file.size)}</strong></p><label>Mô tả ảnh<input maxLength={200} value={altText} onChange={event => setAltText(event.target.value)} /></label><div className="hold-actions"><button className="primary" disabled={busy === 'upload'}>{busy === 'upload' ? 'Đang tải lên…' : 'Tải ảnh lên'}</button><button type="button" className="link-button" onClick={() => setPrepared(null)}>Bỏ ảnh</button></div></div></div>}
    </form>)}
  </section>;
}
