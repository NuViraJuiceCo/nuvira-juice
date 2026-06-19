#!/usr/bin/env node
import assert from 'node:assert/strict';

const REQUIRED_CLASSIFICATIONS = [
  'occurrence_exact_linkage_ready',
  'occurrence_preview_lookup_contract_gap',
  'occurrence_link_fields_unpopulated',
  'occurrence_schema_linkage_gap',
  'occurrence_native_order_missing',
  'occurrence_native_task_missing',
  'occurrence_historical_hub_only',
  'occurrence_duplicate_identity_risk',
  'occurrence_repair_replay_hold',
  'active_parent_occurrence_native_read_candidate',
  'active_parent_read_candidate_occurrences_fallback_required',
];

const exactOrderKeys = ['customer_app_order_id', 'base44_order_id', 'order_id', 'order_number'];
const exactNativeOrderKeys = ['native_shopify_order_id', 'shopify_order_id', 'base44_order_id', 'order_number', 'shopify_order_number'];
const exactTaskKeys = ['fulfillment_task_id', 'task_id'];

function present(row, keys) {
  return keys.some((key) => row?.[key] !== undefined && row?.[key] !== null && String(row[key]).trim() !== '');
}

function auditParent({ parent, occurrenceRows = [], logRows = [], sourceContract = {} }) {
  const blockers = [];
  const warnings = ['stripe_billing_source_of_truth', 'hub_recurrence_source_of_truth', 'subscription_writes_held'];
  const classifications = new Set();

  if (!parent) {
    blockers.push('no_active_native_subscription_parent_available');
    classifications.add('active_parent_read_candidate_occurrences_fallback_required');
    return summarize({ parent, occurrenceRows, blockers, warnings, classifications, sourceContract });
  }

  if (parent.status !== 'active') blockers.push('active_parent_required');
  if (parent.duplicate_parent_identity_risk) blockers.push('parent_duplicate_identity_risk');
  if (!parent.exact_owner_profile_link) blockers.push('parent_owner_profile_link_missing');

  const occurrenceResults = occurrenceRows.map((occurrence) => auditOccurrence(occurrence, sourceContract));
  for (const result of occurrenceResults) {
    for (const classification of result.classifications) classifications.add(classification);
    blockers.push(...result.blockers);
  }

  const repairReplayHold = logRows.some((row) => /repair|replay|backfill|retry|failed|manual_review/i.test(`${row.status || ''} ${row.sync_status || ''} ${row.message || ''} ${row.description || ''}`));
  if (repairReplayHold) {
    blockers.push('occurrence_repair_replay_hold');
    classifications.add('occurrence_repair_replay_hold');
  }

  const readyOccurrences = occurrenceResults.filter((result) => result.nativeReadCandidate).length;
  if (parent.status === 'active' && blockers.length === 0 && readyOccurrences > 0) classifications.add('active_parent_occurrence_native_read_candidate');
  else classifications.add('active_parent_read_candidate_occurrences_fallback_required');

  return summarize({ parent, occurrenceRows, blockers, warnings, classifications, occurrenceResults, sourceContract });
}

function auditOccurrence(occurrence, sourceContract = {}) {
  const blockers = [];
  const classifications = new Set();

  const hasOccurrenceIdentity = present(occurrence, ['occurrence_id', 'fulfillment_id', 'fulfillment_number']) || (present(occurrence, ['scheduled_date', 'delivery_date']) && present(occurrence, ['order_number']));
  const hasParentLink = present(occurrence, ['subscription_parent_id', 'customer_app_subscription_id', 'subscription_id', 'stripe_subscription_id']);
  const hasCustomerOrderLink = present(occurrence, exactOrderKeys);
  const hasNativeOrderLink = present(occurrence, exactNativeOrderKeys);
  const hasTaskLink = present(occurrence, exactTaskKeys);

  if (!hasOccurrenceIdentity || !hasParentLink) {
    blockers.push('occurrence_link_fields_unpopulated');
    classifications.add('occurrence_link_fields_unpopulated');
  }
  if (sourceContract.customerOrderSchemaMissingSubscriptionKeys && !hasCustomerOrderLink) {
    blockers.push('occurrence_schema_linkage_gap');
    classifications.add('occurrence_schema_linkage_gap');
  }
  if (!hasNativeOrderLink) {
    blockers.push('occurrence_native_order_missing');
    classifications.add('occurrence_native_order_missing');
  }
  if (!hasTaskLink) {
    blockers.push('occurrence_native_task_missing');
    classifications.add('occurrence_native_task_missing');
  }
  if (occurrence.historical_hub_only) {
    blockers.push('occurrence_historical_hub_only');
    classifications.add('occurrence_historical_hub_only');
  }
  if (occurrence.duplicate_identity_risk) {
    blockers.push('occurrence_duplicate_identity_risk');
    classifications.add('occurrence_duplicate_identity_risk');
  }
  if (occurrence.valid_links_present_but_preview_missed) {
    classifications.add('occurrence_preview_lookup_contract_gap');
  }

  const nativeReadCandidate = blockers.length === 0 && hasOccurrenceIdentity && hasParentLink && hasCustomerOrderLink && hasNativeOrderLink && hasTaskLink;
  if (nativeReadCandidate) classifications.add('occurrence_exact_linkage_ready');

  return {
    blockers,
    classifications,
    hasOccurrenceIdentity,
    hasParentLink,
    hasCustomerOrderLink,
    hasNativeOrderLink,
    hasTaskLink,
    nativeReadCandidate,
  };
}

function summarize({ parent, occurrenceRows, blockers, warnings, classifications, occurrenceResults = [], sourceContract = {} }) {
  const exactCustomerAppOrderLinkCount = occurrenceResults.filter((row) => row.hasCustomerOrderLink).length;
  const exactNativeShopifyOrderLinkCount = occurrenceResults.filter((row) => row.hasNativeOrderLink).length;
  const exactFulfillmentTaskLinkCount = occurrenceResults.filter((row) => row.hasTaskLink).length;
  const nativeOccurrenceReadCandidateCount = occurrenceResults.filter((row) => row.nativeReadCandidate).length;
  return {
    exact_parent_match_count: parent ? 1 : 0,
    parent_status: parent?.status || null,
    occurrence_count: occurrenceRows.length,
    complete_occurrence_identity_count: occurrenceResults.filter((row) => row.hasOccurrenceIdentity && row.hasParentLink).length,
    orphan_occurrence_count: occurrenceResults.filter((row) => !row.hasParentLink).length,
    exact_customer_app_order_link_count: exactCustomerAppOrderLinkCount,
    exact_native_shopify_order_link_count: exactNativeShopifyOrderLinkCount,
    exact_fulfillment_task_link_count: exactFulfillmentTaskLinkCount,
    duplicate_identity_count: occurrenceRows.filter((row) => row.duplicate_identity_risk).length,
    repair_replay_hold_count: blockers.filter((blocker) => blocker === 'occurrence_repair_replay_hold').length,
    native_occurrence_read_candidate_count: nativeOccurrenceReadCandidateCount,
    fallback_required_count: occurrenceRows.length - nativeOccurrenceReadCandidateCount + (parent && parent.status === 'active' ? 0 : 1),
    review_required_count: blockers.length,
    blockers: [...new Set(blockers)],
    warnings,
    classifications: [...classifications],
    writes_performed: false,
    pii_returned: false,
    raw_payloads_returned: false,
    provider_calls: false,
    notifications_sent: false,
    hub_mutation_performed: false,
    source_contract: sourceContract,
  };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('required classifications are enumerated', () => {
  assert.equal(REQUIRED_CLASSIFICATIONS.length, 11);
  assert.ok(REQUIRED_CLASSIFICATIONS.includes('occurrence_preview_lookup_contract_gap'));
  assert.ok(REQUIRED_CLASSIFICATIONS.includes('active_parent_read_candidate_occurrences_fallback_required'));
});

test('no active parent blocks OCC1 without writes', () => {
  const result = auditParent({ parent: null });
  assert.equal(result.exact_parent_match_count, 0);
  assert.ok(result.blockers.includes('no_active_native_subscription_parent_available'));
  assert.ok(result.classifications.includes('active_parent_read_candidate_occurrences_fallback_required'));
  assert.equal(result.writes_performed, false);
});

test('cancelled parent is not an active migration pilot', () => {
  const result = auditParent({ parent: { status: 'cancelled', exact_owner_profile_link: true }, occurrenceRows: [] });
  assert.ok(result.blockers.includes('active_parent_required'));
  assert.ok(result.classifications.includes('active_parent_read_candidate_occurrences_fallback_required'));
});

test('clean active occurrence is a native read candidate', () => {
  const result = auditParent({
    parent: { status: 'active', exact_owner_profile_link: true },
    occurrenceRows: [{ occurrence_id: 'occ_1', subscription_parent_id: 'sub_1', customer_app_order_id: 'ord_1', native_shopify_order_id: 'so_1', fulfillment_task_id: 'task_1' }],
  });
  assert.equal(result.native_occurrence_read_candidate_count, 1);
  assert.ok(result.classifications.includes('active_parent_occurrence_native_read_candidate'));
});

test('missing Customer App Order link causes fallback', () => {
  const result = auditParent({
    parent: { status: 'active', exact_owner_profile_link: true },
    occurrenceRows: [{ occurrence_id: 'occ_1', subscription_parent_id: 'sub_1', native_shopify_order_id: 'so_1', fulfillment_task_id: 'task_1' }],
    sourceContract: { customerOrderSchemaMissingSubscriptionKeys: true },
  });
  assert.equal(result.exact_customer_app_order_link_count, 0);
  assert.ok(result.blockers.includes('occurrence_schema_linkage_gap'));
});

test('missing native ShopifyOrder link is classified', () => {
  const result = auditParent({
    parent: { status: 'active', exact_owner_profile_link: true },
    occurrenceRows: [{ occurrence_id: 'occ_1', subscription_parent_id: 'sub_1', customer_app_order_id: 'ord_1', fulfillment_task_id: 'task_1' }],
  });
  assert.ok(result.blockers.includes('occurrence_native_order_missing'));
  assert.ok(result.classifications.includes('occurrence_native_order_missing'));
});

test('missing FulfillmentTask link is classified', () => {
  const result = auditParent({
    parent: { status: 'active', exact_owner_profile_link: true },
    occurrenceRows: [{ occurrence_id: 'occ_1', subscription_parent_id: 'sub_1', customer_app_order_id: 'ord_1', native_shopify_order_id: 'so_1' }],
  });
  assert.ok(result.blockers.includes('occurrence_native_task_missing'));
});

test('unpopulated occurrence fields are classified', () => {
  const result = auditParent({
    parent: { status: 'active', exact_owner_profile_link: true },
    occurrenceRows: [{ scheduled_date: '2026-06-20' }],
  });
  assert.ok(result.blockers.includes('occurrence_link_fields_unpopulated'));
});

test('orphan occurrence increments orphan count', () => {
  const result = auditParent({
    parent: { status: 'active', exact_owner_profile_link: true },
    occurrenceRows: [{ occurrence_id: 'occ_1', customer_app_order_id: 'ord_1', native_shopify_order_id: 'so_1', fulfillment_task_id: 'task_1' }],
  });
  assert.equal(result.orphan_occurrence_count, 1);
});

test('duplicate occurrence identity blocks readiness', () => {
  const result = auditParent({
    parent: { status: 'active', exact_owner_profile_link: true },
    occurrenceRows: [{ occurrence_id: 'occ_1', subscription_parent_id: 'sub_1', customer_app_order_id: 'ord_1', native_shopify_order_id: 'so_1', fulfillment_task_id: 'task_1', duplicate_identity_risk: true }],
  });
  assert.ok(result.blockers.includes('occurrence_duplicate_identity_risk'));
  assert.equal(result.native_occurrence_read_candidate_count, 0);
});

test('repair replay log blocks readiness', () => {
  const result = auditParent({
    parent: { status: 'active', exact_owner_profile_link: true },
    occurrenceRows: [{ occurrence_id: 'occ_1', subscription_parent_id: 'sub_1', customer_app_order_id: 'ord_1', native_shopify_order_id: 'so_1', fulfillment_task_id: 'task_1' }],
    logRows: [{ status: 'failed_repair_replay_required' }],
  });
  assert.ok(result.blockers.includes('occurrence_repair_replay_hold'));
});

test('historical Hub-only occurrence remains held', () => {
  const result = auditParent({
    parent: { status: 'active', exact_owner_profile_link: true },
    occurrenceRows: [{ occurrence_id: 'occ_1', subscription_parent_id: 'sub_1', historical_hub_only: true }],
  });
  assert.ok(result.blockers.includes('occurrence_historical_hub_only'));
});

test('preview lookup contract gap is separated from missing records', () => {
  const result = auditParent({
    parent: { status: 'active', exact_owner_profile_link: true },
    occurrenceRows: [{ occurrence_id: 'occ_1', subscription_parent_id: 'sub_1', customer_app_order_id: 'ord_1', native_shopify_order_id: 'so_1', fulfillment_task_id: 'task_1', valid_links_present_but_preview_missed: true }],
  });
  assert.ok(result.classifications.includes('occurrence_preview_lookup_contract_gap'));
  assert.equal(result.native_occurrence_read_candidate_count, 1);
});

test('ownership/profile link is required before active candidate', () => {
  const result = auditParent({
    parent: { status: 'active', exact_owner_profile_link: false },
    occurrenceRows: [{ occurrence_id: 'occ_1', subscription_parent_id: 'sub_1', customer_app_order_id: 'ord_1', native_shopify_order_id: 'so_1', fulfillment_task_id: 'task_1' }],
  });
  assert.ok(result.blockers.includes('parent_owner_profile_link_missing'));
  assert.ok(result.classifications.includes('active_parent_read_candidate_occurrences_fallback_required'));
});

test('safe output omits PII/raw/provider effects', () => {
  const result = auditParent({ parent: null });
  assert.equal(result.pii_returned, false);
  assert.equal(result.raw_payloads_returned, false);
  assert.equal(result.provider_calls, false);
  assert.equal(result.notifications_sent, false);
  assert.equal(result.hub_mutation_performed, false);
  assert.equal(JSON.stringify(result).includes('customer_email'), false);
});

test('exact matching keys exclude fuzzy identity', () => {
  const allKeys = [...exactOrderKeys, ...exactNativeOrderKeys, ...exactTaskKeys];
  for (const disallowed of ['customer_name', 'email', 'phone', 'approximate_total', 'newest_record_wins']) {
    assert.equal(allKeys.includes(disallowed), false);
  }
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    console.error(`not ok ${passed + 1} - ${name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log(`\nG46B-OCC1 active subscription occurrence linkage gap audit tests passed (${passed}/${tests.length}).`);
