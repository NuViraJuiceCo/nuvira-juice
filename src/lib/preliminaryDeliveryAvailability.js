// Presentation-only ZIP interpretation. This never authorizes checkout or payment.
export const PRELIMINARY_DELIVERY_CHECK_VERSION = '2026-09-zip-area-v2';

const SERVICE_ZONES = new Set(['core', 'extended', 'route_review']);
const AREA_REASONS = new Set(['', 'ELIGIBLE', 'MINIMUM_ORDER_NOT_MET', 'ROUTE_REVIEW_REQUIRED']);

export function classifyPreliminaryDeliveryAvailability(eligibility) {
  const zoneType = eligibility?.zone_type;
  const reason = String(eligibility?.reason_code || '').toUpperCase();
  if (eligibility?.error) return { status: 'error' };

  // An empty ZIP-check cart cannot meet area dollar minimums. That is not a
  // geographic rejection: show a qualified area preview, never checkout_allowed.
  const serviceArea = SERVICE_ZONES.has(zoneType) && AREA_REASONS.has(reason);
  const areaPreviewAllowed = eligibility?.checkout_allowed === true
    || reason === 'MINIMUM_ORDER_NOT_MET'
    || (zoneType === 'route_review' && reason === 'ROUTE_REVIEW_REQUIRED');
  if (serviceArea && areaPreviewAllowed) {
    const minimum = Number(eligibility.minimum_order);
    return {
      status: 'eligible',
      minimumOrder: Number.isFinite(minimum) && minimum > 0 ? minimum : null,
      routeReview: zoneType === 'route_review',
      zoneType,
    };
  }

  // Only an explicit unavailable geography is a waitlist result. Lookup errors,
  // unknown contracts and unrelated restrictions remain retryable instead.
  if (zoneType === 'waitlist_only' && eligibility?.checkout_allowed === false
    && ['', 'WAITLIST_ONLY', 'ZONE_BLOCKED'].includes(reason)) {
    return { status: 'ineligible', minimumOrder: null, routeReview: false, zoneType };
  }
  return { status: 'error' };
}

export function restorePreliminaryDeliveryAvailability(saved) {
  if (saved?.preliminary_check_version !== PRELIMINARY_DELIVERY_CHECK_VERSION) return null;
  if (!['eligible', 'ineligible'].includes(saved.delivery_eligibility_status)) return null;
  const minimum = Number(saved.preliminary_minimum_order);
  return {
    status: saved.delivery_eligibility_status,
    minimumOrder: Number.isFinite(minimum) && minimum > 0 ? minimum : null,
    routeReview: saved.preliminary_route_review === true,
  };
}
