import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { PUBLIC_PRODUCT_FALLBACKS as catalog } from '../../src/lib/public-product-catalog.js';

const root = process.cwd();
const dist = path.join(root, 'dist');
const engine = process.env.PLAYWRIGHT_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const evidence = path.join(root, 'release-evidence/minimum-order-shopping', engine === 'webkit' ? 'webkit' : '');
await fs.mkdir(evidence, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Content-Security-Policy', "connect-src 'self'; img-src 'self' data: https://media.base44.com; frame-src 'none'");
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.includes('/entities/Product')) {
      const query = JSON.parse(url.searchParams.get('q') || '{}');
      const products = catalog.filter(product => Object.entries(query).every(([key, value]) => product[key] === value));
      const skip = Number(url.searchParams.get('skip') || 0);
      const limit = Number(url.searchParams.get('limit') || products.length);
      return res.end(JSON.stringify(products.slice(skip, skip + limit)));
    }
    if (/\/auth\/me|\/entities\/User\/me/.test(url.pathname)) { res.statusCode = 401; return res.end('{"error":"Anonymous preview"}'); }
    if (url.pathname.includes('/entities/')) return res.end('[]');
    // Preview traffic never proxies to production, including cart telemetry.
    res.statusCode = 501;
    return res.end('{"error":"Live services are disabled in this local preview."}');
  }
  let file = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
  if (!file.startsWith(`${dist}/`)) file = path.join(dist, 'index.html');
  try { if (!(await fs.stat(file)).isFile()) file = path.join(dist, 'index.html'); }
  catch { file = path.join(dist, 'index.html'); }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(await fs.readFile(file));
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(Number(process.env.PREVIEW_PORT || 4186), '127.0.0.1', resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes('--serve')) {
  console.log(`Local fixture preview (no live checkout or provider writes): ${origin}/product/oasis.html`);
} else {
  const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
  const browser = engine === 'webkit'
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const errors = [];
  const blocked = new Set();
  const checks = [];
  const oasis = catalog.find(product => product.slug === 'oasis');
  const aura = catalog.find(product => product.slug === 'aura');
  const shot = catalog.find(product => product.slug === 'hydration-shot');
  const cartItem = (product, quantity) => ({ ...product, product_id: product.id, quantity });
  async function open(viewport, items = [], route = '/product/oasis.html', theme = 'light') {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: theme });
    await context.route('**/*', request => {
      const url = new URL(request.request().url());
      if (url.origin === origin || (url.hostname === 'media.base44.com' && request.request().resourceType() === 'image')) return request.continue();
      blocked.add(url.hostname);
      return request.abort();
    });
    await context.addInitScript(({ items, theme }) => {
      localStorage.setItem('nuvira_cart', JSON.stringify(items));
      localStorage.setItem('theme', theme);
      for (const key of ['nuvira_analytics_consent_v1', 'nuvira_marketing_consent_v1', 'nuvira_google_ads_measurement_consent_v1']) localStorage.setItem(key, 'denied');
    }, { items, theme });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + route);
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    return { page, context };
  }
  async function fit(page, label) {
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label}: no horizontal overflow`);
    const bar = page.getByLabel('Purchase minimum', { exact: true });
    if (await bar.isVisible()) {
      const box = await bar.boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= page.viewportSize().height, `${label}: minimum visible`);
    }
    const checkout = page.getByRole('button', { name: /^(Checkout|Complete your mix above)$/ });
    if (await checkout.count()) {
      const box = await checkout.boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= page.viewportSize().height, `${label}: checkout action stays in viewport`);
      assert.equal(await checkout.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return element.closest('.fixed').contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), true, `${label}: checkout action not covered by navigation`);
    }
    checks.push(label);
  }
  try {
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
      const { page, context } = await open(viewport);
      await page.getByRole('button', { name: /Add 1 OASIS to cart/ }).waitFor();
      if (viewport.width >= 768) await page.getByRole('button', { name: /Add 1 OASIS to cart/ }).scrollIntoViewIfNeeded();
      await page.locator('img[data-approved-product-photo]').first().evaluate(img => img.decode());
      await fit(page, `product-${viewport.width}`);
      await page.screenshot({ path: path.join(evidence, `product-${viewport.width}.png`) });
      await page.getByRole('button', { name: /Add 1 OASIS to cart/ }).click();
      await page.getByRole('link', { name: 'Finish your mix' }).click();
      await page.getByRole('heading', { name: 'Choose 2 more juices' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Complete your mix above' }).isDisabled(), true);
      await page.getByRole('button', { name: 'Add one AURA for $13.00', exact: true }).click();
      await page.getByRole('heading', { name: 'Choose 1 more juice', exact: true }).waitFor();
      await fit(page, `cart-building-${viewport.width}`);
      await page.getByText('OASIS added to cart', { exact: true }).waitFor({ state: 'hidden' });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(evidence, `cart-building-${viewport.width}.png`) });
      await page.getByRole('button', { name: 'Add one RE-NU for $13.00', exact: true }).click();
      await page.getByRole('heading', { name: 'Order count minimum met' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Checkout', exact: true }).isEnabled(), true);
      await page.evaluate(() => scrollTo(0, 0));
      await fit(page, `cart-qualified-${viewport.width}`);
      await page.screenshot({ path: path.join(evidence, `cart-qualified-${viewport.width}.png`) });
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nuvira_cart')));
      assert.equal(stored.length, 3); assert.equal(stored.reduce((sum, item) => sum + item.price * item.quantity, 0), 39);
      await page.getByRole('button', { name: 'Decrease AURA quantity' }).click();
      await page.getByRole('heading', { name: 'Choose 1 more juice', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Complete your mix above' }).isDisabled(), true);
      await context.close();
    }
    for (const viewport of [
      { width: 320, height: 568 }, { width: 390, height: 844 },
      { width: 667, height: 375 }, { width: 844, height: 390 }, { width: 767, height: 1024 }, { width: 768, height: 1024 },
      { width: 820, height: 1180 }, { width: 1024, height: 768 },
      { width: 1280, height: 800 }, { width: 1440, height: 1000 }, { width: 1920, height: 1080 },
    ]) {
      for (const theme of ['light', 'dark']) {
        for (const route of ['/product/oasis.html', '/program/radiance']) {
          const { page, context } = await open(viewport, [], route, theme);
          const isProgram = route.includes('/program/');
          const action = page.getByRole('button', { name: isProgram ? /^Start My \d-Day Program$/ : /Add 1 OASIS to cart/ });
          await action.waitFor();
          const dock = page.locator('[data-purchase-placement="mobile-dock"]');
          const inline = page.locator('[data-purchase-placement="inline"]');
          const useDock = viewport.width < 768 && viewport.height >= viewport.width;
          assert.equal(await dock.isVisible(), useDock, 'Dock is limited to portrait phones');
          assert.equal(await inline.isVisible(), !useDock, 'Larger screens and landscape use in-flow purchase controls');
          assert.equal(await action.count(), 1, 'Exactly one accessible purchase action');
          if (!useDock) {
            assert.equal(await inline.evaluate(element => getComputedStyle(element).position), 'static');
            await action.scrollIntoViewIfNeeded();
          }
          await page.waitForTimeout(400);
          const box = await action.boundingBox();
          assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, 'Purchase action can be fully reached');
          assert.equal(await action.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
          }), true, 'Purchase action is not covered');
          assert.equal(await action.evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight), true, 'Purchase label fits its button');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal page overflow');
          const label = `responsive-${isProgram ? 'program' : 'product'}-${viewport.width}-${theme}`;
          await page.screenshot({ path: path.join(evidence, `${label}.png`) });
          checks.push(label);
          await context.close();
        }
      }
    }
    {
      const { page, context } = await open({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'Choose 3 bottles' }).click();
      await page.setViewportSize({ width: 667, height: 375 });
      await page.getByRole('button', { name: /Add 3 OASIS to cart for \$39.00/ }).click();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('nuvira_cart'))[0].quantity), 3);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'Increase quantity' }).click();
      await page.getByRole('button', { name: /Add 4 OASIS to cart for \$52.00/ }).waitFor();
      checks.push('rotation preserves quantity; in-flow purchase adds exactly once; phone stepper remains functional');
      await context.close();
    }
    for (const viewport of [{ width: 320, height: 568 }, { width: 820, height: 1180 }, { width: 1440, height: 1000 }]) {
      const { page, context } = await open(viewport, [], '/program/radiance');
      await page.getByRole('button', { name: /2 Days.*\$104.*8 bottles/ }).click();
      await page.getByRole('button', { name: 'Add one Radiance Shot', exact: true }).click();
      await page.getByRole('button', { name: 'Start My 2-Day Program', exact: true }).click();
      await page.getByRole('heading', { name: 'Order count minimum met' }).waitFor();
      const items = await page.evaluate(() => JSON.parse(localStorage.getItem('nuvira_cart')));
      const program = items.find(item => item.is_program);
      assert.equal(program.program_days, 2);
      assert.equal(program.price, 104);
      assert.equal(program.bottles_per_unit, 8);
      assert.equal(items.filter(item => item.category === 'shot').reduce((sum, item) => sum + item.quantity, 0), 1);
      checks.push(`program-${viewport.width}: selected duration and shot are preserved in cart`);
      await context.close();
    }
    {
      const { page, context } = await open({ width: 390, height: 844 }, [cartItem(oasis, 2), cartItem(shot, 1)], '/cart', 'dark');
      await page.getByRole('heading', { name: 'Choose 1 more shot', exact: true }).waitFor();
      await page.getByRole('tab', { name: 'Shots', exact: true }).click();
      await page.getByRole('button', { name: 'Add one Hydration Shot for $6.00', exact: true }).waitFor();
      await page.evaluate(() => scrollTo(0, 0));
      await fit(page, 'cart-mixed-shots-dark');
      await page.screenshot({ path: path.join(evidence, 'cart-mixed-shots-dark.png') });
      await page.getByRole('button', { name: 'Add one Hydration Shot for $6.00', exact: true }).click();
      await page.getByRole('heading', { name: 'Order count minimum met' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Checkout', exact: true }).isEnabled(), true);
      checks.push('mixed order: 2 juices + 2 shots qualifies');
      await context.close();
    }
    {
      const { page, context } = await open({ width: 390, height: 844 }, [], '/product/oasis.html');
      await page.getByRole('button', { name: 'Choose 3 bottles' }).click();
      await page.getByRole('button', { name: /Add 3 OASIS to cart for \$39.00/ }).waitFor();
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('nuvira_cart'))), []);
      await page.getByRole('link', { name: /Try all 3 with the Trio/ }).click();
      await page.getByRole('button', { name: /Add 1 .*Trio to cart/ }).click();
      await page.getByRole('link', { name: 'View cart', exact: true }).click();
      await page.getByRole('heading', { name: 'Order count minimum met' }).waitFor();
      const trio = await page.evaluate(() => JSON.parse(localStorage.getItem('nuvira_cart'))[0]);
      assert.equal(trio.quantity, 1); assert.equal(trio.bottles_per_unit, 3); assert.equal(trio.price, 36);
      assert.equal(trio.bundle_composition.length, 3);
      checks.push('quantity shortcut does not add silently; product navigation resets quantity; Trio shortcut works');
      await context.close();
    }
    {
      const { page, context } = await open({ width: 390, height: 844 }, [cartItem(aura, 1)], '/cart');
      await page.route('**/entities/Product**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic catalog unavailable"}' }));
      await page.reload();
      await page.getByText('Available drinks could not load.').waitFor();
      assert.equal(await page.getByRole('button', { name: /Add one/ }).count(), 0);
      await page.unroute('**/entities/Product**');
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.getByRole('button', { name: 'Add one AURA for $13.00', exact: true }).waitFor();
      checks.push('catalog failure fails closed; retry recovers without fallback selling');
      await context.close();
    }
    assert.deepEqual(errors, []);
    const result = { ok: true, engine, checks, page_errors: errors, blocked_external_hosts: [...blocked],
      fixture_catalog: true, real_production_calls: 0, real_orders: 0, live_payments: 0,
      limitation: 'Built web app with local API fixtures. Not a live provider, native-device, or revenue validation.' };
    await fs.writeFile(path.join(evidence, 'browser-results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
