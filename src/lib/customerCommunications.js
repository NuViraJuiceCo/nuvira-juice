import { base44 } from '@/api/base44Client';

function requestId(type) {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `customer-${type}-${suffix}`;
}

export async function submitCustomerInquiry(inquiryType, payload = {}) {
  const response = await base44.functions.invoke('customerJourneyAutomation', {
    action: 'submit_customer_inquiry',
    payload: {
      request_id: payload.request_id || requestId(inquiryType),
      inquiry_type: inquiryType,
      customer_name: payload.customer_name || '',
      customer_email: payload.customer_email || '',
      customer_phone: payload.customer_phone || '',
      subject: payload.subject || '',
      message: payload.message || '',
      source: payload.source || 'customer_app',
      metadata: payload.metadata || {},
    },
  });
  return response?.data || response;
}
