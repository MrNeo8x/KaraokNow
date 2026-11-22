'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { request } from '@/lib/api';
import PriceRules, { type PriceRule } from './price-rules';
import SpecialDates, { type SpecialDate } from './special-dates';

type Props = { token: string; tenant: string; branches: { id: string; name: string }[]; currentBranch: string };
type Buffer = { bufferEnabled: boolean; bufferMinutes: number };
type Duration = { durationStepMinutes: number; minDurationMinutes: number; maxDurationMinutes: number };
type Plan = { id: string; code: string; name: string; status: string; effectiveFrom: string | null; effectiveTo: string | null };

export default function PricingSettings({ token, tenant, branches, currentBranch }: Props) {
  const [opened, setOpened] = useState(false);
  const [buffer, setBuffer] = useState<Buffer | null>(null);
  const [duration, setDuration] = useState<Duration | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [dates, setDates] = useState<SpecialDate[]>([]);
  const [datesReady, setDatesReady] = useState(false);
  const [datesError, setDatesError] = useState('');
  const [planId, setPlanId] = useState('');
  const [rules, setRules] = useState<PriceRule[]>([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [planError, setPlanError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(false);
  const selectedPlan = plans.find(plan => plan.id === planId);

  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setPlanError('');
    Promise.allSettled([
      request<Buffer>('/merchant/availability/buffer-policy', { signal: controller.signal }, token, tenant),
      request<Duration>('/merchant/pricing/duration-policy', { signal: controller.signal }, token, tenant),
      request<Plan[]>('/merchant/pricing/plans', { signal: controller.signal }, token, tenant),
      request<SpecialDate[]>('/merchant/pricing/special-dates', { signal: controller.signal }, token, tenant),
    ]).then(([b, d, p, s]) => {
      if (controller.signal.aborted) return;
      if (b.status === 'fulfilled') setBuffer(b.value); else setError(`Không tải được buffer: ${b.reason.message}`);
      if (d.status === 'fulfilled') setDuration(d.value); else setError(`Không tải được thời lượng: ${d.reason.message}`);
      if (p.status === 'fulfilled') { setPlans(p.value); setPlanId(current => p.value.some(plan => plan.id === current) ? current : ''); }
      else { setPlans([]); setPlanId(''); setPlanError(`Không tải được bảng giá: ${p.reason.message}. Chỉ Owner có quyền quản lý bảng giá.`); }
      if (s.status === 'fulfilled') { setDates(s.value); setDatesReady(true); setDatesError(''); }
      else { setDatesReady(false); setDatesError(`Không tải được ngày đặc biệt: ${s.reason.message}`); }
      setLoading(false);
    });
    return () => controller.abort();
  }, [opened, token, tenant, revision]);

  useEffect(() => {
    if (!opened || !planId) { setRules([]); return; }
    const controller = new AbortController();
    setRules([]); setRulesLoading(true);
    request<PriceRule[]>(`/merchant/pricing/plans/${encodeURIComponent(planId)}/rules`, { signal: controller.signal }, token, tenant)
      .then(setRules).catch(err => { if (!controller.signal.aborted) setPlanError((err as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setRulesLoading(false); });
    return () => controller.abort();
  }, [opened, planId, token, tenant, revision]);

  async function save(event: FormEvent<HTMLFormElement>, path: string, body: object, method: 'POST' | 'PATCH', success: string, reset = false) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setError(''); setPlanError(''); setMessage('');
    try {
      await request(path, { method, body: JSON.stringify(body) }, token, tenant);
      if (reset) form.reset();
      setMessage(success); setRevision(value => value + 1);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return <details className="card pricing-settings" onToggle={event => setOpened(event.currentTarget.open)}>
    <summary>Cấu hình thời lượng, buffer và giá</summary>
    <p>Cấu hình áp dụng cho Merchant. Backend kiểm tra quyền và ghi nhận thay đổi.</p>
    {loading && <p aria-live="polite">Đang tải cấu hình…</p>}{error && <div role="alert" className="error">{error}</div>}{planError && <div role="alert" className="error">{planError}</div>}{datesError && !planError && <div role="alert" className="error">{datesError}</div>}{message && <div role="status" className="notice">{message}</div>}
    <div className="pricing-grid">
      {duration && <form className="action-form" key={`duration-${revision}`} onSubmit={e => { const d = new FormData(e.currentTarget); void save(e, '/merchant/pricing/duration-policy', { durationStepMinutes: Number(d.get('step')), minDurationMinutes: Number(d.get('min')), maxDurationMinutes: Number(d.get('max')) }, 'PATCH', 'Đã lưu thời lượng.'); }}><h3>Thời lượng đặt phòng</h3><label>Bước thời lượng (phút)<input name="step" type="number" min={1} max={1440} required defaultValue={duration.durationStepMinutes} /></label><label>Tối thiểu (phút)<input name="min" type="number" min={1} max={1440} required defaultValue={duration.minDurationMinutes} /></label><label>Tối đa (phút)<input name="max" type="number" min={1} max={1440} required defaultValue={duration.maxDurationMinutes} /></label><button className="primary" disabled={busy || loading}>Lưu thời lượng</button></form>}
      {buffer && <form className="action-form" key={`buffer-${revision}`} onSubmit={e => { const d = new FormData(e.currentTarget); void save(e, '/merchant/availability/buffer-policy', { bufferEnabled: d.has('enabled'), bufferMinutes: Number(d.get('minutes')) }, 'PATCH', 'Đã lưu buffer.'); }}><h3>Thời gian dọn phòng</h3><label className="check-row"><input name="enabled" type="checkbox" defaultChecked={buffer.bufferEnabled} /> Bật buffer sau lượt hát</label><label>Thời gian (phút)<input name="minutes" type="number" min={0} max={1440} required defaultValue={buffer.bufferMinutes} /></label><button className="primary" disabled={busy || loading}>Lưu buffer</button></form>}
    </div>
    {!planError && <>{datesReady && <SpecialDates dates={dates} token={token} tenant={tenant} refresh={() => setRevision(value => value + 1)} />}<h3>Bảng giá</h3><p>Bảng giá mới được tạo dưới dạng nháp. Chỉ Owner có quyền quản lý giá.</p><form className="action-form pricing-grid" onSubmit={e => { const d = new FormData(e.currentTarget); void save(e, '/merchant/pricing/plans', { code: String(d.get('code')).trim(), name: String(d.get('name')).trim(), effectiveFrom: d.get('from') || null, effectiveTo: d.get('to') || null }, 'POST', 'Đã tạo bảng giá nháp.', true); }}><label>Mã bảng giá<input name="code" required maxLength={50} /></label><label>Tên bảng giá<input name="name" required maxLength={200} /></label><label>Hiệu lực từ<input name="from" type="date" /></label><label>Hiệu lực đến<input name="to" type="date" /></label><button className="primary" disabled={busy || loading}>Tạo bảng giá</button></form>
      <label className="pricing-select">Chọn bảng giá<select value={planId} disabled={busy || loading} onChange={e => { setPlanId(e.target.value); setRules([]); setMessage(''); }}><option value="">Chọn bảng giá</option>{plans.map(plan => <option value={plan.id} key={plan.id}>{plan.code} · {plan.name} · {plan.status}</option>)}</select></label>
      {selectedPlan && <><form className="action-form pricing-grid" key={`${selectedPlan.id}-${revision}`} onSubmit={e => { const d = new FormData(e.currentTarget); void save(e, `/merchant/pricing/plans/${encodeURIComponent(selectedPlan.id)}`, { name: String(d.get('name')).trim(), status: d.get('status'), effectiveFrom: d.get('from') || null, effectiveTo: d.get('to') || null }, 'PATCH', 'Đã cập nhật bảng giá.'); }}><h3>Cập nhật bảng giá</h3><label>Tên bảng giá<input name="name" defaultValue={selectedPlan.name} required maxLength={200} /></label><label>Trạng thái<select name="status" defaultValue={selectedPlan.status}><option value="DRAFT">Nháp</option><option value="ACTIVE">Hoạt động</option><option value="INACTIVE">Ngừng hoạt động</option></select></label><label>Hiệu lực từ<input name="from" type="date" defaultValue={selectedPlan.effectiveFrom ?? ''} /></label><label>Hiệu lực đến<input name="to" type="date" defaultValue={selectedPlan.effectiveTo ?? ''} /></label><button className="primary" disabled={busy || loading}>Lưu bảng giá</button></form><PriceRules key={selectedPlan.id} token={token} tenant={tenant} branches={branches} currentBranch={currentBranch} dates={dates} datesReady={datesReady && !loading} planId={selectedPlan.id} rules={rules} loading={rulesLoading} refresh={() => setRevision(value => value + 1)} /></>}</>}
  </details>;
}
