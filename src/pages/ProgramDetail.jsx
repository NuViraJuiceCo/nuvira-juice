import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { useCart } from '@/lib/cartContext';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import SEO from '@/components/SEO';
import ConsumptionSchedule from '@/components/program/ConsumptionSchedule';
import { PROGRAMS } from '@/components/home/ProgramCards';
import { absoluteUrl } from '@/lib/seo-slugs';

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

  const { data: shots = [] } = useQuery({
    queryKey: ['wellness-shots'],
    queryFn: () => base44.entities.Product.filter({ category: 'shot', is_available: true }, 'sort_order'),
  });

  if (!program) {
    return (
      <div className="min-h-screen bg-background px-5 py-10 md:px-8">
        <SEO
          title="Program Not Found"
          description="This NuVira program could not be found."
          noindex
        />
        <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Program unavailable</p>
          <h1 className="mt-3 font-heading text-3xl font-bold text-foreground">We could not find that program</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            It may have moved or no longer be available. You can still shop current juices, bundles, and wellness programs.
          </p>
          <Button
            type="button"
            onClick={() => navigate('/shop')}
            className="mt-6 h-11 rounded-xl px-6 text-sm font-semibold"
          >
            Shop Current Options
          </Button>
        </div>
      </div>
    );
  }

  const basePrice = program.price;
  const shotsTotal = selectedShots.reduce((sum, id) => sum + (shots.find(s => s.id === id)?.price || 0), 0);
  const total = basePrice + shotsTotal;
  const programTitle = `${program.name} Program (3-Day)`;
  const programDescription = `${program.description} Includes ${program.composition} across ${program.bottles} bottles, available for local delivery in Wentzville, St. Charles County, and the St. Louis area.`;
  const programUrl = absoluteUrl(`/program/${program.key}`);
  const programStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: programTitle,
    description: programDescription,
    image: program.image,
    brand: { '@type': 'Brand', name: 'NuVira Juice Co.' },
    offers: {
      '@type': 'Offer',
      url: programUrl,
      priceCurrency: 'USD',
      price: program.price.toFixed(2),
      availability: 'https://schema.org/InStock',
      seller: { '@type': 'Organization', name: 'NuVira Juice Co.' },
    },
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'Program length', value: `${program.days} days` },
      { '@type': 'PropertyValue', name: 'Bottle count', value: `${program.bottles} bottles` },
      { '@type': 'PropertyValue', name: 'Composition', value: program.composition },
    ],
  };

  const handleStartProgram = () => {
    // Subscriptions temporarily disabled — go straight to one-time purchase
    handleOneTime();
  };

  const getFixedComposition = () => {
    const compositions = {
      radiance: [
        { product_id: 'aura', product_name: 'AURA', quantity: 9 },
        { product_id: 'oasis', product_name: 'OASIS', quantity: 3 },
      ],
      reset: [
        { product_id: 're-nu', product_name: 'RE-NU', quantity: 9 },
        { product_id: 'oasis', product_name: 'OASIS', quantity: 3 },
      ],
      hydration: [
        { product_id: 'oasis', product_name: 'OASIS', quantity: 9 },
        { product_id: 'aura', product_name: 'AURA', quantity: 3 },
      ],
    };
    return compositions[program.key] || [];
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
        is_program: true,
      },
      1,
      { bottles_per_unit: program.bottles, bundle_composition: getFixedComposition() }
    );
    selectedShots.forEach(shotId => {
      const shot = shots.find(s => s.id === shotId);
      if (shot) addItem({ id: shot.id, title: shot.title, price: shot.price, image_url: shot.image_url, category: 'shot' }, 1);
    });
    toast.success(`${program.name} Program added to cart`);
    navigate('/cart');
  };


  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={`${programTitle} | Cold-Pressed Juice Program`}
        description={programDescription}
        image={program.image}
        type="product"
        keywords={`${program.name} juice program, ${program.composition}, 3-day juice program Wentzville MO, cold-pressed juice delivery St. Louis, NuVira ${program.name}`}
        canonicalPath={`/program/${program.key}`}
        structuredData={programStructuredData}
      />
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

      <div className="px-4 pt-6 pb-[140px] md:pb-[100px]">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-6 mb-6 relative overflow-hidden"
          style={{
            background: program.gradientBg,
            border: `1.5px solid ${program.borderColor}`,
            boxShadow: `0 12px 40px ${program.shadowColor}, 0 2px 8px rgba(0,0,0,0.07)`,
          }}
        >
          {/* Subtle radial highlight */}
          <div className="absolute top-0 right-0 w-40 h-40 rounded-full pointer-events-none" style={{ background: `radial-gradient(circle, ${program.dotColor}22 0%, transparent 70%)` }} />
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl mb-4 relative z-10"
            style={{ background: program.chipBg, border: `1.5px solid ${program.chipBorder}` }}
          >
            {program.emoji}
          </div>
          <h1 className="font-heading text-3xl font-bold mb-1 relative z-10" style={{ color: 'rgba(0,0,0,0.85)' }}>{program.name}</h1>
          <p className="text-sm font-semibold mb-3 relative z-10" style={{ color: program.accentColor }}>{program.tagline}</p>
          <p className="text-sm leading-relaxed relative z-10" style={{ color: 'rgba(0,0,0,0.68)' }}>{program.description}</p>
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
          <div
            className="flex items-center gap-2.5 p-3 rounded-xl"
            style={{
              background: program.gradientBg,
              border: `1.5px solid ${program.borderColor}`,
              boxShadow: `0 3px 12px ${program.shadowColor}`,
            }}
          >
            <span
              className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
              style={{ background: program.chipBg, border: `1px solid ${program.chipBorder}` }}
            >
              {program.emoji}
            </span>
            <div>
              <p className="text-xs font-bold" style={{ color: program.accentColor }}>{program.name} Formula</p>
              <p className="text-sm font-semibold" style={{ color: 'rgba(0,0,0,0.75)' }}>{program.composition}</p>
            </div>
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

        {/* Consumption Schedule */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <ConsumptionSchedule
            programKey={program.key}
            shotName={selectedShots.length > 0 ? shots.find(s => s.id === selectedShots[0])?.title : null}
          />
        </motion.div>

        {/* Shots Add-On */}
         <motion.div
           initial={{ opacity: 0, y: 12 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 0.12 }}
           className="mb-6"
         >
           <div className="nuvira-premium-card rounded-2xl p-4">
             <div className="flex items-center gap-2 mb-1">
               <Zap className="w-4 h-4 text-primary" />
               <p className="text-sm font-semibold">Add Daily Wellness Shots</p>
               <span className="text-[10px] text-muted-foreground ml-auto">${shots[0]?.price || 6} each</span>
             </div>
             <p className="text-[11px] text-muted-foreground mb-3">Pick up to 3 shots — one per day of your program</p>
             <div className="space-y-2">
               {shots.map(shot => {
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
                       isSelected ? 'border-primary bg-nuvira-gradient-soft' : atMax ? 'border-border/30 opacity-40' : 'border-border/50 bg-background'
                     }`}
                   >
                     {shot.image_url ? (
                       <img src={shot.image_url} alt={shot.title} className="w-8 h-8 rounded-lg object-cover shrink-0" />
                     ) : (
                       <span className="text-base shrink-0">🍊</span>
                     )}
                     <div className="flex-1 min-w-0">
                       <p className="text-xs font-semibold">{shot.title}</p>
                       <p className="text-[10px] text-muted-foreground">{shot.short_description}</p>
                     </div>
                     <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${isSelected ? 'border-primary bg-nuvira-gradient' : 'border-border'}`}>
                       {isSelected && <Check className="w-3 h-3 text-white" />}
                     </div>
                   </button>
                 );
               })}
             </div>
             {selectedShots.length > 0 && (
               <p className="text-[11px] text-primary font-medium mt-3">
                 ✓ {selectedShots.length} shot{selectedShots.length > 1 ? 's' : ''} added (+${(selectedShots.reduce((sum, id) => sum + (shots.find(s => s.id === id)?.price || 0), 0)).toFixed(2)})
               </p>
             )}
           </div>
         </motion.div>
      </div>

      {/* Bottom Sticky Purchase Tray — Premium Anchored Footer */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-primary/15 md:left-60" style={{ paddingBottom: `max(0.75rem, env(safe-area-inset-bottom))` }}>
        <div className="bg-gradient-to-b from-card to-card/95 backdrop-blur-sm">
          <div className="px-4 py-3 md:px-6 md:py-3.5">
            {/* Mobile: Two-row compact layout */}
            <div className="md:hidden">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {program.name}
                  </p>
                  {selectedShots.length > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      + {selectedShots.length} shot{selectedShots.length > 1 ? 's' : ''}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-heading text-2xl font-bold text-foreground">${total}</p>
                </div>
              </div>
              <Button
                onClick={handleStartProgram}
                className="w-full h-11 rounded-xl font-semibold text-sm shadow-md hover:shadow-lg transition-all active:scale-[0.98]"
              >
                Start My 3-Day Program
              </Button>
            </div>

            {/* Desktop: Single-row professional layout */}
            <div className="hidden md:flex items-center justify-between max-w-4xl mx-auto">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {program.name} Program
                </p>
                {selectedShots.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    + {selectedShots.length} wellness shot{selectedShots.length > 1 ? 's' : ''}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground mb-0.5">Total</p>
                  <p className="font-heading text-2xl font-bold text-foreground">${total}</p>
                </div>
                <Button
                  onClick={handleStartProgram}
                  className="h-11 px-8 rounded-xl font-semibold text-sm shadow-md hover:shadow-lg transition-all active:scale-[0.98]"
                  style={{ minWidth: '280px' }}
                >
                  Start My 3-Day Program
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>


    </div>
  );
}
