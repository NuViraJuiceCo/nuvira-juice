// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const VALID_ACTIONS = new Set(['list', 'upsert', 'toggle_active']);
const VALID_KINDS = new Set(['promotion', 'referral']);
const VALID_TYPES = new Set(['percent', 'fixed_amount']);

function text(value: unknown, max = 1000): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function code(value: unknown): string {
  return text(value, 32).toUpperCase().replace(/\s+/g, '');
}

function number(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requestId(value: unknown): string {
  const normalized = text(value, 180);
  return /^[A-Za-z0-9._:-]+$/.test(normalized) ? normalized : '';
}

function isoDate(value: unknown): string | null {
  const normalized = text(value, 80);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function row(value: any) {
  return {
    id: value?.id || null,
    code: code(value?.code),
    display_name: text(value?.display_name, 160),
    discount_kind: text(value?.discount_kind, 40),
    discount_type: text(value?.discount_type, 40),
    discount_value: number(value?.discount_value) ?? 0,
    minimum_subtotal: number(value?.minimum_subtotal) ?? 0,
    maximum_discount: number(value?.maximum_discount) ?? 0,
    once_per_customer: value?.once_per_customer === true,
    starts_at: text(value?.starts_at, 80) || null,
    ends_at: text(value?.ends_at, 80) || null,
    active: value?.active === true,
    internal_notes: text(value?.internal_notes, 1000),
    created_date: text(value?.created_date, 80) || null,
    updated_date: text(value?.updated_date, 80) || null,
  };
}

async function commandReplay(base44: any, idempotencyKey: string) {
  const rows = await base44.asServiceRole.entities.CommandLog.filter({ idempotency_key: idempotencyKey }, '-created_date', 5).catch(() => []);
  const existing = Array.isArray(rows) ? rows[0] : null;
  if (!existing) return null;
  if (existing.status === 'success' && existing.result) return { ...existing.result, idempotent_replay: true };
  return { error: 'discount_command_already_recorded', command_status: existing.status || 'pending' };
}

async function createCommand(base44: any, user: any, body: any, commandType: string, targetId: string | null) {
  const id = requestId(body.request_id);
  if (!id) throw new Error('valid_request_id_required');
  const idempotencyKey = `admin_discount_code:${commandType}:${id}`;
  const replay = await commandReplay(base44, idempotencyKey);
  if (replay) return { replay, command: null, idempotencyKey };
  const now = new Date().toISOString();
  const command = await base44.asServiceRole.entities.CommandLog.create({
    command_id: id,
    command_type: commandType,
    command_source: 'customer_app_admin',
    status: 'pending',
    target_entity: 'DiscountCode',
    target_id: targetId,
    actor_email: user.email,
    actor_role: user.role,
    actor_type: 'user',
    payload: { discount_code_id: targetId, code: code(body.code), requested_active: body.active === true },
    idempotency_key: idempotencyKey,
    request_id: id,
    submitted_at: now,
    function_name: 'manageAdminDiscountCode',
  });
  return { replay: null, command, idempotencyKey };
}

async function finalizeCommand(base44: any, command: any, status: string, result: any, errorCode: string | null = null) {
  if (!command?.id) return;
  await base44.asServiceRole.entities.CommandLog.update(command.id, {
    status,
    result,
    ...(errorCode ? { error_code: errorCode, error_message: errorCode } : {}),
    completed_at: new Date().toISOString(),
  });
}

function validatePayload(body: any) {
  const normalizedCode = code(body.code);
  const displayName = text(body.display_name, 160);
  const kind = text(body.discount_kind || 'promotion', 40).toLowerCase();
  const type = text(body.discount_type || 'percent', 40).toLowerCase();
  const discountValue = number(body.discount_value);
  const minimumSubtotal = number(body.minimum_subtotal ?? 0);
  const maximumDiscount = number(body.maximum_discount ?? 0);
  const startsAt = isoDate(body.starts_at);
  const endsAt = isoDate(body.ends_at);

  if (!/^[A-Z0-9_-]{3,32}$/.test(normalizedCode)) throw new Error('invalid_discount_code');
  if (!displayName) throw new Error('display_name_required');
  if (!VALID_KINDS.has(kind)) throw new Error('invalid_discount_kind');
  if (!VALID_TYPES.has(type)) throw new Error('invalid_discount_type');
  if (discountValue === null || discountValue <= 0 || (type === 'percent' && discountValue > 100)) throw new Error('invalid_discount_value');
  if (minimumSubtotal === null || minimumSubtotal < 0 || maximumDiscount === null || maximumDiscount < 0) throw new Error('invalid_discount_limits');
  if (text(body.starts_at) && !startsAt) throw new Error('invalid_start_date');
  if (text(body.ends_at) && !endsAt) throw new Error('invalid_end_date');
  if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) throw new Error('discount_end_must_follow_start');

  return {
    code: normalizedCode,
    display_name: displayName,
    discount_kind: kind,
    discount_type: type,
    discount_value: discountValue,
    minimum_subtotal: minimumSubtotal,
    maximum_discount: maximumDiscount,
    once_per_customer: body.once_per_customer === true,
    starts_at: startsAt || '',
    ends_at: endsAt || '',
    active: body.active === true,
    internal_notes: text(body.internal_notes, 1000),
  };
}

export default async function handler(req: Request) {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 });
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'malformed_json' }, { status: 400 });
    const action = text(body.action || 'list', 40).toLowerCase();
    if (!VALID_ACTIONS.has(action)) return Response.json({ error: 'unsupported_action' }, { status: 400 });

    if (action === 'list') {
      const rows = await base44.asServiceRole.entities.DiscountCode.list('-created_date', 200);
      return Response.json({ success: true, rows: (Array.isArray(rows) ? rows : []).map(row) });
    }

    if (action === 'upsert') {
      const payload = validatePayload(body);
      const recordId = text(body.discount_code_id, 180) || null;
      const expectedConfirmation = `SAVE ${payload.code}`;
      if (text(body.confirmation, 200) !== expectedConfirmation) {
        return Response.json({ error: 'confirmation_required', confirmation_phrase: expectedConfirmation }, { status: 409 });
      }
      const commandState = await createCommand(base44, user, body, 'discount_code_upsert', recordId);
      if (commandState.replay) return Response.json(commandState.replay, { status: commandState.replay.error ? 409 : 200 });
      const duplicates = await base44.asServiceRole.entities.DiscountCode.filter({ code: payload.code }, '-created_date', 10);
      if ((Array.isArray(duplicates) ? duplicates : []).some((candidate: any) => candidate.id !== recordId)) {
        await finalizeCommand(base44, commandState.command, 'rejected', { success: false, error: 'discount_code_already_exists' }, 'discount_code_already_exists');
        return Response.json({ error: 'discount_code_already_exists' }, { status: 409 });
      }
      const saved = recordId
        ? await base44.asServiceRole.entities.DiscountCode.update(recordId, payload)
        : await base44.asServiceRole.entities.DiscountCode.create(payload);
      const result = { success: true, action, row: row(saved) };
      await finalizeCommand(base44, commandState.command, 'success', result);
      return Response.json(result);
    }

    const recordId = text(body.discount_code_id, 180);
    if (!recordId) return Response.json({ error: 'discount_code_id_required' }, { status: 400 });
    const active = body.active === true;
    const expectedConfirmation = `SET ${recordId} ${active ? 'ACTIVE' : 'INACTIVE'}`;
    if (text(body.confirmation, 240) !== expectedConfirmation) {
      return Response.json({ error: 'confirmation_required', confirmation_phrase: expectedConfirmation }, { status: 409 });
    }
    const commandState = await createCommand(base44, user, body, 'discount_code_toggle_active', recordId);
    if (commandState.replay) return Response.json(commandState.replay, { status: commandState.replay.error ? 409 : 200 });
    const saved = await base44.asServiceRole.entities.DiscountCode.update(recordId, { active });
    const result = { success: true, action, row: row(saved) };
    await finalizeCommand(base44, commandState.command, 'success', result);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'discount_management_failed');
    console.error('[manageAdminDiscountCode]', message);
    const validation = /^(valid_|invalid_|display_|discount_)/.test(message);
    return Response.json({ error: message }, { status: validation ? 400 : 500 });
  }
}
