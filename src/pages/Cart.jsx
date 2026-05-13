import React, { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PROGRAMS } from '@/components/home/ProgramCards';
import { isPreLaunch } from '@/lib/launchConfig';

import { Minus, Plus, Trash2, ShoppingBag, ArrowRight, Truck, AlertCircle, Zap, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cartContext';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getProductionInfo, getEligibleDeliveryOptions } from '@/lib/deliveryUtils';
import { motion, AnimatePresence } from 'framer-motion';
import BundleComposer from '@/components/cart/BundleComposer';
import { useAuth } from '@/lib/AuthContext';
import { isBirthdayRewardActive, useBirthdayReward } from '@/lib/birthdayReward';
import FreeProductPicker from '@/components/FreeProductPicker';
import { validateActiveReward, getStoredActiveReward } from '@/lib/rewardManager';

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
  // Delivery fee shown on cart is an estimate — exact fee is zone-validated at checkout.
  // Show "from $3.99" for non-subscribers (Zone 1A is the lowest possible fee).
  const effectiveDeliveryFee = subFreeDelivery ? 0 : null; // null = show estimated range

  const birthday = userProfile?.birthday || user?.birthday;
  const birthdayActive = isBirthdayRewardActive(birthday, user?.created_date);

  const [showBirthdayPicker, setShowBirthdayPicker] = useState(false);
  const [activeReward, setActiveReward] = useState(null);
  const [isValidatingReward, setIsValidatingReward] = useState(false);
  const { rewardInCart, addBirthdayReward, removeBirthdayReward } = useBirthdayReward(items, addItem, removeItem);

  // On mount and user change, validate active reward against backend
  useEffect(() => {
    const validateReward = async () => {
      if (!user?.email) {
        setActiveReward(null);
        return;
      }
      setIsValidatingReward(true);
      const stored = getStoredActiveReward(user.email);
      if (stored) {
        const validated = await validateActiveReward(stored, user.email);
        if (validated) {
          setActiveReward(validated);
        } else {
          // Reward is invalid, clear it
          localStorage.removeItem(`activeReward_${user.email}`);
          setActiveReward(null);
        }
      }
      setIsValidatingReward(false);
    };
    validateReward();
  }, [user?.email]);

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
    enabled: items.some(i => i.category === 'bundle'),
  });

  const juiceColors = {
    'AURA': 'bg-orange-100 text-orange-700',
    'OASIS': 'bg-blue-100 text-blue-700',
    'RE-NU': 'bg-green-100 text-green-700',
  };

  const scheduleRules = schedules[0]?.rules || [];
  const productionInfo = getProductionInfo(scheduleRules);
  // Use getEligibleDeliveryOptions for correct post-2PM cutoff behavior (matches Checkout picker)
  const deliveryOptions = getEligibleDeliveryOptions(new Date(), false);
  const earliestOption = deliveryOptions[0] || null;
  const deliveryText = earliestOption
    ? `Delivered ${earliestOption.delivery_day_name}, ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }).format(new Date(earliestOption.delivery_date + 'T12:00:00'))}`
    : 'Next available batch';
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
      <div className="min-h-screen flex flex-col items-center justify-center px-5 pt-safe pb-safe">
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
    <div style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: 'calc(14rem + env(safe-area-inset-bottom))' }}>
      {/* Header */}
      <div className="px-5 pb-4 border-b border-border/30">
        <h1 className="font-heading text-2xl font-bold mb-1">Your Cart</h1>
        <p className="text-xs text-muted-foreground">{itemCount} {itemCount === 1 ? 'item' : 'items'}</p>
      </div>

      {/* Content Scrollable Area */}
      <div className="space-y-3 px-5 pt-4">
        {/* Subscriber Perks Banner */}
        {activeSubscription?.plan && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="border border-primary/30 rounded-2xl p-3.5 shadow-sm" style={{ background: `linear-gradient(135deg, rgba(11,61,46,0.12) 0%, rgba(14,90,67,0.08) 100%)` }}>
            <div className="flex items-center gap-3">
              <span className="text-base">⭐</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-primary">{activeSubscription.plan.name} — Subscriber Perks</p>
                <div className="flex flex-wrap gap-x-3">
                  {subFreeDelivery && <p className="text-[10px] text-primary/80">✓ Free delivery</p>}
                  {subDiscountPct > 0 && <p className="text-[10px] text-primary/80">✓ {subDiscountPct}% off at checkout</p>}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Active Tier Reward Banner */}
        {activeReward && !isValidatingReward && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="border border-primary/30 rounded-2xl p-3.5 shadow-sm" style={{ background: `linear-gradient(135deg, rgba(11,61,46,0.12) 0%, rgba(14,90,67,0.08) 100%)` }}>
            <div className="flex items-center gap-3">
              <span className="text-lg">{activeReward.icon || '🎁'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">{activeReward.title} — Active!</p>
                <p className="text-[10px] text-muted-foreground line-clamp-1">{activeReward.description}</p>
              </div>
              <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-1 rounded-full shrink-0">Applied</span>
            </div>
          </motion.div>
        )}

        {/* Birthday Reward Banner */}
        {birthdayActive && meetsMinimum && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-pink-500/10 border border-pink-500/30 rounded-2xl p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Gift className="w-4 h-4 text-pink-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold">🎂 Birthday Reward</p>
                  <p className="text-[10px] text-muted-foreground">Free 12oz juice (30 days valid)</p>
                </div>
              </div>
              {rewardInCart ? (
                <button onClick={removeBirthdayReward} className="text-[10px] font-semibold text-pink-500 shrink-0">Remove</button>
              ) : (
                <button onClick={() => setShowBirthdayPicker(true)} className="text-[10px] font-semibold bg-pink-500 text-white px-2.5 py-1 rounded-lg shrink-0">Choose</button>
              )}
            </div>
          </motion.div>
        )}

        {/* Minimum Order Notice */}
        {!meetsMinimum && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-orange-500/10 border border-orange-500/30 rounded-2xl p-3.5 flex items-center gap-3">
            <AlertCircle className="w-4 h-4 text-orange-500 shrink-0" />
            <p className="text-xs font-semibold text-foreground">Add {Math.ceil(3 - juiceCount)} more to checkout</p>
          </motion.div>
        )}

        {/* Production Alert */}
        {productionInfo && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3.5 flex items-center gap-3">
            <Zap className="w-4 h-4 text-amber-500 shrink-0 fill-amber-400" />
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">{productionInfo.label}</p>
          </motion.div>
        )}

        {/* Delivery Estimate */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-primary/8 rounded-2xl p-3.5 flex items-center gap-3 border border-primary/20">
          <Truck className="w-4 h-4 text-primary shrink-0" />
          <p className="text-xs font-semibold text-primary">{deliveryText}</p>
        </motion.div>

        {/* AOV Upsell */}
        {subtotal > 0 && subtotal < 144 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-foreground/50 mb-3 px-0.5">Complete Your Routine</p>
            <div className="space-y-2.5">
              {PROGRAMS.slice(0, 2).map((program, idx) => (
                <Link key={program.key} to={`/program/${program.key}`}>
                  <motion.div 
                    initial={{ opacity: 0, y: 8 }} 
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="flex items-center gap-3.5 rounded-2xl p-3.5 border backdrop-blur-sm transition-all hover:border-opacity-100 active:scale-[0.98]"
                    style={{
                      background: `rgba(11, 61, 46, 0.08)`,
                      borderColor: `${program.color.split(' ')[1].split('-')[1] === 'orange' ? '#EA8C55' : program.color.split(' ')[1].split('-')[1] === 'red' ? '#FF6B6B' : '#7BA05B'}20`,
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
                    }}
                  >
                    {/* Icon Chip */}
                    <div 
                      className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-base"
                      style={{ background: `${program.color.split(' ')[1].split('-')[1] === 'orange' ? '#EA8C55' : program.color.split(' ')[1].split('-')[1] === 'red' ? '#FF6B6B' : '#7BA05B'}15`, border: `1px solid ${program.color.split(' ')[1].split('-')[1] === 'orange' ? '#EA8C55' : program.color.split(' ')[1].split('-')[1] === 'red' ? '#FF6B6B' : '#7BA05B'}25` }}
                    >
                      {program.emoji}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-foreground">{program.name}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{program.composition}</p>
                    </div>

                    {/* Price & CTA */}
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-foreground">${program.price}</p>
                      <p className="text-[10px] font-semibold mt-1" style={{ color: program.color.split(' ')[1].split('-')[1] === 'orange' ? '#EA8C55' : program.color.split(' ')[1].split('-')[1] === 'red' ? '#FF6B6B' : '#7BA05B' }}>View</p>
                    </div>
                  </motion.div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Cart Items Section */}
        <div className="pt-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-foreground/50 mb-3 px-0.5">Items</p>
          <div className="space-y-3">
            <AnimatePresence>
              {items.map(item => (
                <motion.div
                  key={item.product_id}
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="bg-card rounded-2xl border border-border/50 p-3.5 shadow-sm"
                  style={{ background: `linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)` }}
                >
                  <div className="flex gap-3">
                    <div className="w-16 h-16 bg-secondary/50 rounded-xl overflow-hidden shrink-0">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-2xl">🍊</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{item.title}</p>
                      {item.size && <p className="text-[10px] text-foreground/55">{item.size}</p>}
                      <p className="text-sm font-bold mt-1 text-primary">${(item.price * item.quantity).toFixed(2)}</p>
                    </div>
                    <div className="flex flex-col items-end justify-between gap-2">
                      <button onClick={() => removeItem(item.product_id)} className="p-1 hover:opacity-60 transition-opacity">
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                      <div className="flex items-center gap-1.5 bg-secondary rounded-lg px-2 py-1.5">
                        <button onClick={() => updateQuantity(item.product_id, item.quantity - 1)} className="hover:opacity-60">
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-xs font-semibold w-4 text-center">{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.product_id, item.quantity + 1)} className="hover:opacity-60">
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Bundle Details */}
                  {item.category === 'bundle' && (item.is_program || item.title?.includes('Trio')) && item.bundle_composition?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/40 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Includes</p>
                      {item.bundle_composition.map(comp => {
                        const juice = juices.find(j => j.id === comp.product_id || j.title?.toLowerCase().includes(comp.product_name?.toLowerCase()));
                        return (
                          <div key={comp.product_id} className="bg-secondary/40 rounded-lg p-2.5 flex items-center gap-2">
                            <div className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0 bg-muted">
                              {juice?.image_url ? (
                                <img src={juice.image_url} alt={comp.product_name} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-sm">🍊</div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-foreground">{comp.product_name}</p>
                              <p className="text-[10px] text-muted-foreground">{comp.quantity} bottle{comp.quantity !== 1 ? 's' : ''}</p>
                            </div>
                            <span className="text-xs font-bold text-muted-foreground">×{comp.quantity}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Bundle Composer */}
                  {item.category === 'bundle' && !item.is_program && !item.title?.includes('Trio') && item.bundle_composition?.length === 0 && item.bottles_per_unit && (
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
        </div>
      </div>

      {/* Fixed Checkout Footer */}
      <div className="fixed bottom-16 md:bottom-0 left-0 md:left-60 right-0 z-40 bg-gradient-to-t from-background via-background to-background/80 border-t border-border/30 pt-3" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        <div className="max-w-lg mx-auto px-5 space-y-3">
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-foreground/60">
              <span>Subtotal</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs text-foreground/60">
              <span>Delivery</span>
              <span>{effectiveDeliveryFee === 0 ? <span className="text-primary font-semibold">Free</span> : <span>from $3.99</span>}</span>
            </div>
            <div className="flex justify-between text-sm font-bold text-foreground pt-1 border-t border-border/30">
              <span>Total</span>
              <span>${subtotal.toFixed(2)}+</span>
            </div>
          </div>
          <Button
            onClick={() => {
              if (!meetsMinimum) return;
              if (!user) {
                base44.auth.redirectToLogin('/checkout');
                return;
              }
              navigate('/checkout');
            }}
            disabled={!meetsMinimum}
            className="w-full h-11 rounded-xl font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {meetsMinimum ? 'Checkout' : 'Add more items'}
            {meetsMinimum && <ArrowRight className="w-4 h-4 ml-2" />}
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