/**
 * G40D — Mobile Safe-Area / Accessibility Layout Tests
 *
 * Validates that the shared safe-area header pattern is in place and no page
 * header starts at top:0 / pt-N without env(safe-area-inset-top) coverage.
 *
 * Run:
 *   node --check scripts/migration/run-g40d-mobile-safe-area-layout-tests.mjs
 *   node scripts/migration/run-g40d-mobile-safe-area-layout-tests.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../src');

// ─── helpers ────────────────────────────────────────────────────────────────

function read(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅  ${name}`);
    passed++;
  } else {
    console.error(`  ❌  ${name}${detail ? `\n       → ${detail}` : ''}`);
    failed++;
    failures.push(name);
  }
}

// ─── test cases ─────────────────────────────────────────────────────────────

console.log('\nG40D — Mobile Safe-Area Layout Tests\n');

// 1. Shared helper exists and exports SAFE_TOP_PADDING
const helperSrc = read('components/layout/MobilePageHeader.jsx');
assert(
  '1. MobilePageHeader.jsx exists',
  helperSrc !== null,
);
assert(
  '1b. SAFE_TOP_PADDING constant exported',
  helperSrc !== null && helperSrc.includes('export const SAFE_TOP_PADDING'),
);
assert(
  '1c. SAFE_TOP_PADDING uses env(safe-area-inset-top)',
  helperSrc !== null && helperSrc.includes('env(safe-area-inset-top)'),
);
assert(
  '1d. MobilePageHeader uses sticky + top-0 with safe-area paddingTop',
  helperSrc !== null && helperSrc.includes('sticky top-0') && helperSrc.includes('paddingTop: SAFE_TOP_PADDING'),
);
assert(
  '1e. SafeAreaTop helper exported',
  helperSrc !== null && helperSrc.includes('export function SafeAreaTop'),
);

// 2. Events.jsx uses MobilePageHeader (not raw sticky top-0 with py-3 only)
const eventsSrc = read('pages/Events.jsx') || read('pages/Events.js');
assert(
  '2. Events.jsx imports MobilePageHeader',
  eventsSrc !== null && eventsSrc.includes('MobilePageHeader'),
);
assert(
  '2b. Events.jsx does NOT have raw sticky header without safe-area',
  eventsSrc !== null && !eventsSrc.includes("sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3"),
);
assert(
  '2c. Events.jsx uses MobilePageHeader component in JSX',
  eventsSrc !== null && eventsSrc.includes('<MobilePageHeader'),
);

// 3. OrderTracker uses SAFE_TOP_PADDING on colored header
const trackerSrc = read('pages/OrderTracker.jsx') || read('pages/OrderTracker.js');
assert(
  '3. OrderTracker.jsx imports SAFE_TOP_PADDING',
  trackerSrc !== null && trackerSrc.includes('SAFE_TOP_PADDING'),
);
assert(
  '3b. OrderTracker colored header uses paddingTop: SAFE_TOP_PADDING (not hardcoded pt-10 only)',
  trackerSrc !== null && trackerSrc.includes('paddingTop: SAFE_TOP_PADDING'),
);
assert(
  '3c. OrderTracker does NOT have raw pt-10 on a gradient header without safe-area',
  trackerSrc !== null && !trackerSrc.includes('bg-nuvira-gradient px-4 pt-10'),
);
assert(
  '3d. OrderTracker muted/cancelled header also uses SAFE_TOP_PADDING',
  trackerSrc !== null && (trackerSrc.match(/SAFE_TOP_PADDING/g) || []).length >= 3,
);

// 4. OrderConfirmation loading state has paddingTop safe-area
const confirmSrc = read('pages/OrderConfirmation.jsx') || read('pages/OrderConfirmation.js');
assert(
  '4. OrderConfirmation loading container has shared safe-area top padding',
  confirmSrc !== null &&
    confirmSrc.includes("import { SAFE_TOP_PADDING }") &&
    confirmSrc.includes('paddingTop: SAFE_TOP_PADDING'),
);
assert(
  '4b. OrderConfirmation final/empty/timeout states also use shared safe-area top padding',
  confirmSrc !== null && (confirmSrc.match(/paddingTop: SAFE_TOP_PADDING/g) || []).length >= 4,
);

// 5. Home page header safe-area is unchanged (regression guard)
const homeSrc = read('pages/Home.jsx') || read('pages/Home.js');
assert(
  '5. Home header still uses env(safe-area-inset-top)',
  homeSrc !== null && homeSrc.includes('env(safe-area-inset-top)'),
);
assert(
  '5b. Home does NOT import MobilePageHeader (no double-padding)',
  homeSrc !== null && !homeSrc.includes('MobilePageHeader'),
);

// 6. MobilePageHeader back button meets 44px tap target (w-11 h-11 = 44px)
assert(
  '6. Back button in MobilePageHeader uses w-11 h-11 (44px tap target)',
  helperSrc !== null && helperSrc.includes('w-11 h-11'),
);

// 7. No fixed header at top:0 without safe-area in AppLayout
const layoutSrc = read('components/layout/AppLayout.jsx') || read('components/layout/AppLayout.js');
assert(
  '7. AppLayout has no fixed/sticky header starting at top:0 without safe-area',
  // AppLayout uses <main> with pb-24 — no fixed header at top, so this is fine
  layoutSrc !== null && !layoutSrc.includes("sticky top-0") && !layoutSrc.includes("fixed top-0"),
);

// 8. MobileNav bottom safe-area unchanged
const navSrc = read('components/layout/MobileNav.jsx') || read('components/layout/MobileNav.js');
assert(
  '8. MobileNav still uses env(safe-area-inset-bottom)',
  navSrc !== null && navSrc.includes('env(safe-area-inset-bottom)'),
);

// 9. No customer PII, no backend calls, no mutations in patched files
const patchedFiles = [helperSrc, eventsSrc, trackerSrc, confirmSrc].filter(Boolean).join('\n');
assert(
  '9. No Stripe/Shopify/Hub/provider calls in patched files',
  !patchedFiles.includes('stripe.') &&
  !patchedFiles.includes('Shopify.') &&
  !patchedFiles.includes('hub_api') &&
  !patchedFiles.includes('HUB_API_URL'),
);
assert(
  '9b. No entity writes (.create / .update / .delete) in patched files',
  !patchedFiles.includes('.create(') &&
  !patchedFiles.includes('.update(') &&
  !patchedFiles.includes('.delete('),
  'Patched UI files should not contain entity mutations',
);

// 10. No raw PII in source files
assert(
  '10. No raw email/customer PII hardcoded in layout helper',
  helperSrc !== null && !helperSrc.includes('@') && !helperSrc.includes('customer_email'),
);

// ─── summary ─────────────────────────────────────────────────────────────────

console.log(`\n──────────────────────────────────────────`);
console.log(`G40D Results: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log(`\nFailed tests:`);
  failures.forEach(f => console.log(`  • ${f}`));
}
console.log(`──────────────────────────────────────────\n`);

if (failed > 0) process.exit(1);
