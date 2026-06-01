import React, { useState, useMemo } from 'react';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import Zone3ReviewPanel from '@/components/admin/Zone3ReviewPanel';
import { AdminStatusLegend, AdminStatusPill } from '@/components/admin/AdminStatusPill';
import May30ReadinessPanel from '@/components/admin/May30ReadinessPanel';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { format } from 'date-fns';
import { ChevronRight, ChevronDown, Mail, Search, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

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

const ACTIVE_STATUSES = ['order_received', 'scheduled_for_juicing', 'in_production', 'bottled_packed', 'out_for_delivery', 'arriving_soon', 'ready_for_pickup'];
const ORDER_WORKFLOW_CONTROLS_FROZEN = true;

const orderOpsReadinessItems = [
  {
    label: 'One-time order visibility',
    status: 'ready',
    detail: 'Paid app/website orders show customer, item, payment, Hub, native, fulfillment, timeline, and review context.',
  },
  {
    label: 'Native safety mirror',
    status: 'ready',
    detail: 'Native operational mirror and review status are visible while Hub remains the active bridge fallback.',
  },
  {
    label: 'Bad order review',
    status: 'ready',
    detail: 'Review queue indicators and Sync Health expose incomplete or low-quality order issues without repair controls.',
  },
  {
    label: 'Workflow buttons',
    status: 'frozen',
    detail: 'Generic order status buttons stay frozen; use Production Queue and Delivery Queue for approved operational actions.',
  },
];

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

function todayIsoDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const localDate = new Date(now.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 10);
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
  return [
    order.payment_status ? `Payment: ${formatStatusLabel(order.payment_status)}` : null,
    order.native_production_status ? `Production: ${formatStatusLabel(order.native_production_status)}` : null,
    order.native_fulfillment_status ? `Fulfillment: ${formatStatusLabel(order.native_fulfillment_status)}` : null,
    order.native_fulfillment_task_summary?.count ? `Tasks: ${order.native_fulfillment_task_summary.count}` : null,
    order.native_sync_status ? `Sync: ${formatStatusLabel(order.native_sync_status)}` : null,
    order.native_review_queue_summary ? `Review: ${formatStatusLabel(order.native_review_queue_summary.incident_type)}` : null,
    !order.native_review_queue_summary && nativeReviewStatus && nativeReviewStatus !== 'complete' ? `Review: ${formatStatusLabel(order.native_review_status)}` : null,
    order.order_lock_status ? `Lock: ${formatStatusLabel(order.order_lock_status)}` : null,
  ].filter(Boolean).join(' · ');
}

function orderSourceTone(order) {
  const source = `${order.source_type || ''} ${order.source_channel || ''} ${order.order_type || ''}`.toLowerCase();
  if (source.includes('pos') || order.fulfillment_type === 'pickup') return 'source';
  if (order.is_native_order) return 'native';
  if (order.is_hub_order) return 'hub';
  return 'neutral';
}

function LiveCustomerContextPanel({ orders, isLoading, nameMap }) {
  const recentOrders = useMemo(() => {
    return orders
      .filter(order => {
        if (!order) return false;
        if (order.is_test_order || order.do_not_recover) return false;
        if (order.status === 'cancelled' || order.payment_status === 'refunded' || order.financial_status === 'refunded') return false;
        return true;
      })
      .slice(0, 3);
  }, [orders]);

  const deliveryCount = orders.filter(order => order.fulfillment_type === 'delivery').length;
  const pickupCount = orders.filter(order => order.fulfillment_type === 'pickup').length;
  const reviewCount = orders.filter(order =>
    order.native_review_queue_summary ||
    ['review', 'review_required', 'queued_for_review', 'rejected', 'incomplete'].includes((order.native_review_status || '').toString()) ||
    order.sync_status === 'review' ||
    order.approval_status === 'review_required'
  ).length;

  return (
    <section className="px-4 mb-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black text-white">Live Customer Context</h2>
              <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-black text-emerald-950">Admin</span>
            </div>
            <p className="mt-0.5 text-[11px] font-medium text-slate-300">
              Recent operational customer/order context lives here, not on the Operations launchpad.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-1 text-right">
            <div>
              <p className="text-sm font-black text-white">{deliveryCount}</p>
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Delivery</p>
            </div>
            <div>
              <p className="text-sm font-black text-white">{pickupCount}</p>
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Pickup/POS</p>
            </div>
            <div>
              <p className="text-sm font-black text-white">{reviewCount}</p>
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Review</p>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-xl border border-slate-800 bg-slate-900" />
            ))}
          </div>
        ) : recentOrders.length === 0 ? (
          <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs font-semibold text-slate-300">
            No recent operational customer orders yet. New app, website, and POS orders will appear in this Orders view.
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {recentOrders.map(order => {
              const customerName = nameMap[order.customer_email] || order.customer_name || 'Customer name pending';
              const sourceLabel = order.source_type || order.source_channel || (order.is_native_order ? 'Customer App' : order.is_hub_order ? 'Hub' : 'Order');
              return (
                <article key={order.id || order.order_number} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[10px] font-black uppercase tracking-wider text-cyan-300">
                        #{order.order_number || 'pending'}
                      </p>
                      <p className="mt-0.5 truncate text-sm font-black text-white">{customerName}</p>
                      {order.customer_email && (
                        <p className="mt-1 flex items-center gap-1 truncate text-[11px] font-medium text-slate-300">
                          <Mail className="h-3 w-3 shrink-0 text-slate-500" />
                          {order.customer_email}
                        </p>
                      )}
                    </div>
                    <p className="shrink-0 text-xs font-black text-white">{formatCurrency(order.total)}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <AdminStatusPill label={formatStatusLabel(sourceLabel)} tone={orderSourceTone(order)} />
                    <AdminStatusPill
                      label={order.fulfillment_type === 'pickup' ? 'Pickup / POS' : formatStatusLabel(order.fulfillment_type) || 'Fulfillment'}
                      tone={order.fulfillment_type === 'pickup' ? 'source' : 'progress'}
                    />
                  </div>
                  <p className="mt-2 line-clamp-2 border-t border-slate-800 pt-2 text-[11px] font-medium text-slate-300">
                    {itemSummary(order.items)}
                  </p>
                </article>
              );
            })}
          </div>
        )}

        <div className="mt-3 flex items-start gap-2 rounded-xl border border-cyan-500/40 bg-cyan-950/50 p-2.5">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
          <p className="text-[10px] font-medium text-cyan-100">
            Read-only admin context only. No provider payloads, payment secrets, fulfillment writes, inventory actions, notifications, or sync actions are triggered here.
          </p>
        </div>
      </div>
    </section>
  );
}

function NativeOperationsPanel({ order }) {
  if (!order.is_native_order) return null;
  const taskSummary = order.native_fulfillment_task_summary || {};
  const latestSyncLog = order.native_latest_sync_log || null;
  const reviewSummary = order.native_review_queue_summary || null;
  const taskStatusSummary = Object.entries(taskSummary.status_counts || {})
    .map(([status, count]) => `${formatStatusLabel(status)}: ${count}`)
    .join(' · ');

  return (
    <div className="bg-secondary/40 rounded-xl p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Native Operations</p>
        <AdminStatusPill label="Customer App" tone="native" />
      </div>
      <InfoRow label="Payment" value={formatStatusLabel(order.payment_status)} />
      <InfoRow label="Production" value={formatStatusLabel(order.native_production_status)} />
      <InfoRow label="Fulfillment" value={formatStatusLabel(order.native_fulfillment_status)} />
      <InfoRow label="Sync" value={formatStatusLabel(order.native_sync_status)} />
      <InfoRow label="Review" value={formatStatusLabel(order.native_review_status)} />
      <InfoRow label="Source" value={formatStatusLabel(order.source_type || order.source_channel)} />
      <InfoRow label="Order Type" value={formatStatusLabel(order.order_type)} />
      <InfoRow label="Lock" value={formatStatusLabel(order.order_lock_status)} />
      <div className="pt-2 mt-2 border-t border-border/40 space-y-1.5">
        <InfoRow label="Task Count" value={taskSummary.count ? `${taskSummary.count}` : 'No native delivery task'} />
        <InfoRow label="Task Status" value={taskStatusSummary} />
        <InfoRow label="Task Delivery" value={formatDateOnly(taskSummary.next_delivery_date)} />
        <InfoRow label="Task Production" value={formatDateOnly(taskSummary.production_date)} />
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
            <AdminStatusPill value={reviewSummary.status || 'pending'} size="sm" />
          </div>
          <InfoRow label="Issue" value={formatStatusLabel(reviewSummary.incident_type)} />
          <InfoRow label="Details" value={reviewSummary.issue_description} />
          <InfoRow label="Action" value={reviewSummary.recommended_action} />
          <InfoRow label="Last Seen" value={formatDateTime(reviewSummary.last_seen_at)} />
        </div>
      )}
      <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
        Native mirror remains parallel to the Hub bridge for May 30. Use Delivery Queue and Production views for operational actions.
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
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Hub Operations</p>
        <AdminStatusPill label="Read-only" tone="hub" />
      </div>
      {hasHubOpsData ? (
        <>
          <InfoRow label="Customer App Status" value={customerAppStatusLabel || formatStatusLabel(order.status)} />
          <InfoRow label="Hub Operational Status" value={formatStatusLabel(order.hub_operational_status)} />
          <InfoRow label="Fulfillment" value={formatStatusLabel(order.hub_fulfillment_status)} />
          <InfoRow label="Production Date" value={formatDateOnly(order.production_date)} />
          <InfoRow label="Delivery" value={formatDateOnly(order.assigned_delivery_date)} />
          <InfoRow label="Window" value={order.delivery_window_label} />
          <InfoRow label="Delivered" value={formatDateTime(order.delivered_at)} />
          <InfoRow label="By" value={order.delivered_by} />
          <InfoRow label="Drop" value={order.delivery_drop_location} />
          <InfoRow label="Proof" value={proofLink} />
          <InfoRow label="Source" value={formatStatusLabel(order.source_channel)} />
          <InfoRow label="Subscription ID" value={order.stripe_subscription_id} />
          <InfoRow label="Last Hub Update" value={formatDateTime(order.hub_updated_date)} />
        </>
      ) : (
        <p className="text-xs text-muted-foreground italic">No Hub operations data yet</p>
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
        <AdminStatusPill label="Read-only" tone="hub" />
      </div>

      {!shouldFetchTasks ? (
        <p className="text-xs text-muted-foreground italic">No Hub task identifiers available</p>
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
    order.is_hub_order &&
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

  if (!order.is_hub_order) return null;

  const events = data?.events || [];

  return (
    <div className="bg-secondary/40 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Hub Timeline</p>
        <AdminStatusPill label="Read-only" tone="hub" />
      </div>

      {!shouldFetchTimeline ? (
        <p className="text-xs text-muted-foreground italic">No Hub timeline identifiers available</p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground italic">Loading Hub timeline...</p>
      ) : isError ? (
        <p className="text-xs text-destructive">Unable to load Hub timeline</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No Hub timeline events found</p>
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
                  <p className="text-xs font-semibold text-foreground">{event.label || formatStatusLabel(event.type) || 'Hub Event'}</p>
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
        toast.success('Internal Hub note appended');
      }
      setNote('');
    },
    onError: () => {
      toast.error('Unable to append internal Hub note');
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
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Internal Hub Note</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Append-only · Admin-only · Not customer-visible.</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Append-only</span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 leading-tight">Only Hub write available here</span>
        </div>
      </div>

      {!hasIdentifiers ? (
        <p className="text-xs text-muted-foreground italic">No Hub note identifiers available</p>
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

function OrderCard({ order, onAdvance, onGoBack, isAdvancing, customerName }) {
  const [expanded, setExpanded] = useState(false);
  const stages = order.fulfillment_type === 'pickup' ? PICKUP_STAGES : DELIVERY_STAGES;
  const currentIndex = stages.findIndex(s => s.key === order.status);
  const nextStage = stages[currentIndex + 1];
  const prevStage = stages[currentIndex - 1];
  const isComplete = !nextStage;

  const deliveryDateStr = order.estimated_delivery_date
    ? format(parseLocalDate(order.estimated_delivery_date), 'MMM d, yyyy')
    : null;
  const orderedDateStr = order.created_date
    ? format(new Date(order.created_date), 'MMM d, yyyy · h:mm a')
    : null;
  const itemsSummary = order.items?.length > 0
    ? order.items.map(i => `${i.title} ×${i.quantity}`).join(', ')
    : null;
  const customerAppStatusLabel = stages.find(s => s.key === order.status)?.label || formatStatusLabel(order.status);

  return (
    <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
      {/* Collapsed header — always shows complete at-a-glance info */}
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-start gap-3 p-4 text-left">
        <div className="flex-1 min-w-0 space-y-1">
          {/* Row 1: order # + status badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold">#{order.order_number}</p>
            <AdminStatusPill value={order.status} label={customerAppStatusLabel} />
            <AdminStatusPill value={order.fulfillment_type} label={order.fulfillment_type === 'pickup' ? 'Pickup' : 'Delivery'} context="source" />
            {order.is_hub_order && (
              <AdminStatusPill label="Hub" tone="hub" />
            )}
            {order.is_native_order && (
              <AdminStatusPill label="Native Ops" tone="native" />
            )}
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
              <p className="text-xs text-primary font-medium">📅 {deliveryDateStr}</p>
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

              {/* Items block */}
              <div className="bg-secondary/40 rounded-xl p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Items</p>
                <div className="space-y-1">
                  {order.items?.length > 0 ? order.items.map((item, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-foreground">{item.title} × {item.quantity}</span>
                      {item.price > 0 && <span className="font-medium text-foreground">${(item.price * item.quantity).toFixed(2)}</span>}
                    </div>
                  )) : (
                    <p className="text-xs text-muted-foreground italic">No items listed</p>
                  )}
                </div>
                {order.notes && (
                  <p className="text-[10px] text-primary mt-2 pt-2 border-t border-border/40">{order.notes}</p>
                )}
                <div className="flex justify-between text-xs font-semibold mt-2 pt-2 border-t border-border/40">
                  <span>Total</span>
                  <span>${(order.total || 0).toFixed(2)}</span>
                </div>
              </div>

              {order.is_hub_order && (
                <section className="rounded-xl border border-border/60 bg-background/70 p-3 space-y-2">
                  <SectionLabel
                    title="Hub Read-Only Context"
                    description="View-only operational data from Hub."
                    badge="Read-only"
                  />
                  <div className="space-y-2">
                    <HubOperationsPanel order={order} customerAppStatusLabel={customerAppStatusLabel} />
                    <FulfillmentTasksPanel order={order} />
                    <HubTimelinePanel order={order} />
                  </div>
                </section>
              )}

              {order.is_native_order && (
                <section className="rounded-xl border border-border/60 bg-background/70 p-3 space-y-2">
                  <SectionLabel
                    title="Native Customer App Context"
                    description="Operational mirror created in Customer App for May 30 launch processing."
                    badge="Parallel"
                  />
                  <NativeOperationsPanel order={order} />
                </section>
              )}

              <InternalHubNoteComposer order={order} />

              <section className="rounded-xl border border-border/60 bg-background/70 p-3 space-y-3">
                <SectionLabel
                  title="Customer App Order Controls"
                  description="Order workflow buttons are paused for the May 30 launch freeze. Use the dedicated Operations, Production, and Delivery Queue views for operational actions."
                  badge="Launch freeze"
                />
                <AdminStatusLegend />

                {/* Progress */}
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Progress — Step {currentIndex + 1} of {stages.length}</p>
                  <div className="flex gap-1">
                    {stages.map((stage, i) => (
                      <div key={stage.key} className={`h-1.5 flex-1 rounded-full ${i <= currentIndex ? 'bg-primary' : 'bg-border'}`} />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{stages[currentIndex]?.label}</p>
                </div>

                {/* Action buttons */}
                {ORDER_WORKFLOW_CONTROLS_FROZEN && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Generic order status buttons are disabled during launch hardening to avoid accidental customer-facing status changes. Operational fulfillment actions remain available in Delivery Queue.
                  </div>
                )}
                <div className="flex gap-2">
                  {prevStage && (
                    <button
                      onClick={() => onGoBack(order, prevStage)}
                      disabled={ORDER_WORKFLOW_CONTROLS_FROZEN || isAdvancing}
                      className="flex-1 py-3 bg-secondary text-secondary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform"
                    >
                      ← Back
                    </button>
                  )}
                  {!isComplete ? (
                    <button
                      onClick={() => onAdvance(order, nextStage)}
                      disabled={ORDER_WORKFLOW_CONTROLS_FROZEN || isAdvancing}
                      className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform"
                    >
                      {isAdvancing ? 'Updating...' : `→ ${nextStage.label}`}
                    </button>
                  ) : (
                    <div className="flex-1 py-3 bg-green-50 text-green-700 rounded-xl text-sm font-semibold text-center border border-green-200">
                      ✓ Complete
                    </div>
                  )}
                </div>
                {order.is_hub_order && (
                  <p className="text-[10px] text-muted-foreground text-center">Status workflow controls are locked for launch. Use the dedicated operational queues for approved actions.</p>
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
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('active');
  const [advancingId, setAdvancingId] = useState(null);
  const [showZone3, setShowZone3] = useState(false);

  const [search, setSearch] = useState('');

  const { data: ordersData = {}, isLoading: ordersLoading } = useQuery({
    queryKey: ['admin-orders'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminOrdersWithHub', {});
      return res.data || { orders: [], total: 0 };
    },
    enabled: user?.role === 'admin',
    refetchInterval: 30000,
  });
  const primaryOrders = ordersData.orders || [];

  const { data: deliveryFallbackData = {}, isLoading: deliveryFallbackLoading } = useQuery({
    queryKey: ['admin-orders-delivery-fallback'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminDeliveryRouteSummary', {
        delivery_date: todayIsoDate(),
        limit: 100,
      });
      return res.data || {};
    },
    enabled: user?.role === 'admin',
    refetchInterval: 30000,
  });

  const deliveryFallbackOrders = useMemo(() => {
    const sections = deliveryFallbackData.sections || {};
    return [
      ...(sections.delivery_stops || []),
      ...(sections.unscheduled_delivery_orders || []),
    ]
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

  const updateStatusMutation = useMutation({
    mutationFn: async ({ order, stage }) => {
      return {
        skipped: true,
        reason: ORDER_WORKFLOW_CONTROLS_FROZEN
          ? 'may30_order_workflow_controls_frozen'
          : 'admin_order_workflow_requires_dedicated_backend_command',
        order_number: order.order_number,
        requested_status: stage.key,
      };
    },
    onSuccess: (result, { stage, direction }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      if (result?.skipped) {
        toast.info('Order workflow controls are paused for the May 30 launch freeze.');
        setAdvancingId(null);
        return;
      }
      toast.success(direction === 'back' ? `Reverted to "${stage.label}"` : `Advanced to "${stage.label}"`);
      setAdvancingId(null);
    },
    onError: () => {
      toast.error('Failed to update status');
      setAdvancingId(null);
    },
  });



  const handleAdvance = (order, nextStage) => {
    setAdvancingId(order.id);
    updateStatusMutation.mutate({ order, stage: nextStage, direction: 'forward' });
  };

  const handleGoBack = (order, prevStage) => {
    setAdvancingId(order.id);
    updateStatusMutation.mutate({ order, stage: prevStage, direction: 'back' });
  };

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Access denied. Admins only.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-10">
      <AdminOpsHeader
        title="Order Management"
        subtitle={`${orders.length} total orders`}
        badge="Hub + Native"
        onBack={() => navigate('/account')}
      />

      <LiveCustomerContextPanel
        orders={operationalOrders}
        isLoading={isLoading}
        nameMap={nameMap}
      />

      <div className="px-4 mt-4">
        <May30ReadinessPanel
          title="One-time order operational path"
          description="Use this page to confirm future paid orders reached operations cleanly before moving to production or delivery queues."
          items={orderOpsReadinessItems}
          actions={[
            { label: 'Production Queue', to: '/admin/production-queue' },
            { label: 'Delivery Queue', to: '/admin/delivery-queue' },
            { label: 'Review / Sync Health', to: '/admin/sync-health' },
          ]}
        />
      </div>

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
            onClick={() => { setFilter(tab.key); setShowZone3(false); }}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors shrink-0 ${
              filter === tab.key && !showZone3 ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <button
          onClick={() => setShowZone3(!showZone3)}
          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors shrink-0 ${
            showZone3 ? 'bg-amber-600 text-white' : 'bg-amber-100 text-amber-800'
          }`}
        >
          🗺️ Route Review
        </button>
      </div>

      {/* Zone 3 Route Review Panel */}
      {showZone3 && (
        <div className="px-4 mb-4">
          <Zone3ReviewPanel />
        </div>
      )}

      {/* Orders List */}
      {!showZone3 && (
        <div className="px-4 space-y-3">
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
                onAdvance={handleAdvance}
                onGoBack={handleGoBack}
                isAdvancing={advancingId === order.id}
                customerName={nameMap[order.customer_email] || order.customer_name || null}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
