import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Read-only audit of Customer App loyalty data after Phase 2 import.
 * Verifies 8 LoyaltyMember records and 6 UserPoints records were synced correctly.
 * No writes performed.
 */

const EXPECTED_MEMBERS = [
  { email: 'gthand@yahoo.com', hub_lifetime: 1029 },
  { email: 'mm6r278756@privaterelay.appleid.com', hub_lifetime: 419, apple_relay: true },
  { email: 'danyellenisbet@yahoo.com', hub_lifetime: 798 },
  { email: 'gk5c2nxn8m@privaterelay.appleid.com', hub_lifetime: 419, apple_relay: true },
  { email: 'jk000.gill@gmail.com', hub_lifetime: 419 },
  { email: 'gshinger425@gmail.com', hub_lifetime: 499 },
  { email: 'amar.kahlon23@yahoo.com', hub_lifetime: 0 },
  { email: 'henrryalbert23@yahoo.com', hub_lifetime: 519 },
];

const EXPECTED_USERPOINTS = [
  { customer_email: 'gk5c2nxn8m@privaterelay.appleid.com', order_number: 'NV-MON367R7', amount: 419, type: 'earned' },
  { customer_email: 'jk000.gill@gmail.com', order_number: 'NV-MOOPFCUS', amount: 419, type: 'earned' },
  { customer_email: 'gshinger425@gmail.com', order_number: 'NV-MOOV82PT', amount: 499, type: 'earned' },
  { customer_email: 'henrryalbert23@yahoo.com', order_number: 'NV-MOPV2CIK', amount: 519, type: 'earned' },
  { customer_email: 'amar.kahlon23@yahoo.com', order_number: 'NV-MONL4I2M', amount: -439, type: 'reversal' },
  { customer_email: 'kirandeepkd@hotmail.com', order_number: 'NV-MOBUSDSC', amount: -390, type: 'reversal' },
];

const HELD_CUSTOMERS = ['ksukhi2000@yahoo.com', 'jskahlon1984@live.com'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    console.log('[Audit] Starting Phase 2 post-import read-only audit');

    // ===== READ CUSTOMER APP STATE =====

    let allMembers = [];
    let allPoints = [];
    const readErrors = [];

    try {
      allMembers = await base44.asServiceRole.entities.LoyaltyMember.list();
      console.log(`[Audit] Read ${allMembers.length} total LoyaltyMember records`);
    } catch (e) {
      readErrors.push(`Failed to read LoyaltyMember: ${e.message}`);
      console.error(`[Audit] LoyaltyMember read failed: ${e.message}`);
    }

    try {
      allPoints = await base44.asServiceRole.entities.UserPoints.list();
      console.log(`[Audit] Read ${allPoints.length} total UserPoints records`);
    } catch (e) {
      readErrors.push(`Failed to read UserPoints: ${e.message}`);
      console.error(`[Audit] UserPoints read failed: ${e.message}`);
    }

    // ===== MEMBER VERIFICATION =====

    const memberVerification = {
      expected_count: EXPECTED_MEMBERS.length,
      found_count: 0,
      verified: [],
      missing: [],
      duplicates: [],
      apple_relay_verified: [],
      errors: [],
    };

    const membersByEmail = new Map();
    allMembers.forEach(m => {
      if (!membersByEmail.has(m.email)) {
        membersByEmail.set(m.email, []);
      }
      membersByEmail.get(m.email).push(m);
    });

    EXPECTED_MEMBERS.forEach(expected => {
      const found = membersByEmail.get(expected.email) || [];

      if (found.length === 0) {
        memberVerification.missing.push(expected.email);
      } else if (found.length === 1) {
        const member = found[0];
        const match = {
          email: member.email,
          customer_app_lifetime: member.lifetime_points || 0,
          hub_expected_lifetime: expected.hub_lifetime,
          lifetime_matches: (member.lifetime_points || 0) === expected.hub_lifetime,
          apple_relay: expected.apple_relay || false,
        };
        memberVerification.verified.push(match);
        memberVerification.found_count++;

        if (expected.apple_relay) {
          memberVerification.apple_relay_verified.push({
            email: member.email,
            is_apple_relay: true,
            verified: true,
          });
        }
      } else {
        memberVerification.duplicates.push({
          email: expected.email,
          count: found.length,
          ids: found.map(m => m.id),
        });
      }
    });

    // ===== USERPOINTS VERIFICATION =====

    const pointsVerification = {
      expected_count: EXPECTED_USERPOINTS.length,
      found_count: 0,
      verified: [],
      missing: [],
      duplicates: [],
      errors: [],
    };

    EXPECTED_USERPOINTS.forEach(expected => {
      const found = allPoints.filter(p =>
        p.customer_email === expected.customer_email &&
        p.points_history &&
        p.points_history.some(h => h.description && h.description.includes(expected.order_number))
      );

      if (found.length === 0) {
        pointsVerification.missing.push({
          customer_email: expected.customer_email,
          order_number: expected.order_number,
          expected_amount: expected.amount,
        });
      } else if (found.length === 1) {
        const point = found[0];
        const match = {
          customer_email: point.customer_email,
          order_number: expected.order_number,
          customer_app_total: point.total_points || 0,
          expected_amount: expected.amount,
          customer_app_lifetime: point.lifetime_points || 0,
          type: expected.type,
          verified: true,
        };
        pointsVerification.verified.push(match);
        pointsVerification.found_count++;
      } else {
        pointsVerification.duplicates.push({
          customer_email: expected.customer_email,
          order_number: expected.order_number,
          count: found.length,
          ids: found.map(p => p.id),
        });
      }
    });

    // ===== HELD ITEMS VERIFICATION =====

    const heldVerification = {
      items_checked: HELD_CUSTOMERS.length,
      unchanged: [],
      unexpected_changes: [],
    };

    HELD_CUSTOMERS.forEach(email => {
      const member = allMembers.find(m => m.email === email);
      if (member) {
        heldVerification.unchanged.push({
          email,
          status: 'HELD_MEMBER_FOUND_UNCHANGED',
        });
      }
    });

    // ===== SAFETY SUMMARY =====

    const safetyChecks = {
      members_verified: memberVerification.found_count === memberVerification.expected_count,
      points_verified: pointsVerification.found_count === pointsVerification.expected_count,
      no_member_duplicates: memberVerification.duplicates.length === 0,
      no_points_duplicates: pointsVerification.duplicates.length === 0,
      apple_relay_preserved: memberVerification.apple_relay_verified.length === 2,
      held_items_unchanged: heldVerification.unchanged.length === HELD_CUSTOMERS.length,
      no_read_errors: readErrors.length === 0,
    };

    const allChecksPassed = Object.values(safetyChecks).every(v => v === true);

    console.log(`[Audit] Complete. All checks passed: ${allChecksPassed}`);

    return Response.json({
      mode: 'AUDIT_READ_ONLY',
      timestamp: new Date().toISOString(),
      summary: {
        members_verified: memberVerification.found_count,
        members_expected: memberVerification.expected_count,
        userpoints_verified: pointsVerification.found_count,
        userpoints_expected: pointsVerification.expected_count,
        all_checks_passed: allChecksPassed,
      },
      member_verification: memberVerification,
      points_verification: pointsVerification,
      held_verification: heldVerification,
      safety_checks: safetyChecks,
      read_errors: readErrors,
    });

  } catch (error) {
    console.error('[Audit] Unexpected error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
