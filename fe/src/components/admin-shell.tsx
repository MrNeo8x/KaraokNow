'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Menu, Mic2, MoreHorizontal, type LucideIcon } from 'lucide-react';

export type NavItem = { id: string; label: string; icon: LucideIcon; group?: string };

/** Active section id kept in the URL hash so reloads and links land on the same screen. */
export function useSection(ids: string[], fallback: string): [string, (id: string) => void] {
  const [section, setSection] = useState(fallback);
  useEffect(() => {
    const read = () => { const hash = window.location.hash.slice(1); setSection(ids.includes(hash) ? hash : fallback); };
    read(); window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [ids, fallback]);
  const select = (id: string) => { setSection(id); if (window.location.hash.slice(1) !== id) window.history.replaceState(null, '', `#${id}`); };
  return [section, select];
}

export default function AdminShell({ product, nav, active, onSelect, title, subtitle, actions, footer, children, logoUrl }: {
  product: string; logoUrl?: string | null; nav: NavItem[]; active: string; onSelect: (id: string) => void;
  title: string; subtitle?: ReactNode; actions?: ReactNode; footer?: ReactNode; children: ReactNode;
}) {
  const [drawer, setDrawer] = useState(false); const [logoFailed, setLogoFailed] = useState<string | null>(null);
  const select = (id: string) => { onSelect(id); setDrawer(false); window.scrollTo({ top: 0 }); };
  const tabs = nav.slice(0, 3);
  let lastGroup: string | undefined;
  return <div className={drawer ? 'admin drawer-open' : 'admin'}>
    <aside className="admin-sidebar" aria-label="Điều hướng quản trị">
      <a className="admin-logo" href="/">{logoUrl && logoFailed !== logoUrl ? <span className="logo-mark has-logo"><img src={logoUrl} alt="" onError={() => setLogoFailed(logoUrl)} /></span> : <span className="logo-mark"><Mic2 size={20} aria-hidden /></span>}<span><strong>KaraokeNow</strong><small>{product}</small></span></a>
      <nav className="admin-nav">{nav.map(item => {
        const heading = item.group && item.group !== lastGroup ? <div className="nav-group" key={`g:${item.group}`}>{item.group}</div> : null; lastGroup = item.group;
        const Icon = item.icon;
        return [heading, <button key={item.id} type="button" aria-current={active === item.id ? 'page' : undefined} onClick={() => select(item.id)}><Icon size={18} aria-hidden />{item.label}</button>];
      })}</nav>
      {footer && <div className="admin-sidebar-footer">{footer}</div>}
    </aside>
    <button type="button" className="admin-scrim" aria-label="Đóng menu" onClick={() => setDrawer(false)} />
    <div className="admin-main">
      <header className="admin-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}><button type="button" className="admin-menu-button" aria-label="Mở menu" onClick={() => setDrawer(true)}><Menu size={22} /></button><div style={{ minWidth: 0 }}><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div></div>
        {actions && <div className="admin-topbar-actions">{actions}</div>}
      </header>
      <main className="admin-content">{children}</main>
    </div>
    {nav.length > 0 && <nav className="admin-tabbar" aria-label="Điều hướng nhanh">{tabs.map(item => { const Icon = item.icon; return <button key={item.id} type="button" aria-current={active === item.id ? 'page' : undefined} onClick={() => select(item.id)}><Icon size={20} aria-hidden />{item.label}</button>; })}<button type="button" aria-current={tabs.some(item => item.id === active) ? undefined : 'page'} onClick={() => setDrawer(true)}><MoreHorizontal size={20} aria-hidden />Thêm</button></nav>}
  </div>;
}
