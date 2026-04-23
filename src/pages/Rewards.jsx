import React, { useState } from 'react';
import SEO from '@/components/SEO';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { motion } from 'framer-motion';
import { Star, Lock, ChevronRight, Gift, Zap, ShoppingBag, Users, Trophy, CheckCircle, Cake } from 'lucide-react';
import { isBirthdayRewardActive } from '@/lib/birthdayReward';
import { isPreorderMode } from '@/lib/preorderConfig';
import { Link, useNavigate } from 'react-router-dom';
import FreeProductPicker from '@/components/FreeProductPicker';
import RewardsSuccessModal from '@/components/RewardsSuccessModal';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { useCart } from '@/lib/cartContext';
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
  { title: 'Free Wellness Shot', description: 'Any wellness add-on shot', points_required: 500, icon: '💛', reward_type: 'free_bottle' },
  { title: 'Free Delivery', description: 'On your next order', points_required: 1000, icon: '🚚', reward_type: 'free_delivery' },
  { title: 'Free 32oz Juice', description: 'Any flavor, any day', points_required: 2500, icon: '🍊', reward_type: 'free_bottle' },
  { title: 'Bundle Deal', description: '6-pack at the price of 3', points_required: 5000, icon: '🎁', reward_type: 'bundle' },
];

const HOW_TO_EARN = [
  { icon: ShoppingBag, label: 'Place an Order', pts: '+10 pts per $1' },
  { icon: Users, label: 'Refer a Friend', pts: '+50 pts' },
  { icon: Zap, label: 'First Order Bonus', pts: '+100 pts' },
];

const PREORDER_EARN = { icon: Star, label: 'Pre-Order Launch Bonus', pts: '+250 pts' };

export default function Rewards() {
  const { user } = useAuth();
  const { addItem } = useCart();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingReward, setPendingReward] = useState(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successName, setSuccessName] = useState('');
  const [successEmail, setSuccessEmail] = useState('');

  const { data: pointsData } = useQuery({
    queryKey: ['user-points', user?.email],
    queryFn: async () => {
      const results = await base44.entities.UserPoints.filter({ customer_email: user?.email });
      return results[0] || null;
    },
    enabled: !!user?.email,
  });

  const { data: userProfile } = useQuery({
    queryKey: ['user-profile-rewards', user?.email],
    queryFn: async () => {
      const profiles = await base44.entities.UserProfile.filter({ customer_email: user?.email });
      return profiles[0] || null;
    },
    enabled: !!user?.email,
  });

  const { data: rewardTiers = [] } = useQuery({
    queryKey: ['reward-tiers'],
    queryFn: () => base44.entities.RewardTier.filter({ is_active: true }, 'sort_order', 20),
  });

  const totalPoints = pointsData?.total_points || 0;
  const birthday = userProfile?.birthday || user?.birthday;
  const birthdayActive = isBirthdayRewardActive(birthday, user?.created_date);
  const rewards = rewardTiers.length > 0 ? rewardTiers : DEFAULT_REWARDS;

  const [activeReward, setActiveReward] = useState(() => {
    if (!user?.email) return null;
    try { return JSON.parse(localStorage.getItem(`activeReward_${user.email}`)) || null; } catch { return null; }
  });
  
  const [signupForm, setSignupForm] = useState({ email: '', first_name: '', last_name: '', phone: '', address: { street: '', city: '', state: '', zip: '' }, birthday: '' });
  const [signupLoading, setSignupLoading] = useState(false);

  const handleApplyReward = (reward) => {
    if (reward.reward_type === 'free_bottle') {
      setPendingReward(reward);
      setPickerOpen(true);
      return;
    }
    const r = { id: reward.id, title: reward.title, description: reward.description, reward_type: reward.reward_type, points_required: reward.points_required, icon: reward.icon };
    localStorage.setItem(`activeReward_${user.email}`, JSON.stringify(r));
    setActiveReward(r);
    toast.success(`${reward.title} applied! Head to your cart to use it.`);
  };

  const handleFreeProductSelect = (product) => {
    // Add the chosen product to cart as free
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

  const handleSignupSubmit = async (e) => {
    e.preventDefault();
    
    const addrString = [signupForm.address.street, signupForm.address.city, signupForm.address.state, signupForm.address.zip].filter(Boolean).join(', ');
    if (!signupForm.email?.trim() || !signupForm.first_name?.trim() || !signupForm.last_name?.trim() || !signupForm.phone?.trim() || !addrString?.trim() || !signupForm.birthday?.trim()) {
      toast.error('Please fill in all fields');
      return;
    }
    
    setSignupLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    try {
      const res = await Promise.race([
        base44.functions.invoke('createLoyaltyMember', {
          email: signupForm.email.trim(),
          first_name: signupForm.first_name.trim(),
          last_name: signupForm.last_name.trim(),
          phone: signupForm.phone.trim(),
          address: addrString.trim(),
          birthday: signupForm.birthday,
          signup_date: new Date().toISOString().split('T')[0],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 10000))
      ]);

      clearTimeout(timeoutId);
      
      if (res.data?.success) {
        setSuccessName(signupForm.first_name);
        setSuccessEmail(signupForm.email);
        setShowSuccessModal(true);
        setSignupForm({ email: '', first_name: '', last_name: '', phone: '', address: { street: '', city: '', state: '', zip: '' }, birthday: '' });
        setSignupLoading(false);
      } else {
        toast.error(res.data?.error || 'Failed to sign up.');
        setSignupLoading(false);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('Signup error:', err.message);
      toast.error(err.message === 'Request timeout' ? 'Request took too long. Please try again.' : (err.message || 'Failed to sign up. Please try again.'));
      setSignupLoading(false);
    }
  };

  const nextReward = rewards.find(r => r.points_required > totalPoints);
  const nextMilestone = MILESTONES.find(m => m.points > totalPoints) || MILESTONES[MILESTONES.length - 1];
  const prevMilestone = [...MILESTONES].reverse().find(m => m.points <= totalPoints) || MILESTONES[0];

  const progressPct = nextMilestone.points > prevMilestone.points
    ? Math.min(100, ((totalPoints - prevMilestone.points) / (nextMilestone.points - prevMilestone.points)) * 100)
    : 100;

  if (!user) {
    return (
      <div className="pb-24 bg-background min-h-screen">
        <SEO title="Rewards" description="Earn points with every NuVira order. Redeem for free bottles, free delivery, and exclusive bundles. Start earning today." />
        <div className="relative bg-primary px-4 pt-10 pb-8 overflow-hidden">
          <div className="absolute inset-0 opacity-10"
            style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, white 0%, transparent 50%), radial-gradient(circle at 80% 20%, white 0%, transparent 50%)' }}
          />
          <div className="relative z-10 text-center">
            <img src={LOGO_URL} alt="NuVira" className="h-6 mb-5 brightness-0 invert opacity-80 mx-auto" />
            <div className="w-16 h-16 bg-white/15 rounded-full flex items-center justify-center mx-auto mb-4">
              <Star className="w-8 h-8 text-yellow-300 fill-yellow-300" />
            </div>
            <h1 className="font-heading text-2xl font-bold text-primary-foreground mb-2">NuVira Rewards</h1>
            <p className="text-primary-foreground/80 text-sm max-w-xs mx-auto">Earn points on every order and unlock free bottles, delivery, and exclusive bundles.</p>
          </div>
        </div>

        <div className="mx-4 mt-5 space-y-3">
          {/* Signup Form */}
          <div className="bg-card border border-primary/30 rounded-2xl p-5 shadow-sm">
            <Trophy className="w-8 h-8 text-primary mx-auto mb-3" />
            <h2 className="font-heading text-xl font-bold mb-1 text-center">Join NuVira Rewards</h2>
            <p className="text-xs text-muted-foreground mb-4 text-center">Create your account and start earning points today</p>
            {isPreorderMode() && (
              <div className="mb-3 bg-primary/10 border border-primary/20 rounded-xl p-3 text-center">
                <p className="text-xs font-bold text-primary">🎉 Bonus: Earn 250 points just for signing up!</p>
              </div>
            )}
            <form onSubmit={handleSignupSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="First Name"
                  value={signupForm.first_name}
                  onChange={(e) => setSignupForm({ ...signupForm, first_name: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm"
                  required
                />
                <input
                  type="text"
                  placeholder="Last Name"
                  value={signupForm.last_name}
                  onChange={(e) => setSignupForm({ ...signupForm, last_name: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm"
                  required
                />
              </div>
              <input
                type="email"
                placeholder="Email"
                value={signupForm.email}
                onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm"
                required
              />
              <input
                type="tel"
                placeholder="Phone Number"
                value={signupForm.phone}
                onChange={(e) => setSignupForm({ ...signupForm, phone: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm"
                required
              />
              <AddressAutocomplete
                value={signupForm.address}
                onChange={(addr) => setSignupForm({ ...signupForm, address: addr })}
                placeholder="Street Address"
                className="h-10 rounded-lg"
              />
              <input
                type="date"
                placeholder="Birthday"
                value={signupForm.birthday}
                onChange={(e) => setSignupForm({ ...signupForm, birthday: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm"
                required
              />
              <button
                type="submit"
                disabled={signupLoading}
                className="w-full h-11 bg-primary text-primary-foreground rounded-xl font-semibold text-sm disabled:opacity-50"
              >
                {signupLoading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>
          </div>

          {/* How it works */}
          <div className="bg-card rounded-2xl border border-border/40 overflow-hidden divide-y divide-border/40">
            <div className="px-4 py-3 bg-muted/40">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">How to Earn</p>
            </div>
            {[...HOW_TO_EARN, ...(isPreorderMode() ? [PREORDER_EARN] : [])].map(({ icon: Icon, label, pts }) => (
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

          {/* Preview rewards */}
          <h2 className="font-heading text-base font-bold pt-2">Rewards You Can Unlock</h2>
          <div className="space-y-2">
            {DEFAULT_REWARDS.map((reward, i) => (
              <div key={i} className="flex items-center gap-3 bg-card border border-border/40 rounded-2xl p-4">
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-lg shrink-0">
                  {reward.icon}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold">{reward.title}</p>
                  <p className="text-xs text-muted-foreground">{reward.description}</p>
                </div>
                <div className="flex items-center gap-0.5">
                  <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                  <span className="text-xs font-bold">{reward.points_required.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="h-8" />
      </div>
    );
  }

  return (
    <div className="pb-24 bg-background min-h-screen">
      <SEO title="Rewards" description="Earn points with every NuVira order. Redeem for free bottles, free delivery, and exclusive bundles. Start earning today." />
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

      {/* Birthday Reward */}
      <div className="mx-4 mt-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className={`rounded-2xl border p-4 flex items-center gap-4 ${
            birthdayActive
              ? 'bg-pink-50 border-pink-200'
              : 'bg-card border-border/40'
          }`}
        >
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shrink-0 ${
            birthdayActive ? 'bg-pink-100' : 'bg-muted'
          }`}>
            <Cake className={`w-6 h-6 ${birthdayActive ? 'text-pink-500' : 'text-muted-foreground'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${birthdayActive ? 'text-pink-900' : 'text-foreground'}`}>
              Birthday Reward
            </p>
            {birthdayActive ? (
              <p className="text-xs text-pink-700">🎂 Your free 12oz juice is waiting in your cart!</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {birthday ? 'Free 12oz juice valid 30 days after your birthday' : 'Add your birthday in Settings to unlock'}
              </p>
            )}
          </div>
          {birthdayActive ? (
            <Link to="/cart">
              <span className="text-xs font-bold text-pink-600 bg-pink-100 px-2.5 py-1 rounded-full whitespace-nowrap">Claim →</span>
            </Link>
          ) : !birthday ? (
            <Link to="/account/settings">
              <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full whitespace-nowrap">Set Birthday</span>
            </Link>
          ) : null}
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
                  unlocked ? 'bg-green-100' : 'bg-muted'
                }`}>
                  {reward.icon || '🎁'}
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
                    activeReward?.id === reward.id ? (
                      <button
                        onClick={handleRemoveReward}
                        className="text-xs font-bold text-destructive bg-destructive/10 px-2.5 py-1 rounded-full whitespace-nowrap"
                      >Applied ✓</button>
                    ) : (
                      <button
                        onClick={() => handleApplyReward(reward)}
                        className="text-xs font-bold text-white bg-primary px-2.5 py-1 rounded-full whitespace-nowrap"
                      >Apply →</button>
                    )
                  ) : (
                    <div className="flex items-center gap-1">
                      <Lock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs font-bold text-muted-foreground">{reward.points_required.toLocaleString()}</span>
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
          {[...HOW_TO_EARN, ...(isPreorderMode() ? [PREORDER_EARN] : [])].map(({ icon: Icon, label, pts }) => (
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

      <FreeProductPicker
        open={pickerOpen}
        onClose={() => { setPickerOpen(false); setPendingReward(null); }}
        onSelect={handleFreeProductSelect}
        title={pendingReward ? `Choose Your ${pendingReward.title}` : 'Choose Your Free Item'}
        category="juice"
      />

      <RewardsSuccessModal
        open={showSuccessModal}
        onClose={() => setShowSuccessModal(false)}
        email={successEmail}
        name={successName || 'Friend'}
      />
    </div>
  );
}