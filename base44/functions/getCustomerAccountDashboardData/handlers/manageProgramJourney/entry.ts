// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TIMEZONE = 'America/Chicago';
const SCHEDULE_VERSION = '2026-08-09.v2';
const QUALITY_TARGET_DAYS = 5;
const OUTER_FRESHNESS_DAYS = 7;
const MAX_ORDER_ROWS = 40;
const MAX_BATCH_ROWS = 120;
const MAX_PROGRAM_UNITS_PER_LINE = 6;

function programReminderServiceEnabled(): boolean {
  return String(Deno.env.get('ENABLE_PROGRAM_JOURNEY_REMINDERS') || '').trim().toLowerCase() === 'true';
}

const PROGRAMS = Object.freeze({
  radiance: {
    name: 'Radiance',
    allowedDays: [2, 3],
    image: 'https://media.base44.com/images/public/69d48d0c39891f7945481152/32667c02e_DSC02688.jpg',
    schedule: [
      ['morning', 'Morning', '8:00 AM', 'AURA'],
      ['midday', 'Midday', '12:30 PM', 'OASIS'],
      ['golden_hour', 'Golden Hour', '4:30 PM', 'AURA'],
      ['evening', 'Evening', '8:00 PM', 'AURA'],
    ],
  },
  hydration: {
    name: 'Hydration',
    allowedDays: [2, 3],
    image: 'https://media.base44.com/images/public/69d48d0c39891f7945481152/bc50c9427_DSC02532.jpg',
    schedule: [
      ['morning', 'Morning', '8:00 AM', 'OASIS'],
      ['midday', 'Midday', '12:30 PM', 'AURA'],
      ['golden_hour', 'Golden Hour', '4:30 PM', 'OASIS'],
      ['evening', 'Evening', '8:00 PM', 'OASIS'],
    ],
  },
  reset: {
    name: 'Reset',
    allowedDays: [3],
    image: 'https://media.base44.com/images/public/69d48d0c39891f7945481152/3e9fe43e6_DSC02709.jpg',
    schedule: [
      ['morning', 'Morning', '8:00 AM', 'RE-NU'],
      ['midday', 'Midday', '12:30 PM', 'OASIS'],
      ['golden_hour', 'Golden Hour', '4:30 PM', 'RE-NU'],
      ['evening', 'Evening', '8:00 PM', 'RE-NU'],
    ],
  },
});

function clean(value: unknown, max = 300): string {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function email(value: unknown): string {
  return clean(value, 320).toLowerCase();
}

function validDateKey(value: unknown): string | null {
  const normalized = clean(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? normalized : null;
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function earlierDate(...values: Array<string | null | undefined>): string | null {
  const dates = values.filter(Boolean).sort();
  return dates[0] || null;
}

function dateKeyInTimezone(value: unknown = new Date()): string {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  const safe = Number.isFinite(date.getTime()) ? date : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(safe);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function programForItem(item: Record<string, any>) {
  const productId = clean(item?.product_id || item?.id, 160).toLowerCase();
  const title = clean(item?.title || item?.name, 240).toLowerCase();
  for (const [key, program] of Object.entries(PROGRAMS)) {
    const explicitKey = clean(item?.program_key, 60).toLowerCase();
    if (explicitKey === key || productId === `program_${key}` || productId === `program-${key}`
      || productId.startsWith(`program_${key}_`) || productId.startsWith(`program-${key}-`)
      || title.includes(`${program.name.toLowerCase()} program`)) {
      const idMatch = productId.match(/[_-](2|3)day$/);
      const titleMatch = title.match(/\((2|3)-day\)/);
      const requestedDays = Number(item?.program_days || idMatch?.[1] || titleMatch?.[1] || 3);
      const days = program.allowedDays.includes(requestedDays) ? requestedDays : 3;
      return { key, ...program, days };
    }
  }
  return null;
}

function paidDeliveredOrder(order: Record<string, any>): boolean {
  const paymentState = clean(order?.payment_status || order?.financial_status, 60).toLowerCase();
  const refundState = clean(order?.refund_status, 60).toLowerCase();
  const lifecycle = clean(order?.status, 60).toLowerCase();
  const paid = order?.payment_captured === true || paymentState === 'paid';
  const refunded = paymentState === 'refunded' || ['fully_refunded', 'partially_refunded'].includes(refundState);
  return paid && !refunded && lifecycle === 'delivered';
}

function deliveredDate(order: Record<string, any>): string {
  const deliveredAt = clean(order?.delivered_at, 80);
  const actual = validDateKey(deliveredAt) || (deliveredAt ? dateKeyInTimezone(deliveredAt) : null);
  const explicit = actual || validDateKey(order?.assigned_delivery_date)
    || validDateKey(order?.estimated_delivery_date);
  return explicit || dateKeyInTimezone(order?.delivered_at || order?.updated_date || order?.created_date);
}

async function resolveIdentities(base44: any, authEmail: string): Promise<string[]> {
  const identities = new Set([email(authEmail)]);
  const addProfile = (profile: Record<string, any>) => {
    const customer = email(profile?.customer_email);
    const contact = email(profile?.contact_email);
    if (customer) identities.add(customer);
    if (contact) identities.add(contact);
  };
  try {
    const [forward, reverse] = await Promise.all([
      base44.asServiceRole.entities.UserProfile.filter({ customer_email: authEmail }, '-updated_date', 5),
      base44.asServiceRole.entities.UserProfile.filter({ contact_email: authEmail }, '-updated_date', 5),
    ]);
    [...forward, ...reverse].forEach(addProfile);
  } catch (error) {
    console.warn(`[manageProgramJourney] Identity resolution partial failure: ${clean(error?.message || error, 200)}`);
  }
  return [...identities].filter(Boolean);
}

async function eligibleOrders(base44: any, identities: string[]) {
  const byId = new Map();
  for (const identity of identities) {
    const rows = await base44.asServiceRole.entities.Order.filter(
      { customer_email: identity },
      '-created_date',
      MAX_ORDER_ROWS,
    );
    for (const row of rows) {
      if (row?.id && paidDeliveredOrder(row) && Array.isArray(row?.items) && row.items.some(programForItem)) {
        byId.set(row.id, row);
      }
    }
  }
  return [...byId.values()];
}

function batchReferencesOrder(batch: Record<string, any>, order: Record<string, any>): boolean {
  const orderId = clean(order?.id, 160);
  const orderNumber = clean(order?.order_number, 160).toLowerCase().replace(/^#/, '');
  const sources = Array.isArray(batch?.order_sources) ? batch.order_sources : [];
  if (sources.some((source) => {
    const sourceId = clean(source?.order_id, 160);
    const sourceNumber = clean(source?.order_number, 160).toLowerCase().replace(/^#/, '');
    return (orderId && sourceId === orderId) || (orderNumber && sourceNumber === orderNumber);
  })) return true;
  return Array.isArray(batch?.related_orders) && batch.related_orders.some((value) => clean(value, 160) === orderId);
}

async function useByDatesByOrder(base44: any, orders: Record<string, any>) {
  const result = new Map();
  const dates = [...new Set(orders.map((order) => validDateKey(order?.assigned_production_day || order?.production_date)).filter(Boolean))];
  const batches = [];
  for (const date of dates.slice(0, 12)) {
    const rows = await base44.asServiceRole.entities.ProductionBatch.filter(
      { production_date: date },
      '-created_date',
      MAX_BATCH_ROWS,
    ).catch(() => []);
    batches.push(...rows.filter((row) => row?.is_test_batch !== true));
  }
  for (const order of orders) {
    const useByDates = batches
      .filter((batch) => batchReferencesOrder(batch, order))
      .map((batch) => validDateKey(batch?.use_by_date))
      .filter(Boolean)
      .sort();
    if (useByDates[0]) result.set(order.id, useByDates[0]);
  }
  return result;
}

function expandedShots(order: Record<string, any>): string[] {
  const shots = [];
  for (const item of Array.isArray(order?.items) ? order.items : []) {
    if (clean(item?.category, 60).toLowerCase() !== 'shot') continue;
    const quantity = Math.min(12, Math.max(1, Math.trunc(Number(item?.quantity || 1))));
    for (let index = 0; index < quantity; index += 1) shots.push(clean(item?.title, 120) || 'Wellness shot');
  }
  return shots;
}

function descriptorsForOrder(order: Record<string, any>, linkedUseByDate: string | null) {
  const delivered = deliveredDate(order);
  const estimatedUseBy = addDays(delivered, OUTER_FRESHNESS_DAYS - 1);
  const useBy = linkedUseByDate || estimatedUseBy;
  const qualityTarget = earlierDate(addDays(delivered, QUALITY_TARGET_DAYS - 1), useBy);
  const shots = expandedShots(order);
  let shotCursor = 0;
  const descriptors = [];
  const items = Array.isArray(order?.items) ? order.items : [];
  items.forEach((item, itemIndex) => {
    const program = programForItem(item);
    if (!program) return;
    const latestStart = earlierDate(qualityTarget, addDays(useBy, -(program.days - 1)));
    const units = Math.min(MAX_PROGRAM_UNITS_PER_LINE, Math.max(1, Math.trunc(Number(item?.quantity || 1))));
    for (let unitIndex = 0; unitIndex < units; unitIndex += 1) {
      const morningShots = shots.slice(shotCursor, shotCursor + program.days);
      shotCursor += morningShots.length;
      descriptors.push({
        journey_key: `program:${order.id}:${itemIndex}:${unitIndex}`,
        customer_email: email(order.customer_email),
        order_id: order.id,
        order_number: clean(order.order_number, 120),
        order_item_index: itemIndex,
        unit_index: unitIndex,
        program_key: program.key,
        program_name: program.name,
        program_days: program.days,
        program_image_url: clean(item?.image_url, 1200) || program.image,
        delivered_at: order.delivered_at || null,
        delivered_date: delivered,
        quality_target_date: qualityTarget,
        use_by_date: useBy,
        use_by_source: linkedUseByDate ? 'production_batch' : 'delivery_estimate',
        latest_start_date: latestStart,
        morning_shots: morningShots,
      });
    }
  });
  return descriptors;
}

function freshnessState(journey: Record<string, any>, today = dateKeyInTimezone()) {
  if (today > journey.use_by_date) return 'ended';
  if (!journey.start_date && today > journey.latest_start_date) return 'cannot_finish';
  if (today > journey.quality_target_date) return 'quality_target_passed';
  return 'within_quality_target';
}

function publicJourney(descriptor: Record<string, any>, stored: Record<string, any> | null = null) {
  const merged = {
    ...(stored || {}),
    ...descriptor,
    id: stored?.id || descriptor.journey_key,
    is_virtual: !stored,
    status: stored?.status || (dateKeyInTimezone() > descriptor.latest_start_date ? 'freshness_window_ended' : 'ready'),
    schedule: Array.isArray(stored?.schedule) ? stored.schedule : [],
    completed_steps: Number(stored?.completed_steps || 0),
    total_steps: Number(stored?.total_steps || (Number(descriptor.program_days || 3) * 4)),
    reminders_enabled: stored?.reminders_enabled === true,
  };
  return {
    id: merged.id,
    journey_key: merged.journey_key,
    order_id: merged.order_id,
    order_number: merged.order_number,
    program_key: merged.program_key,
    program_name: merged.program_name,
    program_days: Number(merged.program_days || 3),
    program_image_url: merged.program_image_url,
    status: merged.status,
    is_virtual: merged.is_virtual,
    delivered_at: merged.delivered_at || null,
    delivered_date: merged.delivered_date,
    quality_target_date: merged.quality_target_date,
    use_by_date: merged.use_by_date,
    use_by_source: merged.use_by_source,
    latest_start_date: merged.latest_start_date,
    freshness_state: freshnessState(merged),
    start_date: merged.start_date || null,
    started_at: merged.started_at || null,
    completed_at: merged.completed_at || null,
    timezone: merged.timezone || TIMEZONE,
    schedule_version: merged.schedule_version || SCHEDULE_VERSION,
    schedule: merged.schedule,
    completed_steps: merged.completed_steps,
    total_steps: merged.total_steps,
    reminders_enabled: merged.reminders_enabled,
    reminder_delivery_available: programReminderServiceEnabled(),
    today: dateKeyInTimezone(),
  };
}

function buildSchedule(descriptor: Record<string, any>, startDate: string) {
  const program = PROGRAMS[descriptor.program_key];
  const shots = Array.isArray(descriptor.morning_shots) ? descriptor.morning_shots : [];
  const schedule = [];
  for (let day = 1; day <= Number(descriptor.program_days || 3); day += 1) {
    const date = addDays(startDate, day - 1);
    program.schedule.forEach(([timeKey, timeLabel, suggestedTime, productName], sequence) => {
      schedule.push({
        step_id: `day-${day}-${timeKey}`,
        day_number: day,
        date,
        sequence: sequence + 1,
        time_key: timeKey,
        time_label: timeLabel,
        suggested_time: suggestedTime,
        product_name: productName,
        morning_shot_name: timeKey === 'morning' ? shots[day - 1] || null : null,
        completed_at: null,
      });
    });
  }
  return schedule;
}

async function loadContext(base44: any, authEmail: string) {
  const identities = await resolveIdentities(base44, authEmail);
  const orders = await eligibleOrders(base44, identities);
  const useByMap = await useByDatesByOrder(base44, orders);
  const descriptors = orders.flatMap((order) => descriptorsForOrder(order, useByMap.get(order.id) || null));
  const storedRows = [];
  for (const identity of identities) {
    const rows = await base44.asServiceRole.entities.ProgramJourney.filter(
      { customer_email: identity },
      '-created_date',
      50,
    ).catch(() => []);
    storedRows.push(...rows);
  }
  const storedByKey = new Map(storedRows.map((row) => [row.journey_key, row]));
  return { identities, descriptors, storedByKey };
}

function requestedJourney(context: Record<string, any>, body: Record<string, any>) {
  const requestedId = clean(body?.journey_id || body?.journey_key, 240);
  const descriptor = context.descriptors.find((row) => row.journey_key === requestedId)
    || context.descriptors.find((row) => context.storedByKey.get(row.journey_key)?.id === requestedId);
  if (!descriptor) return null;
  return { descriptor, stored: context.storedByKey.get(descriptor.journey_key) || null };
}

function withCommand(row: Record<string, any>, commandId: string) {
  const recent = Array.isArray(row?.recent_command_ids) ? row.recent_command_ids.map(String) : [];
  return [...new Set([...recent, commandId])].slice(-20);
}

export default async function handler(req: Request) {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let body: Record<string, any> = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'malformed_json' }, { status: 400 });
    }
    const action = clean(body?.action || 'list', 60).toLowerCase();
    const context = await loadContext(base44, email(user.email));

    if (action === 'list') {
      const journeys = context.descriptors
        .map((descriptor) => publicJourney(descriptor, context.storedByKey.get(descriptor.journey_key) || null))
        .sort((a, b) => String(b.delivered_date).localeCompare(String(a.delivered_date)));
      return Response.json({
        journeys,
        summary: {
          ready: journeys.filter((row) => row.status === 'ready').length,
          in_progress: journeys.filter((row) => row.status === 'in_progress').length,
          completed: journeys.filter((row) => row.status === 'completed').length,
        },
        policy: {
          quality_target_days: QUALITY_TARGET_DAYS,
          outer_freshness_days: OUTER_FRESHNESS_DAYS,
          bottle_date_is_authoritative: true,
          reminder_delivery_available: programReminderServiceEnabled(),
          timezone: TIMEZONE,
        },
      });
    }

    const target = requestedJourney(context, body);
    if (!target) return Response.json({ error: 'program_journey_not_found_or_ineligible' }, { status: 404 });
    const { descriptor } = target;

    if (action === 'get') return Response.json({ journey: publicJourney(descriptor, target.stored) });

    const commandId = clean(body?.command_id, 160);
    if (!commandId) return Response.json({ error: 'command_id_required' }, { status: 400 });
    if (target.stored?.recent_command_ids?.map(String).includes(commandId)) {
      return Response.json({ success: true, idempotent_replay: true, journey: publicJourney(descriptor, target.stored) });
    }

    if (action === 'start') {
      if (target.stored?.status && target.stored.status !== 'ready') {
        return Response.json({ error: 'program_journey_already_started', journey: publicJourney(descriptor, target.stored) }, { status: 409 });
      }
      const startDate = validDateKey(body?.start_date);
      const today = dateKeyInTimezone();
      if (!startDate || startDate < today || startDate < descriptor.delivered_date || startDate > descriptor.latest_start_date) {
        return Response.json({
          error: 'start_date_outside_freshness_window',
          earliest_start_date: today > descriptor.delivered_date ? today : descriptor.delivered_date,
          latest_start_date: descriptor.latest_start_date,
          use_by_date: descriptor.use_by_date,
        }, { status: 409 });
      }
      const now = new Date().toISOString();
      const payload = {
        ...descriptor,
        morning_shots: undefined,
        status: 'in_progress',
        start_date: startDate,
        started_at: now,
        completed_at: null,
        timezone: TIMEZONE,
        schedule_version: SCHEDULE_VERSION,
        schedule: buildSchedule(descriptor, startDate),
        completed_steps: 0,
        total_steps: Number(descriptor.program_days || 3) * PROGRAMS[descriptor.program_key].schedule.length,
        reminders_enabled: programReminderServiceEnabled() && body?.reminders_enabled === true,
        recent_command_ids: withCommand(target.stored || {}, commandId),
      };
      const saved = target.stored?.id
        ? await base44.asServiceRole.entities.ProgramJourney.update(target.stored.id, payload)
        : await base44.asServiceRole.entities.ProgramJourney.create(payload);
      return Response.json({ success: true, journey: publicJourney(descriptor, saved) });
    }

    if (!target.stored?.id) return Response.json({ error: 'program_journey_not_started' }, { status: 409 });

    if (action === 'toggle_step') {
      if (!['in_progress', 'completed'].includes(target.stored.status)) {
        return Response.json({ error: 'program_journey_not_active' }, { status: 409 });
      }
      const stepId = clean(body?.step_id, 120);
      const schedule = Array.isArray(target.stored.schedule) ? target.stored.schedule.map((step) => ({ ...step })) : [];
      const index = schedule.findIndex((step) => step.step_id === stepId);
      if (index < 0) return Response.json({ error: 'program_step_not_found' }, { status: 404 });
      const completing = body?.completed !== false;
      if (completing && dateKeyInTimezone() > descriptor.use_by_date) {
        return Response.json({ error: 'freshness_window_ended', use_by_date: descriptor.use_by_date }, { status: 409 });
      }
      if (completing && schedule[index].date > dateKeyInTimezone()) {
        return Response.json({ error: 'future_program_step_cannot_be_completed', step_date: schedule[index].date }, { status: 409 });
      }
      schedule[index].completed_at = completing ? new Date().toISOString() : null;
      const completedSteps = schedule.filter((step) => Boolean(step.completed_at)).length;
      const complete = schedule.length > 0 && completedSteps === schedule.length;
      const saved = await base44.asServiceRole.entities.ProgramJourney.update(target.stored.id, {
        schedule,
        completed_steps: completedSteps,
        total_steps: schedule.length,
        status: complete ? 'completed' : 'in_progress',
        completed_at: complete ? target.stored.completed_at || new Date().toISOString() : null,
        use_by_date: descriptor.use_by_date,
        use_by_source: descriptor.use_by_source,
        quality_target_date: descriptor.quality_target_date,
        latest_start_date: descriptor.latest_start_date,
        recent_command_ids: withCommand(target.stored, commandId),
      });
      return Response.json({ success: true, journey: publicJourney(descriptor, saved) });
    }

    if (action === 'set_reminders') {
      if (body?.reminders_enabled === true && !programReminderServiceEnabled()) {
        return Response.json({ error: 'program_reminder_service_unavailable' }, { status: 409 });
      }
      const saved = await base44.asServiceRole.entities.ProgramJourney.update(target.stored.id, {
        reminders_enabled: body?.reminders_enabled === true,
        recent_command_ids: withCommand(target.stored, commandId),
      });
      return Response.json({ success: true, journey: publicJourney(descriptor, saved) });
    }

    return Response.json({ error: 'unsupported_program_journey_action' }, { status: 400 });
  } catch (error) {
    const message = clean(error instanceof Error ? error.message : error, 300);
    console.error(`[manageProgramJourney] ${message}`);
    return Response.json({ error: 'program_journey_failed' }, { status: 500 });
  }
}
