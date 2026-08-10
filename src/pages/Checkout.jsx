import React, { useState, useRef } from 'react';
import SEO from '@/components/SEO';
import EmbeddedPayment from '@/components/checkout/EmbeddedPayment';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, Truck, Gift } from 'lucide-react';
import BagReturnSelector from '@/components/checkout/BagReturnSelector';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { Label } from '@/components/ui/label';
import { useCart } from '@/lib/cartContext';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/admin-access';
import { useQuery } from '@tanstack/react-query';
import { Switch } from '@/components/ui/switch';
import { base44, invokeCustomerGateway } from '@/api/base44Client';
import { redirectToLogin } from '@/lib/nativeAuthRedirect';
import DeliveryDatePicker from '@/components/checkout/DeliveryDatePicker';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { AnimatePresence } from 'framer-motion';
import OutOfAreaModal from '@/components/checkout/OutOfAreaModal';
import Zone3RouteReviewPanel from '@/components/checkout/Zone3RouteReviewPanel';
import { HEALTH_ADVISORY_CONFIG } from '@/components/HealthAdvisory';
import { normalizeValidatedCheckoutCode } from '@/lib/checkoutPromotions';
import { buildCustomerName, normalizeNamePart, resolveCustomerIdentity } from '@/lib/customerIdentity';

const CHECKOUT_PROCESSING_WATCHDOG_MS = 20000;

const CHECKOUT_START_STAGES = {
  IDLE: 'idle',
  SAVING_PROFILE: 'saving_profile',
  SAVING_BAG_RETURN: 'saving_bag_return',
  CREATING_PAYMENT_ATTEMPT: 'creating_payment_attempt',
  PAYMENT_ELEMENT_READY: 'payment_element_ready',
  FAILED_BEFORE_PAYMENT_ATTEMPT: 'failed_before_payment_attempt',
  PAYMENT_ATTEMPT_STATE_UNKNOWN: 'payment_attempt_state_unknown',
  SLOW_PROCESSING: 'slow_processing',
};

const CHECKOUT_COPY = {
  PRE_ATTEMPT_FAILURE: 'We couldn’t save your checkout details. Please check your connection and try again.',
  NO_WRITE_FAILURE: 'Checkout did not start. Please review your details and try again.',
  AMBIGUOUS_STATE: 'We couldn’t confirm whether checkout started. Please don’t retry yet. We’re checking your order.',
  SLOW_PROCESSING: 'Still checking your checkout. Please don’t close, refresh, or tap again.',
};

const BAG_RETURN_COMPLETED_STATUSES = new Set([
  'delivered',
  'picked_up',
  'fulfilled',
  'completed',
  'complete',
]);

const normalizeOrderStatus = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[\s-]+/g, '_');

const isEligibleBagReturnSourceOrder = (order) => {
  if (!order || order.is_test_order || order.is_abandoned_checkout || order.do_not_recover) return false;

  const paymentWasCaptured = order.payment_captured === true
    || ['paid', 'refunded'].includes(normalizeOrderStatus(order.payment_status))
    || ['paid', 'refunded'].includes(normalizeOrderStatus(order.financial_status));
  if (!paymentWasCaptured) return false;

  return [
    order.status,
    order.delivery_status,
    order.fulfillment_status,
    order.effective_delivery_status,
    order.effective_fulfillment_status,
  ].some(status => BAG_RETURN_COMPLETED_STATUSES.has(normalizeOrderStatus(status)));
};


export default function Checkout() {
  return <CheckoutFlow />;
}

function CheckoutFlow() {
  const navigate = useNavigate();

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

  const { items, subtotal, clearCart, trackCheckoutStarted } = useCart();
  const { user } = useAuth();
  const journeyCheckoutTrackedRef = useRef(false);
  const fulfillmentType = 'delivery';
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [address, setAddress] = useState({ street: '', city: '', state: '', zip: '' });
  const [phone, setPhone] = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkoutStartStage, setCheckoutStartStage] = useState(CHECKOUT_START_STAGES.IDLE);
  const [checkoutStartMessage, setCheckoutStartMessage] = useState('');
  const [checkoutStartLocked, setCheckoutStartLocked] = useState(false);
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
  const [discountCodeInput, setDiscountCodeInput] = useState('');
  const [appliedDiscountCode, setAppliedDiscountCode] = useState(null);
  const [isApplyingDiscountCode, setIsApplyingDiscountCode] = useState(false);
  const [addressValidated, setAddressValidated] = useState(false);
  const [validatingAddress, setValidatingAddress] = useState(false);
  const [addressValidationError, setAddressValidationError] = useState('');
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
  const checkoutAttemptInFlightRef = useRef(false);
  const checkoutStartLockedRef = useRef(false);
  const checkoutWatchdogRef = useRef(null);
  const checkoutCode = appliedDiscountCode;

  React.useEffect(() => {
    if (!user?.email || items.length === 0 || journeyCheckoutTrackedRef.current) return;
    journeyCheckoutTrackedRef.current = true;
    trackCheckoutStarted();
  }, [items.length, trackCheckoutStarted, user?.email]);

  const activeReward = React.useMemo(() => {
    if (!user?.email) return null;
    try { return JSON.parse(localStorage.getItem(`activeReward_${user.email}`)) || null; } catch { return null; }
  }, [user?.email]);

  const { data: userProfile, isFetched: userProfileFetched } = useQuery({
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
    if (!userProfileFetched) return;
    const identity = resolveCustomerIdentity({ profile: userProfile, user });
    setFirstName(identity.firstName);
    setLastName(identity.lastName);
    if (userProfile?.phone) setPhone(userProfile.phone);
    if (userProfile?.address) {
      const parts = userProfile.address.split(',').map(s => s.trim());
      setAddress({ street: parts[0]||'', city: parts[1]||'', state: parts[2]||'', zip: parts[3]||'' });
    }
    if (userProfile?.sms_consent) setSmsConsent(true);
    setPrefilled(true);
  }, [userProfile, user, prefilled, userProfileFetched]);

  // Validate address in real-time for delivery orders
  const addressDebounceRef = React.useRef(null);
  const addressValidationRequestRef = React.useRef(0);
  const [hasShownOutOfAreaModal, setHasShownOutOfAreaModal] = React.useState(false);

  React.useEffect(() => {
    const validationRequestId = ++addressValidationRequestRef.current;
    if (addressDebounceRef.current) {
      clearTimeout(addressDebounceRef.current);
      addressDebounceRef.current = null;
    }

    if (fulfillmentType !== 'delivery') {
      setAddressValidated(true);
      setValidatingAddress(false);
      return;
    }

    const hasCompleteDeliveryAddress = Boolean(
      address.street?.trim() &&
      address.city?.trim() &&
      address.state?.trim() &&
      address.zip?.trim()
    );
    const addrString = [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ');
    if (!hasCompleteDeliveryAddress) {
      setAddressValidated(false);
      setZoneEligibility(null);
      setDeliveryZone(null);
      setAddressValidationError('');
      setHasShownOutOfAreaModal(false);
      setValidatingAddress(false);
      return;
    }

    setValidatingAddress(true);
    setAddressValidationError('');
    // Clear previous result while re-validating
    setZoneEligibility(null);
    setAddressValidated(false);

    addressDebounceRef.current = setTimeout(async () => {
      try {
        const res = await invokeCustomerGateway('validateDeliveryEligibility', {
          delivery_address: addrString,
          address_line1: address.street || '',
          address_city: address.city || '',
          address_state: address.state || '',
          address_postal_code: address.zip || '',
          cart_subtotal: subtotal || 0,
          order_type: 'one_time',
        });
        const eligibility = res?.data || res;
        if (addressValidationRequestRef.current !== validationRequestId) return;
        if (!eligibility || typeof eligibility.checkout_allowed !== 'boolean') {
          throw new Error('invalid_delivery_eligibility_response');
        }
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
        if (addressValidationRequestRef.current !== validationRequestId) return;
        console.error('Address validation error:', err);
        setAddressValidated(false);
        setZoneEligibility(null);
        setDeliveryZone(null);
        setAddressValidationError('We could not verify this delivery address. Re-enter it and select a Google-verified suggestion.');
      } finally {
        if (addressValidationRequestRef.current === validationRequestId) {
          setValidatingAddress(false);
        }
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
    queryFn: async () => {
      const recentOrders = await base44.entities.Order.filter(
        { customer_email: user?.email },
        '-created_date',
        20
      );
      return recentOrders.filter(isEligibleBagReturnSourceOrder).slice(0, 1);
    },
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
  const merchandiseTotalBeforePromotion = Math.max(
    0,
    subtotal - pointsDiscount - rewardDiscountAmt - subDiscountAmt - creditsDiscount
  );
  const referralDiscount = checkoutCode?.type === 'referral'
    ? Math.min(checkoutCode.amount, merchandiseTotalBeforePromotion)
    : 0;
  const promotionDiscount = checkoutCode?.type === 'promotion'
    ? Math.min(checkoutCode.amount, merchandiseTotalBeforePromotion)
    : 0;
  const checkoutCodeDiscount = referralDiscount + promotionDiscount;
  const totalBeforePromotion = merchandiseTotalBeforePromotion + deliveryFee;
  const total = Math.max(0, merchandiseTotalBeforePromotion - checkoutCodeDiscount) + deliveryFee;

  React.useEffect(() => {
    if (!checkoutCode) return;
    if (Math.abs(checkoutCode.eligibleSubtotal - merchandiseTotalBeforePromotion) < 0.01) return;
    setAppliedDiscountCode(null);
    setDiscountCodeInput('');
    toast.info('Reapply your discount code after changing another discount.');
  }, [checkoutCode, merchandiseTotalBeforePromotion]);

  // Last order bottle count for smart bag suggestion
  const lastOrderItems = lastOrderData[0]?.items || [];
  const lastOrderBottles = lastOrderItems.reduce((sum, item) => sum + (item.quantity || 1), 0);

  const totalBottles = items.reduce((sum, item) => {
    if (item.category === 'bundle') return sum + (item.bottles_per_unit || 3) * item.quantity;
    if (item.category === 'juice') return sum + item.quantity;
    if (item.category === 'shot') return sum + item.quantity;
    if (!item.category && item.title && !/tote|bag|shirt|merch/i.test(item.title)) return sum + item.quantity;
    return sum;
  }, 0);

  const setCheckoutStartLockedSafely = (locked) => {
    checkoutStartLockedRef.current = locked;
    setCheckoutStartLocked(locked);
  };

  const clearCheckoutProcessingWatchdog = () => {
    if (checkoutWatchdogRef.current) {
      clearTimeout(checkoutWatchdogRef.current);
      checkoutWatchdogRef.current = null;
    }
  };

  const startCheckoutProcessingWatchdog = () => {
    clearCheckoutProcessingWatchdog();
    checkoutWatchdogRef.current = setTimeout(() => {
      if (!clientSecret && checkoutAttemptInFlightRef.current) {
        setCheckoutStartStage(CHECKOUT_START_STAGES.SLOW_PROCESSING);
        setCheckoutStartMessage(CHECKOUT_COPY.SLOW_PROCESSING);
      }
    }, CHECKOUT_PROCESSING_WATCHDOG_MS);
  };

  React.useEffect(() => {
    return () => {
      clearCheckoutProcessingWatchdog();
      checkoutAttemptInFlightRef.current = false;
    };
  }, []);

  const isValidCheckoutStartSuccess = (data) => (
    typeof data?.clientSecret === 'string' &&
    data.clientSecret.includes('_secret_') &&
    typeof data?.publishableKey === 'string' &&
    typeof data?.orderNumber === 'string'
  );

  const isExplicitNoWriteCheckoutStartFailure = (data) => (
    data?.writes_performed === false &&
    data?.payment_intent_created === false &&
    data?.order_created === false
  );

  const markCheckoutStateUnknown = (error) => {
    if (error && typeof error === 'object') {
      error.checkoutStateUnknown = true;
      return error;
    }
    const unknown = new Error('checkout_state_unknown');
    unknown.checkoutStateUnknown = true;
    return unknown;
  };

  const showPreAttemptCheckoutFailure = () => {
    clearCheckoutProcessingWatchdog();
    checkoutAttemptInFlightRef.current = false;
    setCheckoutStartLockedSafely(false);
    setCheckoutStartStage(CHECKOUT_START_STAGES.FAILED_BEFORE_PAYMENT_ATTEMPT);
    setCheckoutStartMessage(CHECKOUT_COPY.PRE_ATTEMPT_FAILURE);
    setIsSubmitting(false);
    toast.error(CHECKOUT_COPY.PRE_ATTEMPT_FAILURE);
  };

  const showExplicitNoWriteCheckoutFailure = (message) => {
    clearCheckoutProcessingWatchdog();
    checkoutAttemptInFlightRef.current = false;
    setCheckoutStartLockedSafely(false);
    setCheckoutStartStage(CHECKOUT_START_STAGES.FAILED_BEFORE_PAYMENT_ATTEMPT);
    setCheckoutStartMessage(CHECKOUT_COPY.NO_WRITE_FAILURE);
    setIsSubmitting(false);
    toast.error(message || CHECKOUT_COPY.NO_WRITE_FAILURE);
  };

  const showAmbiguousCheckoutStartState = () => {
    clearCheckoutProcessingWatchdog();
    checkoutAttemptInFlightRef.current = false;
    setCheckoutStartLockedSafely(true);
    setCheckoutStartStage(CHECKOUT_START_STAGES.PAYMENT_ATTEMPT_STATE_UNKNOWN);
    setCheckoutStartMessage(CHECKOUT_COPY.AMBIGUOUS_STATE);
    setIsSubmitting(false);
    toast.error(CHECKOUT_COPY.AMBIGUOUS_STATE);
  };

  const handlePlaceOrder = async () => {
    if (checkoutAttemptInFlightRef.current || checkoutStartLockedRef.current) return;

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

    const normalizedFirstName = normalizeNamePart(firstName);
    const normalizedLastName = normalizeNamePart(lastName);
    const resolvedName = buildCustomerName(normalizedFirstName, normalizedLastName);

    if (!normalizedFirstName || !normalizedLastName) {
      toast.error('Please enter the first and last name for this order');
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

    checkoutAttemptInFlightRef.current = true;
    setCheckoutStartLockedSafely(false);
    setCheckoutStartStage(CHECKOUT_START_STAGES.SAVING_PROFILE);
    setCheckoutStartMessage('');
    setIsSubmitting(true);
    startCheckoutProcessingWatchdog();

    let paymentAttemptStarted = false;

    try {
      // Confirm eligibility is valid before submitting (already validated by debounce, but double-check state)
      if (fulfillmentType === 'delivery') {
        if (!zoneEligibility?.checkout_allowed) {
          clearCheckoutProcessingWatchdog();
          checkoutAttemptInFlightRef.current = false;
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
          clearCheckoutProcessingWatchdog();
          checkoutAttemptInFlightRef.current = false;
          setIsSubmitting(false);
          toast.error('This address requires route review. Please contact us to arrange delivery.');
          return;
        }
      }

      // Save phone & address to profile so they persist to account settings
      if (user?.email) {
        setCheckoutStartStage(CHECKOUT_START_STAGES.SAVING_PROFILE);
        const profileData = {
          first_name: normalizedFirstName,
          last_name: normalizedLastName,
          phone: phone.trim(),
          address: addrString,
          sms_consent: smsConsent,
          sms_consent_date: smsConsent ? new Date().toISOString() : null,
        };
        const profiles = await base44.entities.UserProfile.filter({ customer_email: user.email });
        if (profiles.length > 0) {
          await base44.entities.UserProfile.update(profiles[0].id, profileData);
        } else {
          try {
            await base44.entities.UserProfile.create({ customer_email: user.email, ...profileData });
          } catch (error) {
            throw markCheckoutStateUnknown(error);
          }
        }
      }

      let pendingBagReturnId = null;

      // Save bag return request if any
      if ((bagReturn.smallBags > 0 || bagReturn.toteBags > 0) && user?.email) {
        setCheckoutStartStage(CHECKOUT_START_STAGES.SAVING_BAG_RETURN);
        // Check for existing pending return for this customer to avoid duplicates.
        // A read failure is pre-write and retryable; a lost response from create is ambiguous.
        const existingPending = await base44.entities.BagReturn.filter({
          customer_email: user.email,
          order_id: 'pending',
        });

        if (existingPending.length > 1) {
          throw new Error('Multiple pending bag returns need admin review before checkout.');
        }

        if (existingPending.length === 0) {
          try {
            const createdReturn = await base44.entities.BagReturn.create({
              order_id: 'pending', // will be updated post-checkout
              customer_email: user.email,
              small_bags_requested: bagReturn.smallBags,
              tote_bags_requested: bagReturn.toteBags,
              verification_status: 'requested',
              credit_issued: 0,
            });
            pendingBagReturnId = createdReturn?.id || null;
          } catch (error) {
            throw markCheckoutStateUnknown(error);
          }
        } else {
          pendingBagReturnId = existingPending[0].id;
          if (Number(existingPending[0].small_bags_requested || 0) !== bagReturn.smallBags ||
              Number(existingPending[0].tote_bags_requested || 0) !== bagReturn.toteBags) {
            await base44.entities.BagReturn.update(existingPending[0].id, {
              small_bags_requested: bagReturn.smallBags,
              tote_bags_requested: bagReturn.toteBags,
            });
          }
        }
      }

      setCheckoutStartStage(CHECKOUT_START_STAGES.CREATING_PAYMENT_ATTEMPT);
      paymentAttemptStarted = true;

      const res = await base44.functions.invoke('createPaymentIntent', {
        items,
        subtotal,
        delivery_fee: deliveryFee,
        // The backend applies public promotion codes itself. Sending the
        // pre-promotion total prevents a client-calculated code discount from
        // being trusted or subtracted twice.
        total: totalBeforePromotion,
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
        customer_first_name: normalizedFirstName,
        customer_last_name: normalizedLastName,
        points_discount: pointsDiscount,
        points_used: pointsUsed,
        credits_discount: creditsDiscount,
        referral_discount: referralDiscount,
        referral_code: checkoutCode?.type === 'referral' ? checkoutCode.code : null,
        promotion_code: checkoutCode?.type === 'promotion' ? checkoutCode.code : null,
        discount_code: checkoutCode?.code || null,
        discount_contract_version: 2,
        active_reward: activeReward || null,
        reward_discount: rewardDiscountAmt,
        // Zone eligibility snapshot
        zone_key: zoneEligibility?.zone_key || null,
        // Idempotency key — stable for this checkout session, reused on retries
        checkout_idempotency_key: checkoutIdempotencyKey.current,
        bag_return_request_id: pendingBagReturnId,
        // Health advisory acknowledgment
        health_advisory_acknowledged: true,
        health_advisory_acknowledged_at: new Date().toISOString(),
        health_advisory_version: HEALTH_ADVISORY_CONFIG.version,
      });

      if (isValidCheckoutStartSuccess(res.data)) {
        console.group('[NuVira Checkout] createPaymentIntent Response');
        console.log('Source              : FRESH call to createPaymentIntent (not localStorage/sessionStorage)');
        console.log('orderNumber         :', res.data.orderNumber);
        console.log('effectiveTotal      :', res.data.effectiveTotal);
        console.log('Checkout start      : success');
        console.groupEnd();

        clearCheckoutProcessingWatchdog();
        checkoutAttemptInFlightRef.current = false;
        setCheckoutStartLockedSafely(false);
        setCheckoutStartStage(CHECKOUT_START_STAGES.PAYMENT_ELEMENT_READY);
        setCheckoutStartMessage('');

        // Embedded flow: surface PaymentElement in-page
        setClientSecret(res.data.clientSecret);
        setPublishableKey(res.data.publishableKey);
        setPendingOrderNumber(res.data.orderNumber);
        setPaymentTotal(res.data.effectiveTotal ?? total);
        setConfirmedDeliverySchedule(res.data.confirmedDeliverySchedule || null);
        setIsSubmitting(false);
        return;
      }

      if (isExplicitNoWriteCheckoutStartFailure(res.data)) {
        showExplicitNoWriteCheckoutFailure(res.data?.message || res.data?.error);
        if (res.data?.error_code === 'STALE_DELIVERY_SELECTION') {
          const latest = Array.isArray(res.data.latest_options) ? res.data.latest_options : [];
          setScheduleOptionsOverride(latest);
          setSelectedDeliveryOption(latest.find(option => option.is_default) || latest[0] || null);
        }
        return;
      }

      showAmbiguousCheckoutStartState();
    } catch (error) {
      if (paymentAttemptStarted || error?.checkoutStateUnknown) {
        showAmbiguousCheckoutStartState();
        return;
      }
      showPreAttemptCheckoutFailure();
    }
  };

  if (items.length === 0) {
    return <Navigate to="/cart" replace />;
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
          Before placing your order, we only need your name and phone number. Delivery details are collected here when delivery is selected.
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

      {/* Discount Code */}
      <div className="mx-4 mb-5">
        <Label htmlFor="discount-code" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
          Discount Code
        </Label>
        <div className="flex gap-2">
          <Input
            id="discount-code"
            name="discountCode"
            aria-label="Discount Code"
            value={discountCodeInput}
            onChange={e => {
              setDiscountCodeInput(e.target.value);
              setAppliedDiscountCode(null);
            }}
            placeholder="Enter discount code"
            className="rounded-xl h-11 flex-1"
            disabled={Boolean(appliedDiscountCode)}
            autoCapitalize="characters"
            autoCorrect="off"
          />
          <Button
            type="button"
            variant="outline"
            className="rounded-xl h-11 px-4 shrink-0"
            disabled={isApplyingDiscountCode || (!appliedDiscountCode && !discountCodeInput.trim())}
            onClick={async () => {
              if (appliedDiscountCode) {
                setAppliedDiscountCode(null);
                setDiscountCodeInput('');
                toast.success('Discount code removed');
                return;
              }
              setIsApplyingDiscountCode(true);
              try {
                const response = await base44.functions.invoke('createPaymentIntent', {
                  mode: 'validate_discount_code',
                  discount_code: discountCodeInput,
                  eligible_subtotal: merchandiseTotalBeforePromotion,
                });
                const payload = response?.data || response;
                const resolvedCode = normalizeValidatedCheckoutCode(payload?.discount);
                if (!payload?.ok || !resolvedCode) {
                  toast.error('This discount code is not valid for the current order.');
                  return;
                }
                setDiscountCodeInput(resolvedCode.code);
                setAppliedDiscountCode(resolvedCode);
                toast.success(`${resolvedCode.label} applied`);
              } catch (error) {
                const message = error?.response?.data?.error || error?.message;
                toast.error(message || 'This discount code is not valid for the current order.');
              } finally {
                setIsApplyingDiscountCode(false);
              }
            }}
          >
            {isApplyingDiscountCode ? 'Checking...' : appliedDiscountCode ? 'Remove' : 'Apply'}
          </Button>
        </div>
        {checkoutCode && (
          <p className="text-xs text-primary font-medium mt-1.5">
            {checkoutCode.label} (-${checkoutCodeDiscount.toFixed(2)})
          </p>
        )}
      </div>

      {/* Contact */}
      <div className="px-4 space-y-4 mb-5">
        <div>
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
            Name For This Order
          </Label>
          <div className="grid grid-cols-2 gap-3">
            <Input
              name="firstName"
              aria-label="First name"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              placeholder="First name"
              autoComplete="given-name"
              className="rounded-xl h-11"
            />
            <Input
              name="lastName"
              aria-label="Last name"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              placeholder="Last name"
              autoComplete="family-name"
              className="rounded-xl h-11"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="checkout-phone" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
            Phone Number
          </Label>
          <Input
            id="checkout-phone"
            name="phone"
            type="tel"
            aria-label="Phone Number"
            autoComplete="tel"
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
            {!validatingAddress && addressValidationError && (
              <p className="text-xs text-destructive font-medium mt-1.5" role="alert">{addressValidationError}</p>
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
          <div key={item.cart_line_key || item.product_id} className="flex justify-between text-sm mb-1.5">
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
              <span>{checkoutCode?.label || 'Referral code'}</span><span>-${referralDiscount.toFixed(2)}</span>
            </div>
          )}
          {promotionDiscount > 0 && (
            <div className="flex justify-between text-xs text-primary mb-1 font-medium">
              <span>{checkoutCode?.label || 'Discount code'}</span><span>-${promotionDiscount.toFixed(2)}</span>
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
          discountEligibleSubtotal={subtotal}
          checkoutCode={checkoutCode}
          address={address}
          phone={phone}
          customerEmail={user?.email}
          customerName={buildCustomerName(firstName, lastName)}
          customerFirstName={normalizeNamePart(firstName)}
          customerLastName={normalizeNamePart(lastName)}
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
            customerName={buildCustomerName(firstName, lastName)}
            customerEmail={user?.email || ''}
            customerPhone={phone.trim()}
            isSubmitting={isSubmitting}
            setIsSubmitting={setIsSubmitting} showWalletDiagnostics={(isAdminUser(user)) && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('wallet_diagnostics') === '1'}
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

          {checkoutStartMessage && (
            <div
              className={`w-full rounded-2xl border p-4 text-xs leading-relaxed ${
                checkoutStartStage === CHECKOUT_START_STAGES.PAYMENT_ATTEMPT_STATE_UNKNOWN ||
                checkoutStartStage === CHECKOUT_START_STAGES.SLOW_PROCESSING
                  ? 'border-amber-300 bg-amber-50 text-amber-950'
                  : 'border-destructive/20 bg-destructive/5 text-foreground'
              }`}
            >
              <p className="font-semibold">
                {checkoutStartStage === CHECKOUT_START_STAGES.PAYMENT_ATTEMPT_STATE_UNKNOWN
                  ? 'Checkout status needs review'
                  : checkoutStartStage === CHECKOUT_START_STAGES.SLOW_PROCESSING
                    ? 'Still checking checkout'
                    : 'Checkout needs attention'}
              </p>
              <p className="mt-1">{checkoutStartMessage}</p>
              {(checkoutStartStage === CHECKOUT_START_STAGES.PAYMENT_ATTEMPT_STATE_UNKNOWN ||
                checkoutStartStage === CHECKOUT_START_STAGES.SLOW_PROCESSING) && (
                <p className="mt-2 font-medium">Please contact NuVira before trying again.</p>
              )}
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
            if (checkoutStartStage === CHECKOUT_START_STAGES.PAYMENT_ATTEMPT_STATE_UNKNOWN) label = 'Checkout status unknown';
            else if (checkoutStartStage === CHECKOUT_START_STAGES.SLOW_PROCESSING) label = 'Still checking...';
            else if (isSubmitting) label = 'Processing...';
            else if (validatingAddress) label = 'Checking address...';
            else if (fulfillmentType === 'delivery' && !zone && address.street) label = 'Checking delivery area...';
            else if (fulfillmentType === 'delivery' && !address.street) label = 'Enter a delivery address';
            else if (needsMinimum) label = `Add $${zone.amount_needed?.toFixed(2)} more to qualify`;
            else if (isZone3) label = 'Route review required — contact us';
            else if (isWaitlist) label = 'Delivery not available in your area';
            return (
              <Button
                onClick={handlePlaceOrder}
                disabled={isSubmitting || checkoutStartLocked || isBlocked || !healthAdvisoryAcknowledged}
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
