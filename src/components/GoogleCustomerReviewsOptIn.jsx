import { useEffect } from 'react';
import { format, addDays } from 'date-fns';

const MERCHANT_ID = 5778700568;

/**
 * Loads the Google Customer Reviews opt-in survey after a confirmed order.
 * Only renders when order_id, customer_email, and a delivery date are available.
 * Renders nothing visible — the opt-in widget is managed by Google.
 */
export default function GoogleCustomerReviewsOptIn({ order }) {
  useEffect(() => {
    if (!order) return;

    const orderId = order.order_number || order.id;
    const email = order.customer_email;

    // Prefer assigned_delivery_date, fall back to estimated_delivery_date,
    // then calculate ~3 business days out as a last resort
    let deliveryDate = order.assigned_delivery_date || order.estimated_delivery_date;
    if (!deliveryDate) {
      deliveryDate = format(addDays(new Date(), 3), 'yyyy-MM-dd');
    }

    // Guard: all required fields must be present
    if (!orderId || !email || !deliveryDate) return;

    // Guard: do not fire for test/ghost/cancelled orders
    const blockedStatuses = new Set(['cancelled', 'refunded', 'failed']);
    if (blockedStatuses.has(order.status)) return;
    if (order.is_test_order) return;

    // Ensure date is formatted as YYYY-MM-DD
    const formattedDate = deliveryDate.slice(0, 10);

    // Define renderOptIn globally so the platform.js onload callback can call it
    window.renderOptIn = function () {
      if (!window.gapi) return;
      window.gapi.load('surveyoptin', function () {
        window.gapi.surveyoptin.render({
          merchant_id: MERCHANT_ID,
          order_id: String(orderId),
          email: email,
          delivery_country: 'US',
          estimated_delivery_date: formattedDate,
          // products omitted until valid GTINs are available
        });
      });
    };

    // Load the script (idempotent — skip if already loaded)
    if (!document.getElementById('google-customer-reviews-script')) {
      const script = document.createElement('script');
      script.id = 'google-customer-reviews-script';
      script.src = 'https://apis.google.com/js/platform.js?onload=renderOptIn';
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    } else {
      // Script already present — call renderOptIn directly if gapi is ready
      if (window.gapi) {
        window.renderOptIn();
      }
    }
  }, [order?.id, order?.order_number]);

  return null; // Google manages the widget rendering
}