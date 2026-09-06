import { invokeCustomerGateway } from '@/api/base44Client';
import { MARKETING_CONSENT_EVENT, getMarketingConsent } from '@/lib/metaPixel';

export async function sendMetaFunnelEvent(payload) {
  if (getMarketingConsent() !== 'granted') return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  const onConsentChange = () => {
    if (getMarketingConsent() !== 'granted') controller.abort();
  };
  window.addEventListener(MARKETING_CONSENT_EVENT, onConsentChange);
  try {
    const response = await invokeCustomerGateway('trackMetaFunnelEvent', payload, {
      signal: controller.signal,
      keepalive: true,
    });
    return response?.data?.sent === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    window.removeEventListener(MARKETING_CONSENT_EVENT, onConsentChange);
  }
}
