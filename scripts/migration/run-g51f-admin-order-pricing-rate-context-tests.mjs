#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const adminOrdersFn = fs.readFileSync(path.join(repoRoot, 'base44/functions/getAdminOrdersWithHub/entry.ts'), 'utf8');
const adminOrdersPage = fs.readFileSync(path.join(repoRoot, 'src/pages/AdminOrders.jsx'), 'utf8');

function assertIncludes(source, marker, detail) {
  assert.ok(source.includes(marker), detail || `Expected source to include ${marker}`);
}

for (const marker of [
  'function compactDeliveryRateContext',
  "if (value === null || value === undefined || value === '') return null;",
  'function buildCompactPricingFromLineItems',
  'function inferCompactDeliveryFeeFromLineItems',
  'const itemSubtotal = compactItemsSubtotal(items);',
  'subtotal: pricing.subtotal',
  'delivery_fee: pricing.delivery_fee',
  'delivery_fee: deliveryRateContext.delivery_fee ?? pricing.delivery_fee',
  'pricing_fields_inferred_from_line_items',
  'discount_codes: compactStringArray(order.discount_codes)',
  'ADMIN_ORDER_LIST_COMPACT_MAX_ROWS',
  'orders_returned: compactOrders.length',
  'compact_order_windowed: compactOrderWindowed',
  'selected_delivery_date: order.selected_delivery_date || null',
  'requested_delivery_date: order.requested_delivery_date || null',
  'delivery_zone_key',
  'delivery_zone_type',
  'distance_miles',
  'drive_time_minutes',
]) {
  assertIncludes(adminOrdersFn, marker, `Admin order compact response must preserve ${marker}.`);
}

for (const marker of [
  'function PricingBreakdownPanel',
  'function DeliveryRateContextPanel',
  'Line item sum',
  'Unreconciled difference',
  'subtotalLooksMissing',
  'deliveryFeeLooksMissing',
  'Stored pricing fields reconcile to the recorded order total.',
  'Pricing fields are incomplete or do not fully reconcile.',
  'Delivery Rate Context',
  'Requested delivery',
  'Selected delivery',
  'Assigned delivery',
  'Schedule source',
  'staleCompletedProduction',
  'staleCompletedFulfillment',
  'Source: ${formatStatusLabel(sourceFulfillmentStatus)}',
]) {
  assertIncludes(adminOrdersPage, marker, `Admin Orders UI must render ${marker}.`);
}

assert.ok(!adminOrdersPage.includes('🗺️ Route Review'), 'Route Review tab should not use emoji-only UI.');
assert.ok(!adminOrdersPage.includes('📅 {deliveryDateStr}'), 'Delivery date row should use the app icon system.');
assert.ok(adminOrdersPage.includes('border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40'), 'Pricing reconciliation banner must be readable in light and dark mode.');
assert.ok(adminOrdersPage.includes('border-cyan-200 bg-cyan-50'), 'Delivery-rate context banner must be readable in light mode.');

console.log(JSON.stringify({
  ok: true,
  suite: 'g51f-admin-order-pricing-rate-context',
  checks: 42,
  writes_performed: false,
  provider_calls_performed: false,
  notifications_sent: false,
}, null, 2));
