import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle, Loader2, PackageCheck, ShieldCheck, Store, TriangleAlert } from 'lucide-react';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { AdminStatusPill } from '@/components/admin/AdminStatusPill';
import May30EventStockPlanPanel from '@/components/admin/May30EventStockPlanPanel';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';

const APPROVAL_CODE = 'SYNC_EVENT_CATALOG_2026_07_11';

function Field({ label, value }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background p-3">
      <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-xs font-bold text-foreground">{value || 'Not set'}</p>
    </div>
  );
}

function ResultBlock({ result }) {
  if (!result) return null;

  const tote = result.tote || {};
  const trio = result.trio || {};
  const publicationErrors = [
    ...(tote.publication?.user_errors || []).map(error => error?.message).filter(Boolean),
    ...(trio.publication?.user_errors || []).map(error => error?.message).filter(Boolean),
    tote.publication?.error,
    trio.publication?.error,
    result.publications?.lookup_error,
  ].filter(Boolean);

  return (
    <section className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <CheckCircle className="h-4 w-4 text-emerald-700" />
        <h2 className="text-sm font-black text-emerald-950">Event catalog sync complete</h2>
        <AdminStatusPill value="event_catalog_sync_complete" label={result.writes_performed ? 'Writes performed' : 'Read only'} tone="success" />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Tote Shopify Product" value={tote.shopify_product?.shopify_product_id} />
        <Field label="Tote Shopify Variant" value={tote.shopify_product?.variants?.[0]?.shopify_variant_id} />
        <Field label="Trio Product Found" value={trio.product_found ? 'Yes' : 'No'} />
        <Field label="Trio POS Variant" value={trio.expected_shopify_variant_id} />
      </div>

      {publicationErrors.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          <div className="mb-1 flex items-center gap-2">
            <TriangleAlert className="h-4 w-4" />
            <span>Publication warnings</span>
          </div>
          {publicationErrors.map((message, index) => (
            <p key={`${message}-${index}`}>{message}</p>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-emerald-200 bg-white p-3 text-xs font-semibold text-emerald-900">
          Tote and Trio publication calls completed without Shopify user errors.
        </div>
      )}

      <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs font-semibold text-cyan-950">
        No customer orders, fulfillment tasks, production batches, inventory deductions, purchase orders, bulk product sync, or notifications were created.
      </div>
    </section>
  );
}

export default function EventCatalogSetup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('adminEventCatalogShopifySync', {
        approval_code: APPROVAL_CODE,
      });
      return response?.data || response;
    },
  });

  if (user?.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Access denied. Admins only.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-10">
      <AdminOpsHeader
        title="Event Catalog Setup"
        subtitle="July 11 POS and merch readiness"
        badge="Admin"
        badgeTone="native"
        onBack={() => navigate('/admin/operations')}
        actions={null}
      />

      <main className="space-y-4 px-4 pt-4">
        <section className="rounded-xl border border-border/50 bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 text-primary" />
                <h1 className="text-sm font-black text-foreground">Shopify POS catalog sync</h1>
              </div>
              <p className="mt-1 text-xs font-medium text-muted-foreground">
                Creates or updates only the Large NuVira Tote Bag and publishes the tote plus existing NuVira Trio to available Shopify sales-channel publications.
              </p>
            </div>
            <AdminStatusPill value="hidden_admin_route" label="Hidden admin route" tone="source" />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <PackageCheck className="h-4 w-4 text-primary" />
              <p className="mt-2 text-xs font-black text-foreground">Large tote</p>
              <p className="text-[10px] font-semibold text-muted-foreground">$12.00 · insulated merch · POS</p>
              <p className="mt-1 text-[10px] font-semibold text-muted-foreground">13 in W x 15 in H x 9 in D · image included</p>
            </div>
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <PackageCheck className="h-4 w-4 text-primary" />
              <p className="mt-2 text-xs font-black text-foreground">NuVira Trio</p>
              <p className="text-[10px] font-semibold text-muted-foreground">$36.00 · existing Shopify product</p>
            </div>
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <p className="mt-2 text-xs font-black text-foreground">Guarded write</p>
              <p className="text-[10px] font-semibold text-muted-foreground">No order, batch, inventory, or notification mutations</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4" />}
            Run POS sync
          </button>

          {mutation.isError && (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs font-semibold text-destructive">
              {mutation.error?.message || 'Unable to sync event catalog.'}
            </div>
          )}
        </section>

        <May30EventStockPlanPanel includedInPlanning />
        <ResultBlock result={mutation.data} />
      </main>
    </div>
  );
}
