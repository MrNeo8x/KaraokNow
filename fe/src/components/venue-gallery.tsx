'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { ApiError, request } from '@/lib/api';
import type { components } from '@/lib/api-types.gen';
import { compressImage, formatBytes, imageTypeError, type CompressedImage } from '@/lib/image-compress';

type Photo = components['schemas']['VenuePhotoDto'];
export const MAX_VENUE_PHOTOS = 10;

/**
 * Merchant or branch photo gallery (FE-022, VEN-006, PD-048): at most 10 photos, compressed in the browser like room photos.
 * `basePath` is `/merchant/catalog/photos` (Owner manages) or `/merchant/branches/{id}/photos` (Owner/assigned Branch Manager).
 */
export default function VenueGallery({ token, tenant, basePath, title, description, subject, canManage }: { token: string; tenant: string; basePath: string; title: string; description: string; subject: string; canManage: boolean }) {
  const [items, setItems] = useState<Photo[]>([]); const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [prepared, setPrepared] = useState<(CompressedImage & { preview: string }) | null>(null); const [altText, setAltText] = useState(''); const [preparing, setPreparing] = useState(false);
  const [editing, setEditing] = useState<{ id: string; altText: string; displayOrder: string } | null>(null);
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    request<Photo[]>(basePath, { signal: controller.signal }, token, tenant)
      .then(value => setItems([...value].sort((a, b) => a.displayOrder - b.displayOrder)))
      .catch(err => { if (!controller.signal.aborted) { setItems([]); setError((err as Error).message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [basePath, token, tenant, revision]);
  useEffect(() => () => { if (prepared) URL.revokeObjectURL(prepared.preview); }, [prepared]);

  async function choose(file: File | undefined) {
    setError(''); setMessage(''); setPrepared(null);
    if (!file) return;
    const invalid = imageTypeError(file); if (invalid) { setError(invalid); return; }
    setPreparing(true);
    try { const result = await compressImage(file); setPrepared({ ...result, preview: URL.createObjectURL(result.file) }); if (!altText) setAltText(file.name.replace(/\.[^.]+$/, '').slice(0, 300)); }
    catch (err) { setError((err as Error).message || 'Không đọc được ảnh này.'); }
    finally { setPreparing(false); }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!prepared) return;
    setBusy('upload'); setError(''); setMessage('');
    const form = new FormData(); form.append('file', prepared.file); if (altText.trim()) form.append('altText', altText.trim().slice(0, 300));
    form.append('displayOrder', String(Math.min(1000, items.length ? Math.max(...items.map(item => item.displayOrder)) + 1 : 0)));
    try {
      await request(basePath, { method: 'POST', body: form }, token, tenant);
      setPrepared(null); setAltText(''); setMessage(`Đã tải ảnh lên (${formatBytes(prepared.file.size)}).`); setRevision(value => value + 1);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined;
      setError(status === 409 ? `Tối đa ${MAX_VENUE_PHOTOS} ảnh cho ${subject}. Xoá bớt ảnh cũ trước khi thêm.` : status === 403 ? `Bạn không có quyền quản lý ảnh của ${subject}.` : status === 503 ? 'Kho lưu ảnh chưa sẵn sàng trên môi trường này. Liên hệ quản trị hệ thống.' : (err as Error).message);
    } finally { setBusy(''); }
  }

  async function saveEdit(photo: Photo) {
    if (!editing) return; const order = Number(editing.displayOrder);
    if (!Number.isInteger(order) || order < 0 || order > 1000) { setError('Thứ tự hiển thị là số nguyên 0–1000.'); return; }
    setBusy(photo.id); setError(''); setMessage('');
    try { await request(`${basePath}/${encodeURIComponent(photo.id)}`, { method: 'PATCH', body: JSON.stringify({ altText: editing.altText.trim() || null, displayOrder: order }) }, token, tenant); setEditing(null); setMessage('Đã cập nhật ảnh.'); setRevision(value => value + 1); }
    catch (err) { setError((err as Error).message); } finally { setBusy(''); }
  }

  async function remove(photo: Photo) {
    if (!window.confirm('Xoá ảnh này? File ảnh cũng bị xoá khỏi kho lưu trữ.')) return;
    setBusy(photo.id); setError(''); setMessage('');
    try { await request(`${basePath}/${encodeURIComponent(photo.id)}`, { method: 'DELETE' }, token, tenant); setMessage('Đã xoá ảnh.'); setRevision(value => value + 1); }
    catch (err) { setError((err as Error).message); } finally { setBusy(''); }
  }

  const full = items.length >= MAX_VENUE_PHOTOS; const id = `gallery-${basePath.replace(/[^a-z0-9]+/gi, '-')}`;
  return <section className="card amenities venue-gallery" aria-labelledby={id}>
    <div className="section-head"><h2 id={id}>{title}</h2><span className="pill purple">{items.length}/{MAX_VENUE_PHOTOS} ảnh</span></div>
    <p>{description}</p>
    {error && <div className="error" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}
    {loading && items.length === 0 ? <p role="status">Đang tải ảnh…</p> : items.length === 0 ? <div className="empty">Chưa có ảnh.</div> : <div className="media-grid">{items.map(photo => <figure key={photo.id} className="media-item">
      {!broken[photo.id] ? <img src={photo.url} alt={photo.altText ?? `Ảnh ${subject}`} loading="lazy" onError={() => setBroken(current => ({ ...current, [photo.id]: true }))} /> : <div className="media-placeholder">Không tải được ảnh<br /><small>Thử tải lại trang sau</small></div>}
      <figcaption>{editing?.id === photo.id ? <div className="media-edit"><input aria-label="Mô tả ảnh" maxLength={300} value={editing.altText} onChange={event => setEditing({ ...editing, altText: event.target.value })} /><input aria-label="Thứ tự hiển thị" type="number" min={0} max={1000} value={editing.displayOrder} onChange={event => setEditing({ ...editing, displayOrder: event.target.value })} /><div className="hold-actions"><button type="button" className="primary" disabled={busy === photo.id} onClick={() => void saveEdit(photo)}>Lưu</button><button type="button" className="link-button" onClick={() => setEditing(null)}>Huỷ</button></div></div>
        : <><span>{photo.altText || 'Chưa có mô tả'}</span><small>Thứ tự {photo.displayOrder} · {formatBytes(photo.sizeBytes)}</small>{canManage && <div className="hold-actions"><button type="button" className="link-button" onClick={() => setEditing({ id: photo.id, altText: photo.altText ?? '', displayOrder: String(photo.displayOrder) })}>Sửa</button><button type="button" className="link-button danger" disabled={busy === photo.id} onClick={() => void remove(photo)} aria-label={`Xoá ảnh ${photo.altText ?? ''}`}><Trash2 size={14} aria-hidden /> Xoá</button></div>}</>}</figcaption>
    </figure>)}</div>}
    {canManage && (full ? <p className="notice">Đã đủ {MAX_VENUE_PHOTOS} ảnh cho {subject}. Xoá bớt để thêm ảnh mới.</p> : <form className="media-upload" onSubmit={upload}>
      <label className="file-drop"><ImagePlus size={22} aria-hidden /><span>{preparing ? 'Đang nén ảnh…' : 'Chọn ảnh JPEG, PNG hoặc WebP'}</span><input type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Chọn ảnh ${subject}`} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} disabled={preparing || busy === 'upload'} /></label>
      {prepared && <div className="media-preview"><img src={prepared.preview} alt="Xem trước ảnh đã nén" /><div><p>{prepared.width}×{prepared.height} px · {formatBytes(prepared.originalBytes)} → <strong>{formatBytes(prepared.file.size)}</strong></p><label>Mô tả ảnh<input maxLength={300} value={altText} onChange={event => setAltText(event.target.value)} /></label><div className="hold-actions"><button className="primary" disabled={busy === 'upload'}>{busy === 'upload' ? 'Đang tải lên…' : 'Tải ảnh lên'}</button><button type="button" className="link-button" onClick={() => setPrepared(null)}>Bỏ ảnh</button></div></div></div>}
    </form>)}
  </section>;
}
