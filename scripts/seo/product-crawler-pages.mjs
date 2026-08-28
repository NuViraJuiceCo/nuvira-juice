import { PUBLIC_PRODUCT_FALLBACKS } from '../../src/lib/public-product-catalog.js';
import {
  DELIVERY_POLICY_CONTENT,
  DELIVERY_POLICY_SCHEMA,
  DELIVERY_POLICY_URL,
  DELIVERY_WINDOWS,
  DELIVERY_ZONE_SUMMARY,
} from '../../src/lib/delivery-policy.js';
import {
  MERCHANT_RETURN_POLICY_CONTENT,
  MERCHANT_RETURN_POLICY_SCHEMA,
  MERCHANT_RETURN_POLICY_URL,
} from '../../src/lib/merchant-policy.js';
import { buildProductSeoMetadata, buildProductStructuredData } from '../../src/lib/product-seo.js';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) {
    throw new Error(`Product SEO build could not find ${label} in dist/index.html`);
  }
  return source.replace(pattern, replacement);
}

function safeJsonLd(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function renderProductCanonicalRedirect(indexHtml) {
  const routes = PUBLIC_PRODUCT_FALLBACKS.map(product => `/product/${buildProductSeoMetadata(product).slug}`);
  const redirectScript = [
    '    <script data-nuvira-product-canonical-redirect>',
    '      (function () {',
    '        if (globalThis.Capacitor?.isNativePlatform?.()) return;',
    `        var routes = ${safeJsonLd(routes)};`,
    "        var path = window.location.pathname.replace(/\\/+$/, '');",
    "        if (routes.indexOf(path) === -1 || window.location.pathname === path + '/') return;",
    "        window.location.replace(path + '/' + window.location.search + window.location.hash);",
    '      })();',
    '    </script>',
  ].join('\n');
  return replaceRequired(String(indexHtml), /\s*<\/head>/i, `\n${redirectScript}\n  </head>`, 'closing head');
}

export function renderProductCrawlerHtml(indexHtml, product) {
  const metadata = buildProductSeoMetadata(product);
  const structuredData = buildProductStructuredData(product);
  const productMeta = [
    `    <meta property="product:price:amount" content="${escapeHtml(metadata.price)}" />`,
    `    <meta property="product:price:currency" content="${metadata.currency}" />`,
    `    <meta property="product:availability" content="${metadata.availabilityLabel.toLowerCase()}" />`,
    `    <meta name="twitter:url" content="${escapeHtml(metadata.canonicalUrl)}" />`,
    `    <script type="application/ld+json" data-nuvira-product-schema>${safeJsonLd(structuredData)}</script>`,
  ].join('\n');
  const noScriptSnapshot = [
    '    <noscript>',
    '      <main>',
    `        <h1>${escapeHtml(product.title)}</h1>`,
    `        <p>${escapeHtml(metadata.description)}</p>`,
    `        <p>${escapeHtml(product.size || metadata.category)} · $${metadata.price} USD · ${metadata.availabilityLabel}</p>`,
    `        <img src="${escapeHtml(metadata.image)}" alt="${escapeHtml(product.title)} from NuVira Juice Co." />`,
    '        <p><a href="/shop">Shop all NuVira products</a></p>',
    '      </main>',
    '    </noscript>',
  ].join('\n');

  let html = String(indexHtml);
  html = replaceRequired(html, /<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(metadata.fullTitle)}</title>`, 'title');
  html = replaceRequired(html, /<meta\s+name="description"[^>]*>/i, `<meta name="description" content="${escapeHtml(metadata.description)}" />`, 'description');
  html = replaceRequired(html, /<link\s+rel="canonical"[^>]*>/i, `<link rel="canonical" href="${escapeHtml(metadata.canonicalUrl)}" />`, 'canonical URL');
  html = replaceRequired(html, /<meta\s+name="keywords"[^>]*>/i, `<meta name="keywords" content="${escapeHtml(metadata.keywords)}" />`, 'keywords');
  html = replaceRequired(html, /<meta\s+property="og:type"[^>]*>/i, '<meta property="og:type" content="product" />', 'Open Graph type');
  html = replaceRequired(html, /<meta\s+property="og:url"[^>]*>/i, `<meta property="og:url" content="${escapeHtml(metadata.canonicalUrl)}" />`, 'Open Graph URL');
  html = replaceRequired(html, /<meta\s+property="og:title"[^>]*>/i, `<meta property="og:title" content="${escapeHtml(metadata.fullTitle)}" />`, 'Open Graph title');
  html = replaceRequired(html, /<meta\s+property="og:description"[^>]*>/i, `<meta property="og:description" content="${escapeHtml(metadata.description)}" />`, 'Open Graph description');
  html = replaceRequired(html, /<meta\s+property="og:image"[^>]*>/i, `<meta property="og:image" content="${escapeHtml(metadata.image)}" />`, 'Open Graph image');
  html = replaceRequired(html, /<meta\s+property="og:image:alt"[^>]*>/i, `<meta property="og:image:alt" content="${escapeHtml(`${product.title} from NuVira Juice Co.`)}" />`, 'Open Graph image alt');
  html = html.replace(/\s*<meta\s+property="og:image:(?:width|height)"[^>]*>/gi, '');
  html = replaceRequired(html, /<meta\s+name="twitter:title"[^>]*>/i, `<meta name="twitter:title" content="${escapeHtml(metadata.fullTitle)}" />`, 'Twitter title');
  html = replaceRequired(html, /<meta\s+name="twitter:description"[^>]*>/i, `<meta name="twitter:description" content="${escapeHtml(metadata.description)}" />`, 'Twitter description');
  html = replaceRequired(html, /<meta\s+name="twitter:image"[^>]*>/i, `<meta name="twitter:image" content="${escapeHtml(metadata.image)}" />`, 'Twitter image');
  html = replaceRequired(html, /<meta\s+name="twitter:image:alt"[^>]*>/i, `<meta name="twitter:image:alt" content="${escapeHtml(`${product.title} from NuVira Juice Co.`)}" />`, 'Twitter image alt');
  html = replaceRequired(html, /\s*<\/head>/i, `\n${productMeta}\n  </head>`, 'closing head');
  html = replaceRequired(html, /\s*<div\s+id="root"><\/div>/i, `\n${noScriptSnapshot}\n    <div id="root"></div>`, 'application root');
  return html;
}

export function renderReturnPolicyCrawlerHtml(indexHtml) {
  const title = 'Refund & Return Policy | NuVira Juice Co.';
  const description = 'Review NuVira Juice Co. refund, replacement, cancellation, and food-return terms for local juice orders.';
  const policyMeta = `    <script type="application/ld+json" data-nuvira-return-policy-schema>${safeJsonLd(MERCHANT_RETURN_POLICY_SCHEMA)}</script>`;
  const noScriptSnapshot = [
    '    <noscript>',
    '      <main>',
    '        <h1>Refund &amp; Return Policy</h1>',
    `        <p>${escapeHtml(MERCHANT_RETURN_POLICY_CONTENT.qualityIssues)}</p>`,
    `        <p>${escapeHtml(MERCHANT_RETURN_POLICY_CONTENT.refundTiming)}</p>`,
    `        <p>${escapeHtml(MERCHANT_RETURN_POLICY_CONTENT.noPhysicalReturns)}</p>`,
    `        <p>${escapeHtml(MERCHANT_RETURN_POLICY_CONTENT.cancellations)}</p>`,
    '        <p><a href="mailto:support@nuvirajuice.com">Contact NuVira support</a></p>',
    '      </main>',
    '    </noscript>',
  ].join('\n');

  let html = String(indexHtml);
  html = replaceRequired(html, /<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`, 'title');
  html = replaceRequired(html, /<meta\s+name="description"[^>]*>/i, `<meta name="description" content="${escapeHtml(description)}" />`, 'description');
  html = replaceRequired(html, /<link\s+rel="canonical"[^>]*>/i, `<link rel="canonical" href="${MERCHANT_RETURN_POLICY_URL}" />`, 'canonical URL');
  html = replaceRequired(html, /<meta\s+property="og:url"[^>]*>/i, `<meta property="og:url" content="${MERCHANT_RETURN_POLICY_URL}" />`, 'Open Graph URL');
  html = replaceRequired(html, /<meta\s+property="og:title"[^>]*>/i, `<meta property="og:title" content="${escapeHtml(title)}" />`, 'Open Graph title');
  html = replaceRequired(html, /<meta\s+property="og:description"[^>]*>/i, `<meta property="og:description" content="${escapeHtml(description)}" />`, 'Open Graph description');
  html = replaceRequired(html, /<meta\s+name="twitter:title"[^>]*>/i, `<meta name="twitter:title" content="${escapeHtml(title)}" />`, 'Twitter title');
  html = replaceRequired(html, /<meta\s+name="twitter:description"[^>]*>/i, `<meta name="twitter:description" content="${escapeHtml(description)}" />`, 'Twitter description');
  html = replaceRequired(html, /\s*<\/head>/i, `\n${policyMeta}\n  </head>`, 'closing head');
  html = replaceRequired(html, /\s*<div\s+id="root"><\/div>/i, `\n${noScriptSnapshot}\n    <div id="root"></div>`, 'application root');
  return html;
}

export function renderDeliveryPolicyCrawlerHtml(indexHtml) {
  const title = 'Local Delivery Information | NuVira Juice Co.';
  const description = 'Review NuVira local delivery windows, address eligibility, delivery fees, order minimums, route review, and waitlist information.';
  const policyMeta = `    <script type="application/ld+json" data-nuvira-delivery-policy-schema>${safeJsonLd(DELIVERY_POLICY_SCHEMA)}</script>`;
  const windowItems = DELIVERY_WINDOWS.map(window => (
    `          <li>${escapeHtml(window.productionDay)} production; ${escapeHtml(window.deliveryDay)} ${escapeHtml(window.deliveryWindow)} delivery; standard cutoff ${escapeHtml(window.cutoff)}.</li>`
  )).join('\n');
  const zoneRows = DELIVERY_ZONE_SUMMARY.map(zone => (
    `            <tr><td>${escapeHtml(zone.distance)}</td><td>${escapeHtml(zone.fee)}</td><td>${escapeHtml(zone.minimum)}</td><td>${zone.review ? 'Route review' : 'Automatic'}</td></tr>`
  )).join('\n');
  const noScriptSnapshot = [
    '    <noscript>',
    '      <main>',
    '        <h1>Local Delivery Information</h1>',
    `        <p>${escapeHtml(DELIVERY_POLICY_CONTENT.schedule)}</p>`,
    `        <p>${escapeHtml(DELIVERY_POLICY_CONTENT.addressCheck)}</p>`,
    '        <h2>Regular production and delivery windows</h2>',
    '        <ul>',
    windowItems,
    '        </ul>',
    '        <h2>Delivery fees and order minimums</h2>',
    '        <table>',
    '          <thead><tr><th>Driving distance</th><th>Fee</th><th>Minimum</th><th>Availability</th></tr></thead>',
    '          <tbody>',
    zoneRows,
    '          </tbody>',
    '        </table>',
    `        <p>${escapeHtml(DELIVERY_POLICY_CONTENT.routeReview)}</p>`,
    `        <p>${escapeHtml(DELIVERY_POLICY_CONTENT.waitlist)}</p>`,
    `        <p>${escapeHtml(DELIVERY_POLICY_CONTENT.exceptions)}</p>`,
    '        <p><a href="/shop">Shop NuVira</a> <a href="/returns">Refund &amp; return policy</a></p>',
    '      </main>',
    '    </noscript>',
  ].join('\n');

  let html = String(indexHtml);
  html = replaceRequired(html, /<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`, 'title');
  html = replaceRequired(html, /<meta\s+name="description"[^>]*>/i, `<meta name="description" content="${escapeHtml(description)}" />`, 'description');
  html = replaceRequired(html, /<link\s+rel="canonical"[^>]*>/i, `<link rel="canonical" href="${DELIVERY_POLICY_URL}" />`, 'canonical URL');
  html = replaceRequired(html, /<meta\s+property="og:url"[^>]*>/i, `<meta property="og:url" content="${DELIVERY_POLICY_URL}" />`, 'Open Graph URL');
  html = replaceRequired(html, /<meta\s+property="og:title"[^>]*>/i, `<meta property="og:title" content="${escapeHtml(title)}" />`, 'Open Graph title');
  html = replaceRequired(html, /<meta\s+property="og:description"[^>]*>/i, `<meta property="og:description" content="${escapeHtml(description)}" />`, 'Open Graph description');
  html = replaceRequired(html, /<meta\s+name="twitter:title"[^>]*>/i, `<meta name="twitter:title" content="${escapeHtml(title)}" />`, 'Twitter title');
  html = replaceRequired(html, /<meta\s+name="twitter:description"[^>]*>/i, `<meta name="twitter:description" content="${escapeHtml(description)}" />`, 'Twitter description');
  html = replaceRequired(html, /\s*<\/head>/i, `\n${policyMeta}\n  </head>`, 'closing head');
  html = replaceRequired(html, /\s*<div\s+id="root"><\/div>/i, `\n${noScriptSnapshot}\n    <div id="root"></div>`, 'application root');
  return html;
}

export function productCrawlerSeoPages() {
  return {
    name: 'nuvira-product-crawler-seo-pages',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const indexAsset = bundle['index.html'];
      if (!indexAsset || indexAsset.type !== 'asset') {
        throw new Error('Product SEO build requires the generated index.html asset');
      }
      const canonicalIndexHtml = renderProductCanonicalRedirect(String(indexAsset.source));
      indexAsset.source = canonicalIndexHtml;

      for (const product of PUBLIC_PRODUCT_FALLBACKS) {
        const metadata = buildProductSeoMetadata(product);
        const source = renderProductCrawlerHtml(canonicalIndexHtml, product);
        this.emitFile({
          type: 'asset',
          fileName: `product/${metadata.slug}/index.html`,
          source,
        });
      }

      this.emitFile({
        type: 'asset',
        fileName: 'returns/index.html',
        source: renderReturnPolicyCrawlerHtml(canonicalIndexHtml),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'delivery/index.html',
        source: renderDeliveryPolicyCrawlerHtml(canonicalIndexHtml),
      });
    },
  };
}
