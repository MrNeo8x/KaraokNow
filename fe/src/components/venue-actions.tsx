'use client';
import { useState, type FormEvent } from 'react';
import { ApiError, request } from '@/lib/api';
import { MAPS_LINK_HELP, hoursPayload, patchText } from '@/lib/branch-location';
import BranchHoursFields from './branch-hours-fields';
import BranchLocationFields, { type BranchLocation } from './branch-location-fields';

type Room = { id: string; name: string; capacity: number; status: string };
type Branch = { id: string; name: string; timezone: string; status: string; openingTime?: string | null; closingTime?: string | null } & BranchLocation;
type Props = { token: string; tenant: string; branchId: string; branch?: Branch; rooms: Room[]; onChanged: () => void };

export default function VenueActions({ token, tenant, branchId, branch, rooms, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const selectedRoom = rooms.find(room => room.id === selectedRoomId);

  async function submit(event: FormEvent<HTMLFormElement>, path: string, build: (data: FormData) => object, success: string, method = 'POST') {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setMessage(''); setError('');
    try {
      await request(path, { method, body: JSON.stringify(build(new FormData(form))) }, token, tenant);
      form.reset(); setMessage(success); onChanged();
    } catch (err) { setError(err instanceof ApiError && err.status === 422 && new FormData(form).has('mapsLink') ? `${(err as Error).message} · ${MAPS_LINK_HELP}` : (err as Error).message); }
    finally { setBusy(false); }
  }

  const text = (data: FormData, key: string) => String(data.get(key) ?? '').trim();
  /** Opening hours (PD-043); a validation message is thrown so submit() shows it. */
  const hours = (data: FormData, current?: Branch) => {
    const result = hoursPayload({ allDay: data.get('allDay') === 'on', openingTime: text(data, 'openingTime'), closingTime: text(data, 'closingTime') }, current ? { openingTime: current.openingTime, closingTime: current.closingTime } : undefined);
    if (result && 'error' in result) throw new Error(result.error);
    return result ?? {};
  };
  /** Create: send optional location fields only when filled. */
  const createLocation = (data: FormData) => Object.fromEntries((['address', 'phone', 'mapsLink'] as const).flatMap(key => text(data, key) ? [[key, text(data, key)]] : []));
  /** Edit: omit unchanged fields, send null for cleared ones (PD-042 PATCH semantics). */
  const patchLocation = (data: FormData, current: Branch) => Object.fromEntries(([['address', current.address], ['phone', current.phone], ['mapsLink', current.mapsUrl]] as const).flatMap(([key, previous]) => { const value = patchText(text(data, key), previous); return value === undefined ? [] : [[key, value]]; }));

  return <section className="venue-actions" aria-label="Quản lý chi nhánh và phòng">
    {error && <div role="alert" className="error">{error}</div>}
    {message && <div role="status" className="notice">{message}</div>}
    <details className="card"><summary>＋ Tạo chi nhánh</summary><p>Chỉ chủ Merchant có quyền tạo chi nhánh.</p><form className="action-form" onSubmit={e => submit(e, '/merchant/branches', d => ({ code: String(d.get('code')).trim(), name: String(d.get('name')).trim(), timezone: String(d.get('timezone')).trim(), ...createLocation(d), ...hours(d) }), 'Đã tạo chi nhánh.')}><label>Mã chi nhánh<input name="code" required maxLength={50} /></label><label>Tên chi nhánh<input name="name" required maxLength={200} /></label><label>Múi giờ<input name="timezone" required maxLength={64} defaultValue="Asia/Ho_Chi_Minh" /></label><BranchLocationFields token={token} tenant={tenant} /><BranchHoursFields /><button className="primary" disabled={busy}>Tạo chi nhánh</button></form></details>
    {branch && <details className="card" key={`branch-${branch.id}`}><summary>Chỉnh sửa chi nhánh</summary><p>Thông tin của chi nhánh đang chọn.</p><form className="action-form" key={`${branch.id}-${branch.name}-${branch.timezone}-${branch.address ?? ''}-${branch.phone ?? ''}-${branch.mapsUrl ?? ''}-${branch.openingTime ?? ''}-${branch.closingTime ?? ''}`} onSubmit={e => submit(e, `/merchant/branches/${encodeURIComponent(branch.id)}`, d => ({ name: String(d.get('name')).trim(), timezone: String(d.get('timezone')).trim(), ...patchLocation(d, branch), ...hours(d, branch) }), 'Đã cập nhật chi nhánh.', 'PATCH')}><label>Tên chi nhánh<input name="name" defaultValue={branch.name} required maxLength={200} /></label><label>Múi giờ<input name="timezone" defaultValue={branch.timezone} required maxLength={64} /></label><BranchLocationFields token={token} tenant={tenant} initial={branch} /><BranchHoursFields initial={branch} /><button className="primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu chi nhánh'}</button></form></details>}
    {branch && <details className="card"><summary>Trạng thái chi nhánh</summary><p>Chi nhánh đang chọn: {branch.name} · {branch.status === 'ACTIVE' ? 'Hoạt động' : 'Ngừng hoạt động'}.</p><form className="action-form" key={`${branch.id}-${branch.status}`} onSubmit={e => { const status = String(new FormData(e.currentTarget).get('status')); if (status === 'INACTIVE' && !window.confirm(`Ngừng hoạt động chi nhánh “${branch.name}”? Chi nhánh sẽ không xuất hiện trong kết quả tìm phòng trống.`)) { e.preventDefault(); return; } void submit(e, `/merchant/branches/${encodeURIComponent(branch.id)}/status`, () => ({ status }), 'Đã cập nhật trạng thái chi nhánh.', 'PATCH'); }}><label>Trạng thái<select name="status" defaultValue={branch.status}><option value="ACTIVE">Hoạt động</option><option value="INACTIVE">Ngừng hoạt động</option></select></label><button className="primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu trạng thái'}</button></form></details>}
    {branchId && <details className="card"><summary>＋ Tạo phòng</summary><p>Phòng được tạo tại chi nhánh đang chọn.</p><form className="action-form" onSubmit={e => submit(e, '/merchant/rooms', d => ({ branchId, code: String(d.get('code')).trim(), name: String(d.get('name')).trim(), capacity: Number(d.get('capacity')) }), 'Đã tạo phòng.')}><label>Mã phòng<input name="code" required maxLength={50} /></label><label>Tên phòng<input name="name" required maxLength={200} /></label><label>Sức chứa<input name="capacity" type="number" min={1} max={1000} required /></label><button className="primary" disabled={busy}>Tạo phòng</button></form></details>}
    {branchId && rooms.length > 0 && <details className="card"><summary>Chỉnh sửa phòng</summary><p>Chọn phòng trong chi nhánh để cập nhật tên và sức chứa.</p><label>Phòng<select value={selectedRoom?.id ?? ''} onChange={e => setSelectedRoomId(e.target.value)}><option value="">Chọn phòng</option>{rooms.map(room => <option value={room.id} key={room.id}>{room.name}</option>)}</select></label>{selectedRoom && <form className="action-form" key={`${selectedRoom.id}-${selectedRoom.name}-${selectedRoom.capacity}`} onSubmit={e => submit(e, `/merchant/rooms/${encodeURIComponent(selectedRoom.id)}`, d => ({ name: String(d.get('name')).trim(), capacity: Number(d.get('capacity')) }), 'Đã cập nhật phòng.', 'PATCH')}><label>Tên phòng<input name="name" defaultValue={selectedRoom.name} required maxLength={200} /></label><label>Sức chứa<input name="capacity" type="number" defaultValue={selectedRoom.capacity} min={1} max={1000} required /></label><button className="primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu phòng'}</button></form>}</details>}
    {branchId && rooms.length > 0 && <details className="card"><summary>Thay đổi trạng thái phòng</summary><p>Thao tác này cập nhật trạng thái vận hành của phòng.</p><form className="action-form" onSubmit={e => { const id = String(new FormData(e.currentTarget).get('roomId')); void submit(e, `/merchant/rooms/${encodeURIComponent(id)}/status`, d => ({ status: d.get('status') }), 'Đã cập nhật trạng thái phòng.', 'PATCH'); }}><label>Phòng<select name="roomId" required>{rooms.map(room => <option value={room.id} key={room.id}>{room.name}</option>)}</select></label><label>Trạng thái<select name="status"><option value="ACTIVE">Hoạt động</option><option value="MAINTENANCE">Bảo trì</option><option value="INACTIVE">Ngừng hoạt động</option></select></label><button className="primary" disabled={busy}>Lưu trạng thái</button></form></details>}
  </section>;
}
