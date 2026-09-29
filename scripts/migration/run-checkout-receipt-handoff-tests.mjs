import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const checkout = fs.readFileSync('src/pages/Checkout.jsx', 'utf8');
const hook = fs.readFileSync('src/lib/useCheckoutReceiptHandoff.js', 'utf8');
const tree = ts.createSourceFile('Checkout.jsx', checkout, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const calls = [];
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'handoffToReceipt') calls.push(node);
  ts.forEachChild(node, visit);
}
visit(tree);
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
check(checkout.indexOf('if (receiptHandoff)') < checkout.indexOf('if (isLoadingAuth ||'), 'Terminal handoff renders before changing auth state');
check(checkout.indexOf('if (receiptHandoff)') < checkout.indexOf('if (paidRecovery) return'), 'Terminal handoff unmounts recovery/payment actions');
check(checkout.includes('if (items.length === 0 && !checkoutStartLocked)'), 'Normal empty-cart safety remains unchanged');
check(checkout.includes('Opening your order…') && checkout.includes('aria-live="polite"'), 'Handoff has accessible neutral copy, not a paid claim');
check(!/\bclearCart\(/.test(checkout), 'All purchased-cart clears are owned by the handoff controller');
check(!/\bnavigate\((?:`|')\/(?:order-confirmation|zone3-review-submitted)/.test(checkout.replace(/onClick=\{\(\) => navigate\(`\/zone3-review-submitted[^\n]+/, '')), 'Success destinations use the handoff controller');
check(calls.length === 10, 'All ten receipt/route branches are covered');
check(calls.filter(call => call.arguments[1]?.getText(tree).includes('clearPurchasedCart: true')).length === 7, 'Only seven purchased-cart branches clear, not reload/recovery');
check(calls.filter(call => call.arguments[1]?.getText(tree).includes('replace: true')).length === 2, 'Stripe/PWA returns preserve replacement navigation');
const recoveredStart = checkout.indexOf('onReceipt={async');
const recovered = checkout.slice(recoveredStart, checkout.indexOf('if (items.length === 0', recoveredStart));
check(recovered.includes("if (proof.state === 'succeeded') forgetPaidAttempt();"), 'Processing recovery retains its pending-attempt marker');
check(!recovered.includes('clearPurchasedCart'), 'Paid recovery never clears a newly assembled cart');
check(checkout.indexOf("sessionStorage.setItem('nuvira_guest_order_confirmation'", checkout.indexOf('onSuccess={(paymentIntentId)')) < checkout.indexOf('if (routeCheckout) handoffToReceipt', checkout.indexOf('onSuccess={(paymentIntentId)')), 'Guest receipt credential is saved before terminal handoff');

// Execute the shipped helper, not a duplicated implementation. This checks
// operation ordering/options; the paired browser suite supplies React/Router
// scheduler behavior with an actual stateful cart.
const mod = { exports: {} };
const transpiled = ts.transpileModule(hook, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
for (const clearPurchasedCart of [false, true]) {
  const operations = [];
  vm.runInNewContext(transpiled, { exports: mod.exports, require: () => ({ useState: () => [false, value => operations.push(['lock', value])] }) });
  const controller = mod.exports.useCheckoutReceiptHandoff({ clearCart: () => operations.push(['clear']), navigate: (destination, options) => operations.push(['navigate', destination, options]) });
  controller.handoffToReceipt('/order-confirmation', { clearPurchasedCart, replace: true, state: { requestNumber: 'synthetic' } });
  check(JSON.stringify(operations.map(operation => operation[0])) === JSON.stringify(clearPurchasedCart ? ['lock','clear','navigate'] : ['lock','navigate']), 'Handoff lock is urgent and precedes cart clearing/navigation');
  const navigation = operations.at(-1);
  check(navigation[2].replace === true && navigation[2].state.requestNumber === 'synthetic' && !('clearPurchasedCart' in navigation[2]), 'Internal clear flag is not sent to Router; history/state options preserved');
}
check(!hook.includes('startTransition') && !hook.includes('flushSync'), 'Handoff does not demote lock or override Router scheduling');
console.log(JSON.stringify({ suite: 'checkout-receipt-handoff', checks, passed: true, browser_suite: 'scripts/tests/receipt-handoff-browser/index.html', note: 'Ordering and source contracts; browser suite must separately pass', provider_calls: 0, production_writes: 0 }));
