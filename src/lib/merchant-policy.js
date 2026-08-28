import { SITE_URL } from './seo-slugs.js';

export const MERCHANT_RETURN_POLICY_PATH = '/returns';
export const MERCHANT_RETURN_POLICY_URL = `${SITE_URL}${MERCHANT_RETURN_POLICY_PATH}`;
export const MERCHANT_RETURN_POLICY_ID = `${MERCHANT_RETURN_POLICY_URL}#policy`;

export const MERCHANT_RETURN_POLICY = {
  '@type': 'MerchantReturnPolicy',
  '@id': MERCHANT_RETURN_POLICY_ID,
  applicableCountry: 'US',
  returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
  merchantReturnLink: MERCHANT_RETURN_POLICY_URL,
};

export const MERCHANT_RETURN_POLICY_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'OnlineStore',
  '@id': `${SITE_URL}/#organization`,
  name: 'NuVira Juice Co.',
  url: SITE_URL,
  hasMerchantReturnPolicy: MERCHANT_RETURN_POLICY,
};

export const MERCHANT_RETURN_POLICY_CONTENT = {
  qualityIssues: 'If your order arrives damaged, incorrect, or does not meet our quality standards, contact us within 24 hours of delivery. We will issue a full refund or replacement at no charge.',
  refundTiming: 'Approved refunds are issued to the original payment method within 5-10 business days. Your bank or card provider may control when the credit appears.',
  noPhysicalReturns: 'For health and safety reasons, we cannot accept physical returns of consumable food or juice products once delivered.',
  cancellations: 'Orders may be cancelled before production begins, typically the day before your scheduled delivery. Contact us as soon as possible so we can confirm whether production has started.',
};
