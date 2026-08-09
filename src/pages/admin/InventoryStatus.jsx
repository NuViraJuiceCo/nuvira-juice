import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { AlertTriangle, ClipboardList, Copy, Download, MapPin, Package, Pencil, RefreshCw, Search, ShoppingCart } from 'lucide-react';
import { AdminStatusLegend, AdminStatusPill } from '@/components/admin/AdminStatusPill';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/admin-access';

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
  if (key === 'demand_based') return 'Demand Based';
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

function isDemandBasedFood(item) {
  return item?.stock_tracking_policy === 'food_make_to_order' || item?.stock_authoritative === false || item?.status === 'demand_based';
}

function stockBasisLabel(item, field) {
  if (isDemandBasedFood(item)) return field === 'stock' ? 'Demand-based' : 'Not tracked';
  return formatQuantity(item?.[field], item?.unit);
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : value.toString();
  return `"${text.replace(/"/g, '""')}"`;
}

function procurementManifest(items = []) {
  if (!Array.isArray(items) || items.length === 0) return 'No tracked-supply procurement needs found.';
  return items.map(item => [
    item.supplier || 'Supplier pending',
    item.ingredient || 'Ingredient pending',
    formatQuantity(item.stock, item.unit),
    formatQuantity(item.reorder_point, item.unit),
    formatQuantity(item.max_stock, item.unit),
    formatQuantity(item.open_po_quantity, item.unit),
    formatQuantity(item.net_suggested_quantity, item.unit),
    sourceLabel(item.source),
  ].join(' | ')).join('\n');
}

function sourceLabel(source) {
  return source === 'customer_app_native' ? 'Native' : 'Source';
}

function procurementCsv(items = []) {
  const header = [
    'supplier',
    'ingredient',
    'category',
    'status',
    'stock',
    'reorder_point',
    'max_stock',
    'unit',
    'open_po_quantity',
    'open_po_numbers',
    'net_suggested_quantity',
    'estimated_cost',
    'stock_tracking_policy',
    'source',
  ];
  const rows = items.map(item => [
    item.supplier || '',
    item.ingredient || '',
    item.category || '',
    item.status || '',
    item.stock ?? '',
    item.reorder_point ?? '',
    item.max_stock ?? '',
    item.unit || '',
    item.open_po_quantity ?? '',
    Array.isArray(item.open_po_numbers) ? item.open_po_numbers.join('; ') : '',
    item.net_suggested_quantity ?? '',
    item.estimated_cost ?? '',
    item.stock_tracking_policy || '',
    item.source || '',
  ]);
  return [header, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
}

function downloadTextFile(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

function InventoryTable({ items, onEdit }) {
  return (
    <div className="hidden sm:block bg-card border border-border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Ingredient</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Category</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Stock Basis</th>
              <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Reorder At</th>
              <th className="hidden lg:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Max Stock</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
              <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Source</th>
              <th className="hidden lg:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Supplier</th>
              <th className="hidden xl:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Location</th>
              <th className="hidden xl:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Last source update</th>
              <th className="w-12 px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id || item.ingredient} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3.5 font-medium text-foreground">{item.ingredient || 'Unnamed item'}</td>
                <td className="px-4 py-3.5 text-muted-foreground">{item.category || 'Uncategorized'}</td>
                <td className="px-4 py-3.5 font-semibold text-foreground">{stockBasisLabel(item, 'stock')}</td>
                <td className="hidden md:table-cell px-4 py-3.5 text-muted-foreground">{stockBasisLabel(item, 'reorder_point')}</td>
                <td className="hidden lg:table-cell px-4 py-3.5 text-muted-foreground">{stockBasisLabel(item, 'max_stock')}</td>
                <td className="px-4 py-3.5"><StatusBadge status={item.status} /></td>
                <td className="hidden md:table-cell px-4 py-3.5 text-muted-foreground">{sourceLabel(item.source)}</td>
                <td className="hidden lg:table-cell px-4 py-3.5 text-muted-foreground truncate">{item.supplier || '-'}</td>
                <td className="hidden xl:table-cell px-4 py-3.5 text-muted-foreground truncate">{item.location || '-'}</td>
                <td className="hidden xl:table-cell px-4 py-3.5 text-muted-foreground">{formatDateTime(item.updated_date) || '-'}</td>
                <td className="px-4 py-3.5 text-right">
                  <button
                    type="button"
                    onClick={() => onEdit(item)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-foreground hover:border-primary/60"
                    aria-label={`Edit ${item.ingredient || 'inventory item'}`}
                    title="Edit inventory item"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InventoryCards({ items, onEdit }) {
  return (
    <div className="sm:hidden space-y-3">
      {items.map(item => (
        <div key={item.id || item.ingredient} className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground text-sm">{item.ingredient || 'Unnamed item'}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {item.category || 'Uncategorized'} · {sourceLabel(item.source)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={item.status} />
              <button
                type="button"
                onClick={() => onEdit(item)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-foreground"
                aria-label={`Edit ${item.ingredient || 'inventory item'}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 py-2 border-t border-b border-border/30">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Stock Basis</p>
              <p className="font-semibold text-sm mt-0.5">{stockBasisLabel(item, 'stock')}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Reorder At</p>
              <p className="font-semibold text-sm mt-0.5">{stockBasisLabel(item, 'reorder_point')}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Max Stock</p>
              <p className="font-semibold text-sm mt-0.5">{stockBasisLabel(item, 'max_stock')}</p>
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
              Last source update: {formatDateTime(item.updated_date)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function InventoryEditor({ item, open, onOpenChange, onSave, pending }) {
  const [form, setForm] = useState(null);

  React.useEffect(() => {
    if (!item || !open) return;
    setForm({
      ingredient: item.ingredient || '',
      unit: item.unit || 'units',
      stock: item.stock ?? '',
      reorder_point: item.reorder_point ?? '',
      max_stock: item.max_stock ?? '',
      cost_per_unit: item.cost_per_unit ?? '',
      supplier: item.supplier || '',
      supplier_packaging_unit: item.supplier_packaging_unit || '',
      supplier_packaging_qty: item.supplier_packaging_qty || '',
      cost_per_supplier_unit: item.cost_per_supplier_unit ?? '',
      location: item.location || '',
      category: item.category || 'Supplies',
    });
  }, [item, open]);

  if (!form) return null;
  const setField = (field, value) => setForm(current => ({ ...current, [field]: value }));

  return (
    <Dialog open={open} onOpenChange={next => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-border bg-card p-0 text-card-foreground">
        <DialogHeader className="border-b border-border bg-secondary/40 px-4 py-4 pr-12 text-left">
          <DialogTitle className="text-base font-black text-foreground">Update Tracked Supply</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Save Customer App stock thresholds for this non-food item. Food and juice ingredients remain demand-based.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4 px-4 py-4"
          onSubmit={event => {
            event.preventDefault();
            onSave(form);
          }}
        >
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground" htmlFor="inventory-item-name">Item</label>
            <input id="inventory-item-name" value={form.ingredient} disabled className="h-10 w-full rounded-lg border border-border bg-muted px-3 text-sm text-foreground opacity-80" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Category
              <select value={form.category} onChange={event => setField('category', event.target.value)} disabled={pending} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium normal-case text-foreground">
                {['Packaging', 'Supplies', 'Other'].map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Unit
              <select value={form.unit} onChange={event => setField('unit', event.target.value)} disabled={pending} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium normal-case text-foreground">
                {['lbs', 'g', 'L', 'mL', 'units', 'cases', 'bottles'].map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              ['stock', 'Current stock'],
              ['reorder_point', 'Reorder at'],
              ['max_stock', 'Target stock'],
            ].map(([field, label]) => (
              <label key={field} className="space-y-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {label}
                <input type="number" min="0" step="any" value={form[field]} onChange={event => setField(field, event.target.value)} disabled={pending} required={field !== 'max_stock'} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium normal-case text-foreground" />
              </label>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Supplier
              <input value={form.supplier} maxLength={160} onChange={event => setField('supplier', event.target.value)} disabled={pending} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium normal-case text-foreground" />
            </label>
            <label className="space-y-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Storage location
              <input value={form.location} maxLength={160} onChange={event => setField('location', event.target.value)} disabled={pending} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium normal-case text-foreground" />
            </label>
            <label className="space-y-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Cost per unit
              <input type="number" min="0" step="0.01" value={form.cost_per_unit} onChange={event => setField('cost_per_unit', event.target.value)} disabled={pending} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium normal-case text-foreground" />
            </label>
            <label className="space-y-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Supplier pack type
              <select value={form.supplier_packaging_unit} onChange={event => setField('supplier_packaging_unit', event.target.value)} disabled={pending} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium normal-case text-foreground">
                <option value="">Not set</option>
                {['case', 'bunch', 'lb', 'kg', 'count', 'box', 'bag', 'other'].map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Supplier pack quantity
              <input value={form.supplier_packaging_qty} maxLength={120} onChange={event => setField('supplier_packaging_qty', event.target.value)} disabled={pending} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium normal-case text-foreground" />
            </label>
            <label className="space-y-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Cost per supplier pack
              <input type="number" min="0" step="0.01" value={form.cost_per_supplier_unit} onChange={event => setField('cost_per_supplier_unit', event.target.value)} disabled={pending} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium normal-case text-foreground" />
            </label>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => onOpenChange(false)} disabled={pending} className="h-10 rounded-lg border border-border bg-background px-4 text-xs font-bold text-foreground disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={pending} className="h-10 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground disabled:opacity-50">{pending ? 'Saving...' : 'Save inventory item'}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProcurementPlan({ items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-4">
        <p className="text-sm font-semibold text-foreground">No tracked-supply procurement needs found</p>
        <p className="text-xs text-muted-foreground mt-1">Food and juice ingredients are demand-based. Low-stock warnings only apply to tracked non-food items like packaging and supplies.</p>
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
        <section key={supplier} className="rounded-xl border border-cyan-200 bg-cyan-50/70 p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-cyan-800 font-semibold">Supplier</p>
              <h2 className="text-sm font-bold text-foreground">{supplier}</h2>
            </div>
            <AdminStatusPill value="procurement_needed" label={`${supplierItems.length} needs`} size="md" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {supplierItems.map(item => (
              <div key={`${item.inventory_item_id || item.ingredient}-${supplier}`} className="rounded-lg border border-cyan-200/70 bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{item.ingredient || 'Ingredient'}</p>
                    <p className="text-xs text-muted-foreground">{item.category || 'Uncategorized'} · {item.unit || 'unit pending'}</p>
                  </div>
                  <AdminStatusPill value={item.status} label={formatStatus(item.status)} size="md" />
                </div>

                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Stock Basis</p>
                    <p className="text-xs font-bold">{stockBasisLabel(item, 'stock')}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Target</p>
                    <p className="text-xs font-bold">{stockBasisLabel(item, item.max_stock !== null && item.max_stock !== undefined ? 'max_stock' : 'reorder_point')}</p>
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
        <p className="text-xs text-muted-foreground mt-1">Draft, ordered, and in-transit source purchase orders will appear here.</p>
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
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [copyMessage, setCopyMessage] = useState(null);
  const [migrationPreview, setMigrationPreview] = useState(null);
  const [editingItem, setEditingItem] = useState(null);

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
    enabled: isAdminUser(user),
    staleTime: 60000,
  });

  const items = data?.items || [];
  const summary = data?.summary || {};
  const procurementPlan = data?.procurement_plan || [];
  const openPurchaseOrders = data?.open_purchase_orders || [];
  const dataSources = data?.data_sources || {};
  const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
  const categoryOptions = useMemo(() => categorySelectOptions(items, categoryFilter), [items, categoryFilter]);
  const procurementExportDate = format(new Date(), 'yyyy-MM-dd');

  const inventoryMigration = useMutation({
    mutationFn: async ({ operation, expectedCount = null }) => {
      const fallback = Math.random().toString(36).slice(2);
      const randomId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallback;
      const res = await base44.functions.invoke('getAdminInventoryStatusSummary', {
        operation,
        request_id: `inventory_cutover_${Date.now()}_${randomId}`,
        expected_count: expectedCount,
        confirm: operation === 'execute_non_food_import',
        limit: 200,
      });
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result;
    },
    onSuccess: async (result) => {
      if (result?.dry_run) {
        setMigrationPreview(result);
        return;
      }
      setMigrationPreview(null);
      setCopyMessage({ type: 'success', text: `${result?.imported_count || 0} non-food inventory records moved into the Customer App.` });
      await queryClient.invalidateQueries({ queryKey: ['admin-inventory-status-summary'] });
    },
  });

  const inventoryItemUpdate = useMutation({
    mutationFn: async (item) => {
      const fallback = Math.random().toString(36).slice(2);
      const randomId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallback;
      const res = await base44.functions.invoke('getAdminInventoryStatusSummary', {
        operation: 'update_native_item',
        item_id: editingItem.id,
        expected_updated_date: editingItem.updated_date || '',
        request_id: `inventory_item_update_${Date.now()}_${randomId}`,
        confirm: true,
        item,
      });
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result;
    },
    onSuccess: async () => {
      setEditingItem(null);
      setCopyMessage({ type: 'success', text: 'Inventory item updated in the Customer App.' });
      await queryClient.invalidateQueries({ queryKey: ['admin-inventory-status-summary'] });
    },
  });

  async function copyProcurementPlan() {
    try {
      await navigator.clipboard.writeText(procurementManifest(procurementPlan));
      setCopyMessage({ type: 'success', text: 'Procurement plan copied. No purchase order was created.' });
    } catch {
      setCopyMessage({ type: 'error', text: 'Unable to copy procurement plan.' });
    }
  }

  function downloadProcurementCsv() {
    downloadTextFile(
      `nuvira-procurement-plan-${procurementExportDate}.csv`,
      procurementCsv(procurementPlan),
      'text/csv'
    );
    setCopyMessage({ type: 'success', text: 'Procurement CSV downloaded. No purchase order was created.' });
  }

  if (!isAdminUser(user)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-10">
      <AdminOpsHeader
        title="Inventory"
        subtitle="Customer App non-food stock and procurement"
        badge="Customer App"
      />

      <div className="px-4 mt-4 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          <StatCard icon={Package} label="Tracked Items" value={summary.total_items ?? 0} />
          <StatCard icon={Package} label="Tracked Supplies" value={summary.stock_tracked_item_count ?? 0} />
          <StatCard icon={AlertTriangle} label="Supply Critical / Out" value={(summary.critical_count ?? 0) + (summary.out_of_stock_count ?? 0)} />
          <StatCard icon={ShoppingCart} label="Supply Needs" value={summary.net_procurement_item_count ?? 0} />
          <StatCard icon={ClipboardList} label="Open POs" value={summary.open_purchase_order_count ?? 0} />
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
            <p className="text-xs font-semibold text-foreground">Inventory view</p>
            <p className="text-[10px] text-muted-foreground">
              Packaging, supplies, merch, and other non-food items are stock-tracked here. Food and juice ingredients are purchased from production demand and are excluded from inventory counts.
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Customer App {dataSources.native_authoritative ? 'is authoritative' : 'cutover is pending'} · Food rows hidden {dataSources.food_inventory_rows_hidden ? 'yes' : 'no'}
            </p>
            <AdminStatusLegend className="mt-2" />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={copyProcurementPlan}
              disabled={isLoading}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground disabled:opacity-60"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy Plan
            </button>
            {!dataSources.native_authoritative && Number(dataSources.non_food_import_candidate_count || 0) > 0 && (
              <button
                type="button"
                onClick={() => inventoryMigration.mutate({ operation: 'preview_non_food_import' })}
                disabled={inventoryMigration.isPending}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                <Download className="h-3.5 w-3.5" />
                Review cutover
              </button>
            )}
            <button
              type="button"
              onClick={downloadProcurementCsv}
              disabled={isLoading}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground disabled:opacity-60"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
            <RefreshCw className={`w-4 h-4 text-primary ${isFetching ? 'animate-spin' : ''}`} />
          </div>
        </div>

        {migrationPreview && (
          <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-bold text-foreground">Non-food inventory cutover</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {migrationPreview.candidate_count} validated records are ready. This creates Customer App inventory records only; it does not change the historical source, food demand, orders, notifications, or providers.
                </p>
              </div>
              <button
                type="button"
                disabled={inventoryMigration.isPending || migrationPreview.blocker_count > 0}
                onClick={() => {
                  if (!window.confirm(`Import ${migrationPreview.candidate_count} non-food inventory records into the Customer App?`)) return;
                  inventoryMigration.mutate({ operation: 'execute_non_food_import', expectedCount: migrationPreview.candidate_count });
                }}
                className="h-10 shrink-0 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground disabled:opacity-50"
              >
                {inventoryMigration.isPending ? 'Importing...' : 'Import records'}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(migrationPreview.candidates || []).map(item => (
                <span key={item.ingredient} className="rounded-full border border-border bg-background px-2 py-1 text-[10px] font-semibold text-foreground">
                  {item.ingredient}
                </span>
              ))}
            </div>
          </section>
        )}

        {inventoryMigration.isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {inventoryMigration.error?.message || 'Inventory cutover could not be completed.'}
          </div>
        )}

        {copyMessage && (
          <div className={`rounded-lg border p-3 text-xs ${
            copyMessage.type === 'error'
              ? 'border-destructive/30 bg-destructive/5 text-destructive'
              : 'border-green-200 bg-green-50 text-green-800'
          }`}>
            {copyMessage.text}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-800">
            {warnings.includes('hub_inventory_status_service_not_configured') || warnings.some(warning => warning?.startsWith?.('hub_inventory_status_unavailable'))
              ? 'Historical cutover verification is unavailable. Customer App inventory remains available.'
              : 'Inventory status returned a migration warning. Review the Customer App records before making procurement decisions.'}
          </div>
        )}

        {inventoryItemUpdate.isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {inventoryItemUpdate.error?.message || 'Inventory item could not be updated.'}
          </div>
        )}

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
                <p className="text-xs text-muted-foreground">Supplier-grouped buy list for tracked non-food thresholds and open PO coverage. Food purchasing should come from production demand, not standing stock counts.</p>
              </div>
              <ProcurementPlan items={procurementPlan} />
            </section>

            <section className="space-y-2">
              <div>
                <h2 className="text-sm font-bold text-foreground">Open Purchase Orders</h2>
                <p className="text-xs text-muted-foreground">Source draft, ordered, and in-transit purchase orders for procurement context.</p>
              </div>
              <OpenPurchaseOrders purchaseOrders={openPurchaseOrders} />
            </section>

            {data?.truncated && (
              <p className="text-xs text-cyan-700 bg-cyan-50 border border-cyan-200 rounded-lg p-3">
                Results are capped. Narrow the search or filters for a more complete view.
              </p>
            )}
            <InventoryTable items={items} onEdit={setEditingItem} />
            <InventoryCards items={items} onEdit={setEditingItem} />
          </div>
        )}
      </div>

      <InventoryEditor
        item={editingItem}
        open={Boolean(editingItem)}
        onOpenChange={open => !open && setEditingItem(null)}
        onSave={item => inventoryItemUpdate.mutate(item)}
        pending={inventoryItemUpdate.isPending}
      />
    </div>
  );
}
