import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Truck, Gift } from 'lucide-react';
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
    const savedPhone = userProfile?.phone || user?.phone || '';
    const savedAddress = userProfile?.address || user?.address || '';
    if (savedPhone) setPhone(savedPhone);
    if (savedAddress) {
      const parts = savedAddress.split(',').map(s => s.trim());
      setAddress({ street: parts[0]||'', city: parts[1]||'', state: parts[2]||'', zip: parts[3]||'' });
    }
    if (savedPhone || savedAddress) setPrefilled(true);
  }, [userProfile, user, prefilled]);

  const { data: schedules = [] } = useQuery({
    queryKey: ['delivery-schedule'],
    queryFn: () => base44.entities.DeliverySchedule.filter({ is_active: true }),
  });

  const { data: userPointsData } = useQuery({
    queryKey: ['user-points', user?.email],
    queryFn: () => base44.entities.UserPoints.filter({ customer_email: user?.email }),
    enabled: !!user?.email,
  });
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
  const deliveryFee = (fulfillmentType === 'delivery' && !rewardFreeDelivery) ? 5.00 : 0;
  const total = Math.max(0, subtotal - pointsDiscount - rewardDiscountAmt + deliveryFee);

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
    const res = await base44.functions.invoke('createCheckoutSession', {
      items,
      subtotal,
      delivery_fee: deliveryFee,
      total,
      points_discount: pointsDiscount,
      points_used: pointsUsed,
      customer_email: user?.email || null,
      active_reward: activeReward || null,
      reward_discount: rewardDiscountAmt,
    });

    if (res.data?.url) {
      window.location.href = res.data.url;
    } else {
      toast.error(res.data?.error || 'Failed to start checkout. Please try again.');
      setIsSubmitting(false);
    }
  };

  if (items.length === 0) {
    navigate('/cart');
    return null;
  }

  return (
    <div className="pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-secondary rounded-full flex items-center justify-center">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-heading text-xl font-bold">Checkout</h1>
      </div>

      {/* Delivery Estimate */}
      <div className="mx-4 mb-5 bg-primary/5 rounded-xl p-3.5 flex items-center gap-2.5">
        <Truck className="w-5 h-5 text-primary shrink-0" />
        <div>
          <p className="text-sm font-semibold text-primary">{deliveryText}</p>
          <p className="text-[10px] text-muted-foreground">Included in our next fresh batch</p>
        </div>
      </div>

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
          </div>
        )}
      </div>

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
          disabled={isSubmitting}
          className="w-full h-12 rounded-xl font-semibold text-sm"
        >
          {isSubmitting ? 'Redirecting to payment...' : `Pay · $${total.toFixed(2)}`}
        </Button>
      </div>
    </div>
  );
}