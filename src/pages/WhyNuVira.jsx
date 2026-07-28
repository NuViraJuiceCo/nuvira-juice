import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  Droplets,
  HeartPulse,
  Leaf,
  PackageCheck,
  Refrigerator,
  ShieldCheck,
  Sparkles,
  Truck,
} from 'lucide-react';
import SEO from '@/components/SEO';
import { BRAND_IMAGES, brandImageUrl } from '@/lib/brandImages';

const LOGO_URL = 'https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png';

const pageContent = {
  seo: {
    title: 'Why NuVira',
    description:
      'Learn why NuVira Juice Co. makes fresh, cold-pressed juice in small batches with real produce, no fillers, and local delivery around Wentzville and St. Louis.',
    image: BRAND_IMAGES.aboutBottleCooler,
  },
  hero: {
    eyebrow: 'The NuVira difference',
    title: 'Cold-pressed juice made with a higher freshness standard.',
    body:
      'We built NuVira around real produce, small-batch production, short freshness windows, and local service that keeps every bottle close to the day it was made.',
  },
  proof: [
    { value: 'Never heated', label: 'Hydraulic pressure helps preserve flavor and nutrients' },
    { value: 'No shortcuts', label: 'No concentrates, fillers, artificial colors, or added sugar' },
    { value: 'Made to demand', label: 'Produced in focused batches for orders, routes, and events' },
  ],
};

const principles = [
  {
    icon: Droplets,
    title: 'Cold-Pressed',
    body:
      'Cold-pressing uses pressure instead of heat, helping preserve the fresh flavor, color, and ingredient character customers expect from premium juice.',
  },
  {
    icon: Leaf,
    title: 'Real Ingredients',
    body:
      'Our recipes are built from whole fruits, vegetables, roots, herbs, and functional ingredients customers can recognize.',
  },
  {
    icon: Sparkles,
    title: 'Small Batch',
    body:
      'We keep production intentional instead of warehousing old inventory, so delivery, events, and programs stay connected to fresh batches.',
  },
  {
    icon: ShieldCheck,
    title: 'Clear Standards',
    body:
      'Labels, care instructions, and freshness windows are straightforward because the product is fresh and should be treated that way.',
  },
];

const processSteps = [
  {
    icon: CalendarClock,
    title: 'Planned around demand',
    body: 'Orders, programs, subscriptions, and event inventory inform what needs to be made and when.',
  },
  {
    icon: BadgeCheck,
    title: 'Pressed in focused batches',
    body: 'Fresh produce is prepared, pressed, bottled, and handled with a short freshness window in mind.',
  },
  {
    icon: Refrigerator,
    title: 'Kept chilled',
    body: 'NuVira juice should stay refrigerated and be enjoyed cold. Shake gently before drinking.',
  },
  {
    icon: Truck,
    title: 'Served locally',
    body: 'Delivery routes, pickup moments, and local events keep the product close to the people drinking it.',
  },
];

const standards = [
  { icon: PackageCheck, title: 'No concentrates', body: 'Juice should taste like fresh produce, not a shelf-stable shortcut.' },
  { icon: HeartPulse, title: 'No added sugar', body: 'Recipes are balanced through ingredients, not sweeteners or fillers.' },
  { icon: Refrigerator, title: 'Freshness matters', body: 'Best enjoyed within a short chilled window because there are no artificial preservatives.' },
];

function BackLink({ tone = 'default' }) {
  const toneClass =
    tone === 'dark'
      ? 'text-white/72 hover:bg-white/10 hover:text-white'
      : 'text-muted-foreground hover:bg-secondary hover:text-foreground';

  return (
    <Link
      to="/"
      className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold ${toneClass}`}
    >
      <ArrowLeft className="h-4 w-4" />
      Home
    </Link>
  );
}

function PrincipleCard({ icon: Icon, title, body }) {
  return (
    <article className="nuvira-vivid-panel rounded-lg border p-5">
      <div className="nuvira-icon-badge mb-4 flex h-11 w-11 items-center justify-center rounded-lg">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="font-heading text-xl font-bold leading-tight">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">{body}</p>
    </article>
  );
}

function ProcessStep({ icon: Icon, title, body, index }) {
  return (
    <article className="grid gap-4 border-t border-white/12 py-6 md:grid-cols-[3rem_minmax(0,1fr)] md:gap-5">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/15 bg-white/[0.06]">
        <Icon className="h-5 w-5 text-[#C8E86A]" />
      </div>
      <div>
        <p className="text-xs font-bold uppercase text-[#C8E86A]">Step {index + 1}</p>
        <h3 className="mt-2 font-heading text-2xl font-bold leading-tight text-white">{title}</h3>
        <p className="mt-3 text-sm leading-7 text-white/68 md:text-base">{body}</p>
      </div>
    </article>
  );
}

function StandardCard({ icon: Icon, title, body }) {
  return (
    <article className="nuvira-vivid-panel rounded-lg border p-4">
      <div className="nuvira-icon-badge mb-3 flex h-10 w-10 items-center justify-center rounded-lg">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="font-heading text-lg font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </article>
  );
}

export default function WhyNuVira() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEO
        title={pageContent.seo.title}
        description={pageContent.seo.description}
        image={brandImageUrl(pageContent.seo.image)}
      />

      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur md:hidden">
        <BackLink />
      </header>

      <section className="nuvira-vivid-hero text-white">
        <div className="mx-auto grid w-full max-w-7xl gap-9 px-5 py-8 md:px-8 md:py-14 lg:px-12">
          <div className="flex flex-col justify-between gap-8">
            <div>
              <div className="hidden md:block">
                <BackLink tone="dark" />
              </div>
              <img src={LOGO_URL} alt="NuVira Juice Co." className="mt-5 h-10 w-auto md:mt-10 md:h-12" />
              <p className="mt-7 text-sm font-bold text-[#C8E86A] md:mt-10">{pageContent.hero.eyebrow}</p>
              <h1 className="mt-3 max-w-4xl font-heading text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
                {pageContent.hero.title}
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-white/72 md:text-lg md:leading-8">
                {pageContent.hero.body}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {pageContent.proof.map((item) => (
                <div key={item.value} className="rounded-lg border border-white/18 bg-white/[0.08] p-4 shadow-lg shadow-emerald-950/10 backdrop-blur">
                  <p className="font-heading text-xl font-bold text-white">{item.value}</p>
                  <p className="mt-1 text-xs leading-5 text-white/62">{item.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <img
              src={BRAND_IMAGES.aboutBottleCooler}
              alt="NuVira cold-pressed juice bottles chilled in a cooler"
              className="h-[24rem] w-full rounded-lg object-cover md:h-[30rem]"
              width="1800"
              height="1200"
            />
            <img
              src={BRAND_IMAGES.aboutProductSignage}
              alt="NuVira Aura and Oasis product menu cards at a local event"
              className="h-[20rem] w-full rounded-lg object-cover object-[50%_42%] md:h-[30rem]"
              loading="lazy"
              width="1000"
              height="1500"
            />
          </div>
        </div>
      </section>

      <section className="border-b border-nuvira bg-nuvira-gradient-soft">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 md:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] md:px-8 md:py-16 lg:px-12">
          <div>
            <p className="text-sm font-bold text-primary">What sets us apart</p>
            <h2 className="mt-3 font-heading text-3xl font-bold leading-tight md:text-5xl">
              Freshness is not a slogan. It is the operating model.
            </h2>
          </div>
          <p className="max-w-3xl text-base leading-8 text-muted-foreground md:text-lg md:leading-9">
            NuVira is made for customers who care about what they put in their body, but still need ordering, delivery, events, and routines to work in real life. The standard is simple: real ingredients, careful production, clear handling, and juice that tastes alive.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-10 md:px-8 md:py-16 lg:px-12">
        <div className="mb-7 flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-bold text-primary">Core standards</p>
            <h2 className="mt-2 font-heading text-3xl font-bold md:text-4xl">The rules behind every bottle</h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground md:text-right">
            These are the choices that separate fresh cold-pressed juice from mass-market juice products.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {principles.map((item) => (
            <PrincipleCard key={item.title} {...item} />
          ))}
        </div>
      </section>

      <section className="nuvira-vivid-hero">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-10 md:px-8 md:py-16 lg:px-12 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div>
            <p className="text-sm font-bold text-[#C8E86A]">From produce to your routine</p>
            <h2 className="mt-2 font-heading text-3xl font-bold leading-tight text-white md:text-5xl">
              Built for fresh local service, not distant shelf life.
            </h2>
            <p className="mt-5 text-base leading-8 text-white/68">
              The same standards apply whether a customer orders online, joins a program, subscribes, or meets us at an event.
            </p>
            <div className="mt-7 overflow-hidden rounded-lg">
              <img
                src={BRAND_IMAGES.aboutMarketWide}
                alt="NuVira booth serving a local event"
                className="h-72 w-full object-cover md:h-96"
                loading="lazy"
              />
            </div>
          </div>
          <div>
            {processSteps.map((step, index) => (
              <ProcessStep key={step.title} {...step} index={index} />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-5 py-10 md:px-8 md:py-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:px-12">
        <div>
          <p className="text-sm font-bold text-primary">Freshness care</p>
          <h2 className="mt-2 font-heading text-3xl font-bold leading-tight md:text-5xl">
            Real juice should be handled like real food.
          </h2>
          <p className="mt-5 text-base leading-8 text-muted-foreground">
            Keep NuVira refrigerated, enjoy it chilled, and shake gently before drinking. A shorter freshness window is intentional because the product is made without artificial preservatives.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          {standards.map((item) => (
            <StandardCard key={item.title} {...item} />
          ))}
        </div>
      </section>

      <section className="border-t border-nuvira bg-nuvira-gradient-soft">
        <div className="mx-auto grid max-w-7xl gap-6 px-5 py-10 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:px-8 md:py-14 lg:px-12">
          <div>
            <div className="nuvira-icon-badge mb-4 flex h-11 w-11 items-center justify-center rounded-lg">
              <Sparkles className="h-5 w-5" />
            </div>
            <h2 className="font-heading text-3xl font-bold leading-tight md:text-4xl">Taste the difference fresh makes.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              Browse cold-pressed juices, three-day programs, subscriptions, and event options from NuVira.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row md:flex-col lg:flex-row">
            <Link to="/shop" className="nuvira-gradient-button inline-flex h-12 items-center justify-center rounded-lg px-6 text-sm font-bold">
              Shop Juices
            </Link>
            <Link to="/our-story" className="inline-flex h-12 items-center justify-center rounded-lg border border-nuvira bg-card/80 px-6 text-sm font-bold text-foreground">
              Our Story
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
