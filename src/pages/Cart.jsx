import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isPreLaunch, launchDateFormatted } from '@/lib/launchConfig';
import { Minus, Plus, Trash2, ShoppingBag, ArrowRight, Truck, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cartContext';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getDeliveryDisplayText, getProductionInfo } from '@/lib/deliveryUtils';
import { Zap, Gift } from 'lucide-react';
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
    enabled: items.some(i => i.category === 'bundle'),
  });

  const scheduleRules = schedules[0]?.rules || [];
  const deliveryText = getDeliveryDisplayText(scheduleRules);
  const productionInfo = getProductionInfo(scheduleRules);
  const deliveryFee = 5.00;
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

      {/* Production Day Banner */}
      {productionInfo && (
        <div className="mx-4 mb-2 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500 shrink-0 fill-amber-400" />
          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">{productionInfo.label}</p>
        </div>
      )}

      {/* Delivery Estimate */}
      <div className="mx-4 mb-4 bg-primary/5 rounded-xl p-3 flex items-center gap-2">
        <Truck className="w-4 h-4 text-primary shrink-0" />
        <p className="text-xs font-medium text-primary">{deliveryText}</p>
      </div>

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

              {/* Bundle Composer */}
              {item.category === 'bundle' && item.bottles_per_unit && (
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
      <div className="fixed bottom-16 left-0 right-0 z-40 bg-card/95 backdrop-blur-xl border-t border-border">
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Subtotal</span>
            <span>${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>Delivery</span>
            <span>${deliveryFee.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm font-semibold mb-3">
            <span>Total</span>
            <span>${(subtotal + deliveryFee).toFixed(2)}</span>
          </div>
          {isPreLaunch() && (
            <div className="mb-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-center">
              <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">🚀 Orders open {launchDateFormatted()} — browse freely until then!</p>
            </div>
          )}
          <Button
            onClick={() => navigate('/checkout')}
            disabled={!meetsMinimum || isPreLaunch()}
            className="w-full h-12 rounded-xl font-semibold text-sm disabled:opacity-50"
          >
            {isPreLaunch() ? `Opens ${launchDateFormatted()}` : meetsMinimum ? 'Checkout' : 'Add more to checkout'}
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