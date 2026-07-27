import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/admin-access';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, RefreshCw, Package, ShoppingCart, BarChart3, Settings, Bell, CheckCircle, AlertTriangle, XCircle, Zap } from 'lucide-react';
import { format } from 'date-fns';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { usePageVisibility } from '@/lib/usePageVisibility';

const NAV_TABS = [
  { key: 'orders', label: 'Orders', icon: ShoppingCart },
  { key: 'alerts', label: 'Alerts', icon: Bell },
  { key: 'products', label: 'Products', icon: Package },
  { key: 'reports', label: 'Reports', icon: BarChart3 },
  { key: 'settings', label: 'Settings', icon: Settings },
];

function useShopifyOpsSummary({ refetchInterval = 30000 } = {}) {
  const isPageVisible = usePageVisibility();
  return useQuery({
    queryKey: ['admin-shopify-ops-summary'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminShopifyOpsSummary', {});
      return res.data || {};
    },
    enabled: isPageVisible,
    refetchInterval: isPageVisible ? refetchInterval : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export default function ShopifyDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('orders');

  if (!isAdminUser(user)) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Access denied.</p></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminOpsHeader
        title="Shopify Integration"
        subtitle="Source operations"
        badge="Source-backed"
        onBack={() => navigate('/admin/operations')}
        actions={<Zap className="h-4 w-4 text-muted-foreground" />}
      />

      {/* Tab Nav */}
      <div className="flex overflow-x-auto gap-1 px-4 py-3 border-b border-border bg-card no-scrollbar">
        {NAV_TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                activeTab === tab.key ? 'bg-nuvira-gradient text-white' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="p-4">
        {activeTab === 'orders' && <ShopifyOrdersTab />}
        {activeTab === 'alerts' && <AlertsTab />}
        {activeTab === 'products' && <ProductsTab />}
        {activeTab === 'reports' && <ReportsTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}

// ─── Orders Tab ─────────────────────────────────────────────────────────────

const SOURCE_COLORS = {
  online: 'bg-blue-100 text-blue-700',
  pos: 'bg-purple-100 text-purple-700',
  event: 'bg-pink-100 text-pink-700',
  subscription: 'bg-cyan-100 text-cyan-700',
  wholesale: 'bg-cyan-100 text-cyan-700',
  draft: 'bg-gray-100 text-gray-600',
  admin: 'bg-slate-100 text-slate-600',
};

const PROD_STATUS_COLORS = {
  new: 'bg-blue-100 text-blue-700',
  awaiting_production: 'bg-indigo-100 text-indigo-700',
  in_production: 'bg-cyan-100 text-cyan-700',
  bottled: 'bg-orange-100 text-orange-700',
  labeled: 'bg-orange-100 text-orange-700',
  qc_checked: 'bg-lime-100 text-lime-700',
  packed: 'bg-teal-100 text-teal-700',
  in_cold_storage: 'bg-cyan-100 text-cyan-700',
  assigned_for_pickup: 'bg-violet-100 text-violet-700',
  assigned_for_delivery: 'bg-sky-100 text-sky-700',
  fulfilled: 'bg-green-100 text-green-700',
  canceled: 'bg-red-100 text-red-700',
  refunded: 'bg-rose-100 text-rose-700',
};

const WORKFLOW_STEPS = [
  { key: 'new', label: 'New' },
  { key: 'awaiting_production', label: 'Awaiting Production' },
  { key: 'in_production', label: 'In Production' },
  { key: 'bottled', label: 'Bottled' },
  { key: 'labeled', label: 'Labeled' },
  { key: 'qc_checked', label: 'QC Checked' },
  { key: 'packed', label: 'Packed' },
  { key: 'in_cold_storage', label: 'In Cold Storage' },
  { key: 'assigned_for_pickup', label: 'Assigned for Pickup' },
  { key: 'assigned_for_delivery', label: 'Assigned for Delivery' },
  { key: 'fulfilled', label: 'Fulfilled' },
];

const CHECKLIST_LABELS = {
  produce_pulled: 'Produce Pulled',
  ingredients_prepped: 'Ingredients Prepped',
  juice_pressed: 'Juice Pressed',
  bottled: 'Bottled',
  labeled: 'Labeled',
  qc_checked: 'QC Checked',
  packed: 'Packed',
  in_cold_storage: 'In Cold Storage',
};

function ShopifyOrdersTab() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('active');
  const [filterChannel, setFilterChannel] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState(null);

  const { data: shopifyOps = {}, isLoading } = useShopifyOpsSummary({ refetchInterval: 30000 });
  const orders = shopifyOps.orders || [];

  const ACTIVE_STATUSES = ['new', 'awaiting_production', 'in_production', 'bottled', 'labeled', 'qc_checked', 'packed', 'in_cold_storage', 'assigned_for_pickup', 'assigned_for_delivery'];

  const filtered = orders.filter(o => {
    const matchStatus = filterStatus === 'active' ? ACTIVE_STATUSES.includes(o.production_status) :
      filterStatus === 'fulfilled' ? o.production_status === 'fulfilled' :
      filterStatus === 'canceled' ? ['canceled', 'refunded'].includes(o.production_status) : true;
    const matchChannel = filterChannel === 'all' || o.source_channel === filterChannel;
    const q = search.toLowerCase();
    const matchSearch = !search || [o.customer_name, o.customer_email, o.customer_phone, o.shopify_order_number]
      .some(v => v?.toLowerCase().includes(q));
    return matchStatus && matchChannel && matchSearch;
  });

  if (selectedOrder) {
    const order = orders.find(o => o.id === selectedOrder);
    if (order) {
      return <OrderDetail order={order} onBack={() => setSelectedOrder(null)} />;
    }
  }

  return (
    <div>
      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by name, email, phone, order #..."
        className="w-full h-10 px-3 rounded-xl border border-border bg-card text-sm mb-3 focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {/* Filters */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {['active', 'fulfilled', 'canceled', 'all'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${filterStatus === s ? 'bg-nuvira-gradient text-white' : 'bg-secondary text-secondary-foreground'}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <div className="w-px bg-border mx-1" />
        {['all', 'online', 'pos', 'event', 'subscription', 'wholesale'].map(c => (
          <button key={c} onClick={() => setFilterChannel(c)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${filterChannel === c ? 'bg-nuvira-gradient text-white' : 'bg-secondary text-secondary-foreground'}`}>
            {c === 'all' ? 'All Channels' : c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground mb-3">{filtered.length} orders</p>

      {isLoading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {filtered.map(order => (
            <button key={order.id} onClick={() => setSelectedOrder(order.id)} className="w-full text-left">
              <div className="bg-card rounded-xl border border-border/50 p-3 hover:border-primary/40 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      <span className="text-sm font-bold">#{order.shopify_order_number}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${PROD_STATUS_COLORS[order.production_status] || 'bg-muted text-muted-foreground'}`}>
                        {order.production_status?.replace(/_/g, ' ')}
                      </span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${SOURCE_COLORS[order.source_channel] || 'bg-muted text-muted-foreground'}`}>
                        {order.source_channel}
                      </span>
                      {order.is_subscription && <span className="text-[10px] bg-cyan-100 text-cyan-700 px-1.5 py-0.5 rounded-full font-semibold">Recurring</span>}
                    </div>
                    <p className="text-xs font-medium truncate">{order.customer_name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{order.customer_email}</p>
                    {order.requested_delivery_date && (
                      <p className="text-[10px] text-primary font-medium mt-0.5">📅 {order.requested_delivery_date}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold">${order.total_price?.toFixed(2)}</p>
                    <p className="text-[10px] text-muted-foreground">{order.fulfillment_method}</p>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OrderDetail({ order, onBack }) {
  const currentIdx = WORKFLOW_STEPS.findIndex(s => s.key === order.production_status);
  const nextStep = WORKFLOW_STEPS[currentIdx + 1];
  const checklist = order.workflow_checklist || {};
  const orderLookup = order.shopify_order_number || order.name || order.id || '';

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4 hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back to orders
      </button>

      {/* Header */}
      <div className="bg-card rounded-2xl border border-border/50 p-4 mb-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-heading text-lg font-bold">#{order.shopify_order_number}</h2>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${PROD_STATUS_COLORS[order.production_status] || 'bg-muted'}`}>
                {order.production_status?.replace(/_/g, ' ')}
              </span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${SOURCE_COLORS[order.source_channel] || 'bg-muted'}`}>
                {order.source_channel}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Synced {order.shopify_synced_at ? format(new Date(order.shopify_synced_at), 'MMM d, h:mm a') : '—'}</p>
          </div>
          <p className="text-lg font-bold">${order.total_price?.toFixed(2)}</p>
        </div>

        {/* Customer Info */}
        <div className="space-y-1 text-xs">
          <InfoRow label="Customer" value={order.customer_name} />
          <InfoRow label="Email" value={order.customer_email} />
          <InfoRow label="Phone" value={order.customer_phone} />
          <InfoRow label="Fulfillment" value={order.fulfillment_method} />
          {order.delivery_address && <InfoRow label="Address" value={order.delivery_address} />}
          {order.requested_delivery_date && <InfoRow label="Requested Date" value={order.requested_delivery_date} />}
          {order.requested_time_window && <InfoRow label="Time Window" value={order.requested_time_window} />}
          <InfoRow label="Payment" value={order.financial_status} />
          <InfoRow label="Shopify Status" value={order.shopify_fulfillment_status} />
          {order.discount_codes?.length > 0 && <InfoRow label="Discount" value={order.discount_codes.join(', ')} />}
          {order.tip_received > 0 && <InfoRow label="Tip" value={`$${order.tip_received?.toFixed(2)}`} />}
          {order.total_tax > 0 && <InfoRow label="Tax" value={`$${order.total_tax?.toFixed(2)}`} />}
        </div>
      </div>

      {/* Line Items */}
      <div className="bg-card rounded-2xl border border-border/50 p-4 mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Line Items</p>
        <div className="space-y-2">
          {order.line_items?.map((li, i) => (
            <div key={i} className="flex justify-between text-sm">
              <div>
                <p className="font-medium">{li.title}</p>
                {li.variant_title && <p className="text-xs text-muted-foreground">{li.variant_title}</p>}
                {li.sku && <p className="text-[10px] text-muted-foreground font-mono">SKU: {li.sku}</p>}
              </div>
              <div className="text-right shrink-0 ml-2">
                <p className="font-semibold">×{li.quantity}</p>
                <p className="text-xs text-muted-foreground">${(li.price * li.quantity).toFixed(2)}</p>
              </div>
            </div>
          ))}
        </div>
        {order.customer_notes && (
          <div className="mt-3 pt-3 border-t border-border/40">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Customer Notes</p>
            <p className="text-xs text-foreground">{order.customer_notes}</p>
          </div>
        )}
      </div>

      {/* Production Checklist */}
      <div className="bg-card rounded-2xl border border-border/50 p-4 mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Production Checklist</p>
        <div className="rounded-xl border border-border/60 bg-background px-3 py-2 text-xs text-muted-foreground mb-3">
          Source checklist snapshot. Use the Customer App production and delivery queues for live operational updates.
        </div>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(CHECKLIST_LABELS).map(([key, label]) => (
            <div
              key={key}
              className={`flex items-center gap-2 p-2.5 rounded-xl border text-left text-xs font-medium transition-colors ${
                checklist[key] ? 'bg-green-50 border-green-300 text-green-800' : 'bg-muted/40 border-border text-muted-foreground'
              }`}
            >
              {checklist[key] ? <CheckCircle className="w-4 h-4 text-green-600 shrink-0" /> : <div className="w-4 h-4 rounded-full border-2 border-border shrink-0" />}
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Workflow Handoff */}
      <div className="bg-card rounded-2xl border border-border/50 p-4 mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Workflow Handoff</p>
        <div className="rounded-xl border border-border/60 bg-background px-3 py-2 text-xs text-muted-foreground mb-3">
          Shopify is bridge visibility here. Continue live order, production, fulfillment, and delivery actions from the Customer App admin queues.
        </div>
        <div className="flex gap-1 mb-3">
          {WORKFLOW_STEPS.map((step, i) => (
            <div key={step.key} className={`h-1.5 flex-1 rounded-full ${i <= currentIdx ? 'bg-primary' : 'bg-border'}`} />
          ))}
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Current source status: <span className="font-semibold text-foreground">{order.production_status?.replace(/_/g, ' ') || 'Not set'}</span>
          {nextStep ? <> · Next expected source stage: <span className="font-semibold text-foreground">{nextStep.label}</span></> : null}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Link
            to={`/admin/orders?order=${encodeURIComponent(orderLookup)}`}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-background px-3 text-xs font-bold text-foreground hover:border-primary/60"
          >
            Order Details
          </Link>
          <Link
            to="/admin/production-queue"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-background px-3 text-xs font-bold text-foreground hover:border-primary/60"
          >
            Production Queue
          </Link>
          <Link
            to={String(order.fulfillment_method || '').toLowerCase().includes('pickup') ? '/admin/pos-orders' : '/admin/delivery-queue'}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-background px-3 text-xs font-bold text-foreground hover:border-primary/60"
          >
            {String(order.fulfillment_method || '').toLowerCase().includes('pickup') ? 'POS / Pickup' : 'Delivery Queue'}
          </Link>
        </div>
        {!nextStep && <div className="text-center text-sm font-semibold text-green-700 bg-green-50 rounded-xl py-3 border border-green-200">✓ Order Complete</div>}
      </div>

      {/* Internal Notes */}
      <div className="bg-card rounded-2xl border border-border/50 p-4 mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Internal Notes</p>
        {order.internal_notes ? (
          <p className="rounded-xl border border-border/60 bg-background p-3 text-xs text-foreground">{order.internal_notes}</p>
        ) : (
          <p className="rounded-xl border border-border/60 bg-background p-3 text-xs text-muted-foreground">No source notes recorded.</p>
        )}
        <Link
          to={`/admin/orders?order=${encodeURIComponent(orderLookup)}`}
          className="mt-3 inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground hover:border-primary/60"
        >
          Open live order notes
        </Link>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <span className="font-medium break-all">{value}</span>
    </div>
  );
}

// ─── Alerts Tab ─────────────────────────────────────────────────────────────

function AlertsTab() {
  const queryClient = useQueryClient();
  const { data: shopifyOps = {}, isLoading } = useShopifyOpsSummary({ refetchInterval: 15000 });
  const alerts = shopifyOps.alerts || [];

  const markRead = (id) => {
    console.warn('[ShopifyDashboard] Alert dismiss is controlled from the source alert workflow:', id);
    queryClient.invalidateQueries({ queryKey: ['admin-shopify-ops-summary'] });
  };

  const unread = alerts.filter(a => !a.is_read);
  const read = alerts.filter(a => a.is_read);

  const SEVERITY_ICON = { critical: XCircle, warning: AlertTriangle, info: CheckCircle };
  const SEVERITY_COLOR = { critical: 'text-red-500', warning: 'text-cyan-500', info: 'text-blue-500' };

  const renderAlert = (alert) => {
    const Icon = SEVERITY_ICON[alert.severity] || CheckCircle;
    return (
      <div key={alert.id} className={`bg-card rounded-xl border p-3 flex gap-3 ${alert.is_read ? 'border-border/30 opacity-60' : 'border-primary/30'}`}>
        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${SEVERITY_COLOR[alert.severity]}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{alert.title}</p>
          <p className="text-xs text-muted-foreground">{alert.message}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{alert.created_date ? format(new Date(alert.created_date), 'MMM d, h:mm a') : ''}</p>
        </div>
        {!alert.is_read && (
          <button onClick={() => markRead(alert.id)} className="text-[10px] text-primary font-semibold shrink-0">Dismiss</button>
        )}
      </div>
    );
  };

  return (
    <div>
      {isLoading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div> : (
        <div className="space-y-2">
          {unread.length > 0 && <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Unread ({unread.length})</p>}
          {unread.map(renderAlert)}
          {read.length > 0 && <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-4 mb-2">Dismissed</p>}
          {read.slice(0, 20).map(renderAlert)}
          {alerts.length === 0 && <p className="text-center text-muted-foreground text-sm py-10">No alerts yet.</p>}
        </div>
      )}
    </div>
  );
}

// ─── Products Tab ─────────────────────────────────────────────────────────────

function ProductsTab() {
  const { data: shopifyOps = {}, isLoading } = useShopifyOpsSummary({ refetchInterval: 60000 });
  const products = shopifyOps.products || [];

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-3">{products.length} products synced from Shopify</p>
      {isLoading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div> : (
        <div className="space-y-2">
          {products.map(p => (
            <div key={p.id} className="bg-card rounded-xl border border-border/50 p-3 flex gap-3">
              {p.image_url ? (
                <img src={p.image_url} alt={p.title} className="w-12 h-12 rounded-lg object-cover shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0 text-lg">🍊</div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{p.title}</p>
                <p className="text-xs text-muted-foreground">{p.product_type} · {p.status}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {p.variants?.map((v, i) => (
                    <span key={i} className="text-[10px] bg-secondary px-1.5 py-0.5 rounded font-mono">
                      {v.sku || v.title} · ${v.price} · {v.inventory_quantity} in stock
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {products.length === 0 && <p className="text-center text-muted-foreground text-sm py-10">No products synced yet. Use Settings → Sync Products.</p>}
        </div>
      )}
    </div>
  );
}

// ─── Reports Tab ─────────────────────────────────────────────────────────────

function ReportsTab() {
  const { data: shopifyOps = {} } = useShopifyOpsSummary({ refetchInterval: 60000 });
  const orders = shopifyOps.orders || [];

  const totalRevenue = orders.reduce((s, o) => s + (o.total_price || 0), 0);
  const avgOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;
  const byChannel = orders.reduce((acc, o) => { acc[o.source_channel] = (acc[o.source_channel] || 0) + 1; return acc; }, {});
  const byStatus = orders.reduce((acc, o) => { acc[o.production_status] = (acc[o.production_status] || 0) + 1; return acc; }, {});
  const canceled = orders.filter(o => o.production_status === 'canceled' || o.production_status === 'refunded').length;
  const subscriptions = orders.filter(o => o.is_subscription).length;
  const posOrders = orders.filter(o => o.is_pos_order).length;

  const StatCard = ({ label, value, sub }) => (
    <div className="bg-card border border-border/50 rounded-xl p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold mt-0.5">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Sales Stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total Orders" value={orders.length} />
        <StatCard label="Total Revenue" value={`$${totalRevenue.toFixed(0)}`} />
        <StatCard label="Avg Order Value" value={`$${avgOrderValue.toFixed(2)}`} />
        <StatCard label="Cancellations" value={canceled} />
        <StatCard label="POS / Event" value={posOrders} />
        <StatCard label="Subscriptions" value={subscriptions} />
      </div>

      <div className="bg-card rounded-2xl border border-border/50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Sales by Channel</p>
        {Object.entries(byChannel).map(([ch, cnt]) => (
          <div key={ch} className="flex items-center justify-between mb-2">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SOURCE_COLORS[ch] || 'bg-muted text-muted-foreground'}`}>{ch}</span>
            <span className="text-sm font-bold">{cnt}</span>
          </div>
        ))}
      </div>

      <div className="bg-card rounded-2xl border border-border/50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Orders by Production Status</p>
        {Object.entries(byStatus).map(([status, cnt]) => (
          <div key={status} className="flex items-center justify-between mb-2">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PROD_STATUS_COLORS[status] || 'bg-muted'}`}>{status?.replace(/_/g, ' ')}</span>
            <span className="text-sm font-bold">{cnt}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

function SettingsTab() {
  const [resyncing, setResyncing] = useState(false);
  const [resyncingProducts, setResyncingProducts] = useState(false);
  const [manualOrderId, setManualOrderId] = useState('');
  const [resyncResult, setResyncResult] = useState(null);
  const adminResyncLocked = true;

  const { data: shopifyOps = {} } = useShopifyOpsSummary({ refetchInterval: 30000 });
  const syncLogs = shopifyOps.sync_logs || [];
  const webhookLogs = shopifyOps.webhook_logs || [];

  const handleResyncOrders = async () => {
    setResyncing(true);
    setResyncResult({
      success: false,
      skipped: true,
      reason: 'shopify_broad_resync_locked',
      message: 'Broad Shopify resync is controlled here. Use exact approved recovery paths only.',
    });
    setResyncing(false);
  };

  const handleResyncProducts = async () => {
    setResyncingProducts(true);
    setResyncResult({
      success: false,
      skipped: true,
      reason: 'shopify_product_resync_locked',
      message: 'Shopify product resync is controlled here. Use exact approved product update paths only.',
    });
    setResyncingProducts(false);
  };

  const handleManualOrderSync = async () => {
    if (!manualOrderId.trim()) return;
    setResyncing(true);
    setResyncResult({
      success: false,
      skipped: true,
      reason: 'shopify_exact_import_locked',
      message: 'Exact Shopify import is locked here. Use the approved POS/order bridge path or a separately approved recovery command.',
      requested_identifier: manualOrderId.trim(),
    });
    setResyncing(false);
  };

  return (
    <div className="space-y-4">
      {/* Actions */}
      <div className="bg-card rounded-2xl border border-border/50 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sync Actions</p>
        <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-800">
          Broad Shopify resync remains disabled. Exact order import is a gated fallback: it requires a server flag and an exact allowlisted Shopify order id, name, or number.
        </div>
        <button onClick={handleResyncOrders} disabled={adminResyncLocked || resyncing}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-nuvira-gradient text-white rounded-xl text-sm font-semibold disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${resyncing ? 'animate-spin' : ''}`} />
          {resyncing ? 'Syncing...' : 'Sync Recent Orders (50)'}
        </button>
        <button onClick={handleResyncProducts} disabled={adminResyncLocked || resyncingProducts}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-secondary text-secondary-foreground rounded-xl text-sm font-semibold disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${resyncingProducts ? 'animate-spin' : ''}`} />
          {resyncingProducts ? 'Syncing...' : 'Sync All Products'}
        </button>
        <div className="flex gap-2">
          <input value={manualOrderId} onChange={e => setManualOrderId(e.target.value)}
            placeholder="Exact order id, #name, or number"
            className="flex-1 h-9 px-3 rounded-lg border border-border bg-secondary/30 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button onClick={handleManualOrderSync} disabled={adminResyncLocked || resyncing || !manualOrderId.trim()}
            className="px-3 h-9 bg-nuvira-gradient text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            Import Locked
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          This does not enable bulk polling. Exact fallback imports are locked here and require a separately approved recovery command.
        </p>
        {resyncResult && (
          <div className={`rounded-xl p-3 text-xs ${resyncResult.success === false ? 'bg-cyan-50 border border-cyan-200' : 'bg-green-50 border border-green-200'}`}>
            <p className={`font-semibold ${resyncResult.success === false ? 'text-cyan-800' : 'text-green-800'}`}>
              {resyncResult.success === false
                ? `Import not run: ${resyncResult.reason || resyncResult.error || 'blocked'}`
                : resyncResult.action
                  ? `Exact import ${resyncResult.action}: ${resyncResult.order_number || manualOrderId}`
                  : `Sync complete: ${resyncResult.synced ?? 0} synced, ${resyncResult.failed ?? 0} failed`}
            </p>
            {resyncResult.message && (
              <p className={resyncResult.success === false ? 'text-cyan-700 mt-1' : 'text-green-700 mt-1'}>
                {resyncResult.message}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Webhook Info */}
      <div className="bg-card rounded-2xl border border-border/50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Webhook Endpoint</p>
        <p className="text-xs text-muted-foreground mb-1">Register this URL in Shopify Admin → Settings → Notifications → Webhooks:</p>
        <code className="text-[10px] bg-secondary px-2 py-1 rounded block break-all font-mono">
          Dashboard → Code → Functions → shopifyWebhookReceiver → copy URL
        </code>
        <p className="text-[10px] text-muted-foreground mt-2">Topics to subscribe: orders/create, orders/updated, orders/cancelled, orders/paid, orders/fulfilled, orders/refunded, products/create, products/update</p>
      </div>

      {/* Sync Logs */}
      <div className="bg-card rounded-2xl border border-border/50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Recent Sync Logs</p>
        <div className="space-y-2">
          {syncLogs.slice(0, 10).map(log => (
            <div key={log.id} className="flex items-center justify-between text-xs">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${log.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{log.status}</span>
              <span className="text-muted-foreground">{log.sync_type} · {log.records_synced} records</span>
              <span className="text-muted-foreground">{log.completed_at ? format(new Date(log.completed_at), 'MMM d h:mm a') : ''}</span>
            </div>
          ))}
          {syncLogs.length === 0 && <p className="text-xs text-muted-foreground">No sync history yet.</p>}
        </div>
      </div>

      {/* Webhook Logs */}
      <div className="bg-card rounded-2xl border border-border/50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Recent Webhook Events</p>
        <div className="space-y-2">
          {webhookLogs.slice(0, 15).map(log => (
            <div key={log.id} className="rounded-lg border border-border/60 bg-secondary/20 px-2.5 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                  log.status === 'processed' ? 'bg-green-100 text-green-700' :
                  log.status === 'duplicate' ? 'bg-gray-100 text-gray-600' :
                  log.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                }`}>{log.status}</span>
                <span className="font-medium truncate">{log.topic}</span>
                <span className="text-muted-foreground shrink-0">#{log.shopify_order_number}</span>
                <span className="text-muted-foreground shrink-0">{log.created_date ? format(new Date(log.created_date), 'h:mm a') : ''}</span>
              </div>
              {(log.description || log.error_message) && (
                <p className={`mt-1 leading-snug ${log.status === 'failed' ? 'text-red-700' : 'text-muted-foreground'}`}>
                  {log.error_message || log.description}
                </p>
              )}
            </div>
          ))}
          {webhookLogs.length === 0 && <p className="text-xs text-muted-foreground">No webhook events yet.</p>}
        </div>
      </div>
    </div>
  );
}
