import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PROGRAMS } from '@/components/home/ProgramCards';

import { Minus, Plus, Trash2, ShoppingBag, ArrowRight, Truck, AlertCircle, Zap, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cartContext';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { redirectToLogin } from '@/lib/nativeAuthRedirect';
import CartDeliveryCheckPrompt from '@/components/delivery/CartDeliveryCheckPrompt';
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
  const juiceOrderCategories = new Set(['juice', 'shot', 'bundle']);
  const containsJuiceOrderItems = items.some(item => juiceOrderCategories.has(item.category));
  // Shots are 2oz so require 6 minimum; juices/bundles require 3 minimum.
  // Normalize: each shot counts as 0.5 toward the minimum (so 6 shots = 3 units).
  const juiceCount = items.reduce((sum, item) => {
    if (item.category === 'bundle') return sum + (item.bottles_per_unit || 3) * item.quantity;
    if (item.category === 'juice') return sum + item.quantity;
    if (item.category === 'shot') return sum + item.quantity * 0.5;
    return sum;
  }, 0);
  const meetsMinimum = !containsJuiceOrderItems || juiceCount >= 3;
  const juiceMinimumRemaining = Math.max(0, Math.ceil(3 - juiceCount));

  if (items.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 pt-safe pb-safe">
        <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mb-4">
          <ShoppingBag className="w-7 h-7 text-muted-foreground" />
        </div>
        <h2 className="font-heading text-lg font-semibold">Your cart is empty</h2>
        <p className="text-sm text-muted-foreground mt-1 mb-4">Time to add some fresh juice!</p>
        <Link to="/shop">
          <Button className="rounded-full px-6 nuvira-gradient-button">Browse Juices</Button>
        </Link>
      </div>
    );
  }

  return (
    <div
      className="pb-[calc(22rem+env(safe-area-inset-bottom))] md:pb-[calc(14rem+env(safe-area-inset-bottom))]"
      style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}
    >
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
        {birthdayActive && containsJuiceOrderItems && meetsMinimum && (
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

        {/* Delivery area check prompt — only shown if ZIP not yet checked */}
        <CartDeliveryCheckPrompt />

        {/* Minimum Order Notice */}
        {containsJuiceOrderItems && !meetsMinimum && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-3.5 flex items-center gap-3">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            <p className="text-xs font-semibold text-foreground">Add {juiceMinimumRemaining} more bottle{juiceMinimumRemaining === 1 ? '' : 's'} to checkout</p>
          </motion.div>
        )}

        {/* Production Alert */}
        {productionInfo && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-cyan-500/10 border border-cyan-500/30 rounded-2xl p-3.5 flex items-center gap-3">
            <Zap className="w-4 h-4 text-cyan-500 shrink-0 fill-cyan-400" />
            <p className="text-xs font-semibold text-cyan-600 dark:text-cyan-400">{productionInfo.label}</p>
          </motion.div>
        )}

        {/* Delivery Estimate */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-primary/8 rounded-2xl p-3.5 flex items-center gap-3 border border-primary/20">
          <Truck className="w-4 h-4 text-primary shrink-0" />
          <p className="text-xs font-semibold text-primary">{deliveryText}</p>
        </motion.div>

        {/* Cart Items Section */}
        <div className="pt-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-foreground/50 mb-3 px-0.5">Items</p>
          <div className="space-y-3">
            <AnimatePresence>
              {items.map(item => (
                <motion.div
                  key={item.cart_line_key || item.product_id}
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="bg-card rounded-2xl p-3.5"
                  style={{
                    border: '1px solid hsl(var(--border) / 0.6)',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)',
                  }}
                >
                  <div className="flex gap-3">
                    <div className="w-16 h-16 bg-secondary/50 rounded-xl overflow-hidden shrink-0">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                          {item.category === 'merch' || item.category === 'apparel' ? <ShoppingBag className="w-6 h-6" /> : <span className="text-2xl">🍊</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{item.title}</p>
                      {item.size && <p className="text-[10px] text-foreground/55">{item.size}</p>}
                      <p className="text-sm font-bold mt-1 text-primary">${(item.price * item.quantity).toFixed(2)}</p>
                    </div>
                    <div className="flex flex-col items-end justify-between gap-2">
                      <button type="button" onClick={() => removeItem(item.cart_line_key || item.product_id)} aria-label={`Remove ${item.title} from cart`} className="p-1 hover:opacity-60 transition-opacity">
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                      <div className="flex items-center gap-1.5 bg-secondary rounded-lg px-2 py-1.5">
                        <button type="button" onClick={() => updateQuantity(item.cart_line_key || item.product_id, item.quantity - 1)} aria-label={`Decrease ${item.title} quantity`} className="hover:opacity-60">
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-xs font-semibold w-4 text-center">{item.quantity}</span>
                        <button type="button" onClick={() => updateQuantity(item.cart_line_key || item.product_id, item.quantity + 1)} aria-label={`Increase ${item.title} quantity`} className="hover:opacity-60">
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Bundle Details */}
                  {item.category === 'bundle' && (item.is_program || item.title?.includes('Trio')) && item.bundle_composition?.length > 0 && (() => {
                    const prog = PROGRAMS.find(p => item.title?.toLowerCase().includes(p.key));
                    return (
                      <div className="mt-3 pt-3 border-t border-border/40 space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Includes</p>
                        {item.bundle_composition.map(comp => {
                          const juice = juices.find(j => j.id === comp.product_id || j.title?.toLowerCase().includes(comp.product_name?.toLowerCase()));
                          return (
                            <div
                              key={comp.product_id}
                              className="rounded-xl p-2.5 flex items-center gap-2"
                              style={prog ? {
                                background: prog.gradientBg,
                                border: `1px solid ${prog.borderColor}`,
                              } : {
                                background: 'hsl(var(--secondary) / 0.4)',
                                border: '1px solid hsl(var(--border) / 0.4)',
                              }}
                            >
                              <div className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0 bg-muted shadow-sm">
                                {juice?.image_url ? (
                                  <img src={juice.image_url} alt={comp.product_name} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-sm">🍊</div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold" style={{ color: prog ? prog.accentColor : 'hsl(var(--foreground))' }}>{comp.product_name}</p>
                                <p className="text-[10px] text-muted-foreground">{comp.quantity} bottle{comp.quantity !== 1 ? 's' : ''}</p>
                              </div>
                              <span
                                className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                                style={prog ? { background: prog.chipBg, color: prog.accentColor } : { color: 'hsl(var(--muted-foreground))' }}
                              >×{comp.quantity}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* Bundle Composer */}
                  {item.category === 'bundle' && !item.is_program && !item.title?.includes('Trio') && item.bundle_composition?.length === 0 && item.bottles_per_unit && (
                    <BundleComposer
                      bundleSize={item.bottles_per_unit * item.quantity}
                      composition={item.bundle_composition || []}
                      juices={juices}
                      onChange={(comp) => updateBundleComposition(item.cart_line_key || item.product_id, comp)}
                    />
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* AOV Upsell */}
        {subtotal > 0 && subtotal < 144 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-foreground/50 mb-3 px-0.5">Complete Your Routine</p>
            <div className="space-y-3">
              {PROGRAMS.slice(0, 2).map((program, idx) => (
                <Link key={program.key} to={`/program/${program.key}`}>
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="relative overflow-hidden rounded-2xl active:scale-[0.98] transition-transform"
                    style={{
                      border: `1.5px solid ${program.borderColor}`,
                      boxShadow: `0 6px 20px ${program.shadowColor}, 0 1px 4px rgba(0,0,0,0.06)`,
                    }}
                  >
                    {/* Photo strip */}
                    {program.image && (
                      <div className="relative h-28 overflow-hidden">
                        <img
                          src={program.image}
                          alt={program.name}
                          className={`w-full h-full object-cover ${program.imagePosition || 'object-center'}`}
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/70" />
                        {/* Name overlay */}
                        <div className="absolute bottom-2.5 left-3.5 right-3.5 flex items-end justify-between">
                          <div>
                            <p className="font-heading text-base font-bold text-white drop-shadow leading-tight">
                              {program.name} <span className="text-sm">{program.emoji}</span>
                            </p>
                            <p className="text-white/80 text-[10px] font-semibold">{program.tagline}</p>
                          </div>
                          <div
                            className="text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0"
                            style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.3)' }}
                          >
                            From ${program.durationOptions[0].price}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Bottom info strip */}
                    <div className="flex items-center justify-between px-3.5 py-2.5" style={{ background: program.gradientBg }}>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: program.dotColor }} />
                        <p className="text-[11px] font-semibold" style={{ color: 'rgba(0,0,0,0.70)' }}>2 or 3 days · 8 or 12 bottles</p>
                      </div>
                      <p className="text-[11px] font-bold" style={{ color: program.accentColor }}>View Program →</p>
                    </div>
                  </motion.div>
                </Link>
              ))}
            </div>
          </div>
        )}
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
          {/* Health Advisory Note */}
          <div className="text-[10px] text-foreground/60 leading-relaxed py-2 border-t border-border/20 pt-2">
            If pregnant, nursing, immunocompromised, elderly, purchasing for a child, or managing a medical condition, consult your healthcare provider.
          </div>
          <Button
            onClick={() => {
              if (!meetsMinimum) return;
              if (!user) {
                redirectToLogin('/checkout');
                return;
              }
              navigate('/checkout');
            }}
            disabled={!meetsMinimum}
            className="w-full h-11 rounded-xl font-semibold text-sm nuvira-gradient-button disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {meetsMinimum ? 'Checkout' : 'Add more bottles'}
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
