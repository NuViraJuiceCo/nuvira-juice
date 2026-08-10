import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Check, Package, Sparkles, Truck, Zap } from 'lucide-react';
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

const PROGRAM_THEMES = {
  radiance: {
    eyebrow: 'Glow program',
    accentClass: 'text-orange-400',
    borderClass: 'border-orange-400/35',
    panelClass: 'bg-orange-400/10 border-orange-400/25',
    chipClass: 'bg-orange-400/20 text-orange-100 border-orange-300/30',
    statClass: 'bg-orange-400/10 border-orange-400/20',
    overlay: 'from-orange-950/95 via-black/62 to-black/28',
  },
  hydration: {
    eyebrow: 'Hydration program',
    accentClass: 'text-red-300',
    borderClass: 'border-red-300/35',
    panelClass: 'bg-red-300/10 border-red-300/25',
    chipClass: 'bg-red-300/20 text-red-50 border-red-200/30',
    statClass: 'bg-red-300/10 border-red-300/20',
    overlay: 'from-red-950/95 via-black/62 to-black/28',
  },
  reset: {
    eyebrow: 'Reset program',
    accentClass: 'text-emerald-300',
    borderClass: 'border-emerald-300/35',
    panelClass: 'bg-emerald-300/10 border-emerald-300/25',
    chipClass: 'bg-emerald-300/20 text-emerald-50 border-emerald-200/30',
    statClass: 'bg-emerald-300/10 border-emerald-300/20',
    overlay: 'from-emerald-950/95 via-black/62 to-black/28',
  },
};

function getProgramTheme(program) {
  return PROGRAM_THEMES[program?.key] || PROGRAM_THEMES.hydration;
}

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
        image_url: program.image,
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

  const theme = getProgramTheme(program);

  const purchaseTray = (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 px-4 md:left-60 md:bottom-4 md:px-6">
      <div className="pointer-events-auto mx-auto max-w-3xl rounded-2xl border border-border/60 bg-card/95 p-2.5 shadow-[0_18px_44px_rgba(4,29,21,0.24)] backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <div className="min-w-0 shrink-0 basis-[116px] sm:basis-auto sm:min-w-[170px]">
            <p className="truncate text-[10px] font-black uppercase tracking-[0.13em] text-muted-foreground sm:text-xs sm:tracking-[0.16em]">
              {program.name} Program
            </p>
            <p className="truncate text-sm font-semibold text-foreground">
              ${total.toFixed(2)}
              {selectedShots.length > 0 && (
                <span className="ml-1 text-xs font-medium text-muted-foreground sm:ml-2">
                  + {selectedShots.length} shot{selectedShots.length > 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>
          <Button
            type="button"
            onClick={handleStartProgram}
            className="nuvira-gradient-button h-11 min-w-0 flex-1 rounded-xl px-3 text-sm font-bold sm:min-w-[260px] sm:px-5"
          >
            Start My 3-Day Program
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background pb-[calc(env(safe-area-inset-bottom)+12rem)] md:pb-32">
      <SEO
        title={`${programTitle} | Cold-Pressed Juice Program`}
        description={programDescription}
        image={program.image}
        type="product"
        keywords={`${program.name} juice program, ${program.composition}, 3-day juice program Wentzville MO, cold-pressed juice delivery St. Louis, NuVira ${program.name}`}
        canonicalPath={`/program/${program.key}`}
        structuredData={programStructuredData}
      />
      <div
        className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3 md:px-6"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-heading text-base font-semibold">{program.name} Program</span>
      </div>

      <main className="mx-auto w-full max-w-[1360px] px-4 pt-5 md:px-8 xl:px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className={`relative mb-5 overflow-hidden rounded-3xl border ${theme.borderClass} min-h-[420px] shadow-[0_24px_80px_rgba(4,29,21,0.24)] md:min-h-[470px] xl:min-h-[560px]`}
        >
          {program.image && (
            <img
              src={program.image}
              alt={`${program.name} program`}
              className={`absolute inset-0 h-full w-full object-cover ${program.imagePosition || 'object-center'}`}
            />
          )}
          <div className={`absolute inset-0 bg-gradient-to-t ${theme.overlay}`} />
          <div className="absolute inset-x-0 bottom-0 p-5 md:p-8 xl:p-10">
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] ${theme.chipClass}`}>
              <Sparkles className="h-3.5 w-3.5" />
              {theme.eyebrow}
            </span>
            <h1 className="mt-4 max-w-3xl font-heading text-5xl font-bold leading-[0.9] text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.42)] md:text-6xl xl:text-7xl">
              {program.name}
            </h1>
            <p className="mt-3 max-w-2xl text-lg font-semibold text-white/90 drop-shadow-[0_1px_12px_rgba(0,0,0,0.5)] md:text-xl">
              {program.tagline}
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/75 drop-shadow-[0_1px_10px_rgba(0,0,0,0.5)] md:text-base">
              {program.description}
            </p>
          </div>
        </motion.div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.64fr)_minmax(320px,0.36fr)]">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.07 }}
            className="rounded-3xl border border-border/60 bg-card/70 p-5 md:p-6"
          >
            <p className="mb-4 text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">What's Included</p>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Days', value: program.days, icon: CalendarDays },
                { label: 'Bottles', value: program.bottles, icon: Package },
                { label: 'Per Bottle', value: `$${(basePrice / program.bottles).toFixed(0)}`, icon: Truck },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className={`rounded-2xl border p-3 ${theme.statClass}`}>
                  <Icon className={`mb-2 h-4 w-4 ${theme.accentClass}`} />
                  <p className="font-heading text-2xl font-bold text-foreground">{value}</p>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            <div className={`mt-4 rounded-2xl border p-4 ${theme.panelClass}`}>
              <p className={`text-xs font-black uppercase tracking-[0.16em] ${theme.accentClass}`}>{program.name} Formula</p>
              <p className="mt-1 font-heading text-2xl font-bold text-foreground">{program.composition}</p>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {PERKS.map(perk => (
                <div key={perk} className="flex items-center gap-2.5 rounded-xl bg-secondary/35 px-3 py-2.5">
                  <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                  <p className="text-xs font-semibold text-foreground/75">{perk}</p>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.09 }}
            className={`rounded-3xl border p-5 md:p-6 ${theme.panelClass}`}
          >
            <p className={`text-xs font-black uppercase tracking-[0.18em] ${theme.accentClass}`}>How it works</p>
            <h2 className="mt-2 font-heading text-2xl font-bold text-foreground">Three days, planned for you.</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Each program keeps the bottle mix fixed so production, delivery, and your daily rhythm stay clear.
            </p>
            <div className="mt-5 space-y-3">
              {['Follow the daily guide', 'Keep bottles chilled', 'Add optional AM shots'].map((item, index) => (
                <div key={item} className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-black text-primary-foreground">
                    {index + 1}
                  </span>
                  <p className="text-sm font-semibold text-foreground/80">{item}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.55fr)_minmax(340px,0.45fr)]">
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

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="mb-6"
          >
            <div className="nuvira-premium-card rounded-3xl p-4 md:p-5">
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
                      type="button"
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
      </main>

      {typeof document !== 'undefined' ? createPortal(purchaseTray, document.body) : purchaseTray}
    </div>
  );
}
