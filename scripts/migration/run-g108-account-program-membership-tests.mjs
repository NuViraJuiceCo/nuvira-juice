#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const account = fs.readFileSync('src/pages/Account.jsx', 'utf8');
const programCard = fs.readFileSync('src/components/account/MemberProgramCard.jsx', 'utf8');
const critical = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');
const results = [];
const pass = (name) => results.push({ name, ok: true });

assert.doesNotMatch(account, /My Subscriptions|Weekly Ritual|account\/subscriptions|active_subscriptions/);
pass('account_removes_subscription_specific_member_controls');

assert.match(account, /useActiveProgramJourney\(Boolean\(user\?\.email\)\)/);
assert.match(account, /PROGRAM_BY_KEY\[activeJourney\.program_key\]/);
assert.match(account, /activeJourney\.status === 'ready' \? 'Ready to Begin' : 'Program Active'/);
pass('account_uses_authenticated_program_journey_state');

assert.match(account, /<p[^>]*>Program<\/p>/);
assert.match(account, /activeProgram\?\.name \|\| 'Explore'/);
assert.match(account, /to=\{programPath\}/);
pass('account_snapshot_replaces_ritual_with_actionable_program_status');

assert.match(account, /<MemberProgramCard[\s\S]*journey=\{activeJourney\}[\s\S]*isError=\{isProgramError\}[\s\S]*onRetry=\{refetchPrograms\}/);
assert.match(account, /label: 'My Program Journeys'/);
assert.match(account, /Current and completed program guides/);
pass('account_program_panel_and_menu_cover_current_and_completed_journeys');

assert.match(programCard, /PROGRAM_BY_KEY\[journey\.program_key\]/);
assert.match(programCard, /completedSteps \/ totalSteps/);
assert.match(programCard, /account\/programs\/\$\{encodeURIComponent\(journey\.id\)\}/);
assert.match(programCard, /Begin My Program/);
assert.match(programCard, /Continue My Program/);
pass('active_program_card_is_program_specific_progress_aware_and_directly_actionable');

assert.match(programCard, /Find your NuVira program/);
assert.match(programCard, /to="\/#programs"/);
assert.match(programCard, /item\.status === 'completed'/);
assert.match(programCard, /Past Journeys \(\{completedCount\}\)/);
pass('no_active_program_state_supports_discovery_and_completed_history');

assert.match(programCard, /aria-label="Loading program status"/);
assert.match(programCard, /Program status unavailable/);
assert.match(programCard, /if \(isError\) return <ErrorCard onRetry=\{onRetry\} \/>/);
assert.match(programCard, /min-h-11/);
assert.match(programCard, /sm:p-5/);
pass('program_panel_has_loading_failure_retry_touch_target_and_responsive_states');

assert.doesNotMatch(account, /Your Ritual/);
assert.match(account, />Your Account<\/p>/);
pass('account_section_language_no_longer_implies_subscription_ritual');

assert.match(critical, /run-g108-account-program-membership-tests\.mjs/);
pass('account_program_regression_is_in_critical_gate');

console.log(JSON.stringify({
  ok: true,
  suite: 'g108-account-program-membership',
  checks: results.length,
  writes_performed: false,
  provider_calls_performed: false,
  results,
}, null, 2));
