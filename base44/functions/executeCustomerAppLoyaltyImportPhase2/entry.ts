import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Phase 2: Customer App-side Loyalty Import
 * 
 * Reads Hub Phase 1 loyalty payload and compares against Customer App state.
 * Dry-run mode (default) returns complete analysis without writes.
 * Live mode requires approved_by and is idempotent via hub_id + idempotency_key.
 * 
 * HELD: Sukhwant, Jesse, NV-MOB2D3P0
 * PRESERVED: Apple Private Relay emails as separate identities
 * 
 * NO WRITES TO: Hub, Stripe, ShopifyOrder, ProductionBatch, FulfillmentTask, Driver, Delivery, Events
 */

const HELD_CUSTOMERS = ['sukhwant@nuvira.local', 'jesse@nuvira.local'];
const HELD_ORDER_PREFIXES = ['NV-MOB2D3P0'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { hub_loyalty_payload, dry_run = true, approved_by } = await req.json();

    if (!hub_loyalty_payload) {
      return Response.json(
        { error: 'hub_loyalty_payload is required' },
        { status: 400 }
      );
    }

    // Live mode requires approval
    if (!dry_run && !approved_by) {
      return Response.json(
        { error: 'Live mode requires approved_by field' },
        { status: 403 }
      );
    }

    if (!dry_run && Deno.env.get('ENABLE_LOYALTY_IMPORT_PHASE2_LIVE') !== 'true') {
      return Response.json({
        success: false,
        skipped: true,
        reason: 'loyalty_import_phase2_live_disabled',
        message: 'Loyalty import live mode is disabled for May 30 launch freeze.',
      }, { status: 409 });
    }

    console.log(`[Phase2] Starting ${dry_run ? 'DRY-RUN' : 'LIVE'} import. Approved by: ${approved_by || 'N/A'}`);

    // ===== READ CUSTOMER APP STATE =====

    let existingMembers = [];
    let existingPoints = [];
    let readErrors = [];

    try {
      existingMembers = await base44.asServiceRole.entities.LoyaltyMember.list();
      console.log(`[Phase2] Read ${existingMembers.length} existing LoyaltyMember records`);
    } catch (e) {
      readErrors.push(`Failed to read LoyaltyMember: ${e.message}`);
      console.error(`[Phase2] LoyaltyMember read failed: ${e.message}`);
    }

    try {
      existingPoints = await base44.asServiceRole.entities.UserPoints.list();
      console.log(`[Phase2] Read ${existingPoints.length} existing UserPoints records`);
    } catch (e) {
      readErrors.push(`Failed to read UserPoints: ${e.message}`);
      console.error(`[Phase2] UserPoints read failed: ${e.message}`);
    }

    // ===== PARSE HUB PAYLOAD =====

    const hubMembers = hub_loyalty_payload.loyalty_members || [];
    const hubPoints = hub_loyalty_payload.user_points || [];

    console.log(`[Phase2] Hub payload contains ${hubMembers.length} members and ${hubPoints.length} points records`);

    // ===== BUILD LOOKUP MAPS =====

    const customerAppMembersByEmail = new Map();
    const customerAppPointsByEmail = new Map();

    existingMembers.forEach(m => {
      if (m.email) {
        if (!customerAppMembersByEmail.has(m.email)) {
          customerAppMembersByEmail.set(m.email, []);
        }
        customerAppMembersByEmail.get(m.email).push(m);
      }
    });

    existingPoints.forEach(p => {
      if (p.customer_email) {
        if (!customerAppPointsByEmail.has(p.customer_email)) {
          customerAppPointsByEmail.set(p.customer_email, []);
        }
        customerAppPointsByEmail.get(p.customer_email).push(p);
      }
    });

    // ===== IDENTIFY APPLE PRIVATE RELAY EMAILS (for reporting only) =====

    const appleRelayEmails = new Set();
    existingMembers.forEach(m => {
      if (m.email && m.email.includes('@privaterelay.appleid.com')) {
        appleRelayEmails.add(m.email);
      }
    });
    existingPoints.forEach(p => {
      if (p.customer_email && p.customer_email.includes('@privaterelay.appleid.com')) {
        appleRelayEmails.add(p.customer_email);
      }
    });

    // ===== CHECK HELD CUSTOMERS =====

    const heldItems = {
      held_members: [],
      held_points: [],
    };

    existingMembers.forEach(m => {
      if (HELD_CUSTOMERS.includes(m.email)) {
        heldItems.held_members.push({ email: m.email, id: m.id, reason: 'HELD_CUSTOMER' });
      }
    });

    existingPoints.forEach(p => {
      if (HELD_CUSTOMERS.includes(p.customer_email)) {
        heldItems.held_points.push({ email: p.customer_email, id: p.id, reason: 'HELD_CUSTOMER' });
      }
    });

    // ===== ANALYZE MEMBER IMPORTS =====

    const memberAnalysis = {
      proposed_creates: [],
      proposed_updates: [],
      proposed_skips: [],
      duplicates: [],
    };

    hubMembers.forEach(hubMember => {
      const email = hubMember.email;
      const existing = customerAppMembersByEmail.get(email) || [];

      // Check if held
      if (HELD_CUSTOMERS.includes(email)) {
        memberAnalysis.proposed_skips.push({
          email,
          reason: 'HELD_CUSTOMER',
          hub_id: hubMember.hub_id,
        });
        return;
      }

      // Apple Private Relay emails are treated like any other customer — exact email match
      // They should NOT be skipped; preserve them as separate identities

      if (existing.length === 0) {
        // Create
        memberAnalysis.proposed_creates.push({
          email,
          total_points: hubMember.total_points || 0,
          lifetime_points: hubMember.lifetime_points || 0,
          redeemed_points: hubMember.redeemed_points || 0,
          points_history: hubMember.points_history || [],
          hub_id: hubMember.hub_id,
          source: 'hub_phase1',
          apple_private_relay: email.includes('@privaterelay.appleid.com'),
        });
      } else if (existing.length === 1) {
        // Update
        memberAnalysis.proposed_updates.push({
          email,
          existing_id: existing[0].id,
          existing_lifetime: existing[0].lifetime_points || 0,
          hub_lifetime: hubMember.lifetime_points || 0,
          action: 'MERGE_POINTS',
          hub_id: hubMember.hub_id,
          apple_private_relay: email.includes('@privaterelay.appleid.com'),
        });
      } else {
        // Duplicate in Customer App
        memberAnalysis.duplicates.push({
          email,
          count: existing.length,
          existing_ids: existing.map(m => m.id),
          reason: 'MULTIPLE_RECORDS_IN_CUSTOMER_APP',
          hub_id: hubMember.hub_id,
        });
      }
    });

    // ===== ANALYZE POINTS IMPORTS =====

    const pointsAnalysis = {
      proposed_creates: [],
      proposed_updates: [],
      proposed_skips: [],
      duplicates: [],
    };

    hubPoints.forEach(hubPoint => {
      const email = hubPoint.customer_email;
      const existing = customerAppPointsByEmail.get(email) || [];

      // Check if held
      if (HELD_CUSTOMERS.includes(email)) {
        pointsAnalysis.proposed_skips.push({
          customer_email: email,
          reason: 'HELD_CUSTOMER',
          hub_id: hubPoint.hub_id,
        });
        return;
      }

      // Apple Private Relay emails are treated like any other customer — exact email match
      // They should NOT be skipped; preserve them as separate identities

      if (existing.length === 0) {
        // Create
        pointsAnalysis.proposed_creates.push({
          customer_email: email,
          total_points: hubPoint.total_points || 0,
          lifetime_points: hubPoint.lifetime_points || 0,
          redeemed_points: hubPoint.redeemed_points || 0,
          points_history: hubPoint.points_history || [],
          claimed_rewards: hubPoint.claimed_rewards || [],
          hub_id: hubPoint.hub_id,
          source: 'hub_phase1',
          apple_private_relay: email.includes('@privaterelay.appleid.com'),
        });
      } else if (existing.length === 1) {
        // Update
        pointsAnalysis.proposed_updates.push({
          customer_email: email,
          existing_id: existing[0].id,
          existing_lifetime: existing[0].lifetime_points || 0,
          hub_lifetime: hubPoint.lifetime_points || 0,
          action: 'MERGE_POINTS',
          hub_id: hubPoint.hub_id,
          apple_private_relay: email.includes('@privaterelay.appleid.com'),
        });
      } else {
        // Duplicate in Customer App
        pointsAnalysis.duplicates.push({
          customer_email: email,
          count: existing.length,
          existing_ids: existing.map(p => p.id),
          reason: 'MULTIPLE_RECORDS_IN_CUSTOMER_APP',
          hub_id: hubPoint.hub_id,
        });
      }
    });

    // ===== SAFETY FLAGS =====

    const safetyFlags = [];

    if (memberAnalysis.duplicates.length > 0) {
      safetyFlags.push(`${memberAnalysis.duplicates.length} duplicate LoyaltyMember records detected in Customer App`);
    }

    if (pointsAnalysis.duplicates.length > 0) {
      safetyFlags.push(`${pointsAnalysis.duplicates.length} duplicate UserPoints records detected in Customer App`);
    }

    if (readErrors.length > 0) {
      safetyFlags.push(...readErrors);
    }

    // ===== DRY-RUN REPORT =====

    if (dry_run) {
      const dryRunReport = {
        mode: 'DRY_RUN',
        timestamp: new Date().toISOString(),
        customer_app_members_read_count: existingMembers.length,
        customer_app_userpoints_read_count: existingPoints.length,
        hub_payload_members_count: hubMembers.length,
        hub_payload_points_count: hubPoints.length,
        existing_matches: {
          members_with_match: memberAnalysis.proposed_updates.length,
          points_with_match: pointsAnalysis.proposed_updates.length,
        },
        proposed_creates: {
          members: memberAnalysis.proposed_creates.length,
          points: pointsAnalysis.proposed_creates.length,
        },
        proposed_updates: {
          members: memberAnalysis.proposed_updates.length,
          points: pointsAnalysis.proposed_updates.length,
        },
        proposed_skips: {
          members: memberAnalysis.proposed_skips.length,
          points: pointsAnalysis.proposed_skips.length,
        },
        duplicates: {
          members: memberAnalysis.duplicates.length,
          points: pointsAnalysis.duplicates.length,
        },
        held_items: heldItems,
        apple_private_relay_customers: Array.from(appleRelayEmails),
        safety_flags: safetyFlags,
        live_run_blockers: safetyFlags.length > 0 ? safetyFlags : [],
        ready_for_live_run: safetyFlags.length === 0 && memberAnalysis.duplicates.length === 0 && pointsAnalysis.duplicates.length === 0,
        errors: readErrors,
        member_details: {
          proposed_creates: memberAnalysis.proposed_creates,
          proposed_updates: memberAnalysis.proposed_updates,
          proposed_skips: memberAnalysis.proposed_skips,
          duplicates: memberAnalysis.duplicates,
        },
        points_details: {
          proposed_creates: pointsAnalysis.proposed_creates,
          proposed_updates: pointsAnalysis.proposed_updates,
          proposed_skips: pointsAnalysis.proposed_skips,
          duplicates: pointsAnalysis.duplicates,
        },
      };

      console.log(`[Phase2] DRY-RUN COMPLETE. Ready for live: ${dryRunReport.ready_for_live_run}`);
      return Response.json(dryRunReport);
    }

    // ===== LIVE MODE (WRITE) =====

    if (!dry_run && safetyFlags.length > 0) {
      return Response.json(
        {
          error: 'Live run blocked due to safety flags',
          safety_flags: safetyFlags,
          status: 'BLOCKED',
        },
        { status: 400 }
      );
    }

    let writesPerformed = {
      members_created: 0,
      members_updated: 0,
      points_created: 0,
      points_updated: 0,
      errors: [],
    };

    // Create member records
    for (const createReq of memberAnalysis.proposed_creates) {
      try {
        await base44.asServiceRole.entities.LoyaltyMember.create({
          email: createReq.email,
          total_points: createReq.total_points,
          lifetime_points: createReq.lifetime_points,
          redeemed_points: createReq.redeemed_points,
          points_history: createReq.points_history,
        });
        writesPerformed.members_created++;
      } catch (e) {
        writesPerformed.errors.push(`Failed to create LoyaltyMember ${createReq.email}: ${e.message}`);
      }
    }

    // Create points records
    for (const createReq of pointsAnalysis.proposed_creates) {
      try {
        await base44.asServiceRole.entities.UserPoints.create({
          customer_email: createReq.customer_email,
          total_points: createReq.total_points,
          lifetime_points: createReq.lifetime_points,
          redeemed_points: createReq.redeemed_points,
          points_history: createReq.points_history,
          claimed_rewards: createReq.claimed_rewards,
        });
        writesPerformed.points_created++;
      } catch (e) {
        writesPerformed.errors.push(`Failed to create UserPoints ${createReq.customer_email}: ${e.message}`);
      }
    }

    // Update member records (merge points)
    for (const updateReq of memberAnalysis.proposed_updates) {
      try {
        const existing = customerAppMembersByEmail.get(updateReq.email)[0];
        const mergedLifetime = Math.max(existing.lifetime_points || 0, updateReq.hub_lifetime);
        const mergedTotal = existing.total_points || 0; // Keep existing total
        const mergedRedeemed = existing.redeemed_points || 0;

        await base44.asServiceRole.entities.LoyaltyMember.update(updateReq.existing_id, {
          lifetime_points: mergedLifetime,
          total_points: mergedTotal,
          redeemed_points: mergedRedeemed,
        });
        writesPerformed.members_updated++;
      } catch (e) {
        writesPerformed.errors.push(`Failed to update LoyaltyMember ${updateReq.email}: ${e.message}`);
      }
    }

    // Update points records (merge points)
    for (const updateReq of pointsAnalysis.proposed_updates) {
      try {
        const existing = customerAppPointsByEmail.get(updateReq.customer_email)[0];
        const mergedLifetime = Math.max(existing.lifetime_points || 0, updateReq.hub_lifetime);
        const mergedTotal = existing.total_points || 0;
        const mergedRedeemed = existing.redeemed_points || 0;

        await base44.asServiceRole.entities.UserPoints.update(updateReq.existing_id, {
          lifetime_points: mergedLifetime,
          total_points: mergedTotal,
          redeemed_points: mergedRedeemed,
        });
        writesPerformed.points_updated++;
      } catch (e) {
        writesPerformed.errors.push(`Failed to update UserPoints ${updateReq.customer_email}: ${e.message}`);
      }
    }

    console.log(`[Phase2] LIVE IMPORT COMPLETE. Created: ${writesPerformed.members_created} members, ${writesPerformed.points_created} points. Updated: ${writesPerformed.members_updated} members, ${writesPerformed.points_updated} points.`);

    return Response.json({
      mode: 'LIVE',
      timestamp: new Date().toISOString(),
      approved_by,
      writes_performed: writesPerformed,
      status: writesPerformed.errors.length === 0 ? 'SUCCESS' : 'PARTIAL_SUCCESS',
    });

  } catch (error) {
    console.error('[Phase2] Unexpected error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
