import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  CalendarHeart,
  Droplets,
  Heart,
  Leaf,
  MapPin,
  Truck,
  UsersRound,
} from 'lucide-react';
import SEO from '@/components/SEO';
import { BRAND_IMAGES, brandImageUrl } from '@/lib/brandImages';

const LOGO_URL = 'https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png';

const aboutContent = {
  seo: {
    title: 'About NuVira Juice Co.',
    description:
      'NuVira Juice Co. is a Wentzville, MO cold-pressed juice company serving fresh, small-batch juices throughout the St. Louis area.',
    image: BRAND_IMAGES.aboutHeroEvent,
  },
  hero: {
    eyebrow: 'Wentzville born. St. Louis served.',
    title: 'Fresh cold-pressed juice, built around real living nutrition.',
    body:
      'NuVira Juice Co. makes small-batch juice for people who want whole ingredients, local service, and a practical way to keep wellness close.',
  },
  proof: [
    { value: 'Small batch', label: 'Pressed for freshness, not shelf life' },
    { value: 'Local routes', label: 'Delivery across Wentzville and St. Louis' },
    { value: 'Real produce', label: 'No fillers, shortcuts, or added sugar' },
  ],
  intro:
    'We started NuVira with a simple standard: if juice is meant to support the body, it should be made with real produce, handled carefully, and served close to when it is pressed. Every bottle is part of that standard, from our daily juices to three-day wellness programs, event service, subscriptions, and local pop-ups.',
};

const values = [
  {
    icon: Leaf,
    title: 'Real Ingredients',
    body: 'Whole fruits, vegetables, herbs, roots, and clean functional ingredients guide every recipe.',
  },
  {
    icon: Droplets,
    title: 'Cold-Pressed Fresh',
    body: 'Our process is built around freshness, flavor, and nutrient-dense bottles that feel alive.',
  },
  {
    icon: Heart,
    title: 'Made with Intention',
    body: 'We keep production thoughtful and measured so each batch reflects the care behind the brand.',
  },
  {
    icon: MapPin,
    title: 'Local by Design',
    body: 'NuVira is rooted in Wentzville and made for the surrounding St. Louis wellness community.',
  },
];

const storyBlocks = [
  {
    kicker: 'Our standard',
    title: 'Made close to the moment it is needed.',
    body:
      'NuVira is not built around long warehouse cycles. We make fresh juice in focused batches so orders, programs, subscriptions, and event inventory stay connected to real production.',
    icon: BadgeCheck,
  },
  {
    kicker: 'Our community',
    title: 'A local wellness brand people can meet in person.',
    body:
      'The same products customers order online show up at local events, gyms, wellness spaces, and community gatherings. That keeps the brand accountable, visible, and personal.',
    icon: UsersRound,
  },
  {
    kicker: 'Our service',
    title: 'Built for delivery, events, and everyday routines.',
    body:
      'Customers can order for home delivery, choose programs, join a subscription, or find us at events. The goal is simple: make fresh juice easier to keep in your real life.',
    icon: Truck,
  },
];

const gallery = [
  {
    src: BRAND_IMAGES.aboutBottleCooler,
    alt: 'A cooler filled with fresh NuVira cold-pressed juice bottles',
    caption: 'Fresh bottles prepared for local service',
    className: 'md:col-span-7 md:row-span-2',
  },
  {
    src: BRAND_IMAGES.aboutProductSignage,
    alt: 'NuVira product menus and booth signage at a local event',
    caption: 'Recipes customers can understand',
    className: 'md:col-span-5',
  },
  {
    src: BRAND_IMAGES.aboutCommunityService,
    alt: 'NuVira team serving customers at a community event booth',
    caption: 'Community conversations, not shelf browsing',
    className: 'md:col-span-5',
  },
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

function ValueCard({ icon: Icon, title, body }) {
  return (
    <article className="nuvira-vivid-panel rounded-lg border p-4 md:p-5">
      <div className="nuvira-icon-badge mb-4 flex h-10 w-10 items-center justify-center rounded-lg">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="font-heading text-lg font-semibold leading-tight">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </article>
  );
}

function StoryBlock({ icon: Icon, kicker, title, body }) {
  return (
    <article className="grid gap-4 border-t border-border/70 py-6 md:grid-cols-[3rem_minmax(0,1fr)] md:gap-5">
      <div className="nuvira-icon-badge flex h-11 w-11 items-center justify-center rounded-lg">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs font-bold uppercase text-primary">{kicker}</p>
        <h3 className="mt-2 font-heading text-2xl font-bold leading-tight md:text-3xl">{title}</h3>
        <p className="mt-3 text-sm leading-7 text-muted-foreground md:text-base">{body}</p>
      </div>
    </article>
  );
}

function GalleryImage({ src, alt, caption, className = '' }) {
  return (
    <figure className={`group overflow-hidden rounded-lg bg-muted ${className}`}>
      <img
        src={src}
        alt={alt}
        className="h-[18rem] w-full object-cover transition duration-500 group-hover:scale-[1.02] md:h-full md:min-h-[17rem]"
        loading="lazy"
      />
      <figcaption className="border-x border-b border-nuvira bg-card px-4 py-3 text-sm font-semibold text-foreground">
        {caption}
      </figcaption>
    </figure>
  );
}

export default function About() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEO
        title={aboutContent.seo.title}
        description={aboutContent.seo.description}
        image={brandImageUrl(aboutContent.seo.image)}
      />

      <header className="md:hidden sticky top-0 z-20 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur">
        <BackLink />
      </header>

      <section className="nuvira-vivid-hero text-white">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-5 py-7 md:px-8 md:py-14 lg:px-12">
          <div className="flex flex-col justify-between gap-8">
            <div>
              <div className="hidden md:block">
                <BackLink tone="dark" />
              </div>
              <img src={LOGO_URL} alt="NuVira Juice Co." className="mt-5 h-10 w-auto md:mt-10 md:h-12" />
              <p className="mt-7 text-sm font-bold text-[#C8E86A] md:mt-10">{aboutContent.hero.eyebrow}</p>
              <h1 className="mt-3 max-w-5xl font-heading text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
                {aboutContent.hero.title}
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-white/72 md:text-lg md:leading-8">
                {aboutContent.hero.body}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {aboutContent.proof.map((item) => (
                <div key={item.value} className="rounded-lg border border-white/18 bg-white/[0.08] p-4 shadow-lg shadow-emerald-950/10 backdrop-blur">
                  <p className="font-heading text-xl font-bold text-white">{item.value}</p>
                  <p className="mt-1 text-xs leading-5 text-white/62">{item.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
            <picture className="overflow-hidden rounded-lg">
              <source media="(min-width: 768px)" srcSet={BRAND_IMAGES.aboutHeroEvent} />
              <img
                src={BRAND_IMAGES.aboutHeroMobile}
                alt="NuVira booth serving customers at a local wellness event"
                className="h-[23rem] w-full object-cover object-center md:h-[32rem] lg:h-[30rem]"
                width="1800"
                height="1271"
              />
            </picture>
            <img
              src={BRAND_IMAGES.aboutBottleCooler}
              alt="NuVira bottles chilled in a cooler"
              className="hidden h-[30rem] w-full rounded-lg object-cover lg:block"
              loading="lazy"
              width="1800"
              height="1200"
            />
          </div>
        </div>
      </section>

      <section className="border-b border-nuvira bg-nuvira-gradient-soft">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 md:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] md:px-8 md:py-16 lg:px-12">
          <div>
            <p className="text-sm font-bold text-primary">Our story</p>
            <h2 className="mt-3 font-heading text-3xl font-bold leading-tight md:text-5xl">
              A local juice company with a higher freshness standard.
            </h2>
          </div>
          <div className="max-w-3xl">
            <p className="text-base leading-8 text-muted-foreground md:text-lg md:leading-9">
              {aboutContent.intro}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/shop" className="nuvira-gradient-button inline-flex h-12 items-center justify-center rounded-lg px-5 text-sm font-bold">
                Shop Juices
              </Link>
              <Link to="/events" className="inline-flex h-12 items-center justify-center rounded-lg border border-nuvira bg-card/80 px-5 text-sm font-bold text-foreground">
                See Events
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-10 md:px-8 md:py-16 lg:px-12">
        <div className="mb-7 flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-bold text-primary">The NuVira way</p>
            <h2 className="mt-2 font-heading text-3xl font-bold md:text-4xl">What guides every bottle</h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground md:text-right">
            Simple rules, consistent execution, and a local service model that keeps the product close to the people drinking it.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {values.map((value) => (
            <ValueCard key={value.title} {...value} />
          ))}
        </div>
      </section>

      <section className="nuvira-vivid-hero">
        <div className="mx-auto grid max-w-7xl gap-4 px-5 py-10 md:grid-cols-12 md:px-8 md:py-16 lg:px-12">
          {gallery.map((image) => (
            <GalleryImage key={image.src} {...image} />
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-10 px-5 py-10 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:px-8 md:py-16 lg:px-12">
        <div>
          <p className="text-sm font-bold text-primary">Built for real routines</p>
          <h2 className="mt-2 font-heading text-3xl font-bold leading-tight md:text-5xl">
            From weekly rituals to local events.
          </h2>
          <p className="mt-5 text-base leading-8 text-muted-foreground">
            NuVira is designed to meet customers where they already are: at home, at work, at the gym, and at local community events.
          </p>
          <div className="mt-7 overflow-hidden rounded-lg">
            <img
              src={BRAND_IMAGES.aboutMarketWide}
              alt="NuVira booth among local event vendors"
              className="h-72 w-full object-cover md:h-96"
              loading="lazy"
            />
          </div>
        </div>
        <div>
          {storyBlocks.map((block) => (
            <StoryBlock key={block.title} {...block} />
          ))}
        </div>
      </section>

      <section className="border-t border-nuvira bg-nuvira-gradient-soft">
        <div className="mx-auto grid max-w-7xl gap-6 px-5 py-10 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:px-8 md:py-14 lg:px-12">
          <div>
            <div className="nuvira-icon-badge mb-4 flex h-11 w-11 items-center justify-center rounded-lg">
              <CalendarHeart className="h-5 w-5" />
            </div>
            <h2 className="font-heading text-3xl font-bold leading-tight md:text-4xl">Ready for your next fresh order?</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              Browse fresh cold-pressed juices, three-day programs, subscriptions, and event options from one place.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row md:flex-col lg:flex-row">
            <Link to="/shop" className="nuvira-gradient-button inline-flex h-12 items-center justify-center rounded-lg px-6 text-sm font-bold">
              Shop the Collection
            </Link>
            <Link to="/book-event" className="inline-flex h-12 items-center justify-center rounded-lg border border-nuvira bg-card/80 px-6 text-sm font-bold text-foreground">
              Book an Event
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
