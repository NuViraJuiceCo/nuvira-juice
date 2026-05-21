# calculateNuViraFulfillmentSchedule Staging Test Plan

Status: Gate D staging test plan.

Fixture file:

- `tests/scheduling/calculateNuViraFulfillmentSchedule.fixtures.json`

## Function Response Assertions

For each scheduling fixture with non-null `input_now_iso`:

1. Invoke `calculateNuViraFulfillmentSchedule` with:

```json
{
  "created_at": "<input_now_iso>"
}
```

2. Assert:

- `ok` is `true`
- `assigned_production_day` equals `expected_production_date`
- `production_date` equals `expected_production_date`
- `assigned_delivery_date` equals `expected_delivery_date`
- `delivery_date` equals `expected_delivery_date`
- `delivery_window_label` equals `expected_delivery_window_label`
- `bucket` equals `expected_bucket`
- `cutoff_window_label` equals `expected_cutoff_window_label`
- `delivery_window_timezone` equals `America/Chicago`
- `schedule_timezone` equals `America/Chicago`
- `final_schedule_source` equals `backend_cadence`

## Options Mode Assertions

Invoke `calculateNuViraFulfillmentSchedule` with:

```json
{
  "mode": "options",
  "created_at": "<input_now_iso>",
  "option_count": 2
}
```

Assert:

- `ok` is `true`
- `timezone` equals `America/Chicago`
- `generated_at` is an ISO timestamp
- `options` is a non-empty array
- `options[0].is_default` is `true`
- `options[0].production_date` equals `expected_production_date`
- `options[0].delivery_date` equals `expected_delivery_date`
- `options[0].delivery_window_label` equals `expected_delivery_window_label`
- `options[0].final_schedule_source` equals `backend_cadence`
- no Saturday option has `Wednesday 5 PM - 8 PM` or legacy `5 PM - 8 PM`
- no Sunday delivery option is returned

## Stale Selection Assertions

Use this staged checkout validation scenario:

1. Generate options at Friday 1:59 PM America/Chicago.
2. Submit the Friday/Saturday option to `createPaymentIntent` using a backend validation timestamp after Friday 2:00 PM.
3. Assert the backend does not create a PaymentIntent.
4. Assert response shape:

```json
{
  "ok": false,
  "error_code": "STALE_DELIVERY_SELECTION",
  "message": "That delivery window is no longer available. Please select a new delivery window.",
  "latest_options": []
}
```

5. Assert `latest_options[0]` is the Tuesday/Wednesday backend option.

## Route Review Assertions

For route review approval:

- Authorization request must not write a final schedule.
- Approval must calculate schedule at approval time.
- Approval must write:
  - `assigned_production_day`
  - `production_date` transition alias
  - `assigned_delivery_date`
  - `delivery_window_label`
  - `assigned_delivery_window_start`
  - `assigned_delivery_window_end`
  - `delivery_window_timezone`
  - `final_schedule_source`
  - `scheduling_reason`
  - `cutoff_window_label`
  - `schedule_timezone`
- `final_schedule_source` must be `route_review_approval`.

## Waitlist Assertions

For `waitlist_only` zones:

- `waitlist_only_zone_no_schedule` is a policy fixture, not a schedule-engine invocation fixture.
- No schedule is calculated for checkout.
- No PaymentIntent is created.
- No Order is created.
- Customer may only submit waitlist/lead information.
