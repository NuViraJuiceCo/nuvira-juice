import React, { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import EmbeddedPayment from './EmbeddedPayment';
import { requestPaidRecovery } from '@/lib/paidCheckoutAttempt';

const resumable = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action']);
const unavailable = 'We could not confirm this checkout action. Please check again or contact NuVira before paying again.';

export default function PaidCheckoutRecovery({ attempt, onCancelled, onReceipt }) {
  const [proof, setProof] = useState(null);
  const [payment, setPayment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Checking your earlier checkout…');
  const alive = useRef(true);
  const inFlight = useRef(false);
  const run = async (mode) => {
    if (!attempt || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await requestPaidRecovery(payload => base44.functions.invoke('createPaymentIntent', payload), attempt, mode);
      if (!alive.current) return;
      if (mode === 'cancel_paid_checkout') { await onCancelled(attempt); return; }
      setProof(result);
      setMessage('');
      setPayment(mode === 'resume_paid_checkout' ? result : null);
    } catch {
      if (alive.current) { setPayment(null); setMessage(unavailable); }
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    if (attempt) void run('read_paid_checkout_recovery');
    else setMessage(unavailable);
    return () => { alive.current = false; };
    // The parent keys this component by the immutable attempt and auth identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openReceipt = async () => {
    try { await onReceipt(attempt, proof); }
    catch { setMessage('Your payment status is saved. We could not open its receipt here. Please contact NuVira; do not pay again.'); }
  };
  const deliveryDate = proof?.delivery_date && Number.isFinite(Date.parse(`${proof.delivery_date}T12:00:00Z`))
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${proof.delivery_date}T12:00:00Z`)) : null;
  return <section className="mx-auto my-6 w-full max-w-lg rounded-3xl border border-primary/20 bg-card p-5 shadow-lg md:p-8" aria-labelledby="paid-recovery-title">
    <p className="text-xs font-semibold uppercase tracking-widest text-primary">Your secure checkout</p>
    <h1 id="paid-recovery-title" className="mt-2 font-heading text-2xl">Let’s pick up where you left off</h1>
    <p className="mt-3 text-sm text-muted-foreground">We found an earlier checkout on this device. Resolve that attempt before starting another payment.</p>
    {message && <p role="status" className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm">{message}</p>}
    {proof && <div className="mt-5 space-y-3 text-sm">
      <p className="font-semibold">Order {proof.order_number}</p>
      <ul className="space-y-2">{proof.items.map((item, index) => <li key={index} className="flex justify-between gap-3"><span>{item.quantity} × {item.title}</span></li>)}</ul>
      <p className="border-t pt-3 font-semibold">Order total: ${proof.total.toFixed(2)}</p>
      {deliveryDate && <p>Saved delivery: {deliveryDate}{proof.delivery_window ? ` · ${proof.delivery_window}` : ''}</p>}
      <p className="text-muted-foreground">This is the saved order, not a new quote. Fulfillment is confirmed separately on your receipt.</p>
      {proof.state === 'succeeded' && <p>Your payment is confirmed by Stripe. Please don’t place this order again.</p>}
      {['processing', 'requires_capture'].includes(proof.state) && <p>Your payment is processing or awaiting capture. Don’t submit another payment.</p>}
      {proof.state === 'canceled' && <p>The payment was cancelled. Finish cancellation below to confirm any held rewards or credits are released.</p>}
    </div>}
    {payment && <div className="mt-5"><EmbeddedPayment recoverOnReturn clientSecret={payment.clientSecret} publishableKey={payment.publishableKey}
      total={payment.total} customerName={payment.customerName} customerEmail={payment.customerEmail}
      customerPhone={payment.customerPhone} isSubmitting={busy} setIsSubmitting={setBusy}
      onSuccess={() => { setPayment(null); void run('read_paid_checkout_recovery'); }}
      onError={() => setMessage('Payment was not completed. Check its status before trying again.')} /></div>}
    <div className="mt-5 flex flex-col gap-3">
      {attempt && <button type="button" disabled={busy} className="rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50"
        onClick={() => { setPayment(null); void run('read_paid_checkout_recovery'); }}>{busy ? 'Checking…' : 'Check payment status'}</button>}
      {proof && resumable.has(proof.state) && !payment && <button type="button" disabled={busy}
        className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        onClick={() => void run('resume_paid_checkout')}>Resume this secure payment</button>}
      {proof && (resumable.has(proof.state) || proof.state === 'canceled') && <button type="button" disabled={busy}
        className="py-2 text-sm underline disabled:opacity-50" onClick={() => {
          setPayment(null); void run('cancel_paid_checkout');
        }}>Cancel this attempt and edit my cart</button>}
      {proof && ['succeeded', 'requires_capture', 'processing'].includes(proof.state)
        && <button type="button" disabled={busy} className="rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground"
          onClick={openReceipt}>View this order’s receipt</button>}
      <a href="mailto:info@nuvirajuice.com" className="py-2 text-center text-sm underline">Contact NuVira for help</a>
    </div>
  </section>;
}
