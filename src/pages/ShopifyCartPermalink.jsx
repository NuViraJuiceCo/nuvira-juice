import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ShoppingBag, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cartContext';
import { appParams } from '@/lib/app-params';

function getCartExtras(product) {
  const extra = {};
  if (product.category === 'bundle') {
    extra.bottles_per_unit = product.bottle_count || 3;
    if (product.title?.includes('Trio')) {
      extra.bundle_composition = [
        { product_id: 're-nu', product_name: 'RE-NU', quantity: 1 },
        { product_id: 'oasis', product_name: 'OASIS', quantity: 1 },
        { product_id: 'aura', product_name: 'AURA', quantity: 1 },
      ];
    } else {
      extra.bundle_composition = [];
    }
  }
  return extra;
}

async function resolveLatestShopifyCartPermalink(cartItems) {
  const apiBaseUrl = appParams.appBaseUrl || '';
  const response = await fetch(`${apiBaseUrl}/api/apps/${appParams.appId}/functions/resolveShopifyCartPermalink`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Id': appParams.appId,
    },
    body: JSON.stringify({ cart: decodeURIComponent(cartItems) }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Cart resolver failed with HTTP ${response.status}`);
  }
  return data;
}

export default function ShopifyCartPermalink() {
  const { cartItems = '' } = useParams();
  const navigate = useNavigate();
  const { addItem } = useCart();
  const processedRef = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!cartItems || processedRef.current) return;
    processedRef.current = true;

    const resolveCart = async () => {
      try {
        const response = await resolveLatestShopifyCartPermalink(cartItems);

        const items = response?.data?.items || response?.items || [];
        if (!items.length) {
          throw new Error('No matching NuVira product found for this Shopify cart link.');
        }

        items.forEach((item) => {
          if (!item.product) return;
          addItem(item.product, item.quantity || 1, getCartExtras(item.product));
        });

        const firstTitle = items[0]?.product?.title;
        toast.success(firstTitle ? `${firstTitle} added to cart` : 'Added to cart');
        navigate('/cart', { replace: true });
      } catch (err) {
        console.error('[ShopifyCartPermalink] Unable to resolve cart permalink', err);
        setError('This Instagram shopping link could not be matched to an available NuVira product.');
      }
    };

    resolveCart();
  }, [addItem, cartItems, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 text-center">
        <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
          <AlertCircle className="w-7 h-7 text-destructive" />
        </div>
        <h1 className="font-heading text-xl font-semibold">Product link unavailable</h1>
        <p className="text-sm text-muted-foreground mt-2 mb-5 max-w-xs">{error}</p>
        <Link to="/shop">
          <Button className="rounded-full px-6">Browse Juices</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 text-center">
      <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
        <ShoppingBag className="w-7 h-7 text-primary" />
      </div>
      <h1 className="font-heading text-xl font-semibold">Preparing your cart</h1>
      <p className="text-sm text-muted-foreground mt-2">Opening your Instagram shopping item in NuVira.</p>
    </div>
  );
}