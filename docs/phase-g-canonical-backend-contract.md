# Phase G Canonical Backend Contract

Status: Phase G1 contract, documentation only.

This document governs future Hub-to-Customer-App backend merger work. It does not authorize code changes, schema changes, secret changes, Shopify changes, Stripe changes, Hub changes, loyalty changes, live record edits, sync replays, checkout tests, or production publishes.

## 1. Purpose

Phase G makes the Customer App backend the canonical source of truth for commerce and customer-facing data while preserving Hub as the operational and admin layer until its fulfillment, production, driver, and internal-operations modules are intentionally migrated or retired.

Primary goals:

- Customer App backend becomes canonical for customer, order, payment, schedule, subscription, and loyalty data.
- Hub remains operational for fulfillment, production, driver workflows, delivery proof, and internal notes.
- Sync paths become narrow, idempotent, and explicit.
- Broad bidirectional sync and manual repair paths are classified before any retirement.
- Shopify remains an optional mirror or POS layer, not a canonical source for online Customer App orders.

## 2. Core Ownership Principles

- Customer App owns commerce truth.
- Hub owns operations execution state.
- Stripe owns payment network truth, reflected into Customer App by verified webhook and Stripe API reads.
- Shopify is an optional mirror/POS layer and must not become canonical for Customer App checkout orders.
- Customer App owns customer-facing notifications and customer-facing order display.
- Hub may own internal/admin/driver operational alerts, but must not send duplicate customer-facing delivery notifications.
- Loyalty and UserPoints are Customer App-owned.
- Canonical schedule fields are assigned by Customer App backend schedule logic and mirrored outward. Hub must not recalculate or overwrite them.
- Every sync path must define allowed fields, forbidden fields, idempotency, retry behavior, and rollback/disable behavior before behavioral changes are made.

## 3. Entity Ownership Table

| Entity | Current owner | Future owner | Allowed writer | Allowed reader | Sync direction | Retirement plan |
| --- | --- | --- | --- | --- | --- | --- |
| `Order` | Customer App canonical, Hub mirror for operations | Customer App canonical | Customer App checkout/webhook/admin repair only | Customer App, Hub, Shopify mirror, support/admin views | Customer App -> Hub mirror; Hub -> Customer App status readback only for operational fields | Hub order mirror becomes operational/read-only for commerce fields; retire Hub commerce overwrites. |
| `CheckoutSession` | Customer App | Customer App | Customer App checkout only | Customer App checkout/recovery tools | None except internal Customer App recovery | Keep Customer App-only; do not mirror to Hub unless an audit-only need is proven. |
| `DeliveryApprovalRequest` | Customer App | Customer App | Customer App route-review functions/admin | Customer App admin/customer views | None; Hub may read only if operationally needed | Keep Customer App-only unless route-review operations move to Hub by explicit design. |
| `FulfillmentTask` | Hub | Hub short-term; possible Customer App migration later | Hub production/driver/admin workflows | Hub operations, Customer App readback if needed | Hub -> Customer App status summary only | Keep in Hub until a Customer App fulfillment module exists and parity is proven. |
| `Subscription` | Customer App canonical, Hub may mirror fulfillment needs | Customer App | Customer App subscription/payment/webhook/admin | Customer App, Hub task generation as needed | Customer App -> Hub fulfillment mirror only | Retire Hub subscription writes; keep Hub task mirror until fulfillment ownership changes. |
| `UserProfile` | Customer App canonical, Hub mirror for operations/contact | Customer App | Customer App profile/auth/admin repair | Customer App, Hub operational views | Customer App -> Hub contact mirror | Retire Hub-originated profile overwrites except audited admin corrections. |
| `UserPoints` | Customer App | Customer App | Customer App loyalty functions only | Customer App customer/admin views; Hub read-only if needed | None or Customer App -> Hub read-only summary if required | Retire Hub loyalty write paths. |
| `ShopifyOrder` / Hub order mirror | Hub operational mirror | Hub operational mirror only | Hub receiver/safe sync for mirrored fields; Hub operations for fulfillment fields | Hub admin/operations, Customer App readback | Customer App -> Hub create/update for allowed mirror fields | Keep operational mirror; remove canonical commerce ownership from Hub. |
| `Notification` | Customer App for customer-facing, Hub for internal ops | Customer App for customer-facing | Customer App notification functions for customers; Hub only for internal ops | Customer App users/admins; Hub ops users | Hub -> Customer App status events may trigger Customer App notifications | Retire Hub customer-facing delivery emails/SMS/push. |
| Driver/task/proof records | Hub | Hub short-term | Hub driver/ops workflows | Hub ops, Customer App readback/display if needed | Hub -> Customer App delivery status/proof summary | Migrate later only after driver workflow parity and rollback are proven. |

## 4. Field-Level Ownership Table

| Field | Canonical owner | Mirror target | Allowed overwrite rule | Idempotency key / dedupe guard | Warning notes |
| --- | --- | --- | --- | --- | --- |
| `order_number` | Customer App | Hub, Shopify | Immutable after creation; mirrors may set only if missing on initial create | `order_number` unique | Never let Hub or Shopify rename Customer App orders. |
| `stripe_payment_intent_id` | Customer App / Stripe | Hub, Shopify metadata if needed | Customer App writes from Stripe PI; Hub read-only | Stripe PI ID unique | Duplicate Orders for one PI are blocker defects. |
| `payment_status` | Customer App from Stripe | Hub | Stripe webhook/verified repair may update; Hub must not overwrite | Stripe event ID + PI ID | Hub payment status is a mirror only. |
| `financial_status` | Customer App from Stripe | Hub | Stripe webhook/verified repair may update; Hub must not overwrite | Stripe event ID + PI ID | Refund/capture state must trace to Stripe. |
| `status` / `order_status` | Customer App for commerce lifecycle; Hub for operational substate | Hub mirrors commerce state; Customer App reads operational status summary | Commerce status from Customer App; operational status from Hub readback only through mapped fields | `order_number` + status transition + timestamp | Avoid loops where readback changes trigger full Customer App -> Hub order push. |
| `production_status` | Hub short-term | Customer App display/readback | Hub may update operational production progress; Customer App should not recalculate | Hub task/order ID + transition | Do not conflate with payment/order status. |
| `fulfillment_status` | Hub short-term | Customer App display/readback | Hub may update operational fulfillment progress | Hub task/order ID + transition | Customer App display only unless fulfillment module migrates. |
| `delivery_status` | Hub short-term | Customer App display/readback | Hub driver/delivery functions update; Customer App mirrors customer-facing status | Hub delivery task ID + transition | Customer App owns notifications triggered from mirrored status. |
| `assigned_production_day` | Customer App schedule engine | Hub, Shopify notes if needed | Customer App sets; Hub read-only | `order_number` + schedule assignment source | Must be `YYYY-MM-DD`, not weekday text. |
| `production_date` | Customer App transition alias | Hub if needed | Must mirror `assigned_production_day`; Hub read-only | Same as `assigned_production_day` | Deprecated alias for transition compatibility. |
| `assigned_delivery_date` | Customer App schedule engine | Hub, Shopify | Customer App sets; Hub read-only | `order_number` + schedule assignment source | Must be `YYYY-MM-DD`. |
| `delivery_window_label` | Customer App schedule engine | Hub, Shopify | Customer App sets; Hub may normalize for validation but must preserve original label | Normalized bucket + `order_number` | Valid labels include `Wednesday 5 PM - 8 PM` and `Saturday 12 PM - 3 PM`. |
| `assigned_delivery_window_start` | Customer App schedule engine | Hub | Customer App sets; Hub read-only | `order_number` + schedule assignment source | Required canonical assigned window field. |
| `assigned_delivery_window_end` | Customer App schedule engine | Hub | Customer App sets; Hub read-only | `order_number` + schedule assignment source | Required canonical assigned window field. |
| `subtotal` | Customer App checkout/backend | Hub, Shopify | Customer App writes; Hub mirrors only; repair allowed if source Order proves value | `order_number` + source payload version | Hub readback must not default correct Customer App values to zero. |
| `delivery_fee` | Customer App eligibility/checkout backend | Hub, Shopify shipping line | Customer App writes; Hub mirrors only; repair allowed if source Order proves value | `order_number` + source payload version | Phase F2 fixed missing Hub delivery fee mapping; monitor next order. |
| `total` | Customer App checkout/backend and Stripe amount parity | Hub, Shopify | Customer App writes; Hub mirrors only | Stripe PI amount + `order_number` | Must match Stripe amount in cents. |
| `line_items` | Customer App checkout/backend | Hub, Shopify | Customer App writes; Hub mirrors only | Product ID/title + quantity + price snapshot | Do not let Shopify or Hub become source for Customer App checkout items. |
| `customer_email` | Customer App auth/profile/checkout | Hub, Shopify | Customer App writes; Hub mirrors only except audited support correction | Lowercase email + user ID | Avoid using email alone for identity merges when user ID exists. |
| `customer_name` | Customer App profile/checkout | Hub, Shopify | Customer App writes; Hub mirrors only except audited support correction | User ID + order ID | Customer display and delivery labels depend on this. |
| `assigned_driver` | Hub | Customer App display/readback | Hub writes; Customer App reads | Hub task/order ID + driver ID | Operational field; not commerce truth. |
| `delivered_at` | Hub delivery event | Customer App display/readback | Customer App preserves valid Hub timestamp; fallback current sync time only if missing/invalid | Hub task/order ID + delivered transition | Phase F3A patch preserves Hub-provided timestamp. |
| `delivery_photo_url` | Hub delivery proof | Customer App display/readback | Hub writes; Customer App reads | Hub task/proof ID | Customer App must not delete proof during status sync. |
| `delivery_drop_location` | Hub delivery proof | Customer App display/readback | Hub writes; Customer App reads | Hub task/proof ID | Treat as operational proof metadata. |
| `admin_notes` | Hub operational admin | Hub; optional Customer App admin readback | Hub writes; Customer App should not overwrite unless a future admin module owns notes | Hub note ID + timestamp | Separate internal notes from customer-visible messages. |
| Loyalty points | Customer App | Optional Hub read-only summary | Customer App writes only; Hub must not duplicate awards | Order ID + points transaction ID | Duplicate UserPoints writes are high-risk. |
| Notification state | Customer App for customer-facing; Hub for internal ops | Customer App customer/admin views | Customer App writes customer notification records; Hub writes only internal ops logs | Notification type + order/status + recipient | One customer-facing notification per status transition. |

## 5. Active Sync Path Contracts

### Customer App -> Hub Order Sync

| Item | Contract |
| --- | --- |
| Source | Customer App Order after confirmed checkout/payment/approval/subscription fulfillment. |
| Target | Hub `ShopifyOrder` or operational order mirror. |
| Trigger | Customer App post-payment/webhook/approval/subscription flow or approved manual repair. |
| Payload owner | Customer App owns commerce, customer, payment, and schedule fields. |
| Allowed fields | Order identity, customer summary, line items, subtotal, delivery fee, total, payment mirror, canonical schedule fields, locked schedule source. |
| Forbidden fields | Hub driver assignment, delivery proof, operational admin notes, Hub-owned production task state. |
| Idempotency rule | Upsert by `order_number` and Stripe PI where present; never create a second Hub order for the same Customer App Order. |
| Retry rule | Retry only failed sync for a single order or bounded batch with duplicate checks. |
| Rollback/disable rule | Disable Customer App -> Hub sync if duplicate Hub orders, sync loops, or destructive operational overwrites occur. |

### Hub -> Customer App Status Readback

| Item | Contract |
| --- | --- |
| Source | Hub operational order/task status and delivery proof fields. |
| Target | Customer App Order display/status mirror fields. |
| Trigger | Scheduled/manual status sync or customer/admin read path. |
| Payload owner | Hub owns delivery/driver/fulfillment status; Customer App owns customer-facing display and notifications. |
| Allowed fields | Delivery/fulfillment status summary, `delivered_at`, delivery proof fields, assigned driver display where appropriate. |
| Forbidden fields | Payment status, financial status, Stripe IDs, schedule assignment, line items, totals, customer identity. |
| Idempotency rule | Update only on meaningful status transition or proof-field change. |
| Retry rule | Re-read Hub state; do not replay Customer App checkout/webhook. |
| Rollback/disable rule | Disable readback if it causes duplicate notifications, status loops, or overwrites Customer App commerce fields. |

### Hub Driver Updates

| Item | Contract |
| --- | --- |
| Source | Hub driver/fulfillment functions. |
| Target | Hub tasks/orders, then Customer App readback/display. |
| Trigger | Driver status, delivery completion, proof upload, operational admin action. |
| Payload owner | Hub. |
| Allowed fields | Fulfillment task state, delivery status, delivered timestamp, proof/photo/drop location, driver audit logs. |
| Forbidden fields | Customer App payment, schedule, line item, loyalty, and Stripe fields. |
| Idempotency rule | One terminal delivered transition per Hub task/order unless explicit correction is audited. |
| Retry rule | Retry operational status update only; do not trigger customer commerce writes directly. |
| Rollback/disable rule | Disable customer-facing Hub notifications if duplicate communication risk appears. |

### Shopify Push

| Item | Contract |
| --- | --- |
| Source | Customer App paid Order. |
| Target | Shopify draft/order mirror. |
| Trigger | Customer App post-payment flow after Stripe success. |
| Payload owner | Customer App owns source payload; Shopify receives mirror. |
| Allowed fields | Line items, customer email/name/address summary, delivery fee as shipping line, order number metadata/note. |
| Forbidden fields | Customer App canonical status, loyalty, Stripe webhook state, Hub operational state. |
| Idempotency rule | One Shopify order per Customer App Order; dedupe by Customer App order number and/or metadata. |
| Retry rule | Retry only after auth probe passes and duplicate Shopify search is clean. |
| Rollback/disable rule | Disable Shopify push if duplicate Shopify orders or auth loops occur. |

### Stripe Webhook

| Item | Contract |
| --- | --- |
| Source | Stripe live webhook events and verified Stripe API state. |
| Target | Customer App Order, CheckoutSession, Subscription, loyalty side effects where applicable. |
| Trigger | Stripe webhook delivery. |
| Payload owner | Stripe owns network truth; Customer App maps it to local canonical records. |
| Allowed fields | Payment status, financial status, capture/refund fields, Stripe IDs, order finalization state, payment timestamps. |
| Forbidden fields | Hub operational delivery state, driver proof, Hub admin notes. |
| Idempotency rule | Stripe event ID and PI/subscription/invoice ID must prevent duplicate finalization. |
| Retry rule | Stripe webhook retry must be safe and idempotent. |
| Rollback/disable rule | Roll back publish if successful payment fails to create/finalize one Customer App Order. |

### Notification Triggers

| Item | Contract |
| --- | --- |
| Source | Customer App status transitions, payment/order events, and Hub readback status transitions. |
| Target | Customer App notification records and configured providers. |
| Trigger | Controlled Customer App notification functions/automations. |
| Payload owner | Customer App. |
| Allowed fields | Notification type, recipient, order/status reference, idempotency key, sent status. |
| Forbidden fields | Hub direct customer delivery emails/SMS/push for statuses Customer App handles. |
| Idempotency rule | One customer-facing notification per order/status/recipient/type. |
| Retry rule | Retry provider send only with same notification key. |
| Rollback/disable rule | Disable specific notification path if duplicate or wrong-timing sends occur. |

### Loyalty Writes

| Item | Contract |
| --- | --- |
| Source | Customer App order/payment/loyalty actions. |
| Target | Customer App `UserPoints` and points history. |
| Trigger | Paid order, approved redemption, admin correction, loyalty campaign. |
| Payload owner | Customer App. |
| Allowed fields | Points award/deduction, reason, order reference, balance update, history entry. |
| Forbidden fields | Hub-originated duplicate awards unless future contract explicitly permits read-only mirror. |
| Idempotency rule | One points transaction per order/reward/reference. |
| Retry rule | Retry must check existing transaction reference before writing. |
| Rollback/disable rule | Pause loyalty automation if duplicate points are detected. |

### Subscription Fulfillment

| Item | Contract |
| --- | --- |
| Source | Customer App subscription and Stripe subscription/invoice events. |
| Target | Customer App subscription orders; Hub fulfillment task mirror if needed. |
| Trigger | Subscription renewal/payment event or approved admin operation. |
| Payload owner | Customer App for subscription/order/payment; Hub for fulfillment task execution. |
| Allowed fields | Subscription order details, schedule fields, fulfillment task request payload. |
| Forbidden fields | Hub overwrites of subscription billing truth or Stripe state. |
| Idempotency rule | Stripe invoice/subscription period + subscription ID. |
| Retry rule | Retry one subscription period at a time with duplicate order/task checks. |
| Rollback/disable rule | Disable subscription fulfillment sync if duplicate fulfillment orders or tasks are created. |

### Manual Repair Tools

| Item | Contract |
| --- | --- |
| Source | Admin/operator action. |
| Target | Narrowly scoped affected records. |
| Trigger | Explicit approval with target IDs and rollback plan. |
| Payload owner | Depends on repaired field owner. |
| Allowed fields | Only documented target fields for the incident. |
| Forbidden fields | Broad rewrites, bulk rebuilds, unrelated entities, secret changes, hidden notification sends. |
| Idempotency rule | Target record ID + repair incident ID/log. |
| Retry rule | Rerun only after before/after verification and duplicate check. |
| Rollback/disable rule | Disable or deprecate broad repair tools that can overwrite canonical fields without contract checks. |

## 6. Deprecated Or Risky Paths

These paths require classification before further cutover:

| Path type | Status | Risk | Required action |
| --- | --- | --- | --- |
| Disabled legacy status sync functions | Unknown until inventoried | May re-enable old status ownership or loops | Classify as disabled, deprecated, or delete-candidate before code changes. |
| Broad manual order/subscription repair tools | Active/unknown | Can overwrite canonical fields or create duplicates | Require target-specific allowlists, audit logs, and dry-run where possible. |
| Direct Hub customer notifications | Partially suppressed for delivery emails | Duplicate customer communication | Continue audit for remaining customer-facing Hub sends. |
| Bidirectional Customer App <-> Hub order updates | Active in limited forms | Sync loops and ownership confusion | Convert to explicit one-directional contracts per field group. |
| Functions with unclear ownership | Unknown | Hidden writes to payment/status/loyalty fields | Inventory before Phase G2 changes. |
| Shopify push retry paths | Active but recently repaired auth | Duplicate Shopify mirror order risk | Monitor next real order before broad retry/automation changes. |

## 7. Monitoring Requirements Carried Forward

The following observations remain required before deeper cutover:

- Next real order Shopify push validation:
  - `pushOrderToShopify` runs once.
  - Shopify order is created once.
  - Shopify total, line items, delivery fee, tax, and discounts match expected mirror behavior.
  - No Shopify retry loop appears.
- Next order Hub financial persistence:
  - Hub stores and readback returns `subtotal`.
  - Hub stores and readback returns `delivery_fee`.
  - Customer App merged read does not default correct values to zero.
- Next delivered order timestamp preservation:
  - Customer App `delivered_at` matches valid Hub-provided `delivered_at`.
  - Missing/invalid Hub timestamp fallback is not triggered when Hub sends a valid timestamp.
- Next delivered order notification ownership:
  - Customer receives one expected delivery notification.
  - Hub does not send a duplicate customer-facing delivered email.
- Loyalty/UserPoints monitoring:
  - One award/write per eligible paid order.
  - No duplicate points transaction for retry/webhook/readback paths.

## 8. Cutover Gates

No sync path may be retired or converted until these gates are satisfied for its affected fields:

| Gate | Requirement |
| --- | --- |
| Data parity | Customer App, Hub, Stripe, and Shopify where applicable agree across several real orders. |
| Duplicate prevention | No duplicate Hub orders, Shopify orders, Stripe finalizations, notifications, or loyalty writes. |
| Notification ownership | Customer-facing notifications are Customer App-owned and idempotent. |
| Fulfillment continuity | Hub production/driver workflows continue without missing tasks or proof fields. |
| Field ownership | Allowed writer and overwrite rules are documented for every changed field. |
| Idempotency | Each sync has a stable dedupe key and retry rule. |
| Rollback path | Restore, revert, or disable path is known before publish. |
| Manual tools | Repair tools are classified as safe, deprecated, disabled, or unknown. |
| Monitoring signoff | Next-order monitoring items for Shopify, Hub financials, delivered_at, notifications, and loyalty have passed or been accepted as risk. |

## 9. Recommended Phase G2

Recommended next implementation phase: Phase G2 - sync idempotency and status ownership hardening.

Phase G2 should remain narrow and PR-safe. It should not attempt a broad cutover. Recommended scope:

- Inventory active Customer App -> Hub and Hub -> Customer App status functions.
- Add or confirm idempotency keys for order sync, status readback, Shopify push, notification triggers, and loyalty writes.
- Harden status ownership so Hub cannot overwrite Customer App commerce truth and Customer App cannot overwrite Hub operational proof/state.
- Document and classify broad manual repair tools before changing them.
- Keep Shopify push, delivered timestamp preservation, Hub financial persistence, and single-notification behavior on monitoring until the next real events validate them.

Unresolved ownership questions for Phase G2:

- Should Shopify remain an online-order mirror, POS-only layer, or be removed from the online order flow later?
- Which Hub fulfillment/driver fields should eventually migrate into Customer App, if any?
- Which broad manual repair tools are still operationally required after Gate D and Phase F repairs?
- Should Hub admin notes ever be displayed in Customer App admin views, or remain Hub-only?
- What exact number of clean real orders is required before retiring any sync path?
