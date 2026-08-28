import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock3, Mail, PackageCheck, ShieldCheck } from 'lucide-react';
import SEO from '@/components/SEO';
import {
  MERCHANT_RETURN_POLICY_CONTENT,
  MERCHANT_RETURN_POLICY_SCHEMA,
  MERCHANT_RETURN_POLICY_URL,
} from '@/lib/merchant-policy';

const LAST_UPDATED = 'August 27, 2026';

const policySections = [
  {
    icon: ShieldCheck,
    title: 'Quality issues',
    body: MERCHANT_RETURN_POLICY_CONTENT.qualityIssues,
  },
  {
    icon: Clock3,
    title: 'Refund timing',
    body: MERCHANT_RETURN_POLICY_CONTENT.refundTiming,
  },
  {
    icon: PackageCheck,
    title: 'No physical food returns',
    body: MERCHANT_RETURN_POLICY_CONTENT.noPhysicalReturns,
  },
];

export default function Returns() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background pb-16">
      <SEO
        title="Refund & Return Policy"
        description="Review NuVira Juice Co. refund, replacement, cancellation, and food-return terms for local juice orders."
        canonicalUrl={MERCHANT_RETURN_POLICY_URL}
        structuredData={MERCHANT_RETURN_POLICY_SCHEMA}
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
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-primary">Customer care</p>
            <h1 className="font-heading text-2xl font-bold text-foreground md:text-3xl">Refund & Return Policy</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8 md:py-12">
        <div className="max-w-3xl">
          <p className="font-heading text-3xl font-bold leading-tight text-foreground md:text-5xl">
            We stand behind every bottle we produce.
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
            Fresh juice is perishable, so our policy protects food safety while giving customers a clear path when an order arrives damaged, incorrect, or below our quality standards.
          </p>
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-3" aria-label="Refund and return policy summary">
          {policySections.map(({ icon: Icon, title, body }) => (
            <article key={title} className="border-t border-border/70 py-5 md:pr-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-base font-black text-foreground">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
            </article>
          ))}
        </section>

        <section className="mt-8 border-y border-border/70 py-7">
          <h2 className="font-heading text-2xl font-bold text-foreground">Cancellations</h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
            {MERCHANT_RETURN_POLICY_CONTENT.cancellations}
          </p>
        </section>

        <section className="mt-8 flex flex-col gap-4 bg-primary/10 p-5 md:flex-row md:items-center md:justify-between md:p-7">
          <div>
            <p className="text-base font-black text-foreground">Need help with an order?</p>
            <p className="mt-1 text-sm text-muted-foreground">Include your order number and a short description of the issue.</p>
          </div>
          <a
            href="mailto:support@nuvirajuice.com"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Mail className="h-4 w-4" />
            Email support
          </a>
        </section>

        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span>Last updated: {LAST_UPDATED}</span>
          <Link to="/legal" className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">Legal & Privacy</Link>
          <Link to="/delivery.html" className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">Delivery information</Link>
          <Link to="/support" className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">Support</Link>
        </div>
      </main>
    </div>
  );
}
