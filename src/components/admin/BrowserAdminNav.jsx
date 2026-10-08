import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ArrowLeft, CalendarDays, ClipboardList, Factory, Gift, LayoutDashboard, Menu, Package, ShieldCheck, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { BRAND_IMAGES } from '@/lib/brandImages';

export const browserAdminGroups = [
  { label: 'Workspace', icon: LayoutDashboard, items: [['Operations', 'operations'], ['Orders', 'orders'], ['Calendar', 'calendar']] },
  { label: 'Production & delivery', icon: Factory, items: [['Production queue', 'production-queue'], ['Production planning', 'production-planning'], ['Delivery queue', 'delivery-queue'], ['Route review', 'route-ops'], ['Bag returns', 'bag-returns']] },
  { label: 'Inventory & catalog', icon: Package, items: [['Inventory', 'inventory-status'], ['Purchase orders', 'purchase-orders'], ['Suppliers', 'suppliers'], ['Product catalog', 'products']] },
  { label: 'Customers & growth', icon: Gift, items: [['Loyalty members', 'loyalty-members'], ['Discount codes', 'discount-codes'], ['Notifications', 'notifications'], ['Events', 'events']] },
  { label: 'Sales channels', icon: ClipboardList, items: [['POS / event orders', 'pos-orders'], ['Shopify', 'shopify']] },
  { label: 'Oversight', icon: ShieldCheck, items: [['Compliance', 'compliance-ops'], ['Alerts', 'ops-alerts'], ['Review queue', 'review-queue'], ['Reporting', 'reporting'], ['Audit trail', 'audit-trail'], ['Sync status', 'sync-status']] },
  { label: 'Resources', icon: Users, items: [['Team & equipment', 'resources']] },
];

function Navigation({ onNavigate }) {
  return <nav aria-label="Administration" className="nv-admin-navigation">
    {browserAdminGroups.map(({ label, icon: Icon, items }) => <section key={label}>
      <h2><Icon size={15} />{label}</h2>
      {items.map(([name, slug]) => <NavLink key={slug} to={`/admin/${slug}`} onClick={onNavigate}>{name}</NavLink>)}
    </section>)}
  </nav>;
}

export default function BrowserAdminNav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const opener = useRef(null);
  useEffect(() => setOpen(false), [location.pathname]);
  return <>
    <aside className="nv-admin-sidebar">
      <Link to="/admin/operations" className="nv-admin-logo"><img src={BRAND_IMAGES.wordmark} alt="NuVira" /><span>Administration</span></Link>
      <Navigation />
      <Link className="nv-admin-back" to="/account"><ArrowLeft size={16} />Customer account</Link>
    </aside>
    <div className="nv-admin-compact-bar">
      <button ref={opener} type="button" aria-label="Open admin navigation" onClick={() => setOpen(true)}><Menu size={20} /></button>
      <Link to="/admin/operations">NuVira Administration</Link>
      <Link to="/admin/calendar" aria-label="Calendar"><CalendarDays size={19} /></Link>
    </div>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus(); }} className="nv-admin-navigation-dialog">
        <DialogTitle>Administration</DialogTitle>
        <DialogDescription>NuVira workspace</DialogDescription>
        <Navigation onNavigate={() => setOpen(false)} />
        <Link className="nv-admin-back" to="/account" onClick={() => setOpen(false)}><ArrowLeft size={16} />Customer account</Link>
      </DialogContent>
    </Dialog>
  </>;
}

export function BrowserAdminSectionNav() {
  const { pathname } = useLocation();
  const group = browserAdminGroups.find(item => item.items.some(([, slug]) => pathname === `/admin/${slug}`));
  if (!group || group.items.length < 2) return null;
  return <nav className="nv-admin-section-nav" aria-label={group.label}>
    {group.items.map(([name, slug]) => <NavLink key={slug} to={`/admin/${slug}`}>{name}</NavLink>)}
  </nav>;
}
