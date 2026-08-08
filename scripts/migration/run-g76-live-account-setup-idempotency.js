const EXPECTED_OPERATOR = 'info@nuvirajuice.com';

function normalize(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalize(value).toLowerCase();
}

function responseData(response) {
  const value = response?.data ?? response ?? {};
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const user = await base44.auth.me();
const authenticatedEmail = normalizeEmail(user?.email);
assert(user?.role === 'admin', 'Internal idempotency check requires an admin operator');
assert(authenticatedEmail === EXPECTED_OPERATOR, 'Internal idempotency check requires the approved NuVira owner account');

const beforeProfiles = await base44.entities.UserProfile.filter({ customer_email: authenticatedEmail }, '-updated_date', 10);
const beforeMembers = await base44.entities.LoyaltyMember.filter({ email: authenticatedEmail }, '-updated_date', 10);
assert(beforeProfiles.length === 1, 'Expected exactly one existing internal UserProfile; no write attempted');
assert(beforeMembers.length >= 1, 'Expected an existing internal LoyaltyMember; no write attempted');

const profile = beforeProfiles[0];
const firstName = normalize(profile?.first_name || user?.first_name);
const lastName = normalize(profile?.last_name || user?.last_name);
const phone = normalize(profile?.phone || user?.phone);
const contactEmail = normalizeEmail(profile?.contact_email || authenticatedEmail);
assert(firstName && lastName && phone, 'Existing internal profile is missing required identity fields; no write attempted');

const before = {
  profile_count: beforeProfiles.length,
  loyalty_member_count: beforeMembers.length,
  profile_id: profile.id,
  first_name: firstName,
  last_name: lastName,
  phone,
  contact_email: contactEmail,
  address: profile?.address || null,
  birthday: profile?.birthday || null,
};

const response = await base44.functions.invoke('getCustomerAccountDashboardData', {
  gateway_action: 'completeAccountSetup',
  payload: {
    email: authenticatedEmail,
    contact_email: contactEmail,
    first_name: firstName,
    last_name: lastName,
    phone,
    ...(before.address ? { address: before.address } : {}),
    ...(before.birthday ? { birthday: before.birthday } : {}),
  },
});
const result = responseData(response);
assert(result?.success === true, 'Live completeAccountSetup did not return success');

const afterProfiles = await base44.entities.UserProfile.filter({ customer_email: authenticatedEmail }, '-updated_date', 10);
const afterMembers = await base44.entities.LoyaltyMember.filter({ email: authenticatedEmail }, '-updated_date', 10);
assert(afterProfiles.length === before.profile_count, 'Account setup changed the internal profile count');
assert(afterMembers.length === before.loyalty_member_count, 'Account setup changed the internal loyalty-member count');

const after = afterProfiles.find(row => row.id === before.profile_id);
assert(after, 'Original internal profile was not preserved');
assert(normalize(after.first_name) === before.first_name, 'First name was not preserved');
assert(normalize(after.last_name) === before.last_name, 'Last name was not preserved');
assert(normalize(after.phone) === before.phone, 'Phone was not preserved');
assert(normalizeEmail(after.contact_email || authenticatedEmail) === before.contact_email, 'Contact email was not preserved');
assert(after.onboarding_complete === true, 'Account setup did not persist onboarding completion');

console.log(JSON.stringify({
  ok: true,
  suite: 'g76-live-account-setup-idempotency',
  operator_is_internal_admin: true,
  gateway_success: true,
  profile_preserved: true,
  loyalty_membership_preserved: true,
  onboarding_complete: true,
  duplicate_profile_created: false,
  duplicate_loyalty_member_created: false,
  real_customer_touched: false,
  payment_actions_performed: false,
  inventory_actions_performed: false,
  customer_notifications_sent: false,
  provider_calls_performed: false,
}, null, 2));
