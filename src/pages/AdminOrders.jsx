import React, { useEffect, useState, useMemo } from 'react';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { AdminStatusLegend, AdminStatusPill } from '@/components/admin/AdminStatusPill';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/admin-access';
import { format } from 'date-fns';
import { CalendarDays, ChevronRight, ChevronDown, DollarSign, MapPin, Search, ShieldCheck } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { usePageVisibility } from '@/lib/usePageVisibility';

const DELIVERY_STAGES = [
  { key: 'order_received', label: 'Order Received' },
  { key: 'scheduled_for_juicing', label: 'Awaiting Production' },
  { key: 'in_production', label: 'In Production' },
  { key: 'bottled_packed', label: 'Bottled & Packed' },
  { key: 'out_for_delivery', label: 'Out for Delivery' },
  { key: 'arriving_soon', label: 'Arriving Soon' },
  { key: 'delivered', label: 'Delivered' },
];

const PICKUP_STAGES = [
  { key: 'order_received', label: 'Order Received' },
  { key: 'scheduled_for_juicing', label: 'Awaiting Production' },
  { key: 'in_production', label: 'In Production' },
  { key: 'bottled_packed', label: 'Bottled & Packed' },
  { key: 'ready_for_pickup', label: 'Ready for Pickup' },
  { key: 'picked_up', label: 'Picked Up' },
];

const ACTIVE_STATUSES = ['active', 'order_received', 'scheduled_for_juicing', 'in_production', 'bottled_packed', 'out_for_delivery', 'arriving_soon', 'ready_for_pickup'];
const ADMIN_ORDER_LIFECYCLE_READ_MODEL_MODE = 'ADMIN_ORDER_LIFECYCLE';
const ADMIN_ORDER_LIFECYCLE_READ_MODEL_VERSION = 'g48e_admin_order_lifecycle_v1';
const ADMIN_ORDER_LIST_COMPACT_RESPONSE_MODE = 'ADMIN_ORDER_LIST_COMPACT';
const ADMIN_ORDER_LIST_COMPACT_CONTRACT = 'g48e_admin_order_list_compact_v1';

// Orders that are NOT operational — never show in active/completed views
function isAbandonedOrUnpaid(o) {
  if (
    o.is_hub_order &&
    !['pending_payment', 'cancelled', 'refunded'].includes(o.status) &&
    !['pending', 'unpaid', 'requires_payment_method'].includes(o.payment_status) &&
    !['pending', 'unpaid'].includes(o.financial_status)
  ) {
    return false;
  }

  return (
    o.status === 'pending_payment' ||
    o.is_abandoned_checkout === true ||
    (!o.payment_captured && o.payment_status !== 'paid' && o.financial_status !== 'paid')
  );
}

// Parse YYYY-MM-DD as local date (avoids UTC midnight → previous day in CDT)
function parseLocalDate(str) {
  if (!str) return new Date();
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}


function hasValidAdminOrderLifecycleReadModel(data) {
  const model = data?.admin_order_lifecycle_read_model;
  return data?.admin_order_lifecycle_read_model_available === true &&
    data?.admin_order_lifecycle_read_model_enabled === true &&
    data?.admin_order_lifecycle_read_model_version === ADMIN_ORDER_LIFECYCLE_READ_MODEL_VERSION &&
    model?.read_model_available === true &&
    model?.read_model_enabled === true &&
    model?.read_model_version === ADMIN_ORDER_LIFECYCLE_READ_MODEL_VERSION &&
    model?.summary &&
    typeof model.summary === 'object' &&
    Array.isArray(model?.rows);
}

function unwrapFunctionData(response, fallback = {}) {
  const data = response?.data ?? response ?? fallback;
  if (typeof data !== 'string') return data || fallback;
  try {
    return JSON.parse(data);
  } catch {
    throw new Error('Admin order response was not parseable. Use the compact admin-order list contract before publishing this page.');
  }
}

function hasValidAdminOrderListCompactResponse(data) {
  return data?.success === true &&
    data?.response_contract === ADMIN_ORDER_LIST_COMPACT_CONTRACT &&
    Array.isArray(data?.orders) &&
    data?.writes_performed === false;
}

function AdminOrderLifecycleReadModelPanel({ model }) {
  const summary = model?.summary || {};
  const classificationCounts = Object.entries(model?.classification_counts || {}).slice(0, 5);
  return (
    <section className="px-4 mt-4">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/30">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-700 dark:text-blue-300" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-blue-900 dark:text-blue-100">Admin order lifecycle read model</p>
            <p className="mt-0.5 text-xs font-medium text-blue-900/80 dark:text-blue-100/80">
              Backend-authoritative read model only. It does not enable order, payment, refund, fulfillment, delivery, notification, repair, replay, or source write actions.
            </p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-blue-200 bg-white/70 p-2 dark:border-blue-900/70 dark:bg-blue-950/40">
            <p className="text-lg font-black text-blue-950 dark:text-blue-100">{summary.complete_native_chain_count ?? 0}</p>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-800 dark:text-blue-200">Complete chains</p>
          </div>
          <div className="rounded-xl border border-blue-200 bg-white/70 p-2 dark:border-blue-900/70 dark:bg-blue-950/40">
            <p className="text-lg font-black text-blue-950 dark:text-blue-100">{summary.hub_only_valid_count ?? 0}</p>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-800 dark:text-blue-200">Source-only valid</p>
          </div>
          <div className="rounded-xl border border-blue-200 bg-white/70 p-2 dark:border-blue-900/70 dark:bg-blue-950/40">
            <p className="text-lg font-black text-blue-950 dark:text-blue-100">{summary.fallback_required_count ?? 0}</p>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-800 dark:text-blue-200">Fallback</p>
          </div>
          <div className="rounded-xl border border-blue-200 bg-white/70 p-2 dark:border-blue-900/70 dark:bg-blue-950/40">
            <p className="text-lg font-black text-blue-950 dark:text-blue-100">{summary.review_hold_count ?? 0}</p>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-800 dark:text-blue-200">Review holds</p>
          </div>
        </div>
        {classificationCounts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {classificationCounts.map(([classification, count]) => (
              <span key={classification} className="rounded-full border border-blue-200 bg-white/80 px-2 py-1 text-[10px] font-bold text-blue-900 dark:border-blue-900/70 dark:bg-blue-950/50 dark:text-blue-100">
                {formatStatusLabel(classification)}: {count}
              </span>
            ))}
          </div>
        )}
        <p className="mt-2 text-[10px] font-medium text-blue-900/80 dark:text-blue-100/80">
          Source fallback remains active. Customer App Order identity remains canonical. Read readiness does not imply write readiness.
        </p>
      </div>
    </section>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-24 shrink-0 pt-0.5">{label}</span>
      <span className="text-xs text-foreground flex-1">{value}</span>
    </div>
  );
}

function formatStatusLabel(value) {
  if (!value) return null;
  return value
    .toString()
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function normalizedLower(value) {
  return (value || '').toString().trim().toLowerCase();
}

function sourceDisplayText(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\bHub\b/g, 'Source').replace(/\bhub\b/g, 'source');
}

function orderKey(order) {
  return (order?.order_number || order?.id || '').toString();
}

function normalizeOrderStage(status) {
  if (status === 'active') return 'order_received';
  return status;
}

function formatDateOnly(value) {
  if (!value) return null;
  try {
    return format(parseLocalDate(value), 'MMM d, yyyy');
  } catch {
    return value;
  }
}

function formatDateTime(value) {
  if (!value) return null;
  try {
    return format(new Date(value), 'MMM d, yyyy - h:mm a');
  } catch {
    return value;
  }
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

function hasRecordedValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function itemSummary(items = []) {
  if (!Array.isArray(items) || items.length === 0) return 'Items pending';
  return items
    .slice(0, 2)
    .map(item => {
      const quantity = Number(item.quantity || item.qty || 1);
      const name = item.title || item.name || item.product_name || item.variant_title || 'Item';
      return `${quantity}x ${name}`;
    })
    .join(' · ') + (items.length > 2 ? ` +${items.length - 2} more` : '');
}

function _todayIsoDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const localDate = new Date(now.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 10);
}

function upcomingIsoDates(dayCount = 14) {
  const dates = [];
  const start = new Date();
  for (let index = 0; index < dayCount; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - offset * 60 * 1000);
    dates.push(localDate.toISOString().slice(0, 10));
  }
  return dates;
}

function itemsFromSummary(summary) {
  if (!summary || typeof summary !== 'string') return [];
  return summary
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const match = part.match(/^(\d+(?:\.\d+)?)x\s+(.+)$/i);
      return {
        quantity: match ? Number(match[1]) : 1,
        title: match ? match[2].trim() : part,
        price: 0,
      };
    });
}

function AuditInfoRow({ label, value, formatter, missing = 'Not recorded' }) {
  const hasValue = hasRecordedValue(value);
  const displayValue = hasValue && formatter ? formatter(value) : value;
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/50 bg-background/60 px-3 py-2">
      <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`max-w-[65%] text-right text-xs font-semibold ${hasValue ? 'text-foreground' : 'text-muted-foreground italic'}`}>
        {hasValue ? displayValue : missing}
      </span>
    </div>
  );
}

function PricingBreakdownPanel({ order }) {
  const items = Array.isArray(order.items) ? order.items : [];
  const tax = numericValue(order.total_tax);
  const discounts = numericValue(order.total_discounts);
  const total = numericValue(order.total);
  const pricedItems = items.filter(item => numericValue(item.price) !== null);
  const computedItemsSubtotal = pricedItems.length === items.length && items.length > 0
    ? items.reduce((sum, item) => sum + (numericValue(item.price) || 0) * (numericValue(item.quantity) || 1), 0)
    : null;
  const rawSubtotal = numericValue(order.subtotal);
  const subtotalLooksMissing = rawSubtotal === 0 && computedItemsSubtotal !== null && computedItemsSubtotal > 0 && total !== null && total > 0;
  const subtotal = subtotalLooksMissing ? null : rawSubtotal;
  const rawDeliveryFee = numericValue(order.delivery_fee);
  const deliveryGapFromLineItems = computedItemsSubtotal !== null && total !== null
    ? total - computedItemsSubtotal - (tax || 0) + (discounts || 0)
    : null;
  const deliveryFeeLooksMissing = rawDeliveryFee === 0 && deliveryGapFromLineItems !== null && deliveryGapFromLineItems > 0.009;
  const deliveryFee = deliveryFeeLooksMissing ? null : rawDeliveryFee;
  const comparableSubtotal = subtotal ?? computedItemsSubtotal;
  const expectedTotal = comparableSubtotal !== null && total !== null
    ? comparableSubtotal + (deliveryFee || 0) + (tax || 0) - (discounts || 0)
    : null;
  const reconciles = expectedTotal !== null && Math.abs(expectedTotal - total) < 0.01;
  const unreconciledDifference = expectedTotal !== null && total !== null && !reconciles ? total - expectedTotal : null;

  return (
    <section className="rounded-xl border border-border/60 bg-background/70 p-3 space-y-3">
      <SectionLabel
        title="Pricing Breakdown"
        description="Stored customer-facing pricing fields used to audit item subtotal, delivery charged, and order total."
        badge={reconciles ? 'Reconciled' : 'Review'}
      />
      <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
        <div className="grid grid-cols-[1fr_3.25rem_4.5rem_4.5rem] gap-2 border-b border-border/50 bg-muted/40 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-muted-foreground">
          <span>Item</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Unit</span>
          <span className="text-right">Line</span>
        </div>
        {items.length > 0 ? items.map((item, index) => {
          const quantity = numericValue(item.quantity) || 1;
          const unit = numericValue(item.price);
          const line = unit !== null ? unit * quantity : null;
          return (
            <div key={`${item.title || item.product_name || 'item'}-${index}`} className="grid grid-cols-[1fr_3.25rem_4.5rem_4.5rem] gap-2 border-b border-border/40 px-3 py-2 text-xs last:border-b-0">
              <span className="min-w-0 break-words font-semibold text-foreground">{item.title || item.product_name || item.name || 'Item'}</span>
              <span className="text-right text-muted-foreground">{quantity}</span>
              <span className="text-right text-muted-foreground">{unit !== null ? formatCurrency(unit) : '—'}</span>
              <span className="text-right font-semibold text-foreground">{line !== null ? formatCurrency(line) : '—'}</span>
            </div>
          );
        }) : (
          <div className="px-3 py-3 text-xs font-medium italic text-muted-foreground">No item rows recorded</div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <AuditInfoRow label="Line item sum" value={computedItemsSubtotal} formatter={formatCurrency} />
        <AuditInfoRow label="Item subtotal" value={subtotal} formatter={formatCurrency} />
        <AuditInfoRow label="Delivery charged" value={deliveryFee} formatter={formatCurrency} />
        <AuditInfoRow label="Tax" value={tax} formatter={formatCurrency} />
        <AuditInfoRow label="Discounts" value={discounts} formatter={formatCurrency} />
        <AuditInfoRow label="Order total" value={total} formatter={formatCurrency} />
        <AuditInfoRow label="Expected total" value={expectedTotal} formatter={formatCurrency} />
        <AuditInfoRow label="Unreconciled difference" value={unreconciledDifference} formatter={formatCurrency} missing="None" />
      </div>
      <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
        reconciles
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/20 dark:text-emerald-100'
          : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/20 dark:text-amber-100'
      }`}>
        <DollarSign className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          {reconciles
            ? 'Stored pricing fields reconcile to the recorded order total.'
            : 'Pricing fields are incomplete or do not fully reconcile. Use the recorded total and payment source as the source of truth before any adjustment.'}
        </p>
      </div>
    </section>
  );
}

function DeliveryRateContextPanel({ order }) {
  const context = order.delivery_rate_context || {};
  const deliveryFee = hasRecordedValue(context.delivery_fee) ? context.delivery_fee : order.delivery_fee;
  const deliveryZone = context.delivery_zone_name || context.delivery_zone_key;

  return (
    <section className="rounded-xl border border-border/60 bg-background/70 p-3 space-y-3">
      <SectionLabel
        title="Delivery Rate Context"
        description="Recorded scheduling, delivery, and zone fields available for this order."
        badge="Audit"
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <AuditInfoRow label="Fulfillment method" value={context.fulfillment_method || order.fulfillment_type} formatter={formatStatusLabel} />
        <AuditInfoRow label="Delivery fee" value={deliveryFee} formatter={formatCurrency} />
        <AuditInfoRow label="Delivery zone" value={deliveryZone} formatter={formatStatusLabel} />
        <AuditInfoRow label="Zone type" value={context.delivery_zone_type} formatter={formatStatusLabel} />
        <AuditInfoRow label="Minimum order" value={context.minimum_order} formatter={formatCurrency} />
        <AuditInfoRow label="Distance" value={context.distance_miles} formatter={value => `${value} mi`} />
        <AuditInfoRow label="Drive time" value={context.drive_time_minutes} formatter={value => `${value} min`} />
        <AuditInfoRow label="Approval status" value={context.approval_status} formatter={formatStatusLabel} />
        <AuditInfoRow label="Requested delivery" value={order.requested_delivery_date} formatter={formatDateOnly} />
        <AuditInfoRow label="Selected delivery" value={order.selected_delivery_date} formatter={formatDateOnly} />
        <AuditInfoRow label="Assigned delivery" value={order.assigned_delivery_date || order.estimated_delivery_date} formatter={formatDateOnly} />
        <AuditInfoRow label="Production date" value={order.production_date} formatter={formatDateOnly} />
        <AuditInfoRow label="Delivery window" value={order.delivery_window_label} />
        <AuditInfoRow label="Schedule source" value={context.schedule_source} formatter={formatStatusLabel} />
      </div>
      <div className="flex items-start gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-medium text-cyan-900 dark:border-cyan-500/40 dark:bg-cyan-950/20 dark:text-cyan-100">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="break-words">
          {context.delivery_area || order.delivery_address || 'Delivery area not recorded on this row.'}
        </p>
      </div>
    </section>
  );
}

function mapDeliveryStopToAdminOrder(stop) {
  if (!stop?.order_number) return null;
  const status = ['delivered', 'completed', 'fulfilled'].includes((stop.task_status || stop.delivery_status || '').toString().toLowerCase())
    ? 'delivered'
    : 'order_received';

  return {
    id: `native_delivery_fallback_${stop.task_id || stop.order_number}`,
    order_number: stop.order_number,
    customer_email: '',
    customer_name: stop.customer_name || '',
    status,
    native_production_status: null,
    native_fulfillment_status: stop.task_status || stop.delivery_status || null,
    native_sync_status: 'delivery_queue_fallback',
    native_review_status: stop.missing_address ? 'review_required' : 'complete',
    native_fulfillment_task_summary: {
      count: stop.task_id ? 1 : 0,
      status_counts: stop.task_status ? { [stop.task_status]: 1 } : {},
      next_delivery_date: stop.delivery_date || null,
      production_date: null,
      task_ids: stop.task_id ? [stop.task_id] : [],
    },
    payment_status: null,
    source_channel: stop.source_type || 'customer_app_native',
    source_type: stop.data_source || 'delivery_queue_native_fallback',
    order_type: null,
    order_lock_status: null,
    total: 0,
    subtotal: 0,
    delivery_fee: 0,
    fulfillment_type: 'delivery',
    delivery_address: stop.delivery_address || '',
    contact_phone: '',
    estimated_delivery_date: stop.delivery_date || null,
    created_date: stop.delivery_date || null,
    items: itemsFromSummary(stop.items_summary),
    notes: stop.delivery_window_label ? `Window: ${stop.delivery_window_label}` : null,
    is_native_order: true,
    is_native_delivery_fallback: true,
  };
}

function SectionLabel({ title, description, badge }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
        {description && (
          <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      {badge && (
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">{badge}</span>
      )}
    </div>
  );
}

function statusSummary(order) {
  const nativeReviewStatus = (order.native_review_status || '').toString().toLowerCase();
  const deliveredLike = ['delivered', 'picked_up'].includes(normalizeOrderStage(order.status)) ||
    ['delivered', 'picked_up', 'fulfilled', 'completed'].includes(normalizedLower(order.hub_operational_status)) ||
    ['delivered', 'fulfilled', 'completed', 'picked_up'].includes(normalizedLower(order.hub_fulfillment_status)) ||
    Boolean(order.delivered_at);
  const staleCompletedProduction = deliveredLike && ['awaiting_production', 'scheduled', 'pending', 'not_required'].includes(normalizedLower(order.native_production_status));
  const staleCompletedFulfillment = deliveredLike && ['pending', 'scheduled', 'unfulfilled', 'not_required'].includes(normalizedLower(order.native_fulfillment_status));
  const productionStatus = order.effective_production_status || (staleCompletedProduction ? null : order.native_production_status);
  const fulfillmentStatus = order.effective_fulfillment_status || (staleCompletedFulfillment ? null : order.native_fulfillment_status);
  const sourceFulfillmentStatus = deliveredLike ? (order.hub_fulfillment_status || order.hub_operational_status) : null;

  return [
    order.customer_app_order_status ? `App: ${formatStatusLabel(order.customer_app_order_status)}` : null,
    order.payment_status ? `Payment: ${formatStatusLabel(order.payment_status)}` : null,
    productionStatus ? `Production: ${formatStatusLabel(productionStatus)}` : null,
    fulfillmentStatus ? `Fulfillment: ${formatStatusLabel(fulfillmentStatus)}` : null,
    sourceFulfillmentStatus ? `Source: ${formatStatusLabel(sourceFulfillmentStatus)}` : null,
    order.native_fulfillment_task_summary?.count ? `Tasks: ${order.native_fulfillment_task_summary.count}` : null,
    order.native_sync_status ? `Sync: ${formatStatusLabel(order.native_sync_status)}` : null,
    order.native_review_queue_summary ? `Review: ${formatStatusLabel(order.native_review_queue_summary.incident_type)}` : null,
    !order.native_review_queue_summary && nativeReviewStatus && nativeReviewStatus !== 'complete' ? `Review: ${formatStatusLabel(order.native_review_status)}` : null,
    order.order_lock_status ? `Lock: ${formatStatusLabel(order.order_lock_status)}` : null,
  ].filter(Boolean).join(' · ');
}

function contextBadgeTone(label) {
  const normalized = (label || '').toLowerCase();
  if (normalized.includes('native')) return 'native';
  if (normalized.includes('hub') || normalized.includes('source')) return 'hub';
  if (normalized.includes('review') || normalized.includes('pending') || normalized.includes('missing')) return 'warning';
  if (normalized.includes('paid')) return 'success';
  if (normalized.includes('delivery') || normalized.includes('pos') || normalized.includes('customer app')) return 'source';
  return 'neutral';
}

function contextBadgeLabel(label) {
  return sourceDisplayText(label || '');
}

function ContextBadges({ badges = [] }) {
  const safeBadges = Array.isArray(badges) ? badges.filter(Boolean) : [];
  if (safeBadges.length === 0) return null;
  return (
    <>
      {safeBadges.map(label => {
        const displayLabel = contextBadgeLabel(label);
        return (
          <AdminStatusPill key={label} value={displayLabel} label={displayLabel} tone={contextBadgeTone(displayLabel)} />
        );
      })}
    </>
  );
}

function guidanceToneClass(tone) {
  if (tone === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100';
  }
  if (tone === 'native') {
    return 'border-cyan-200 bg-cyan-50 text-cyan-900 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-100';
  }
  return 'border-border bg-background text-foreground';
}

function adminOrderSourceDiagnosticErrors({ ordersData, ordersError, ordersQueryError, deliveryFallbackError, deliveryFallbackQueryError }) {
  return [
    ordersData?.error,
    ordersError ? (ordersQueryError?.message || 'Admin orders query failed') : null,
    deliveryFallbackError ? (deliveryFallbackQueryError?.message || 'Delivery fallback query failed') : null,
  ].filter(Boolean);
}

function AdminOrderSourceDiagnostics({ ordersData, deliveryFallbackData, deliveryFallbackOrders, ordersError, ordersQueryError, deliveryFallbackError, deliveryFallbackQueryError }) {
  const summaries = Array.isArray(deliveryFallbackData?.summaries)
    ? deliveryFallbackData.summaries
    : (deliveryFallbackData?.sections ? [deliveryFallbackData] : []);
  const sourceRows = [
    ['Local Customer App orders', ordersData?.local_count],
    ['Source bridge expanded rows', ordersData?.hub_count],
    ['Native ShopifyOrder rows', ordersData?.native_shopify_order_count],
    ['Delivery fallback rows', deliveryFallbackOrders?.length],
    ['Delivery fallback dates checked', summaries.length],
  ];
  const errors = adminOrderSourceDiagnosticErrors({
    ordersData,
    ordersError,
    ordersQueryError,
    deliveryFallbackError,
    deliveryFallbackQueryError,
  });

  return (
    <section className="px-4 mt-4">
      <details className="rounded-2xl border border-slate-200 bg-card p-3 shadow-sm dark:border-slate-800">
        <summary className="cursor-pointer list-none">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Order Source Diagnostics</p>
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                Source counts and transport health for troubleshooting.
              </p>
            </div>
            <AdminStatusPill value={errors.length ? 'Needs review' : 'Healthy'} label={errors.length ? 'Needs review' : 'Healthy'} tone={errors.length ? 'warning' : 'native'} />
          </div>
        </summary>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Source Read Model</p>
            <p className="mt-0.5 text-xs font-medium text-muted-foreground">
              Read-only counts from the Customer App, native operational mirror, source bridge, and delivery fallback.
            </p>
          </div>
          <AdminStatusPill value={errors.length ? 'Needs review' : 'Read-only'} label={errors.length ? 'Needs review' : 'Read-only'} tone={errors.length ? 'warning' : 'native'} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {sourceRows.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-background p-2">
              <p className="text-lg font-black text-foreground">{Number.isFinite(Number(value)) ? Number(value) : 0}</p>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
        {errors.length > 0 && (
          <div className="mt-3 rounded-xl border border-cyan-500/40 bg-cyan-50 p-2 text-[11px] font-semibold text-cyan-900 dark:bg-cyan-950/30 dark:text-cyan-100">
            {errors.map((error, index) => (
              <p key={`${error}-${index}`}>{error}</p>
            ))}
          </div>
        )}
        <p className="mt-2 text-[10px] font-medium text-muted-foreground">
          This panel does not call repair, retry, provider, payment, notification, inventory, or fulfillment write paths.
        </p>
      </details>
    </section>
  );
}

function AdminOrdersLoadStatus({ ordersData, ordersError, ordersQueryError }) {
  const total = Number(ordersData?.order_count ?? ordersData?.total ?? 0);
  const returned = Number(ordersData?.orders_returned ?? ordersData?.orders?.length ?? 0);
  const windowed = ordersData?.compact_order_windowed === true;
  if (!ordersError && !windowed) return null;

  return (
    <section className="px-4 mt-4">
      <div className={`rounded-2xl border p-3 shadow-sm ${
        ordersError
          ? 'border-red-200 bg-red-50 text-red-950 dark:border-red-500/40 dark:bg-red-950/25 dark:text-red-100'
          : 'border-cyan-200 bg-cyan-50 text-cyan-950 dark:border-cyan-500/40 dark:bg-cyan-950/25 dark:text-cyan-100'
      }`}>
        <p className="text-[10px] font-black uppercase tracking-wider">
          {ordersError ? 'Order list needs attention' : 'Recent order window'}
        </p>
        <p className="mt-1 text-xs font-semibold">
          {ordersError
            ? (ordersQueryError?.message || 'The admin order list could not load. Use Delivery Queue and Production Queue while this is reviewed.')
            : `Showing the newest ${returned} of ${total} operational rows so the page stays fast and parseable.`}
        </p>
      </div>
    </section>
  );
}

function OperationalContextPanel({ order }) {
  const guidance = Array.isArray(order.admin_context_guidance) ? order.admin_context_guidance : [];
  return (
    <section className="rounded-xl border border-border/60 bg-background/70 p-3 space-y-3">
        <SectionLabel
          title="Merged Operational Context"
          description="Same-order Customer App, native mirror/task, and source fallback visibility. Read-only; no sync or repair actions run here."
          badge="Visibility"
        />
      <div className="flex flex-wrap gap-1.5">
        <ContextBadges badges={order.admin_context_badges} />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-border/50 bg-secondary/30 p-2 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Customer App</p>
          <InfoRow label="Order ID" value={order.customer_app_order_id || (order.has_customer_app_order ? order.id : null)} />
          <InfoRow label="Status" value={formatStatusLabel(order.customer_app_order_status || order.status)} />
          <InfoRow label="Payment" value={formatStatusLabel(order.customer_app_payment_status || order.payment_status)} />
          <InfoRow label="Captured" value={order.customer_app_payment_captured === true ? 'Yes' : null} />
          <InfoRow label="Line Items" value={Number.isFinite(Number(order.customer_app_line_item_count)) ? `${order.customer_app_line_item_count}` : null} />
        </div>
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-2 space-y-1 dark:border-cyan-900/60 dark:bg-cyan-950/20">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-900 dark:text-cyan-100">Native Ops Mirror</p>
          {order.has_native_order ? (
            <>
              <InfoRow label="Order ID" value={order.native_shopify_order_id} />
              <InfoRow label="Sync" value={formatStatusLabel(order.native_sync_status)} />
              <InfoRow label="Production" value={formatStatusLabel(order.effective_production_status || order.native_production_status)} />
              <InfoRow label="Fulfillment" value={formatStatusLabel(order.effective_fulfillment_status || order.native_fulfillment_status)} />
              {order.native_status_stale_against_source && (
                <InfoRow
                  label="Native mirror"
                  value={`Stale: ${(order.native_status_stale_fields || []).map(formatStatusLabel).join(', ')}`}
                />
              )}
              <InfoRow label="Task" value={order.has_native_task ? `${order.native_fulfillment_task_summary?.count || 0} native task(s)` : 'No native task'} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground italic">No native mirror attached to this order row.</p>
          )}
        </div>
        <div className="rounded-lg border border-slate-300 bg-slate-50 p-2 space-y-1 dark:border-slate-800 dark:bg-slate-950/30">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">Source Bridge</p>
          {order.is_hub_order ? (
            <>
              <InfoRow label="Source Order" value={order.hub_order_id} />
              <InfoRow label="Status" value={formatStatusLabel(order.hub_operational_status || order.status)} />
              <InfoRow label="Bridge" value={order.hub_sync_summary ? `${formatStatusLabel(order.hub_sync_summary.status)}${order.hub_sync_summary.action ? ` · ${formatStatusLabel(order.hub_sync_summary.action)}` : ''}` : 'Synced'} />
              <InfoRow label="Updated" value={formatDateTime(order.hub_sync_summary?.timestamp || order.hub_updated_date)} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground italic">No source order attached to this row.</p>
          )}
        </div>
      </div>
      {guidance.length > 0 && (
        <div className="space-y-2">
          {guidance.map(item => (
            <div key={`${item.label}-${item.detail}`} className={`rounded-lg border p-2 ${guidanceToneClass(item.tone)}`}>
              <p className="text-xs font-bold">{sourceDisplayText(item.label)}</p>
              {item.detail && <p className="mt-0.5 text-[10px] font-medium opacity-90">{sourceDisplayText(item.detail)}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function NativeOperationsPanel({ order }) {
  if (!order.is_native_order && !order.has_native_order) return null;
  const taskSummary = order.native_fulfillment_task_summary || {};
  const latestSyncLog = order.native_latest_sync_log || null;
  const reviewSummary = order.native_review_queue_summary || null;
  const taskStatusSummary = Object.entries(taskSummary.status_counts || {})
    .map(([status, count]) => `${formatStatusLabel(status)}: ${count}`)
    .join(' · ');
  const firstTask = Array.isArray(taskSummary.tasks) ? taskSummary.tasks[0] : null;

  return (
    <div className="bg-secondary/40 rounded-xl p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Native Operations</p>
        <AdminStatusPill value="Customer App" label="Customer App" tone="native" />
      </div>
      <InfoRow label="Mirror ID" value={order.native_shopify_order_id} />
      <InfoRow label="Payment" value={formatStatusLabel(order.native_payment_status || order.payment_status)} />
      <InfoRow label="Production" value={formatStatusLabel(order.effective_production_status || order.native_production_status)} />
      <InfoRow label="Fulfillment" value={formatStatusLabel(order.effective_fulfillment_status || order.native_fulfillment_status)} />
      {order.native_status_stale_against_source && (
        <InfoRow
          label="Raw Native"
          value={[
            order.native_production_status ? `Production ${formatStatusLabel(order.native_production_status)}` : null,
            order.native_fulfillment_status ? `Fulfillment ${formatStatusLabel(order.native_fulfillment_status)}` : null,
          ].filter(Boolean).join(' · ')}
        />
      )}
      <InfoRow label="Sync" value={formatStatusLabel(order.native_sync_status)} />
      <InfoRow label="Review" value={formatStatusLabel(order.native_review_status)} />
      <InfoRow label="Source" value={formatStatusLabel(order.native_source_type || order.native_source_channel || order.source_type || order.source_channel)} />
      <InfoRow label="Order Type" value={formatStatusLabel(order.native_order_type || order.order_type)} />
      <InfoRow label="Line Items" value={Number.isFinite(Number(order.native_line_item_count)) ? `${order.native_line_item_count}` : null} />
      <InfoRow label="Native Total" value={Number.isFinite(Number(order.native_total)) ? formatCurrency(order.native_total) : null} />
      <InfoRow label="Lock" value={formatStatusLabel(order.native_order_lock_status || order.order_lock_status)} />
      <div className="pt-2 mt-2 border-t border-border/40 space-y-1.5">
        <InfoRow label="Task Count" value={taskSummary.count ? `${taskSummary.count}` : 'No native delivery task'} />
        <InfoRow label="Task ID" value={firstTask?.id || taskSummary.task_ids?.[0]} />
        <InfoRow label="Task Status" value={taskStatusSummary} />
        <InfoRow label="Task Delivery" value={formatDateOnly(firstTask?.delivery_date || taskSummary.next_delivery_date)} />
        <InfoRow label="Task Production" value={formatDateOnly(firstTask?.production_date || taskSummary.production_date)} />
        <InfoRow label="Task Source" value={formatStatusLabel(firstTask?.source_type || firstTask?.source_channel)} />
        <InfoRow label="Schedule" value={formatStatusLabel(firstTask?.schedule_source)} />
        {taskSummary.incomplete_display_metadata && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] font-semibold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            Native task exists but has incomplete display metadata.
            {taskSummary.missing_metadata_fields?.length > 0 && (
              <span className="block font-medium">Missing: {taskSummary.missing_metadata_fields.map(formatStatusLabel).join(', ')}</span>
            )}
          </div>
        )}
      </div>
      <div className="pt-2 mt-2 border-t border-border/40 space-y-1.5">
        <InfoRow label="Latest Sync" value={latestSyncLog ? `${formatStatusLabel(latestSyncLog.status)}${latestSyncLog.action ? ` · ${formatStatusLabel(latestSyncLog.action)}` : ''}` : 'No native sync log'} />
        <InfoRow label="Sync Source" value={formatStatusLabel(latestSyncLog?.source)} />
        <InfoRow label="Sync Event" value={formatStatusLabel(latestSyncLog?.event_type)} />
        <InfoRow label="Sync Reason" value={latestSyncLog?.reason} />
        <InfoRow label="Sync Time" value={formatDateTime(latestSyncLog?.timestamp)} />
      </div>
      {reviewSummary && (
        <div className="pt-2 mt-2 border-t border-border/40 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Native Review Queue</p>
            <AdminStatusPill value={reviewSummary.status || 'pending'} label={formatStatusLabel(reviewSummary.status || 'pending')} tone="warning" size="sm" />
          </div>
          <InfoRow label="Issue" value={formatStatusLabel(reviewSummary.incident_type)} />
          <InfoRow label="Details" value={reviewSummary.issue_description} />
          <InfoRow label="Action" value={reviewSummary.recommended_action} />
          <InfoRow label="Last Seen" value={formatDateTime(reviewSummary.last_seen_at)} />
        </div>
      )}
      <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
        Native mirror remains parallel to the source bridge while operational actions move through Delivery Queue and Production views.
      </p>
    </div>
  );
}

function HubOperationsPanel({ order, customerAppStatusLabel }) {
  if (!order.is_hub_order) return null;

  const proofLink = order.delivery_photo_url ? (
    <a
      href={order.delivery_photo_url}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2"
    >
      View proof photo
    </a>
  ) : null;

  const hasHubOpsData = Boolean(
    order.hub_operational_status ||
    order.hub_fulfillment_status ||
    order.production_date ||
    order.assigned_delivery_date ||
    order.delivery_window_label ||
    order.delivered_at ||
    order.delivered_by ||
    order.delivery_photo_url ||
    order.delivery_drop_location ||
    order.source_channel ||
    order.stripe_subscription_id ||
    order.hub_updated_date
  );

  return (
    <div className="bg-secondary/40 rounded-xl p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Source Operations</p>
        <AdminStatusPill value="Read-only" label="Read-only" tone="hub" />
      </div>
      {hasHubOpsData ? (
        <>
          <InfoRow label="Source Order ID" value={order.hub_order_id} />
          <InfoRow label="Customer App Status" value={customerAppStatusLabel || formatStatusLabel(order.status)} />
          <InfoRow label="Source Operational Status" value={formatStatusLabel(order.hub_operational_status)} />
          <InfoRow label="Fulfillment" value={formatStatusLabel(order.hub_fulfillment_status)} />
          <InfoRow label="Source Bridge" value={order.hub_sync_summary ? `${formatStatusLabel(order.hub_sync_summary.status)}${order.hub_sync_summary.action ? ` · ${formatStatusLabel(order.hub_sync_summary.action)}` : ''}` : null} />
          <InfoRow label="Production Date" value={formatDateOnly(order.production_date)} />
          <InfoRow label="Delivery" value={formatDateOnly(order.assigned_delivery_date)} />
          <InfoRow label="Window" value={order.delivery_window_label} />
          <InfoRow label="Delivered" value={formatDateTime(order.delivered_at)} />
          <InfoRow label="By" value={order.delivered_by} />
          <InfoRow label="Drop" value={order.delivery_drop_location} />
          <InfoRow label="Proof" value={proofLink} />
          <InfoRow label="Source" value={formatStatusLabel(order.source_channel)} />
          <InfoRow label="Subscription ID" value={order.stripe_subscription_id} />
          <InfoRow label="Last Source Update" value={formatDateTime(order.hub_updated_date)} />
        </>
      ) : (
        <p className="text-xs text-muted-foreground italic">No source operations data yet</p>
      )}
    </div>
  );
}

function FulfillmentTasksPanel({ order }) {
  const shouldFetchTasks = Boolean(
    order.is_hub_order &&
    (order.hub_order_id || order.order_number || order.stripe_subscription_id)
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-fulfillment-tasks', order.hub_order_id, order.order_number, order.stripe_subscription_id, order.hub_fulfillment_number],
    queryFn: async () => {
      const payload = {
        hub_order_id: order.hub_order_id || null,
        order_number: order.order_number || null,
        stripe_subscription_id: order.stripe_subscription_id || null,
        limit: 50,
      };
      if (order.hub_fulfillment_number) {
        payload.fulfillment_number = order.hub_fulfillment_number;
      }
      const res = await base44.functions.invoke('getAdminFulfillmentTaskDetails', payload);
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result || { tasks: [] };
    },
    enabled: shouldFetchTasks,
    staleTime: 60000,
  });

  if (!order.is_hub_order) return null;

  const tasks = data?.tasks || [];

  return (
    <div className="bg-secondary/40 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Fulfillment Tasks</p>
        <AdminStatusPill value="Read-only" label="Read-only" tone="hub" />
      </div>

      {!shouldFetchTasks ? (
        <p className="text-xs text-muted-foreground italic">No source task identifiers available</p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground italic">Loading fulfillment tasks...</p>
      ) : isError ? (
        <p className="text-xs text-destructive">Unable to load FulfillmentTask details</p>
      ) : tasks.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No FulfillmentTask details found</p>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => {
            const proofLink = task.delivery_photo_url ? (
              <a
                href={task.delivery_photo_url}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2"
              >
                View proof photo
              </a>
            ) : null;

            return (
              <div key={task.id || `${task.order_id}-${task.fulfillment_number}`} className="rounded-lg border border-border/50 bg-background/60 p-2 space-y-1.5">
                <InfoRow label="Task ID" value={task.id} />
                <InfoRow label="Fulfillment" value={task.fulfillment_number ? `#${task.fulfillment_number}` : null} />
                <InfoRow label="Task Status" value={formatStatusLabel(task.status)} />
                <InfoRow label="Delivery Status" value={formatStatusLabel(task.delivery_status)} />
                <InfoRow label="Production Date" value={formatDateOnly(task.production_date)} />
                <InfoRow label="Delivery Date" value={formatDateOnly(task.delivery_date || task.scheduled_date)} />
                <InfoRow label="Window" value={task.delivery_window_label} />
                <InfoRow label="Items" value={task.items_summary} />
                <InfoRow label="Source" value={formatStatusLabel(task.source_type)} />
                <InfoRow label="Schedule Source" value={formatStatusLabel(task.schedule_source)} />
                <InfoRow label="Delivered" value={formatDateTime(task.delivered_at)} />
                <InfoRow label="Proof" value={proofLink} />
                <InfoRow label="Drop" value={task.delivery_drop_location} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HubTimelinePanel({ order }) {
  const shouldFetchTimeline = Boolean(
    (order.is_hub_order || order.has_native_order || order.has_native_task) &&
    (order.hub_order_id || order.order_number || order.stripe_subscription_id || order.id)
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-order-timeline', order.hub_order_id, order.order_number, order.stripe_subscription_id, order.id],
    queryFn: async () => {
      const timelineRequest = { limit: 50 };
      if (order.hub_order_id) timelineRequest.hub_order_id = order.hub_order_id;
      if (order.order_number) timelineRequest.order_number = order.order_number;
      if (order.stripe_subscription_id) timelineRequest.stripe_subscription_id = order.stripe_subscription_id;
      if (order.id) timelineRequest.customer_app_order_id = order.id;

      const res = await base44.functions.invoke('getAdminOrderTimeline', timelineRequest);
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result || { events: [] };
    },
    enabled: shouldFetchTimeline,
    staleTime: 60000,
  });

  const events = data?.events || [];

  return (
    <div className="bg-secondary/40 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Source Timeline</p>
        <AdminStatusPill value="Read-only" label="Read-only" tone="hub" />
      </div>

      {!shouldFetchTimeline ? (
        <p className="text-xs text-muted-foreground italic">No source timeline identifiers available</p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground italic">Loading source timeline...</p>
      ) : isError ? (
        <p className="text-xs text-destructive">Unable to load source timeline</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No source timeline events found</p>
      ) : (
        <div className="space-y-2">
          {events.map((event, index) => {
            const proofLink = event.details?.delivery_photo_url ? (
              <a
                href={event.details.delivery_photo_url}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2"
              >
                View proof photo
              </a>
            ) : null;
            const eventWhen = event.timestamp ? formatDateTime(event.timestamp) : formatDateOnly(event.date);

            return (
              <div key={`${event.type}-${event.source}-${event.task_id || index}-${event.timestamp || event.date || index}`} className="rounded-lg border border-border/50 bg-background/60 p-2 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-foreground">{sourceDisplayText(event.label) || formatStatusLabel(event.type) || 'Source Event'}</p>
                  <span className="text-[10px] text-muted-foreground shrink-0">{eventWhen || 'Date pending'}</span>
                </div>
                <InfoRow label="Type" value={formatStatusLabel(event.type)} />
                <InfoRow label="Source" value={formatStatusLabel(event.source)} />
                <InfoRow label="Status" value={formatStatusLabel(event.status)} />
                <InfoRow label="Fulfillment" value={event.fulfillment_number ? `#${event.fulfillment_number}` : null} />
                <InfoRow label="Task ID" value={event.task_id} />
                <InfoRow label="Window" value={event.delivery_window_label} />
                <InfoRow label="Proof" value={event.details?.proof_available ? 'Available' : null} />
                <InfoRow label="Proof Link" value={proofLink} />
                <InfoRow label="Drop" value={event.details?.delivery_drop_location} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function generateRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `hub-note-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function InternalHubNoteComposer({ order }) {
  const [note, setNote] = useState('');
  const trimmedNote = note.trim();
  const hasIdentifiers = Boolean(order.hub_order_id || order.order_number);

  const appendNoteMutation = useMutation({
    mutationFn: async ({ requestId }) => {
      const res = await base44.functions.invoke('appendAdminHubOrderNote', {
        hub_order_id: order.hub_order_id || null,
        order_number: order.order_number || null,
        note: trimmedNote,
        request_id: requestId,
      });
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (result) => {
      if (result?.skipped && result?.reason === 'duplicate_request_id') {
        toast.info('Note already submitted');
      } else {
        toast.success('Internal source note appended');
      }
      setNote('');
    },
    onError: () => {
      toast.error('Unable to append internal source note');
    },
  });

  if (!order.is_hub_order) return null;

  const isDisabled = appendNoteMutation.isPending || !hasIdentifiers || !trimmedNote || trimmedNote.length > 1000;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (isDisabled) return;
    appendNoteMutation.mutate({ requestId: generateRequestId() });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-secondary/40 rounded-xl p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Internal Source Note</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Append-only · Admin-only · Not customer-visible.</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Append-only</span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-800 border border-cyan-200 leading-tight">Only source-note write available here</span>
        </div>
      </div>

      {!hasIdentifiers ? (
        <p className="text-xs text-muted-foreground italic">No source note identifiers available</p>
      ) : (
        <>
          <textarea
            value={note}
            onChange={event => setNote(event.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Add an internal operations note..."
            className="w-full rounded-lg border border-border bg-background/80 p-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[10px] ${trimmedNote.length > 1000 ? 'text-destructive' : 'text-muted-foreground'}`}>
              {trimmedNote.length}/1000
            </span>
            <button
              type="submit"
              disabled={isDisabled}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {appendNoteMutation.isPending ? 'Appending...' : 'Append Note'}
            </button>
          </div>
        </>
      )}
    </form>
  );
}

function OrderCard({ order, customerName, forceExpanded = false, onCollapseFocused }) {
  const [expanded, setExpanded] = useState(forceExpanded);
  const stages = order.fulfillment_type === 'pickup' ? PICKUP_STAGES : DELIVERY_STAGES;
  const currentIndex = Math.max(0, stages.findIndex(s => s.key === normalizeOrderStage(order.status)));
  const partialFulfillment = normalizedLower(order.effective_fulfillment_status || order.effective_delivery_status) === 'partially_fulfilled';
  const taskStatusCounts = order.native_fulfillment_task_summary?.status_counts || {};
  const completedTaskCount = Object.entries(taskStatusCounts).reduce((total, [status, count]) => (
    total + (['delivered', 'completed', 'fulfilled', 'complete', 'picked_up'].includes(normalizedLower(status)) ? Number(count || 0) : 0)
  ), 0);
  const totalTaskCount = Number(order.native_fulfillment_task_summary?.count || 0);

  const deliveryDateStr = order.estimated_delivery_date
    ? format(parseLocalDate(order.estimated_delivery_date), 'MMM d, yyyy')
    : null;
  const orderedDateStr = order.created_date
    ? format(new Date(order.created_date), 'MMM d, yyyy · h:mm a')
    : null;
  const itemsSummary = order.items?.length > 0
    ? order.items.map(i => `${i.title} ×${i.quantity}`).join(', ')
    : null;
  const customerAppStatusLabel = partialFulfillment
    ? 'Partially Fulfilled'
    : stages.find(s => s.key === order.status)?.label || formatStatusLabel(order.status);

  useEffect(() => {
    if (forceExpanded) setExpanded(true);
  }, [forceExpanded]);

  const toggleExpanded = () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (!nextExpanded && forceExpanded) onCollapseFocused?.();
  };

  return (
    <div id={`admin-order-card-${orderKey(order)}`} className="bg-card rounded-2xl border border-border/50 overflow-hidden">
      {/* Collapsed header — always shows complete at-a-glance info */}
      <button onClick={toggleExpanded} className="w-full flex items-start gap-3 p-4 text-left">
        <div className="flex-1 min-w-0 space-y-1">
          {/* Row 1: order # + status badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold">#{order.order_number}</p>
            <AdminStatusPill value={partialFulfillment ? 'partially_fulfilled' : order.status} label={customerAppStatusLabel} tone={null} />
            <AdminStatusPill value={order.fulfillment_type} label={order.fulfillment_type === 'pickup' ? 'Pickup' : 'Delivery'} context="source" tone={null} />
            <ContextBadges badges={order.admin_context_badges || [
              order.has_customer_app_order ? 'Customer App Order' : null,
              order.has_native_order || order.is_native_order ? 'Native Ops Mirror' : null,
              order.has_native_task ? 'Native Task' : null,
              order.is_hub_order ? 'Source Synced' : null,
            ].filter(Boolean)} />
          </div>
          {/* Row 2: customer name (always shown if available) */}
          <p className="text-sm font-semibold text-foreground">
            {customerName || <span className="text-muted-foreground italic font-normal">Unknown Customer</span>}
          </p>
          {/* Row 3: email */}
          <p className="text-xs text-muted-foreground truncate">{order.customer_email}</p>
          {/* Row 4: delivery date + items summary */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {deliveryDateStr && (
              <p className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                <CalendarDays className="h-3 w-3" />
                {deliveryDateStr}
              </p>
            )}
            {!deliveryDateStr && orderedDateStr && (
              <p className="text-xs text-muted-foreground">Ordered {orderedDateStr}</p>
            )}
            {itemsSummary && (
              <p className="text-xs text-muted-foreground truncate max-w-[180px]">{itemsSummary}</p>
            )}
          </div>
          {statusSummary(order) && (
            <p className="text-[10px] text-muted-foreground truncate">{statusSummary(order)}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          <p className="text-sm font-bold">${(order.total || 0).toFixed(2)}</p>
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/40 px-4 pb-4 pt-3 space-y-4">

              <OperationalContextPanel order={order} />

              {/* Customer info block */}
              <div className="bg-secondary/40 rounded-xl p-3 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Customer</p>
                <InfoRow label="Name" value={customerName || '—'} />
                <InfoRow label="Email" value={order.customer_email} />
                <InfoRow label="Phone" value={order.contact_phone || '—'} />
                <InfoRow label="Address" value={order.delivery_address || (order.fulfillment_type === 'pickup' ? 'In-store pickup' : '—')} />
                {deliveryDateStr && <InfoRow label="Delivery" value={deliveryDateStr} />}
                {orderedDateStr && <InfoRow label="Ordered" value={orderedDateStr} />}
              </div>

              <PricingBreakdownPanel order={order} />

              <DeliveryRateContextPanel order={order} />

              {order.notes && (
                <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Internal Notes</p>
                  <p className="text-xs font-medium text-foreground">{order.notes}</p>
                </div>
              )}

              {order.is_hub_order && (
                <section className="rounded-xl border border-border/60 bg-background/70 p-3 space-y-2">
                  <SectionLabel
                    title="Source Read-Only Context"
                    description="View-only operational data from the source bridge."
                    badge="Read-only"
                  />
                  <div className="space-y-2">
                    <HubOperationsPanel order={order} customerAppStatusLabel={customerAppStatusLabel} />
                    <FulfillmentTasksPanel order={order} />
                    <HubTimelinePanel order={order} />
                  </div>
                </section>
              )}

              {(order.is_native_order || order.has_native_order) && (
                <section className="rounded-xl border border-border/60 bg-background/70 p-3 space-y-2">
                  <SectionLabel
                    title="Native Customer App Context"
                    description="Operational mirror/task context created in the Customer App backend for production, fulfillment, and delivery visibility."
                    badge="Parallel"
                  />
                  <NativeOperationsPanel order={order} />
                </section>
              )}

              {!order.is_hub_order && (order.has_native_order || order.has_native_task) && (
                <section className="rounded-xl border border-border/60 bg-background/70 p-3 space-y-2">
                  <SectionLabel
                    title="Order Timeline"
                    description="Occurrence-level source events with mirrored parent projections consolidated."
                    badge="Read-only"
                  />
                  <HubTimelinePanel order={order} />
                </section>
              )}

              <InternalHubNoteComposer order={order} />

              <section className="rounded-xl border border-border/60 bg-background/70 p-3 space-y-3">
                  <SectionLabel
                  title="Operational Workflow"
                  description="Review order context here, then use the live queues for production and fulfillment changes."
                  badge="Queue-based"
                />
                <AdminStatusLegend />

                {/* Progress */}
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    {partialFulfillment ? 'Progress — Partial fulfillment' : `Progress — Step ${currentIndex + 1} of ${stages.length}`}
                  </p>
                  <div className="flex gap-1">
                    {partialFulfillment
                      ? Array.from({ length: Math.max(totalTaskCount, 1) }, (_, index) => (
                        <div key={`fulfillment-${index}`} className={`h-1.5 flex-1 rounded-full ${index < completedTaskCount ? 'bg-primary' : 'bg-border'}`} />
                      ))
                      : stages.map((stage, i) => (
                        <div key={stage.key} className={`h-1.5 flex-1 rounded-full ${i <= currentIndex ? 'bg-primary' : 'bg-border'}`} />
                      ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {partialFulfillment
                      ? `${completedTaskCount} of ${totalTaskCount} delivery ${totalTaskCount === 1 ? 'task' : 'tasks'} complete`
                      : stages[currentIndex]?.label}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Link
                    to="/admin/production-queue"
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-card px-3 text-xs font-bold text-foreground hover:border-primary/60"
                  >
                    Production Queue
                  </Link>
                  <Link
                    to={order.fulfillment_type === 'pickup' ? '/admin/pos-orders' : '/admin/delivery-queue'}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-card px-3 text-xs font-bold text-foreground hover:border-primary/60"
                  >
                    {order.fulfillment_type === 'pickup' ? 'POS / Pickup Orders' : 'Delivery Queue'}
                  </Link>
                  <Link
                    to={order.fulfillment_type === 'pickup' ? '/admin/orders' : '/admin/route-ops'}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-card px-3 text-xs font-bold text-foreground hover:border-primary/60"
                  >
                    {order.fulfillment_type === 'pickup' ? 'Order Review' : 'Route Ops'}
                  </Link>
                </div>
                {order.is_hub_order && (
                  <p className="text-[10px] text-muted-foreground text-center">Source-backed order context stays readable here; lifecycle changes stay tied to the matching production or delivery record.</p>
                )}
              </section>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function AdminOrders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isPageVisible = usePageVisibility();
  const [filter, setFilter] = useState('active');
  const [focusedOrderKey, setFocusedOrderKey] = useState(null);

  const [search, setSearch] = useState('');

  const {
    data: ordersData = {},
    isLoading: ordersLoading,
    isError: ordersError,
    error: ordersQueryError,
  } = useQuery({
    queryKey: ['admin-orders'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminOrdersWithHub', {
        response_mode: ADMIN_ORDER_LIST_COMPACT_RESPONSE_MODE,
      });
      const result = unwrapFunctionData(res, { orders: [], total: 0 });
      if (!hasValidAdminOrderListCompactResponse(result)) {
        throw new Error('Compact admin-order list contract is unavailable');
      }
      return result;
    },
    enabled: isAdminUser(user) && isPageVisible,
    refetchInterval: isPageVisible ? 30000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const {
    data: orderLifecycleData = {},
  } = useQuery({
    queryKey: ['admin-order-lifecycle-read-model'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminOrdersWithHub', {
        read_model_mode: ADMIN_ORDER_LIFECYCLE_READ_MODEL_MODE,
      });
      return unwrapFunctionData(res, {});
    },
    enabled: isAdminUser(user) && isPageVisible,
    refetchInterval: isPageVisible ? 30000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const primaryOrders = ordersData.orders || [];
  const adminOrderLifecycleReadModel = hasValidAdminOrderLifecycleReadModel(orderLifecycleData)
    ? orderLifecycleData.admin_order_lifecycle_read_model
    : null;

  const {
    data: deliveryFallbackData = {},
    isLoading: deliveryFallbackLoading,
    isError: deliveryFallbackError,
    error: deliveryFallbackQueryError,
  } = useQuery({
    queryKey: ['admin-orders-delivery-fallback'],
    queryFn: async () => {
      const dates = upcomingIsoDates(14);
      const summaries = await Promise.all(
        dates.map(async deliveryDate => {
          try {
            const res = await base44.functions.invoke('getAdminDeliveryRouteSummary', {
              delivery_date: deliveryDate,
              limit: 100,
            });
            return res.data || {};
          } catch (error) {
            console.warn('[AdminOrders] Native delivery fallback unavailable for date', deliveryDate, error?.message || error);
            return {};
          }
        })
      );
      return { summaries };
    },
    enabled: isAdminUser(user) && isPageVisible,
    refetchInterval: isPageVisible ? 30000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const deliveryFallbackOrders = useMemo(() => {
    const summaries = Array.isArray(deliveryFallbackData.summaries)
      ? deliveryFallbackData.summaries
      : [deliveryFallbackData];
    return summaries
      .flatMap(summary => {
        const sections = summary.sections || {};
        return [
          ...(sections.delivery_stops || []),
          ...(sections.unscheduled_delivery_orders || []),
        ];
      })
      .map(mapDeliveryStopToAdminOrder)
      .filter(Boolean);
  }, [deliveryFallbackData]);

  const orders = useMemo(() => {
    const merged = new Map();
    primaryOrders.forEach(order => {
      const key = (order.order_number || order.id || '').toString().toLowerCase();
      if (key) merged.set(key, order);
    });
    deliveryFallbackOrders.forEach(order => {
      const key = (order.order_number || order.id || '').toString().toLowerCase();
      if (key && !merged.has(key)) merged.set(key, order);
    });
    return Array.from(merged.values());
  }, [primaryOrders, deliveryFallbackOrders]);
  const isLoading = ordersLoading || (primaryOrders.length === 0 && deliveryFallbackLoading);
  const totalOrderCount = Number(ordersData.order_count ?? ordersData.total ?? orders.length);
  const returnedOrderCount = Number(ordersData.orders_returned ?? primaryOrders.length);
  const orderListWindowed = ordersData.compact_order_windowed === true;
  const headerSubtitle = orderListWindowed
    ? `${returnedOrderCount} recent of ${totalOrderCount} orders`
    : `${orders.length} total orders`;

  // Build email -> name map from the admin orders wrapper payload.
  // This avoids a browser-side UserProfile.list on the operational order page.
  const nameMap = useMemo(() => {
    const map = {};
    orders.forEach(order => {
      const email = order.customer_email || order.hub_customer_email;
      const name = order.customer_name || order.full_name || order.shipping_name || order.billing_name;
      if (email && name) {
        map[email] = name;
      }
    });
    return map;
  }, [orders]);

  // Split: pending/abandoned vs operational
  const pendingOrders = orders.filter(o => isAbandonedOrUnpaid(o));

  // Operational = paid, non-cancelled, non-test, non-refunded, non-abandoned
  const operationalOrders = orders.filter(o =>
    !isAbandonedOrUnpaid(o) &&
    !o.is_test_order &&
    !o.do_not_recover &&
    o.payment_status !== 'refunded' &&
    o.financial_status !== 'refunded' &&
    o.status !== 'cancelled'
  );

  const orderSourceDiagnosticErrors = adminOrderSourceDiagnosticErrors({
    ordersData,
    ordersError,
    ordersQueryError,
    deliveryFallbackError,
    deliveryFallbackQueryError,
  });
  const showOrderSourceDiagnostics = orderSourceDiagnosticErrors.length > 0;

  const statusFiltered = filter === 'active'
    ? operationalOrders.filter(o => ACTIVE_STATUSES.includes(o.status))
    : filter === 'completed'
    ? operationalOrders.filter(o => ['delivered', 'picked_up'].includes(o.status))
    : pendingOrders; // 'pending' tab

  const filtered = search
    ? statusFiltered.filter(o => {
        const q = search.toLowerCase();
        const name = nameMap[o.customer_email] || '';
        return (
          o.customer_email?.toLowerCase().includes(q) ||
          o.order_number?.toLowerCase().includes(q) ||
          o.contact_phone?.includes(q) ||
          name.toLowerCase().includes(q) ||
          o.delivery_address?.toLowerCase().includes(q)
        );
      })
    : statusFiltered;

  const queryOrderSearch = (
    searchParams.get('order') ||
    searchParams.get('email') ||
    searchParams.get('q') ||
    ''
  ).trim();

  useEffect(() => {
    if (!queryOrderSearch || isLoading || orders.length === 0) return;

    const lookup = queryOrderSearch.toLowerCase();
    const match = orders.find(order => {
      const candidates = [
        order.order_number,
        order.id,
        order.hub_order_id,
        order.customer_email,
        order.hub_customer_email,
      ];
      return candidates.some(value => (value || '').toString().toLowerCase() === lookup);
    });

    setSearch(current => current === queryOrderSearch ? current : queryOrderSearch);
    if (match) {
      const nextFilter = isAbandonedOrUnpaid(match)
        ? 'pending'
        : ['delivered', 'picked_up'].includes(match.status)
          ? 'completed'
          : 'active';
      setFilter(current => current === nextFilter ? current : nextFilter);
      setFocusedOrderKey(orderKey(match));
      window.setTimeout(() => {
        document.getElementById('admin-orders-detail-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
  }, [isLoading, orders, queryOrderSearch]);

  if (!isAdminUser(user)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Access denied. Admins only.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-10">
      <AdminOpsHeader
        title="Order Management"
        subtitle={headerSubtitle}
        badge="Source + Native"
        onBack={() => navigate('/admin/operations')}
      />

      <AdminOrdersLoadStatus
        ordersData={ordersData}
        ordersError={ordersError}
        ordersQueryError={ordersQueryError}
      />

      {adminOrderLifecycleReadModel && (
        <AdminOrderLifecycleReadModelPanel model={adminOrderLifecycleReadModel} />
      )}

      {showOrderSourceDiagnostics && (
        <AdminOrderSourceDiagnostics
          ordersData={ordersData}
          deliveryFallbackData={deliveryFallbackData}
          deliveryFallbackOrders={deliveryFallbackOrders}
          ordersError={ordersError}
          ordersQueryError={ordersQueryError}
          deliveryFallbackError={deliveryFallbackError}
          deliveryFallbackQueryError={deliveryFallbackQueryError}
        />
      )}

      {/* Search */}
      <div className="px-4 mt-4 mb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, phone, order #..."
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 px-4 mb-4 overflow-x-auto pb-1">
        {[
          { key: 'active', label: `Active (${operationalOrders.filter(o => ACTIVE_STATUSES.includes(o.status)).length})` },
          { key: 'completed', label: `Completed (${operationalOrders.filter(o => ['delivered', 'picked_up'].includes(o.status)).length})` },
          { key: 'pending', label: `Pending (${pendingOrders.length})` },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors shrink-0 ${
              filter === tab.key ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <Link
          to="/admin/route-ops"
          className="shrink-0 rounded-full border border-cyan-300 bg-cyan-50 px-4 py-1.5 text-xs font-semibold text-cyan-900 transition-colors hover:border-cyan-500 dark:border-cyan-800/70 dark:bg-cyan-950/40 dark:text-cyan-100"
        >
          Route Ops
        </Link>
      </div>

      {/* Orders List */}
      <div id="admin-orders-detail-list" className="px-4 space-y-3 scroll-mt-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-sm">{search ? 'No orders match your search' : `No ${filter} orders`}</p>
          </div>
        ) : (
          filtered.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              customerName={nameMap[order.customer_email] || order.customer_name || null}
              forceExpanded={focusedOrderKey === orderKey(order)}
              onCollapseFocused={() => setFocusedOrderKey(null)}
            />
          ))
        )}
      </div>
    </div>
  );
}
