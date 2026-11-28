'use client';

import { useEffect, useState } from 'react';
import { request } from '@/lib/api';
import { parseVnd } from '@/lib/booking-lifecycle';
import { minus, money } from '@/lib/cash-account';
import { zoneDay } from '@/lib/reception-calendar';
import { useCan } from './permissions-context';

type Totals = { depositsVnd: string; bookingCashVnd: string; cashReversalsVnd: string; refundsVnd: string; netCashVnd: string; surchargesVnd: string };
export type Report = { branchId: string; date: string; timezone: string; from: string; to: string; totals: Totals; byRecorder: (Totals & { userId: string; displayName: string })[] };
export type Unresolved = { holdId: string; roomId: string; channel: string; startAt: string; expiresAt: string; customerPhone: string | null; netDepositVnd: string };
export type UnresolvedPage = { items: Unresolved[]; hasMore: boolean };
const PAGE = 50;

/** PD-036: daily till report per branch/local day and expired-hold deposits awaiting an Owner/Branch Manager decision. */
export default function CashReconciliation({ token, tenant, branchId, timezone, rooms }: { token: string; tenant: string; branchId: string; timezone: string; rooms: { id: string; name: string }[] }) {
  const allowed = useCan();
  const [day, setDay] = useState('');
  useEffect(() => { setDay(zoneDay(Date.now(), timezone)); }, [timezone]); // browser-only: avoids a build-time "today"
  const [report, setReport] = useState<Report | null>(null); const [reportError, setReportError] = useState(''); const [reportRevision, setReportRevision] = useState(0);
  const [unresolved, setUnresolved] = useState<UnresolvedPage | null>(null); const [offset, setOffset] = useState(0); const [listError, setListError] = useState(''); const [listRevision, setListRevision] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, { refund: string; reason: string }>>({}); const [busy, setBusy] = useState(''); const [notice, setNotice] = useState(''); const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (!day) return;
    const controller = new AbortController(); setReportError('');
    request<Report>(`/merchant/branches/${encodeURIComponent(branchId)}/cash-report?date=${encodeURIComponent(day)}`, { signal: controller.signal }, token, tenant)
      .then(setReport).catch(err => { if (!controller.signal.aborted) { setReport(null); setReportError((err as Error).message); } });
    return () => controller.abort();
  }, [day, branchId, token, tenant, reportRevision]);

  useEffect(() => {
    const controller = new AbortController(); setListError('');
    request<UnresolvedPage>(`/merchant/branches/${encodeURIComponent(branchId)}/booking/unresolved-deposits?limit=${PAGE}&offset=${offset}`, { signal: controller.signal }, token, tenant)
      .then(setUnresolved).catch(err => { if (!controller.signal.aborted) { setUnresolved(null); setListError((err as Error).message); } });
    return () => controller.abort();
  }, [branchId, token, tenant, offset, listRevision]);

  async function resolve(item: Unresolved) {
    setActionError(''); setNotice('');
    const draft = drafts[item.holdId] ?? { refund: '', reason: '' };
    const refund = parseVnd(draft.refund || '0', { allowZero: true });
    if (refund === null) { setActionError('Số tiền hoàn phải là số nguyên VND, không âm.'); return; }
    if (refund > BigInt(item.netDepositVnd)) { setActionError(`Số tiền hoàn không được vượt cọc ròng ${money(item.netDepositVnd)}.`); return; }
    if (!draft.reason.trim()) { setActionError('Cần nhập lý do xử lý cọc.'); return; }
    const retained = BigInt(item.netDepositVnd) - refund;
    if (!window.confirm(`Ghi nhận đã hoàn ${money(refund.toString())}, giữ lại ${money(retained.toString())} cho cọc của hold này? Mỗi hold chỉ ghi một lần.`)) return;
    setBusy(item.holdId);
    try {
      const result = await request<{ refundAmountVnd: string; retainedVnd: string }>(`/merchant/booking/holds/${encodeURIComponent(item.holdId)}/deposit-resolution`, { method: 'POST', body: JSON.stringify({ refundAmountVnd: refund.toString(), reason: draft.reason.trim() }) }, token, tenant);
      setNotice(`Đã ghi nhận: hoàn ${money(result.refundAmountVnd)}, giữ lại ${money(result.retainedVnd)}.`);
      setDrafts(current => { const next = { ...current }; delete next[item.holdId]; return next; });
      setListRevision(value => value + 1); setReportRevision(value => value + 1);
    } catch (err) { setActionError((err as Error).message); } finally { setBusy(''); }
  }

  const roomName = (id: string) => rooms.find(room => room.id === id)?.name ?? 'Phòng khác';
  const when = (value: string) => new Date(value).toLocaleString('vi-VN', { timeZone: timezone });
  const t = report?.totals;
  return <>
    <section className="card" aria-labelledby="cash-report-title">
      <div className="section-head"><h2 id="cash-report-title">Báo cáo tiền mặt cuối ngày</h2><label className="calendar-day"><span className="visually-hidden">Ngày báo cáo</span><input aria-label="Ngày báo cáo" type="date" value={day} onChange={event => event.target.value && setDay(event.target.value)} /></label></div>
      <p>Theo ngày địa phương của chi nhánh ({timezone}). Dùng để đối chiếu két tiền; không có mở/đóng ca.</p>
      {reportError && <div className="error" role="alert">{reportError}</div>}
      {!report ? !reportError && <p role="status">Đang tải báo cáo…</p> : t && <>
        <div className="cash-totals">
          <div className="kpi highlight"><div className="kpi-head">Tiền mặt ròng trong két</div><strong>{money(t.netCashVnd)}</strong><small>cọc + thu − đảo − hoàn</small></div>
          <div className="kpi"><div className="kpi-head">Cọc đã thu</div><strong>{money(t.depositsVnd)}</strong></div>
          <div className="kpi"><div className="kpi-head">Thu tiền mặt booking</div><strong>{money(t.bookingCashVnd)}</strong></div>
          <div className="kpi"><div className="kpi-head">Đảo bút toán</div><strong>{minus(t.cashReversalsVnd)}</strong></div>
          <div className="kpi"><div className="kpi-head">Đã hoàn</div><strong>{minus(t.refundsVnd)}</strong></div>
          <div className="kpi"><div className="kpi-head">Phụ thu phát sinh</div><strong>{money(t.surchargesVnd)}</strong><small>khoản phải thu, không phải tiền trong két</small></div>
        </div>
        {report.byRecorder.length === 0 ? <div className="empty">Không có khoản tiền nào trong ngày.</div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Nhân viên ghi</th><th>Cọc</th><th>Thu booking</th><th>Đảo</th><th>Hoàn</th><th>Ròng</th><th>Phụ thu</th></tr></thead><tbody>{report.byRecorder.map(row => <tr key={row.userId}><td data-label="Nhân viên ghi"><strong>{row.displayName}</strong></td><td data-label="Cọc">{money(row.depositsVnd)}</td><td data-label="Thu booking">{money(row.bookingCashVnd)}</td><td data-label="Đảo">{minus(row.cashReversalsVnd)}</td><td data-label="Hoàn">{minus(row.refundsVnd)}</td><td data-label="Ròng"><strong>{money(row.netCashVnd)}</strong></td><td data-label="Phụ thu">{money(row.surchargesVnd)}</td></tr>)}</tbody></table></div>}
      </>}
    </section>
    <section className="card" aria-labelledby="unresolved-title">
      <div className="section-head"><h2 id="unresolved-title">Cọc chờ xử lý</h2><button type="button" className="secondary" onClick={() => setListRevision(value => value + 1)}>Tải lại</button></div>
      <p>Hold đã hết hạn nhưng còn tiền cọc. {allowed('deposit.resolve') ? 'Ghi số tiền đã hoàn cho khách (0 = giữ toàn bộ) và lý do; hệ thống không tự quyết định.' : 'Owner hoặc Quản lý chi nhánh ghi nhận hoàn/giữ cọc.'}</p>
      {listError && <div className="error" role="alert">{listError}</div>}{actionError && <div className="error" role="alert">{actionError}</div>}{notice && <div className="notice" role="status">{notice}</div>}
      {!unresolved ? !listError && <p role="status">Đang tải…</p> : unresolved.items.length === 0 ? <div className="empty">Không có cọc chờ xử lý.</div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Hold</th><th>Giờ hát</th><th>Hết hạn</th><th>Khách</th><th>Cọc ròng</th>{allowed('deposit.resolve') && <th>Xử lý</th>}</tr></thead><tbody>{unresolved.items.map(item => { const draft = drafts[item.holdId] ?? { refund: '', reason: '' }; const setDraft = (patch: Partial<typeof draft>) => setDrafts(current => ({ ...current, [item.holdId]: { ...draft, ...patch } })); return <tr key={item.holdId}>
        <td data-label="Hold"><strong>{roomName(item.roomId)}</strong><br /><small>{item.channel} · {item.holdId}</small></td><td data-label="Giờ hát">{when(item.startAt)}</td><td data-label="Hết hạn">{when(item.expiresAt)}</td><td data-label="Khách">{item.customerPhone ?? '—'}</td><td data-label="Cọc ròng"><strong>{money(item.netDepositVnd)}</strong></td>
        {allowed('deposit.resolve') && <td data-label="" className="status-action"><div className="resolve-form"><input aria-label={`Số tiền đã hoàn cho hold ${item.holdId}`} inputMode="numeric" placeholder="Đã hoàn (0 = giữ)" value={draft.refund} onChange={event => setDraft({ refund: event.target.value })} /><input aria-label={`Lý do xử lý cọc hold ${item.holdId}`} placeholder="Lý do (bắt buộc)" maxLength={500} value={draft.reason} onChange={event => setDraft({ reason: event.target.value })} /><button type="button" className="primary" disabled={busy === item.holdId} onClick={() => void resolve(item)}>Ghi nhận</button></div></td>}
      </tr>; })}</tbody></table></div>}
      {unresolved && (offset > 0 || unresolved.hasMore) && <div className="amenity-buttons"><button type="button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - PAGE))}>← Trang trước</button><span>Trang {Math.floor(offset / PAGE) + 1}</span><button type="button" disabled={!unresolved.hasMore} onClick={() => setOffset(value => value + PAGE)}>Trang sau →</button></div>}
    </section>
  </>;
}
