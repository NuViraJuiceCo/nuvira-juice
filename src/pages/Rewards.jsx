import React, { useState } from 'react';
import SEO from '@/components/SEO';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { motion } from 'framer-motion';
import { Star, Lock, Gift, ShoppingBag, Users, Cake, ChevronRight, Flame, Sparkles, ArrowRight } from 'lucide-react';
import { isBirthdayRewardActive } from '@/lib/birthdayReward';

import { Link, useNavigate } from 'react-router-dom';
import FreeProductPicker from '@/components/FreeProductPicker';
import { useCart } from '@/lib/cartContext';
import { toast } from 'sonner';

// ── Brand color tokens (luxury gold + deep green) ──────────────────────────
const GOLD = '#C9A24A';
const GOLD_LIGHT = '#E7C873';
const GREEN_DEEP = '#0B3D2E';
const GREEN_DARK = '#062A20';

// ── Tier definitions ────────────────────────────────────────────────────────
const TIERS = [
  { name: 'Seedling',  min: 0,    max: 499,  next: 500,  color: '#7BA05B' },
  { name: 'Silver',    min: 500,  max: 999,  next: 1000, color: '#A8A8A8' },
  { name: 'Gold',      min: 1000, max: 2499, next: 2500, color: GOLD },
  { name: 'Platinum',  min: 2500, max: 4999, next: 5000, color: '#B0C4DE' },
  { name: 'Elite',     min: 5000, max: Infinity, next: null, color: GOLD_LIGHT },
];

function getTier(pts) {
  return TIERS.find(t => pts >= t.min && pts <= t.max) || TIERS[0];
}

// ── Default rewards ─────────────────────────────────────────────────────────
const DEFAULT_REWARDS = [
  { title: 'Free Wellness Shot', description: 'Any wellness add-on shot', points_required: 500,  icon: '💛', reward_type: 'free_bottle' },
  { title: 'Free Delivery',       description: 'On your next order',       points_required: 1000, icon: '🚚', reward_type: 'free_delivery' },
  { title: 'Free 32oz Juice',     description: 'Any flavor, any day',      points_required: 2500, icon: '🍊', reward_type: 'free_bottle' },
  { title: 'Bundle Deal',         description: '6-pack at the price of 3', points_required: 5000, icon: '🎁', reward_type: 'bundle' },
];

const HOW_TO_EARN = [
  { icon: ShoppingBag, label: 'Place an Order',     pts: '10 pts / $1' },
  { icon: Users,       label: 'Refer a Friend',     pts: '50 pts' },
  { icon: Flame,       label: 'First Order Bonus',  pts: '100 pts' },
  { icon: Cake,        label: 'Birthday Bonus',     pts: '200 pts' },
];

// ── Luxury tier hero card ───────────────────────────────────────────────────
function TierHeroCard({ totalPoints, lifetimePoints, redeemedPoints, tier }) {
  const ptsToNext = tier.next ? tier.next - totalPoints : 0;
  const progressPct = tier.next
    ? Math.min(100, ((totalPoints - tier.min) / (tier.next - tier.min)) * 100)
    : 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="mx-4 mt-5 rounded-3xl overflow-hidden shadow-2xl relative border border-[#C9A24A]/25"
      style={{ background: `linear-gradient(135deg, #0B3D2E 0%, #0E5A43 42%, #0A6A50 100%)` }}
    >
      {/* Gold accent arc */}
      <div className="absolute" style={{
        top: -60, right: -60, width: 200, height: 200,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${GOLD}25 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      <div className="relative px-6 pt-8 pb-6">
        {/* Tier badge row */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: `${tier.color}25`, border: `1.5px solid ${tier.color}65` }}>
              <Star className="w-4 h-4" style={{ color: tier.color, fill: tier.color }} />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#FFFFFF' }}>Current Tier</p>
              <p className="text-sm font-bold text-white">{tier.name} Member</p>
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider" style={{ background: `${GOLD}35`, color: '#FFFFFF', border: `1px solid ${GOLD}60` }}>
            {tier.name}
          </div>
        </div>

        {/* Points balance */}
        <div className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#FFFFFF' }}>Your Balance</p>
          <p className="font-heading font-bold text-white leading-none" style={{ fontSize: 48 }}>
            {totalPoints.toLocaleString()}
          </p>
          <p className="text-sm mt-1.5" style={{ color: '#E8F5E9' }}>loyalty points</p>
        </div>

        {/* Progress to next tier */}
        {tier.next && (
          <div className="mb-2">
            <div className="flex justify-between mb-2">
              <p className="text-xs text-white/90">{tier.name}</p>
              <p className="text-xs font-bold" style={{ color: '#FFFFFF' }}>{ptsToNext.toLocaleString()} pts to {TIERS[TIERS.findIndex(t => t.name === tier.name) + 1]?.name}</p>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.2)' }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 1.2, ease: 'easeOut', delay: 0.4 }}
                className="h-full rounded-full"
                style={{ background: `linear-gradient(90deg, ${GOLD} 0%, ${GOLD_LIGHT} 100%)` }}
              />
            </div>
          </div>
        )}
        {!tier.next && (
          <div className="flex items-center gap-2 mt-1">
            <Sparkles className="w-4 h-4" style={{ color: GOLD_LIGHT }} />
            <p className="text-sm font-bold" style={{ color: '#FFFFFF' }}>You've reached Elite status!</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Stat mini cards ─────────────────────────────────────────────────────────
function StatCards({ totalPoints, lifetimePoints, redeemedPoints }) {
  const stats = [
    { label: 'Available',  value: totalPoints.toLocaleString(),   icon: Star,       gold: true },
    { label: 'Lifetime',   value: lifetimePoints.toLocaleString(), icon: Sparkles,  gold: false },
    { label: 'Redeemed',   value: redeemedPoints.toLocaleString(), icon: Gift,      gold: false },
  ];
  return (
    <div className="mx-4 mt-4 grid grid-cols-3 gap-3">
      {stats.map(({ label, value, icon: Icon, gold }, i) => (
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 + i * 0.07 }}
          className="rounded-2xl p-3.5 text-center"
          style={{
            background: gold 
              ? `linear-gradient(135deg, rgba(201,162,74,0.20) 0%, rgba(231,200,115,0.12) 100%)`
              : 'hsl(var(--card))',
            border: gold ? `1.5px solid rgba(201,162,74,0.65)` : '1.5px solid hsl(var(--border))',
            boxShadow: gold
              ? '0 4px 16px rgba(201,162,74,0.15), 0 1px 4px rgba(0,0,0,0.08)'
              : '0 4px 14px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div className="w-7 h-7 rounded-full flex items-center justify-center mx-auto mb-1.5"
            style={{ background: gold ? `${GOLD}25` : 'hsl(var(--muted))' }}>
            <Icon className="w-3.5 h-3.5" style={{ color: gold ? '#7A5F20' : 'hsl(var(--muted-foreground))' }} />
          </div>
          <p className="font-heading text-base font-bold text-foreground">{value}</p>
          <p className="text-[10px] font-semibold mt-0.5" style={{ color: gold ? '#7A5F20' : 'hsl(var(--muted-foreground))' }}>{label}</p>
        </motion.div>
      ))}
    </div>
  );
}

// ── Reward card (horizontal scroll) ────────────────────────────────────────
function RewardCard({ reward, totalPoints, activeReward, onApply, onRemove, index }) {
  const unlocked = totalPoints >= reward.points_required;
  const isActive = activeReward?.id === reward.id || activeReward?.title === reward.title;
  const progressPct = Math.min(100, (totalPoints / reward.points_required) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.07 }}
      className="shrink-0 w-[155px] snap-start rounded-2xl overflow-hidden"
      style={{
        border: unlocked ? `1.5px solid rgba(201,162,74,0.65)` : '1.5px solid hsl(var(--border))',
        background: unlocked
          ? `linear-gradient(135deg, rgba(11,61,46,0.09) 0%, rgba(201,162,74,0.14) 100%)`
          : 'hsl(var(--card))',
        boxShadow: unlocked
          ? `0 8px 28px rgba(201,162,74,0.18), 0 2px 6px rgba(0,0,0,0.10)`
          : '0 4px 14px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      {/* Top panel */}
      <div className="h-20 flex items-center justify-center relative overflow-hidden"
        style={{ background: unlocked ? `linear-gradient(135deg, ${GREEN_DEEP} 0%, ${GREEN_DARK} 100%)` : 'hsl(var(--muted))' }}>
        {unlocked && (
          <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 80% 20%, ${GOLD}30 0%, transparent 60%)` }} />
        )}
        <span className="text-3xl relative z-10">{reward.icon || '🎁'}</span>
        {unlocked && (
          <div className="absolute top-2 right-2 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide"
            style={{ background: `${GOLD}40`, color: '#FFFFFF', border: `1px solid ${GOLD}65` }}>
            Unlocked
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3">
        <p className="text-xs font-bold mb-1 leading-tight line-clamp-2" style={{ color: 'hsl(var(--foreground))' }}>{reward.title}</p>
        <p className="text-[10px] font-medium mb-2 line-clamp-2" style={{ color: 'hsl(var(--muted-foreground))' }}>{reward.description}</p>

        {/* Points required */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-0.5 min-w-0">
            <Star className="w-2.5 h-2.5 shrink-0" style={{ color: unlocked ? GOLD : 'hsl(var(--muted-foreground))', fill: unlocked ? GOLD : 'hsl(var(--muted-foreground))' }} />
            <span className="text-[10px] font-bold truncate" style={{ color: unlocked ? '#9A7B2F' : 'hsl(var(--muted-foreground))' }}>
              {reward.points_required.toLocaleString()}
            </span>
          </div>
          {unlocked ? (
            isActive ? (
              <button onClick={onRemove}
                className="text-[9px] font-bold px-2 py-1 rounded-lg shrink-0"
                style={{ background: 'hsl(var(--destructive)/0.15)', color: 'hsl(var(--destructive))' }}>
                ✓
              </button>
            ) : (
              <button onClick={onApply}
                className="text-[9px] font-bold px-2 py-1 rounded-lg shrink-0 text-white"
                style={{ background: `linear-gradient(90deg, ${GREEN_DEEP} 0%, ${GREEN_DARK} 100%)` }}>
                Redeem
              </button>
            )
          ) : (
            <div className="w-12 h-1.5 rounded-full shrink-0" style={{ background: 'hsl(var(--muted))' }}>
              <div className="h-full rounded-full" style={{ width: `${progressPct}%`, background: `linear-gradient(90deg, ${GOLD} 0%, ${GOLD_LIGHT} 100%)` }} />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Guest / logged-out view ─────────────────────────────────────────────────
function GuestView() {
  return (
    <div className="pb-28" style={{ background: 'hsl(var(--background))' }}>
      <SEO title="Rewards" description="Earn points with every NuVira order. Redeem for free bottles, free delivery, and exclusive bundles." />

      {/* Hero */}
      <div className="mx-4 mt-6 rounded-3xl overflow-hidden shadow-xl"
        style={{ background: `linear-gradient(145deg, ${GREEN_DEEP} 0%, ${GREEN_DARK} 100%)` }}>
        <div className="px-6 py-8 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ background: `${GOLD}22`, border: `1.5px solid ${GOLD}44` }}>
            <Star className="w-8 h-8" style={{ color: GOLD_LIGHT, fill: GOLD_LIGHT }} />
          </div>
          <h1 className="font-heading text-2xl font-bold text-white mb-2">NuVira Rewards</h1>
          <p className="text-sm mb-6" style={{ color: 'rgba(255,255,255,0.65)' }}>
            Earn points on every order. Unlock free bottles, delivery, and exclusive drops.
          </p>
          <button
            onClick={() => base44.auth.redirectToLogin(window.location.pathname)}
            className="w-full h-12 rounded-2xl font-bold text-sm"
            style={{ background: `linear-gradient(90deg, ${GOLD} 0%, ${GOLD_LIGHT} 100%)`, color: '#062A20' }}
          >
            Sign In to Start Earning
          </button>
        </div>
      </div>

      {/* How to Earn */}
      <div className="mx-4 mt-6">
        <p className="font-heading text-lg font-bold mb-3">How to Earn</p>
        <div className="grid grid-cols-2 gap-3">
          {HOW_TO_EARN.map(({ icon: Icon, label, pts }) => (
            <div key={label} className="rounded-2xl p-4 border"
              style={{ background: 'hsl(var(--card))', borderColor: `${GOLD}22` }}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-2"
                style={{ background: `${GOLD}25` }}>
                <Icon className="w-4 h-4" style={{ color: '#7A5F20' }} />
              </div>
              <p className="text-sm font-semibold text-foreground">{label}</p>
              <p className="text-xs mt-0.5 font-bold" style={{ color: '#7A5F20' }}>{pts}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Rewards preview */}
      <div className="mx-4 mt-6">
        <p className="font-heading text-lg font-bold mb-3">Rewards to Unlock</p>
        <div className="space-y-3">
          {DEFAULT_REWARDS.map((reward, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl p-4 border"
              style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border) / 0.4)' }}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0"
                style={{ background: `${GOLD}12` }}>{reward.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{reward.title}</p>
                <p className="text-xs text-muted-foreground">{reward.description}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Star className="w-3 h-3" style={{ color: '#E7C873', fill: '#E7C873' }} />
                <span className="text-xs font-bold" style={{ color: '#E7C873' }}>{reward.points_required.toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="h-8" />
    </div>
  );
}

// ── Main authenticated view ─────────────────────────────────────────────────
export default function Rewards() {
  const { user } = useAuth();
  const { addItem } = useCart();
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingReward, setPendingReward] = useState(null);

  // Single backend call resolves all Apple relay identities for points/orders/profile
  const { data: dashData } = useQuery({
    queryKey: ['account-dashboard', user?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke('getCustomerAccountDashboardData', {});
      return res.data || {};
    },
    enabled: !!user?.email,
    staleTime: 60 * 1000,
  });

  const pointsData = dashData?.points_record || null;
  const validOrders = dashData?.orders || [];
  const userProfile = dashData?.customer_profile || null;

  const { data: rewardTiers = [] } = useQuery({
    queryKey: ['reward-tiers'],
    queryFn: () => base44.entities.RewardTier.filter({ is_active: true }, 'sort_order', 20),
  });

  const totalPoints    = pointsData?.total_points    || 0;
  const lifetimePoints = pointsData?.lifetime_points || 0;
  const redeemedPoints = pointsData?.redeemed_points || 0;
  const birthday       = userProfile?.birthday || user?.birthday;
  const birthdayActive = isBirthdayRewardActive(birthday, user?.created_date);
  const rewards        = rewardTiers.length > 0 ? rewardTiers : DEFAULT_REWARDS;
  const tier           = getTier(totalPoints);

  const [activeReward, setActiveReward] = useState(() => {
    if (!user?.email) return null;
    try { return JSON.parse(localStorage.getItem(`activeReward_${user.email}`)) || null; } catch { return null; }
  });

  // ── Reward apply/remove logic (unchanged) ──
  const handleApplyReward = async (reward) => {
    if (reward.reward_type === 'free_bottle') {
      setPendingReward(reward);
      setPickerOpen(true);
      return;
    }
    try {
      await base44.functions.invoke('claimReward', {
        email: user.email,
        reward_id: reward.id,
        reward_title: reward.title,
        reward_type: reward.reward_type,
      });
    } catch (err) {
      console.warn('Failed to sync reward claim:', err.message);
    }
    const r = { id: reward.id, title: reward.title, description: reward.description, reward_type: reward.reward_type, points_required: reward.points_required, icon: reward.icon };
    localStorage.setItem(`activeReward_${user.email}`, JSON.stringify(r));
    setActiveReward(r);
    toast.success(`${reward.title} applied! Head to your cart to use it.`);
  };

  const handleFreeProductSelect = (product) => {
    addItem({ ...product, id: `__free_reward_${product.id}__`, price: 0, title: `${pendingReward?.icon || '🎁'} ${product.title} (Free)` }, 1, { isFreeReward: true });
    setPickerOpen(false);
    setPendingReward(null);
    toast.success(`${product.title} added to your cart for free!`);
    navigate('/cart');
  };

  const handleRemoveReward = () => {
    localStorage.removeItem(`activeReward_${user.email}`);
    setActiveReward(null);
    toast.success('Reward removed.');
  };

  if (!user) return <GuestView />;

  return (
    <div className="pb-32" style={{ background: 'hsl(var(--background))' }}>
      <SEO title="Rewards" description="Earn points with every NuVira order. Redeem for free bottles, free delivery, and exclusive bundles." />

      {/* Page title with safe-area padding */}
      <div className="px-4 pt-6 pb-2 flex items-center justify-between" style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}>
        <h1 className="font-heading text-2xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>Rewards</h1>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
          style={{ background: `${tier.color}25`, color: '#FFFFFF', border: `1.5px solid ${tier.color}55` }}>
          <Star className="w-3 h-3" style={{ fill: tier.color }} />
          {tier.name}
        </div>
      </div>

      {/* ── Tier Hero Card ── */}
      <TierHeroCard totalPoints={totalPoints} lifetimePoints={lifetimePoints} redeemedPoints={redeemedPoints} tier={tier} />

      {/* ── Stat mini cards ── */}
      <StatCards totalPoints={totalPoints} lifetimePoints={lifetimePoints} redeemedPoints={redeemedPoints} />

      {/* ── Birthday reward ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="mx-4 mt-4 rounded-2xl p-4 flex items-center gap-4"
        style={{
          background: birthdayActive ? '#FFF0F4' : 'hsl(var(--card))',
          border: birthdayActive ? '1.5px solid #F9BBCA' : '1.5px solid hsl(var(--border))',
          boxShadow: '0 4px 14px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0"
          style={{ background: birthdayActive ? '#FFD6E0' : 'hsl(var(--muted))' }}>
          <Cake className="w-5 h-5" style={{ color: birthdayActive ? '#E05577' : 'hsl(var(--muted-foreground))' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: birthdayActive ? '#9A1133' : 'hsl(var(--foreground))' }}>Birthday Reward</p>
          {birthdayActive ? (
            <p className="text-xs" style={{ color: '#C0325A' }}>🎂 Your free 12oz juice is ready!</p>
          ) : (
            <p className="text-xs text-muted-foreground">{birthday ? 'Free juice valid 30 days after your birthday' : 'Add your birthday in Settings to unlock'}</p>
          )}
        </div>
        {birthdayActive ? (
          <Link to="/cart">
            <span className="text-xs font-bold px-3 py-1.5 rounded-xl whitespace-nowrap" style={{ background: '#FFD6E0', color: '#9A1133' }}>Claim →</span>
          </Link>
        ) : !birthday ? (
          <Link to="/account/settings">
            <span className="text-xs font-bold px-3 py-1.5 rounded-xl whitespace-nowrap" style={{ background: GOLD, color: '#1A0F00', border: `1px solid ${GOLD}` }}>Set Date</span>
          </Link>
        ) : null}
      </motion.div>

      {/* ── Redeem Rewards ── */}
      <div className="mt-8">
        <div className="flex items-center justify-between px-4 mb-3">
          <div>
            <h2 className="font-heading text-lg font-bold">Redeem Rewards</h2>
            <p className="text-[11px] text-muted-foreground">Swipe for more</p>
          </div>
        </div>
        <div className="flex gap-4 overflow-x-auto px-5 pb-2 snap-x snap-mandatory" style={{ scrollbarWidth: 'none', scrollPaddingLeft: '1.25rem', scrollPaddingRight: '1.25rem' }}>
          {rewards.map((reward, i) => (
            <RewardCard
              key={i}
              reward={reward}
              totalPoints={totalPoints}
              activeReward={activeReward}
              onApply={() => handleApplyReward(reward)}
              onRemove={handleRemoveReward}
              index={i}
            />
          ))}
        </div>
      </div>

      {/* ── How to Earn ── */}
      <div className="mx-4 mt-8">
        <h2 className="font-heading text-xl font-bold mb-4" style={{ color: 'hsl(var(--foreground))' }}>How to Earn</h2>
        <div className="grid grid-cols-2 gap-3">
          {HOW_TO_EARN.map(({ icon: Icon, label, pts }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i }}
              className="rounded-2xl p-4"
              style={{ background: 'hsl(var(--card))', border: `1.5px solid ${GOLD}55`, boxShadow: '0 3px 10px rgba(0,0,0,0.07)' }}
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2.5"
                style={{ background: `${GOLD}25` }}>
                <Icon className="w-4 h-4" style={{ color: '#7A5F20' }} />
              </div>
              <p className="text-sm font-bold mb-0.5 text-foreground">{label}</p>
              <p className="text-xs font-bold" style={{ color: '#7A5F20' }}>{pts}</p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── Referral card ── */}
      <div className="mx-4 mt-6">
        <Link to="/referral">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="rounded-2xl p-5 flex items-center justify-between overflow-hidden relative"
            style={{ background: `linear-gradient(135deg, ${GREEN_DEEP} 0%, ${GREEN_DARK} 100%)`, boxShadow: `0 4px 20px ${GREEN_DEEP}30` }}
          >
            <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 90% 50%, ${GOLD}20 0%, transparent 60%)`, pointerEvents: 'none' }} />
            <div className="relative z-10">
              <div className="w-10 h-10 rounded-full flex items-center justify-center mb-3"
                style={{ background: `${GOLD}30`, border: `1.5px solid ${GOLD}55` }}>
                <Users className="w-5 h-5" style={{ color: '#FFFFFF' }} />
              </div>
              <p className="font-heading text-lg font-bold text-white">Invite Friends</p>
              <p className="text-sm" style={{ color: '#E8F5E9' }}>Give $10 · Get 250 Points</p>
            </div>
            <div className="relative z-10 flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm"
              style={{ background: `linear-gradient(90deg, ${GOLD} 0%, ${GOLD_LIGHT} 100%)`, color: '#062A20' }}>
              Invite <ArrowRight className="w-4 h-4" />
            </div>
          </motion.div>
        </Link>
      </div>

      {/* ── Quick actions ── */}
      <div className="mx-4 mt-4 grid grid-cols-2 gap-3">
        <Link to="/shop">
          <div className="rounded-2xl p-4 flex items-center gap-3 active:opacity-80 transition-opacity"
            style={{ background: `${GREEN_DEEP}12`, border: `1.5px solid ${GREEN_DEEP}30` }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: `${GREEN_DEEP}20` }}>
              <ShoppingBag className="w-4 h-4" style={{ color: '#0B7A50' }} />
            </div>
            <div>
              <p className="text-xs font-bold text-foreground">Shop Now</p>
              <p className="text-[10px] font-semibold text-muted-foreground">10 pts per $1</p>
            </div>
          </div>
        </Link>
        <Link to="/account/settings">
          <div className="rounded-2xl p-4 flex items-center gap-3 active:opacity-80 transition-opacity"
            style={{ background: `${GOLD}15`, border: `1.5px solid ${GOLD}40` }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: `${GOLD}30` }}>
              <Cake className="w-4 h-4" style={{ color: '#7A5F20' }} />
            </div>
            <div>
              <p className="text-xs font-bold text-foreground">Birthday Perk</p>
              <p className="text-[10px] font-semibold text-muted-foreground">Free juice</p>
            </div>
          </div>
        </Link>
      </div>

      {/* ── Recent Activity ── */}
      {pointsData?.points_history?.length > 0 ? (
        <div className="mx-4 mt-8 mb-4">
          <h2 className="font-heading text-xl font-bold mb-4" style={{ color: 'hsl(var(--foreground))' }}>Recent Activity</h2>
          <div className="rounded-2xl overflow-hidden divide-y"
            style={{ background: 'hsl(var(--card))', border: '1.5px solid hsl(var(--border) / 0.5)', divideColor: 'hsl(var(--border) / 0.5)' }}>
            {pointsData.points_history.slice(-6).reverse().map((entry, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: entry.type === 'redeemed' ? 'hsl(var(--muted))' : `${GOLD}20` }}>
                    {entry.type === 'redeemed'
                      ? <Gift className="w-3.5 h-3.5" style={{ color: 'hsl(var(--muted-foreground))' }} />
                      : <Star className="w-3.5 h-3.5" style={{ color: '#9A7B2F', fill: '#9A7B2F' }} />
                    }
                  </div>
                  <div>
                    <p className="text-sm font-semibold leading-snug" style={{ color: 'hsl(var(--foreground))' }}>{entry.description}</p>
                    <p className="text-[10px] font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>{new Date(entry.timestamp).toLocaleDateString()}</p>
                  </div>
                </div>
                <span className="text-sm font-bold shrink-0 ml-3"
                  style={{ color: entry.type === 'redeemed' ? 'hsl(var(--destructive))' : '#0B3D2E' }}>
                  {entry.type === 'redeemed' ? '-' : '+'}{entry.amount} pts
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mx-4 mt-8 mb-4">
          <h2 className="font-heading text-xl font-bold mb-4" style={{ color: 'hsl(var(--foreground))' }}>Recent Activity</h2>
          <div className="rounded-2xl p-8 text-center"
            style={{ background: 'hsl(var(--card))', border: `1.5px solid ${GOLD}25` }}>
            <Star className="w-8 h-8 mx-auto mb-3" style={{ color: `${GOLD}70` }} />
            <p className="text-sm font-semibold text-foreground mb-1">No activity yet</p>
            <p className="text-xs font-medium text-muted-foreground">Place your first order to start earning points.</p>
            <Link to="/shop">
              <div className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold"
                style={{ background: `${GREEN_DEEP}`, color: 'white' }}>
                Shop Now <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </Link>
          </div>
        </div>
      )}

      {/* Extra bottom padding for safe scrolling above nav */}
      <div className="h-12" />

      <FreeProductPicker
        open={pickerOpen}
        onClose={() => { setPickerOpen(false); setPendingReward(null); }}
        onSelect={handleFreeProductSelect}
        title={pendingReward ? `Choose Your ${pendingReward.title}` : 'Choose Your Free Item'}
        category="juice"
      />
    </div>
  );
}