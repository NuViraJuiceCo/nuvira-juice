// Actual React checkout, touch-capable Chromium/WebKit. All providers are synthetic.
import assert from 'node:assert/strict';
const { chromium, webkit } = await import(process.env.NUVIRA_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.NUVIRA_CHECKOUT_TEST_URL || 'http://127.0.0.1:5187/';
assert.equal(new URL(base).hostname, '127.0.0.1', 'Only an isolated local fixture is permitted');
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await browserType.launch(engine === 'chromium' ? { channel: 'chrome' } : {});
  try {
    for (const mode of ['guest', 'member']) {
      console.log(`Testing ${engine}/${mode}`);
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      await page.goto(`${base}?mode=${mode}&theme=dark`);
      if (mode === 'guest') {
        for (const [name, value] of Object.entries({ 'Email for receipt and delivery updates': 'guest@example.invalid', 'First name': 'Test', 'Last name': 'Guest', 'Phone Number': '2025550101' })) {
          await page.getByRole('textbox', { name, exact: true }).fill(value);
        }
        await page.getByRole('button', { name: 'Continue to delivery →' }).tap();
      } else {
        await page.getByRole('button', { name: 'Edit address' }).tap();
      }
      const street = page.getByRole('textbox', { name: 'Street address', exact: true });
      const suggestions = page.getByRole('list', { name: 'Google-verified address suggestions' });
      const validate = async () => {
        await page.waitForFunction(() => document.querySelector('input[name="streetAddress"]')?.value === '123 Example St', null, { timeout: 1500 });
        for (const [name, value] of Object.entries({ 'Street address': '123 Example St', City: 'Wentzville', State: 'MO', 'ZIP code': '63385' })) {
          check(await page.getByRole('textbox', { name, exact: true }).inputValue() === value, `${engine}/${mode}: selection fills ${name}`);
        }
        check(await suggestions.count() === 0, `${engine}/${mode}: selected list closes`);
      };
      await street.fill('123 Example');
      const option = suggestions.getByRole('button');
      await option.waitFor();
      await option.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: 30, clientY: 30 });
      await option.dispatchEvent('pointermove', { pointerId: 7, pointerType: 'touch', clientX: 30, clientY: 60 });
      await option.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: 30, clientY: 60 });
      check(await street.inputValue() === '123 Example', `${engine}/${mode}: scroll gesture does not select`);
      await option.dispatchEvent('pointerdown', { pointerId: 8, pointerType: 'touch', clientX: 30, clientY: 30 });
      await option.dispatchEvent('pointercancel', { pointerId: 8, pointerType: 'touch' });
      await option.dispatchEvent('pointerup', { pointerId: 8, pointerType: 'touch', clientX: 30, clientY: 30 });
      check(await street.inputValue() === '123 Example', `${engine}/${mode}: cancelled tap does not select`);
      await suggestions.getByRole('button').tap();
      await validate();
      await page.getByText('✓ Local delivery available.').waitFor();
      check(await page.getByRole('button', { name: 'Continue to payment →' }).isEnabled(), `${engine}/${mode}: delivery eligibility can proceed`);
      check(await page.getByRole('button', { name: /Wednesday, September 9/ }).getAttribute('aria-pressed') === 'true', `${engine}/${mode}: Wednesday preserved`);

      await street.fill('123 Example');
      await suggestions.getByRole('button').waitFor();
      await street.press('ArrowDown');
      check(await suggestions.getByRole('button').evaluate(button => button === document.activeElement), `${engine}/${mode}: suggestion keyboard reachable`);
      await page.keyboard.press('Enter');
      await validate();

      // Hold a second response while selecting the already-visible first result.
      await street.fill('123 Example');
      await suggestions.getByRole('button').waitFor();
      await page.evaluate(() => { window.__addressLookup = () => new Promise(resolve => { window.__resolveAddress = resolve; }); });
      await street.fill('123 Example pending');
      await page.waitForFunction(() => Boolean(window.__resolveAddress));
      await suggestions.getByRole('button').tap();
      await validate();
      await page.evaluate(() => window.__resolveAddress({ data: { suggestions: [{ street: 'Wrong stale street', city: 'Old city', state: 'CA', zip: '90001' }] } }));
      await page.waitForTimeout(500);
      await validate();

      // Clearing the query invalidates an already-running lookup as well.
      await page.evaluate(() => { delete window.__resolveAddress; });
      await street.fill('Another pending street');
      await page.waitForFunction(() => Boolean(window.__resolveAddress));
      await street.fill('');
      await page.evaluate(() => window.__resolveAddress({ data: { suggestions: [{ street: 'Wrong stale street', city: 'Old city', state: 'CA', zip: '90001' }] } }));
      await page.waitForTimeout(500);
      check(await suggestions.count() === 0 && await street.inputValue() === '', `${engine}/${mode}: cleared query stays cleared`);
      for (const name of ['City', 'State', 'ZIP code']) check(await page.getByRole('textbox', { name, exact: true }).inputValue() === '', `${engine}/${mode}: edited street clears stale ${name}`);
      await page.evaluate(() => { delete window.__addressLookup; });
      await street.fill('123 Example');
      await suggestions.getByRole('button').waitFor();
      await street.press('Escape');
      check(await suggestions.count() === 0, `${engine}/${mode}: Escape closes suggestions`);
      await street.fill('123 Example manual');
      await suggestions.getByRole('button').waitFor();
      await page.getByRole('heading', { name: 'Checkout', exact: true }).tap();
      check(await suggestions.count() === 0, `${engine}/${mode}: outside touch closes suggestions`);
      for (const [name, value] of Object.entries({ City: 'Wentzville', State: 'MO', 'ZIP code': '63385' })) await page.getByRole('textbox', { name, exact: true }).fill(value);
      await page.getByText('✓ Local delivery available.').waitFor();
      check(await page.getByRole('button', { name: 'Continue to payment →' }).isEnabled(), `${engine}/${mode}: manual fallback works`);
      check((await page.evaluate(() => window.__checkoutCalls)).every(call => !call.name.endsWith('.create') && !call.name.endsWith('.update') && call.name !== 'createPaymentIntent'), `${engine}/${mode}: no order/payment/profile writes`);
      check(errors.length === 0, `${engine}/${mode}: no runtime errors: ${errors.join('; ')}`);
      await context.close();
    }
  } finally { await browser.close(); }
}
console.log(JSON.stringify({ suite: 'g175-address-touch', checks, passed: true, engines: ['chromium', 'webkit'], productionWrites: 0, providerCalls: 0 }));
