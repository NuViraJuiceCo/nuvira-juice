# G118 event welcome automation

Prepared: August 21, 2026

## Purpose

Send one consent-aware, event-specific welcome email to a first-time NuVira customer after a paid event POS purchase without treating every POS buyer as a new event customer.

## Provider configuration

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

## Server actions

`event_welcome_preview` is an admin/owner-only dry run. It requires an explicit event key, exact event details, and an ISO event window of no more than 18 hours. It reads paid Shopify POS/event orders, deduplicates by normalized email, and reports every eligible or suppressed customer with a reason.

`event_welcome_send` uses the same authoritative preview logic and additionally requires:

- exact confirmation `SEND NUVIRA EVENT WELCOMES`;
- production journey mode and every existing customer-journey policy gate to be open;
- no more than 100 eligible recipients.

The send path uses the stable idempotency key `event_welcome:<event_key>:<normalized_email>`. A retry cannot create a second welcome for the same customer and event.

## Eligibility and suppression

A customer is eligible only when the earliest paid POS/event order for the event window has a valid external email, no paid NuVira purchase before the event window, current subscribed promotional consent, enabled promotion preferences, no prior event welcome for that event, and no cadence conflict.

The shared cadence layer makes the event and general loyalty welcome mutually exclusive for the same moment. An accepted welcome starts the 72-hour recipient cooldown, so the next welcome event is suppressed.

## August 22 configuration

```json
{
  "event_key": "s2-st-peters-customer-appreciation-bbq-2026-08-22",
  "event_name": "Supplement Superstores St. Peters Customer Appreciation BBQ",
  "event_date": "Saturday, August 22, 2026",
  "event_location": "Supplement Superstores — St. Peters, 181 Mid Rivers Mall Dr., St. Peters, MO 63376",
  "window_start": "2026-08-22T15:00:00.000Z",
  "window_end": "2026-08-22T19:00:00.000Z"
}
```

## Launch sequence

1. Deploy this source and entity update.
2. Invoke `event_welcome_preview` with the August 22 configuration after event sales finish syncing.
3. Reconcile eligible and suppressed counts against the POS orders view.
4. Run an internal function proof for `event_customer_welcome` and confirm the provider event is accepted.
5. Start the disabled Resend automation only after the function proof succeeds.
6. Re-run the preview and invoke `event_welcome_send` with the exact confirmation.
7. Re-run the same request and verify every previously sent row is reported as already recorded, with zero additional sends.

Do not replace this flow with an all-POS trigger. Prior live event sales were stored with only a generic POS source and no reliable event name.

## Verification

- `node scripts/migration/run-g118-event-welcome-tests.mjs`
- `node scripts/migration/run-g66-customer-journey-automation-tests.mjs`
- `node scripts/migration/run-g111-unified-email-communications-tests.mjs`
- `tsc -p ./jsconfig.json`
- `git diff --check`

All checks passed locally on August 21, 2026. The test suite performs no provider calls, customer sends, or production writes.
