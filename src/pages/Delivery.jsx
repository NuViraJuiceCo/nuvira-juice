import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, CircleDollarSign, MapPin, Route, ShieldCheck } from 'lucide-react';
import SEO from '@/components/SEO';
import {
  DELIVERY_POLICY_CONTENT,
  DELIVERY_POLICY_SCHEMA,
  DELIVERY_POLICY_URL,
  DELIVERY_WINDOWS,
  DELIVERY_ZONE_SUMMARY,
} from '@/lib/delivery-policy';

export default function Delivery() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background pb-16">
      <SEO
        title="Local Delivery Information"
        description="Review NuVira local delivery windows, address eligibility, delivery fees, order minimums, route review, and waitlist information."
        canonicalUrl={DELIVERY_POLICY_URL}
        structuredData={DELIVERY_POLICY_SCHEMA}
      />

      <header className="border-b border-border/50 bg-card/55">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 pb-5 md:px-8" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-secondary"
            aria-label="Go back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-primary">Fresh, local, scheduled</p>
            <h1 className="font-heading text-2xl font-bold text-foreground md:text-3xl">Local Delivery Information</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8 md:py-12">
        <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)] lg:items-end">
          <div>
            <p className="font-heading text-3xl font-bold leading-tight text-foreground md:text-5xl">
              Made fresh around a dependable local delivery rhythm.
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              {DELIVERY_POLICY_CONTENT.schedule}
            </p>
          </div>
          <div className="border-l-2 border-primary pl-5">
            <p className="text-sm font-black text-foreground">Address-level confirmation</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{DELIVERY_POLICY_CONTENT.addressCheck}</p>
          </div>
        </section>

        <section className="mt-10" aria-labelledby="delivery-windows-heading">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-primary">Regular cadence</p>
              <h2 id="delivery-windows-heading" className="font-heading text-2xl font-bold text-foreground">Production and delivery windows</h2>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {DELIVERY_WINDOWS.map(window => (
              <article key={window.deliveryDay} className="border-t border-border/70 py-5 md:pr-8">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">{window.productionDay} production</p>
                <p className="mt-2 text-xl font-black text-foreground">{window.deliveryDay}</p>
                <p className="mt-1 text-base font-semibold text-primary">{window.deliveryWindow}</p>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">Standard order cutoff: {window.cutoff}. Checkout shows the currently available option.</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-10" aria-labelledby="delivery-fees-heading">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CircleDollarSign className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-primary">Shown before payment</p>
              <h2 id="delivery-fees-heading" className="font-heading text-2xl font-bold text-foreground">Delivery fees and order minimums</h2>
            </div>
          </div>

          <div className="mt-5 overflow-hidden border-y border-border/70">
            <div className="hidden grid-cols-[1.2fr_0.55fr_1fr_0.7fr] gap-4 border-b border-border/70 py-3 text-[11px] font-black uppercase tracking-[0.12em] text-muted-foreground md:grid">
              <span>Driving distance</span>
              <span>Fee</span>
              <span>Minimum</span>
              <span>Availability</span>
            </div>
            {DELIVERY_ZONE_SUMMARY.map(zone => (
              <article key={zone.distance} className="grid gap-2 border-b border-border/50 py-4 last:border-b-0 md:grid-cols-[1.2fr_0.55fr_1fr_0.7fr] md:items-center md:gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground md:hidden">Driving distance</p>
                  <p className="text-sm font-bold text-foreground">{zone.distance}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground md:hidden">Fee</p>
                  <p className="text-sm font-semibold text-foreground">{zone.fee}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground md:hidden">Minimum</p>
                  <p className="text-sm text-muted-foreground">{zone.minimum}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground md:hidden">Availability</p>
                  <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-[11px] font-black ${zone.review ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300' : 'bg-primary/10 text-primary'}`}>
                    {zone.review ? 'Route review' : 'Automatic'}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-3" aria-label="Delivery safeguards">
          <article className="border-t border-border/70 py-5 md:pr-6">
            <MapPin className="h-5 w-5 text-primary" />
            <h2 className="mt-4 text-base font-black text-foreground">Full address required</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{DELIVERY_POLICY_CONTENT.addressCheck}</p>
          </article>
          <article className="border-t border-border/70 py-5 md:pr-6">
            <Route className="h-5 w-5 text-primary" />
            <h2 className="mt-4 text-base font-black text-foreground">Route-review areas</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{DELIVERY_POLICY_CONTENT.routeReview}</p>
          </article>
          <article className="border-t border-border/70 py-5 md:pr-6">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="mt-4 text-base font-black text-foreground">Outside the active range</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{DELIVERY_POLICY_CONTENT.waitlist}</p>
          </article>
        </section>

        <p className="mt-8 border-y border-border/70 py-5 text-xs leading-6 text-muted-foreground">
          {DELIVERY_POLICY_CONTENT.exceptions}
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <Link to="/shop" className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">Shop NuVira</Link>
          <Link to="/returns.html" className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">Refund & return policy</Link>
          <Link to="/support" className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">Support</Link>
        </div>
      </main>
    </div>
  );
}
