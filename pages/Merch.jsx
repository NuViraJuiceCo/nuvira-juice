import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";
const TRIO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/99e225ed4_DSC02438-Edit-2.jpg";

export default function Merch() {
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email || '');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const { data: merchItems = [] } = useQuery({
    queryKey: ['merch'],
    queryFn: () => base44.entities.Merch.filter({}, 'sort_order', 50),
  });

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
      <div className="relative mx-4 mt-4 rounded-2xl overflow-hidden h-56">
        <img src={TRIO_URL} alt="NuVira Merch" className="w-full h-full object-cover object-[center_30%]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/70" />
        <div className="absolute bottom-0 left-0 right-0 p-5">
          <span className="text-white/70 text-[9px] font-bold uppercase tracking-widest">Coming Soon</span>
          <h1 className="font-heading text-2xl font-bold text-white mt-0.5">NuVira Merch</h1>
          <p className="text-white/80 text-xs mt-1">Minimal. Intentional. STL-rooted.</p>
        </div>
      </div>

      {/* Notify CTA */}
      {merchItems.length === 0 && (
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
      )}

      {/* Merch Items */}
      <div className="px-4 mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Shop</p>
        {merchItems.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">No items yet</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {merchItems.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.07 }}
                className="bg-card border border-border/30 rounded-2xl overflow-hidden"
              >
                {item.image_url && (
                  <div className="aspect-square bg-secondary/50 overflow-hidden">
                    <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="p-3">
                  <p className="font-semibold text-sm mb-0.5 line-clamp-2">{item.name}</p>
                  {item.description && (
                    <p className="text-[10px] text-muted-foreground leading-relaxed mb-2 line-clamp-2">{item.description}</p>
                  )}
                  {item.sizes && item.sizes.length > 0 && (
                    <p className="text-[10px] text-muted-foreground mb-2">Sizes: {item.sizes.join(', ')}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-primary">${item.price?.toFixed(2)}</span>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${item.is_available ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      {item.is_available ? 'Available' : 'Coming Soon'}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
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