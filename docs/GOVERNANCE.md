# NuVira Customer App - GOVERNANCE FRAMEWORK

**Status:** Production Source of Truth
**Effective Date:** 2026-05-18
**Owner:** NuViraJuiceCo

---

## Purpose

GitHub is the **authoritative source** for all NuVira Customer App code and changes. This governance framework ensures:

✅ **Traceability** - Every change has a commit with clear authorship
✅ **Reviewability** - All changes visible as diffs before deployment
✅ **Reversibility** - Every change includes rollback steps
✅ **Verifiability** - Changes tested against critical flows
✅ **Independence** - Verification independent of AI system claims

---

## Critical Flows (Protected - Regression Testing Required)

**These flows must pass regression tests before any merge:**

### Payment & Checkout
- Customer checkout flow (cart → order)
- Stripe payment processing
- Order creation and validation
- Payment failures and retry logic

### Order Management  
- Order creation and state management
- Hub sync (real-time order sync)
- Order status updates
- Delivery window assignment

### Subscriptions
- Subscription creation
- Subscription renewal (automated)
- Subscription pause/resume
- Subscription cancellation with refunds

### Integrations
- Hub sync (Orders, Customers, Loyalty)
- Shopify POS sync
- Notification delivery (Email, SMS, Push)

### Loyalty & Rewards
- Points accumulation
- Credit reconciliation
- Reward redemption
- Loyalty member sync to Hub

### Fulfillment & Delivery
- Production window assignment
- Delivery window assignment  
- Delivery ETA calculation
- Fulfillment scheduling

---

## Branch Strategy

```
main (Production)
  ↑ Merge only after verification
  ├── staging (Pre-prod)
  ├── fix/* (Bug fixes)
  └── audit/* (Reviews, investigations)
```

**Branch Rules:**
- **main** - Production code, stable only. Protected: requires verification.
- **staging** - Integration testing, pre-production verification
- **fix/*** - Bug fixes (e.g., `fix/stripe-webhook-race-condition`)
- **audit/*** - Audits, investigations (e.g., `audit/loyalty-reconciliation`). NO CODE CHANGES.

---

## Pre-Merge Verification Checklist

### Every change must pass this checklist:

- [ ] **Code Inspection** - Identify all modified files and affected flows
- [ ] **Diff Review** - Review exact code changes on GitHub
- [ ] **Regression Tests** - Run tests for all affected critical flows
- [ ] **Live Behavior** - Verify behavior in staging or production
- [ ] **Rollback Plan** - Document rollback steps in commit message
- [ ] **CHANGELOG** - Entry added with change description and verification status

---

## Commit Naming Convention

```
fix/DESCRIPTION       - Bug fixes (e.g., fix/stripe-webhook-timing)
audit/DESCRIPTION     - Audits, investigations (e.g., audit/loyalty-reconciliation)
docs/DESCRIPTION      - Documentation only (e.g., docs/critical-flows-guide)
chore/DESCRIPTION     - Maintenance, config (e.g., chore/update-dependencies)
```

---

## Change Verification Process

**Step 1: Code Inspection**
- Identify exact files being modified
- Map which critical flows are affected
- Check for side effects or state mutations

**Step 2: Branch & Implement**
- Create branch from main: `git checkout -b fix/description`
- Make minimal, focused changes
- Commit with clear message including rollback steps

**Step 3: Test**
- Run regression tests for affected flows
- Manual verification in staging environment
- Document test results

**Step 4: Review Diff**
- Compare branch to main: `git diff main...<branch>`
- Verify no unexpected changes
- Check for code quality issues

**Step 5: Verify Live Behavior**
- Test in staging environment OR production (if safe)
- Confirm critical flows work as expected
- No regressions observed

**Step 6: Merge & Deploy**
- Merge to main
- Update CHANGELOG.md
- Deploy via standard procedure
- Monitor logs for errors

---

## Rollback Procedure

### Quick Rollback (Emergency)

```bash
# 1. Find the problematic commit
git log --oneline main | head -10

# 2. Revert it
git revert <commit-sha>

# 3. Review the revert
git show HEAD

# 4. Deploy the revert
# (use standard deployment)

# 5. Update CHANGELOG with rollback reason
```

### Post-Incident Audit

1. Create audit branch: `git checkout -b audit/incident-YYYYMMDD`
2. Document root cause, impact, and learnings
3. Merge audit findings to main
4. Update governance if needed

---

## GitHub = Source of Truth

**AI system claims are NOT trusted without verification.**

### Verification Process

1. **Review the Diff** - Check GitHub for exact changes
2. **Trace the Functions** - Verify all affected code paths
3. **Test the Behavior** - Manually verify flow behavior
4. **Check Logs** - Verify execution matches claims
5. **Compare Baseline** - Ensure no unexpected changes

### When to Reject Claims

- Code diff shows changes not claimed
- Claims reference non-existent functions
- Claimed behavior doesn't match actual code
- Rollback steps don't match actual changes
- Undocumented side effects exist

---

## File Structure

```
├── README.md                          # App overview & deployment
├── CHANGELOG.md                       # Production change log (REQUIRED)
├── docs/
│   ├── GOVERNANCE.md                 # This file
│   ├── CRITICAL_FLOWS.md             # Flow verification procedures
│   ├── ARCHITECTURE.md               # System architecture
│   └── ADR/                          # Architecture Decision Records
├── src/
│   ├── pages/                        # Page components
│   ├── components/                   # UI components
│   ├── hooks/                        # Custom React hooks
│   ├── utils/                        # Utilities
│   └── lib/                          # Libraries
├── api/                              # Cloud Functions (backend)
│   ├── stripe*/                      # Payment processing
│   ├── orders*/                      # Order management
│   ├── subscriptions*/               # Subscription lifecycle
│   ├── loyalty*/                     # Loyalty/rewards
│   ├── hub*/                         # Hub integrations
│   └── notifications*/               # Notifications
└── public/                           # Static assets
```

---

## Review Cadence

- **Daily** - Monitor CHANGELOG for unexpected changes
- **Weekly** - Review critical flow status
- **Monthly** - Audit production changes against this policy
- **Quarterly** - Full architecture and dependency review

---

## Incident Response

**Upon Production Issue:**

1. **Document** - Timestamp, behavior, impact
2. **Investigate** - Identify culprit commit(s)
3. **Decide** - Rollback vs. Fix Forward
4. **Execute** - Apply decision (revert or fix)
5. **Verify** - Test critical flows
6. **Audit** - Post-incident investigation branch
7. **Learn** - Update governance if needed

---

**Last Updated:** 2026-05-18  
**Next Review:** 2026-06-18  
**Approval Required For Changes:** Repository Owner
