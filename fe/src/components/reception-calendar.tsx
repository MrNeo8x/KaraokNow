'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, List, RefreshCw } from 'lucide-react';
import { request } from '@/lib/api';
import { DAY_START_HOUR, dayWindow, entryLabel, entryTone, mergeEntries, placement, visibleEntries, zoneDay, type CalendarBooking, type CalendarEntry, type CalendarHold } from '@/lib/reception-calendar';

type Page<T> = { items: T[]; hasMore: boolean };
const PAGE = 100; const MAX_PAGES = 10;

/** Reads every page (bounded) of a branch list endpoint for the window; reports truncation instead of hiding it. */
async function readAll<T>(path: string, window: { from: string; to: string }, token: string, tenant: string, signal: AbortSignal): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ from: window.from, to: window.to, limit: String(PAGE), offset: String(page * PAGE) });
    const result = await request<Page<T>>(`${path}?${query}`, { signal }, token, tenant);
    items.push(...result.items);
    if (!result.hasMore) return { items, truncated: false };
  }
  return { items, truncated: true };
}

export default function ReceptionCalendar({ token, tenant, branchId, timezone, rooms }: { token: string; tenant: string; branchId: string; timezone: string; rooms: { id: string; name: string }[] }) {
  // The day and the "now" marker are browser-only values (never computed during prerender).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const [day, setDay] = useState('');
  useEffect(() => { if (now !== null && !day) setDay(zoneDay(now, timezone)); }, [now, day, timezone]);
  const [entries, setEntries] = useState<CalendarEntry[] | null>(null); const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false); const [revision, setRevision] = useState(0);
  const [showClosed, setShowClosed] = useState(false); const [view, setView] = useState<'timeline' | 'list'>('timeline'); const [selected, setSelected] = useState<string | null>(null);
  const window_ = useMemo(() => day ? dayWindow(day, timezone) : null, [day, timezone]);
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window_) return;
    const controller = new AbortController(); setLoading(true); setError(''); setSelected(null);
    Promise.all([
      readAll<CalendarHold>(`/merchant/branches/${encodeURIComponent(branchId)}/booking/holds`, window_, token, tenant, controller.signal),
      readAll<CalendarBooking>(`/merchant/branches/${encodeURIComponent(branchId)}/booking/bookings`, window_, token, tenant, controller.signal),
    ]).then(([holds, bookings]) => { setEntries(mergeEntries(holds.items, bookings.items)); setTruncated(holds.truncated || bookings.truncated); })
      .catch(err => { if (!controller.signal.aborted) { setEntries(null); setError((err as Error).message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [window_, branchId, token, tenant, revision]);

  const shown = entries ? visibleEntries(entries, showClosed) : [];
  const hiddenCount = entries ? entries.length - shown.length : 0;
  const knownRooms = new Set(rooms.map(room => room.id));
  const rows = [...rooms, ...(shown.some(entry => !knownRooms.has(entry.roomId)) ? [{ id: '__other', name: 'Phòng khác' }] : [])];
  const time = (ms: number) => new Intl.DateTimeFormat('vi-VN', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
  const roomName = (id: string) => rooms.find(room => room.id === id)?.name ?? 'Phòng khác';
  const hours = Array.from({ length: 24 }, (_, index) => (DAY_START_HOUR + index) % 24);
  const nowLeft = window_ && now !== null && now >= window_.startMs && now < window_.endMs ? ((now - window_.startMs) / (window_.endMs - window_.startMs)) * 100 : null;
  const selectedEntry = shown.find(entry => entry.key === selected) ?? null;
  // Scroll the timeline to the "now" line (today) or the first entry once data for a day arrives.
  const firstStart = shown.length ? Math.min(...shown.map(entry => entry.start)) : null;
  useEffect(() => {
    const element = timelineRef.current; if (!element || !window_ || view !== 'timeline') return;
    const target = nowLeft !== null ? now! : firstStart; if (target === null) return;
    const ratio = Math.min(1, Math.max(0, (target - window_.startMs) / (window_.endMs - window_.startMs)));
    const track = element.scrollWidth - 150;
    element.scrollTo({ left: Math.max(0, 150 + ratio * track - element.clientWidth / 3 - 150) });
  }, [entries, window_, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const shiftDay = (offset: number) => { if (now === null) return; setDay(zoneDay(now + offset * 86_400_000, timezone)); };
  const today = now === null ? '' : zoneDay(now, timezone); const tomorrow = now === null ? '' : zoneDay(now + 86_400_000, timezone);

  return <section className="card reception-calendar" aria-labelledby="calendar-title">
    <div className="section-head"><h2 id="calendar-title">Lịch phòng <small>(giữ chỗ + booking)</small></h2>
      <div className="calendar-controls">
        <button type="button" className="date-chip compact" aria-pressed={day === today} onClick={() => shiftDay(0)}>Hôm nay</button>
        <button type="button" className="date-chip compact" aria-pressed={day === tomorrow} onClick={() => shiftDay(1)}>Ngày mai</button>
        <label className="calendar-day"><span className="visually-hidden">Ngày xem lịch</span><input aria-label="Ngày xem lịch" type="date" value={day} onChange={event => event.target.value && setDay(event.target.value)} /></label>
        <div className="segmented" role="group" aria-label="Kiểu hiển thị"><button type="button" aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}><CalendarDays size={14} aria-hidden /> Dòng thời gian</button><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={14} aria-hidden /> Danh sách</button></div>
        <button type="button" className="secondary" disabled={loading} onClick={() => setRevision(value => value + 1)} aria-label="Tải lại lịch"><RefreshCw size={14} aria-hidden /></button>
      </div>
    </div>
    <p>Từ {String(DAY_START_HOUR).padStart(2, '0')}:00 đến {String(DAY_START_HOUR).padStart(2, '0')}:00 hôm sau · múi giờ {timezone}. Phần gạch chéo là thời gian dọn phòng sau giờ kết thúc.</p>
    <div className="calendar-legend">{['HELD', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', ...(showClosed ? ['EXPIRED', 'CANCELLED', 'NO_SHOW'] : [])].map(status => <span key={status} className={`pill ${entryTone[status]}`}>{entryLabel[status]}</span>)}
      <label className="check-row"><input type="checkbox" checked={showClosed} onChange={event => setShowClosed(event.target.checked)} /> Hiện đã hủy / không đến / hold hết hạn{!showClosed && hiddenCount ? ` (${hiddenCount})` : ''}</label></div>
    {error && <div className="error" role="alert">{error}</div>}
    {truncated && <div className="notice" role="status">Có hơn {PAGE * MAX_PAGES} mục trong ngày; lịch chỉ hiện {PAGE * MAX_PAGES} mục đầu.</div>}
    {loading && !entries ? <p role="status">Đang tải lịch…</p> : entries && (shown.length === 0 ? <div className="empty">Không có giữ chỗ hoặc booking trong ngày này{hiddenCount ? ' (đang ẩn mục đã hủy/hết hạn)' : ''}.</div> : view === 'timeline' && window_ ? <div className="timeline" ref={timelineRef} role="region" aria-label="Dòng thời gian theo phòng" tabIndex={0}>
      <div className="timeline-inner">
        <div className="timeline-row timeline-head"><div className="timeline-room" /><div className="timeline-track">{hours.map((hour, index) => <span key={index} style={{ left: `${(index / 24) * 100}%` }}>{String(hour).padStart(2, '0')}:00</span>)}</div></div>
        {rows.map(room => <div className="timeline-row" key={room.id}><div className="timeline-room">{room.name}</div><div className="timeline-track">
          {nowLeft !== null && <i className="timeline-now" style={{ left: `${nowLeft}%` }} aria-hidden />}
          {shown.filter(entry => room.id === '__other' ? !knownRooms.has(entry.roomId) : entry.roomId === room.id).map(entry => { const place = placement(entry, window_.startMs, window_.endMs); if (!place) return null; return <button type="button" key={entry.key} className={`timeline-block tone-${entryTone[entry.status] ?? 'gray'}${selected === entry.key ? ' selected' : ''}`} style={{ left: `${place.left}%`, width: `${Math.max(place.width, 0.8)}%` }} aria-pressed={selected === entry.key} aria-label={`${roomName(entry.roomId)} ${time(entry.start)}–${time(entry.end)} ${entryLabel[entry.status] ?? entry.status}`} onClick={() => setSelected(entry.key)}>
            <strong>{place.clippedStart ? '← ' : ''}{time(entry.start)}–{time(entry.end)}</strong><span>{entry.kind === 'hold' ? 'Giữ chỗ' : 'Booking'}{entry.phone ? ` · ${entry.phone}` : ''}</span>
            {place.bufferWidth > 0 && <em className="timeline-buffer" style={{ width: `${(place.bufferWidth / Math.max(place.width, 0.8)) * 100}%` }} aria-hidden />}
          </button>; })}
        </div></div>)}
      </div>
    </div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Thời gian</th><th>Phòng</th><th>Loại</th><th>Trạng thái</th><th>Khách</th></tr></thead><tbody>{shown.map(entry => <tr key={entry.key} onClick={() => setSelected(entry.key)} className={selected === entry.key ? 'row-selected' : ''}><td data-label="Thời gian"><strong>{time(entry.start)}–{time(entry.end)}</strong></td><td data-label="Phòng">{roomName(entry.roomId)}</td><td data-label="Loại">{entry.kind === 'hold' ? 'Giữ chỗ' : 'Booking'}{entry.channel ? ` · ${entry.channel}` : ''}</td><td data-label="Trạng thái"><span className={`pill ${entryTone[entry.status] ?? 'gray'}`}>{entryLabel[entry.status] ?? entry.status}</span></td><td data-label="Khách">{entry.phone ?? '—'}</td></tr>)}</tbody></table></div>)}
    {selectedEntry && <div className="calendar-detail" role="status"><div className="order-head"><strong>{roomName(selectedEntry.roomId)} · {time(selectedEntry.start)}–{time(selectedEntry.end)}</strong><span className={`pill ${entryTone[selectedEntry.status] ?? 'gray'}`}>{entryLabel[selectedEntry.status] ?? selectedEntry.status}</span></div>
      <p>{selectedEntry.kind === 'hold' ? 'Giữ chỗ' : 'Booking'}{selectedEntry.channel ? ` · kênh ${selectedEntry.channel}` : ''}{selectedEntry.phone ? ` · khách ${selectedEntry.phone}` : ''} · giữ phòng đến {time(selectedEntry.reservedEnd)} (gồm dọn phòng)</p>
      <small>Mã {selectedEntry.kind === 'hold' ? 'giữ chỗ' : 'booking'}: <code>{selectedEntry.id}</code>. {selectedEntry.kind === 'hold' ? 'Dán mã vào "Tra cứu mã giữ phòng" bên dưới để xem cọc, xác minh và xác nhận.' : 'Check-in/out, thu tiền và hủy ở mục "Booking, check-in/out" bên dưới.'}</small></div>}
  </section>;
}
