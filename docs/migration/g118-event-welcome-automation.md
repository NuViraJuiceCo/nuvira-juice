# G118 event welcome automation

Prepared: August 21, 2026

## Purpose

Send one consent-aware, event-specific welcome email to a first-time NuVira customer after a paid event POS purchase without treating every POS buyer as a new event customer.

## August 22 provider configuration (historical and in flight)

- Resend event: `nuvira.event.welcome`
- Resend template: `NuVira Event Welcome`
- Template ID: `ff66a5a0-b88b-4f05-a705-a7be50496e42`
- Template alias: `nuvira-event-welcome`
- Automation: `NuVira - Event Welcome v1`
- Automation ID: `01a025b9-c1e5-75ff-b01a-a2fd35ba6542`
- Automation state during implementation: disabled
- Delay: 2 hours
- Internal provider proof: `caeaa878-ccc1-4524-bb22-0afa0dae4828`

The automation maps the published template variables from the matching fields on the triggering event:

- `CUSTOMER_NAME` ← `event.customer_name`
- `EVENT_NAME` ← `event.event_name`
- `EVENT_DATE` ← `event.event_date`
- `EVENT_LOCATION` ← `event.event_location`

Do not change or replay the August 22 in-flight runs. They were created with the original provider-side two-hour delay and remain isolated on `nuvira.event.welcome`.

## Future event timing

- Resend event: `nuvira.event.welcome.ready`
- Resend automation: `NuVira - Event Welcome Ready v2`
- Provider delay: none
- Timing authority: the Customer App event record
- Rule: send at the configured event end time plus exactly two hours

The event scheduler evaluates active event records in `America/Chicago`, including daylight-saving time and overnight events. It does not forward before the due timestamp. If the scheduler or a manual recovery runs after the target, the eligible welcome is forwarded immediately. The stable event/customer idempotency key prevents duplicates, and the event remains eligible for a bounded 48-hour reconciliation window so a late Shopify POS sync can still be picked up.

## Server actions

`event_welcome_preview` is an admin/owner-only dry run. It requires an explicit event key, the dedicated Shopify POS location ID, exact event details, and an ISO event window of no more than 18 hours. It reads paid Shopify POS/event orders that were authoritatively matched to that location, deduplicates by normalized email, and reports every eligible or suppressed customer with a reason.

`event_welcome_send` uses the same authoritative preview logic and additionally requires:

- exact confirmation `SEND NUVIRA EVENT WELCOMES`;
- production journey mode and every existing customer-journey policy gate to be open;
- no more than 100 eligible recipients.
- the current time to be at or after the configured event end plus two hours.

The send path uses the stable idempotency key `event_welcome:<event_key>:<normalized_email>`. A retry cannot create a second welcome for the same customer and event.

For future automatic scheduling, the Event record must have `event_welcome_enabled: true`, a date, start time, end time, public event name and location, and the dedicated Shopify POS location GID. The admin Events editor validates these fields before saving and labels configured rows `Welcome +2h`.

## Eligibility and suppression

A customer is eligible only when the earliest paid POS/event order was matched to the configured Shopify location, occurred inside the event window, has a valid external email, has no paid NuVira purchase before the event window, has current subscribed promotional consent and enabled promotion preferences, has no prior event welcome for that event, and has no cadence conflict. Event notes and time-window proximity are never accepted as substitutes for a verified location match.

The shared cadence layer makes the event and general loyalty welcome mutually exclusive for the same moment. An accepted welcome starts the 72-hour recipient cooldown, so the next welcome event is suppressed.

## August 22 configuration

```json
{
  "event_key": "s2-st-peters-customer-appreciation-bbq-2026-08-22",
  "event_name": "Supplement Superstores St. Peters Customer Appreciation BBQ",
  "event_date": "Saturday, August 22, 2026",
  "event_location": "Supplement Superstores — St. Peters, 181 Mid Rivers Mall Dr., St. Peters, MO 63376",
  "shopify_pos_location_id": "gid://shopify/Location/86197370970",
  "window_start": "2026-08-22T15:00:00.000Z",
  "window_end": "2026-08-22T19:00:00.000Z"
}
```

## Launch sequence

The sequence below documents the August 22 manual launch. Future events use the configured Event record and the immediate `nuvira.event.welcome.ready` provider automation instead of starting a fresh provider delay.

1. Deploy this source and entity update.
2. Confirm every POS device is assigned to the dedicated August 22 Shopify location and process one reversible test sale.
3. Verify the mirrored order reports `event_attribution_status: matched`, the expected location GID, and the correct event details.
4. Invoke `event_welcome_preview` with the August 22 configuration after event sales finish syncing.
5. Reconcile eligible and suppressed counts against the POS orders view and resolve any POS attribution alerts.
6. Run an internal function proof for `event_customer_welcome` and confirm the provider event is accepted.
7. Start the disabled Resend automation only after the function proof succeeds.
8. Re-run the preview and invoke `event_welcome_send` with the exact confirmation.
9. Re-run the same request and verify every previously sent row is reported as already recorded, with zero additional sends.

Do not replace this flow with an all-POS trigger. A POS sale with a missing, unknown, ambiguous, or temporarily unavailable event lookup remains recorded but is held out of event marketing and creates an operational review alert.

## Verification

- `node scripts/migration/run-g118-event-welcome-tests.mjs`
- `node scripts/migration/run-g124-admin-new-member-push-tests.mjs`
- `node scripts/migration/run-g119-pos-event-attribution-tests.mjs`
- `node scripts/migration/run-g66-customer-journey-automation-tests.mjs`
- `node scripts/migration/run-g111-unified-email-communications-tests.mjs`
- `tsc -p ./jsconfig.json`
- `git diff --check`

All checks passed locally on August 21, 2026. The test suite performs no provider calls, customer sends, or production writes.
