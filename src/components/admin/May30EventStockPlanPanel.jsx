import React from 'react';
import { CalendarDays, PackageCheck, ShieldCheck, Store } from 'lucide-react';
import { AdminStatusPill } from '@/components/admin/AdminStatusPill';
import { MAY30_EVENT_STOCK_PLAN, formatEventDate } from '@/lib/may30EventStockPlan';

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

export default function May30EventStockPlanPanel({ includedInPlanning = false }) {
  return (
    <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Store className="h-4 w-4 text-emerald-700" />
            <h2 className="text-sm font-black text-emerald-950">July 11 POS event stock plan</h2>
            <AdminStatusPill value="pos_event_stock_plan" label="Event stock" tone="source" size="md" />
            <AdminStatusPill
              value={includedInPlanning ? 'included' : 'watch'}
              label={includedInPlanning ? 'Included in planning range' : 'Choose July 11 to include'}
              tone={includedInPlanning ? 'success' : 'warning'}
              size="md"
            />
          </div>
          <p className="mt-1 text-xs font-medium text-emerald-900">
            Staged inventory target for Shopify POS sales. Goal: {MAY30_EVENT_STOCK_PLAN.target.toLowerCase()}.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right">
          <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Date</p>
            <p className="text-xs font-black text-emerald-950">{formatEventDate()}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Units</p>
            <p className="text-xs font-black text-emerald-950">{formatNumber(MAY30_EVENT_STOCK_PLAN.totalUnits)}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {MAY30_EVENT_STOCK_PLAN.items.map(item => (
          <div key={item.productName} className="rounded-lg border border-emerald-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <PackageCheck className="h-4 w-4 text-emerald-700" />
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-900">
                x{formatNumber(item.quantity)}
              </span>
            </div>
            <p className="mt-2 text-sm font-black text-emerald-950">{item.productName}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">{item.category}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <div className="flex items-start gap-2 rounded-lg border border-cyan-200 bg-cyan-50 p-3">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700" />
          <p className="text-xs font-semibold text-cyan-900">
            Reconcile after the events: staged units minus Shopify POS sold units equals expected return count.
          </p>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
          <p className="text-xs font-semibold text-sky-900">
            Production and procurement visibility only. No automatic stock deduction, purchase order, or customer notification.
          </p>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3">
          <Store className="mt-0.5 h-4 w-4 shrink-0 text-violet-700" />
          <p className="text-xs font-semibold text-violet-900">
            These are not customer orders. They are planned event stock for tomorrow's Shopify POS sales.
          </p>
        </div>
      </div>
    </section>
  );
}
