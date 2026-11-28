'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { request } from '@/lib/api';
import type { components } from '@/lib/api-types.gen';
import { compactVnd, defaultRange, percent, periodLabel } from '@/lib/chart-math';
import { downloadFile } from '@/lib/download';
import { ChartCard, ColumnChart, Heatmap, LineChart, RateBars, SERIES } from './charts';

type S = components['schemas'];
type Tab = 'bookings' | 'occupancy' | 'channels';
type GroupBy = 'day' | 'week' | 'month';
const channelLabel: Record<string, string> = { WEB: 'Khách tự đặt (web)', WALK_IN: 'Khách tại quầy', PHONE: 'Điện thoại' };
const money = (value: string | number) => `${BigInt(typeof value === 'number' ? Math.round(value) : value).toLocaleString('vi-VN')} ₫`;

/** RPT-001 / PD-044 merchant reports for Owner and Branch Manager (Receptionist/Cashier get 403 and use the cash report). */
export default function MerchantReports({ token, tenant, branches }: { token: string; tenant: string; branches: { id: string; name: string }[] }) {
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => { setRange(defaultRange(Date.now())); }, []); // browser-only "today"
  const [groupBy, setGroupBy] = useState<GroupBy>('day'); const [branchId, setBranchId] = useState(''); const [tab, setTab] = useState<Tab>('bookings');
  const [data, setData] = useState<{ bookings?: S['BookingReportDto']; occupancy?: S['OccupancyReportDto']; channels?: S['ChannelReportDto'] }>({});
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [downloading, setDownloading] = useState(false);

  const query = (format?: 'csv') => { if (!range) return ''; const params = new URLSearchParams({ from: range.from, to: range.to, groupBy }); if (branchId) params.set('branchId', branchId); if (format) params.set('format', format); return params.toString(); };
  useEffect(() => {
    if (!range) return;
    if (range.from > range.to) { setError('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.'); return; }
    const controller = new AbortController(); setLoading(true); setError('');
    request<S['BookingReportDto'] & S['OccupancyReportDto'] & S['ChannelReportDto']>(`/merchant/reports/${tab}?${query()}`, { signal: controller.signal }, token, tenant)
      .then(value => setData(current => ({ ...current, [tab]: value })))
      .catch(err => { if (!controller.signal.aborted) setError((err as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [tab, range?.from, range?.to, groupBy, branchId, token, tenant]); // eslint-disable-line react-hooks/exhaustive-deps

  async function csv() {
    if (!range) return; setDownloading(true); setError('');
    try { await downloadFile(`/merchant/reports/${tab}?${query('csv')}`, `bao-cao-${tab}-${range.from}_${range.to}.csv`, token, tenant); }
    catch (err) { setError((err as Error).message); } finally { setDownloading(false); }
  }

  const bookings = data.bookings; const occupancy = data.occupancy; const channels = data.channels;
  const labels = bookings?.rows.map(row => periodLabel(row.period, groupBy)) ?? [];
  return <section className="card" aria-labelledby="reports-title">
    <div className="section-head"><h2 id="reports-title">Báo cáo</h2><button type="button" className="secondary" disabled={downloading || !range} onClick={() => void csv()}><Download size={14} aria-hidden /> {downloading ? 'Đang tải…' : 'Tải CSV'}</button></div>
    <div className="report-filters">
      <label>Từ ngày<input type="date" value={range?.from ?? ''} onChange={event => event.target.value && setRange(current => current && { ...current, from: event.target.value })} /></label>
      <label>Đến ngày<input type="date" value={range?.to ?? ''} onChange={event => event.target.value && setRange(current => current && { ...current, to: event.target.value })} /></label>
      {tab === 'bookings' && <label>Gộp theo<select value={groupBy} onChange={event => setGroupBy(event.target.value as GroupBy)}><option value="day">Ngày</option><option value="week">Tuần</option><option value="month">Tháng</option></select></label>}
      <label>Chi nhánh<select value={branchId} onChange={event => setBranchId(event.target.value)}><option value="">Tất cả chi nhánh được giao</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
    </div>
    <div className="report-tabs" role="tablist">{([['bookings', 'Booking & doanh thu'], ['occupancy', 'Công suất phòng'], ['channels', 'Kênh & chuyển đổi']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {error && <div className="error" role="alert">{error}</div>}
    {loading && <p role="status">Đang tải báo cáo…</p>}

    {tab === 'bookings' && bookings && <>
      <div className="kpi-grid">
        <div className="kpi"><div className="kpi-head">Booking</div><strong>{bookings.totals.bookings}</strong><small>{bookings.totals.completed} hoàn tất · {bookings.totals.upcoming} sắp tới</small></div>
        <div className="kpi"><div className="kpi-head">Huỷ / không đến</div><strong>{bookings.totals.cancelled + bookings.totals.noShow}</strong><small>{bookings.totals.cancelled} huỷ · {bookings.totals.noShow} không đến</small></div>
        <div className="kpi"><div className="kpi-head">Doanh thu dự kiến</div><strong>{compactVnd(Number(bookings.totals.expectedRevenueVnd))}</strong><small>{money(bookings.totals.expectedRevenueVnd)}</small></div>
        <div className="kpi"><div className="kpi-head">Thực thu ròng</div><strong>{compactVnd(Number(bookings.totals.netCollectedVnd))}</strong><small>{money(bookings.totals.netCollectedVnd)}</small></div>
      </div>
      <p className="date-note">Số booking và doanh thu dự kiến tính theo <strong>ngày diễn ra</strong>; tiền thu, đảo, hoàn tính theo <strong>ngày ghi nhận</strong> (khớp báo cáo tiền mặt).</p>
      <div className="chart-grid">
        <ChartCard title="Số booking theo kỳ" subtitle="Theo ngày diễn ra" table={<table className="admin-table"><thead><tr><th>Kỳ</th><th>Booking</th><th>Hoàn tất</th><th>Huỷ</th><th>Không đến</th></tr></thead><tbody>{bookings.rows.map(row => <tr key={row.period}><td data-label="Kỳ">{periodLabel(row.period, groupBy)}</td><td data-label="Booking">{row.bookings}</td><td data-label="Hoàn tất">{row.completed}</td><td data-label="Huỷ">{row.cancelled}</td><td data-label="Không đến">{row.noShow}</td></tr>)}</tbody></table>}>
          <ColumnChart labels={labels} values={bookings.rows.map(row => row.bookings)} format={value => Math.round(value).toLocaleString('vi-VN')} unit="booking" integer />
        </ChartCard>
        <ChartCard title="Doanh thu dự kiến và thực thu" subtitle="VND" legend={[{ label: 'Dự kiến', color: SERIES.blue }, { label: 'Thực thu ròng', color: SERIES.orange }]} table={<table className="admin-table"><thead><tr><th>Kỳ</th><th>Dự kiến</th><th>Cọc</th><th>Tiền mặt</th><th>Đảo</th><th>Hoàn</th><th>Thực thu ròng</th></tr></thead><tbody>{bookings.rows.map(row => <tr key={row.period}><td data-label="Kỳ">{periodLabel(row.period, groupBy)}</td><td data-label="Dự kiến">{money(row.expectedRevenueVnd)}</td><td data-label="Cọc">{money(row.depositsVnd)}</td><td data-label="Tiền mặt">{money(row.bookingCashVnd)}</td><td data-label="Đảo">{money(row.reversalsVnd)}</td><td data-label="Hoàn">{money(row.refundsVnd)}</td><td data-label="Thực thu ròng">{money(row.netCollectedVnd)}</td></tr>)}</tbody></table>}>
          <LineChart labels={labels} format={compactVnd} series={[{ name: 'Dự kiến', color: SERIES.blue, values: bookings.rows.map(row => Number(row.expectedRevenueVnd)) }, { name: 'Thực thu', color: SERIES.orange, values: bookings.rows.map(row => Number(row.netCollectedVnd)) }]} />
        </ChartCard>
      </div>
    </>}

    {tab === 'occupancy' && occupancy && <>
      <div className="kpi-grid">
        <div className="kpi highlight-kpi"><div className="kpi-head">Công suất phòng</div><strong>{percent(occupancy.occupancyRate)}</strong><small>{Math.round(occupancy.bookedMinutes / 60).toLocaleString('vi-VN')} / {Math.round(occupancy.availableMinutes / 60).toLocaleString('vi-VN')} giờ có thể đặt</small></div>
      </div>
      <div className="chart-grid">
        <ChartCard title="Công suất theo phòng" table={<table className="admin-table"><thead><tr><th>Phòng</th><th>Chi nhánh</th><th>Giờ đã đặt</th><th>Giờ có thể đặt</th><th>Công suất</th></tr></thead><tbody>{occupancy.rooms.map(room => <tr key={room.roomId}><td data-label="Phòng">{room.roomName}</td><td data-label="Chi nhánh">{room.branchName}</td><td data-label="Giờ đã đặt">{Math.round(room.bookedMinutes / 60)}</td><td data-label="Giờ có thể đặt">{Math.round(room.availableMinutes / 60)}</td><td data-label="Công suất">{percent(room.occupancyRate)}</td></tr>)}</tbody></table>}>
          {occupancy.rooms.length === 0 ? <div className="empty">Không có phòng.</div> : <RateBars items={[...occupancy.rooms].sort((a, b) => b.occupancyRate - a.occupancyRate).map(room => ({ key: room.roomId, label: room.roomName, rate: room.occupancyRate, detail: `${room.branchName} · ${Math.round(room.bookedMinutes / 60)}/${Math.round(room.availableMinutes / 60)} giờ` }))} />}
        </ChartCard>
        <ChartCard title="Giờ cao điểm" subtitle="Số booking theo thứ và giờ bắt đầu" table={<table className="admin-table"><thead><tr><th>Thứ</th><th>Giờ</th><th>Booking</th></tr></thead><tbody>{occupancy.peakHours.filter(cell => cell.bookings > 0).map(cell => <tr key={`${cell.weekday}-${cell.hour}`}><td data-label="Thứ">{['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'][cell.weekday - 1]}</td><td data-label="Giờ">{String(cell.hour).padStart(2, '0')}:00</td><td data-label="Booking">{cell.bookings}</td></tr>)}</tbody></table>}>
          <Heatmap cells={occupancy.peakHours} />
        </ChartCard>
      </div>
    </>}

    {tab === 'channels' && channels && <div className="chart-grid">
      <ChartCard title="Tỷ lệ chuyển đổi theo kênh" subtitle="Giữ chỗ → booking đã xác nhận" table={<table className="admin-table"><thead><tr><th>Kênh</th><th>Giữ chỗ</th><th>Đã xác nhận</th><th>Hết hạn</th><th>Chuyển đổi</th></tr></thead><tbody>{channels.rows.map(row => <tr key={row.channel}><td data-label="Kênh">{channelLabel[row.channel] ?? row.channel}</td><td data-label="Giữ chỗ">{row.holds}</td><td data-label="Đã xác nhận">{row.confirmed}</td><td data-label="Hết hạn">{row.expired}</td><td data-label="Chuyển đổi">{percent(row.conversionRate)}</td></tr>)}</tbody></table>}>
        {channels.rows.length === 0 ? <div className="empty">Chưa có giữ chỗ trong khoảng này.</div> : <RateBars items={channels.rows.map(row => ({ key: row.channel, label: channelLabel[row.channel] ?? row.channel, rate: row.conversionRate, detail: `${row.confirmed}/${row.holds} giữ chỗ được xác nhận · ${row.expired} hết hạn` }))} />}
      </ChartCard>
      <div className="kpi-grid">
        <div className="kpi"><div className="kpi-head">Giữ chỗ</div><strong>{channels.totals.holds}</strong></div>
        <div className="kpi"><div className="kpi-head">Đã xác nhận</div><strong>{channels.totals.confirmed}</strong><small>chuyển đổi {percent(channels.totals.conversionRate)}</small></div>
        <div className="kpi"><div className="kpi-head">Hết hạn</div><strong>{channels.totals.expired}</strong></div>
      </div>
    </div>}
  </section>;
}
