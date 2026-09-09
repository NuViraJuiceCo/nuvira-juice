import React from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Clock, CheckCircle, MapPin, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEO from '@/components/SEO';

/**
 * Zone3ReviewSubmitted — shown after customer successfully authorizes a Zone 3 route review.
 * Accessed via navigate('/zone3-review-submitted', { state: { requestNumber, darId, total, address } })
 */
export default function Zone3ReviewSubmitted() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const requestNumber = params.get('request') || location.state?.requestNumber;
  const valid = /^DAR-[A-Za-z0-9-]+$/.test(requestNumber || '');
  const { data: request, isError, isLoading, refetch } = useQuery({
    queryKey: ['owned-route-review', user?.id, requestNumber], enabled: Boolean(user?.email && valid),
    refetchInterval: query => ['pending_authorization', 'pending_review'].includes(query.state.data?.status) ? 10000 : false,
    queryFn: async () => {
      const rows = await base44.entities.DeliveryApprovalRequest.filter({ request_number: requestNumber, customer_email: user.email }, undefined, 2);
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].customer_email !== user.email) throw new Error('Request not verified');
      return rows[0];
    },
  });
  const total = request?.estimated_total;
  const address = request?.delivery_address;
  const pending = request?.status === 'pending_review';
  const approved = request?.status === 'captured';
  const closed = ['denied', 'expired', 'cancelled'].includes(request?.status);
  const title = approved ? 'Delivery Approved' : closed ? 'Delivery Request Closed' : pending ? 'Route Review Submitted' : 'Confirming Your Request';

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 pb-12 text-center">
      <SEO title="Route Review Submitted" noindex={true} />

      <div className="w-20 h-20 rounded-full bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center mb-6">
        <Clock className="w-10 h-10 text-cyan-600" />
      </div>

      <h1 className="font-heading text-2xl font-bold mb-3">{title}</h1>
      <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mb-6">
        {!request ? (isLoading ? 'Checking your saved request…' : 'We cannot verify this request yet. Sign in to the account used at checkout, then open your order history. Do not place a duplicate order.')
          : approved ? 'Your route is approved. Open your order for production and delivery progress.'
          : closed ? 'This delivery request is closed. No card payment was captured. Reserved benefits were released; your bank controls when a pending authorization disappears.'
          : !pending ? 'We are waiting for secure confirmation. Do not submit another checkout while we verify this request.'
          : <>Your confirmation has been submitted. {Number(total) === 0
          ? 'No card payment is required; selected benefits stay reserved pending route approval.'
          : 'Your card is authorized only, not charged, while our team reviews delivery.'}
        We aim to respond within <strong className="text-foreground">24–48 hours</strong>.</>}
      </p>

      {request && (
        <div className="bg-secondary/50 rounded-xl px-4 py-3 mb-6 w-full max-w-xs text-left">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Request Details</p>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">Request #</span>
            <span className="font-mono font-semibold">{requestNumber}</span>
          </div>
          {total != null && (
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">{Number(total) === 0 ? 'Amount due' : 'Authorization'}</span>
              <span className="font-semibold">${Number(total).toFixed(2)}</span>
            </div>
          )}
          {address && (
            <div className="flex items-start gap-1.5 mt-2">
              <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <span className="text-xs text-muted-foreground leading-snug">{address}</span>
            </div>
          )}
        </div>
      )}

      {pending && <div className="space-y-3 w-full max-w-xs mb-6">
        <div className="flex items-start gap-3 text-left">
          <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">If approved, any card balance is captured and selected benefits are applied to your order for the agreed delivery date.</p>
        </div>
        <div className="flex items-start gap-3 text-left">
          <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">If denied or expired, reserved benefits are released and the card authorization is canceled. Your bank controls when the pending hold disappears.</p>
        </div>
        <div className="flex items-start gap-3 text-left">
          <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">You'll receive an in-app notification and email with the decision.</p>
        </div>
      </div>}

      <Button
        onClick={() => navigate('/account/orders')}
        className="w-full max-w-xs h-12 rounded-xl font-semibold mb-3"
      >
        View My Orders <ArrowRight className="w-4 h-4 ml-1" />
      </Button>

      <button onClick={() => navigate('/')} className="text-xs text-muted-foreground underline">
        Back to Home
      </button>
      {valid && user?.email && <button type="button" className="mt-4 text-sm underline" onClick={() => refetch()}>{isError ? 'Retry status check' : 'Refresh request status'}</button>}
    </div>
  );
}
