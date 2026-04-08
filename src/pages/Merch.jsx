import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Shirt, Package, Watch, ShoppingBag, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";
const TRIO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/99e225ed4_DSC02438-Edit-2.jpg";

const comingSoonItems = [
  {
    icon: Shirt,
    name: 'NuVira Tee',
    desc: 'Premium heavyweight tee. Minimal NuVira branding. STL made.',
    price: '$38',
    color: 'from-primary/20 to-primary/5',
  },
  {
    icon: Package,
    name: 'Insulated Tote',
    desc: 'Keep your juice cold. Carry your lifestyle.',
    price: '$52',
    color: 'from-accent/20 to-accent/5',
  },
  {
    icon: Watch,
    name: 'Wellness Journal',
    desc: 'Track your habits, intentions, and juice rituals.',
    price: '$28',
    color: 'from-secondary to-secondary/30',
  },
  {
    icon: ShoppingBag,
    name: 'NuVira Cap',
    desc: 'Structured 6-panel. Clean. Minimal. NuVira.',
    price: '$36',
    color: 'from-primary/15 to-transparent',
  },
];

export default function Merch() {
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email || '');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleNotify = async () => {
    if (!email) return;
    setLoading(true);
    await base44.integrations.Core.SendEmail({
      to: 'nuvirajuiceco@gmail.com',
      subject: 'Merch Drop Waitlist',
      body: `${email} wants to be notified when NuVira merch drops.`,
    });
    setSubmitted(true);
    setLoading(false);
    toast.success("You're on the list! We'll notify you when merch drops.");
  };

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3">
        <Link to="/shop">
          <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <span className="font-heading text-base font-semibold">Merch</span>
      </div>

      {/* Hero */}
      <div className="relative mx-4 mt-4 rounded-2xl overflow-hidden h-48">
        <img src={TRIO_URL} alt="NuVira Merch" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-br from-primary/90 to-primary/60" />
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
          <img src={LOGO_URL} alt="NuVira" className="w-32 mb-2 drop-shadow" />
          <span className="bg-white/20 text-white text-[10px] font-bold px-3 py-1 rounded-full tracking-widest uppercase">
            Coming Soon
          </span>
          <p className="text-primary-foreground/80 text-xs mt-2">
            Gear for the wellness lifestyle.
          </p>
        </div>
      </div>

      {/* Notify CTA */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mx-4 mt-5 bg-card border border-border/40 rounded-2xl p-5"
      >
        <div className="flex items-center gap-2 mb-3">
          <Bell className="w-4 h-4 text-primary" />
          <p className="font-semibold text-sm">Get notified at launch</p>
        </div>
        {submitted ? (
          <div className="bg-primary/10 rounded-xl py-3 px-4 text-center">
            <p className="text-primary text-sm font-semibold">You're on the list 🌿</p>
            <p className="text-xs text-muted-foreground mt-0.5">We'll hit you first when merch drops.</p>
          </div>
        ) : (
          <div className="flex gap-2">
            <Input
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="rounded-xl h-11 flex-1"
              type="email"
            />
            <Button
              onClick={handleNotify}
              disabled={loading || !email}
              className="rounded-xl h-11 px-4 shrink-0"
            >
              {loading ? '...' : 'Notify Me'}
            </Button>
          </div>
        )}
      </motion.div>

      {/* Preview Items */}
      <div className="px-4 mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Sneak Peek</p>
        <div className="grid grid-cols-2 gap-3">
          {comingSoonItems.map(({ icon: Icon, name, desc, price, color }, i) => (
            <motion.div
              key={name}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.07 }}
              className={`bg-gradient-to-br ${color} border border-border/30 rounded-2xl p-4 relative overflow-hidden`}
            >
              <div className="w-10 h-10 bg-white/60 rounded-xl flex items-center justify-center mb-3">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <p className="font-semibold text-sm mb-0.5">{name}</p>
              <p className="text-[10px] text-muted-foreground leading-relaxed mb-2">{desc}</p>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-primary">{price}</span>
                <span className="text-[9px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
                  Coming Soon
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Brand note */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mx-4 mt-6 text-center"
      >
        <p className="text-xs text-muted-foreground leading-relaxed">
          NuVira merch is designed for the wellness lifestyle — minimal, intentional, and STL-rooted.
          Everything drops in limited quantities.
        </p>
      </motion.div>
    </div>
  );
}