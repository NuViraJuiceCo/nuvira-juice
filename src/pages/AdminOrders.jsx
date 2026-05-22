import React, { useState, useMemo } from 'react';
import Zone3ReviewPanel from '@/components/admin/Zone3ReviewPanel';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { format } from 'date-fns';
import { ChevronRight, ChevronDown, ArrowLeft, Search } from 'lucide-react';
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

const STATUS_COLORS = {
  order_received: 'bg-blue-100 text-blue-700',
  scheduled_for_juicing: 'bg-purple-100 text-purple-700',
  in_production: 'bg-amber-100 text-amber-700',
  bottled_packed: 'bg-orange-100 text-orange-700',
  out_for_delivery: 'bg-cyan-100 text-cyan-700',
  arriving_soon: 'bg-teal-100 text-teal-700',
  delivered: 'bg-green-100 text-green-700',
  ready_for_pickup: 'bg-teal-100 text-teal-700',
  picked_up: 'bg-green-100 text-green-700',
};

const ACTIVE_STATUSES = ['order_received', 'scheduled_for_juicing', 'in_production', 'bottled_packed', 'out_for_delivery', 'arriving_soon', 'ready_for_pickup'];

// Orders that are NOT operational — never show in active/completed views
function isAbandonedOrUnpaid(o) {
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
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Read-only</span>
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
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Read-only</span>
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
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Read-only</span>
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
          <p className="text-[10px] text-muted-foreground mt-0.5">Admin-only. Appends to Hub ops notes. Not customer-visible.</p>
        </div>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Append-only</span>
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
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status] || 'bg-muted text-muted-foreground'}`}>
              {customerAppStatusLabel}
            </span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
              {order.fulfillment_type === 'pickup' ? 'Pickup' : 'Delivery'}
            </span>
            {order.is_hub_order && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Hub</span>
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

              <HubOperationsPanel order={order} customerAppStatusLabel={customerAppStatusLabel} />

              <InternalHubNoteComposer order={order} />

              <FulfillmentTasksPanel order={order} />

              <HubTimelinePanel order={order} />

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
              <div className="flex gap-2">
                {prevStage && (
                  <button
                    onClick={() => onGoBack(order, prevStage)}
                    disabled={isAdvancing}
                    className="flex-1 py-3 bg-secondary text-secondary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform"
                  >
                    ← Back
                  </button>
                )}
                {!isComplete ? (
                  <button
                    onClick={() => onAdvance(order, nextStage)}
                    disabled={isAdvancing}
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
                <p className="text-[10px] text-muted-foreground text-center">Status syncs to Hub</p>
              )}
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
  const [showPending, setShowPending] = useState(false);
  const [advancingId, setAdvancingId] = useState(null);
  const [showZone3, setShowZone3] = useState(false);

  const [search, setSearch] = useState('');

  const { data: ordersData = {}, isLoading } = useQuery({
    queryKey: ['admin-orders'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminOrdersWithHub', {});
      return res.data || { orders: [], total: 0 };
    },
    enabled: user?.role === 'admin',
    refetchInterval: 30000,
  });
  const orders = ordersData.orders || [];

  const { data: profiles = [] } = useQuery({
    queryKey: ['admin-user-profiles'],
    queryFn: () => base44.entities.UserProfile.list('-created_date', 500),
    enabled: user?.role === 'admin',
  });

  // Build email → name map from UserProfile
  const nameMap = useMemo(() => {
    const map = {};
    profiles.forEach(p => {
      if (p.customer_email) {
        map[p.customer_email] = [p.first_name, p.last_name].filter(Boolean).join(' ') || null;
      }
    });
    return map;
  }, [profiles]);

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
      if (order.is_hub_order) {
        // Hub-managed: send status-only update to Hub. Never touch local DB order structure.
        return base44.functions.invoke('pushOrderStatusToHub', {
          hub_order_id: order.hub_order_id || null,
          order_number: order.order_number,
          customer_email: order.hub_customer_email || order.customer_email,
          new_status: stage.key,
          stage_label: stage.label,
        });
      } else {
        // Local-only order: update status + history in local DB only
        const newHistory = [
          ...(order.status_history || []),
          { status: stage.key, timestamp: new Date().toISOString(), message: stage.label }
        ];
        return base44.entities.Order.update(order.id, {
          status: stage.key,
          status_history: newHistory,
        });
      }
    },
    onSuccess: (_, { stage, direction }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      toast.success(direction === 'back' ? `Reverted to "${stage.label}"` : `Advanced to "${stage.label}"`);
      setAdvancingId(null);
    },
    onError: (err) => {
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
      {/* Header */}
      <div className="bg-primary px-4 pt-10 pb-5">
        <button onClick={() => navigate('/account')} className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center mb-3">
          <ArrowLeft className="w-4 h-4 text-white" />
        </button>
        <h1 className="font-heading text-2xl font-bold text-primary-foreground">Order Management</h1>
        <p className="text-primary-foreground/70 text-xs mt-0.5">{orders.length} total orders</p>
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
