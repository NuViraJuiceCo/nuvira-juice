import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Check, Minus, Package, Plus, Sparkles, Truck, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { useCart } from '@/lib/cartContext';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import SEO from '@/components/SEO';
import ConsumptionSchedule from '@/components/program/ConsumptionSchedule';
import {
  PROGRAMS,
  PROGRAM_SCHEDULE_VERSION,
  programOptionForDays,
  programProductId,
} from '@/lib/program-catalog';
import { PUBLIC_PRODUCT_FALLBACKS } from '@/lib/public-products';
import { absoluteUrl } from '@/lib/seo-slugs';

const FALLBACK_WELLNESS_SHOTS = PUBLIC_PRODUCT_FALLBACKS.filter((product) => (
  product.category === 'shot' && product.is_available !== false
));

const BASE_PERKS = [
  'Cold-pressed same day',
  'No fillers, no additives',
  'Delivered to your door',
];

const PROGRAM_THEMES = {
  radiance: {
    eyebrow: 'Radiance ritual',
    accentClass: 'text-[#D69A48]',
    borderClass: 'border-[#E6C894]/45',
    panelClass: 'bg-[#9B5D20]/10 border-[#E6C894]/30',
    chipClass: 'bg-[#3A2417]/65 text-[#FFF7EA] border-[#F2C97A]/40',
    statClass: 'bg-[#D69A48]/10 border-[#E6C894]/25',
    overlay: 'from-[#3A2417] via-[#4C2D1D]/80 to-black/20',
  },
  hydration: {
    eyebrow: 'Hydration ritual',
    accentClass: 'text-[#E5AA5C]',
    borderClass: 'border-[#DDB895]/45',
    panelClass: 'bg-[#7A2630]/10 border-[#DDB895]/30',
    chipClass: 'bg-[#381619]/70 text-[#FFF4EA] border-[#E5AA5C]/40',
    statClass: 'bg-[#C67B3C]/10 border-[#DDB895]/25',
    overlay: 'from-[#381619] via-[#63262B]/82 to-black/18',
  },
  reset: {
    eyebrow: 'Reset ritual',
    accentClass: 'text-[#B9C78F]',
    borderClass: 'border-[#B9C7A3]/45',
    panelClass: 'bg-[#285743]/10 border-[#B9C7A3]/30',
    chipClass: 'bg-[#102D22]/70 text-[#F5F5E9] border-[#C6B56A]/40',
    statClass: 'bg-[#8B9C62]/10 border-[#B9C7A3]/25',
    overlay: 'from-[#102D22] via-[#1D4533]/82 to-black/18',
  },
};

function normalizedTitle(value) {
  return String(value || '').trim().toLowerCase();
}

function capShotCounts(counts, maxCount, orderedShotIds = []) {
  const capped = {};
  let remaining = Math.max(0, Number(maxCount) || 0);
  const ids = [...new Set([...orderedShotIds, ...Object.keys(counts || {})])];
  for (const id of ids) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, Math.max(0, Math.trunc(Number(counts?.[id] || 0))));
    if (quantity > 0) {
      capped[id] = quantity;
      remaining -= quantity;
    }
  }
  return capped;
}

function getProgramTheme(program) {
  return PROGRAM_THEMES[program?.key] || PROGRAM_THEMES.hydration;
}

export default function ProgramDetail() {
  const { key } = useParams();
  const navigate = useNavigate();
  const { addItem } = useCart();

  const program = PROGRAMS.find(p => p.key === key);
  const [selectedDays, setSelectedDays] = useState(3);
  const [selectedShotCounts, setSelectedShotCounts] = useState({});

  useEffect(() => {
    setSelectedDays(3);
    setSelectedShotCounts({});
  }, [key]);

  const { data: shots = [] } = useQuery({
    queryKey: ['wellness-shots'],
    queryFn: async () => {
      try {
        const liveShots = await base44.entities.Product.filter({ category: 'shot', is_available: true }, 'sort_order');
        return Array.isArray(liveShots) && liveShots.length > 0 ? liveShots : FALLBACK_WELLNESS_SHOTS;
      } catch {
        return FALLBACK_WELLNESS_SHOTS;
      }
    },
    placeholderData: FALLBACK_WELLNESS_SHOTS,
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

  const selectedOption = programOptionForDays(program, selectedDays);
  const recommendedShot = shots.find((shot) => normalizedTitle(shot.title) === normalizedTitle(program.shotPairing?.title)) || null;
  const orderedShots = [...shots].sort((left, right) => {
    const leftRecommended = left.id === recommendedShot?.id ? 0 : 1;
    const rightRecommended = right.id === recommendedShot?.id ? 0 : 1;
    return leftRecommended - rightRecommended || String(left.title || '').localeCompare(String(right.title || ''));
  });
  const selectedShotTotal = Object.values(selectedShotCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const selectedShotNames = orderedShots.flatMap((shot) => (
    Array.from({ length: Number(selectedShotCounts[shot.id] || 0) }, () => shot.title)
  )).slice(0, selectedOption.days);
  const basePrice = selectedOption.price;
  const shotsTotal = orderedShots.reduce((sum, shot) => (
    sum + Number(selectedShotCounts[shot.id] || 0) * Number(shot.price || 0)
  ), 0);
  const total = basePrice + shotsTotal;
  const programTitle = `${program.name} Program (${selectedOption.days}-Day)`;
  const programDescription = `${program.description} Includes ${selectedOption.composition} across ${selectedOption.bottles} bottles, available for local delivery in Wentzville, St. Charles County, and the St. Louis area.`;
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
      price: selectedOption.price.toFixed(2),
      availability: 'https://schema.org/InStock',
      seller: { '@type': 'Organization', name: 'NuVira Juice Co.' },
    },
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'Program length', value: `${selectedOption.days} days` },
      { '@type': 'PropertyValue', name: 'Bottle count', value: `${selectedOption.bottles} bottles` },
      { '@type': 'PropertyValue', name: 'Composition', value: selectedOption.composition },
    ],
  };

  const handleStartProgram = () => {
    // Subscriptions temporarily disabled — go straight to one-time purchase
    handleOneTime();
  };

  const handleOneTime = () => {
    addItem(
      {
        id: programProductId(program.key, selectedOption.days),
        title: programTitle,
        price: basePrice,
        image_url: program.image,
        category: 'bundle',
        bottle_count: selectedOption.bottles,
        is_program: true,
      },
      1,
      {
        bottles_per_unit: selectedOption.bottles,
        bundle_composition: selectedOption.bundleComposition.map((item) => ({ ...item })),
        program_key: program.key,
        program_days: selectedOption.days,
        program_schedule_version: PROGRAM_SCHEDULE_VERSION,
      }
    );
    orderedShots.forEach((shot) => {
      const quantity = Number(selectedShotCounts[shot.id] || 0);
      if (quantity > 0) addItem(
        { id: shot.id, title: shot.title, price: shot.price, image_url: shot.image_url, category: 'shot', size: shot.size },
        quantity,
        {
          cart_line_key: `${shot.id}::addon::${programProductId(program.key, selectedOption.days)}`,
          program_addon_for: program.key,
          program_addon_days: selectedOption.days,
          program_addon_schedule_version: PROGRAM_SCHEDULE_VERSION,
        },
      );
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
              {selectedShotTotal > 0 && (
                <span className="ml-1 text-xs font-medium text-muted-foreground sm:ml-2">
                  + {selectedShotTotal} shot{selectedShotTotal > 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>
          <Button
            type="button"
            onClick={handleStartProgram}
            className="nuvira-gradient-button h-11 min-w-0 flex-1 rounded-xl px-3 text-sm font-bold sm:min-w-[260px] sm:px-5"
          >
            Start My {selectedOption.days}-Day Program
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
        keywords={`${program.name} juice program, ${selectedOption.composition}, ${selectedOption.days}-day juice program Wentzville MO, cold-pressed juice delivery St. Louis, NuVira ${program.name}`}
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

            {program.durationOptions.length > 1 && (
              <div className="mb-4" role="group" aria-label="Choose program length">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Choose your program length</p>
                <div className="grid grid-cols-2 gap-2">
                  {program.durationOptions.map((option) => {
                    const selected = option.days === selectedOption.days;
                    return (
                      <button
                        key={option.days}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setSelectedDays(option.days);
                          setSelectedShotCounts((current) => capShotCounts(
                            current,
                            option.days,
                            [recommendedShot?.id].filter(Boolean),
                          ));
                        }}
                        className={`rounded-2xl border-2 p-3 text-left transition-all ${selected ? 'border-primary bg-primary/10 shadow-sm' : 'border-border/55 bg-background hover:border-primary/40'}`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-heading text-lg font-bold text-foreground">{option.days} Days</span>
                          {selected && <Check className="h-4 w-4 text-primary" />}
                        </span>
                        <span className="mt-1 block text-xs font-bold text-primary">${option.price}</span>
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">{option.bottles} bottles</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Days', value: selectedOption.days, icon: CalendarDays },
                { label: 'Bottles', value: selectedOption.bottles, icon: Package },
                { label: 'Per Bottle', value: `$${(basePrice / selectedOption.bottles).toFixed(0)}`, icon: Truck },
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
              <p className="mt-1 font-heading text-2xl font-bold text-foreground">{selectedOption.composition}</p>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {[...BASE_PERKS, `Portioned for a ${selectedOption.days}-day routine`].map(perk => (
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
            <h2 className="mt-2 font-heading text-2xl font-bold text-foreground">{selectedOption.days} days, planned for you.</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Each program keeps the bottle mix fixed so production, delivery, and your daily rhythm stay clear.
            </p>
            <div className="mt-5 space-y-3">
              {['Follow the flexible daily guide', 'Keep bottles at 40°F or below', 'Follow every bottle’s printed date'].map((item, index) => (
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
              days={selectedOption.days}
              shotNames={selectedShotNames}
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
                <p className="text-sm font-semibold">Build Your Daily Shot Pairing</p>
                <span className="text-[10px] text-muted-foreground ml-auto">Up to {selectedOption.days}</span>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3">
                Optional. Add up to one 2 oz wellness shot for each program day; always follow the product label.
              </p>
              {recommendedShot && (
                <div className={`mb-3 rounded-2xl border p-3 ${theme.statClass}`}>
                  <div className="flex items-start gap-3">
                    {recommendedShot.image_url ? (
                      <img src={recommendedShot.image_url} alt={recommendedShot.title} className="h-12 w-12 rounded-xl object-cover shadow-sm" />
                    ) : (
                      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-background text-xl">🍊</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-foreground">{program.shotPairing.label}</p>
                        <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-primary">Best match</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{program.shotPairing.description}</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant={selectedShotCounts[recommendedShot.id] === selectedOption.days && selectedShotTotal === selectedOption.days ? 'secondary' : 'default'}
                    onClick={() => setSelectedShotCounts({ [recommendedShot.id]: selectedOption.days })}
                    className="mt-3 h-10 w-full rounded-xl text-xs font-bold"
                  >
                    {selectedShotCounts[recommendedShot.id] === selectedOption.days && selectedShotTotal === selectedOption.days
                      ? `${selectedOption.days}-Day Pairing Added`
                      : `Add ${selectedOption.days} ${recommendedShot.title}s`}
                  </Button>
                </div>
              )}
              <div className="space-y-2">
                {orderedShots.map(shot => {
                  const count = Number(selectedShotCounts[shot.id] || 0);
                  const atMax = selectedShotTotal >= selectedOption.days;
                  return (
                    <div
                      key={shot.id}
                      className={`flex w-full items-center gap-3 rounded-xl border-2 px-3 py-2.5 transition-all ${count > 0 ? 'border-primary bg-nuvira-gradient-soft' : 'border-border/50 bg-background'}`}
                    >
                      {shot.image_url ? (
                        <img src={shot.image_url} alt={shot.title} className="w-8 h-8 rounded-lg object-cover shrink-0" />
                      ) : (
                        <span className="text-base shrink-0">🍊</span>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-xs font-semibold">{shot.title}</p>
                          {shot.id === recommendedShot?.id && (
                            <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-primary">Recommended</span>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground">{shot.short_description}</p>
                        <p className="mt-0.5 text-[10px] font-semibold text-foreground/70">${Number(shot.price || 0).toFixed(2)} each</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 rounded-xl border border-border/60 bg-card/80 p-1">
                        <button
                          type="button"
                          aria-label={`Remove one ${shot.title}`}
                          disabled={count === 0}
                          onClick={() => setSelectedShotCounts((current) => {
                            const next = { ...current };
                            const nextCount = Math.max(0, Number(next[shot.id] || 0) - 1);
                            if (nextCount === 0) delete next[shot.id];
                            else next[shot.id] = nextCount;
                            return next;
                          })}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-secondary disabled:opacity-30"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-4 text-center text-xs font-black text-foreground">{count}</span>
                        <button
                          type="button"
                          aria-label={`Add one ${shot.title}`}
                          disabled={atMax}
                          onClick={() => setSelectedShotCounts((current) => ({
                            ...current,
                            [shot.id]: Number(current[shot.id] || 0) + 1,
                          }))}
                          className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {selectedShotTotal > 0 && (
                <p className="text-[11px] text-primary font-medium mt-3">
                  ✓ {selectedShotTotal} of {selectedOption.days} daily shot{selectedOption.days > 1 ? 's' : ''} planned (+${shotsTotal.toFixed(2)})
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
