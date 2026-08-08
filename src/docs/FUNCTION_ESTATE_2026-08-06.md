# Customer App function estate — 2026-08-06

The Customer App has one owned function manifest: `scripts/audit-function-estate.mjs`.
It is the source of truth for the live backend-function cap and retirement decisions.

## Architecture

- Customer pages use `getCustomerAccountDashboardData` as a controlled gateway for customer account, notification, delivery-eligibility, push-registration, and account-maintenance operations.
- Admin pages use `getAdminOperationsDashboardSummary` as a controlled gateway for read models and explicit admin commands.
- Stripe, Shopify, Resend, payment creation, scheduled lifecycle jobs, transactional communications, and the Customer App ↔ Hub bridge remain separate endpoints because providers, automations, or backend-to-backend calls address them directly.
- Launch previews, exact-order pilots, historical backfills, one-customer repairs, driver-era endpoints, duplicate loyalty mutations, and manual resync tools are retired.

Every handler inside a gateway retains its original authorization, validation, idempotency, and audit boundary. The frontend only changes endpoint routing; it does not gain direct entity-write privileges.

## Audit

Run locally:

```sh
node scripts/audit-function-estate.mjs
```

Compare with the live app:

```sh
node scripts/audit-function-estate.mjs --remote 69d48d0c39891f7945481152
```

The command fails if a declared function is missing locally or the retained set exceeds Base44's 50-function limit.
