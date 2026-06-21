import React, { useState, useRef } from 'react';
import SEO from '@/components/SEO';
import EmbeddedPayment from '@/components/checkout/EmbeddedPayment';
import ApplePayMountDiagnostic from '@/components/checkout/ApplePayMountDiagnostic';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Truck, Gift } from 'lucide-react';
import BagReturnSelector from '@/components/checkout/BagReturnSelector';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { Label } from '@/components/ui/label';
import { useCart } from '@/lib/cartContext';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { Switch } from '@/components/ui/switch';
import { base44 } from '@/api/base44Client';
import { redirectToLogin } from '@/lib/nativeAuthRedirect';
import DeliveryDatePicker from '@/components/checkout/DeliveryDatePicker';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { AnimatePresence } from 'framer-motion';
import OutOfAreaModal from '@/components/checkout/OutOfAreaModal';
import Zone3RouteReviewPanel from '@/components/checkout/Zone3RouteReviewPanel';
import { HEALTH_ADVISORY_CONFIG } from '@/components/HealthAdvisory';


export default function Checkout() {
  const { user, isLoadingAuth } = useAuth();
  const diagnosticRequested = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('apple_pay_mount_diagnostic') === '1';
  const diagnosticAuthorized = user?.role === 'admin' || user?.role === 'owner';

  if (diagnosticRequested) {
    return (
      <ApplePayMountDiagnostic
        isAuthLoading={isLoadingAuth}
        isAuthorized={diagnosticAuthorized}
      />
    );
  }

  return <CheckoutFlow />;
}

function CheckoutFlow() {
  const navigate = useNavigate();

  // DIAGNOSTIC: dump all checkout-related storage keys on mount
  React.useEffect(() => {
    console.group('[NuVira Checkout] Storage Audit on Mount');
    const lsKeys = Object.keys(localStorage).filter(k =>
      k.includes('nuvira') || k.includes('stripe') || k.includes('checkout') || k.includes('session') || k.includes('client_secret') || k.includes('pending')
    );
    const ssKeys = Object.keys(sessionStorage).filter(k =>
      k.includes('nuvira') || k.includes('stripe') || k.includes('checkout') || k.includes('session') || k.includes('client_secret') || k.includes('pending')
    );
    console.log('localStorage matching keys  :', lsKeys.length ? lsKeys : '(none)');
    lsKeys.forEach(k => console.log(`  localStorage["${k}"] =`, localStorage.getItem(k)));
    console.log('sessionStorage matching keys:', ssKeys.length ? ssKeys : '(none)');
    ssKeys.forEach(k => console.log(`  sessionStorage["${k}"] =`, sessionStorage.getItem(k)));
    console.groupEnd();

    // Force-nuke any stale pending session to guarantee a fresh PI
    localStorage.removeItem('nuvira_pending_checkout_session');
    sessionStorage.removeItem('nuvira_pending_checkout_session');
  }, []);

  // Safety net 1: if Stripe redirected back to /checkout with session_id in URL
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    const orderNumber = params.get('order_number');
    if (sessionId) {
      const dest = `/order-confirmation?session_id=${sessionId}${orderNumber ? `&order_number=${orderNumber}` : ''}`;
      navigate(dest, { replace: true });
      return;
    }
    // Safety net 2: detect pending session stored before Stripe redirect (PWA resume case)
    const pending = localStorage.getItem('nuvira_pending_checkout_session');
    if (pending) {
      try {
        const { session_id: sid, order_number: onum, timestamp } = JSON.parse(pending);
        // Only act on sessions < 30 minutes old
        if (sid && Date.now() - timestamp < 30 * 60 * 1000) {
          localStorage.removeItem('nuvira_pending_checkout_session');
          const dest = `/order-confirmation?session_id=${sid}${onum ? `&order_number=${onum}` : ''}`;
          navigate(dest, { replace: true });
        } else {
          localStorage.removeItem('nuvira_pending_checkout_session');
        }
      } catch {
        localStorage.removeItem('nuvira_pending_checkout_session');
      }
    }
  }, []);

  const { items, subtotal, clearCart } = useCart();
  const { user } = useAuth();
  const fulfillmentType = 'delivery';
  const [address, setAddress] = useState({ street: '', city: '', state: '', zip: '' });
  const [phone, setPhone] = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clientSecret, setClientSecret] = useState(null);
  const [publishableKey, setPublishableKey] = useState(null);
  const [pendingOrderNumber, setPendingOrderNumber] = useState(null);
  const [paymentTotal, setPaymentTotal] = useState(0);
  const [confirmedDeliverySchedule, setConfirmedDeliverySchedule] = useState(null);
  const [usePoints, setUsePoints] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);
  const [bagReturn, setBagReturn] = useState({ smallBags: 0, toteBags: 0 });
  const [useCredits, setUseCredits] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const [referralApplied, setReferralApplied] = useState(false);
  const [addressValidated, setAddressValidated] = useState(false);
  const [validatingAddress, setValidatingAddress] = useState(false);
  const [deliveryZone, setDeliveryZone] = useState(null);
  // Full eligibility result from validateDeliveryEligibility
  const [zoneEligibility, setZoneEligibility] = useState(null);
  const [healthAdvisoryAcknowledged, setHealthAdvisoryAcknowledged] = useState(false);
  const [selectedDeliveryOption, setSelectedDeliveryOption] = useState(null);
  const [scheduleOptionsOverride, setScheduleOptionsOverride] = useState(null);
  // Stable idempotency key for this checkout session — generated once on mount,
  // reused on retries so duplicate calls to createPaymentIntent return the same PI.
  const checkoutIdempotencyKey = React.useRef(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `nv-checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const REFERRAL_DISCOUNT = 5.00;
  const referralDiscount = referralApplied ? REFERRAL_DISCOUNT : 0;

  const activeReward = React.useMemo(() => {
    if (!user?.email) return null;
    try { return JSON.parse(localStorage.getItem(`activeReward_${user.email}`)) || null; } catch { return null; }
  }, [user?.email]);

  const { data: userProfile } = useQuery({
    queryKey: ['user-profile-checkout', user?.email],
    queryFn: async () => {
      const profiles = await base44.entities.UserProfile.filter({ customer_email: user?.email });
      return profiles[0] || null;
    },
    enabled: !!user?.email,
  });

  // Pre-populate fields from saved profile once
  React.useEffect(() => {
    if (prefilled || !user) return;
    if (!userProfile) return;
    if (userProfile?.phone) setPhone(userProfile.phone);
    if (userProfile?.address) {
      const parts = userProfile.address.split(',').map(s => s.trim());
      setAddress({ street: parts[0]||'', city: parts[1]||'', state: parts[2]||'', zip: parts[3]||'' });
    }
    if (userProfile?.sms_consent) setSmsConsent(true);
    setPrefilled(true);
  }, [userProfile, user, prefilled]);

  // Validate address in real-time for delivery orders
  const addressDebounceRef = React.useRef(null);
  const [hasShownOutOfAreaModal, setHasShownOutOfAreaModal] = React.useState(false);
  
  React.useEffect(() => {
    if (fulfillmentType !== 'delivery') {
      setAddressValidated(true);
      return;
    }

    const addrString = [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ');
    if (!addrString.trim() || addrString.length < 5) {
      setAddressValidated(false);
      setZoneEligibility(null);
      setDeliveryZone(null);
      setHasShownOutOfAreaModal(false);
      return;
    }

    if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
    setValidatingAddress(true);
    // Clear previous result while re-validating
    setZoneEligibility(null);
    setAddressValidated(false);

    addressDebounceRef.current = setTimeout(async () => {
      try {
        const res = await base44.functions.invoke('validateDeliveryEligibility', {
          delivery_address: addrString,
          address_line1: address.street || '',
          address_city: address.city || '',
          address_state: address.state || '',
          address_postal_code: address.zip || '',
          cart_subtotal: subtotal || 0,
          order_type: 'one_time',
        });
        const eligibility = res.data;
        setZoneEligibility(eligibility);

        // Zone 1 & Zone 2 (minimum met) → valid for checkout
        const isValid = !!eligibility?.checkout_allowed &&
          (eligibility.zone_type === 'core' || eligibility.zone_type === 'extended');

        setAddressValidated(isValid);
        setDeliveryZone(isValid ? { fee: eligibility.delivery_fee ?? 0, distance: eligibility.estimated_distance_miles } : null);

        // Show out-of-area modal for waitlist/unavailable
        if (eligibility?.zone_type === 'waitlist_only' && !hasShownOutOfAreaModal) {
          setHasShownOutOfAreaModal(true);
          setShowOutOfArea(true);
        }
      } catch (err) {
        console.error('Address validation error:', err);
        setAddressValidated(false);
        setZoneEligibility(null);
        setDeliveryZone(null);
      } finally {
        setValidatingAddress(false);
      }
    }, 800);

    return () => clearTimeout(addressDebounceRef.current);
  }, [address, fulfillmentType, subtotal, hasShownOutOfAreaModal]);

  const {
    data: scheduleOptionsPayload,
    isLoading: scheduleOptionsLoading,
  } = useQuery({
    queryKey: ['checkout-schedule-options'],
    queryFn: async () => {
      const res = await base44.functions.invoke('calculateNuViraFulfillmentSchedule', {
        mode: 'options',
        created_at: new Date().toISOString(),
        option_count: 2,
      });
      const data = res?.data || res;
      if (!data?.ok || !Array.isArray(data.options)) {
        throw new Error(data?.error || 'Could not load delivery windows');
      }
      return data;
    },
    staleTime: 60 * 1000,
  });

  const { data: userCreditsData } = useQuery({
    queryKey: ['nuvira-credits-checkout', user?.email],
    queryFn: async () => {
      const res = await base44.entities.NuViraCredit.filter({ customer_email: user?.email });
      return res[0] || null;
    },
    enabled: !!user?.email,
  });

  const { data: lastOrderData = [] } = useQuery({
    queryKey: ['last-order-checkout', user?.email],
    queryFn: () => base44.entities.Order.filter({ customer_email: user?.email }, '-created_date', 1),
    enabled: !!user?.email,
  });

  const { data: userPointsData } = useQuery({
    queryKey: ['user-points', user?.email],
    queryFn: () => base44.entities.UserPoints.filter({ customer_email: user?.email }),
    enabled: !!user?.email,
  });

  // Fetch active subscription + plan to apply perks
  const { data: activeSubscription } = useQuery({
    queryKey: ['active-subscription', user?.email],
    queryFn: async () => {
      const subs = await base44.entities.Subscription.filter({ customer_email: user.email, status: 'active' });
      if (!subs.length) return null;
      const plans = await base44.entities.SubscriptionPlan.list();
      const plan = plans.find(p => p.id === subs[0].plan_id);
      return { ...subs[0], plan };
    },
    enabled: !!user?.email,
  });

  const subDiscountPct = activeSubscription?.plan?.discount_percent || 0;
  const subFreeDelivery = subDiscountPct > 0; // any discounted plan also gets free delivery

  const availablePoints = userPointsData?.[0]?.total_points || 0;
  // 100 pts = $1
  const maxDiscount = Math.floor(availablePoints / 100);
  const pointsDiscount = usePoints ? Math.min(maxDiscount, subtotal) : 0;
  const pointsUsed = pointsDiscount * 100;

  const deliveryOptions = scheduleOptionsOverride || scheduleOptionsPayload?.options || [];
  React.useEffect(() => {
    if (!deliveryOptions.length) {
      if (selectedDeliveryOption) setSelectedDeliveryOption(null);
      return;
    }
    const selectedStillValid = selectedDeliveryOption?.option_id &&
      deliveryOptions.some(option => option.option_id === selectedDeliveryOption.option_id);
    if (!selectedStillValid) {
      setSelectedDeliveryOption(deliveryOptions.find(option => option.is_default) || deliveryOptions[0]);
    }
  }, [deliveryOptions, selectedDeliveryOption]);
  const selectedDeliveryLabel = selectedDeliveryOption?.delivery_date
    ? format(new Date(selectedDeliveryOption.delivery_date + 'T12:00:00'), 'EEEE, MMMM d')
    : null;

  const rewardFreeDelivery = activeReward?.reward_type === 'free_delivery';
  const rewardDiscountPct = activeReward?.reward_type === 'discount' ? 10 : 0;
  const rewardDiscountAmt = rewardDiscountPct > 0 ? subtotal * rewardDiscountPct / 100 : 0;
  const baseFee = zoneEligibility?.delivery_fee ?? deliveryZone?.fee ?? 0;
  const deliveryFee = (fulfillmentType === 'delivery' && !rewardFreeDelivery && !subFreeDelivery) ? baseFee : 0;
  const subDiscountAmt = subDiscountPct > 0 ? Math.round(subtotal * subDiscountPct) / 100 : 0;
  const availableCredits = userCreditsData?.balance || 0;
  const creditsDiscount = useCredits ? Math.min(availableCredits, subtotal) : 0;
  const total = Math.max(0, subtotal - pointsDiscount - rewardDiscountAmt - subDiscountAmt - creditsDiscount - referralDiscount + deliveryFee);

  // Last order bottle count for smart bag suggestion
  const lastOrderItems = lastOrderData[0]?.items || [];
  const lastOrderBottles = lastOrderItems.reduce((sum, item) => sum + (item.quantity || 1), 0);

  const totalBottles = items.reduce((sum, item) => {
    if (item.category === 'bundle') return sum + (item.bottles_per_unit || 3) * item.quantity;
    return sum + item.quantity;
  }, 0);

  const handlePlaceOrder = async () => {
    // Block checkout if running inside an iframe (preview mode)
    if (window.self !== window.top) {
      alert('Checkout only works from the published app, not the preview.');
      return;
    }

    // Verify health advisory acknowledgment
    if (!healthAdvisoryAcknowledged) {
      toast.error('Please acknowledge the health advisory before placing your order.');
      return;
    }

    // Resolve customer_name with fallback priority
    // 1. User's full_name from auth
    // 2. Profile first_name + last_name
    // 3. If still missing, block checkout
    const resolvedName = (user?.full_name || '').trim() ||
      ((userProfile?.first_name || '') + ' ' + (userProfile?.last_name || '')).trim() ||
      '';

    if (!resolvedName) {
      toast.error('Please complete your profile with your full name before placing an order');
      navigate('/account-setup');
      return;
    }

    const addrString = [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ');
    if (fulfillmentType === 'delivery' && !address.street.trim()) {
      toast.error('Please enter a delivery address');
      return;
    }
    if (!phone.trim()) {
      toast.error('Please enter your phone number');
      return;
    }
    if (!selectedDeliveryOption?.option_id) {
      toast.error('We’re having trouble confirming your delivery window right now. Please try again in a few minutes or contact NuVira support.');
      return;
    }

    setIsSubmitting(true);

    // Confirm eligibility is valid before submitting (already validated by debounce, but double-check state)
    if (fulfillmentType === 'delivery') {
      if (!zoneEligibility?.checkout_allowed) {
        setIsSubmitting(false);
        if (zoneEligibility?.zone_type === 'waitlist_only') {
          setShowOutOfArea(true);
        } else {
          toast.error(zoneEligibility?.customer_message || 'Delivery is not available to this address. Please check your address.');
        }
        return;
      }
      // Zone 3 must not flow into normal checkout
      if (zoneEligibility.zone_type === 'route_review') {
        setIsSubmitting(false);
        toast.error('This address requires route review. Please contact us to arrange delivery.');
        return;
      }
    }

    // Save phone & address to profile so they persist to account settings
    if (user?.email) {
      const profileData = {
        phone: phone.trim(),
        address: addrString,
        sms_consent: smsConsent,
        sms_consent_date: smsConsent ? new Date().toISOString() : null,
      };
      const profiles = await base44.entities.UserProfile.filter({ customer_email: user.email });
      if (profiles.length > 0) {
        await base44.entities.UserProfile.update(profiles[0].id, profileData);
      } else {
        await base44.entities.UserProfile.create({ customer_email: user.email, ...profileData });
      }
    }

    // Save bag return request if any
    if ((bagReturn.smallBags > 0 || bagReturn.toteBags > 0) && user?.email) {
      try {
        // Check for existing pending return for this customer to avoid duplicates
        const existingPending = await base44.entities.BagReturn.filter({
          customer_email: user.email,
          order_id: 'pending',
        });
        
        if (existingPending.length === 0) {
          await base44.entities.BagReturn.create({
            order_id: 'pending', // will be updated post-checkout
            customer_email: user.email,
            small_bags_requested: bagReturn.smallBags,
            tote_bags_requested: bagReturn.toteBags,
            verification_status: 'requested',
            credit_issued: 0,
          });
        }
        // Sync bag return to hub (non-blocking)
        base44.functions.invoke('syncCustomerToHub', {
          event: 'customer.bag_return_requested',
          customer_email: user.email,
          data: {
            small_bags_requested: bagReturn.smallBags,
            tote_bags_requested: bagReturn.toteBags,
            estimated_credit: (bagReturn.smallBags * 1) + (bagReturn.toteBags * 2),
          },
        }).catch(() => {});
      } catch (e) {
        // non-blocking
      }
    }

    const res = await base44.functions.invoke('createPaymentIntent', {
      items,
      subtotal,
      delivery_fee: deliveryFee,
      total,
      fulfillment_type: fulfillmentType,
      delivery_address: addrString,
      // Structured address fields (required by Hub)
      address_line1: address.street || '',
      address_line2: address.street2 || '',
      address_city: address.city || '',
      address_state: address.state || '',
      address_postal_code: address.zip || '',
      contact_phone: phone.trim(),
      selected_schedule_option_id: selectedDeliveryOption?.option_id || null,
      selected_schedule_option: selectedDeliveryOption || null,
      estimated_delivery_date: selectedDeliveryOption?.delivery_date || null,
      selected_delivery_date: selectedDeliveryOption?.delivery_date || null,
      assigned_delivery_date: selectedDeliveryOption?.delivery_date || null,
      production_date: selectedDeliveryOption?.production_date || null,
      delivery_window_label: selectedDeliveryOption?.delivery_window_label || null,
      delivery_window_start: selectedDeliveryOption?.delivery_window_start || null,
      delivery_window_end: selectedDeliveryOption?.delivery_window_end || null,
      delivery_schedule_source: selectedDeliveryOption ? 'customer_selected' : 'system_default',
      customer_email: user?.email || null,
      customer_name: resolvedName,
      points_discount: pointsDiscount,
      points_used: pointsUsed,
      credits_discount: creditsDiscount,
      referral_discount: referralDiscount,
      referral_code: referralApplied ? referralCode : null,
      active_reward: activeReward || null,
      reward_discount: rewardDiscountAmt,
      // Zone eligibility snapshot
      zone_key: zoneEligibility?.zone_key || null,
      // Idempotency key — stable for this checkout session, reused on retries
      checkout_idempotency_key: checkoutIdempotencyKey.current,
      // Health advisory acknowledgment
      health_advisory_acknowledged: true,
      health_advisory_acknowledged_at: new Date().toISOString(),
      health_advisory_version: HEALTH_ADVISORY_CONFIG.version,
    });

    if (res.data?.clientSecret) {
      // DIAGNOSTIC: log the full PI response to prove this is a fresh card-only PI
      const freshPiId = res.data.clientSecret.split('_secret_')[0];
      console.group('[NuVira Checkout] createPaymentIntent Response');
      console.log('Source              : FRESH call to createPaymentIntent (not localStorage/sessionStorage)');
      console.log('PaymentIntent ID    :', freshPiId);
      console.log('orderNumber         :', res.data.orderNumber);
      console.log('effectiveTotal      :', res.data.effectiveTotal);
      console.log('publishableKey mode :', res.data.publishableKey?.startsWith('pk_live') ? 'LIVE ✅' : 'TEST ⚠️');
      console.log('clientSecret prefix :', res.data.clientSecret.substring(0, 40) + '...');
      console.log('Full response.data  :', JSON.stringify({ ...res.data, clientSecret: '[REDACTED]' }));
      console.groupEnd();

      // Embedded flow: surface PaymentElement in-page
      setClientSecret(res.data.clientSecret);
      setPublishableKey(res.data.publishableKey);
      setPendingOrderNumber(res.data.orderNumber);
      setPaymentTotal(res.data.effectiveTotal ?? total);
      setConfirmedDeliverySchedule(res.data.confirmedDeliverySchedule || null);
      setIsSubmitting(false);
    } else {
      if (res.data?.error_code === 'STALE_DELIVERY_SELECTION') {
        const latest = Array.isArray(res.data.latest_options) ? res.data.latest_options : [];
        setScheduleOptionsOverride(latest);
        setSelectedDeliveryOption(latest.find(option => option.is_default) || latest[0] || null);
        toast.error(res.data.message || 'That delivery window is no longer available. Please select a new delivery window.');
        setIsSubmitting(false);
        return;
      }
      const errMsg = res.data?.error || 'Failed to start checkout. Please try again.';
      toast.error(errMsg);
      if (errMsg.includes('Referral code already used')) {
        setReferralApplied(false);
        setReferralCode('');
      }
      setIsSubmitting(false);
    }
  };

  if (items.length === 0) {
    navigate('/cart');
    return null;
  }

  // Block checkout if not logged in
  if (!user) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
        <div className="nuvira-icon-badge w-16 h-16 rounded-full flex items-center justify-center mb-4">
          <span className="text-3xl">🍃</span>
        </div>
        <h2 className="font-heading text-2xl font-bold mb-2">Sign In to Checkout</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6 max-w-xs">
          Create a free account or sign in to place your order. It only takes a moment!
        </p>
        <Button
          onClick={() => redirectToLogin('/checkout')}
          className="w-full max-w-xs h-12 rounded-xl font-semibold"
        >
          Sign In / Create Account
        </Button>
        <button
          onClick={() => navigate('/cart')}
          className="mt-4 text-xs text-muted-foreground underline"
        >
          Go back to cart
        </button>
      </div>
    );
  }

  // Block checkout if profile setup is incomplete
  if (user && userProfile !== undefined && !userProfile?.onboarding_complete) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
        <div className="nuvira-icon-badge w-16 h-16 rounded-full flex items-center justify-center mb-4">
          <span className="text-3xl">🌿</span>
        </div>
        <h2 className="font-heading text-2xl font-bold mb-2">One Quick Step First</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6 max-w-xs">
          Before placing your order, we need a few details — your name, phone number, and delivery address — so we know exactly where to bring your juice.
        </p>
        <Button
          onClick={() => navigate('/account-setup')}
          className="w-full max-w-xs h-12 rounded-xl font-semibold"
        >
          Complete My Profile →
        </Button>
        <button
          onClick={() => navigate('/cart')}
          className="mt-4 text-xs text-muted-foreground underline"
        >
          Go back to cart
        </button>
      </div>
    );
  }

  return (
    <div className="pb-8">
      <SEO title="Checkout" description="Complete your NuVira Juice order." noindex={true} />
      <AnimatePresence>
        {showOutOfArea && (
          <OutOfAreaModal
            address={[address.street, address.city, address.state, address.zip].filter(Boolean).join(', ')}
            zip={address.zip}
            onClose={() => setShowOutOfArea(false)}
            cartItems={items}
          />
        )}
      </AnimatePresence>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-12 pb-3">
        <button onClick={() => navigate('/cart')} className="w-11 h-11 bg-secondary rounded-full flex items-center justify-center shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-heading text-xl font-bold">Checkout</h1>
      </div>



      {/* Delivery Estimate */}
      <div className="mx-4 mb-5 bg-nuvira-gradient-soft border border-nuvira rounded-xl p-3.5 flex items-center gap-2.5">
        <Truck className="w-5 h-5 text-primary shrink-0" />
        <div>
          <p className="text-sm font-semibold text-primary">
            {selectedDeliveryOption
              ? `Delivered ${selectedDeliveryLabel}`
              : scheduleOptionsLoading ? 'Confirming delivery windows...' : 'Delivery window will be confirmed before payment'}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {selectedDeliveryOption?.delivery_window_label
              ? `${selectedDeliveryOption.delivery_window_label} · Fresh made the day before`
              : 'Included in our next fresh batch'}
          </p>
        </div>
      </div>

      {/* Delivery Date Selection */}
      {deliveryOptions.length > 1 && (
        <DeliveryDatePicker
          options={deliveryOptions}
          selected={selectedDeliveryOption?.delivery_date}
          onSelect={setSelectedDeliveryOption}
        />
      )}

      {/* Subscriber Perks Banner */}
      {activeSubscription?.plan && (
        <div className="mx-4 mb-5 bg-nuvira-gradient-soft border border-nuvira rounded-xl p-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center shrink-0">
              <span className="text-sm">⭐</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-primary">{activeSubscription.plan.name} Perks Applied!</p>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                {subFreeDelivery && <p className="text-[11px] text-primary/80">✓ Free delivery</p>}
                {subDiscountPct > 0 && <p className="text-[11px] text-primary/80">✓ {subDiscountPct}% off your order (-${subDiscountAmt.toFixed(2)})</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NuVira Credits */}
      {user?.email && availableCredits > 0 && (
        <div className="mx-4 mb-5 bg-nuvira-gradient-soft border border-nuvira rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-primary/15 rounded-full flex items-center justify-center">
                <span className="text-sm">🌿</span>
              </div>
              <div>
                <p className="text-sm font-semibold">NuVira Credits</p>
                <p className="text-[11px] text-muted-foreground">${availableCredits.toFixed(2)} available</p>
              </div>
            </div>
            <Switch checked={useCredits} onCheckedChange={setUseCredits} />
          </div>
          {useCredits && (
            <p className="text-xs text-primary mt-2 font-medium">✓ -${creditsDiscount.toFixed(2)} applied to this order</p>
          )}
        </div>
      )}

      {/* Points Redemption */}
      {user?.email && availablePoints >= 100 && (
        <div className="mx-4 mb-5 bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-cyan-500/20 rounded-full flex items-center justify-center">
                <Gift className="w-4 h-4 text-cyan-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Use Loyalty Points</p>
                <p className="text-[11px] text-muted-foreground">{availablePoints.toLocaleString()} pts · save ${maxDiscount.toFixed(2)}</p>
              </div>
            </div>
            <Switch checked={usePoints} onCheckedChange={setUsePoints} />
          </div>
          {usePoints && (
            <p className="text-xs text-cyan-600 dark:text-cyan-400 mt-2 font-medium">✓ {pointsUsed.toLocaleString()} points applied · -${pointsDiscount.toFixed(2)} off</p>
          )}
        </div>
      )}

      {/* Referral Code */}
      <div className="mx-4 mb-5">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
          Referral Code
        </Label>
        <div className="flex gap-2">
          <Input
            value={referralCode}
            onChange={e => { setReferralCode(e.target.value.trim()); setReferralApplied(false); }}
            placeholder="Enter code (e.g. NuVira26)"
            className="rounded-xl h-11 flex-1"
            disabled={referralApplied}
          />
          <Button
            type="button"
            variant="outline"
            className="rounded-xl h-11 px-4 shrink-0"
            disabled={referralApplied || !referralCode}
            onClick={() => {
              if (referralCode.toLowerCase() === 'nuvira26') {
                setReferralApplied(true);
                toast.success('Referral code applied! $5 off your order 🎉');
              } else {
                toast.error('Invalid referral code');
              }
            }}
          >
            {referralApplied ? '✓ Applied' : 'Apply'}
          </Button>
        </div>
        {referralApplied && (
          <p className="text-xs text-primary font-medium mt-1.5">✓ $5 referral discount applied</p>
        )}
      </div>

      {/* Contact */}
      <div className="px-4 space-y-4 mb-5">
        <div>
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
            Phone Number
          </Label>
          <Input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
            className="rounded-xl h-11"
          />
          <label className="flex items-start gap-2.5 mt-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={smsConsent}
              onChange={e => setSmsConsent(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-border accent-primary shrink-0"
            />
            <span className="text-[11px] text-muted-foreground leading-snug">
              Send me order updates via SMS. I agree to receive text messages from NuVira Juice Co. at the number above. Message &amp; data rates may apply. Reply STOP to unsubscribe.
            </span>
          </label>
        </div>
        {fulfillmentType === 'delivery' && (
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
              Delivery Address
            </Label>
            <AddressAutocomplete
              value={address}
              onChange={setAddress}
              placeholder="123 Main St"
              className="rounded-xl h-11"
            />
            {validatingAddress && (
              <p className="text-xs text-muted-foreground mt-1.5">Checking delivery area...</p>
            )}
            {!validatingAddress && zoneEligibility && (() => {
              const e = zoneEligibility;
              if (e.zone_type === 'core' && e.checkout_allowed) {
                return <p className="text-xs text-primary font-medium mt-1.5">✓ {e.customer_message}</p>;
              }
              if (e.zone_type === 'extended' && e.checkout_allowed) {
                return <p className="text-xs text-primary font-medium mt-1.5">✓ {e.customer_message}</p>;
              }
              if (e.zone_type === 'extended' && !e.checkout_allowed && e.reason_code === 'MINIMUM_ORDER_NOT_MET') {
                return (
                  <p className="text-xs text-cyan-600 font-medium mt-1.5">
                    {e.customer_message}
                  </p>
                );
              }
              if (e.zone_type === 'route_review') {
                return <p className="text-xs text-cyan-600 font-medium mt-1.5">⚠️ {e.customer_message}</p>;
              }
              if (e.zone_type === 'waitlist_only' || !e.checkout_allowed) {
                return <p className="text-xs text-destructive font-medium mt-1.5">{e.customer_message}</p>;
              }
              return null;
            })()}
          </div>
        )}
      </div>

      {/* Bag Return — delivery only, only if customer has a previous order */}
      {fulfillmentType === 'delivery' && lastOrderData.length > 0 && (
        <BagReturnSelector
          totalBottles={totalBottles}
          lastOrderBottles={lastOrderBottles || null}
          onChange={setBagReturn}
        />
      )}

      {/* Order Summary */}
      <div className="mx-4 bg-secondary/40 rounded-xl p-4 mb-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Order Summary</h3>
        {items.map(item => (
          <div key={item.product_id} className="flex justify-between text-sm mb-1.5">
            <span className="text-foreground/80">{item.quantity}x {item.title}</span>
            <span className="font-medium">${(item.price * item.quantity).toFixed(2)}</span>
          </div>
        ))}
        <div className="border-t border-border/50 mt-2 pt-2">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
          </div>
          {pointsDiscount > 0 && (
            <div className="flex justify-between text-xs text-cyan-600 mb-1 font-medium">
              <span>Points Discount</span><span>-${pointsDiscount.toFixed(2)}</span>
            </div>
          )}
          {activeReward && rewardDiscountAmt > 0 && (
            <div className="flex justify-between text-xs text-primary mb-1 font-medium">
              <span>{activeReward.title}</span><span>-${rewardDiscountAmt.toFixed(2)}</span>
            </div>
          )}
          {activeReward && rewardFreeDelivery && (
            <div className="flex justify-between text-xs text-primary mb-1 font-medium">
              <span>{activeReward.title}</span><span>Free!</span>
            </div>
          )}
          {subDiscountAmt > 0 && (
            <div className="flex justify-between text-xs text-primary mb-1 font-medium">
              <span>Subscriber {subDiscountPct}% Discount</span><span>-${subDiscountAmt.toFixed(2)}</span>
            </div>
          )}
          {creditsDiscount > 0 && (
            <div className="flex justify-between text-xs text-primary mb-1 font-medium">
              <span>NuVira Credits</span><span>-${creditsDiscount.toFixed(2)}</span>
            </div>
          )}
          {referralDiscount > 0 && (
            <div className="flex justify-between text-xs text-primary mb-1 font-medium">
              <span>Referral Code (NuVira26)</span><span>-${referralDiscount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Delivery</span>
            <span>{deliveryFee > 0 ? `$${deliveryFee.toFixed(2)}` : 'Free'}</span>
          </div>
          <div className="flex justify-between text-sm font-bold mt-1.5">
            <span>Total</span><span>${total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Zone 3 Route Review — shown instead of normal checkout when address is in zone_3 */}
      {zoneEligibility?.zone_type === 'route_review' && zoneEligibility?.checkout_allowed && !clientSecret && (
        <Zone3RouteReviewPanel
          zoneEligibility={zoneEligibility}
          items={items}
          subtotal={subtotal}
          address={address}
          phone={phone}
          customerEmail={user?.email}
          customerName={(user?.full_name || '').trim() || ((userProfile?.first_name || '') + ' ' + (userProfile?.last_name || '')).trim()}
          onSuccess={({ requestNumber, darId, paymentIntentId, total: holdTotal }) => {
            navigate('/zone3-review-submitted', {
              state: { requestNumber, darId, paymentIntentId, total: holdTotal, address: [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ') },
            });
          }}
          onCancel={() => navigate('/cart')}
        />
      )}

      {/* Payment Step — embedded Stripe PaymentElement after form is submitted */}
      {clientSecret ? (
        <div className="px-4 md:px-6">
          <div className="mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Payment</h3>
            <p className="text-[11px] text-muted-foreground">Secure checkout — card, Link, and wallet payments accepted where available.</p>
          </div>
          {confirmedDeliverySchedule?.delivery_date && (
            <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-1">
                Confirmed Delivery
              </p>
              <p className="text-sm font-semibold text-foreground">
                {format(new Date(confirmedDeliverySchedule.delivery_date + 'T12:00:00'), 'EEEE, MMMM d')}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {confirmedDeliverySchedule.delivery_window_label || 'Delivery window confirmed'} · Fresh made the day before
              </p>
            </div>
          )}
          <EmbeddedPayment
            clientSecret={clientSecret}
            publishableKey={publishableKey}
            total={paymentTotal}
            isSubmitting={isSubmitting}
            setIsSubmitting={setIsSubmitting}
            onSuccess={(paymentIntentId) => {
              clearCart();
              localStorage.removeItem('nuvira_pending_checkout_session');
              navigate(`/order-confirmation?order_number=${pendingOrderNumber}&pi=${paymentIntentId}`);
            }}
            onError={(msg) => {
              toast.error(msg || 'Payment failed. Please try again.');
            }}
          />
          <button
            onClick={() => { setClientSecret(null); setPendingOrderNumber(null); setConfirmedDeliverySchedule(null); }}
            className="w-full text-center text-xs text-muted-foreground underline mt-3"
          >
            ← Edit order details
          </button>
        </div>
      ) : (
        <div className="space-y-4 px-4 md:px-6">
          {/* Health Advisory Checkbox */}
          {!clientSecret && (
            <div className="w-full rounded-2xl border p-5" style={{ background: 'rgba(11, 61, 46, 0.06)', borderColor: 'rgba(218, 165, 32, 0.25)' }}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={healthAdvisoryAcknowledged}
                  onChange={(e) => setHealthAdvisoryAcknowledged(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-border accent-primary shrink-0"
                />
                <span className="text-xs text-foreground/70 leading-relaxed">
                  {HEALTH_ADVISORY_CONFIG.checkboxLabel}
                </span>
              </label>
            </div>
          )}

          {/* Place Order — shown until PaymentIntent is created (not shown for Zone 3 — handled by Zone3RouteReviewPanel) */}
          <div>
            {(() => {
            const zone = zoneEligibility;
            const needsMinimum = zone?.reason_code === 'MINIMUM_ORDER_NOT_MET';
            const isZone3 = zone?.zone_type === 'route_review';
            const isWaitlist = zone?.zone_type === 'waitlist_only';
            // Zone 3 is handled by Zone3RouteReviewPanel above — don't show normal button
            if (isZone3 && zone?.checkout_allowed) return null;
            const isBlocked = fulfillmentType === 'delivery' && (
              !addressValidated || needsMinimum || isWaitlist
            );
            let label = `Review Payment · $${total.toFixed(2)}`;
            if (isSubmitting) label = 'Processing...';
            else if (validatingAddress) label = 'Checking address...';
            else if (fulfillmentType === 'delivery' && !zone && address.street) label = 'Checking delivery area...';
            else if (fulfillmentType === 'delivery' && !address.street) label = 'Enter a delivery address';
            else if (needsMinimum) label = `Add $${zone.amount_needed?.toFixed(2)} more to qualify`;
            else if (isZone3) label = 'Route review required — contact us';
            else if (isWaitlist) label = 'Delivery not available in your area';
            return (
              <Button
                onClick={handlePlaceOrder}
                disabled={isSubmitting || isBlocked || !healthAdvisoryAcknowledged}
                className="w-full h-12 rounded-xl font-semibold text-sm"
              >
                {label}
              </Button>
            );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}