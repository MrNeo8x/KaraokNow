'use client';
import React, { useEffect, useRef, useState } from 'react';
import VenueActions from './venue-actions';
import RoomAmenities from './room-amenities';
import AvailabilityQuote from './availability-quote';
import PricingSettings from './pricing-settings';
import HoldLookup from './hold-lookup';
import BranchHolds from './branch-holds';
import HoldTtlSettings from './hold-ttl-settings';
import RoomBlocks from './room-blocks';
import RoomMedia from './room-media';
import NoDepositSettings from './no-deposit-settings';
import DepositSettings from './deposit-settings';
import CustomerBooking from './customer-booking';
import PublicBookingTerms from './public-booking-terms';
import PlatformListings from './platform-listings';
import PlatformMerchants from './platform-merchants';
import CatalogPublication from './catalog-publication';
import Memberships from './memberships';
import AuditLog from './audit-log';
import OpsBacklog from './ops-backlog';
import OvertimeSettings from './overtime-settings';
import ReceptionCalendar from './reception-calendar';
import MySessions from './my-sessions';
import { ApiError, request } from '@/lib/api';
import AdminShell, { useSection, type NavItem } from './admin-shell';
import { RolesProvider } from './permissions-context';
import { can } from '@/lib/permissions';
import { roleLabel, type Role } from '@/lib/admin';
import { BadgeCheck, Building2, CalendarDays, CheckCircle2, ClipboardList, DoorOpen, LayoutDashboard, LogOut, Mic2, Settings, ShieldCheck, Store, Tags, UserCog, Users, Wrench } from 'lucide-react';
import { parseSession, refreshDelay, type Session } from '@/lib/session';

type Branch = { id: string; name: string; code: string; timezone: string; status: string };
type Room = { id: string; name: string; code: string; capacity: number; status: string };
export default function App({ initialPage = 'merchant' }: { initialPage?: 'merchant' | 'customer' | 'platform' }) {
  const page = initialPage;
  type Me = { displayName: string; email: string; tenantName: string; tenantStatus: 'ACTIVE' | 'INACTIVE'; roles: Role[]; branchIds: string[]; platformAdmin: boolean };
  const [me, setMe] = useState<Me | null>(null);
  const [merchantSection, selectMerchant] = useSection(MERCHANT_IDS, 'overview');
  const [platformSection, selectPlatform] = useSection(PLATFORM_IDS, 'listings');
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [tenant, setTenant] = useState(''); const [activeTenant, setActiveTenant] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]); const [branch, setBranch] = useState(''); const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [revision, setRevision] = useState(0);
  const sessionGeneration = useRef(0);
  const refreshFlight = useRef<Promise<Session | null> | null>(null);
  async function login(e: React.FormEvent) { e.preventDefault(); setError(''); setLoading(true); try { setSession(parseSession(await request<unknown>('/auth/login', { method:'POST', body: JSON.stringify({email,password}) }))); setPassword(''); } catch (err) { setError((err as Error).message); } finally { setLoading(false); } }
  async function logout() { sessionGeneration.current++; const pending = refreshFlight.current; const previous = session; setSession(null); setActiveTenant(''); setBranches([]); setRooms([]); const latest = pending ? await pending : previous; if (latest) { try { await request('/auth/logout', {method:'POST',body:JSON.stringify({refreshToken:latest.refreshToken})}); } catch { setError('Đã đăng xuất tại trình duyệt; không thể xác nhận thu hồi phiên trên máy chủ.'); } } }
  useEffect(() => {
    if (!session || session.mustChangePassword) return;
    const generation = sessionGeneration.current;
    const delay = refreshDelay(session.expiresIn);
    const timer = window.setTimeout(() => {
      if (refreshFlight.current || generation !== sessionGeneration.current) return;
      const flight = request<unknown>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: session.refreshToken }) })
        .then(value => { const next = parseSession(value); if (generation === sessionGeneration.current) setSession(next); return next; })
        .catch(() => { if (generation === sessionGeneration.current) { sessionGeneration.current++; setSession(null); setActiveTenant(''); setBranches([]); setRooms([]); setError('Không thể làm mới phiên. Vui lòng đăng nhập lại.'); } return null; })
        .finally(() => { if (refreshFlight.current === flight) refreshFlight.current = null; });
      refreshFlight.current = flight;
    }, delay);
    return () => window.clearTimeout(timer);
  }, [session]);
  async function changePassword(e: React.FormEvent) { e.preventDefault(); if (!session) return; setError(''); try { await request('/auth/password/change',{method:'POST',body:JSON.stringify({currentPassword:password,newPassword})},session.accessToken); setSession(null); setPassword(''); setNewPassword(''); setError('Đổi mật khẩu thành công. Vui lòng đăng nhập lại.'); } catch(err) { setError((err as Error).message); } }
  useEffect(() => { if (!session || !activeTenant || session.mustChangePassword) return; let live=true; setLoading(true); setError(''); request<Branch[]>('/merchant/branches',{},session.accessToken,activeTenant).then(data=>{ if(live){setBranches(data);setBranch(previous=>data.some(item=>item.id===previous)?previous:data[0]?.id || '');} }).catch(err=>{if(live){setError(err.message);setBranches([]);setBranch('');}}).finally(()=>{if(live)setLoading(false);}); return()=>{live=false;}; },[session,activeTenant,revision]);
  useEffect(() => { if(!session || !activeTenant || !branch) {setRooms([]);return;} let live=true; setLoading(true); request<Room[]>(`/merchant/branches/${branch}/rooms`,{},session.accessToken,activeTenant).then(data=>{if(live)setRooms(data);}).catch(err=>{if(live){setRooms([]);setError(err.message);}}).finally(()=>{if(live)setLoading(false);}); return()=>{live=false;}; },[session,activeTenant,branch,revision]);
  // Roles drive what the UI offers; the backend still enforces every permission. Unknown roles (null) hide nothing.
  useEffect(() => {
    if (!session || !activeTenant || session.mustChangePassword || page !== 'merchant') { setMe(null); return; }
    const controller = new AbortController();
    request<Me>('/merchant/me', { signal: controller.signal }, session.accessToken, activeTenant)
      .then(setMe).catch(err => { if (!controller.signal.aborted) { setMe(null); if (err instanceof ApiError && err.status === 403) setError('Tài khoản không có quyền trong merchant này. Kiểm tra lại Tenant ID.'); } });
    return () => controller.abort();
  }, [session, activeTenant, page]);

  if (page === 'customer') return <CustomerBooking />;

  if (!session || session.mustChangePassword) return <div className="auth">
    <section className="auth-hero"><a className="admin-logo" href="/"><span className="logo-mark"><Mic2 size={20} aria-hidden /></span><span><strong>KaraokeNow</strong><small>{page === 'platform' ? 'Platform' : 'Business'}</small></span></a>
      <div><h1>{page === 'platform' ? 'Quản trị nền tảng KaraokeNow' : 'Quản lý phòng, lịch đặt và đội ngũ trong một nơi'}</h1><p>Đặt phòng karaoke nhanh qua web, Zalo và Messenger — quản lý thống nhất cho chủ quán.</p></div>
      <ul>{(page === 'platform' ? ['Duyệt merchant lên Marketplace', 'Tạo merchant và Owner đầu tiên', 'Mọi quyết định được ghi audit'] : ['Quản lý phòng & lịch đặt', 'Cọc, check-in/out và thu tiền mặt', 'Quản lý người dùng & phân quyền', 'Hiển thị trên Marketplace']).map(item => <li key={item}><CheckCircle2 size={18} aria-hidden />{item}</li>)}</ul>
    </section>
    <section className="auth-panel"><div className="card auth-card">
      {!session ? <><div className="eyebrow">{page === 'platform' ? 'DÀNH CHO PLATFORM ADMIN' : 'DÀNH CHO ĐỐI TÁC'}</div><h2>Chào mừng trở lại</h2><p>{page === 'platform' ? 'Đăng nhập để duyệt listing merchant.' : 'Đăng nhập để quản lý chi nhánh và phòng của bạn.'}</p>
        <form onSubmit={login}><label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" /></label><label>Mật khẩu<input type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>{error && <div role="alert" className="error">{error}</div>}<button className="primary" disabled={loading}>{loading ? 'Đang đăng nhập…' : 'Đăng nhập'}</button></form></>
      : <><div className="eyebrow">BẢO MẬT TÀI KHOẢN</div><h2>Đổi mật khẩu</h2><p>Bạn cần đổi mật khẩu tạm trước khi tiếp tục.</p>
        <form onSubmit={changePassword}><label>Mật khẩu hiện tại<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></label><label>Mật khẩu mới<input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={12} required autoComplete="new-password" /></label>{error && <div role="alert" className="error">{error}</div>}<button className="primary">Đổi mật khẩu</button></form></>}
      <div className="auth-links"><a href="/booking">Trải nghiệm khách</a>{page === 'platform' ? <a href="/merchant">Dành cho chủ quán</a> : <a href="/platform">Platform Admin</a>}</div>
    </div></section>
  </div>;

  const sessionsCard = <MySessions token={session.accessToken} onCurrentRevoked={() => void logout()} />;

  if (page === 'platform') {
    const nav: NavItem[] = [{ id: 'listings', label: 'Duyệt listing', icon: BadgeCheck }, { id: 'merchants', label: 'Merchant', icon: Store }, { id: 'account', label: 'Tài khoản', icon: UserCog }];
    const titles: Record<string, string> = { listings: 'Duyệt listing', merchants: 'Merchant', account: 'Tài khoản' };
    return <AdminShell product="Platform" nav={nav} active={platformSection} onSelect={selectPlatform} title={titles[platformSection]} subtitle="Quản trị toàn hệ thống · không gắn với merchant nào"
      footer={<><strong>Platform Admin</strong><a href="/booking"><Mic2 size={14} aria-hidden />Trải nghiệm khách</a><button type="button" onClick={() => void logout()}><LogOut size={14} aria-hidden />Đăng xuất</button></>}>
      {error && <div role="alert" className="error">{error}</div>}
      {platformSection === 'listings' && <PlatformListings token={session.accessToken} />}
      {platformSection === 'merchants' && <PlatformMerchants token={session.accessToken} />}
      {platformSection === 'account' && sessionsCard}
    </AdminShell>;
  }

  const roles = me?.roles ?? null; const isOwner = roles === null ? null : can(roles, 'owner.admin');
  const currentBranch = branches.find(item => item.id === branch);
  const nav: NavItem[] = [
    { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
    { id: 'bookings', label: 'Lịch & Đặt phòng', icon: CalendarDays },
    { id: 'rooms', label: 'Phòng hát', icon: DoorOpen },
    { id: 'pricing', label: 'Giá & chính sách', icon: Tags },
    ...(isOwner === false ? [] : [{ id: 'users', label: 'Người dùng', icon: Users }, { id: 'marketplace', label: 'Marketplace', icon: Store }]),
    { id: 'settings', label: 'Cài đặt hệ thống', icon: Settings },
  ];
  const titles: Record<string, string> = { overview: 'Tổng quan', bookings: 'Lịch & Đặt phòng', rooms: 'Phòng hát', pricing: 'Giá & chính sách', users: 'Người dùng & phân quyền', marketplace: 'Marketplace', settings: 'Cài đặt hệ thống' };
  const section = nav.some(item => item.id === merchantSection) ? merchantSection : 'overview';
  const tenantForm = <form onSubmit={e => { e.preventDefault(); setBranch(''); setBranches([]); setRooms([]); setActiveTenant(tenant.trim()); setRevision(value => value + 1); }} className="tenant-form"><input aria-label="Tenant ID" placeholder="Tenant ID" value={tenant} onChange={e => setTenant(e.target.value)} required /><button className="primary">Áp dụng</button></form>;
  const counts = { active: rooms.filter(r => r.status === 'ACTIVE').length, maintenance: rooms.filter(r => r.status === 'MAINTENANCE').length, inactive: rooms.filter(r => r.status !== 'ACTIVE' && r.status !== 'MAINTENANCE').length };
  const pct = (value: number) => rooms.length ? `${(value / rooms.length) * 100}%` : '0%';
  const roomStatus = (status: string) => status === 'ACTIVE' ? <span className="pill green">Hoạt động</span> : status === 'MAINTENANCE' ? <span className="pill amber">Bảo trì</span> : <span className="pill gray">Ngừng hoạt động</span>;
  const branchKey = `${activeTenant}:${branch}`;

  return <AdminShell product="Business" nav={activeTenant ? nav : []} active={section} onSelect={selectMerchant}
    title={activeTenant ? titles[section] : 'Chọn merchant'} subtitle={activeTenant ? (currentBranch ? `${currentBranch.name} · ${currentBranch.timezone}` : 'Chưa chọn chi nhánh') : 'Nhập Tenant ID được cấp để mở dữ liệu'}
    actions={activeTenant && branches.length > 0 ? <label className="sr-label"><span className="visually-hidden">Chi nhánh</span><select aria-label="Chi nhánh" value={branch} onChange={e => { setRooms([]); setBranch(e.target.value); }}>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label> : undefined}
    footer={<><Building2 size={18} aria-hidden color="#c4b5fd" /><strong>{me?.tenantName ?? currentBranch?.name ?? 'Chưa chọn chi nhánh'}</strong>{me && <small>{me.displayName} · {me.roles.map(role => roleLabel[role] ?? role).join(', ')}</small>}{activeTenant && <small>Tenant {activeTenant}</small>}{activeTenant && <button type="button" onClick={() => { setActiveTenant(''); setBranches([]); setBranch(''); setRooms([]); }}><Store size={14} aria-hidden />Đổi merchant</button>}<a href="/booking"><Mic2 size={14} aria-hidden />Trải nghiệm khách</a><button type="button" onClick={() => void logout()}><LogOut size={14} aria-hidden />Đăng xuất</button></>}>
    {error && <div role="alert" className="error">{error}</div>}
    {me?.tenantStatus === 'INACTIVE' && <div role="alert" className="error suspended-banner"><strong>Merchant đang bị Platform khoá.</strong> Khách không thấy chi nhánh và không giữ chỗ mới được; giữ chỗ và booking hiện có vẫn xử lý bình thường.</div>}
    <RolesProvider value={roles}>
    {!activeTenant ? <section className="card tenant-card"><div className="kpi-head"><span className="kpi-icon"><Store size={18} aria-hidden /></span>Chọn Merchant</div><p>Nhập mã Tenant ID được cấp để mở dữ liệu chi nhánh, phòng và lịch đặt.</p>{tenantForm}</section> : <>
      {section === 'overview' && <>
        <div className="kpi-grid">
          <div className="kpi"><div className="kpi-head"><span className="kpi-icon"><Building2 size={18} aria-hidden /></span>Chi nhánh</div><strong>{branches.length}</strong><small>được cấp quyền</small></div>
          <div className="kpi"><div className="kpi-head"><span className="kpi-icon"><DoorOpen size={18} aria-hidden /></span>Phòng hát</div><strong>{rooms.length}</strong><small>tại chi nhánh đang chọn</small></div>
          <div className="kpi"><div className="kpi-head"><span className="kpi-icon green"><CheckCircle2 size={18} aria-hidden /></span>Đang hoạt động</div><strong>{counts.active}</strong><small>sẵn sàng nhận khách</small></div>
          <div className="kpi"><div className="kpi-head"><span className="kpi-icon amber"><Wrench size={18} aria-hidden /></span>Bảo trì</div><strong>{counts.maintenance}</strong><small>{counts.inactive} phòng ngừng hoạt động</small></div>
        </div>
        <div className="panel-grid">
          <section className="card" aria-labelledby="room-status-title"><div className="section-head"><h2 id="room-status-title">Tình trạng phòng ({rooms.length} phòng)</h2></div>
            <div className="status-bar" aria-hidden><span style={{ width: pct(counts.active), background: '#22c55e' }} /><span style={{ width: pct(counts.maintenance), background: '#f59e0b' }} /><span style={{ width: pct(counts.inactive), background: '#cbd5e1' }} /></div>
            <ul className="legend"><li><span><i style={{ background: '#22c55e' }} />Hoạt động</span><strong>{counts.active}</strong></li><li><span><i style={{ background: '#f59e0b' }} />Bảo trì</span><strong>{counts.maintenance}</strong></li><li><span><i style={{ background: '#cbd5e1' }} />Ngừng hoạt động</span><strong>{counts.inactive}</strong></li></ul>
            <div className="hold-actions"><button type="button" className="secondary" onClick={() => selectMerchant('bookings')}><ClipboardList size={14} aria-hidden /> Xem lịch & đặt phòng</button></div>
          </section>
          {isOwner !== false && <div style={{ display: 'grid', gap: 20 }}><CatalogPublication key={`publication:${activeTenant}`} token={session.accessToken} tenant={activeTenant} /><OpsBacklog key={`ops:${activeTenant}`} token={session.accessToken} tenant={activeTenant} /></div>}
        </div>
      </>}
      {section === 'bookings' && <>
        {currentBranch && <ReceptionCalendar key={`calendar:${branchKey}`} token={session.accessToken} tenant={activeTenant} branchId={branch} timezone={currentBranch.timezone} rooms={rooms} />}
        {currentBranch ? <AvailabilityQuote key={`availability-quote:${branchKey}`} token={session.accessToken} tenant={activeTenant} branchId={branch} timezone={currentBranch.timezone} /> : <div className="card empty">Chọn chi nhánh để xem phòng trống.</div>}
        <HoldLookup key={`hold-lookup:${activeTenant}`} token={session.accessToken} tenant={activeTenant} />
        {currentBranch && <BranchHolds key={`branch-holds:${branchKey}`} token={session.accessToken} tenant={activeTenant} branchId={branch} timezone={currentBranch.timezone} rooms={rooms} />}
      </>}
      {section === 'rooms' && <>
        <section className="card" aria-labelledby="room-table-title"><div className="section-head"><h2 id="room-table-title">Quản lý phòng</h2><span className="pill purple">{rooms.length} phòng</span></div>
          {loading ? <p role="status">Đang tải dữ liệu…</p> : branches.length === 0 ? <div className="empty">Chưa có chi nhánh được cấp quyền.</div> : rooms.length === 0 ? <div className="empty">Chi nhánh này chưa có phòng.</div>
            : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Tên phòng</th><th>Mã</th><th>Sức chứa</th><th>Trạng thái</th></tr></thead><tbody>{rooms.map(r => <tr key={r.id}><td data-label="Tên phòng"><strong>{r.name}</strong></td><td data-label="Mã">{r.code}</td><td data-label="Sức chứa">Tối đa {r.capacity} khách</td><td data-label="Trạng thái">{roomStatus(r.status)}</td></tr>)}</tbody></table></div>}
        </section>
        <VenueActions key={`venue-actions:${branchKey}`} token={session.accessToken} tenant={activeTenant} branchId={branch} branch={currentBranch} rooms={rooms} onChanged={() => setRevision(value => value + 1)} />
        <RoomAmenities key={`room-amenities:${branchKey}`} token={session.accessToken} tenant={activeTenant} rooms={rooms} />
        <RoomMedia key={`room-media:${branchKey}`} token={session.accessToken} tenant={activeTenant} rooms={rooms} />
        {currentBranch && <RoomBlocks key={`room-blocks:${branchKey}`} token={session.accessToken} tenant={activeTenant} branchId={branch} timezone={currentBranch.timezone} rooms={rooms} />}
      </>}
      {section === 'pricing' && <>
        <PricingSettings key={`pricing-settings:${activeTenant}`} token={session.accessToken} tenant={activeTenant} branches={branches} currentBranch={branch} />
        <HoldTtlSettings key={`hold-ttl-settings:${activeTenant}`} token={session.accessToken} tenant={activeTenant} />
        <OvertimeSettings key={`overtime:${activeTenant}`} token={session.accessToken} tenant={activeTenant} />
        <DepositSettings key={`deposit-settings:${activeTenant}`} token={session.accessToken} tenant={activeTenant} />
        <NoDepositSettings key={`no-deposit-settings:${activeTenant}`} token={session.accessToken} tenant={activeTenant} />
      </>}
      {section === 'users' && isOwner !== false && <Memberships key={`members:${activeTenant}`} token={session.accessToken} tenant={activeTenant} branches={branches} />}
      {section === 'marketplace' && <>
        <CatalogPublication key={`publication:${activeTenant}`} token={session.accessToken} tenant={activeTenant} />
        <PublicBookingTerms key={`terms:${activeTenant}`} token={session.accessToken} tenant={activeTenant} />
      </>}
      {section === 'settings' && <>
        <section className="card tenant-card"><div className="kpi-head"><span className="kpi-icon"><ShieldCheck size={18} aria-hidden /></span>Merchant đang mở</div><p>Tenant {activeTenant}. Đổi sang merchant khác bằng Tenant ID.</p>{tenantForm}</section>
        {sessionsCard}
        {isOwner !== false && <OpsBacklog key={`ops-settings:${activeTenant}`} token={session.accessToken} tenant={activeTenant} />}
        {isOwner !== false && <AuditLog key={`audit:${activeTenant}`} token={session.accessToken} tenant={activeTenant} />}
      </>}
    </>}
    </RolesProvider>
  </AdminShell>;
}

const MERCHANT_IDS = ['overview', 'bookings', 'rooms', 'pricing', 'users', 'marketplace', 'settings'];
const PLATFORM_IDS = ['listings', 'merchants', 'account'];
