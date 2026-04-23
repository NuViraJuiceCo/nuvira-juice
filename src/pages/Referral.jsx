import React, { useState } from 'react';
import SEO from '@/components/SEO';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Gift, Copy, Share2, Users, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

function generateCode(user) {
  return 'NuVira26';
}

const steps = [
  { step: '1', title: 'Share your code', desc: 'Send your unique referral code to friends and family.' },
  { step: '2', title: 'They order', desc: 'Your friend gets $5 off their first NuVira order.' },
  { step: '3', title: 'You earn', desc: 'You get a free bottle credit after their first delivery.' },
];

export default function Referral() {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);

  const code = generateCode(user);
  const shareMessage = `Hey! I've been loving NuVira cold-pressed juice — it's fresh, real, and actually good for you. Use my code ${code} for $5 off your first order. Order at nuvirajuice.com 🌿`;

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success('Code copied!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({ title: 'NuVira Juice', text: shareMessage });
    } else {
      navigator.clipboard.writeText(shareMessage);
      toast.success('Message copied — paste and share!');
    }
  };

  const handleInvite = async () => {
    if (!email) return;
    setSending(true);
    await base44.integrations.Core.SendEmail({
      to: 'nuvirajuiceco@gmail.com',
      subject: `Referral Invite from ${user?.full_name || user?.email}`,
      body: `${user?.full_name || user?.email} (${user?.email}) referred ${email} to NuVira using code ${code}. Please send them a welcome email with their $5 discount.`,
    });
    setSending(false);
    setEmail('');
    toast.success(`Invite sent to ${email}!`);
  };

  return (
    <div className="min-h-screen bg-background pb-10">
      <SEO title="Refer & Earn" description="Share NuVira with friends. They get $5 off their first order. You earn a free bottle. Real. Living. Nutrition." />
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3">
        <Link to="/account">
          <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <span className="font-heading text-base font-semibold">Refer & Earn</span>
      </div>

      {/* Hero */}
      <div className="bg-gradient-to-b from-primary/15 to-transparent px-5 pt-6 pb-5 text-center">
        <img src={LOGO_URL} alt="NuVira" className="h-9 mx-auto mb-3" />
        <div className="w-14 h-14 bg-primary/15 rounded-full flex items-center justify-center mx-auto mb-3">
          <Gift className="w-6 h-6 text-primary" />
        </div>
        <h1 className="font-heading text-2xl font-bold mb-1">Give $5, Get a Bottle</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Share NuVira with someone you care about. They save $5. You earn a free bottle.
        </p>
      </div>

      {/* Code */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mx-4 mt-2 bg-card border border-border/40 rounded-2xl p-5"
      >
        <p className="text-xs text-muted-foreground mb-2 font-medium">Your referral code</p>
        <div className="flex items-center gap-3">
          <div className="flex-1 bg-secondary rounded-xl py-3 px-4 text-center">
            <p className="font-heading text-2xl font-bold tracking-widest text-primary">{code}</p>
          </div>
          <button
            onClick={handleCopy}
            className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center transition-colors active:bg-primary/20"
          >
            {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4 text-primary" />}
          </button>
        </div>
        <Button
          onClick={handleShare}
          variant="outline"
          className="w-full mt-3 rounded-xl h-10 text-sm"
        >
          <Share2 className="w-3.5 h-3.5 mr-2" />
          Share with Friends
        </Button>
      </motion.div>

      {/* Invite by email */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18 }}
        className="mx-4 mt-3 bg-card border border-border/40 rounded-2xl p-4"
      >
        <p className="text-sm font-semibold mb-1">Invite by email</p>
        <p className="text-xs text-muted-foreground mb-3">We'll send them a personal invite from you.</p>
        <div className="flex gap-2">
          <Input
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="friend@email.com"
            className="rounded-xl h-10 flex-1"
            type="email"
          />
          <Button
            onClick={handleInvite}
            disabled={sending || !email}
            className="rounded-xl h-10 px-4 shrink-0"
          >
            {sending ? '...' : 'Invite'}
          </Button>
        </div>
      </motion.div>

      {/* How it works */}
      <div className="px-4 mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">How it works</p>
        <div className="space-y-3">
          {steps.map(({ step, title, desc }, i) => (
            <motion.div
              key={step}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 + i * 0.07 }}
              className="flex items-start gap-3"
            >
              <div className="w-7 h-7 bg-primary rounded-full flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-primary-foreground text-xs font-bold">{step}</span>
              </div>
              <div>
                <p className="text-sm font-semibold">{title}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Rewards */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45 }}
        className="mx-4 mt-6 bg-gradient-to-br from-primary/15 to-accent/10 border border-border/30 rounded-2xl p-5"
      >
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-primary" />
          <p className="font-semibold text-sm">Referral Rewards</p>
        </div>
        <div className="space-y-2">
          {[
            { referrals: '1 referral', reward: '1 free bottle of your choice' },
            { referrals: '3 referrals', reward: 'Free NuVira Trio bundle' },
            { referrals: '5 referrals', reward: '1 month of Weekly Fresh subscription' },
            { referrals: '10 referrals', reward: 'VIP Wellness status for a month' },
          ].map(({ referrals, reward }) => (
            <div key={referrals} className="flex items-center justify-between">
              <span className="text-xs font-medium text-primary">{referrals}</span>
              <span className="text-xs text-muted-foreground">{reward}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
          Rewards are applied manually after referral verification. Our team will reach out when you hit each milestone.
        </p>
      </motion.div>
    </div>
  );
}