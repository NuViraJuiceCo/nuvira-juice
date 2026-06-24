#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const repoRoot = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const embeddedPayment = read('src/components/checkout/EmbeddedPayment.jsx');
const checkout = read('src/pages/Checkout.jsx');
const adminOrders = read('src/pages/AdminOrders.jsx');
const css = read('src/index.css');

assert.match(
  css,
  /padding-top:\s*max\(3\.75rem,\s*calc\(env\(safe-area-inset-top\) \+ 0\.75rem\)\);/,
  'Admin header must have a hard native-safe top padding floor when env(safe-area-inset-top) is unavailable.'
);

assert.match(
  adminOrders,
  /flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between/,
  'Live customer context header must stack on mobile instead of squeezing metrics into the title row.'
);

assert.match(
  adminOrders,
  /grid w-full grid-cols-3 gap-2 text-center sm:w-auto sm:min-w-\[12rem\]/,
  'Live customer context metrics need a full-width mobile grid and a desktop minimum width.'
);

assert.match(
  adminOrders,
  /Pickup \/ POS/,
  'Pickup/POS label must be spaced so it can wrap cleanly on narrow screens.'
);

assert.match(
  embeddedPayment,
  /showWalletDiagnostics = false/,
  'EmbeddedPayment must keep wallet diagnostics off unless a caller explicitly enables them.'
);

assert.match(
  checkout,
  /showWalletDiagnostics=\{user\?\.role === 'admin' \|\| user\?\.role === 'owner'\}/,
  'Checkout must expose wallet diagnostics only for admin/owner sessions.'
);

assert.match(
  embeddedPayment,
  /Native shell:/,
  'Wallet debug output must include whether the checkout is running inside the native shell.'
);

assert.match(
  embeddedPayment,
  /Protocol:/,
  'Wallet debug output must include the origin protocol for capacitor:// versus https:// analysis.'
);

assert.doesNotMatch(
  embeddedPayment,
  /clientSecret\.split\('_secret_'\)|<span className="font-semibold">PI:<\/span>|PaymentIntent ID/,
  'Wallet debug output must not expose PaymentIntent ids or client secret fragments.'
);

assert.match(
  embeddedPayment,
  /PaymentIntent client secret:<\/span> present/,
  'Wallet debug output should disclose only that a client secret exists, not its value or id.'
);

console.log(JSON.stringify({
  ok: true,
  suite: 'g51c-wallet-admin-layout-tests',
  git_commit: process.env.GIT_COMMIT || null,
  generated_at_utc: new Date().toISOString(),
}, null, 2));
