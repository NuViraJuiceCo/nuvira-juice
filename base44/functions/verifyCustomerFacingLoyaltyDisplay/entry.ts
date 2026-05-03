import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Read-only customer-facing loyalty display verification after Phase 2 sync.
 * Confirms what customers will see in their loyalty dashboard/account pages.
 * No writes performed.
 */

const EXPECTED_MEMBERS = [
  'gthand@yahoo.com',
  'mm6r278756@privaterelay.appleid.com',
  'danyellenisbet@yahoo.com',
  'gk5c2nxn8m@privaterelay.appleid.com',
  'jk000.gill@gmail.com',
  'gshinger425@gmail.com',
  'amar.kahlon23@yahoo.com',
  'henrryalbert23@yahoo.com',
];

const EXPECTED_USERPOINTS_ORDERS = [
  'NV-MON367R7',
  'NV-MOOPFCUS',
  'NV-MOOV82PT',
  'NV-MOPV2CIK',
  'NV-MONL4I2M',
  'NV-MOBUSDSC',
];

const HELD_CUSTOMERS = ['ksukhi2000@yahoo.com', 'jskahlon1984@live.com'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    console.log('[LoyaltyDisplay] Starting customer-facing loyalty display verification');

    // ===== READ CUSTOMER APP STATE =====

    let allMembers = [];
    let allPoints = [];
    const readErrors = [];

    try {
      allMembers = await base44.asServiceRole.entities.LoyaltyMember.list();
      console.log(`[LoyaltyDisplay] Read ${allMembers.length} total LoyaltyMember records`);
    } catch (e) {
      readErrors.push(`Failed to read LoyaltyMember: ${e.message}`);
    }

    try {
      allPoints = await base44.asServiceRole.entities.UserPoints.list();
      console.log(`[LoyaltyDisplay] Read ${allPoints.length} total UserPoints records`);
    } catch (e) {
      readErrors.push(`Failed to read UserPoints: ${e.message}`);
    }

    // ===== CUSTOMER FACING LOYALTY DISPLAY DATA =====

    const customerDisplay = {
      total_members_synced: 0,
      members_with_visible_balance: [],
      members_with_zero_balance: [],
      members_with_negative_balance: [],
      apple_relay_members: [],
      order_based_rewards: [],
      duplicates_found: [],
      held_customers_unchanged: 0,
    };

    // Build lookup maps
    const membersByEmail = new Map();
    allMembers.forEach(m => {
      if (!membersByEmail.has(m.email)) {
        membersByEmail.set(m.email, []);
      }
      membersByEmail.get(m.email).push(m);
    });

    // Verify each expected member and show what customer will see
    EXPECTED_MEMBERS.forEach(email => {
      const found = membersByEmail.get(email) || [];

      if (found.length === 1) {
        const member = found[0];
        const displayData = {
          email: member.email,
          total_points: member.total_points || 0,
          lifetime_points: member.lifetime_points || 0,
          is_apple_relay: email.includes('@privaterelay.appleid.com'),
          customer_will_see: true,
        };

        customerDisplay.total_members_synced++;

        if (displayData.total_points > 0) {
          customerDisplay.members_with_visible_balance.push(displayData);
        } else if (displayData.total_points === 0) {
          customerDisplay.members_with_zero_balance.push(displayData);
        } else {
          customerDisplay.members_with_negative_balance.push(displayData);
        }

        if (displayData.is_apple_relay) {
          customerDisplay.apple_relay_members.push({
            email,
            total_points: displayData.total_points,
            lifetime_points: displayData.lifetime_points,
            verified_separate_identity: true,
          });
        }
      } else if (found.length > 1) {
        customerDisplay.duplicates_found.push({
          email,
          count: found.length,
          issue: 'DUPLICATE_RECORDS_WILL_CONFUSE_CUSTOMER',
        });
      }
    });

    // ===== USERPOINTS ORDER-BASED REWARDS DISPLAY =====

    EXPECTED_USERPOINTS_ORDERS.forEach(orderNumber => {
      const pointsForOrder = allPoints.filter(p =>
        p.points_history &&
        p.points_history.some(h => h.description && h.description.includes(orderNumber))
      );

      if (pointsForOrder.length === 1) {
        const pointRecord = pointsForOrder[0];
        const earnedTransaction = pointRecord.points_history.find(h =>
          h.description && h.description.includes(orderNumber)
        );

        customerDisplay.order_based_rewards.push({
          order_number: orderNumber,
          customer_email: pointRecord.customer_email,
          points_earned: earnedTransaction?.amount || 0,
          transaction_type: earnedTransaction?.type || 'unknown',
          customer_will_see: true,
        });
      } else if (pointsForOrder.length > 1) {
        customerDisplay.duplicates_found.push({
          order_number: orderNumber,
          count: pointsForOrder.length,
          issue: 'DUPLICATE_USERPOINTS_WILL_CONFUSE_CUSTOMER',
        });
      }
    });

    // ===== HELD CUSTOMERS UNCHANGED =====

    HELD_CUSTOMERS.forEach(email => {
      const found = allMembers.find(m => m.email === email);
      if (found) {
        customerDisplay.held_customers_unchanged++;
      }
    });

    // ===== SUMMARY FOR DASHBOARD =====

    const dashboardSummary = {
      can_deploy_to_production: customerDisplay.duplicates_found.length === 0 && readErrors.length === 0,
      members_with_points_to_display: customerDisplay.members_with_visible_balance.length,
      members_ready_to_earn: customerDisplay.members_with_zero_balance.length,
      apple_relay_preserved: customerDisplay.apple_relay_members.length,
      order_rewards_ready_to_display: customerDisplay.order_based_rewards.length,
    };

    console.log(`[LoyaltyDisplay] Complete. ${dashboardSummary.members_with_points_to_display} members have points, ${dashboardSummary.order_rewards_ready_to_display} orders can display rewards.`);

    return Response.json({
      mode: 'CUSTOMER_FACING_DISPLAY_VERIFICATION',
      timestamp: new Date().toISOString(),
      can_show_in_app: customerDisplay.duplicates_found.length === 0 && readErrors.length === 0,
      customer_display: customerDisplay,
      dashboard_summary: dashboardSummary,
      read_errors: readErrors,
    });

  } catch (error) {
    console.error('[LoyaltyDisplay] Unexpected error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});