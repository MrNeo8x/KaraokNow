'use client';

import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { ApiError, request } from '@/lib/api';
import { MAPS_LINK_HELP } from '@/lib/branch-location';

type Resolved = { latitude: number; longitude: number; mapsUrl: string; directionsUrl: string };
export type BranchLocation = { address?: string | null; phone?: string | null; mapsUrl?: string | null; latitude?: number | null; longitude?: number | null; directionsUrl?: string | null };

/**
 * Address, public phone and Google Maps link inputs (named, read through FormData by the branch forms) with a
 * preview that resolves the link through the BE so the Owner can check the pin before saving (PD-042, no API key).
 */
export default function BranchLocationFields({ token, tenant, initial }: { token: string; tenant: string; initial?: BranchLocation }) {
  const [link, setLink] = useState(initial?.mapsUrl ?? '');
  const [preview, setPreview] = useState<Resolved | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);

  async function resolve() {
    setError(''); setPreview(null);
    if (!link.trim()) { setError('Dán link Google Maps hoặc toạ độ trước khi xem trước.'); return; }
    setBusy(true);
    try { setPreview(await request<Resolved>('/merchant/branch-location/resolve', { method: 'POST', body: JSON.stringify({ mapsLink: link.trim() }) }, token, tenant)); }
    catch (err) { setError(err instanceof ApiError && err.status === 422 ? MAPS_LINK_HELP : (err as Error).message); }
    finally { setBusy(false); }
  }

  return <fieldset className="location-fields">
    <legend>Địa chỉ và vị trí (hiện cho khách)</legend>
    <label>Địa chỉ<input name="address" defaultValue={initial?.address ?? ''} maxLength={300} placeholder="Số 1 Hàng Bài, Hoàn Kiếm, Hà Nội" /></label>
    <label>Số điện thoại liên hệ<input name="phone" type="tel" inputMode="tel" defaultValue={initial?.phone ?? ''} maxLength={20} placeholder="0989 015 619" /></label>
    <label>Link Google Maps hoặc toạ độ<input name="mapsLink" value={link} onChange={event => { setLink(event.target.value); setPreview(null); setError(''); }} maxLength={2000} placeholder="https://maps.app.goo.gl/… hoặc 21.0285, 105.8542" /></label>
    <div className="hold-actions"><button type="button" className="secondary" disabled={busy} onClick={() => void resolve()}><MapPin size={14} aria-hidden /> {busy ? 'Đang đọc vị trí…' : 'Xem trước vị trí'}</button>{initial?.directionsUrl && !preview && <a className="link-button" href={initial.directionsUrl} target="_blank" rel="noopener noreferrer">Vị trí đang lưu ↗</a>}</div>
    {error && <div className="error" role="alert">{error}</div>}
    {preview && <div className="notice" role="status">Toạ độ {preview.latitude.toFixed(6)}, {preview.longitude.toFixed(6)} · <a href={preview.directionsUrl} target="_blank" rel="noopener noreferrer">Mở trên Google Maps để kiểm tra ↗</a></div>}
    <small>Không cần API key: hệ thống đọc toạ độ từ link. Để trống một ô khi sửa sẽ xoá thông tin đó.</small>
  </fieldset>;
}
