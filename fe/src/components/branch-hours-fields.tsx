'use client';

import { useState } from 'react';

/** Opening hours inputs (named, read through FormData): two HH:mm times or "open 24 h" (PD-043). */
export default function BranchHoursFields({ initial }: { initial?: { openingTime?: string | null; closingTime?: string | null } }) {
  const [allDay, setAllDay] = useState(!initial?.openingTime || !initial?.closingTime);
  const [opening, setOpening] = useState(initial?.openingTime ?? '18:00'); const [closing, setClosing] = useState(initial?.closingTime ?? '02:00');
  const overnight = !allDay && opening && closing && closing <= opening;
  return <fieldset className="location-fields">
    <legend>Giờ mở cửa (khách chỉ đặt được trong giờ này)</legend>
    <div className="hours-fields">
      <label className="check-row"><input type="checkbox" name="allDay" checked={allDay} onChange={event => setAllDay(event.target.checked)} /> Mở 24 giờ</label>
      <label>Giờ mở cửa<input type="time" name="openingTime" step={900} value={opening} onChange={event => setOpening(event.target.value)} disabled={allDay} /></label>
      <label>Giờ đóng cửa<input type="time" name="closingTime" step={900} value={closing} onChange={event => setClosing(event.target.value)} disabled={allDay} /></label>
    </div>
    {overnight && <small>Đóng cửa sau nửa đêm: khung {opening}–{closing} tính cho ngày mở cửa.</small>}
    <small>Giữ chỗ do nhân viên tạo (điện thoại, khách tại quầy) không bị giới hạn bởi giờ mở cửa.</small>
  </fieldset>;
}
