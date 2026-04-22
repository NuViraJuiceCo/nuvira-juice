import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import { useCart } from '@/lib/cartContext';
import { toast } from 'sonner';
import SubscriptionUpsellModal from '@/components/program/SubscriptionUpsellModal';
import { PROGRAMS } from '@/components/home/ProgramCards';

const AVAILABLE_SHOTS = [
  { id: 'shot_radiance', title: 'Radiance Shot', subtitle: 'Beet · Apple · Lemon', emoji: '✨' },
  { id: 'shot_hydration', title: 'Hydration Shot', subtitle: 'Coconut Water · Pink Himalayan Salt · Lime · Honey · Mint', emoji: '💧' },
  { id: 'shot_reset', title: 'Reset Shot', subtitle: 'Pineapple · Lemon · Ginger · Black Salt', emoji: '🌿' },
];

const PERKS = [
  'Cold-pressed same day',
  'No fillers, no additives',
  'Structured for 3-day results',
  'Delivered to your door',
];

export default function ProgramDetail() {
  const { key } = useParams();
  const navigate = useNavigate();
  const { addItem } = useCart();

  const program = PROGRAMS.find(p => p.key === key);
  const [selectedShots, setSelectedShots] = useState([]); // array of shot ids, max 3
  const [showUpsell, setShowUpsell] = useState(false);

  if (!program) {
    navigate('/shop');
    return null;
  }

  const basePrice = program.price;
  const shotsTotal = selectedShots.length * 4;
  const total = basePrice + shotsTotal;

  const handleStartProgram = () => {
    setShowUpsell(true);
  };

  const handleOneTime = () => {
    addItem(
      {
        id: `program_${program.key}`,
        title: `${program.name} Program (3-Day)`,
        price: basePrice,
        image_url: null,
        category: 'bundle',
        bottle_count: program.bottles,
      },
      1,
      { bottles_per_unit: program.bottles, bundle_composition: [] }
    );
    selectedShots.forEach(shotId => {
      const shot = AVAILABLE_SHOTS.find(s => s.id === shotId);
      if (shot) addItem({ id: shot.id, title: shot.title, price: 4, category: 'shot' }, 1);
    });
    toast.success(`${program.name} Program added to cart`);
    setShowUpsell(false);
    navigate('/cart');
  };

  return (
    <div className="min-h-screen bg-background pb-36">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-heading text-base font-semibold">{program.name} Program</span>
      </div>

      <div className="px-4 pt-6">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className={`bg-gradient-to-br ${program.color} border ${program.border} rounded-2xl p-6 mb-6`}
        >
          <div className="text-4xl mb-3">{program.emoji}</div>
          <h1 className="font-heading text-3xl font-bold mb-1 text-gray-900">{program.name}</h1>
          <p className={`text-sm font-semibold ${program.accent} mb-3`}>{program.tagline}</p>
          <p className="text-sm text-gray-700 leading-relaxed">{program.description}</p>
        </motion.div>

        {/* Program Details */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.07 }}
          className="bg-card border border-border/50 rounded-2xl p-5 mb-4"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">What's Included</p>

          <div className="flex gap-4 mb-5">
            <div className="flex-1 bg-secondary/50 rounded-xl p-3 text-center">
              <p className="font-heading text-2xl font-bold">{program.days}</p>
              <p className="text-[10px] text-muted-foreground font-medium mt-0.5">Days</p>
            </div>
            <div className="flex-1 bg-secondary/50 rounded-xl p-3 text-center">
              <p className="font-heading text-2xl font-bold">{program.bottles}</p>
              <p className="text-[10px] text-muted-foreground font-medium mt-0.5">Bottles</p>
            </div>
            <div className="flex-1 bg-secondary/50 rounded-xl p-3 text-center">
              <p className="font-heading text-2xl font-bold">${(basePrice / program.bottles).toFixed(0)}</p>
              <p className="text-[10px] text-muted-foreground font-medium mt-0.5">Per Bottle</p>
            </div>
          </div>

          {/* Composition */}
          <div className={`flex items-center gap-2 p-3 rounded-xl bg-gradient-to-br ${program.color} border ${program.border}`}>
            <div className={`w-2.5 h-2.5 rounded-full ${program.dot} shrink-0`} />
            <p className="text-sm font-semibold text-gray-800">{program.composition}</p>
          </div>

          {/* Perks */}
          <div className="mt-4 space-y-2">
            {PERKS.map(perk => (
              <div key={perk} className="flex items-center gap-2.5">
                <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                <p className="text-xs text-foreground/70">{perk}</p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Shots Add-On */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="mb-6"
        >
          <div className="bg-card border border-border/50 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-primary" />
              <p className="text-sm font-semibold">Add Daily Wellness Shots</p>
              <span className="text-[10px] text-muted-foreground ml-auto">$4 each</span>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">Pick up to 3 shots — one per day of your program</p>
            <div className="space-y-2">
              {AVAILABLE_SHOTS.map(shot => {
                const isSelected = selectedShots.includes(shot.id);
                const atMax = selectedShots.length >= 3 && !isSelected;
                return (
                  <button
                    key={shot.id}
                    disabled={atMax}
                    onClick={() => setSelectedShots(prev =>
                      isSelected ? prev.filter(id => id !== shot.id) : [...prev, shot.id]
                    )}
                    className={`w-full text-left flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 transition-all ${
                      isSelected ? 'border-primary bg-primary/5' : atMax ? 'border-border/30 opacity-40' : 'border-border/50 bg-background'
                    }`}
                  >
                    <span className="text-base">{shot.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold">{shot.title}</p>
                      <p className="text-[10px] text-muted-foreground">{shot.subtitle}</p>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${isSelected ? 'border-primary bg-primary' : 'border-border'}`}>
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                  </button>
                );
              })}
            </div>
            {selectedShots.length > 0 && (
              <p className="text-[11px] text-primary font-medium mt-3">
                ✓ {selectedShots.length} shot{selectedShots.length > 1 ? 's' : ''} added (+${selectedShots.length * 4})
              </p>
            )}
          </div>
        </motion.div>
      </div>

      {/* Bottom CTA */}
      <div className="fixed bottom-16 md:bottom-0 left-0 md:left-60 right-0 z-40 bg-card/95 backdrop-blur-xl border-t border-border">
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex justify-between items-baseline mb-2.5">
            <span className="text-xs text-muted-foreground">
              {program.name} Program{selectedShots.length > 0 ? ` + ${selectedShots.length} Shot${selectedShots.length > 1 ? 's' : ''}` : ''}
            </span>
            <span className="font-heading text-xl font-bold">${total}</span>
          </div>
          <Button
            onClick={handleStartProgram}
            className="w-full h-12 rounded-xl font-semibold text-sm"
          >
            Start My 3-Day Program
          </Button>
        </div>
      </div>

      {/* Subscription Upsell Modal */}
      <SubscriptionUpsellModal
        open={showUpsell}
        onClose={() => setShowUpsell(false)}
        onOneTime={handleOneTime}
        programName={program.name}
        programTotal={total}
      />
    </div>
  );
}