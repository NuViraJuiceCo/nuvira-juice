import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PROGRAMS } from '@/components/home/ProgramCards';
import { isPreLaunch, launchDateFormatted } from '@/lib/launchConfig';
import { isPreorderMode } from '@/lib/preorderConfig';
import { Minus, Plus, Trash2, ShoppingBag, ArrowRight, Truck, AlertCircle, Zap, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cartContext';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getDeliveryDisplayText, getProductionInfo } from '@/lib/deliveryUtils';
import { motion, AnimatePresence } from 'framer-motion';
import BundleComposer from '@/components/cart/BundleComposer';
import { useAuth } from '@/lib/AuthContext';
import { isBirthdayRewardActive, useBirthdayReward } from '@/lib/birthdayReward';
import FreeProductPicker from '@/components/FreeProductPicker';

export default function Cart() {
  const { items, updateQuantity, removeItem, updateBundleComposition, subtotal, itemCount, addItem } = useCart();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: userProfile } = useQuery({
    queryKey: ['user-profile-cart', user?.email],
    queryFn: async () => {
      const profiles = await base44.entities.UserProfile.filter({ customer_email: user?.email });
      return profiles[0] || null;
    },
    enabled: !!user?.email,
  });

  const { data: activeSubscription } = useQuery({
    queryKey: ['active-subscription-cart', user?.email],
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
  const subFreeDelivery = subDiscountPct > 0;
  const effectiveDeliveryFee = subFreeDelivery ? 0 : 5.00;

  const birthday = userProfile?.birthday || user?.birthday;
  const birthdayActive = isBirthdayRewardActive(birthday, user?.created_date);

  const [showBirthdayPicker, setShowBirthdayPicker] = useState(false);
  const [activeReward, setActiveReward] = useState(() => {
    if (!user?.email) return null;
    try { return JSON.parse(localStorage.getItem(`activeReward_${user.email}`)) || null; } catch { return null; }
  });
  const { rewardInCart, addBirthdayReward, removeBirthdayReward } = useBirthdayReward(items, addItem, removeItem);

  const handleBirthdayProductSelect = (product) => {
    addItem({ ...product, id: '__birthday_reward__', price: 0, title: `🎂 ${product.title} (Free)` }, 1, { isBirthdayReward: true });
  };

  const { data: schedules = [] } = useQuery({
    queryKey: ['delivery-schedule'],
    queryFn: () => base44.entities.DeliverySchedule.filter({ is_active: true }),
  });

  const { data: juices = [] } = useQuery({
    queryKey: ['juices-for-bundle'],
    queryFn: () => base44.entities.Product.filter({ category: 'juice', is_available: true }, 'sort_order', 20),
    enabled: items.some(i => i.category === 'bundle' && !i.is_program),
  });

  const juiceColors = {
    'AURA': 'bg-orange-100 text-orange-700',
    'OASIS': 'bg-blue-100 text-blue-700',
    'RE-NU': 'bg-green-100 text-green-700',
  };

  const scheduleRules = schedules[0]?.rules || [];
  const deliveryText = getDeliveryDisplayText(scheduleRules);
  const productionInfo = getProductionInfo(scheduleRules);
  // Shots are 2oz so require 6 minimum; juices/bundles require 3 minimum.
  // Normalize: each shot counts as 0.5 toward the minimum (so 6 shots = 3 units).
  const juiceCount = items.reduce((sum, item) => {
    if (item.category === 'bundle') return sum + (item.bottles_per_unit || 3) * item.quantity;
    if (item.category === 'juice') return sum + item.quantity;
    if (item.category === 'shot') return sum + item.quantity * 0.5;
    return sum;
  }, 0);
  const meetsMinimum = juiceCount >= 3;

  if (items.length === 0) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center px-4">
        <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mb-4">
          <ShoppingBag className="w-7 h-7 text-muted-foreground" />
        </div>
        <h2 className="font-heading text-lg font-semibold">Your cart is empty</h2>
        <p className="text-sm text-muted-foreground mt-1 mb-4">Time to add some fresh juice!</p>
        <Link to="/shop">
          <Button className="rounded-full px-6">Browse Juices</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-36">
      <div className="px-4 pt-4 pb-3">
        <h1 className="font-heading text-xl font-bold">Your Cart</h1>
        <p className="text-xs text-muted-foreground">{itemCount} {itemCount === 1 ? 'item' : 'items'}</p>
      </div>

      {/* Subscriber Perks Banner */}
      {activeSubscription?.plan && (
        <div className="mx-4 mb-3 bg-primary/10 border border-primary/30 rounded-xl p-3">
          <div className="flex items-center gap-2">
            <span className="text-base">⭐</span>
            <div className="flex-1">
              <p className="text-xs font-semibold text-primary">{activeSubscription.plan.name} — Subscriber Perks Active</p>
              <div className="flex flex-wrap gap-x-3">
                {subFreeDelivery && <p className="text-[10px] text-primary/80">✓ Free delivery</p>}
                {subDiscountPct > 0 && <p className="text-[10px] text-primary/80">✓ {subDiscountPct}% off applied at checkout</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active Tier Reward Banner */}
      {activeReward && (
        <div className="mx-4 mb-3 bg-primary/10 border border-primary/30 rounded-xl p-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">{activeReward.icon || '🎁'}</span>
            <div className="flex-1">
              <p className="text-xs font-semibold">{activeReward.title} — Active!</p>
              <p className="text-[10px] text-muted-foreground">{activeReward.description} · Will be applied at checkout</p>
            </div>
            <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">Active</span>
          </div>
        </div>
      )}

      {/* Birthday Reward Banner */}
      {birthdayActive && meetsMinimum && (
        <div className="mx-4 mb-3 bg-pink-500/10 border border-pink-500/30 rounded-xl p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gift className="w-4 h-4 text-pink-500 shrink-0" />
              <div>
                <p className="text-xs font-semibold">🎂 Birthday Reward — Free 12oz Juice!</p>
                <p className="text-[10px] text-muted-foreground">Add a free bottle to your order (valid 30 days)</p>
              </div>
            </div>
            {rewardInCart ? (
              <button onClick={removeBirthdayReward} className="text-[10px] font-semibold text-pink-500 underline">Remove</button>
            ) : (
              <button onClick={() => setShowBirthdayPicker(true)} className="text-[10px] font-semibold bg-pink-500 text-white px-2.5 py-1 rounded-full">Choose Free</button>
            )}
          </div>
        </div>
      )}

      {/* Minimum Order Notice */}
      {!meetsMinimum && (
      <div className="mx-4 mb-3 bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 flex items-center gap-2">
      <AlertCircle className="w-4 h-4 text-orange-500 shrink-0" />
      <p className="text-xs font-semibold text-foreground">
        Minimum order is 3 juices or 6 shots — add more to checkout.
      </p>
      </div>
      )}

      {/* Production Day Banner — hide during pre-launch / pre-order since dates would be inaccurate */}
      {productionInfo && !isPreLaunch() && !isPreorderMode() && (
        <div className="mx-4 mb-2 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500 shrink-0 fill-amber-400" />
          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">{productionInfo.label}</p>
        </div>
      )}

      {/* Pre-order window banner */}
      {isPreorderMode() && (
        <div className="mx-4 mb-3 bg-primary/10 border border-primary/30 rounded-xl p-3 flex items-center gap-2">
          <span className="text-base shrink-0">✦</span>
          <div>
            <p className="text-xs font-semibold text-primary">Pre-Order Window: April 23–30, 2026</p>
            <p className="text-[10px] text-muted-foreground">Card authorized now · charged May 1st, 2026 when production begins · delivered May 2nd, 2026</p>
          </div>
        </div>
      )}

      {/* Delivery Estimate — only show accurate dates once live */}
      {(!isPreLaunch() || isPreorderMode()) && (
        <div className="mx-4 mb-4 bg-primary/5 rounded-xl p-3 flex items-center gap-2">
          <Truck className="w-4 h-4 text-primary shrink-0" />
          <p className="text-xs font-medium text-primary">
            {isPreorderMode() ? 'Delivered Friday, May 2nd' : deliveryText}
          </p>
        </div>
      )}

      {/* AOV Upsell — Complete Your Routine */}
      {subtotal > 0 && subtotal < 144 && (
        <div className="mx-4 mb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Complete Your Routine</p>
          <div className="space-y-2">
            {PROGRAMS.slice(0, 2).map(program => (
              <Link key={program.key} to={`/program/${program.key}`}>
                <div className={`flex items-center gap-3 bg-gradient-to-r ${program.color} border ${program.border} rounded-xl p-3`}>
                  <span className="text-xl">{program.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold">{program.name} Program</p>
                    <p className="text-[10px] text-muted-foreground">{program.composition} · 12 bottles</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold">${program.price}</p>
                    <p className={`text-[10px] font-semibold ${program.accent}`}>View</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Cart Items */}
      <div className="px-4 space-y-3">
        <AnimatePresence>
          {items.map(item => (
            <motion.div
              key={item.product_id}
              layout
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="bg-card rounded-xl border border-border/50 p-3"
            >
              <div className="flex gap-3">
                <div className="w-16 h-16 bg-secondary/50 rounded-lg overflow-hidden shrink-0">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl">🍊</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.title}</p>
                  {item.size && <p className="text-[10px] text-muted-foreground">{item.size}</p>}
                  <p className="text-sm font-semibold mt-1">${(item.price * item.quantity).toFixed(2)}</p>
                </div>
                <div className="flex flex-col items-end justify-between">
                  <button onClick={() => removeItem(item.product_id)} className="p-1">
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  <div className="flex items-center gap-2 bg-secondary rounded-lg px-2 py-1">
                    <button onClick={() => updateQuantity(item.product_id, item.quantity - 1)}>
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="text-xs font-semibold w-4 text-center">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.product_id, item.quantity + 1)}>
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Program Composition Display (no customization) */}
              {item.category === 'bundle' && (item.is_program || item.bundle_composition?.length > 0) && (
                <div className="mt-3 pt-3 border-t border-border/40">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Program Includes</p>
                  <div className="space-y-2">
                    {item.bundle_composition && item.bundle_composition.map(comp => (
                      <div key={comp.product_id} className="bg-secondary/30 rounded-lg p-3 flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-lg flex-shrink-0 flex items-center justify-center font-heading font-bold text-lg ${juiceColors[comp.product_name] || 'bg-slate-200 text-slate-700'}`}>
                          {comp.quantity}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground">{comp.product_name}</p>
                          <p className="text-xs text-muted-foreground">{comp.quantity} bottles per cycle</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bundle Composer — custom bundles only */}
              {item.category === 'bundle' && !item.is_program && (!item.bundle_composition || item.bundle_composition.length === 0) && item.bottles_per_unit && (
                <BundleComposer
                  bundleSize={item.bottles_per_unit * item.quantity}
                  composition={item.bundle_composition || []}
                  juices={juices}
                  onChange={(comp) => updateBundleComposition(item.product_id, comp)}
                />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Bottom Summary */}
      <div className="fixed bottom-16 md:bottom-0 left-0 md:left-60 right-0 z-40 bg-card/95 backdrop-blur-xl border-t border-border">
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Subtotal</span>
            <span>${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>Delivery</span>
            <span>{effectiveDeliveryFee === 0 ? <span className="text-primary font-semibold">Free</span> : `$${effectiveDeliveryFee.toFixed(2)}`}</span>
          </div>
          <div className="flex justify-between text-sm font-semibold mb-3">
            <span>Total</span>
            <span>${(subtotal + effectiveDeliveryFee).toFixed(2)}</span>
          </div>
          {isPreLaunch() && !isPreorderMode() && (
            <div className="mb-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-center">
              <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">🚀 Pre-orders open April 23rd — full ordering opens May 1st!</p>
            </div>
          )}
          {isPreorderMode() && (
            <div className="mb-3 bg-primary/10 border border-primary/30 rounded-xl p-3 text-center">
              <p className="text-xs font-semibold text-primary">✦ Pre-Order — Card authorized today, charged May 1st, 2026 · Delivered May 2nd, 2026</p>
            </div>
          )}
          <Button
            onClick={() => {
              if (isPreLaunch()) return;
              if (!meetsMinimum) return;
              if (!user) {
                base44.auth.redirectToLogin('/checkout');
                return;
              }
              navigate('/checkout');
            }}
            disabled={!meetsMinimum || (isPreLaunch() && !isPreorderMode())}
            className="w-full h-12 rounded-xl font-semibold text-sm disabled:opacity-50"
          >
            {(isPreLaunch() && !isPreorderMode()) ? 'Pre-orders open April 23rd' : isPreorderMode() ? 'Pre-Order Checkout' : meetsMinimum ? 'Checkout' : 'Add more to checkout'}
            {!isPreLaunch() && meetsMinimum && <ArrowRight className="w-4 h-4 ml-2" />}
          </Button>
        </div>
      </div>
      <FreeProductPicker
        open={showBirthdayPicker}
        onClose={() => setShowBirthdayPicker(false)}
        onSelect={handleBirthdayProductSelect}
        title="Choose Your Free Birthday Juice"
        category="juice"
      />
    </div>
  );
}