function text(value, maxLength = 240) {
  const normalized = (value ?? '').toString().trim().replace(/\s+/g, ' ');
  return normalized.slice(0, maxLength);
}

export function isShopifyPosOrder(order) {
  return text(order?.source_name, 40).toLowerCase() === 'pos';
}

export function normalizeShopifyLocationId(value) {
  const raw = text(value, 160);
  if (!raw) return null;
  const gidMatch = raw.match(/^gid:\/\/shopify\/Location\/(\d+)$/i);
  const numericMatch = raw.match(/^(\d+)$/);
  const numeric = gidMatch?.[1] || numericMatch?.[1] || '';
  if (!numeric) return null;
  return {
    gid: `gid://shopify/Location/${numeric}`,
    numeric,
  };
}

function noteAttributes(order) {
  return (Array.isArray(order?.note_attributes) ? order.note_attributes : []).reduce((result, attribute) => {
    if (attribute?.name) result[attribute.name] = attribute.value;
    return result;
  }, {});
}

function uniqueEvents(events) {
  const byKey = new Map();
  for (const event of events || []) {
    const key = text(event?.id || event?.hub_event_id || `${event?.title}:${event?.date}`, 300);
    if (key && !byKey.has(key)) byKey.set(key, event);
  }
  return Array.from(byKey.values());
}

async function eventsForLocation(base44, location) {
  const entity = base44?.asServiceRole?.entities?.Event;
  if (!entity?.filter) throw new Error('event_entity_unavailable');
  const results = [];
  for (const candidate of [location.gid, location.numeric]) {
    const rows = await entity.filter({ shopify_pos_location_id: candidate }, '-date', 10);
    if (Array.isArray(rows)) results.push(...rows);
  }
  return uniqueEvents(results);
}

function unverifiedAttribution(order, location, status, reason) {
  const attrs = noteAttributes(order);
  const legacyLocation = text(attrs.event_location || attrs.location || attrs.location_name || order?.location_name, 240);
  return {
    shopify_pos_location_id: location?.gid || '',
    shopify_pos_location_name: text(order?.location_name, 160),
    shopify_pos_device_id: text(order?.device_id, 160),
    shopify_pos_staff_id: text(order?.user_id, 160),
    event_id: '',
    event_key: '',
    event_name: '',
    event_date: '',
    event_location: '',
    event_attribution_status: status,
    event_attribution_reason: legacyLocation
      ? `${reason}; legacy note location was present but was not trusted: ${legacyLocation}`.slice(0, 500)
      : reason,
    data_quality_status: 'event_attribution_review',
    sync_status: 'native_pos_attribution_review',
  };
}

export async function resolvePosEventAttribution(base44, order) {
  if (!isShopifyPosOrder(order)) return {};

  const location = normalizeShopifyLocationId(order?.location_id);
  if (!location) {
    return unverifiedAttribution(
      order,
      null,
      'missing_location',
      'Shopify POS order did not include a valid location_id',
    );
  }

  let matches;
  try {
    matches = await eventsForLocation(base44, location);
  } catch (error) {
    return unverifiedAttribution(
      order,
      location,
      'lookup_failed',
      `NuVira event lookup failed safely: ${text(error?.message || 'unknown error', 220)}`,
    );
  }
  if (matches.length === 0) {
    return unverifiedAttribution(
      order,
      location,
      'unmatched_location',
      `No NuVira event is configured for ${location.gid}`,
    );
  }
  if (matches.length > 1) {
    return unverifiedAttribution(
      order,
      location,
      'ambiguous_location',
      `Multiple NuVira events are configured for ${location.gid}`,
    );
  }

  const event = matches[0];
  const locationName = text(event?.shopify_pos_location_name || order?.location_name, 160);
  const eventLocation = text(event?.location || locationName, 240);
  return {
    shopify_pos_location_id: location.gid,
    shopify_pos_location_name: locationName,
    shopify_pos_device_id: text(order?.device_id, 160),
    shopify_pos_staff_id: text(order?.user_id, 160),
    event_id: text(event?.id, 160),
    event_key: text(event?.hub_event_id || event?.id, 160).toLowerCase(),
    event_name: text(event?.title, 180),
    event_date: text(event?.date, 40),
    event_location: eventLocation,
    event_attribution_status: 'matched',
    event_attribution_reason: `Matched Shopify POS location ${location.gid}`,
    data_quality_status: 'complete',
    sync_status: 'native_pos_ready',
  };
}

export function posEventAttributionNeedsReview(record) {
  return isShopifyPosOrder({ source_name: record?.source_channel })
    && ['missing_location', 'unmatched_location', 'ambiguous_location', 'lookup_failed'].includes(record?.event_attribution_status);
}
