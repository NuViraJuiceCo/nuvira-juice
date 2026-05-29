import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Clock, CheckCircle, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';

const STATUS_COLORS = {
  pending_authorization: 'bg-yellow-100 text-yellow-700',
  pending_review: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-700',
  captured: 'bg-green-100 text-green-700',
  denied: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-gray-100 text-gray-500',
};

const STATUS_LABELS = {
  pending_authorization: 'Awaiting Auth',
  pending_review: 'Pending Review',
  approved: 'Approved',
  captured: 'Captured',
  denied: 'Denied',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

const ROUTE_REVIEW_DECISIONS_FROZEN = true;

function DARCard({ dar, onApprove, onDeny, isProcessing }) {
  const [expanded, setExpanded] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState(dar.estimated_delivery_fee ?? 12.99);
  const [reason, setReason] = useState('');

  const isPendingReview = dar.status === 'pending_review';
  const isSubscriptionReview = dar.request_type === 'subscription_route_review';
  const createdAt = dar.created_date ? format(new Date(dar.created_date), 'MMM d · h:mm a') : '—';
  const expiresAt = dar.authorization_expires_at
    ? format(new Date(dar.authorization_expires_at), 'MMM d, yyyy')
    : '—';

  return (
    <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-start gap-3 p-4 text-left">
        <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
          <MapPin className="w-4 h-4 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-sm font-bold">{dar.request_number}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[dar.status] || 'bg-muted text-muted-foreground'}`}>
              {STATUS_LABELS[dar.status] || dar.status}
            </span>
            {isSubscriptionReview && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                Subscription
              </span>
            )}
          </div>
          <p className="text-sm font-semibold truncate">{dar.customer_name || dar.customer_email}</p>
          <p className="text-xs text-muted-foreground truncate">{dar.delivery_address}</p>
          <div className="flex gap-3 mt-0.5 flex-wrap">
            <span className="text-xs text-muted-foreground">{dar.estimated_distance_miles?.toFixed(1)} mi</span>
            {isSubscriptionReview
              ? <span className="text-xs font-semibold text-blue-700">{dar.selected_plan_name || '—'} · ${dar.selected_plan_price}/{dar.selected_plan_frequency === 'weekly' ? 'wk' : 'mo'}</span>
              : <span className="text-xs font-semibold text-amber-700">${(dar.amount_authorized || dar.estimated_total || 0).toFixed(2)} hold</span>
            }
            <span className="text-xs text-muted-foreground">{createdAt}</span>
          </div>
        </div>
        <div className="shrink-0 pt-0.5">
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
            <div className="border-t border-border/40 px-4 pb-4 pt-3 space-y-3">

              {/* Customer + Zone Details */}
              <div className="bg-secondary/40 rounded-xl p-3 space-y-1.5 text-xs">
                <p className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Details</p>
                <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span className="font-medium">{dar.customer_email}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span className="font-medium">{dar.customer_phone || '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Distance</span><span className="font-medium">{dar.estimated_distance_miles?.toFixed(1)} mi · {dar.estimated_drive_time_minutes} min</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Zone</span><span className="font-medium">{dar.zone_name || dar.zone_key}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Est. Fee</span><span className="font-medium">${(dar.estimated_delivery_fee || 0).toFixed(2)}</span></div>
                {isSubscriptionReview ? (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">Plan</span><span className="font-semibold text-blue-700">{dar.selected_plan_name || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Plan Price</span><span className="font-medium">${(dar.selected_plan_price || 0).toFixed(2)}/{dar.selected_plan_frequency === 'weekly' ? 'wk' : 'mo'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Provider ID</span><span className="font-medium text-[10px] text-muted-foreground">Hidden in admin summary</span></div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">Cart</span><span className="font-medium">${(dar.cart_subtotal || 0).toFixed(2)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Auth Hold</span><span className="font-semibold text-amber-700">${(dar.amount_authorized || 0).toFixed(2)}</span></div>
                    {dar.amount_capturable != null && (
                      <div className="flex justify-between"><span className="text-muted-foreground">Capturable</span><span className="font-medium">${(dar.amount_capturable || 0).toFixed(2)}</span></div>
                    )}
                    <div className="flex justify-between"><span className="text-muted-foreground">Auth Expires</span><span className="font-medium">{expiresAt}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Provider ID</span><span className="font-medium text-[10px] text-muted-foreground">Hidden in admin summary</span></div>
                  </>
                )}
              </div>

              {/* Cart Items */}
              {dar.cart_items?.length > 0 && (
                <div className="bg-secondary/40 rounded-xl p-3">
                  <p className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Cart Items</p>
                  {dar.cart_items.map((item, i) => (
                    <div key={i} className="flex justify-between text-xs mb-1">
                      <span>{item.quantity}× {item.title}</span>
                      <span className="font-medium">${(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Approve / Deny actions — only for pending_review */}
              {isPendingReview && (
                <div className="space-y-3 pt-1">
                  {ROUTE_REVIEW_DECISIONS_FROZEN && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Route review approval/denial actions are paused for the May 30 launch freeze. Existing requests remain visible for admin review.
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">Delivery Fee to Capture</label>
                    <div className="flex gap-2 flex-wrap">
                      {[12.99, 15.99].map(fee => (
                        <button
                          key={fee}
                          onClick={() => setDeliveryFee(fee)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                            deliveryFee === fee
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-secondary text-secondary-foreground border-border'
                          }`}
                        >
                          ${fee.toFixed(2)}
                        </button>
                      ))}
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={deliveryFee}
                        onChange={e => setDeliveryFee(parseFloat(e.target.value) || 0)}
                        className="w-24 h-8 px-3 rounded-xl border border-border bg-card text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder="Custom"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">Decision Reason (required)</label>
                    <textarea
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="e.g. Route is viable on Saturdays, approved for weekly delivery"
                      className="w-full h-16 px-3 py-2 rounded-xl border border-border bg-card text-xs focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={() => onDeny(dar.id, reason)}
                      disabled={ROUTE_REVIEW_DECISIONS_FROZEN || isProcessing || !reason.trim()}
                      variant="outline"
                      className="flex-1 h-10 rounded-xl text-sm font-semibold border-destructive/30 text-destructive hover:bg-destructive/10"
                    >
                      <XCircle className="w-4 h-4 mr-1.5" />
                      Deny
                    </Button>
                    <Button
                      onClick={() => onApprove(dar.id, deliveryFee, reason, isSubscriptionReview)}
                      disabled={ROUTE_REVIEW_DECISIONS_FROZEN || isProcessing || !reason.trim()}
                      className="flex-1 h-10 rounded-xl text-sm font-semibold bg-green-700 hover:bg-green-800 text-white"
                    >
                      <CheckCircle className="w-4 h-4 mr-1.5" />
                      {isProcessing ? 'Processing…' : isSubscriptionReview
                        ? `Approve Sub · +$${deliveryFee.toFixed(2)} fee`
                        : `Approve · $${(dar.cart_subtotal + deliveryFee).toFixed(2)}`
                      }
                    </Button>
                  </div>
                </div>
              )}

              {/* Non-actionable status info */}
              {!isPendingReview && (
                <div className="text-xs text-muted-foreground text-center py-2">
                  {dar.status === 'captured' && `✅ Approved by ${dar.approved_by || '—'} · Order: ${dar.created_order_number || '—'}`}
                  {dar.status === 'denied' && `❌ Denied by ${dar.denied_by || '—'}`}
                  {dar.status === 'expired' && `⏰ Expired — authorization released`}
                  {dar.status === 'pending_authorization' && `⏳ Waiting for customer to complete card authorization`}
                  {dar.admin_decision_reason && (
                    <p className="mt-1 italic">"{dar.admin_decision_reason}"</p>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Zone3ReviewPanel() {
  const queryClient = useQueryClient();

  const { data: dars = [], isLoading } = useQuery({
    queryKey: ['zone3-dars'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminLaunchReadOnlySummary', {
        resource: 'zone3_reviews',
      });
      const payload = res?.data || res;
      return Array.isArray(payload?.rows) ? payload.rows : [];
    },
    refetchInterval: 30000,
  });

  const [processingId, setProcessingId] = useState(null);

  const approveMutation = useMutation({
    mutationFn: ({ dar_id, approved_delivery_fee, admin_decision_reason, is_subscription }) => {
      const fn = is_subscription ? 'approveZone3SubscriptionRequest' : 'approveZone3DeliveryRequest';
      return base44.functions.invoke(fn, { dar_id, approved_delivery_fee, admin_decision_reason });
    },
    onSuccess: (res, vars) => {
      if (res.data?.success) {
        const msg = vars.is_subscription
          ? `Subscription route approved · Customer notified to complete payment`
          : `Route approved · Order ${res.data.order_number}`;
        toast.success(msg);
        queryClient.invalidateQueries({ queryKey: ['zone3-dars'] });
      } else {
        toast.error(res.data?.error || 'Approval failed');
      }
      setProcessingId(null);
    },
    onError: (err) => { toast.error(err.message || 'Approval failed'); setProcessingId(null); },
  });

  const denyMutation = useMutation({
    mutationFn: ({ dar_id, admin_decision_reason }) =>
      base44.functions.invoke('denyZone3DeliveryRequest', { dar_id, admin_decision_reason }),
    onSuccess: (res) => {
      if (res.data?.success) {
        toast.success('Request denied · Customer notified');
        queryClient.invalidateQueries({ queryKey: ['zone3-dars'] });
      } else {
        toast.error(res.data?.error || 'Denial failed');
      }
      setProcessingId(null);
    },
    onError: (err) => { toast.error(err.message || 'Denial failed'); setProcessingId(null); },
  });

  const handleApprove = (darId, deliveryFee, reason, isSubscription = false) => {
    if (!reason?.trim()) { toast.error('Reason is required'); return; }
    setProcessingId(darId);
    approveMutation.mutate({ dar_id: darId, approved_delivery_fee: deliveryFee, admin_decision_reason: reason, is_subscription: isSubscription });
  };

  const handleDeny = (darId, reason) => {
    if (!reason?.trim()) { toast.error('Reason is required'); return; }
    setProcessingId(darId);
    denyMutation.mutate({ dar_id: darId, admin_decision_reason: reason });
  };

  const pending = dars.filter(d => d.status === 'pending_review');
  const pendingAuth = dars.filter(d => d.status === 'pending_authorization');
  const resolved = dars.filter(d => ['captured', 'denied', 'expired', 'cancelled'].includes(d.status));

  if (isLoading) return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Pending Review — requires action */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-amber-600" />
          <h3 className="text-sm font-bold">Pending Review ({pending.length})</h3>
          {pending.length > 0 && (
            <span className="w-5 h-5 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{pending.length}</span>
          )}
        </div>
        {pending.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6 bg-secondary/30 rounded-xl">No requests pending review</p>
        ) : (
          <div className="space-y-3">
            {pending.map(dar => (
              <DARCard
                key={dar.id}
                dar={dar}
                onApprove={handleApprove}
                onDeny={handleDeny}
                isProcessing={processingId === dar.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Awaiting authorization (card not entered yet) */}
      {pendingAuth.length > 0 && (
        <div>
          <h3 className="text-sm font-bold mb-3 text-muted-foreground">Awaiting Authorization ({pendingAuth.length})</h3>
          <div className="space-y-3">
            {pendingAuth.map(dar => (
              <DARCard key={dar.id} dar={dar} onApprove={handleApprove} onDeny={handleDeny} isProcessing={processingId === dar.id} />
            ))}
          </div>
        </div>
      )}

      {/* Resolved */}
      {resolved.length > 0 && (
        <div>
          <h3 className="text-sm font-bold mb-3 text-muted-foreground">Resolved ({resolved.length})</h3>
          <div className="space-y-3">
            {resolved.slice(0, 20).map(dar => (
              <DARCard key={dar.id} dar={dar} onApprove={handleApprove} onDeny={handleDeny} isProcessing={processingId === dar.id} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
