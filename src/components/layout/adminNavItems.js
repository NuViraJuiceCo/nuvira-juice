import {
  Activity,
  BarChart3,
  Bell,
  CalendarDays,
  ClipboardList,
  Factory,
  Gift,
  LayoutDashboard,
  Map,
  PackageSearch,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
  UsersRound,
} from 'lucide-react';

export const adminNavGroups = [
  {
    label: 'Run Today',
    items: [
      { path: '/admin/operations', icon: LayoutDashboard, label: 'Operations' },
      { path: '/admin/production-queue', icon: Factory, label: 'Production' },
      { path: '/admin/delivery-queue', icon: Truck, label: 'Delivery' },
      { path: '/admin/route-ops', icon: Map, label: 'Route Ops' },
      { path: '/admin/compliance-ops', icon: ShieldCheck, label: 'Compliance' },
    ],
  },
  {
    label: 'Orders & Sales',
    items: [
      { path: '/admin/orders', icon: ClipboardList, label: 'Orders' },
      { path: '/admin/pos-orders', icon: Store, label: 'POS Orders' },
      { path: '/admin/shopify', icon: ShoppingCart, label: 'Shopify' },
      { path: '/admin/live-monitor', icon: Activity, label: 'Live Monitor' },
      { path: '/admin/bag-returns', icon: ShoppingBag, label: 'Bag Returns' },
    ],
  },
  {
    label: 'Plan & Stock',
    items: [
      { path: '/admin/production-planning', icon: CalendarDays, label: 'Planning' },
      { path: '/admin/inventory-status', icon: ShoppingCart, label: 'Inventory' },
      { path: '/admin/purchase-orders', icon: ClipboardList, label: 'Purchase Orders' },
      { path: '/admin/suppliers', icon: Store, label: 'Suppliers' },
      { path: '/admin/calendar', icon: CalendarDays, label: 'Calendar' },
      { path: '/admin/events', icon: CalendarDays, label: 'Events' },
      { path: '/admin/products', icon: PackageSearch, label: 'Products' },
    ],
  },
  {
    label: 'Team & Growth',
    items: [
      { path: '/admin/notifications', icon: Bell, label: 'Notifications' },
      { path: '/admin/loyalty-members', icon: Gift, label: 'Loyalty' },
      { path: '/admin/resources', icon: UsersRound, label: 'Resources' },
    ],
  },
  {
    label: 'Control',
    items: [
      { path: '/admin/ops-alerts', icon: Activity, label: 'Alerts' },
      { path: '/admin/review-queue', icon: ShieldCheck, label: 'Review Queue' },
      { path: '/admin/reporting', icon: BarChart3, label: 'Reporting' },
      { path: '/admin/audit-trail', icon: ClipboardList, label: 'Audit Trail' },
      { path: '/admin/sync-health', icon: Activity, label: 'Sync Health' },
      { path: '/admin/sync-status', icon: BarChart3, label: 'Sync Status' },
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
  return pathname.startsWith(`${item.path}/`);
}
