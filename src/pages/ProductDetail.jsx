import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import SEO from '@/components/SEO';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Droplets,
  Leaf,
  Minus,
  Package,
  Plus,
  Recycle,
  ShieldCheck,
  ShoppingBag,
  Snowflake,
  Sparkles,
  Truck,
} from 'lucide-react';
import HealthAdvisory from '@/components/HealthAdvisory';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cartContext';
import { normalizeProductIdentifier, productLookupKeys, productPath } from '@/lib/seo-slugs';
import { findPublicProductFallback } from '@/lib/public-products';
import { buildProductSeoMetadata, buildProductStructuredData } from '@/lib/product-seo';
import { buildProductGallery } from '@/lib/product-gallery-images';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import ProductCard from '@/components/shop/ProductCard';
import { ANALYTICS_CONSENT_EVENT, trackGoogleViewItem } from '@/lib/googleAnalytics';
import { MARKETING_CONSENT_EVENT, trackMetaViewContent } from '@/lib/metaPixel';
import { trackSnapViewContent } from '@/lib/snapPixel';

function normalizeCategory(value) {
  return String(value || '').trim().toLowerCase();
}

function isMerchLikeProduct(product) {
  const category = normalizeCategory(product?.category);
  const title = String(product?.title || '').trim().toLowerCase();

  return (
    ['merch', 'merchandise', 'apparel', 'tote', 'bag', 'accessory', 'accessories'].includes(category) ||
    /\b(tote|bag|merch|shirt|hoodie|hat)\b/.test(title)
  );
}

function getCategoryLabel(product, isMerchProduct) {
  const category = normalizeCategory(product?.category);
  if (isMerchProduct) return 'NuVira merch';
  if (category === 'bundle') return 'Signature bundle';
  if (category === 'shot') return 'Wellness shot';
  if (category === 'wellness_pack') return 'Wellness program';
  return 'Cold-pressed juice';
}

function buildProductHighlights(product, isMerchProduct) {
  const category = normalizeCategory(product?.category);
  const title = String(product?.title || '');
  const isBundle = category === 'bundle';
  const isShot = category === 'shot';
  const size = product?.size || (isBundle ? `${product?.bottle_count || 3} bottles` : null);

  if (isMerchProduct) {
    return [
      { label: 'Reusable carry', value: 'Built for market days and juice runs', icon: Recycle },
      { label: 'Insulated shopper', value: 'Keeps bottles easier to transport', icon: Package },
      { label: 'Event ready', value: 'Pairs cleanly with NuVira orders', icon: ShoppingBag },
    ];
  }

  if (isBundle || title.toLowerCase().includes('trio')) {
    return [
      { label: 'Full lineup', value: 'AURA, OASIS, and RE-NU together', icon: Sparkles },
      { label: 'Fresh route', value: 'Made for local delivery', icon: Truck },
      { label: 'Bottle count', value: size || '3 signature bottles', icon: Package },
    ];
  }

  if (isShot) {
    return [
      { label: 'Focused boost', value: size || '2oz functional shot', icon: Droplets },
      { label: 'Take chilled', value: 'Keep refrigerated until ready', icon: Snowflake },
      { label: 'Small batch', value: 'Pressed close to your order', icon: Clock },
    ];
  }

  return [
    { label: 'Made fresh', value: 'Pressed close to your delivery', icon: Leaf },
    { label: 'Keep chilled', value: 'Refrigerate and enjoy cold', icon: Snowflake },
    { label: 'Local delivery', value: 'Wentzville and St. Louis area routes', icon: Truck },
  ];
}

function splitIngredients(ingredients) {
  return String(ingredients || '')
    .split(',')
    .map(item => item.trim().replace(/^and\s+/i, ''))
    .filter(Boolean);
}

function inferBlendDetail(product, isMerchProduct) {
  if (isMerchProduct) return null;

  const title = String(product?.title || '');
  const category = normalizeCategory(product?.category);
  const description = String(product?.description || '');
  const shortDescription = String(product?.short_description || '');

  if (product?.ingredients) {
    return {
      label: 'Ingredients',
      helper: 'No shortcuts, no filler.',
      value: product.ingredients,
      items: splitIngredients(product.ingredients),
    };
  }

  if (category === 'bundle' || title.toLowerCase().includes('trio')) {
    return {
      label: 'Bundle includes',
      helper: 'One of each signature bottle.',
      value: 'AURA, OASIS, RE-NU',
      items: ['AURA', 'OASIS', 'RE-NU'],
    };
  }

  const withMatch = description.match(/\bwith\s+(.+?)(?:\.|$)/i);
  const inferredValue = withMatch?.[1] || shortDescription || description;
  if (!inferredValue) return null;

  return {
    label: 'Blend notes',
    helper: 'Flavor and function at a glance.',
    value: inferredValue,
    items: splitIngredients(inferredValue),
  };
}

export default function ProductDetail() {
  const { id, slug, handle } = useParams();
  const identifier = normalizeProductIdentifier(slug || handle || id || '');
  const navigate = useNavigate();
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [failedGalleryImages, setFailedGalleryImages] = useState(() => new Set());
  const trackedProductIdRef = useRef('');
  const trackedMetaProductIdRef = useRef('');
  const trackedSnapProductIdRef = useRef('');

  const { data: product, isLoading } = useQuery({
    queryKey: ['product-detail', identifier],
    queryFn: async () => {
      const fallbackProduct = findPublicProductFallback(identifier);

      try {
        const availableProducts = await base44.entities.Product.filter({ is_available: true }, 'sort_order', 200);
        const productByLookupKey = availableProducts.find(p => productLookupKeys(p).includes(identifier));
        if (productByLookupKey) return productByLookupKey;

        if (/^[a-f0-9]{24}$/.test(identifier)) {
          const productsById = await base44.entities.Product.filter({ id: identifier });
          if (productsById?.[0]) return productsById[0];
        }

        return fallbackProduct;
      } catch (error) {
        console.warn('[ProductDetail] Falling back to public product metadata for SEO route', identifier, error);
        return fallbackProduct;
      }
    },
    enabled: !!identifier,
  });

  const { data: relatedProducts = [] } = useQuery({
    queryKey: ['related-products', product?.category],
    queryFn: () => base44.entities.Product.filter({ category: product.category, is_available: true }, 'sort_order', 6),
    enabled: !!product?.category,
  });

  const related = relatedProducts.filter(p => p.id !== product?.id).slice(0, 4);

  useEffect(() => {
    const trackingId = String(product?.id || identifier || '');
    if (!product || !trackingId) return undefined;
    const trackGoogleView = async () => {
      if (trackedProductIdRef.current === trackingId) return;
      if (await trackGoogleViewItem(product)) trackedProductIdRef.current = trackingId;
    };
    const trackMetaView = async () => {
      if (trackedMetaProductIdRef.current === trackingId) return;
      if (await trackMetaViewContent(product)) trackedMetaProductIdRef.current = trackingId;
    };
    const trackSnapView = async () => {
      if (trackedSnapProductIdRef.current === trackingId) return;
      if (await trackSnapViewContent(product)) trackedSnapProductIdRef.current = trackingId;
    };
    const onAnalyticsConsent = (event) => {
      if (event.detail === 'granted') void trackGoogleView();
    };
    const onMarketingConsent = (event) => {
      if (event.detail === 'granted') {
        void trackMetaView();
        void trackSnapView();
      }
    };
    void trackGoogleView();
    void trackMetaView();
    void trackSnapView();
    window.addEventListener(ANALYTICS_CONSENT_EVENT, onAnalyticsConsent);
    window.addEventListener(MARKETING_CONSENT_EVENT, onMarketingConsent);
    return () => {
      window.removeEventListener(ANALYTICS_CONSENT_EVENT, onAnalyticsConsent);
      window.removeEventListener(MARKETING_CONSENT_EVENT, onMarketingConsent);
    };
  }, [identifier, product]);

  useEffect(() => {
    if (!product) return;
    const canonicalPath = productPath(product);
    if ((id || handle) || window.location.pathname !== canonicalPath) {
      navigate(canonicalPath, { replace: true });
    }
  }, [handle, id, product, navigate]);

  useEffect(() => {
    setSelectedImageIndex(0);
    setFailedGalleryImages(new Set());
  }, [product?.id]);

  const handleGalleryImageError = (imageSrc, failedIndex) => {
    setFailedGalleryImages((current) => {
      if (current.has(imageSrc)) return current;
      const next = new Set(current);
      next.add(imageSrc);
      return next;
    });
    setSelectedImageIndex((current) => {
      if (current === failedIndex) return 0;
      return current > failedIndex ? current - 1 : current;
    });
  };

  const handleAddToCart = () => {
    if (!product) return;
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
    addItem(product, quantity, extra);
    toast.success(`${product.title} added to cart`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <SEO title="Product Not Found" description="This product could not be found." noindex />
        <p className="text-muted-foreground">Product not found</p>
      </div>
    );
  }

  const isMerch = isMerchLikeProduct(product);
  const isMerchProduct = isMerch;
  const productDescriptor = getCategoryLabel(product, isMerchProduct);
  const productBadges = isMerch
    ? ['Reusable', 'Insulated', 'Large Capacity']
    : ['Vegan', 'Cold-Pressed', 'Non-GMO', 'Gluten-Free'];
  const productHighlights = buildProductHighlights(product, isMerchProduct);
  const blendDetail = inferBlendDetail(product, isMerchProduct);
  const productSeo = buildProductSeoMetadata(product);
  const productStructuredData = buildProductStructuredData(product);
  const productGallery = buildProductGallery(product).filter(
    image => !failedGalleryImages.has(image.src),
  );
  const selectedProductImage = productGallery[selectedImageIndex] || productGallery[0] || null;

  const purchaseBar = (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 px-4 md:left-60 md:bottom-4 md:px-6"
    >
      <div className="pointer-events-auto mx-auto flex max-w-3xl items-center gap-2 rounded-2xl border border-border/60 bg-card/95 p-2.5 shadow-[0_18px_44px_rgba(4,29,21,0.24)] backdrop-blur-xl">
        <div className="flex shrink-0 items-center gap-1 rounded-xl bg-secondary p-1">
          <button
            type="button"
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            className="flex h-11 w-11 items-center justify-center rounded-lg transition-transform hover:bg-background/40 hover:opacity-80 active:scale-95"
            aria-label="Decrease quantity"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-semibold w-6 text-center">{quantity}</span>
          <button
            type="button"
            onClick={() => setQuantity(quantity + 1)}
            className="flex h-11 w-11 items-center justify-center rounded-lg transition-transform hover:bg-background/40 hover:opacity-80 active:scale-95"
            aria-label="Increase quantity"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <Button
          type="button"
          onClick={handleAddToCart}
          aria-label={`Add ${quantity} ${product.title} to cart for $${((product.price || 0) * quantity).toFixed(2)}`}
          className="nuvira-gradient-button h-11 min-h-11 flex-1 rounded-xl text-sm font-semibold inline-flex items-center justify-center"
        >
          <ShoppingBag className="w-3.5 h-3.5 mr-1.5" />
          {`Add to cart · $${((product.price || 0) * quantity).toFixed(2)}`}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background pb-[calc(env(safe-area-inset-bottom)+11rem)] md:pb-32">
      <SEO
        title={productSeo.title}
        description={productSeo.description}
        image={productSeo.image}
        type="product"
        keywords={productSeo.keywords}
        canonicalUrl={productSeo.canonicalUrl}
        structuredData={productStructuredData}
      />

      <div className="hidden md:flex items-center gap-2 px-6 pt-5 pb-3">
        <button onClick={() => navigate(-1)} className="inline-flex min-h-11 min-w-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      </div>

      <main className="mx-auto w-full max-w-[1360px] md:px-6 md:pb-28">
      <div className="xl:grid xl:grid-cols-[minmax(0,0.92fr)_minmax(340px,0.68fr)] xl:gap-6 xl:items-stretch">
        <div className="md:px-4 xl:min-h-[460px] xl:px-0">
          <div
            className={`relative w-full overflow-hidden bg-secondary/50 shadow-[0_24px_80px_rgba(4,29,21,0.22)] md:rounded-[28px] md:border md:border-border/50 xl:h-[min(64vh,620px)] xl:min-h-[460px] ${
              isMerchProduct
                ? 'h-[44vh] min-h-[260px] max-h-[390px] sm:max-h-[430px] xl:max-h-[620px]'
                : 'h-[52vh] min-h-[330px] max-h-[470px] sm:h-[50vh] sm:max-h-[520px]'
            }`}
          >
            {selectedProductImage?.src ? (
              <>
                {isMerchProduct && (
                  <img
                    src={selectedProductImage.src}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-2xl"
                  />
                )}
                <img
                  src={selectedProductImage.src}
                  alt={selectedProductImage.alt}
                  onError={() => handleGalleryImageError(selectedProductImage.src, selectedImageIndex)}
                  className={`relative h-full w-full ${isMerchProduct ? 'object-contain p-3 md:p-8' : 'object-cover'}`}
                />
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-7xl">{isMerchProduct ? '🛍️' : '🍊'}</div>
            )}
            <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/55 via-black/12 to-transparent pointer-events-none" />
            <button
              onClick={() => navigate(-1)}
              className="md:hidden absolute left-4 w-11 h-11 bg-card/90 text-foreground backdrop-blur-md rounded-full flex items-center justify-center shadow-lg"
              style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
              aria-label="Go back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="absolute left-4 right-4 bottom-4 flex items-center justify-end gap-3">
              {productGallery.length > 1 && (
                <span className="rounded-full bg-black/55 px-3 py-1.5 text-[11px] font-bold text-white backdrop-blur">
                  {selectedImageIndex + 1} / {productGallery.length}
                </span>
              )}
              {product.size && (
                <span className="shrink-0 rounded-full bg-black/55 px-3 py-1.5 text-[11px] font-bold text-white backdrop-blur">
                  {product.size}
                </span>
              )}
            </div>
          </div>

          {productGallery.length > 1 && (
            <div
              role="group"
              aria-label={`${product.title} product gallery`}
              className="grid grid-cols-4 gap-2 px-4 pt-3 md:px-0"
            >
              {productGallery.map((image, index) => (
                <button
                  key={image.src}
                  type="button"
                  aria-label={`View image ${index + 1} of ${productGallery.length}: ${image.alt}`}
                  aria-pressed={selectedImageIndex === index}
                  onClick={() => setSelectedImageIndex(index)}
                  className={`group relative aspect-[4/3] min-h-14 overflow-hidden rounded-xl border bg-secondary/50 shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                    selectedImageIndex === index
                      ? 'border-primary ring-2 ring-primary/25'
                      : 'border-border/60 hover:border-primary/50'
                  }`}
                >
                  <img
                    src={image.src}
                    alt=""
                    aria-hidden="true"
                    loading={index === 0 ? 'eager' : 'lazy'}
                    onError={() => handleGalleryImageError(image.src, index)}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  <span className="sr-only">{image.alt}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-4 pt-5 md:px-8 xl:h-full xl:px-0 xl:pt-2 xl:flex xl:flex-col xl:justify-center"
          >
            {product.is_seasonal && (
              <span className="inline-block bg-accent/20 text-accent text-[10px] font-semibold px-2.5 py-1 rounded-full mb-3">
                Seasonal Drop
              </span>
            )}
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary">
              {productDescriptor}
            </p>
            <h1 className="font-heading text-4xl font-bold leading-[0.95] sm:text-5xl xl:text-6xl">{product.title}</h1>
            {product.short_description && (
              <p className="mt-3 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">{product.short_description}</p>
            )}

            <div className="mt-5 flex items-end gap-2">
              <span className="text-3xl font-black tracking-tight">${product.price?.toFixed(2)}</span>
              {product.compare_at_price && (
                <span className="text-sm text-muted-foreground line-through">${product.compare_at_price.toFixed(2)}</span>
              )}
              {product.size && (
                <span className="ml-auto rounded-full border border-border/60 px-3 py-1 text-xs font-semibold text-muted-foreground md:hidden">{product.size}</span>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {productBadges.map(cert => (
                <span key={cert} className="inline-flex items-center gap-1.5 rounded-full border border-nuvira bg-nuvira-gradient-soft px-3 py-1.5 text-[11px] font-black text-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {cert}
                </span>
              ))}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3 xl:grid-cols-3">
              {productHighlights.map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-2xl border border-border/60 bg-card/70 p-3.5 shadow-sm">
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-nuvira-gradient text-white shadow-sm">
                    <Icon className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-black text-foreground">{label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/10 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  {isMerchProduct ? <ShoppingBag className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                </div>
                <div>
                  <p className="text-sm font-black text-foreground">
                    {isMerchProduct ? 'Ready for daily carry' : 'Freshness handled by NuVira'}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {isMerchProduct
                      ? 'Merch ships or travels with your NuVira order when available.'
                      : 'Orders are planned around fresh production, cold storage, and local delivery timing.'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4">
                    <Link to="/delivery.html" className="inline-flex min-h-11 items-center text-xs font-bold text-primary hover:underline">
                      Delivery details
                    </Link>
                    <Link to="/returns.html" className="inline-flex min-h-11 items-center text-xs font-bold text-primary hover:underline">
                      Refund & return policy
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="mt-8 grid gap-4 px-4 pb-4 md:px-8 md:pb-0 xl:grid-cols-[minmax(0,0.68fr)_minmax(280px,0.32fr)] xl:px-0">
        {product.description && (
          <div className="rounded-3xl border border-border/60 bg-card/70 p-5 md:p-6">
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary">About</p>
            <h2 className="font-heading text-2xl font-bold">
              {isMerchProduct ? 'Built for the NuVira routine.' : 'Fresh, functional, and made to fit your day.'}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-foreground/78 md:text-base">{product.description}</p>
          </div>
        )}
        {blendDetail && (
          <div className="rounded-3xl border border-nuvira bg-nuvira-gradient-soft p-5 md:p-6">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Leaf className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-primary">{blendDetail.label}</p>
                <p className="text-xs text-muted-foreground">{blendDetail.helper}</p>
              </div>
            </div>
            {blendDetail.items.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                {blendDetail.items.map(item => (
                  <span key={item} className="rounded-full bg-background/70 px-3 py-1.5 text-xs font-semibold text-foreground/75">
                    {item}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-foreground/75">{blendDetail.value}</p>
            )}
          </div>
        )}

        {!isMerch && (
          !isMerchProduct && (
            <div className="xl:col-span-2">
              <HealthAdvisory variant="expanded" />
            </div>
          )
        )}
      </div>

      {related.length > 0 && (
        <div className="mt-8 px-4 md:px-8 xl:px-0">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary">Keep exploring</p>
              <h2 className="font-heading text-xl font-bold">Pair it with</h2>
            </div>
          </div>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 items-stretch xl:grid xl:grid-cols-4 xl:overflow-visible">
            {related.map(p => (
              <div key={p.id} className="shrink-0 w-40 md:w-auto">
                <ProductCard product={p} compact />
              </div>
            ))}
          </div>
        </div>
      )}
      </main>

      {typeof document !== 'undefined' ? createPortal(purchaseBar, document.body) : purchaseBar}
    </div>
  );
}
