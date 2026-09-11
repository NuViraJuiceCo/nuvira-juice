import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Truck } from 'lucide-react';
import { DELIVERY_POLICY_PATH, DELIVERY_WINDOWS } from '@/lib/delivery-policy';
import { orderMinimumStatus } from '@/lib/orderMinimums';
import { productPath } from '@/lib/seo-slugs';

// Display existing ordering rules without changing quantities, cart or eligibility.
export default function ProductOrderDetails({ product }) {
  const category = String(product?.category || '').trim().toLowerCase();
  if (!['juice', 'shot', 'bundle'].includes(category)) return null;

  const productId = String(product?.id || product?.product_id || '').trim();
  const slug = String(product?.slug || '').trim().toLowerCase();
  const isTrio = productId
    ? productId === '69d490ce699b5f1ac4dde498'
    : slug === 'the-nuvira-trio';
  const coreJuiceIds = ['69d490ce699b5f1ac4dde495', '69d490ce699b5f1ac4dde496', '69d490ce699b5f1ac4dde497'];
  const showTrioLink = category === 'juice' && (productId
    ? coreJuiceIds.includes(productId)
    : ['aura', 'oasis', 're-nu'].includes(slug));
  const bundleMeetsCount = category === 'bundle' && orderMinimumStatus([{
    category,
    quantity: 1,
    bottles_per_unit: product.bottle_count ?? product.bottles_per_unit ?? 3,
  }]).meetsMinimum;

  return (
    <aside aria-label="Ordering and delivery details" className="mt-4 rounded-2xl border border-border/60 bg-card/70 px-3.5 py-3">
      <p className="text-xs font-semibold leading-5 text-foreground">
        {bundleMeetsCount
          ? `${isTrio ? 'The Trio' : 'This bundle'} meets the juice-and-shot count minimum. Delivery-area dollar minimums still apply.`
          : 'Mix your favorites: orders need at least 3 juices, 6 shots, or an equivalent mix.'}
      </p>
      <div className="mt-2 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold text-foreground/80">Regular local delivery</p>
          {DELIVERY_WINDOWS.map(window => (
            <p key={window.deliveryDay}>{window.deliveryDay} · {window.deliveryWindow}</p>
          ))}
          <p className="mt-1">Fees and area minimums depend on your address. Checkout confirms your available date and full total.</p>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4">
        <Link to={DELIVERY_POLICY_PATH} className="inline-flex min-h-11 items-center text-xs font-semibold text-primary underline underline-offset-2">
          Delivery fees & area details
        </Link>
        {showTrioLink && (
          <Link to={productPath({ slug: 'the-nuvira-trio' })} className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary">
            Try all 3 with the Trio <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>
    </aside>
  );
}
