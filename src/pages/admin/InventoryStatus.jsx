import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { AlertTriangle, ClipboardList, MapPin, Package, RefreshCw, Search, ShoppingCart, TrendingDown } from 'lucide-react';
import { AdminStatusLegend, AdminStatusPill } from '@/components/admin/AdminStatusPill';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

function formatDateTime(value) {
  if (!value) return null;
  try {
    return format(new Date(value), 'MMM d, yyyy - h:mm a');
  } catch {
    return value;
  }
}

function formatStatus(value) {
  const key = (value || '').toString();
  if (key === 'ok') return 'OK';
  if (key === 'out_of_stock') return 'Out of Stock';
  return key
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ') || 'Not set';
}

function categorySelectOptions(items, selectedCategory) {
  const categories = new Set(items.map(item => item.category).filter(Boolean));
  if (selectedCategory && selectedCategory !== 'all') categories.add(selectedCategory);
  return [...categories].sort((a, b) => a.localeCompare(b));
}

function formatQuantity(value, unit) {
  if (value === null || value === undefined) return '-';
  return unit ? `${value} ${unit}` : value;
}

function StatCard({ icon: Icon, label, value, sublabel, isRefreshing }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-3">
      {Icon && <Icon className={`w-4 h-4 text-primary mb-1 ${isRefreshing ? 'animate-spin' : ''}`} />}
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
    </div>
  );
}

function StatusBadge({ status }) {
  return <AdminStatusPill value={status} label={formatStatus(status)} size="md" />;
}

function InventoryTable({ items }) {
  return (
    <div className="hidden sm:block bg-card border border-border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Ingredient</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Category</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Stock</th>
              <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Reorder At</th>
              <th className="hidden lg:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Max Stock</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
              <th className="hidden lg:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Supplier</th>
              <th className="hidden xl:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Location</th>
              <th className="hidden xl:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Last Hub update</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id || item.ingredient} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3.5 font-medium text-foreground">{item.ingredient || 'Unnamed item'}</td>
                <td className="px-4 py-3.5 text-muted-foreground">{item.category || 'Uncategorized'}</td>
                <td className="px-4 py-3.5 font-semibold text-foreground">{formatQuantity(item.stock, item.unit)}</td>
                <td className="hidden md:table-cell px-4 py-3.5 text-muted-foreground">{formatQuantity(item.reorder_point, item.unit)}</td>
                <td className="hidden lg:table-cell px-4 py-3.5 text-muted-foreground">{formatQuantity(item.max_stock, item.unit)}</td>
                <td className="px-4 py-3.5"><StatusBadge status={item.status} /></td>
                <td className="hidden lg:table-cell px-4 py-3.5 text-muted-foreground truncate">{item.supplier || '-'}</td>
                <td className="hidden xl:table-cell px-4 py-3.5 text-muted-foreground truncate">{item.location || '-'}</td>
                <td className="hidden xl:table-cell px-4 py-3.5 text-muted-foreground">{formatDateTime(item.updated_date) || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InventoryCards({ items }) {
  return (
    <div className="sm:hidden space-y-3">
      {items.map(item => (
        <div key={item.id || item.ingredient} className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground text-sm">{item.ingredient || 'Unnamed item'}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{item.category || 'Uncategorized'}</p>
            </div>
            <StatusBadge status={item.status} />
          </div>

          <div className="grid grid-cols-3 gap-2 py-2 border-t border-b border-border/30">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Stock</p>
              <p className="font-semibold text-sm mt-0.5">{formatQuantity(item.stock, item.unit)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Reorder At</p>
              <p className="font-semibold text-sm mt-0.5">{formatQuantity(item.reorder_point, item.unit)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Max Stock</p>
              <p className="font-semibold text-sm mt-0.5">{formatQuantity(item.max_stock, item.unit)}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <div className="rounded-lg border border-border/50 bg-background p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Supplier</p>
              <p className="text-xs font-medium mt-1 truncate">{item.supplier || '-'}</p>
            </div>
            <div className="rounded-lg border border-border/50 bg-background p-2">
              <div className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Location</p>
              </div>
              <p className="text-xs font-medium mt-1">{item.location || '-'}</p>
            </div>
          </div>

          {item.updated_date && (
            <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
              Last Hub update: {formatDateTime(item.updated_date)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function ProcurementPlan({ items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-4">
        <p className="text-sm font-semibold text-foreground">No procurement needs found</p>
        <p className="text-xs text-muted-foreground mt-1">Hub inventory is not reporting low, critical, or out-of-stock items for the current filters.</p>
      </div>
    );
  }

  const bySupplier = items.reduce((groups, item) => {
    const supplier = item.supplier || 'Supplier pending';
    if (!groups[supplier]) groups[supplier] = [];
    groups[supplier].push(item);
    return groups;
  }, {});

  return (
    <div className="space-y-3">
      {Object.entries(bySupplier).map(([supplier, supplierItems]) => (
        <section key={supplier} className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-amber-800 font-semibold">Supplier</p>
              <h2 className="text-sm font-bold text-foreground">{supplier}</h2>
            </div>
            <AdminStatusPill value="procurement_needed" label={`${supplierItems.length} needs`} size="md" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {supplierItems.map(item => (
              <div key={`${item.inventory_item_id || item.ingredient}-${supplier}`} className="rounded-lg border border-amber-200/70 bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{item.ingredient || 'Ingredient'}</p>
                    <p className="text-xs text-muted-foreground">{item.category || 'Uncategorized'} · {item.unit || 'unit pending'}</p>
                  </div>
                  <AdminStatusPill value={item.status} label={formatStatus(item.status)} size="md" />
                </div>

                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Stock</p>
                    <p className="text-xs font-bold">{formatQuantity(item.stock, item.unit)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Target</p>
                    <p className="text-xs font-bold">{formatQuantity(item.max_stock ?? item.reorder_point, item.unit)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Net Need</p>
                    <p className="text-xs font-bold">{formatQuantity(item.net_suggested_quantity, item.unit)}</p>
                  </div>
                </div>

                <div className="mt-3 rounded-md bg-background p-2 text-xs text-muted-foreground">
                  <p>
                    Open PO coverage: {formatQuantity(item.open_po_quantity, item.unit)}
                    {item.open_po_numbers?.length ? ` · ${item.open_po_numbers.join(', ')}` : ''}
                  </p>
                  {(item.supplier_packaging_unit || item.supplier_packaging_qty) && (
                    <p className="mt-1">Supplier pack: {[item.supplier_packaging_qty, item.supplier_packaging_unit].filter(Boolean).join(' / ')}</p>
                  )}
                  {item.estimated_cost !== null && item.estimated_cost !== undefined && (
                    <p className="mt-1">Estimated remaining cost: ${Number(item.estimated_cost).toFixed(2)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function OpenPurchaseOrders({ purchaseOrders }) {
  if (!Array.isArray(purchaseOrders) || purchaseOrders.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-4">
        <p className="text-sm font-semibold text-foreground">No open purchase orders returned</p>
        <p className="text-xs text-muted-foreground mt-1">Draft, ordered, and in-transit Hub purchase orders will appear here.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {purchaseOrders.map(po => (
        <div key={po.id || po.po_number} className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground truncate">{po.po_number || 'PO number pending'}</p>
              <p className="text-xs text-muted-foreground">{po.supplier || 'Supplier pending'}</p>
            </div>
            <AdminStatusPill value={po.status} label={po.status || 'Status pending'} size="md" />
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Items</p>
              <p className="font-bold">{po.item_count ?? po.items?.length ?? 0}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Expected</p>
              <p className="font-bold">{po.expected_date ? formatDateTime(po.expected_date)?.split(' - ')[0] : '-'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total</p>
              <p className="font-bold">{po.total_amount === null || po.total_amount === undefined ? '-' : `$${Number(po.total_amount).toFixed(2)}`}</p>
            </div>
          </div>

          {Array.isArray(po.items) && po.items.length > 0 && (
            <div className="space-y-1">
              {po.items.slice(0, 5).map(item => (
                <div key={`${po.id || po.po_number}-${item.ingredient}-${item.quantity}`} className="flex items-center justify-between gap-2 rounded-md bg-background px-2 py-1 text-xs">
                  <span className="font-medium truncate">{item.ingredient}</span>
                  <span className="text-muted-foreground shrink-0">{formatQuantity(item.quantity, item.unit)}</span>
                </div>
              ))}
              {po.items.length > 5 && <p className="text-[10px] text-muted-foreground">Showing 5 of {po.items.length} items.</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function InventoryStatus() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['admin-inventory-status-summary', search, statusFilter, categoryFilter],
    queryFn: async () => {
      const payload = {
        limit: 200,
      };
      if (search.trim()) payload.search = search.trim();
      if (statusFilter !== 'all') payload.status = statusFilter;
      if (categoryFilter !== 'all') payload.category = categoryFilter;

      const res = await base44.functions.invoke('getAdminInventoryStatusSummary', payload);
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result || { summary: {}, items: [] };
    },
    enabled: user?.role === 'admin',
    staleTime: 60000,
  });

  const items = data?.items || [];
  const summary = data?.summary || {};
  const procurementPlan = data?.procurement_plan || [];
  const openPurchaseOrders = data?.open_purchase_orders || [];
  const categoryOptions = useMemo(() => categorySelectOptions(items, categoryFilter), [items, categoryFilter]);

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-10">
      <AdminOpsHeader
        title="Inventory"
        subtitle="Read-only Hub inventory status"
        badge="Read-only"
      />

      <div className="px-4 mt-4 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
          <StatCard icon={Package} label="Total Items" value={summary.total_items ?? 0} />
          <StatCard icon={TrendingDown} label="Low Stock" value={summary.low_stock_count ?? 0} />
          <StatCard icon={AlertTriangle} label="Critical / Out" value={(summary.critical_count ?? 0) + (summary.out_of_stock_count ?? 0)} />
          <StatCard icon={ShoppingCart} label="Procurement Needs" value={summary.net_procurement_item_count ?? 0} />
          <StatCard icon={ClipboardList} label="Open POs" value={summary.open_purchase_order_count ?? 0} />
          <StatCard icon={RefreshCw} label="Categories" value={summary.category_count ?? 0} isRefreshing={isFetching} />
        </div>

        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              className="w-full h-10 rounded-lg border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Search ingredients, categories, suppliers, or locations..."
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
              <select
                value={statusFilter}
                onChange={event => setStatusFilter(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Statuses</option>
                <option value="ok">OK</option>
                <option value="low">Low</option>
                <option value="critical">Critical</option>
                <option value="out_of_stock">Out of Stock</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Category</span>
              <select
                value={categoryFilter}
                onChange={event => setCategoryFilter(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Categories</option>
                {categoryOptions.map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-foreground">Hub Inventory view</p>
            <p className="text-[10px] text-muted-foreground">Read-only Hub data · Procurement plan only · No stock deduction or purchase orders are created here.</p>
            <AdminStatusLegend className="mt-2" />
          </div>
          <RefreshCw className={`w-4 h-4 text-primary ${isFetching ? 'animate-spin' : ''}`} />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load inventory status summary</p>
            <p className="text-xs text-muted-foreground mt-1">{error?.message || 'Try again later.'}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No inventory items found</p>
            <p className="text-xs text-muted-foreground mt-1">Try another search, status, or category filter.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <section className="space-y-2">
              <div>
                <h2 className="text-sm font-bold text-foreground">Procurement Plan</h2>
                <p className="text-xs text-muted-foreground">Supplier-grouped buy list from Hub inventory thresholds and open PO coverage. This is make-to-order planning, not inventory deduction.</p>
              </div>
              <ProcurementPlan items={procurementPlan} />
            </section>

            <section className="space-y-2">
              <div>
                <h2 className="text-sm font-bold text-foreground">Open Purchase Orders</h2>
                <p className="text-xs text-muted-foreground">Hub draft, ordered, and in-transit purchase orders for procurement context.</p>
              </div>
              <OpenPurchaseOrders purchaseOrders={openPurchaseOrders} />
            </section>

            {data?.truncated && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Results are capped. Narrow the search or filters for a more complete view.
              </p>
            )}
            <InventoryTable items={items} />
            <InventoryCards items={items} />
          </div>
        )}
      </div>
    </div>
  );
}
