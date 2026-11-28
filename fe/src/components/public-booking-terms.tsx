'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, request } from '@/lib/api';
import { useReadOnly } from './permissions-context';

type Terms = { configured: boolean; terms: string | null; version: string | null; updatedAt?: string | null };

export default function PublicBookingTerms({ token, tenant }: { token: string; tenant: string }) {
  const readOnly = useReadOnly();
  const [current, setCurrent] = useState<Terms | null>(null); const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    request<Terms>('/merchant/catalog/public-booking-terms', { signal: controller.signal }, token, tenant)
      .then(value => { setCurrent(value); setDraft(value.terms ?? ''); })
      .catch(err => { if (controller.signal.aborted) return; if (err instanceof ApiError && err.status === 403) setHidden(true); else setError((err as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, tenant]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    try {
      const value = await request<Terms>('/merchant/catalog/public-booking-terms', { method: 'PATCH', body: JSON.stringify({ terms: draft.trim() }) }, token, tenant);
      setCurrent(value); setDraft(value.terms ?? ''); setMessage(`Đã công bố phiên bản điều khoản ${value.version}.`);
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  }

  // Owner-only. Other roles receive 403 and the section is hidden.
  if (hidden) return null;
  return <section className="card amenities" aria-labelledby="public-terms-title">
    <h2 id="public-terms-title">Điều khoản đặt phòng công khai</h2>
    <p>Owner cấu hình nội dung khách phải đọc và đồng ý. Mỗi lần lưu tạo version mới; booking công khai sau này sẽ gửi đúng version khách đã xem.</p>
    {error && <div className="error" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}
    {loading ? <p aria-live="polite">Đang tải điều khoản…</p> : <form className="action-form" onSubmit={save}><label>Nội dung điều khoản<textarea value={draft} onChange={event => setDraft(event.target.value)} readOnly={readOnly} rows={7} minLength={1} maxLength={5000} required /></label><small>{draft.length}/5000 ký tự · Version hiện tại: {current?.version ?? 'chưa cấu hình'}{current?.updatedAt ? ` · cập nhật ${new Date(current.updatedAt).toLocaleString('vi-VN')}` : ''}</small>{!readOnly && <button className="primary" disabled={saving || !draft.trim()}>{saving ? 'Đang lưu…' : 'Lưu và tạo version mới'}</button>}</form>}
  </section>;
}
