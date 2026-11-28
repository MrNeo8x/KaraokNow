'use client';

import { useState, type ReactNode } from 'react';
import { countMax, heatLevel, labelIndices, niceMax, ticks } from '@/lib/chart-math';

// Hand-rolled SVG charts for the report screens (FE-020), following the dataviz method: thin marks with 4px rounded
// data-ends on the baseline, 2px gaps, recessive grid, hover tooltips on every chart, a legend for >= 2 series plus
// direct end labels, and a table view for every chart. Colours: single series = brand violet; two series = validated
// categorical slots 1–2 (blue/orange; orange is below 3:1 on white → direct labels + table view as relief).
export const SERIES = { primary: '#7c3aed', blue: '#257de0', orange: '#f47230' } as const;
const HEAT = ['#f1eef8', '#ddd6fe', '#b49cf6', '#8b5cf6', '#5b21b6']; // sequential violet, light → dark; [0] = none
const W = 640; const H = 220; const PAD = { top: 12, right: 64, bottom: 28, left: 52 };

export function ChartCard({ title, subtitle, legend, table, children }: { title: string; subtitle?: string; legend?: { label: string; color: string }[]; table: ReactNode; children: ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return <figure className="chart-card">
    <figcaption className="chart-head"><div><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</div><button type="button" className="link-button" aria-pressed={showTable} onClick={() => setShowTable(value => !value)}>{showTable ? 'Xem biểu đồ' : 'Bảng số liệu'}</button></figcaption>
    {legend && legend.length > 1 && <ul className="chart-legend">{legend.map(item => <li key={item.label}><i style={{ background: item.color }} aria-hidden />{item.label}</li>)}</ul>}
    {showTable ? <div className="table-wrap">{table}</div> : children}
  </figure>;
}

function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return <div className="chart-tooltip" style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }} role="status">{children}</div>;
}

function Axes({ max, format, labels }: { max: number; format: (value: number) => string; labels: string[] }) {
  const plotH = H - PAD.top - PAD.bottom; const plotW = W - PAD.left - PAD.right;
  const shown = labelIndices(labels.length, 7); const band = plotW / Math.max(1, labels.length);
  return <g className="chart-axes" aria-hidden>
    {ticks(max, 4).map(tick => { const y = PAD.top + plotH - (tick / max) * plotH; return <g key={tick}><line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} /><text x={PAD.left - 6} y={y + 4} textAnchor="end">{format(tick)}</text></g>; })}
    {shown.map(index => <text key={index} className="x-label" x={PAD.left + band * index + band / 2} y={H - 8} textAnchor="middle">{labels[index]}</text>)}
  </g>;
}

/** Column chart, one series. */
export function ColumnChart({ labels, values, format, color = SERIES.primary, unit, integer = false }: { labels: string[]; values: number[]; format: (value: number) => string; color?: string; unit: string; integer?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = integer ? countMax(values) : niceMax(values); const plotH = H - PAD.top - PAD.bottom; const plotW = W - PAD.left - PAD.right; const band = plotW / Math.max(1, values.length);
  const barW = Math.max(2, Math.min(28, band - 2));
  return <div className="chart" onMouseLeave={() => setHover(null)}>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${unit} theo kỳ`}>
      <Axes max={max} format={format} labels={labels} />
      {values.map((value, index) => {
        const h = (value / max) * plotH; const x = PAD.left + band * index + (band - barW) / 2; const y = PAD.top + plotH - h; const r = Math.min(4, barW / 2, h);
        return <g key={index}>
          {h > 0 && <path d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`} fill={color} opacity={hover === null || hover === index ? 1 : 0.55} />}
          <rect x={PAD.left + band * index} y={PAD.top} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} tabIndex={-1} />
        </g>;
      })}
      <line className="baseline" x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} />
    </svg>
    {hover !== null && <Tooltip x={PAD.left + band * hover + band / 2} y={PAD.top + plotH - (values[hover] / max) * plotH}><strong>{labels[hover]}</strong><span>{format(values[hover])} {unit}</span></Tooltip>}
  </div>;
}

/** Line chart for 1–2 series sharing one unit (never a second axis), crosshair + tooltip, direct end labels. */
export function LineChart({ labels, series, format, integer = false }: { labels: string[]; series: { name: string; color: string; values: number[] }[]; format: (value: number) => string; integer?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = series.flatMap(item => item.values); const max = integer ? countMax(values) : niceMax(values); const plotH = H - PAD.top - PAD.bottom; const plotW = W - PAD.left - PAD.right; const band = plotW / Math.max(1, labels.length);
  const px = (index: number) => PAD.left + band * index + band / 2; const py = (value: number) => PAD.top + plotH - (value / max) * plotH;
  return <div className="chart" onMouseLeave={() => setHover(null)}>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map(item => item.name).join(' và ')}>
      <Axes max={max} format={format} labels={labels} />
      {hover !== null && <line className="crosshair" x1={px(hover)} x2={px(hover)} y1={PAD.top} y2={PAD.top + plotH} />}
      {series.map(item => <g key={item.name}>
        <polyline points={item.values.map((value, index) => `${px(index)},${py(value)}`).join(' ')} fill="none" stroke={item.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <circle cx={px(hover)} cy={py(item.values[hover])} r={4.5} fill={item.color} stroke="#fff" strokeWidth={2} />}
        {item.values.length > 0 && <text className="end-label" x={px(item.values.length - 1) + 8} y={py(item.values.at(-1)!) + 4}>{item.name}</text>}
      </g>)}
      {labels.map((_, index) => <rect key={index} x={PAD.left + band * index} y={PAD.top} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(index)} />)}
      <line className="baseline" x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} />
    </svg>
    {hover !== null && <Tooltip x={px(hover)} y={PAD.top + 8}><strong>{labels[hover]}</strong>{series.map(item => <span key={item.name}><i style={{ background: item.color }} aria-hidden />{item.name}: {format(item.values[hover])}</span>)}</Tooltip>}
  </div>;
}

/** Horizontal bars for a 0–1 rate (room occupancy), value labels beside each bar. */
export function RateBars({ items }: { items: { key: string; label: string; rate: number; detail: string }[] }) {
  const [hover, setHover] = useState<string | null>(null);
  return <ul className="rate-bars">{items.map(item => <li key={item.key} onMouseEnter={() => setHover(item.key)} onMouseLeave={() => setHover(null)} title={item.detail}>
    <span className="rate-label">{item.label}</span>
    <span className="rate-track"><span className="rate-fill" style={{ width: `${Math.min(100, Math.max(0, item.rate * 100))}%`, opacity: hover === null || hover === item.key ? 1 : 0.55 }} /></span>
    <span className="rate-value">{(item.rate * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</span>
    {hover === item.key && <span className="rate-detail" role="status">{item.detail}</span>}
  </li>)}</ul>;
}

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
/** Weekday × hour heatmap (sequential violet; empty cells = 0). */
export function Heatmap({ cells }: { cells: { weekday: number; hour: number; bookings: number }[] }) {
  const [hover, setHover] = useState<{ weekday: number; hour: number; bookings: number } | null>(null);
  const value = (weekday: number, hour: number) => cells.find(cell => cell.weekday === weekday && cell.hour === hour)?.bookings ?? 0;
  const max = Math.max(0, ...cells.map(cell => cell.bookings));
  return <div className="heatmap" onMouseLeave={() => setHover(null)}>
    <div className="heatmap-grid" role="img" aria-label="Số booking theo thứ và giờ bắt đầu">
      <span />{Array.from({ length: 24 }, (_, hour) => <span key={hour} className="heat-hour">{hour % 3 === 0 ? hour : ''}</span>)}
      {WEEKDAYS.map((name, index) => <div key={name} className="heat-row"><span className="heat-day">{name}</span>{Array.from({ length: 24 }, (_, hour) => { const count = value(index + 1, hour); return <span key={hour} className="heat-cell" style={{ background: HEAT[heatLevel(count, max, HEAT.length)] }} onMouseEnter={() => setHover({ weekday: index + 1, hour, bookings: count })} aria-label={`${name} ${hour}:00: ${count} booking`} />; })}</div>)}
    </div>
    <div className="heat-legend"><span>Ít</span>{HEAT.map(color => <i key={color} style={{ background: color }} aria-hidden />)}<span>Nhiều</span>{hover && <strong role="status">{WEEKDAYS[hover.weekday - 1]} {String(hover.hour).padStart(2, '0')}:00 · {hover.bookings} booking</strong>}</div>
  </div>;
}
