import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as selection from '../../src/lib/rewardSelection.js';

let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS', name); }
const read = path => fs.readFileSync(path, 'utf8');
const reward = { id: 'reward-test', title: 'Free Add-On Bottle', reward_type: 'free_bottle', points_required: 1000, is_active: true };
const product = { id: 'product-test', title: 'OASIS', category: 'juice', size: '12 oz', price: 13, is_available: true };
const email = 'buyer@example.test';
const request = body => new Request('https://unit.test/claim', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
function loadHandler(path, { user = { email }, catalog = [reward], points = [{ id: 'points-test', total_points: 1000, claimed_rewards: [] }] } = {}) {
  const writes = [];
  let served;
  const module = { exports: {} };
  const db = {
    auth: { me: async () => user },
    asServiceRole: { entities: {
      RewardTier: { filter: async query => catalog.filter(row => row.id === query.id && row.is_active === query.is_active) },
      UserPoints: { filter: async () => points, update: async (id, data) => { writes.push({ id, data }); Object.assign(points.find(p => p.id === id), data); } },
    } },
  };
  vm.runInNewContext(transformSync(read(path), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, Request, Response, console: { log() {}, warn() {}, error() {} },
    Deno: { serve: fn => { served = fn; } },
    require: name => { if (name.includes('@base44/sdk')) return { createClientFromRequest: () => db }; throw new Error(name); },
    fetch: () => { throw new Error('Network forbidden'); },
  });
  return { handle: served || module.exports.default, writes };
}
const payload = { email, reward_id: reward.id, reward_title: reward.title, reward_type: reward.reward_type };

for (const path of ['base44/functions/claimReward/entry.ts', 'base44/functions/getCustomerAccountDashboardData/handlers/claimReward/entry.ts']) {
  const label = path.includes('/handlers/') ? 'gateway' : 'compatibility';
  for (const [name, options, body, status] of [
    ['anonymous', { user: null }, payload, 401],
    ['cross-customer', {}, { ...payload, email: 'other@example.test' }, 403],
    ['missing identifier', {}, { ...payload, reward_id: '' }, 400],
    ['inactive', { catalog: [{ ...reward, is_active: false }] }, payload, 404],
    ['changed title', {}, { ...payload, reward_title: 'Other' }, 409],
    ['changed type', {}, { ...payload, reward_type: 'free_shot' }, 409],
    ['insufficient points', { points: [{ id: 'points-test', total_points: 999 }] }, payload, 409],
    ['missing points', { points: [] }, payload, 404],
    ['duplicate balance', { points: [{ total_points: 1000 }, { total_points: 1000 }] }, payload, 409],
    ['non-finite balance', { points: [{ total_points: 'bad' }] }, payload, 409],
    ['negative balance', { points: [{ total_points: -1 }] }, payload, 409],
    ['points held by another checkout', { points: [{ total_points: 1000, reserved_points: 1 }] }, payload, 409],
    ['invalid reserved balance', { points: [{ total_points: 1000, reserved_points: 1001 }] }, payload, 409],
  ]) await test(`${label}: ${name} rejected before write`, async () => {
    const ctx = loadHandler(path, options); const res = await ctx.handle(request(body));
    assert.equal(res.status, status); assert.equal(ctx.writes.length, 0);
  });
  for (const value of [0, -1, 1.2, 'bad', null, undefined]) await test(`${label}: malformed points cost ${value}`, async () => {
    const ctx = loadHandler(path, { catalog: [{ ...reward, points_required: value }] });
    assert.equal((await ctx.handle(request(payload))).status, 409); assert.equal(ctx.writes.length, 0);
  });
  await test(`${label}: validation is read-only and ignores tampered client cost`, async () => {
    const ctx = loadHandler(path); const res = await ctx.handle(request({ ...payload, validate_only: true, points_required: 1 }));
    const data = await res.json(); assert.equal(res.status, 200); assert.equal(data.points_required, 1000);
    assert.equal(data.validated_only, true); assert.equal(data.writes_performed, false); assert.equal(ctx.writes.length, 0);
  });
  await test(`${label}: enough unreserved points remain selectable`, async () => {
    const ctx = loadHandler(path, { points: [{ id: 'points-test', total_points: 1500, reserved_points: 500 }] });
    const res = await ctx.handle(request({ ...payload, validate_only: true }));
    assert.equal(res.status, 200); assert.equal(ctx.writes.length, 0);
  });
  await test(`${label}: valid selection and replay do not debit or duplicate`, async () => {
    const points = [{ id: 'points-test', total_points: 1000, claimed_rewards: [] }];
    const ctx = loadHandler(path, { points });
    assert.equal((await ctx.handle(request(payload))).status, 200);
    const second = await (await ctx.handle(request(payload))).json();
    assert.equal(second.already_selected, true); assert.equal(ctx.writes.length, 1);
    assert.equal(points[0].total_points, 1000); assert.equal(points[0].claimed_rewards.length, 1);
    assert.equal(points[0].claimed_rewards[0].status, 'selected_pending_checkout');
  });
}
await test('canonical selection rejects failure, missing catalog ID, wrong details and zero cost', () => {
  const data = { success: true, reward_id: reward.id, reward_title: reward.title, reward_type: reward.reward_type, points_required: 1000 };
  assert.equal(selection.canonicalRewardSelection(data, reward).points_required, 1000);
  for (const patch of [{ success: false }, { reward_id: 'different' }, { reward_type: 'bundle' }, { reward_title: 'other' }, { points_required: 0 }, { points_required: NaN }]) {
    assert.throws(() => selection.canonicalRewardSelection({ ...data, ...patch }, reward));
  }
  assert.throws(() => selection.canonicalRewardSelection(data, { ...reward, id: undefined }));
});
await test('picker enforces actual 12oz juice and 2oz shot sizes', () => {
  assert.equal(selection.rewardProductEligible(reward, product), true);
  for (const patch of [{ size: '32 oz' }, { size: '' }, { category: 'bundle' }, { is_available: false }]) {
    assert.equal(selection.rewardProductEligible(reward, { ...product, ...patch }), false);
  }
  const shot = { ...product, category: 'shot', size: '2oz' };
  assert.equal(selection.rewardProductEligible({ ...reward, reward_type: 'free_shot' }, shot), true);
  assert.equal(selection.rewardProductEligible(reward, shot), false);
});
await test('one earned line preserves canonical identity and replaces only earned lines', () => {
  const line = selection.earnedRewardCartItem(reward, product);
  assert.equal(line.product_id, product.id); assert.equal(line.price, 0); assert.equal(line.quantity, 1);
  assert.notEqual(line.cart_line_key, product.id); assert.equal(line.reward_id, reward.id);
  const paid = { product_id: product.id, quantity: 2, price: 13 };
  const birthday = { product_id: '__birthday_reward__', isBirthdayReward: true };
  const legacy = { product_id: '__free_reward_old__', isFreeReward: true };
  let cart = selection.replaceEarnedRewardItem([paid, birthday, legacy], line);
  cart = selection.replaceEarnedRewardItem(cart, line);
  assert.deepEqual(cart, [paid, birthday, line]);
  assert.deepEqual(selection.replaceEarnedRewardItem(cart), [paid, birthday]);
});
await test('actual Rewards apply handler does not show success or mutate cart on failed claim', async () => {
  const source = read('src/pages/Rewards.jsx');
  const body = source.slice(source.indexOf('  const handleApplyReward ='), source.indexOf('  const handleFreeProductSelect ='));
  const effects = []; const refs = { current: false };
  const ctx = { rewardSelectionRef: refs, currentEmailRef: { current: email }, user: { email },
    setIsSelectingReward: () => {}, selectActiveReward: async () => { throw new Error('Insufficient points'); },
    localStorage: { setItem: () => effects.push('stored') }, clearEarnedRewardItems: () => effects.push('cart'),
    setActiveReward: () => effects.push('active'), setPendingReward: () => effects.push('pending'), setPickerOpen: () => effects.push('picker'),
    trackGoogleRetentionEvent: () => effects.push('event'), toast: { success: () => effects.push('success'), error: () => effects.push('error') },
  };
  vm.createContext(ctx); vm.runInContext(body + '\nthis.apply = handleApplyReward;', ctx);
  await ctx.apply(reward); assert.deepEqual(effects, ['error']); assert.equal(refs.current, false);
});
await test('actual Rewards handler suppresses a late claim after sign-in changes', async () => {
  const source = read('src/pages/Rewards.jsx');
  const body = source.slice(source.indexOf('  const handleApplyReward ='), source.indexOf('  const handleFreeProductSelect ='));
  const effects = []; const ctx = { rewardSelectionRef: { current: false }, currentEmailRef: { current: 'other@example.test' }, user: { email },
    setIsSelectingReward: () => {}, selectActiveReward: async () => reward,
    localStorage: { setItem: () => effects.push('stored') }, clearEarnedRewardItems: () => effects.push('cart'),
    setActiveReward: () => effects.push('active'), setPendingReward: () => effects.push('pending'), setPickerOpen: () => effects.push('picker'),
    trackGoogleRetentionEvent: () => effects.push('event'), toast: { success: () => effects.push('success'), error: () => effects.push('error') },
  };
  vm.createContext(ctx); vm.runInContext(body + '\nthis.apply = handleApplyReward;', ctx);
  await ctx.apply(reward); assert.deepEqual(effects, []);
});
await test('picker awaits selection and blocks duplicate taps; cart blocks reward quantity growth', () => {
  const picker = read('src/components/FreeProductPicker.jsx'); const cart = read('src/lib/cartContext.jsx');
  assert.match(picker, /if \(selectingRef.current\) return/);
  assert.match(picker, /const result = await onSelect\(product\)/);
  assert.match(picker, /if \(result !== false\) onClose\(\)/);
  assert.match(picker, /disabled=\{selecting\}/);
  assert.match(cart, /if \(isEarnedRewardItem\(existing\)\) return/);
  assert.match(cart, /if \(isEarnedRewardItem\(\{ \.\.\.extra, product_id: product.id \}\)\) return/);
});
await test('actual cart removal clears only the earned selection and defeats a late validation', () => {
  const source = read('src/pages/Cart.jsx');
  const body = source.slice(source.indexOf('  const handleRemoveCartItem ='), source.indexOf('  const handleBirthdayProductSelect ='));
  const effects = [];
  const context = {
    isEarnedRewardItem: selection.isEarnedRewardItem, user: { email }, rewardMutationRef: { current: 0 },
    localStorage: { removeItem: key => effects.push(['storage', key]) },
    setActiveReward: value => effects.push(['active', value]), setIsValidatingReward: value => effects.push(['validating', value]),
    clearEarnedRewardItems: () => effects.push(['clear-earned']), removeItem: key => effects.push(['remove', key]),
  };
  vm.createContext(context); vm.runInContext(body + '\nthis.remove = handleRemoveCartItem;', context);
  context.remove(selection.earnedRewardCartItem(reward, product));
  assert.equal(context.rewardMutationRef.current, 1);
  assert.deepEqual(effects, [['storage', `activeReward_${email}`], ['active', null], ['validating', false], ['clear-earned']]);
  effects.length = 0;
  context.remove({ product_id: product.id, cart_line_key: 'paid-line', price: 13 });
  assert.deepEqual(effects, [['remove', 'paid-line']]);
  assert.match(source, /cancelled \|\| mutationVersion !== rewardMutationRef.current/);
  assert.match(source, /isEarnedRewardItem\(item\) \? \([\s\S]*?1 earned item[\s\S]*?\) : <div/);
});
await test('actual reward manager refuses stale runtime responses without read-only evidence', async () => {
  let response = { success: true, reward_id: reward.id, reward_title: reward.title, reward_type: reward.reward_type, points_required: 1000 };
  const calls = []; const module = { exports: {} };
  vm.runInNewContext(transformSync(read('src/lib/rewardManager.js'), { loader: 'js', format: 'cjs' }).code, {
    module, exports: module.exports, console: { warn() {} },
    require: name => name.includes('base44Client')
      ? { base44: { functions: { invoke: async (name, data) => { calls.push({ name, data }); return { data: response }; } } } }
      : selection,
  });
  await assert.rejects(() => module.exports.selectActiveReward(reward, email, { validateOnly: true }), /being updated/);
  response = { ...response, validated_only: true, writes_performed: true };
  await assert.rejects(() => module.exports.selectActiveReward(reward, email, { validateOnly: true }), /being updated/);
  response = { ...response, writes_performed: false };
  assert.equal((await module.exports.selectActiveReward(reward, email, { validateOnly: true })).points_required, 1000);
  assert.equal(calls.every(call => call.name === 'claimReward' && call.data.validate_only === true), true);
});
await test('schema retains legacy reward types and all six existing live catalog types', () => {
  const schema = JSON.parse(read('base44/entities/RewardTier.jsonc'));
  for (const type of ['free_shot', 'free_bottle', 'double_points', 'discount_10pct', 'bundle_upgrade', 'vip_box', 'discount', 'free_delivery', 'bundle', 'exclusive']) {
    assert.ok(schema.properties.reward_type.enum.includes(type), type);
  }
  const selectionFields = JSON.parse(read('base44/entities/UserPoints.jsonc')).properties.claimed_rewards.items.properties;
  assert.equal(selectionFields.points_required.minimum, 1);
  assert.equal(selectionFields.status.type, 'string');
});
for (const [page, start, end] of [
  ['Cart', '// On mount and user change', '  const handleRemoveCartItem ='],
  ['Rewards', '// Validate active reward on mount', '  // Check if rewards container'],
]) await test(`${page}: auth recovery never clears a stored earned cart`, async () => {
  const source = read(`src/pages/${page}.jsx`);
  const body = source.slice(source.indexOf(start), source.indexOf(end));
  const effects = []; const context = {
    user: null, isLoadingAuth: true, rewardMutationRef: { current: 0 },
    useEffect: fn => fn(), setActiveReward: () => effects.push('active'), setIsValidatingReward: () => effects.push('validating'),
    clearEarnedRewardItems: () => effects.push('cart'), getStoredActiveReward: () => { effects.push('read'); return reward; },
    validateActiveReward: async () => { effects.push('network'); return reward; },
    localStorage: { setItem: () => effects.push('stored'), removeItem: () => effects.push('remove') },
  };
  vm.createContext(context); vm.runInContext(body, context); await Promise.resolve();
  assert.deepEqual(effects, []);
  context.user = { email }; context.isLoadingAuth = false;
  vm.runInContext(body, context); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(effects, ['validating', 'read', 'network', 'stored', 'active', 'validating']);
});
console.log(`Reward selection safety: ${passed}/${passed} passed; synthetic-only, no network/provider writes.`);
