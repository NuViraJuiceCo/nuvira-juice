#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');

const inquiryGateway = read('base44/functions/getCustomerAccountDashboardData/handlers/submitCustomerInquiry/entry.ts');
const customerGateway = read('base44/functions/getCustomerAccountDashboardData/entry.ts');
const inquirySchema = JSON.parse(read('base44/entities/CustomerInquiry.jsonc'));
const deliverySchema = JSON.parse(read('base44/entities/CustomerMessageDeliveryLog.jsonc'));
const inquiryClient = read('src/lib/customerCommunications.js');
const resendWebhook = read('base44/functions/resendWebhook/entry.ts');
const journeyEntry = read('base44/functions/customerJourneyAutomation/entry.ts');
const journey = read('base44/functions/customerJourneyAutomation/customerJourneyAutomation.ts');
const sitemap = read('base44/functions/generateSitemap/entry.ts');
const localSeo = read('src/pages/LocalSeoLanding.jsx');
const about = read('src/pages/About.jsx');
const whyNuvira = read('src/pages/WhyNuVira.jsx');
const home = read('src/pages/Home.jsx');

const customerFormFiles = [
  'src/pages/Contact.jsx',
  'src/pages/Support.jsx',
  'src/pages/Partner.jsx',
  'src/pages/BookEvent.jsx',
  'src/pages/Merch.jsx',
  'src/components/checkout/OutOfAreaModal.jsx',
  'src/components/delivery/WaitlistForm.jsx',
];

assert.equal(inquirySchema.name, 'CustomerInquiry');
assert.deepEqual(inquirySchema.properties.inquiry_type.enum, [
  'contact',
  'support',
  'event',
  'partnership',
  'merch_waitlist',
  'delivery_waitlist',
]);

for (const messageType of ['customer_inquiry', 'internal_operations', 'marketing_lifecycle']) {
  assert.ok(deliverySchema.properties.message_type.enum.includes(messageType));
}

for (const file of customerFormFiles) {
  const source = read(file);
  assert.doesNotMatch(source, /integrations\.Core\.SendEmail/);
  assert.match(source, /submitCustomerInquiry/);
}

assert.match(inquiryClient, /functions\.invoke\('customerJourneyAutomation'/);
assert.match(inquiryClient, /action: 'submit_customer_inquiry'/);
assert.match(customerGateway, /"submitCustomerInquiry": handler22/);
assert.match(journeyEntry, /action === 'submit_customer_inquiry'/);
assert.match(journeyEntry, /submitCustomerInquiry\(forwarded\)/);
assert.match(inquiryGateway, /NuVira Juice Co <operations@nuvirajuice\.com>/);
assert.match(inquiryGateway, /NuVira Support <support@nuvirajuice\.com>/);
assert.match(inquiryGateway, /NuVira Juice Co <hello@nuvirajuice\.com>/);
assert.match(inquiryGateway, /to: \[SUPPORT_EMAIL\]/);
assert.match(inquiryGateway, /reply_to: SUPPORT_EMAIL/);
assert.match(inquiryGateway, /Idempotency-Key/);
assert.match(inquiryGateway, /priorInquiry\?\.status === 'acknowledged'/);
assert.match(inquiryGateway, /priorInquiry \|\| repeated \|\| await/);
assert.match(inquiryGateway, /inquiry_rate_limited/);
assert.match(inquiryGateway, /NuVira Juice Company, 619 N\. Main St\., O'Fallon, MO 63366/);

assert.match(resendWebhook, /resend_provider:/);
assert.match(resendWebhook, /resend_webhook_auto_managed/);
assert.match(resendWebhook, /category === 'transactional_order'/);
assert.match(resendWebhook, /message_type: category === 'customer_inquiry' \? 'customer_inquiry' : 'marketing_lifecycle'/);

assert.match(journey, /purchase_completion_control_event_forwarded: true/);
assert.match(journey, /const isProviderControlEvent = eventName === 'purchase_completed'/);
assert.match(localSeo, /Hydration and Radiance are available for 2 or 3 days/);
assert.match(localSeo, /Reset remains a 3-day program/);
assert.match(localSeo, /8- or 12-bottle structure/);
assert.doesNotMatch(sitemap, /['"]\/subscribe['"]/);
assert.doesNotMatch(about, /subscription/i);
assert.match(about, /Every offering is built around fresh, scheduled production and clear delivery timing/);
assert.doesNotMatch(home, /SubscriptionCard|Subscription visibility card/);
assert.doesNotMatch(whyNuvira, /subscription deliveries arrive|active subscription/i);
for (const publicStoryPage of [about, whyNuvira]) {
  assert.match(publicStoryPage, /min-w-0 max-w-[45]xl break-words font-heading text-\[2rem\]/);
  assert.match(publicStoryPage, /min-w-0 max-w-2xl break-words text-base/);
}

const partner = read('src/pages/Partner.jsx');
assert.doesNotMatch(partner, /age_confirmation|placeholder="Age"|form\.age/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g112-communication-completion',
  unified_customer_reply_to: 'support@nuvirajuice.com',
  customer_form_provider: 'resend',
  subscription_marketing_live: false,
  customer_provider_calls_performed: false,
  production_writes_performed: false,
}, null, 2));
