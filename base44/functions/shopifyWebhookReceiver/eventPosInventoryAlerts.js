const STOCK_THRESHOLDS = Object.freeze([
  Object.freeze({ key: 'sold_out', maximum: 0, severity: 'critical' }),
  Object.freeze({ key: 'last_unit', maximum: 1, severity: 'critical' }),
  Object.freeze({ key: 'low_stock', maximum: 3, severity: 'warning' }),
]);

const NOTIFICATION_SUBTYPE = 'admin_event_inventory_low_stock';
const DEEP_LINK = '/admin/shopify';

function line(value, maxLength = 180) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function lower(value, maxLength = 180) {
  return line(value, maxLength).toLowerCase();
}

function email(value) {
  const normalized = lower(value, 160);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
}

function stableToken(value, maxLength = 180) {
  return lower(value, maxLength).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function parseEmailList(value) {
  return [...new Set(String(value || '').split(',').map(email).filter(Boolean))];
}

function integer(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function chicagoDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function eventInventoryThreshold(availableQuantity) {
  const quantity = integer(availableQuantity);
  if (quantity === null) return null;
  return STOCK_THRESHOLDS.find((threshold) => quantity <= threshold.maximum) || null;
}

export function eventInventoryAlertCopy({ eventName, locationName, productTitle, availableQuantity }) {
  const threshold = eventInventoryThreshold(availableQuantity);
  if (!threshold) return null;

  const event = line(eventName, 160) || 'Current event';
  const location = line(locationName, 160) || event;
  const product = line(productTitle, 120) || 'Event item';
  const quantity = integer(availableQuantity);

  if (threshold.key === 'sold_out') {
    return {
      ...threshold,
      title: `Sold Out: ${product}`,
      message: `${event} has sold out of ${product} at ${location}.`,
    };
  }
  if (threshold.key === 'last_unit') {
    return {
      ...threshold,
      title: `Last ${product}`,
      message: `${event} has 1 ${product} remaining at ${location}.`,
    };
  }
  return {
    ...threshold,
    title: `Low Stock: ${product}`,
    message: `${event} has ${quantity} ${product} remaining at ${location}.`,
  };
}

export function eventInventoryMonitorEligibility(record, event, now = new Date()) {
  if (record?.is_pos_order !== true) return { eligible: false, reason: 'not_pos_order' };
  if (record?.event_attribution_status !== 'matched') return { eligible: false, reason: 'event_not_matched' };
  const paymentStatus = lower(record?.payment_status || record?.financial_status, 40);
  if (paymentStatus !== 'paid') return { eligible: false, reason: 'order_not_paid' };
  if (!event?.id || String(event.id) !== String(record?.event_id || '')) {
    return { eligible: false, reason: 'event_identity_mismatch' };
  }
  if (event?.is_active === false) return { eligible: false, reason: 'event_inactive' };
  if (event?.shopify_pos_inventory_sync_enabled !== true) {
    return { eligible: false, reason: 'event_inventory_sync_disabled' };
  }
  const eventLocation = line(event?.shopify_pos_location_id, 180);
  const orderLocation = line(record?.shopify_pos_location_id, 180);
  if (!eventLocation || eventLocation !== orderLocation) {
    return { eligible: false, reason: 'event_location_mismatch' };
  }
  const eventDate = line(event?.date, 20);
  if (eventDate && eventDate !== chicagoDate(now)) {
    return { eligible: false, reason: 'event_not_today' };
  }
  return { eligible: true, reason: 'eligible' };
}

async function findEvent(base44, record) {
  const eventId = line(record?.event_id, 180);
  if (!eventId) return null;
  const rows = await base44.asServiceRole.entities.Event
    .filter({ id: eventId }, '-date', 2)
    .catch(() => []);
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}

async function adminRecipients(base44, configuredRecipients) {
  const configured = parseEmailList(configuredRecipients);
  const [admins, owners] = await Promise.all([
    base44.asServiceRole.entities.User.filter({ role: 'admin' }).catch(() => []),
    base44.asServiceRole.entities.User.filter({ role: 'owner' }).catch(() => []),
  ]);
  return [...new Set([...configured, ...[...admins, ...owners]
    .map((user) => email(user?.email || user?.customer_email || user?.user_email))
    .filter(Boolean)])];
}

function operationalAlertIdentity(event, item) {
  return `Automatic Shopify POS event inventory monitor for ${stableToken(event.id)}:${stableToken(item.inventoryItemId)}.`;
}

async function upsertOperationalAlert(base44, { event, item, copy, orderRecord }) {
  const alertIdentity = operationalAlertIdentity(event, item);
  const existing = await base44.asServiceRole.entities.OperationalAlert.filter({
    alert_type: 'inventory_shortage',
    description: alertIdentity,
    resolved: false,
  }, '-created_date', 2).catch(() => []);
  const payload = {
    alert_type: 'inventory_shortage',
    title: copy.title,
    message: copy.message,
    description: alertIdentity,
    shopify_order_id: line(orderRecord?.shopify_order_id, 140),
    order_number: line(orderRecord?.shopify_order_number || orderRecord?.order_number, 80),
    severity: copy.severity,
    is_read: false,
    resolved: false,
  };
  if (existing[0]) {
    await base44.asServiceRole.entities.OperationalAlert.update(existing[0].id, payload);
    return { created: false, alert: { ...existing[0], ...payload } };
  }
  return {
    created: true,
    alert: await base44.asServiceRole.entities.OperationalAlert.create(payload),
  };
}

async function resolveRecoveredOperationalAlert(base44, { event, item }) {
  const alertIdentity = operationalAlertIdentity(event, item);
  const existing = await base44.asServiceRole.entities.OperationalAlert.filter({
    alert_type: 'inventory_shortage',
    description: alertIdentity,
    resolved: false,
  }, '-created_date', 2).catch(() => []);
  for (const alert of existing) {
    await base44.asServiceRole.entities.OperationalAlert.update(alert.id, {
      resolved: true,
      is_read: true,
      message: `Resolved automatically: ${line(item.productTitle, 120) || 'event item'} has ${item.availableQuantity} remaining.`,
    });
  }
}

async function notifyRecipients(base44, {
  recipients,
  event,
  item,
  copy,
  orderRecord,
  pushEnabled,
}) {
  let notificationCreatedCount = 0;
  let duplicateCount = 0;
  let pushAttempted = false;
  let pushSent = false;
  const skippedReasons = new Set();
  const eventToken = stableToken(event.id);
  const itemToken = stableToken(item.inventoryItemId);

  for (const recipient of recipients) {
    const idempotencyKey = `admin_event_inventory_${eventToken}_${itemToken}_${copy.key}_${stableToken(recipient)}`;
    const existing = await base44.asServiceRole.entities.Notification
      .filter({ idempotency_key: idempotencyKey }, '-created_date', 1)
      .catch(() => []);
    if (existing[0]) {
      duplicateCount += 1;
      continue;
    }

    const notification = await base44.asServiceRole.entities.Notification.create({
      customer_email: recipient,
      title: copy.title,
      message: copy.message,
      description: 'Automatic event stock threshold alert from Shopify POS.',
      type: 'general',
      notification_subtype: NOTIFICATION_SUBTYPE,
      order_id: orderRecord?.id || null,
      deep_link: DEEP_LINK,
      is_read: false,
      icon: null,
      idempotency_key: idempotencyKey,
    });
    notificationCreatedCount += 1;

    if (!pushEnabled) {
      skippedReasons.add('admin_push_disabled');
      continue;
    }
    const response = await base44.asServiceRole.functions.invoke('sendCustomerPushNotification', {
      customer_email: recipient,
      notification_id: notification.id,
      title: copy.title,
      message: copy.message,
      type: 'general',
      notification_subtype: NOTIFICATION_SUBTYPE,
      order_id: orderRecord?.id || null,
      deep_link: DEEP_LINK,
      idempotency_key: idempotencyKey,
    }).catch((error) => ({
      push_attempted: false,
      push_sent: false,
      push_skipped_reason: `push_function_error:${line(error?.message || error, 80) || 'unknown'}`,
    }));
    const push = response?.data || response || {};
    pushAttempted = pushAttempted || push.push_attempted === true;
    pushSent = pushSent || push.push_sent === true;
    if (push.push_skipped_reason) skippedReasons.add(line(push.push_skipped_reason, 120));
  }

  return {
    notification_created_count: notificationCreatedCount,
    duplicate_count: duplicateCount,
    push_attempted: pushAttempted,
    push_sent: pushSent,
    push_skipped_reasons: [...skippedReasons],
  };
}

export async function monitorEventPosInventorySale({
  base44,
  record,
  orderPayload,
  readInventoryLevels,
  configuredAdminRecipients = '',
  pushEnabled = false,
  now = new Date(),
}) {
  if (record?.is_pos_order !== true) return { monitored: false, reason: 'not_pos_order' };
  const event = await findEvent(base44, record);
  if (!event) return { monitored: false, reason: 'event_not_found' };
  const eligibility = eventInventoryMonitorEligibility(record, event, now);
  if (!eligibility.eligible) return { monitored: false, reason: eligibility.reason };

  const lineItems = Array.isArray(orderPayload?.line_items) ? orderPayload.line_items : [];
  const variantIds = [...new Set(lineItems.map((item) => line(item?.variant_id, 100)).filter(Boolean))];
  if (!variantIds.length) return { monitored: false, reason: 'variant_ids_missing' };

  const items = await readInventoryLevels({
    variantIds,
    locationId: event.shopify_pos_location_id,
    lineItems,
  });
  const recipients = await adminRecipients(base44, configuredAdminRecipients);
  const results = [];

  for (const item of Array.isArray(items) ? items : []) {
    const copy = eventInventoryAlertCopy({
      eventName: event.title || record.event_name,
      locationName: event.shopify_pos_location_name || record.shopify_pos_location_name,
      productTitle: item.productTitle,
      availableQuantity: item.availableQuantity,
    });
    if (!copy) {
      await resolveRecoveredOperationalAlert(base44, { event, item });
      results.push({
        inventory_item_id: item.inventoryItemId,
        available_quantity: item.availableQuantity,
        threshold: null,
        alerted: false,
      });
      continue;
    }

    const operationalAlert = await upsertOperationalAlert(base44, {
      event,
      item,
      copy,
      orderRecord: record,
    });
    const notification = await notifyRecipients(base44, {
      recipients,
      event,
      item,
      copy,
      orderRecord: record,
      pushEnabled,
    });
    results.push({
      inventory_item_id: item.inventoryItemId,
      available_quantity: item.availableQuantity,
      threshold: copy.key,
      alerted: true,
      operational_alert_created: operationalAlert.created,
      ...notification,
    });
  }

  return {
    monitored: true,
    event_id: event.id,
    location_id: event.shopify_pos_location_id,
    item_count: results.length,
    results,
  };
}
