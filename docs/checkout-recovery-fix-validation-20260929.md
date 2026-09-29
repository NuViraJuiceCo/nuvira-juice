# Checkout recovery fixes — September 29, 2026

## Scope and release boundary

The owner authorized fixing the two audited checkout defects after the proposal
to prepare and test them separately and seek approval before live deployment.
This candidate is isolated from production and V3. No live release is authorized
by the sandbox tests. No real payments, customer messages or fulfillment are
part of this validation.

Candidate source: `2db8d636cb2216fe34bc1132efc2134c4195c9dd`, isolated branch
`codex/checkout-recovery-fixes-20260929`. The existing minimum-order-shopping
checkout HEAD is `b8411177c78e5bf7ee5a863f4602af14efbb8f17`; its Git tree is
identical to the pinned released merge tree
`ef8770accc7f1887718395ff94269cd950142529`. It has not been edited for this fix.

The managed-worktree tool was unavailable because the chat directory is not a
Git repository. A separate Git worktree was created from the pinned release in
`nuvira-workspace/checkout-recovery-fixes-20260929` instead. Dependencies reuse the
existing local installation without changing its lockfile or installing packages.

## Baseline confirmed before edits

- Released automatic receipt navigation lost a race to the empty-cart redirect.
- A provider cancellation webhook could set only `status=cancelled`, leaving
  payment and financial status pending; the cancellation recovery proof then
  refused the inconsistent record before its final conditional update.
- Fresh public entry asset SHA-256:
  `fd96b50677e205ec6e0dc26cd3d5bbe6c3b38d30e35e3e52400ae6c47f1b7d90`.
- Fresh public checkout asset SHA-256:
  `eabc9ba54b0aa316c68756d91c8900eb086388a185d750149cc5bc01883e1606`.

## Isolated provider environment

- Private Base44 app: `6abc06deb903ac101bad6d2e`.
- Stripe sandbox: `acct_1UL60hIroLAg6PFz`.
- Sole QA webhook: `we_1UL6GIIroLAg6PFzC7VLESfv`, pointing only to that QA app.
- Local browser harness: `http://127.0.0.1:5193`.
- Fabricated identity only. Test-key/account/app guards remain mandatory.
- Original extraction manifests remain baseline evidence; candidate overlays
  must be recorded separately rather than described as byte-identical release code.

At 19:30:46 UTC the QA database contained exactly two orders: the original paid
test order and the stuck canceled attempt. There were two checkout sessions and
seven suppressed downstream-effect receipts. The stuck order number was
`NV-BA4D645679B52CF6FAF81930`; its valid browser-held guest token is retained for
testing explicit recovery without directly editing the database.

## Implemented fixes

The frontend now enters an urgent, accessible receipt-handoff state before
clearing purchased cart items and scheduling React Router navigation. This
prevents the empty-cart guard from redirecting a completed payment to `/cart`.
The ordinary empty-cart guard is unchanged. Recovery of a previously paid
attempt preserves any newly added cart items.

Recovery and the embedded-payment webhook share a canceled-checkout reconciler.
It fetches current Stripe state, verifies ownership, session/context, currency,
amount and absence of captured/refunded funds, then uses conditional writes and
readback to reconcile the terminal state. It handles either side winning the
race and permits explicit recovery of the historical status-only cancellation.
Only the winning webhook transition produces a cancellation alert. Existing
benefit-settlement safeguards remain required before retry can be cleared.

Order enum changes are additive: existing `pending_payment`/`cancelled` lifecycle
values and `cancelled` payment/financial states. No entity ACL or defaults changed.
Webhook runtime: `stripe-webhook-runtime-20260929-cancellation-recovery-v9`.

## Completed verification

- Independent review completed for the isolated candidate and QA adaptations.
- All **163 critical regression harnesses passed**, including the two new race
  harnesses. See [machine-readable results](checkout-recovery-critical-20260929.json).
  These results were collected against the candidate working tree; the recorded
  `git_commit` is its base HEAD, not a claim that the base commit contains the fix.
- Cancellation race/proof tests: 51 candidate checks and 50 QA checks passed.
  Record persistence/benefit-ledger coverage: 159 checks passed.
- Actual browser receipt scheduler fixture: 12/12 passed, including the released
  negative control reproducing `/cart`, fixed receipt navigation, review-route
  handoff, preservation of a newer cart and normal empty-cart redirection.
- QA isolation, source/candidate manifest parity and backend packaging checks
  passed. The original release extraction manifests remain unchanged.
- Typecheck, lint, diff checks and production build passed. Built output was
  47,253,410 bytes across 380 files, below the 49,000,000-byte budget.
- The tracked-source secret scan passed after staging all new candidate files:
  1,379 files scanned, zero findings (binary/generated exclusions still apply).
- Production entry and checkout hashes were checked again after the tests and
  remained exactly the values above. The original release checkout remained clean.

## Actual Stripe sandbox retests

The fixed frontend was exercised in the local browser harness against the
deployed private QA backend. The hosted QA site's frontend was **not redeployed**
in this fix pass. Seven existing schemas were pushed with only the verified
Order enum delta; `createPaymentIntent` and `stripeWebhook` were deployed only
to explicit QA app ID `6abc06deb903ac101bad6d2e`.

| Scenario | Result and evidence |
| --- | --- |
| Decline, then retry | Official decline card displayed its decline. Retrying the same prepared payment with the official success card completed a simulated $42.99 purchase and **automatically opened the confirmed receipt**. No direct receipt navigation was used. |
| Paid attempt recovery | The saved paid-attempt action opened its token-protected receipt through the customer UI. |
| Original stuck cancellation | `NV-BA4D645679B52CF6FAF81930` completed cancellation through the existing browser recovery controls and returned to Cart. No direct database repair was performed. |
| Fresh cancellation race | `NV-2522369C41457696C1AF44D6` canceled through the customer UI and returned to Cart. The signed webhook won the terminal transition, returning HTTP 200 with `action=checkout_cancelled`, and recovery still completed normally. |
| Duplicate success delivery | Resending the exact same sandbox success event returned HTTP 200; there was still exactly one matching paid order and no additional downstream-effect receipt for it. |

Provider receipts (all fabricated sandbox records):

| Event | Identifier | Delivery time, UTC | HTTP |
| --- | --- | --- | ---: |
| Fixed successful purchase | `evt_3UL6tpIroLAg6PFz1cK7BDsO` | 19:44:32 | 200 |
| Same success event replay | `evt_3UL6tpIroLAg6PFz1cK7BDsO` | 19:46:17 | 200 |
| Fresh cancellation | `evt_3UL6yyIroLAg6PFz1hLZXASo` | 19:47:36 | 200 |

Successful order: `NV-A52A480F8DCF9347FF11C6C1`, PaymentIntent
`pi_3UL6tpIroLAg6PFz1yflwcd6`. Fresh canceled PaymentIntent:
`pi_3UL6yyIroLAg6PFz1k7eM5EI`.

Final read-only reconciliation at **19:48:18.265 UTC** found exactly four orders
and four checkout sessions: two paid (baseline and fixed-flow test) and two
canceled (repaired and fresh). Both cancellations had
`status/payment_status/financial_status=cancelled`, `payment_captured=false`,
`do_not_recover=true` and `abandoned_checkout=true`. There were exactly 14
suppressed side-effect receipts: six for each paid order and one for each
cancellation. No customer email, SMS, Shopify, Hub or fulfillment transport ran.

Screenshot evidence is in `audits/sales-health-20260929/` relative to the
parent `nuvira-workspace` directory:

- `fix-automatic-sandbox-receipt.png`
- `fix-receipt-regressions-12-pass.png`
- `fix-sandbox-webhook-replay-200.png`
- `fix-fresh-cancellation-webhook-200.png`

The receipt's inherited points-earned display is not proof of an actual loyalty
award: downstream effects were deliberately suppressed in this environment.

## Production release gates — not yet authorized

Implementation, independent review, local/browser regressions, actual sandbox
success/cancellation/replay checks, source parity and build gates are complete.
**Live deployment approval and a fresh production release audit remain open.**

Before deployment, refresh canonical main, dependency changes, deployed source,
backend state and competing publishers. Main was observed to have dependency-only
changes after the pinned release; do not assume this candidate can overwrite it.
Integrate only the scoped fixes, rerun applicable checks on the exact final commit
and record source/build hashes. Do not deploy the QA adapters or test keys.

For an approved release, apply the additive Order schema first, then the recovery
handler/shared helper and webhook as a coordinated backend change, then the
website frontend. Recheck diagnostics, deployed parity, guest click-through and
provider delivery health without making an unapproved live purchase. Native
packaging/release is a separate gate and was not performed here.

Retain exact pre-release artifacts and backend source for rollback. The additive
enum values should remain if any records use them. Do not blindly restore just
the old webhook: that reintroduces the status-only cancellation race. Any rollback
needs a reviewed, coordinated handler/webhook strategy and read-only reconciliation
of attempts created during the release; never overwrite paid/canceled records.

Older/incomplete embedded attempts without unique session/context proof, or
records with conflicting paid/refund signals, deliberately fail closed. There is
no bulk historical-record rewrite. Such records require an independently scoped
review rather than weakening ownership/payment proof.

Sandbox tests follow [Stripe testing guidance](https://docs.stripe.com/testing)
and [webhook delivery guidance](https://docs.stripe.com/webhooks). They do not
establish production wallet, email, fulfillment, or native-app behavior. The QA
Stripe API version is `2026-08-26.dahlia`; the inspected live destination uses
`2026-03-25.dahlia`. Live-version compatibility must be checked at release.
