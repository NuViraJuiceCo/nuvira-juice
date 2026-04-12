import React, { useState } from 'react';
import SEO from '@/components/SEO';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { motion } from 'framer-motion';
import { Star, Lock, ChevronRight, Gift, Zap, ShoppingBag, Users, Trophy, CheckCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

const MILESTONES = [
  { points: 0, label: '0' },
  { points: 500, label: '500' },
  { points: 1000, label: '1K' },
  { points: 2500, label: '2.5K' },
  { points: 5000, label: '5K' },
];

const DEFAULT_REWARDS = [
  { title: 'Free 2oz Shot', description: 'Any wellness add-on shot', points_required: 500, icon: '🥃', reward_type: 'free_bottle' },
  { title: 'Free Delivery', description: 'On your next order', points_required: 1000, icon: '🚚', reward_type: 'free_delivery' },
  { title: 'Free 32oz Juice', description: 'Any flavor, any day', points_required: 2500, icon: '🍊', reward_type: 'free_bottle' },
  { title: 'Bundle Deal', description: '6-pack at the price of 4', points_required: 5000, icon: '🎁', reward_type: 'bundle' },
];

const HOW_TO_EARN = [
  { icon: ShoppingBag, label: 'Place an Order', pts: '+10 pts per $1' },
  { icon: Users, label: 'Refer a Friend', pts: '+50 pts' },
  { icon: Zap, label: 'First Order Bonus', pts: '+100 pts' },
  { icon: Star, label: 'Birthday Reward', pts: '+200 pts' },
];

export default function Rewards() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: pointsData } = useQuery({
    queryKey: ['user-points', user?.email],
    queryFn: async () => {
      const results = await base44.entities.UserPoints.filter({ customer_email: user?.email });
      return results[0] || null;
    },
    enabled: !!user?.email,
  });

  const { data: rewardTiers = [] } = useQuery({
    queryKey: ['reward-tiers'],
    queryFn: () => base44.entities.RewardTier.filter({ is_active: true }, 'sort_order', 20),
  });

  const totalPoints = pointsData?.total_points || 0;
  const rewards = rewardTiers.length > 0 ? rewardTiers : DEFAULT_REWARDS;

  const nextReward = rewards.find(r => r.points_required > totalPoints);
  const nextMilestone = MILESTONES.find(m => m.points > totalPoints) || MILESTONES[MILESTONES.length - 1];
  const prevMilestone = [...MILESTONES].reverse().find(m => m.points <= totalPoints) || MILESTONES[0];

  const progressPct = nextMilestone.points > prevMilestone.points
    ? Math.min(100, ((totalPoints - prevMilestone.points) / (nextMilestone.points - prevMilestone.points)) * 100)
    : 100;

  return (
    <div className="pb-24 bg-background min-h-screen">
      <SEO title="Rewards" description="Earn points with every NuVira order. Redeem for free bottles, free delivery, and exclusive bundles. Start earning today." />
      {/* Header */}
      <div className="relative bg-primary px-4 pt-10 pb-6 overflow-hidden">
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, white 0%, transparent 50%), radial-gradient(circle at 80% 20%, white 0%, transparent 50%)' }}
        />
        <div className="relative z-10">
          <img src={LOGO_URL} alt="NuVira" className="h-6 mb-4 brightness-0 invert opacity-80" />
          <div className="flex items-start justify-between">
            <div>
              <p className="text-primary-foreground/70 text-sm">Welcome back,</p>
              <h1 className="font-heading text-2xl font-bold text-primary-foreground">
                {user?.full_name?.split(' ')[0] || 'Friend'}
              </h1>
            </div>
            <div className="bg-white/15 rounded-2xl px-4 py-3 text-right">
              <div className="flex items-center gap-1.5 justify-end">
                <Star className="w-4 h-4 text-yellow-300 fill-yellow-300" />
                <span className="font-heading text-2xl font-bold text-white">{totalPoints.toLocaleString()}</span>
              </div>
              <p className="text-primary-foreground/70 text-xs mt-0.5">Total Points</p>
            </div>
          </div>
        </div>
      </div>

      {/* Points Progress Card */}
      <div className="mx-4 mt-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card rounded-2xl shadow-lg border border-border/40 p-5"
        >
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold">Progress to Next Reward</p>
            {nextReward && (
              <span className="text-xs text-primary font-medium">{nextReward.points_required - totalPoints} pts away</span>
            )}
          </div>

          {nextReward && (
            <p className="text-xs text-muted-foreground mb-3">
              Earn <span className="font-semibold text-foreground">{nextReward.points_required - totalPoints} more points</span> to unlock {nextReward.title}
            </p>
          )}

          {/* Progress bar */}
          <div className="relative mb-2">
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
                className="h-full bg-gradient-to-r from-primary to-primary/80 rounded-full relative"
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 border-primary rounded-full shadow-sm" />
              </motion.div>
            </div>
          </div>

          {/* Milestone labels */}
          <div className="flex justify-between mt-1">
            {MILESTONES.map(m => (
              <span key={m.points} className={`text-[10px] font-medium ${totalPoints >= m.points ? 'text-primary' : 'text-muted-foreground'}`}>
                {m.label}
              </span>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Quick Actions */}
      <div className="mx-4 mt-4 grid grid-cols-2 gap-3">
        <Link to="/shop">
          <div className="bg-primary/10 border border-primary/20 rounded-2xl p-4 text-center active:bg-primary/20 transition-colors">
            <ShoppingBag className="w-5 h-5 text-primary mx-auto mb-1.5" />
            <p className="text-xs font-bold text-primary">Order Now</p>
            <p className="text-[10px] text-muted-foreground">Earn 10 pts per $1</p>
          </div>
        </Link>
        <Link to="/referral">
          <div className="bg-accent/10 border border-accent/20 rounded-2xl p-4 text-center active:bg-accent/20 transition-colors">
            <Users className="w-5 h-5 text-accent mx-auto mb-1.5" />
            <p className="text-xs font-bold">Refer & Earn</p>
            <p className="text-[10px] text-muted-foreground">+50 pts per friend</p>
          </div>
        </Link>
      </div>

      {/* Earnable Rewards */}
      <div className="mx-4 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading text-base font-bold">Earnable Rewards</h2>
          <Trophy className="w-4 h-4 text-muted-foreground" />
        </div>

        <div className="space-y-3">
          {rewards.map((reward, i) => {
            const unlocked = totalPoints >= reward.points_required;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${
                  unlocked
                    ? 'bg-primary/5 border-primary/30'
                    : 'bg-card border-border/40'
                }`}
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shrink-0 ${
                  unlocked ? 'bg-primary/10' : 'bg-muted'
                }`}>
                  {unlocked ? (reward.icon || '🎁') : <Lock className="w-4 h-4 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${unlocked ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {reward.title}
                  </p>
                  <p className="text-xs text-muted-foreground">{reward.description}</p>
                  {!unlocked && (
                    <div className="mt-1.5 h-1 bg-muted rounded-full overflow-hidden w-24">
                      <div
                        className="h-full bg-primary/40 rounded-full"
                        style={{ width: `${Math.min(100, (totalPoints / reward.points_required) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {unlocked ? (
                    <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded-full">Earned!</span>
                  ) : (
                    <div>
                      <div className="flex items-center gap-0.5 justify-end">
                        <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                        <span className="text-xs font-bold">{reward.points_required.toLocaleString()}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">pts</p>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* How to Earn */}
      <div className="mx-4 mt-6">
        <h2 className="font-heading text-base font-bold mb-3">How to Earn Points</h2>
        <div className="bg-card rounded-2xl border border-border/40 overflow-hidden divide-y divide-border/40">
          {HOW_TO_EARN.map(({ icon: Icon, label, pts }) => (
            <div key={label} className="flex items-center justify-between px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-primary/8 rounded-lg flex items-center justify-center">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <p className="text-sm font-medium">{label}</p>
              </div>
              <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full">{pts}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Points History */}
      {pointsData?.points_history?.length > 0 && (
        <div className="mx-4 mt-6">
          <h2 className="font-heading text-base font-bold mb-3">Recent Activity</h2>
          <div className="bg-card rounded-2xl border border-border/40 overflow-hidden divide-y divide-border/40">
            {pointsData.points_history.slice(-5).reverse().map((entry, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{entry.description}</p>
                  <p className="text-[10px] text-muted-foreground">{new Date(entry.timestamp).toLocaleDateString()}</p>
                </div>
                <span className={`text-sm font-bold ${entry.type === 'redeemed' ? 'text-destructive' : 'text-primary'}`}>
                  {entry.type === 'redeemed' ? '-' : '+'}{entry.amount} pts
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="h-8" />
    </div>
  );
}