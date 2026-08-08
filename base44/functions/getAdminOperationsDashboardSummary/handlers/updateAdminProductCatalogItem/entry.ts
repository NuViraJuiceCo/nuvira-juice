// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function safeString(value, maxLength = 240) {
  const text = normalizeText(value).replace(/\s+/g, ' ');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function normalizeId(value, fieldName) {
  const text = normalizeText(value);
  if (!text) throw new Error(`${fieldName} is required`);
  if (text.length > 160 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function normalizePrice(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000) {
    throw new Error('price must be a number between 0 and 1000');
  }
  return Math.round(parsed * 100) / 100;
}

function normalizeImageUrl(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const text = normalizeText(value);
  if (text.length > 1000) throw new Error('image_url is too long');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('image_url must be a valid URL');
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('image_url must use http or https');
  }
  return text;
}

function buildPatch(body) {
  const patch = {};
  const title = body?.title === undefined ? undefined : safeString(body.title, 120);
  const price = normalizePrice(body?.price);
  const imageUrl = normalizeImageUrl(body?.image_url);

  if (body?.title !== undefined) {
    if (!title) throw new Error('title cannot be blank');
    patch.title = title;
  }

  if (price !== undefined) patch.price = price;
  if (imageUrl !== undefined) patch.image_url = imageUrl;

  const fields = Object.keys(patch);
  if (fields.length === 0) throw new Error('No supported product fields provided');
  return patch;
}

function sanitizeProduct(product) {
  return {
    id: safeString(product?.id, 160),
    title: safeString(product?.title, 160),
    price: Number.isFinite(Number(product?.price)) ? Number(product.price) : null,
    category: safeString(product?.category, 120),
    image_url: safeString(product?.image_url, 1000),
    is_available: product?.is_available === true,
    updated_date: safeString(product?.updated_date, 80),
  };
}

export default async function handler(req: Request) {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await readJsonBody(req);
    if (body === null) {
      return Response.json({ success: false, error: 'malformed_json' }, { status: 400 });
    }

    const productId = normalizeId(body?.product_id, 'product_id');
    const patch = buildPatch(body);

    const existing = await base44.asServiceRole.entities.Product.filter({ id: productId });
    if (!existing || existing.length === 0) {
      return Response.json({ error: 'product_not_found' }, { status: 404 });
    }

    const updated = await base44.asServiceRole.entities.Product.update(productId, patch);

    return Response.json({
      success: true,
      product_id: productId,
      fields_updated: Object.keys(patch),
      product: sanitizeProduct(updated || { ...existing[0], ...patch }),
    });
  } catch (error) {
    const message = safeString(error?.message || 'Unknown error', 240) || 'Unknown error';
    const status = /required|unsupported|blank|valid URL|between|provided|too long/i.test(message) ? 400 : 500;
    return Response.json({ success: false, error: message }, { status });
  }
}
