'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, request } from '@/lib/api';
import { parseVnd } from '@/lib/booking-lifecycle';
import { balanceText, entrySign, kindLabel, money, reversalTargetLabel, reversalTypeOf, settlementLabel, settlementTone, type LedgerEntry, type Settlement } from '@/lib/cash-account';
import { useCan } from './permissions-context';

type Account = { bookingId: string; bookingStatus: string; priceTotalVnd: string; surchargesVnd: string; dueVnd: string; depositsVnd: string; cashVnd: string; refundsVnd: string; paidVnd: string; balanceVnd: string; settlement: Settlement; retainedVnd: string | null; entries: LedgerEntry[] };
const CLOSED = new Set(['CANCELLED', 'NO_SHOW']);

/** Money account of one booking (PD-036): due vs paid, ledger, surcharges, CASH and full reversals. */
export default function BookingAccount({ bookingId, bookingStatus, token, tenant, timezone }: { bookingId: string; bookingStatus: string; token: string; tenant: string; timezone: string }) {
  const allowed = useCan();
  const [account, setAccount] = useState<Account | null>(null); const [revision, setRevision] = useState(0);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState('');
  const [showLedger, setShowLedger] = useState(false);
  const [cash, setCash] = useState({ amount: '', note: '', key: '' }); const [surcharge, setSurcharge] = useState({ amount: '', reason: '', key: '' });
  const [reversal, setReversal] = useState<{ entryId: string; reason: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    request<Account>(`/merchant/booking/bookings/${encodeURIComponent(bookingId)}/account`, { signal: controller.signal }, token, tenant)
      .then(setAccount).catch(err => { if (!controller.signal.aborted) setError((err as Error).message); });
    return () => controller.abort();
  }, [bookingId, token, tenant, revision, bookingStatus]);

  const date = (value: string) => new Date(value).toLocaleString('vi-VN', { timeZone: timezone });
  const fail = (err: unknown, fallback409?: string) => { const status = err instanceof ApiError ? err.status : undefined; setError(status === 409 && fallback409 ? `${(err as Error).message} · ${fallback409}` : status === undefined || status >= 500 ? `${(err as Error).message} · Chưa rõ kết quả: gửi lại với cùng nội dung, hệ thống không ghi trùng.` : (err as Error).message); };

  async function recordCash(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    const amount = parseVnd(cash.amount); if (amount === null) { setError('Khoản thu phải là số nguyên VND dương.'); return; }
    const key = cash.key || crypto.randomUUID(); setCash(current => ({ ...current, key }));
    setBusy('cash');
    try {
      await request(`/merchant/booking/bookings/${encodeURIComponent(bookingId)}/manual-payments`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ method: 'CASH', amountVnd: amount.toString(), ...(cash.note.trim() ? { note: cash.note.trim() } : {}) }) }, token, tenant);
      setCash({ amount: '', note: '', key: '' }); setNotice(`Đã ghi nhận thu tiền mặt ${money(amount.toString())}.`); setRevision(value => value + 1);
    } catch (err) { fail(err); } finally { setBusy(''); }
  }

  async function addSurcharge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    const amount = parseVnd(surcharge.amount); if (amount === null) { setError('Phụ thu phải là số nguyên VND dương.'); return; }
    if (!surcharge.reason.trim()) { setError('Cần nhập lý do phụ thu (đồ uống, dịch vụ…).'); return; }
    const key = surcharge.key || crypto.randomUUID(); setSurcharge(current => ({ ...current, key }));
    setBusy('surcharge');
    try {
      await request(`/merchant/booking/bookings/${encodeURIComponent(bookingId)}/surcharges`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ amountVnd: amount.toString(), reason: surcharge.reason.trim() }) }, token, tenant);
      setSurcharge({ amount: '', reason: '', key: '' }); setNotice(`Đã thêm phụ thu ${money(amount.toString())}.`); setRevision(value => value + 1);
    } catch (err) { fail(err, 'Không thêm phụ thu cho booking đã hủy/không đến.'); } finally { setBusy(''); }
  }

  async function reverse(entry: LedgerEntry) {
    const entryType = reversalTypeOf(entry); if (!entryType || !reversal) return;
    if (!reversal.reason.trim()) { setError('Cần nhập lý do đảo bút toán.'); return; }
    if (!window.confirm(`Đảo toàn bộ ${reversalTargetLabel[entryType]} ${money(entry.amountVnd)}? Khoản gốc giữ nguyên trong sổ nhưng không còn được tính; mỗi khoản chỉ đảo một lần.`)) return;
    setError(''); setNotice(''); setBusy(entry.id);
    try {
      await request('/merchant/booking/money-reversals', { method: 'POST', body: JSON.stringify({ entryType, entryId: entry.id, reason: reversal.reason.trim() }) }, token, tenant);
      setReversal(null); setNotice(`Đã đảo ${reversalTargetLabel[entryType]} ${money(entry.amountVnd)}.`); setRevision(value => value + 1);
    } catch (err) { fail(err, 'Khoản này có thể đã được đảo với lý do khác.'); } finally { setBusy(''); }
  }

  if (!account) return <div className="booking-account">{error ? <div className="error" role="alert">{error}</div> : <p role="status">Đang tải tài khoản tiền…</p>}</div>;
  const closed = CLOSED.has(account.bookingStatus);
  return <div className="booking-account">
    <div className="account-summary">
      <div><small>Phải thu</small><strong>{money(account.dueVnd)}</strong>{account.surchargesVnd !== '0' && <small>gồm phụ thu {money(account.surchargesVnd)}</small>}</div>
      <div><small>Đã thu</small><strong>{money(account.paidVnd)}</strong><small>cọc {money(account.depositsVnd)} · tiền mặt {money(account.cashVnd)}{account.refundsVnd !== '0' ? ` · hoàn ${money(account.refundsVnd)}` : ''}</small></div>
      <div><small>{closed ? 'Giữ lại' : 'Số dư'}</small><strong>{closed ? money(account.retainedVnd ?? '0') : balanceText(account.balanceVnd)}</strong><span className={`pill ${settlementTone[account.settlement]}`}>{settlementLabel[account.settlement]}</span></div>
    </div>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
    <button type="button" className="link-button" aria-expanded={showLedger} onClick={() => setShowLedger(value => !value)}>{showLedger ? 'Ẩn sổ tiền' : `Xem sổ tiền (${account.entries.length} khoản)`}</button>
    {showLedger && (account.entries.length === 0 ? <p>Chưa có khoản nào.</p> : <ul className="ledger">{account.entries.map(entry => { const type = reversalTypeOf(entry); return <li key={`${entry.kind}:${entry.id}`} className={entry.reversed ? 'reversed' : ''}>
      <div className="ledger-line"><span><strong>{kindLabel[entry.kind]}</strong>{entry.reversed ? ' · đã đảo' : ''}{entry.kind === 'REVERSAL' && entry.reversesType ? ` (${reversalTargetLabel[entry.reversesType]})` : ''}<br /><small>{date(entry.recordedAt)}{entry.note ? ` · ${entry.note}` : ''}</small></span><b>{entrySign(entry.kind)}{money(entry.amountVnd)}</b></div>
      {type && allowed('money.reverse') && (reversal?.entryId === entry.id
        ? <div className="ledger-reverse"><input aria-label={`Lý do đảo ${kindLabel[entry.kind]}`} placeholder="Lý do đảo (bắt buộc)" maxLength={500} value={reversal.reason} onChange={event => setReversal({ entryId: entry.id, reason: event.target.value })} /><button type="button" className="secondary danger" disabled={busy === entry.id} onClick={() => void reverse(entry)}>Xác nhận đảo</button><button type="button" className="link-button" onClick={() => setReversal(null)}>Huỷ</button></div>
        : <button type="button" className="link-button danger" onClick={() => setReversal({ entryId: entry.id, reason: '' })}>Đảo khoản này</button>)}
    </li>; })}</ul>)}
    {!closed && allowed('surcharge.record') && <form className="payment-form" onSubmit={addSurcharge}><label>Phụ thu (VND)<input inputMode="numeric" value={surcharge.amount} onChange={event => setSurcharge({ amount: event.target.value, reason: surcharge.reason, key: '' })} required /></label><label>Lý do phụ thu<input maxLength={500} value={surcharge.reason} onChange={event => setSurcharge({ amount: surcharge.amount, reason: event.target.value, key: '' })} placeholder="Đồ uống, dịch vụ…" required /></label><button className="secondary" disabled={busy === 'surcharge'}>Thêm phụ thu</button></form>}
    {allowed('cash.access') && <form className="payment-form" onSubmit={recordCash}><label>Khoản thu tiền mặt (VND)<input inputMode="numeric" value={cash.amount} onChange={event => setCash({ amount: event.target.value, note: cash.note, key: '' })} required /></label><label>Ghi chú<input maxLength={500} value={cash.note} onChange={event => setCash({ amount: cash.amount, note: event.target.value, key: '' })} /></label><button className="primary" disabled={busy === 'cash'}>Ghi nhận tiền mặt</button></form>}
  </div>;
}
