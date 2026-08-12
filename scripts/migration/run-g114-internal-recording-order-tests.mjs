import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [orders, production, delivery, orderEntity, notification, adminOrdersHandler, adminGateway] = await Promise.all([
  readFile(new URL('../../src/pages/AdminOrders.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../../src/pages/admin/ProductionQueueSummary.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../../src/pages/admin/DeliveryQueue.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../../base44/entities/Order.jsonc', import.meta.url), 'utf8'),
  readFile(new URL('../../base44/functions/sendOrderStatusNotification/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminOrdersWithHub/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../base44/functions/getAdminOperationsDashboardSummary/entry.ts', import.meta.url), 'utf8'),
]);

assert.match(orders, /internal_test_validation/);
assert.match(orders, /orders\.filter\(order => order\.is_test_order === true\)/);
assert.match(orders, /orders\.filter\(order => order\.is_test_order !== true\)/);
assert.match(orders, /test_batch_mode=only/);
assert.match(orders, /test_task_mode=only/);
assert.match(orders, /excluded from normal orders, revenue, loyalty, marketing, inventory, and customer communications/);

assert.match(production, /searchParams\.get\('test_batch_mode'\) === 'only'/);
assert.match(production, /allow_internal_test_customer_side_effects: true/);
assert.match(delivery, /stop\.is_test_task === true/);
assert.match(delivery, /payload\.allow_internal_test_customer_side_effects = true/);
assert.match(delivery, /isolated test-order status can advance; customer notifications remain suppressed/);

assert.match(orderEntity, /"is_test_order"/);
assert.match(notification, /authoritativeOrder\?\.is_test_order === true/);
assert.match(notification, /reason: 'test_order_customer_communications_suppressed'/);
assert.match(adminOrdersHandler, /is_test_order: order\.is_test_order === true/);
assert.match(adminOrdersHandler, /payment_captured: order\.payment_captured === true/);
assert.match(adminOrdersHandler, /id: order\.customer_app_order_id \|\| order\.id \|\| null/);
assert.match(adminGateway, /g114b-recording-order-detail-accuracy-20260812/);

console.log(JSON.stringify({
  success: true,
  checks: 18,
  classification: 'g114_internal_recording_order_ui_and_safety_contracts_passed',
}, null, 2));
