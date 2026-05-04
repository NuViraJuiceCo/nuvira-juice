import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_SUBSCRIPTION_ORDER_ID = '69ed51368b5ca93c33a1b0b4';
const CUSTOMER_EMAIL = 'ksukhi2000@yahoo.com';
const CUSTOMER_NAME = 'Sukhwant Kahlon';
const DELIVERY_ADDRESS = '6930 Brassel Drive, O Fallon, MO 63368';

const PROPOSED_PARENT_RECORD = {
  order_number:           'SUB-SK-4X-20260425',
  customer_email:         CUSTOMER_EMAIL,
  customer_name:          CUSTOMER_NAME,
  delivery_address:       DELIVERY_ADDRESS,
  payment_status:         'paid',
  status:                 'active_subscription',
  tracker_step:           'Scheduled For Production',
  production_status:      'scheduled_for_production',
  fulfillment_status:     'pending_production',
  assigned_delivery_date: '2026-05-09',
  total_price:            144.00,
  subscription_type:      '4-week',
  fulfillment_count:      4,
  fulfillments_completed: 1,
  fulfillments_remaining: 3,
  hub_order_id:           HUB_SUBSCRIPTION_ORDER_ID
};

const PROPOSED_FULFILLMENTS = [
  {
    fulfillment_sequence: 1,
    hub_fulfillment_task_id: '69f509d5a1bea46cdce8e273',
    status: 'delivered',
    tracker_step: 'Delivered',
    delivery_status: 'delivered',
    assigned_delivery_date: '2026-05-02',
    delivered_at: '2026-05-02',
    production_status: 'fulfilled',
    items: [
      { product_name: 'Oasis', quantity: 1 },
      { product_name: 'Aura', quantity: 1 },
      { product_name: 'Re-Nu', quantity: 1 }
    ]
  },
  {
    fulfillment_sequence: 2,
    hub_fulfillment_task_id: '69ee7844b32dfeecc536266b',
    status: 'scheduled_for_production',
    tracker_step: 'Scheduled For Production',
    delivery_status: 'not_ready',
    assigned_delivery_date: '2026-05-09',
    delivered_at: null,
    production_status: 'awaiting_production',
    items: [
      { product_name: 'Oasis', quantity: 1 },
      { product_name: 'Aura', quantity: 1 },
      { product_name: 'Re-Nu', quantity: 1 }
    ]
  },
  {
    fulfillment_sequence: 3,
    hub_fulfillment_task_id: '69f509d5a1bea46cdce8e274',
    status: 'scheduled',
    tracker_step: 'Scheduled',
    delivery_status: 'not_ready',
    assigned_delivery_date: '2026-05-16',
    delivered_at: null,
    production_status: 'not_started',
    items: [
      { product_name: 'Oasis', quantity: 1 },
      { product_name: 'Aura', quantity: 1 },
      { product_name: 'Re-Nu', quantity: 1 }
    ]
  },
  {
    fulfillment_sequence: 4,
    hub_fulfillment_task_id: '69f509d5a1bea46cdce8e275',
    status: 'scheduled',
    tracker_step: 'Scheduled',
    delivery_status: 'not_ready',
    assigned_delivery_date: '2026-05-23',
    delivered_at: null,
    production_status: 'not_started',
    items: [
      { product_name: 'Oasis', quantity: 1 },
      { product_name: 'Aura', quantity: 1 },
      { product_name: 'Re-Nu', quantity: 1 }
    ]
  }
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // R4 is intentionally hardcoded as dry-run only.
    // It does not create, update, or delete any Customer App records.
    const ca = base44.asServiceRole;

    const existingCA = await ca.entities.Order.filter({
      customer_email: CUSTOMER_EMAIL
    });

    const ghostRecords = await ca.entities.Order.filter({
      order_number: 'SUB-1TPMGCIR'
    });

    const sampleOrders = await ca.entities.Order.list();
    const sampleFields = sampleOrders?.[0] ? Object.keys(sampleOrders[0]) : [];

    const supportsFulfillmentsArray = sampleFields.includes('fulfillments');
    const supportsSubscriptionType = sampleFields.includes('subscription_type');
    const supportsHubOrderId = sampleFields.includes('hub_order_id');
    const supportsFulfillmentCount = sampleFields.includes('fulfillment_count');
    const supportsAssignedDeliveryDate = sampleFields.includes('assigned_delivery_date');
    const supportsTrackerStep = sampleFields.includes('tracker_step');

    const structureDecision = supportsFulfillmentsArray
      ? 'ONE_PARENT_WITH_EMBEDDED_FULFILLMENTS_ARRAY'
      : 'ONE_PARENT_RECORD — fulfillments tracked in Hub FulfillmentTasks';

    return Response.json({
      dry_run: true,
      mode: 'DRY RUN — structure proposal only, zero writes',
      repair_id: 'R4',

      preflight: {
        existing_ca_records_under_ksukhi2000: existingCA?.length ?? 0,
        existing_ca_record_ids_under_ksukhi2000: (existingCA || []).map((r: any) => r.id),
        ghost_SUB_1TPMGCIR_exists: (ghostRecords?.length ?? 0) > 0,
        ghost_record_id: ghostRecords?.[0]?.id ?? null,
        ghost_record_email: ghostRecords?.[0]?.customer_email ?? null,
        ca_order_schema_fields_detected: sampleFields,
        supports_fulfillments_array: supportsFulfillmentsArray,
        supports_subscription_type: supportsSubscriptionType,
        supports_hub_order_id: supportsHubOrderId,
        supports_fulfillment_count: supportsFulfillmentCount,
        supports_assigned_delivery_date: supportsAssignedDeliveryDate,
        supports_tracker_step: supportsTrackerStep
      },

      structure_decision: structureDecision,

      structure_rationale: supportsFulfillmentsArray
        ? 'Customer App Order schema appears to support a fulfillments array. Recommended structure is one parent subscription order with all 4 fulfillment instances embedded.'
        : 'No fulfillments array field detected. Recommended structure is one parent Customer App subscription order reflecting the next fulfillment, while Hub FulfillmentTasks remain the per-fulfillment source of truth.',

      proposed_parent_record: PROPOSED_PARENT_RECORD,

      proposed_fulfillments: PROPOSED_FULFILLMENTS,

      questions_for_approval: [
        'Confirm order_number format: proposed SUB-SK-4X-20260425, or specify preferred format.',
        `Confirm structure: ${structureDecision}.`,
        'Confirm ghost SUB-1TPMGCIR should remain untouched for now.',
        'Confirm whether Customer App subscription view can render fulfillment_sequence-based tracker steps.'
      ],

      live_execution_status: 'LOCKED — awaiting structure approval',
      live_payload_when_approved: {
        dry_run: false,
        approved_by: 'admin'
      },

      ghost_record: {
        ca_id: ghostRecords?.[0]?.id ?? null,
        order_number: 'SUB-1TPMGCIR',
        email: ghostRecords?.[0]?.customer_email ?? null,
        action_now: 'NONE — do not touch',
        recommendation: 'Suppress from active Customer App views later through a separate approved repair.'
      },

      safety: {
        live_writes_performed: 0,
        records_created: 0,
        records_updated: 0,
        records_deleted: 0,
        note: 'This function is intentionally detection/proposal only.'
      }
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
});