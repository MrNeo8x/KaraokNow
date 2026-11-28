'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { request } from '@/lib/api';
import type { components } from '@/lib/api-types.gen';
import { compactVnd, defaultRange, percent, periodLabel } from '@/lib/chart-math';
import { downloadFile } from '@/lib/download';
import { ChartCard, ColumnChart, LineChart, SERIES } from './charts';

type S = components['schemas'];
type GroupBy = 'day' | 'week' | 'month';
type SortKey = 'bookings' | 'holds' | 'conversionRate' | 'netCollectedVnd';
const money = (value: string) => `${BigInt(value).toLocaleString('vi-VN')} ₫`;
const TOP = 20;
const count = (value: number) => Math.round(value).toLocaleString('vi-VN');

/** RPT-001 / PD-044 platform-wide reports (Platform Admin, no X-Tenant-ID). Money is per merchant only, never summed across merchants. */
export default function PlatformReports({ token }: { token: string }) {
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => { setRange(defaultRange(Date.now())); }, []);
  const [groupBy, setGroupBy] = useState<GroupBy>('day'); const [sort, setSort] = useState<SortKey>('bookings'); const [showAll, setShowAll] = useState(false);
  const [overview, setOverview] = useState<S['PlatformOverviewDto'] | null>(null); const [merchants, setMerchants] = useState<S['PlatformMerchantReportDto'] | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [downloading, setDownloading] = useState('');

  const query = (format?: 'csv') => { if (!range) return ''; const params = new URLSearchParams({ from: range.from, to: range.to, groupBy }); if (format) params.set('format', format); return params.toString(); };
  useEffect(() => {
    if (!range) return;
    if (range.from > range.to) { setError('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.'); return; }
    const controller = new AbortController(); setLoading(true); setError('');
    Promise.all([
      request<S['PlatformOverviewDto']>(`/platform/reports/overview?${query()}`, { signal: controller.signal }, token),
      request<S['PlatformMerchantReportDto']>(`/platform/reports/merchants?${query()}`, { signal: controller.signal }, token),
    ]).then(([nextOverview, nextMerchants]) => { setOverview(nextOverview); setMerchants(nextMerchants); })
      .catch(err => { if (!controller.signal.aborted) setError((err as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range?.from, range?.to, groupBy, token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function csv(kind: 'overview' | 'merchants') {
    if (!range) return; setDownloading(kind); setError('');
    try { await downloadFile(`/platform/reports/${kind}?${query('csv')}`, `nen-tang-${kind}-${range.from}_${range.to}.csv`, token); }
    catch (err) { setError((err as Error).message); } finally { setDownloading(''); }
  }

  const labels = overview?.rows.map(row => periodLabel(row.period, groupBy)) ?? [];
  const rows = [...(merchants?.rows ?? [])].sort((a, b) => (sort === 'netCollectedVnd' ? (BigInt(b.netCollectedVnd) > BigInt(a.netCollectedVnd) ? 1 : BigInt(b.netCollectedVnd) < BigInt(a.netCollectedVnd) ? -1 : 0) : b[sort] - a[sort]) || b.holds - a.holds || a.tenantName.localeCompare(b.tenantName, 'vi'));
  const snapshot = overview?.snapshot;
  return <section className="card" aria-labelledby="platform-reports-title">
    <div className="section-head"><h2 id="platform-reports-title">Báo cáo nền tảng</h2></div>
    <div className="report-filters">
      <label>Từ ngày<input type="date" value={range?.from ?? ''} onChange={event => event.target.value && setRange(current => current && { ...current, from: event.target.value })} /></label>
      <label>Đến ngày<input type="date" value={range?.to ?? ''} onChange={event => event.target.value && setRange(current => current && { ...current, to: event.target.value })} /></label>
      <label>Gộp theo<select value={groupBy} onChange={event => setGroupBy(event.target.value as GroupBy)}><option value="day">Ngày</option><option value="week">Tuần</option><option value="month">Tháng</option></select></label>
    </div>
    {error && <div className="error" role="alert">{error}</div>}
    {loading && <p role="status">Đang tải báo cáo…</p>}
    {snapshot && <div className="kpi-grid">
      <div className="kpi"><div className="kpi-head">Merchant hoạt động</div><strong>{snapshot.merchantsActive}</strong><small>{snapshot.merchantsSuspended} đang bị khoá</small></div>
      <div className="kpi"><div className="kpi-head">Listing đang hiển thị</div><strong>{snapshot.listingsLive}</strong><small>{snapshot.listingsPendingApproval} chờ duyệt</small></div>
      <div className="kpi"><div className="kpi-head">Merchant có booking</div><strong>{snapshot.merchantsWithBookings}</strong><small>trong khoảng đã chọn</small></div>
      <div className="kpi"><div className="kpi-head">Người dùng hoạt động</div><strong>{snapshot.activeUsers}</strong></div>
    </div>}
    {overview && <>
      <div className="section-head"><h3>Tăng trưởng và giao dịch</h3><button type="button" className="secondary" disabled={downloading === 'overview'} onClick={() => void csv('overview')}><Download size={14} aria-hidden /> Tải CSV tổng quan</button></div>
      <div className="chart-grid">
        <ChartCard title="Giữ chỗ và booking xác nhận" subtitle="Toàn nền tảng" legend={[{ label: 'Giữ chỗ', color: SERIES.blue }, { label: 'Booking xác nhận', color: SERIES.orange }]} table={<table className="admin-table"><thead><tr><th>Kỳ</th><th>Giữ chỗ</th><th>Booking xác nhận</th></tr></thead><tbody>{overview.rows.map(row => <tr key={row.period}><td data-label="Kỳ">{periodLabel(row.period, groupBy)}</td><td data-label="Giữ chỗ">{row.holds}</td><td data-label="Booking xác nhận">{row.bookingsConfirmed}</td></tr>)}</tbody></table>}>
          <LineChart integer labels={labels} format={count} series={[{ name: 'Giữ chỗ', color: SERIES.blue, values: overview.rows.map(row => row.holds) }, { name: 'Xác nhận', color: SERIES.orange, values: overview.rows.map(row => row.bookingsConfirmed) }]} />
        </ChartCard>
        <ChartCard title="Merchant mới" subtitle={`Tổng ${overview.totals.newMerchants} merchant · ${overview.totals.newBranches} chi nhánh · ${overview.totals.newUsers} người dùng mới`} table={<table className="admin-table"><thead><tr><th>Kỳ</th><th>Merchant mới</th><th>Chi nhánh mới</th><th>Người dùng mới</th></tr></thead><tbody>{overview.rows.map(row => <tr key={row.period}><td data-label="Kỳ">{periodLabel(row.period, groupBy)}</td><td data-label="Merchant mới">{row.newMerchants}</td><td data-label="Chi nhánh mới">{row.newBranches}</td><td data-label="Người dùng mới">{row.newUsers}</td></tr>)}</tbody></table>}>
          <ColumnChart labels={labels} values={overview.rows.map(row => row.newMerchants)} format={count} unit="merchant mới" integer />
        </ChartCard>
      </div>
    </>}
    {merchants && <>
      <div className="section-head"><h3>Theo merchant</h3><div className="report-filters"><label>Sắp xếp<select value={sort} onChange={event => setSort(event.target.value as SortKey)}><option value="bookings">Nhiều booking nhất</option><option value="holds">Nhiều giữ chỗ nhất</option><option value="conversionRate">Chuyển đổi cao nhất</option><option value="netCollectedVnd">Thực thu cao nhất</option></select></label><button type="button" className="secondary" disabled={downloading === 'merchants'} onClick={() => void csv('merchants')}><Download size={14} aria-hidden /> Tải CSV merchant</button></div></div>
      {rows.length === 0 ? <div className="empty">Chưa có merchant.</div> : <div className="table-wrap"><table className="admin-table merchant-report-table"><thead><tr><th>Merchant</th><th>Chi nhánh / phòng</th><th>Giữ chỗ</th><th>Booking</th><th>Huỷ / không đến</th><th>Chuyển đổi</th><th>Dự kiến</th><th>Thực thu ròng</th></tr></thead><tbody>
        {rows.slice(0, showAll ? rows.length : TOP).map(row => <tr key={row.tenantId}><td data-label="Merchant"><strong>{row.tenantName}</strong> {row.tenantStatus === 'INACTIVE' ? <span className="pill rose">Đang bị khoá</span> : row.listingLive ? <span className="pill green">Đang hiển thị</span> : <span className="pill gray">Chưa hiển thị</span>}</td><td data-label="Chi nhánh / phòng">{row.branches} / {row.rooms}</td><td data-label="Giữ chỗ">{row.holds}</td><td data-label="Booking">{row.bookings} <small>({row.completed} hoàn tất)</small></td><td data-label="Huỷ / không đến">{row.cancelled} / {row.noShow}</td><td data-label="Chuyển đổi">{percent(row.conversionRate)}</td><td data-label="Dự kiến" title={money(row.expectedRevenueVnd)}>{compactVnd(Number(row.expectedRevenueVnd))}</td><td data-label="Thực thu ròng" title={money(row.netCollectedVnd)}>{compactVnd(Number(row.netCollectedVnd))}</td></tr>)}
      </tbody></table>{rows.length > TOP && <button type="button" className="link-button" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? `Chỉ hiện ${TOP} merchant đầu` : `Xem tất cả ${rows.length} merchant`}</button>}</div>}
    </>}
  </section>;
}
