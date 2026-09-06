import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Gift, LockKeyhole, MapPin } from 'lucide-react';
import OrderItemThumbnail from '@/components/orders/OrderItemThumbnail';
import './checkout-experience.css';

const CheckoutDockContext = createContext(null);

export function CheckoutAddress({ address, saved, children }) {
  const [editing, setEditing] = useState(true);
  const initialized = useRef(false);
  useEffect(() => {
    if (saved && !initialized.current) {
      initialized.current = true;
      if (address.street && address.city && address.state && address.zip) setEditing(false);
    }
  }, [saved, address]);
  return <div>
    {!editing && <div className="nv-checkout-saved-address"><MapPin size={17} aria-hidden="true" /><div><strong>{address.street}</strong><span>{[address.city, address.state, address.zip].filter(Boolean).join(', ')}</span></div><button type="button" onClick={() => setEditing(true)}>Edit address</button></div>}
    <div hidden={!editing}>{children}</div>
  </div>;
}

// Stays inside its original form: Stripe owns submission, locking and validation.
// Other EmbeddedPayment consumers retain their original inline submit button.
export function CheckoutAction({ children }) {
  const dock = useContext(CheckoutDockContext);
  if (!dock) return children;
  return (
    <div className={`nv-checkout-dock${dock.keyboardOpen ? ' nv-keyboard-open' : ''}`}>
      <div className="nv-checkout-dock-inner">
        <div className="nv-checkout-total"><span>{dock.confirmed ? 'Total to pay' : 'Estimated total'}</span><strong>${dock.total.toFixed(2)}</strong></div>
        <div className="nv-checkout-action">{children}</div>
      </div>
      <p><LockKeyhole size={11} aria-hidden="true" /> Secure checkout with Stripe</p>
    </div>
  );
}

export default function CheckoutExperience({
  children, items, total, paymentReady, locked, memberReady, contactReady,
  contactSummary, deliverySummary, deliveryReady, deliveryMessage,
  onBack, summary, benefits, benefitsLabel, guest, contact, delivery, payment,
}) {
  const [step, setStep] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [contactError, setContactError] = useState(false);
  const initializedMember = useRef(false);
  const sections = useRef([]);
  const orderDetails = useRef(null);
  const activeStep = paymentReady ? 2 : step;

  useEffect(() => {
    const wide = window.matchMedia('(min-width: 900px)');
    const update = () => { if (orderDetails.current) orderDetails.current.open = wide.matches; };
    update();
    wide.addEventListener('change', update);
    return () => wide.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (memberReady && !initializedMember.current) {
      initializedMember.current = true;
      setStep(1);
    }
  }, [memberReady]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const editing = /^(INPUT|TEXTAREA|SELECT|IFRAME)$/.test(document.activeElement?.tagName || '');
      setKeyboardOpen(Boolean(editing && viewport && window.innerHeight - viewport.height > 120));
    };
    viewport?.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);

  const moveTo = (next) => {
    if (locked || paymentReady) return;
    setStep(next);
    requestAnimationFrame(() => {
      sections.current[next]?.scrollIntoView({ block: 'start' });
      sections.current[next]?.querySelector('h2')?.focus({ preventScroll: true });
    });
  };
  const continueContact = () => {
    setContactError(!contactReady);
    if (contactReady) moveTo(1);
    else sections.current[0]?.querySelector('input')?.focus();
  };
  const titles = ['Contact', 'Delivery', 'Payment'];
  const subtitles = [contactSummary || 'Receipt and order updates', deliverySummary || 'Choose where and when', paymentReady ? 'Choose your secure payment method' : 'Review, then securely pay'];
  const bodies = [contact, delivery, payment];

  return (
    <CheckoutDockContext.Provider value={{ total, confirmed: paymentReady, keyboardOpen }}>
      <div className="nv-checkout-page">
        {children}
        <main className="nv-checkout-content">
          <header className="nv-checkout-header">
            <button type="button" onClick={onBack} disabled={locked} aria-label="Back to cart"><ArrowLeft size={19} /></button>
            <span>NUVIRA JUICE CO.</span><LockKeyhole size={17} aria-label="Secure checkout" />
          </header>
          <div className="nv-checkout-intro"><h1>Checkout</h1><p>A little goodness, delivered.</p></div>
          <div className="nv-checkout-layout">
          <aside className="nv-checkout-sidebar" aria-label="Order and offers">
          <section className="nv-checkout-order" aria-label="Your order">
            <details ref={orderDetails}>
              <summary>
                <span className="nv-checkout-thumbnails" aria-hidden="true">{items.slice(0, 2).map(item => <OrderItemThumbnail key={item.cart_line_key || item.product_id} item={item} />)}</span>
                <span className="nv-checkout-order-label"><strong>Your order</strong><small>{items.reduce((count, item) => count + Number(item.quantity || 0), 0)} items · View details</small></span>
                <strong className="nv-checkout-order-total">${total.toFixed(2)}<ChevronDown size={14} aria-hidden="true" /></strong>
              </summary>
              <div className="nv-checkout-slot nv-checkout-summary">{summary}</div>
            </details>
            <details className="nv-checkout-benefits">
              <summary><Gift size={16} aria-hidden="true" /><span>{benefitsLabel}</span><ChevronDown size={14} aria-hidden="true" /></summary>
              <fieldset disabled={locked || paymentReady} className="nv-checkout-slot">{benefits}</fieldset>
              {paymentReady && <p className="nv-checkout-note">To change rewards or a code, choose Edit order details below.</p>}
            </details>
          </section>
          {guest && <details className="nv-checkout-guest"><summary>No account needed · Earn rewards on this order <ChevronDown size={14} /></summary><div className="nv-checkout-slot">{guest}</div></details>}
          </aside>
          <div className="nv-checkout-steps">
          {titles.map((title, index) => (
            <section key={title} ref={element => { sections.current[index] = element; }} className={`nv-checkout-section${activeStep === index ? ' nv-checkout-active' : ''}`}>
              <div className="nv-checkout-section-head">
                <span className={`nv-checkout-step${activeStep > index ? ' nv-checkout-done' : ''}`}>{activeStep > index ? <Check size={14} /> : index + 1}</span>
                <div><h2 tabIndex={-1}>{title}</h2><p>{subtitles[index]}</p></div>
                {activeStep > index && !paymentReady && <button type="button" disabled={locked} onClick={() => moveTo(index)} aria-label={`Edit ${title.toLowerCase()}`}>Edit</button>}
              </div>
              <div hidden={activeStep !== index} className="nv-checkout-section-body nv-checkout-slot">
                <fieldset disabled={index < 2 && (locked || paymentReady)}>{bodies[index]}</fieldset>
                {index === 0 && contactError && !contactReady && <p role="alert" className="nv-checkout-error">Please enter your email, first and last name, and phone number to continue.</p>}
                {index === 1 && !deliveryReady && <p className="nv-checkout-note" role="status">{deliveryMessage}</p>}
              </div>
            </section>
          ))}
          {!paymentReady && activeStep === 0 && <CheckoutAction><button type="button" disabled={locked} onClick={continueContact}>Continue to delivery →</button></CheckoutAction>}
          {!paymentReady && activeStep === 1 && <CheckoutAction><button type="button" disabled={locked || !deliveryReady || !contactReady} onClick={() => moveTo(2)}>Continue to payment →</button></CheckoutAction>}
          <p className="nv-checkout-security"><LockKeyhole size={13} aria-hidden="true" /> Your payment details stay with Stripe.</p>
          </div>
          </div>
        </main>
      </div>
    </CheckoutDockContext.Provider>
  );
}
