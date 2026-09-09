import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/admin-access';

export default function RouteReviewRequests() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [reasons, setReasons] = useState({});
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState('');
  const queryKey = ['admin-route-review-requests', user?.id];
  const { data, isError, isLoading, refetch } = useQuery({ queryKey,
    enabled: isAdminUser(user), staleTime: 15000,
    queryFn: async () => {
      const rows = [];
      for (let offset = 0; offset < 2000; offset += 100) {
        const page = await base44.entities.DeliveryApprovalRequest.filter({}, '-created_date', 100, offset);
        if (!Array.isArray(page)) throw new Error('Route requests could not be verified.');
        rows.push(...page);
        if (page.length < 100) return rows;
      }
      throw new Error('The request list needs a complete server read before decisions.');
    } });
  if (!isAdminUser(user)) return null;
  const requests = (data || []).filter(row => ['pending_authorization', 'pending_review'].includes(row.status)
    || (row.checkout_revision === '2026-09-09.route-review-v2' && row.review_decision && (!row.review_decision.complete || row.communications_pending)));
  const decide = async (request, kind) => {
    const reason = reasons[request.id]?.trim() || request.review_decision?.reason;
    if (!reason) { setMessage('Enter a reason before making a delivery decision.'); return; }
    setBusy(request.id); setMessage('');
    try {
      const payload = {
        dar_id: request.id, admin_decision_reason: reason,
        ...(kind === 'approve' ? { approved_delivery_fee: request.estimated_delivery_fee } : {}),
      };
      const response = kind === 'approve'
        ? await base44.functions.invoke('approveZone3DeliveryRequest', payload)
        : await base44.functions.invoke('denyZone3DeliveryRequest', payload);
      const result = response?.data || response;
      if (result?.success !== true) throw new Error(result?.error || result?.message || 'Decision was not confirmed.');
      setMessage(kind === 'approve' ? 'Approval confirmed. Order fulfillment is handled by the verified checkout flow.'
        : request.communications_pending ? 'Customer update confirmed.' : 'Denial confirmed. Payment and reserved benefits were released.');
    } catch (error) {
      setMessage(error?.response?.data?.error || error?.message || 'Decision is not confirmed. Check status before retrying.');
    } finally { setBusy(null); await queryClient.invalidateQueries({ queryKey }); }
  };
  return <section className="mx-4 mt-5 rounded-2xl border border-cyan-500/25 bg-cyan-500/5 p-4">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Delivery route requests{data ? ` · ${requests.length}` : ''}</h2>
      <button type="button" className="text-xs underline" disabled={Boolean(busy)} onClick={() => refetch()}>Refresh</button></div>
    {isLoading && <p className="mt-3 text-sm">Checking route requests…</p>}
    {isError && <p className="mt-3 text-sm text-destructive" role="alert">Route requests could not be loaded. Refresh before making a decision.</p>}
    {message && <p className="mt-3 text-sm" role="status">{message}</p>}
    {data && !requests.length && <p className="mt-3 text-xs text-muted-foreground">No delivery route requests awaiting a decision.</p>}
    <div className="mt-3 grid gap-3 lg:grid-cols-2">{requests.map(request => <article key={request.id} className="rounded-xl border bg-background p-4">
      <p className="font-semibold">{request.request_number}</p>
      <p className="text-xs text-muted-foreground">{request.customer_name || request.customer_email} · {request.status.replaceAll('_', ' ')}</p>
      <p className="mt-2 text-sm">{request.delivery_address}</p>
      {request.requested_delivery_date && <p className="mt-2 text-sm">Requested delivery: {request.requested_delivery_date} · {request.requested_delivery_window}</p>}
      <p className="mt-2 text-sm">{(request.cart_items || []).map(item => `${item.quantity} × ${item.title}`).join(', ')}</p>
      <p className="mt-2 text-sm">Customer-confirmed total: ${Number(request.estimated_total || 0).toFixed(2)} · delivery ${Number(request.estimated_delivery_fee || 0).toFixed(2)}</p>
      {request.authorization_expires_at && <p className="mt-1 text-xs text-muted-foreground">Authorization expires: {new Date(request.authorization_expires_at).toLocaleString()}</p>}
      <p className="mt-2 text-xs text-muted-foreground">Approval preserves the checkout price and delivery date. A changed price or expired delivery window needs a new customer confirmation.</p>
      <label className="mt-3 block text-xs">Decision reason<textarea className="mt-1 block w-full rounded-lg border bg-background p-2 text-sm" maxLength={1000}
        value={reasons[request.id] ?? request.review_decision?.reason ?? ''} disabled={Boolean(busy) || Boolean(request.review_decision)}
        onChange={event => setReasons(current => ({ ...current, [request.id]: event.target.value }))} /></label>
      <div className="mt-3 flex flex-wrap gap-2">
        {request.status === 'pending_review' && (!request.review_decision || request.review_decision.kind === 'approve') && <button type="button" disabled={Boolean(busy)}
          className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" onClick={() => decide(request, 'approve')}>
          {request.review_decision ? 'Retry approval' : Number(request.estimated_total) === 0 ? 'Approve reward order' : 'Approve and capture'}</button>}
        {(!request.review_decision || request.review_decision.kind === 'deny'
          || (request.status === 'expired' && request.review_decision.kind === 'expire' && request.communications_pending)) && <button type="button" disabled={Boolean(busy)} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
          onClick={() => decide(request, 'deny')}>{request.communications_pending ? 'Retry customer update' : 'Deny and release'}</button>}
      </div>
    </article>)}</div>
  </section>;
}
