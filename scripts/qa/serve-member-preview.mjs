#!/usr/bin/env node
// Separate loopback preview: browser-owned authentication, narrowly scoped live reads.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiReply, parseArguments, REPO_ROOT, safeRequestPath } from './serve-desktop-preview.mjs';

export const APP_ID = '69d48d0c39891f7945481152';
export const UPSTREAM_ORIGIN = 'https://nuvirajuice.com';
const APP_PATH = `/api/apps/${APP_ID}`;
const GATEWAY = 'getCustomerAccountDashboardData';
const OWNED_ENTITIES = new Set(['UserProfile', 'BagReturn', 'NotificationPreference']);
const MAX_BODY = 32 * 1024;
const MAX_RESPONSE = 4 * 1024 * 1024;
export const MEMBER_CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'", "img-src 'self' data: https://media.base44.com https://lh3.googleusercontent.com https://nuvirajuice.com",
  "font-src 'self' data:", "media-src 'self'", "manifest-src 'self'", "form-action 'none'",
  "frame-src 'none'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'", "worker-src 'none'",
].join('; ');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain',
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysWithin = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const shortString = value => typeof value === 'string' && value.length > 0 && value.length <= 240;
const fail = (status, message) => Object.assign(new Error(message), { status });

// Validate AND reconstruct the request. Never forward unreviewed action overrides.
export function memberReadBody(body) {
  if (!object(body)) return null;
  const explicit = Object.hasOwn(body, 'gateway_action');
  if (explicit && !keysWithin(body, ['gateway_action', 'payload'])) return null;
  const action = explicit ? body.gateway_action : GATEWAY;
  const payload = explicit ? body.payload : body;
  if (!object(payload)) return null;
  if (action === GATEWAY && Object.keys(payload).length === 0) {
    return { gateway_action: action, payload: {} };
  }
  if (action === 'getCustomerNotifications' && keysWithin(payload, ['action']) && payload.action === 'list') {
    return { gateway_action: action, payload: { action: 'list' } };
  }
  if (action === 'manageProgramJourney' && keysWithin(payload, ['action', 'journey_id', 'journey_key'])) {
    if (payload.action === 'list' && Object.keys(payload).length === 1) return { gateway_action: action, payload: { action: 'list' } };
    if (payload.action === 'get' && ['journey_id', 'journey_key'].some(key => shortString(payload[key])) &&
      Object.entries(payload).every(([key, value]) => key === 'action' || shortString(value))) {
      return { gateway_action: action, payload: { ...payload } };
    }
  }
  if (action === 'getCustomerOrderDetail' && keysWithin(payload, ['order_id', 'order_number', 'source']) &&
    (shortString(payload.order_id) || shortString(payload.order_number)) && Object.values(payload).every(shortString)) {
    return { gateway_action: action, payload: { ...payload } };
  }
  return null;
}

export function ownedEntityQuery(entity, params) {
  if (!OWNED_ENTITIES.has(entity)) return null;
  if ([...params.keys()].some(key => !['q', 'sort', 'limit', 'skip'].includes(key) || params.getAll(key).length !== 1)) return null;
  let filter;
  try { filter = JSON.parse(params.get('q') || 'null'); } catch { return null; }
  if (!object(filter) || Object.keys(filter).length !== 1) return null;
  const key = Object.keys(filter)[0];
  if (!(key === 'customer_email' || (entity === 'UserProfile' && key === 'contact_email')) || !shortString(filter[key])) return null;
  const sort = params.get('sort');
  if (sort && !['created_date', '-created_date', 'updated_date', '-updated_date'].includes(sort)) return null;
  for (const name of ['skip', 'limit']) {
    if (params.has(name) && (!/^\d+$/.test(params.get(name)) || Number(params.get(name)) > 100)) return null;
  }
  const query = new URLSearchParams({ q: JSON.stringify(filter), limit: params.get('limit') || '100' });
  if (sort) query.set('sort', sort);
  if (params.has('skip')) query.set('skip', params.get('skip'));
  return { email: filter[key].trim().toLowerCase(), query: query.toString() };
}

async function readBody(req) {
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > MAX_BODY) throw fail(413, 'Preview request is too large.');
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw fail(400, 'Invalid JSON request.'); }
}

function memberHtml(html) {
  const badge = '<aside data-member-preview="true" aria-label="Member preview notice" style="position:fixed;z-index:2147483647;right:8px;bottom:8px;max-width:calc(100vw - 16px);padding:8px 12px;border:1px solid #9dbbab;border-radius:8px;background:#102c20;color:white;font:12px/1.4 system-ui;box-shadow:0 2px 10px #0003">Member design preview &middot; Real account &middot; Changes and checkout blocked</aside>';
  return html.replace(/<body(?:\s[^>]*)?>/i, match => `${match}\n${badge}`);
}

export async function createMemberPreviewHandler({ dist = path.join(REPO_ROOT, 'dist'), port = 4204, fetchImpl = fetch } = {}) {
  const root = await fs.realpath(dist);
  const within = file => file.startsWith(`${root}${path.sep}`);
  const indexPath = await fs.realpath(path.join(root, 'index.html'));
  if (!within(indexPath)) throw new Error('Invalid built index path.');
  const index = await fs.readFile(indexPath, 'utf8');
  if (!/<script\b[^>]*\bsrc=["']\/assets\//i.test(index)) throw new Error('A completed Vite dist is required.');
  const origin = `http://127.0.0.1:${port}`;

  // Only the browser's bearer token is used. No service key, cookies, credential
  // persistence, request logging, redirects, or arbitrary upstream destinations.
  const upstream = async (route, authorization, body) => {
    const headers = { Accept: 'application/json', 'X-App-Id': APP_ID };
    if (authorization) headers.Authorization = authorization;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetchImpl(`${UPSTREAM_ORIGIN}${route}`, {
      method: body === undefined ? 'GET' : 'POST', headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual', signal: AbortSignal.timeout(20_000),
    });
    if (response.status >= 300 && response.status < 400) throw fail(502, 'Unexpected upstream redirect was blocked.');
    if (!(response.headers.get('content-type') || '').includes('application/json')) throw fail(502, 'Expected an account API response.');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_RESPONSE) throw fail(502, 'Account response exceeded the preview limit.');
      chunks.push(chunk);
    }
    return { status: response.status, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  };

  return async (req, res) => {
    res.setHeader('Content-Security-Policy', MEMBER_CSP);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    const send = (status, data, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(req.method === 'HEAD' ? undefined : type === 'application/json' ? JSON.stringify(data) : data);
    };
    try {
      if (req.headers.host !== `127.0.0.1:${port}`) throw fail(403, 'Use the exact loopback preview address.');
      let pathname;
      try { pathname = safeRequestPath(req.url); }
      catch { throw fail(400, 'Invalid request path.'); }
      const params = new URL(req.url, origin).searchParams;
      if (pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/functions/')) {
        if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'Cross-origin requests are blocked.');
        if (req.headers['x-app-id'] && req.headers['x-app-id'] !== APP_ID) throw fail(403, 'App mismatch.');
        if (req.method === 'POST' && (req.headers.origin !== origin || !(req.headers['content-type'] || '').startsWith('application/json'))) throw fail(403, 'Same-origin JSON requests are required.');
        const authorization = /^Bearer [A-Za-z0-9._~+\/-]+=*$/.test(req.headers.authorization || '') ? req.headers.authorization : null;
        if (req.method === 'POST' && pathname === `${APP_PATH}/auth/login` && params.size === 0) {
          const body = await readBody(req);
          if (!keysWithin(body, ['email', 'password', 'turnstile_token']) || !shortString(body.email) || typeof body.password !== 'string' || body.password.length > 1024) throw fail(400, 'Invalid sign-in request.');
          const result = await upstream(pathname, null, body);
          return send(result.status, result.data);
        }
        if (req.method === 'GET' && pathname === `${APP_PATH}/entities/User/me` && params.size === 0) {
          if (!authorization) throw fail(401, 'Sign in to view your account.');
          const result = await upstream(pathname, authorization);
          return send(result.status, result.data);
        }
        if (req.method === 'POST' && [`${APP_PATH}/functions/${GATEWAY}`, `/api/functions/${GATEWAY}`].includes(pathname) && params.size === 0) {
          if (!authorization) throw fail(401, 'Sign in to view your account.');
          const body = memberReadBody(await readBody(req));
          if (!body) throw fail(403, 'This action is disabled in the read-only member preview.');
          const result = await upstream(`${APP_PATH}/functions/${GATEWAY}`, authorization, body);
          return send(result.status, result.data);
        }
        const entity = pathname.startsWith(`${APP_PATH}/entities/`) ? pathname.slice(`${APP_PATH}/entities/`.length) : '';
        if (req.method === 'GET' && entity === 'RewardTier' && [...params.keys()].every(key => ['q', 'sort', 'limit'].includes(key))) {
          const result = await upstream(`${APP_PATH}/entities/RewardTier?q=${encodeURIComponent('{"is_active":true}')}&sort=sort_order&limit=20`, authorization);
          return send(result.status, result.data);
        }
        const ownQuery = req.method === 'GET' ? ownedEntityQuery(entity, params) : null;
        if (ownQuery) {
          if (!authorization) throw fail(401, 'Sign in to view your account.');
          const me = await upstream(`${APP_PATH}/entities/User/me`, authorization);
          if (me.status !== 200 || !me.data?.email) return send(401, { error: 'Sign in to view your account.' });
          let identities = [String(me.data.email).trim().toLowerCase()];
          if (!identities.includes(ownQuery.email)) {
            const dashboard = await upstream(`${APP_PATH}/functions/${GATEWAY}`, authorization, { gateway_action: GATEWAY, payload: {} });
            if (dashboard.status === 200 && Array.isArray(dashboard.data?.resolved_identity_emails)) identities = dashboard.data.resolved_identity_emails.map(email => String(email).trim().toLowerCase());
          }
          if (!identities.includes(ownQuery.email)) throw fail(403, 'Only your own member records can be reviewed.');
          const result = await upstream(`${APP_PATH}/entities/${entity}?${ownQuery.query}`, authorization);
          return send(result.status, result.data);
        }
        if (['GET', 'HEAD'].includes(req.method)) {
          const fixture = apiReply(pathname, params);
          if (fixture.status === 200) return send(200, JSON.parse(fixture.body));
        }
        throw fail(403, 'Read-only preview: purchases, account changes, notifications, uploads and admin actions are blocked.');
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw fail(403, 'Writes are disabled.');
      // Do not accept a query-supplied alternate API host, app, or version.
      if (['app_id', 'app_base_url', 'functions_version'].some(key => params.has(key))) throw fail(400, 'Preview connection settings cannot be overridden.');
      const candidate = path.resolve(root, `.${pathname}`);
      let file;
      try {
        file = await fs.realpath(candidate);
        if (file !== root && !within(file)) throw fail(403, 'Path not allowed.');
        if (!(await fs.stat(file)).isFile()) file = null;
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      }
      if (file) {
        const type = TYPES[path.extname(file).toLowerCase()];
        if (!type) throw fail(403, 'File type not allowed.');
        const data = await fs.readFile(file);
        return send(200, type.startsWith('text/html') ? memberHtml(data.toString()) : data, type === 'application/json' ? 'application/json; charset=utf-8' : type);
      }
      if (path.extname(pathname) && path.extname(pathname) !== '.html') throw fail(404, 'File not found.');
      return send(200, memberHtml(index), 'text/html; charset=utf-8');
    } catch (error) {
      // Never log a request URL/body, token, identity, or upstream error payload.
      send(error.status || 502, { error: error.status ? error.message : 'Member service is unavailable. Please try again.', code: 'MEMBER_PREVIEW_GUARD' });
    }
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { console.log('node scripts/qa/serve-member-preview.mjs --port 4204 [--dist /built/dist]'); return; }
  if (!process.argv.includes('--port')) options.port = 4204;
  const server = http.createServer(await createMemberPreviewHandler(options));
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', resolve); });
  console.log(`Read-only member preview: http://127.0.0.1:${options.port}/account\nReal browser sign-in; no stored server credentials; no checkout/account/admin writes.\nPublic catalog remains the local design fixture. Stop this process when the review is finished.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Could not start member preview. Check the build directory and port.'); process.exitCode = 1; });
