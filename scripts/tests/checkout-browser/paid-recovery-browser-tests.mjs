import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { chromium } = await import(process.env.NUVIRA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = []; let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const dir = process.env.NUVIRA_PAID_RECOVERY_EVIDENCE || '../paid-recovery-browser-evidence';
await fs.mkdir(dir, { recursive: true });
const open = async (query, width = 390) => {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(`${process.env.NUVIRA_CHECKOUT_TEST_URL || 'http://127.0.0.1:5196/'}?view=paid-recovery&${query}`);
  await page.getByRole('button', { name: 'Check payment status', exact: true }).waitFor();
  return page;
};
try {
  for (const theme of ['light', 'dark']) for (const width of [320, 390, 768, 1280]) {
    const page = await open(`mode=guest&theme=${theme}`, width);
    await page.getByText('Order total: $42.99').waitFor();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme}/${width} no overflow`);
    check(await page.getByRole('button', { name: 'Resume this secure payment' }).isVisible(), `${theme}/${width} explicit resume`);
    check((await page.evaluate(() => window.__checkoutCalls)).length === 1, 'no automatic payment retry');
    if (width === 390) await page.screenshot({ path: `${dir}/${theme}-mobile.png`, fullPage: true });
    await page.close();
  }
  const page = await open('mode=member&theme=dark');
  await page.getByRole('button', { name: 'Resume this secure payment' }).click();
  await page.getByRole('textbox', { name: 'Synthetic card number' }).waitFor();
  await page.getByRole('button', { name: 'Pay $42.99', exact: true }).click();
  await page.getByText('Synthetic declined card. No payment was attempted.', { exact: true }).waitFor();
  check((await page.evaluate(() => window.__checkoutCalls)).every(call => call.data.mode), 'resume never invokes payment preparation');
  await page.getByRole('button', { name: 'Cancel this attempt and edit my cart' }).click();
  await page.getByText('Verified cancellation callback', { exact: true }).waitFor();
  check(true, 'confirmed cancellation reaches parent'); await page.close();
  for (const state of ['processing', 'requires_capture', 'succeeded']) {
    const current = await open(`state=${state}&mode=guest`);
    check(await current.getByRole('button', { name: 'Resume this secure payment' }).count() === 0, `${state} cannot pay again`);
    check(await current.getByRole('button', { name: 'Cancel this attempt and edit my cart' }).count() === 0, `${state} cannot cancel`);
    await current.getByRole('button', { name: 'View this order’s receipt' }).click();
    await current.getByText('Receipt navigation callback', { exact: true }).waitFor(); await current.close();
  }
  for (const scenario of ['recovery-offline', 'release-failure']) {
    const current = await open(`scenario=${scenario}`);
    if (scenario === 'release-failure') await current.getByRole('button', { name: 'Cancel this attempt and edit my cart' }).click();
    await current.getByText(/We could not confirm this checkout action/).waitFor();
    check(await current.getByLabel('Fixture outcome').innerText() === '', `${scenario} never unlocks`);
    await current.close();
  }
  check(errors.length === 0, JSON.stringify(errors));
  await fs.writeFile(`${dir}/result.json`, JSON.stringify({ ok: true, checks, page_errors: errors,
    scope: 'actual recovery component with synthetic transport and Stripe fields; all external requests aborted',
    production_writes: false, provider_calls: false }, null, 2));
  console.log(`Paid recovery browser: ${checks} checks passed; no live/provider connections.`);
} finally { await browser.close(); }
