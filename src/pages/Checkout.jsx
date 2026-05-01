import React, { useState } from 'react';
import SEO from '@/components/SEO';
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
import { getDeliveryDisplayText, getNextDeliveryDate } from '@/lib/deliveryUtils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { AnimatePresence } from 'framer-motion';
import OutOfAreaModal from '@/components/checkout/OutOfAreaModal';
import PreorderBanner from '@/components/PreorderBanner';
import { isPreorderMode } from '@/lib/preorderConfig';

export default function Checkout() {
  const navigate = useNavigate();
  const { items, subtotal, clearCart } = useCart();
  const { user } = useAuth();
  const fulfillmentType = 'delivery';
  const [address, setAddress] = useState({ street: '', city: '', state: '', zip: '' });
  const [phone, setPhone] = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
      setHasShownOutOfAreaModal(false);
      return;
    }

    if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
    setValidatingAddress(true);

    addressDebounceRef.current = setTimeout(async () => {
      try {
        const res = await base44.functions.invoke('calculateDeliveryZone', { address: addrString });
        const zoneData = res.data;
        const isValid = !!zoneData?.ok && !!zoneData?.zone;
        setAddressValidated(isValid);
        setDeliveryZone(isValid ? { fee: zoneData.fee, distance: zoneData.distance } : null);
        
        // Show modal once when address goes out of range
        if (!isValid && !hasShownOutOfAreaModal) {
          setHasShownOutOfAreaModal(true);
          setShowOutOfArea(true);
        }
      } catch (err) {
        console.error('Address validation error:', err);
        setAddressValidated(false);
        setDeliveryZone(null);
      } finally {
        setValidatingAddress(false);
      }
    }, 800);

    return () => clearTimeout(addressDebounceRef.current);
  }, [address, fulfillmentType, hasShownOutOfAreaModal]);

  const { data: schedules = [] } = useQuery({
    queryKey: ['delivery-schedule'],
    queryFn: () => base44.entities.DeliverySchedule.filter({ is_active: true }),
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

  const scheduleRules = schedules[0]?.rules || [];
  const deliveryDate = getNextDeliveryDate(scheduleRules);
  const deliveryText = getDeliveryDisplayText(scheduleRules, fulfillmentType);
  const rewardFreeDelivery = activeReward?.reward_type === 'free_delivery';
  const rewardDiscountPct = activeReward?.reward_type === 'discount' ? 10 : 0;
  const rewardDiscountAmt = rewardDiscountPct > 0 ? subtotal * rewardDiscountPct / 100 : 0;
  const baseFee = deliveryZone?.fee || 0;
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

    setIsSubmitting(true);

    // Check delivery zone via backend
    if (fulfillmentType === 'delivery') {
      const addrCheck = [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ');
      const zoneRes = await base44.functions.invoke('calculateDeliveryZone', { address: addrCheck });
      const zoneData = zoneRes.data;
      if (!zoneData?.zone) {
        setIsSubmitting(false);
        setShowOutOfArea(true);
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

    const res = await base44.functions.invoke('createCheckoutSession', {
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
      estimated_delivery_date: deliveryDate ? format(deliveryDate, 'yyyy-MM-dd') : null,
      customer_email: user?.email || null,
      customer_name: resolvedName,
      points_discount: pointsDiscount,
      points_used: pointsUsed,
      credits_discount: creditsDiscount,
      referral_discount: referralDiscount,
      referral_code: referralApplied ? referralCode : null,
      active_reward: activeReward || null,
      reward_discount: rewardDiscountAmt,
    });

    if (res.data?.url) {
      // Stripe returns to browser immediately, but don't navigate yet
      // First, ensure we give the backend time to create the order
      const checkoutUrl = res.data.url;
      console.log('Redirecting to Stripe checkout:', checkoutUrl);
      // Navigate to Stripe checkout
      window.location.href = checkoutUrl;
    } else {
      const errMsg = res.data?.error || 'Failed to start checkout. Please try again.';
      toast.error(errMsg);
      // If referral code was already used, clear it so user can proceed without it
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
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
          <span className="text-3xl">🍃</span>
        </div>
        <h2 className="font-heading text-2xl font-bold mb-2">Sign In to Checkout</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6 max-w-xs">
          Create a free account or sign in to place your order. It only takes a moment!
        </p>
        <Button
          onClick={() => base44.auth.redirectToLogin('/checkout')}
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
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
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

      {/* Pre-order Banner (shown during pre-order window) */}
      <PreorderBanner />

      {/* Delivery Estimate */}
      <div className="mx-4 mb-5 bg-primary/5 rounded-xl p-3.5 flex items-center gap-2.5">
        <Truck className="w-5 h-5 text-primary shrink-0" />
        <div>
          <p className="text-sm font-semibold text-primary">
            {isPreorderMode() ? 'Delivery: May 2nd, 2026' : deliveryText}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {isPreorderMode() ? 'Pre-orders produced May 1st · delivered May 2nd' : 'Included in our next fresh batch'}
          </p>
        </div>
      </div>

      {/* Subscriber Perks Banner */}
      {activeSubscription?.plan && (
        <div className="mx-4 mb-5 bg-primary/10 border border-primary/30 rounded-xl p-4">
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
        <div className="mx-4 mb-5 bg-primary/5 border border-primary/20 rounded-xl p-4">
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
        <div className="mx-4 mb-5 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-amber-500/20 rounded-full flex items-center justify-center">
                <Gift className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Use Loyalty Points</p>
                <p className="text-[11px] text-muted-foreground">{availablePoints.toLocaleString()} pts · save ${maxDiscount.toFixed(2)}</p>
              </div>
            </div>
            <Switch checked={usePoints} onCheckedChange={setUsePoints} />
          </div>
          {usePoints && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 font-medium">✓ {pointsUsed.toLocaleString()} points applied · -${pointsDiscount.toFixed(2)} off</p>
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
            {!validatingAddress && addressValidated && (
              <p className="text-xs text-primary font-medium mt-1.5">✓ Address validated</p>
            )}
          </div>
        )}
      </div>

      {/* Bag Return — delivery only, only if customer has a previous order */}
      {fulfillmentType === 'delivery' && !isPreorderMode() && lastOrderData.length > 0 && (
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
            <div className="flex justify-between text-xs text-amber-600 mb-1 font-medium">
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

      {/* Place Order */}
      <div className="px-4">
        <Button
          onClick={handlePlaceOrder}
          disabled={isSubmitting || (fulfillmentType === 'delivery' && !addressValidated)}
          className="w-full h-12 rounded-xl font-semibold text-sm"
        >
          {isSubmitting ? 'Processing...' : fulfillmentType === 'delivery' && !addressValidated ? 'Enter a valid delivery address' : isPreorderMode() ? `Secure Pre-Order · $${total.toFixed(2)}` : `Complete Payment · $${total.toFixed(2)}`}
        </Button>
      </div>
    </div>
  );
}