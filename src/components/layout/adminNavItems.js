import { ClipboardList, Factory, Gift, LayoutDashboard, ShieldCheck, ShoppingCart, Truck } from 'lucide-react';

export const adminNavGroups = [
  {
    label: 'Run Today',
    items: [
      { path: '/admin/operations', icon: LayoutDashboard, label: 'Operations' },
      { path: '/admin/production-queue', icon: Factory, label: 'Production', matches: ['/admin/production-planning'] },
      { path: '/admin/delivery-queue', icon: Truck, label: 'Delivery', matches: ['/admin/route-ops', '/admin/bag-returns'] },
      { path: '/admin/orders', icon: ClipboardList, label: 'Orders', matches: ['/admin/pos-orders', '/admin/shopify'] },
    ],
  },
  {
    label: 'Manage',
    items: [
      { path: '/admin/inventory-status', icon: ShoppingCart, label: 'Inventory & Purchasing', matches: ['/admin/purchase-orders', '/admin/suppliers', '/admin/products'] },
      { path: '/admin/loyalty-members', icon: Gift, label: 'Customers & Growth', matches: ['/admin/notifications', '/admin/discount-codes'] },
      { path: '/admin/compliance-ops', icon: ShieldCheck, label: 'Compliance & Audit', matches: ['/admin/ops-alerts', '/admin/review-queue', '/admin/reporting', '/admin/audit-trail'] },
      { path: '/admin/resources', icon: ShieldCheck, label: 'Team & Equipment' },
    ],
  },
];

export const adminMobileNavItems = [
  { path: '/admin/operations', icon: LayoutDashboard, label: 'Ops' },
  { path: '/admin/production-queue', icon: Factory, label: 'Produce' },
  { path: '/admin/delivery-queue', icon: Truck, label: 'Deliver' },
  { path: '/admin/compliance-ops', icon: ShieldCheck, label: 'Logs' },
  { path: '/admin/orders', icon: ClipboardList, label: 'Orders' },
];

export function isAdminNavActive(pathname, item) {
  if (pathname === item.path) return true;
  if (item.path === '/admin/operations') return pathname === '/admin';
  if (pathname.startsWith(`${item.path}/`)) return true;
  return (item.matches || []).some(path => pathname === path || pathname.startsWith(`${path}/`));
}
