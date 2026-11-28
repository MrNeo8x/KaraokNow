'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { reasonError } from '@/lib/admin';

export type ReasonRequest = { title: string; description: string; confirmLabel: string; danger?: boolean; run: (reason: string) => Promise<void> };

/** Native modal <dialog> (focus trap, Esc, screen-reader semantics) asking for the mandatory reason (PD-040). */
export default function ReasonDialog({ request, onClose }: { request: ReasonRequest | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const dialog = ref.current; if (!dialog) return;
    if (request && !dialog.open) { setReason(''); setError(''); dialog.showModal(); }
    if (!request && dialog.open) dialog.close();
  }, [request]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!request) return;
    const invalid = reasonError(reason); if (invalid) { setError(invalid); return; }
    setBusy(true); setError('');
    try { await request.run(reason.trim()); onClose(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return <dialog ref={ref} className="reason-dialog" aria-labelledby="reason-title" onClose={() => { if (request) onClose(); }}>
    {request && <form method="dialog" onSubmit={submit}>
      <h2 id="reason-title">{request.title}</h2>
      <p>{request.description}</p>
      <label>Lý do (bắt buộc, ghi vào nhật ký)<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={3} autoFocus /></label>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="hold-actions"><button className={request.danger ? 'primary danger-fill' : 'primary'} disabled={busy}>{busy ? 'Đang xử lý…' : request.confirmLabel}</button><button type="button" className="secondary" disabled={busy} onClick={onClose}>Huỷ</button></div>
    </form>}
  </dialog>;
}
