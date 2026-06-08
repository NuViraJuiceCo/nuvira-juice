#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const bottleSource = fs.readFileSync(path.join(repoRoot, 'base44/functions/bottleNativeProductionShopifyOrderForCustomerApp/entry.ts'), 'utf8');
const cascadeSource = fs.readFileSync(path.join(repoRoot, 'base44/functions/previewNativeProductionVerifyCascades/entry.ts'), 'utf8');
const syncHealthSource = fs.readFileSync(path.join(repoRoot, 'src/pages/admin/SyncHealth.jsx'), 'utf8');

assert.equal(bottleSource.includes('function writeSafetyResult'), true, 'bottle command should have an explicit write safety helper');
assert.equal(bottleSource.includes('writeSafetyResult({ native_shopify_order_updated: true, shopify_order_bottled: true })'), true, 'successful writes should mark nested safety writes_performed true');
assert.equal(/result:\s*{[\s\S]*\.\.\.writeSafetyResult\(\{ native_shopify_order_updated: true, shopify_order_bottled: true \}\)[\s\S]*writes_performed:\s*true[\s\S]*patch_marker:\s*G31Z_MARKER[\s\S]*}/m.test(bottleSource), true, 'success CommandLog result should retain writes_performed true');
assert.equal(/result:\s*{[\s\S]*writes_performed:\s*true[\s\S]*\.\.\.safetyResult\(\{ native_shopify_order_updated: true, shopify_order_bottled: true \}\)/m.test(bottleSource), false, 'safetyResult must not overwrite success CommandLog writes_performed');

assert.equal(cascadeSource.includes('shopify_order_bottle_already_satisfied'), true, 'cascade preview should expose already-bottled state');
assert.equal(cascadeSource.includes('post_verify_cascades_already_satisfied_customer_status_held'), true, 'cascade preview should not plan bottle again after bottle is satisfied');
assert.equal(cascadeSource.includes('would_update_native_shopify_order: bottleCommandAvailable'), true, 'already-bottled preview should not project a ShopifyOrder write');

assert.equal(syncHealthSource.includes('orderBottleAlreadySatisfied'), true, 'SyncHealth should distinguish bottled from ready');
assert.equal(syncHealthSource.includes('Order already bottled'), true, 'SyncHealth should show already-bottled copy');
assert.equal(syncHealthSource.includes('Bottle deduped'), true, 'SyncHealth should show bottle dedupe copy');

console.log('G32B native ShopifyOrder bottle audit cleanup tests passed');
