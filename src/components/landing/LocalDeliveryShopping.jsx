import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, MapPin, Truck } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import DeliveryAvailabilityCard from '@/components/delivery/DeliveryAvailabilityCard';
import { PUBLIC_PRODUCT_FALLBACKS } from '@/lib/public-products';
import { productCardImage } from '@/lib/product-card-images';
import { productPath } from '@/lib/seo-slugs';
import { deliveryLandingPrice, deliveryLandingProducts } from '@/lib/localDeliveryShopping';
import { DELIVERY_POLICY_CONTENT, DELIVERY_WINDOWS, DELIVERY_ZONE_SUMMARY } from '@/lib/delivery-policy';
import { trackGoogleSelectItem } from '@/lib/googleAnalytics';

const FLAVORS = {
  oasis: { taste: 'Watermelon & citrus', accent: 'bg-rose-500/10 text-rose-800 dark:text-rose-200' },
  aura: { taste: 'Carrot, orange & pineapple', accent: 'bg-orange-500/10 text-orange-800 dark:text-orange-200' },
  're-nu': { taste: 'Apple & greens', accent: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' },
};

function CatalogPhoto({ product, priority = false, className = '' }) {
  return (
    <img
      src={productCardImage(product)}
      alt={product.slug === 'the-nuvira-trio'
        ? 'The NuVira Trio: one labeled bottle each of AURA, OASIS and RE-NU'
        : `${product.title} cold-pressed juice in its labeled 12oz bottle`}
      width="480"
      height="720"
      loading={priority ? 'eager' : 'lazy'}
      {...(priority ? { fetchpriority: 'high' } : {})}
      decoding="async"
      className={`h-full w-full object-contain ${className}`}
    />
  );
}

export default function LocalDeliveryShopping({ page }) {
  // Share the Shop catalog cache and API contract. Placeholder data renders
  // immediately but does not replace a successful live empty/unavailable list.
  const { data: products = PUBLIC_PRODUCT_FALLBACKS } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      try {
        const liveProducts = await base44.entities.Product.filter({ is_available: true }, 'sort_order', 100);
        return Array.isArray(liveProducts) ? liveProducts : PUBLIC_PRODUCT_FALLBACKS;
      } catch {
        return PUBLIC_PRODUCT_FALLBACKS;
      }
    },
    placeholderData: PUBLIC_PRODUCT_FALLBACKS,
  });
  const featured = deliveryLandingProducts(products);
  const trio = featured.find(product => product.slug === 'the-nuvira-trio');
  const juices = featured.filter(product => Boolean(FLAVORS[product.slug]));
  const trioPrice = deliveryLandingPrice(trio);
  const trackSelection = product => {
    void trackGoogleSelectItem(product, 'local_delivery_featured', 'Local delivery featured juices');
  };

  return (
    <>
      <section className="relative overflow-hidden border-b border-primary/15 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--primary)/0.15),transparent_65%)]">
        <div className="mx-auto grid max-w-6xl gap-4 px-5 py-6 sm:gap-7 sm:px-6 sm:py-12 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:gap-12 lg:px-8">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-primary sm:text-xs">
              <Truck className="h-4 w-4" aria-hidden="true" /><span className="sm:hidden">Cold-pressed. Locally delivered.</span><span className="hidden sm:inline">Small-batch. Cold-pressed. Delivered locally.</span>
            </p>
            <h1 className="font-heading text-[1.75rem] font-bold leading-[1.12] tracking-tight sm:text-4xl lg:text-5xl">{page.h1}</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:mt-4 sm:text-base sm:leading-7">
              <span className="sm:hidden">Three distinctive blends, made fresh for scheduled local delivery.</span>
              <span className="hidden sm:inline">Real fruits and vegetables. Three distinctive blends. Discover your favorite—or try all three with the NuVira Trio.</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] font-semibold sm:mt-5 sm:gap-x-4 sm:gap-y-2 sm:text-xs">
              {['No added sugars', 'No artificial sweeteners', 'No preservatives'].map(text => (
                <span key={text} className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />{text}</span>
              ))}
            </div>
            <div className="mt-6 hidden gap-2.5 sm:flex sm:flex-row">
              <a href="#choose-juice" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-sm transition-opacity hover:opacity-90">
                Choose your juices <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
              <a href="#delivery-check" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card/80 px-5 py-3 text-sm font-semibold transition-colors hover:bg-muted">
                <MapPin className="h-4 w-4" aria-hidden="true" /> Check my delivery area
              </a>
            </div>
            <a href="#first-order-offer-details" className="mt-3 inline-flex min-h-11 flex-wrap items-center gap-x-1 rounded-lg bg-primary/8 px-3 py-2 text-xs font-semibold text-foreground sm:mt-4 sm:text-sm">
              First order? Take 10% off with <strong className="tracking-wide text-primary">WELCOME10.</strong><span className="text-xs font-normal underline underline-offset-2">Terms apply.</span>
            </a>
            <p className="mt-2 hidden text-xs leading-5 text-muted-foreground sm:block">Guest checkout is available for standard delivery. Extended routes require review.</p>
          </div>

          {trio ? (
            <article className="overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-[0_12px_40px_-22px_hsl(var(--primary)/0.4)]" aria-label="Featured NuVira Trio bundle">
              <div className="grid grid-cols-[0.85fr_1fr] sm:grid-cols-[1fr_1fr]">
                <Link to={productPath(trio)} onClick={() => trackSelection(trio)} className="block min-w-0 bg-[#e7e8e1]" aria-label="Explore the NuVira Trio">
                  <CatalogPhoto product={trio} priority />
                </Link>
                <div className="flex min-w-0 flex-col justify-center p-4 sm:p-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">One of each signature blend</p>
                  <h2 className="mt-2 font-heading text-xl font-bold leading-tight sm:text-2xl">{trio.title}</h2>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">AURA + OASIS + RE-NU<br />3 × 12oz bottles</p>
                  {trioPrice && <p className="mt-3 text-xl font-bold">{trioPrice}<span className="ml-1.5 text-xs font-normal text-muted-foreground">per bundle</span></p>}
                  <Link to={productPath(trio)} onClick={() => trackSelection(trio)} className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90">
                    Explore the Trio <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </Link>
                </div>
              </div>
              <p className="border-t border-border/50 px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-5">
                Meets the 3-juice count minimum. Delivery-area dollar minimums, delivery fees and applicable taxes still apply.
              </p>
            </article>
          ) : (
            <Link to="/shop" className="rounded-2xl border border-border bg-card p-7 text-center font-semibold text-primary">Explore the currently available juices <ArrowRight className="ml-1 inline h-4 w-4" /></Link>
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 sm:hidden">
            <a href="#choose-juice" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary">All flavors <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
            <a href="#delivery-check" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary"><MapPin className="h-4 w-4" aria-hidden="true" />Check my delivery area</a>
            <p className="w-full text-xs leading-5 text-muted-foreground">Guest checkout is available for standard delivery. Extended routes require review.</p>
          </div>
        </div>
      </section>

      <section id="choose-juice" aria-labelledby="choose-juice-heading" className="scroll-mt-24 px-5 py-8 sm:px-6 md:px-8 md:py-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-primary">Find your flavor</p>
              <h2 id="choose-juice-heading" className="mt-2 font-heading text-2xl font-bold sm:text-3xl">Build a mix that tastes like you.</h2>
            </div>
            <Link to="/shop" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary">Shop all juices & shots <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </div>
          <p className="mb-5 max-w-2xl text-sm leading-6 text-muted-foreground">Juice and shot orders need at least 3 juices, 6 shots, or an equivalent mix. The Trio includes all 3 signature juices in one bundle.</p>
          <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
            {juices.map(product => (
              <article key={product.id} className="grid grid-cols-[7.25rem_1fr] overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm sm:grid-cols-1">
                <Link to={productPath(product)} onClick={() => trackSelection(product)} className="block min-w-0 bg-[#e7e8e1] sm:h-64" aria-label={`Explore ${product.title}`}>
                  <CatalogPhoto product={product} />
                </Link>
                <div className="flex min-w-0 flex-col justify-center p-4 sm:p-5">
                  <h3 className="font-heading text-xl font-bold">{product.title}</h3>
                  <p className={`mt-2 w-fit rounded-lg px-2 py-1 text-xs font-semibold leading-5 ${FLAVORS[product.slug].accent}`}>{FLAVORS[product.slug].taste}</p>
                  <p className="mt-3 text-sm font-semibold">{deliveryLandingPrice(product) || 'See current price'}<span className="ml-2 text-xs font-normal text-muted-foreground">12oz bottle</span></p>
                  <Link to={productPath(product)} onClick={() => trackSelection(product)} className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-primary">Explore {product.title} <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
                </div>
              </article>
            ))}
          </div>

          <aside id="first-order-offer-details" className="mt-6 scroll-mt-24 rounded-2xl border border-primary/25 bg-primary/5 p-5 sm:flex sm:items-start sm:gap-6" aria-label="First-order offer and terms">
            <div className="shrink-0"><p className="font-heading text-xl font-bold">Your first order, 10% off.</p><p className="mt-1 text-sm">Use <strong className="tracking-wider text-primary">WELCOME10</strong> at checkout.</p></div>
            <p className="mt-3 max-w-xl text-xs leading-5 text-muted-foreground sm:mt-0">First orders only, once per customer. Order minimums, delivery fees and applicable taxes apply. WELCOME10 cannot be combined with other discounts or reward redemptions. Eligibility is verified at checkout.</p>
          </aside>
        </div>
      </section>

      <section id="delivery-check" aria-labelledby="delivery-check-heading" className="scroll-mt-24 border-y border-border/50 bg-card/50 px-5 py-8 sm:px-6 md:px-8 md:py-12">
        <div className="mx-auto grid max-w-6xl gap-7 lg:grid-cols-2 lg:gap-10">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-primary">Before you build your order</p>
            <h2 id="delivery-check-heading" className="mt-2 font-heading text-2xl font-bold sm:text-3xl">Fresh delivery, with the details up front.</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{DELIVERY_POLICY_CONTENT.addressCheck}</p>
            <div className="mt-5 [&>div]:m-0 [&_.flex-1]:min-w-0 [&_input]:min-w-0"><DeliveryAvailabilityCard /></div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {DELIVERY_WINDOWS.map(window => (
                <div key={window.deliveryDay} className="border-l-2 border-primary/40 pl-3">
                  <p className="text-sm font-bold">{window.deliveryDay}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{window.deliveryWindow}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">Regular delivery windows. Checkout confirms the available date and time before payment.</p>
          </div>
          <div>
            <h3 className="font-heading text-lg font-bold">Delivery fees & area minimums</h3>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Every juice order has the count minimum above. Additional dollar minimums depend on driving distance, not a straight-line radius.</p>
            <dl className="mt-4 divide-y divide-border/60 rounded-xl border border-border/60 bg-background px-4">
              {DELIVERY_ZONE_SUMMARY.map(zone => (
                <div key={zone.distance} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 py-3">
                  <dt className="text-sm font-semibold">{zone.distance}</dt>
                  <dd className="text-right text-sm font-bold">{zone.fee} <span className="font-normal text-muted-foreground">fee</span></dd>
                  <dd className="col-span-2 text-xs leading-5 text-muted-foreground">{zone.minimum}{zone.review ? ' · Route review required' : ''}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">{DELIVERY_POLICY_CONTENT.routeReview}</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{DELIVERY_POLICY_CONTENT.waitlist}</p>
            <Link to="/delivery.html" className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary">All delivery details <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </div>
        </div>
      </section>
    </>
  );
}
