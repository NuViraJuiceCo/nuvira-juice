#!/usr/bin/env node
// Static, loopback-only review of the real built app. Never a proxy or live API.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_PRODUCT_FALLBACKS } from '../../src/lib/public-product-catalog.js';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PREVIEW_LABEL = 'Desktop layout preview · local catalog · no live checkout';
export const PREVIEW_CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'", "img-src 'self' data:", "font-src 'self' data:",
  "media-src 'self' data:", "manifest-src 'self'", "form-action 'none'",
  "frame-src 'none'", "frame-ancestors 'none'", "object-src 'none'",
  "base-uri 'none'", "worker-src 'none'",
].join('; ');

const APP_ID = '69d48d0c39891f7945481152';
const EMPTY_PUBLIC_LISTS = new Set(['Banner', 'SubscriptionBundle', 'DeliverySchedule', 'Event']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8',
};

// Prices, availability, IDs and copy remain the checked-in historical catalog.
// Only photo locations are made local; no stock/payment claims are refreshed.
export const LOCAL_CATALOG = PUBLIC_PRODUCT_FALLBACKS.map(product => ({
  ...product,
  image_url: product.slug === 'large-nuvira-tote-bag'
    ? '/images/brand/nuvira-tote-bag.jpg'
    : `/images/products/${product.slug === 'the-nuvira-trio' ? 'nuvira-trio' : product.slug}-main.jpg`,
}));

export function parseArguments(args = process.argv.slice(2)) {
  const options = { dist: path.join(REPO_ROOT, 'dist'), port: 4196 };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!['--dist', '--port'].includes(arg) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
    const value = args[++index];
    if (arg === '--dist') options.dist = path.resolve(value);
    else {
      if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) {
        throw new Error('--port must be an integer from 1024 through 65535');
      }
      options.port = Number(value);
    }
  }
  return options;
}

export function safeRequestPath(rawUrl = '/') {
  // Check the raw path BEFORE URL parsing can normalize /../ away.
  if (!rawUrl.startsWith('/') || rawUrl.startsWith('//')) throw new Error('Invalid request path');
  const rawPath = rawUrl.split(/[?#]/, 1)[0];
  const pathname = decodeURIComponent(rawPath);
  if (/[\\\u0000-\u001f\u007f]/.test(pathname) || pathname.split('/').some(segment => segment === '..' || segment === '.')) {
    throw new Error('Invalid request path');
  }
  return pathname;
}

function within(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

export function injectPreviewBadge(html) {
  const badge = `<aside data-desktop-preview-badge="true" aria-label="Local preview notice" style="position:fixed;z-index:2147483647;right:8px;bottom:8px;max-width:calc(100vw - 16px);padding:6px 10px;border:1px solid #a7c4b0;border-radius:8px;background:#102c20;color:#fff;font:11px/1.4 system-ui,sans-serif;box-shadow:0 2px 10px #0003;pointer-events:none">${PREVIEW_LABEL}</aside>`;
  if (!/<body(?:\s[^>]*)?>/i.test(html)) throw new Error('Expected built HTML with a body');
  return html.replace(/<body(?:\s[^>]*)?>/i, match => `${match}\n${badge}`);
}

function jsonReply(status, data) {
  return { status, type: MIME['.json'], body: Buffer.from(JSON.stringify(data)) };
}

function integerParameter(params, key, fallback) {
  const value = params.get(key);
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`Invalid ${key}`);
  return Number(value);
}

export function apiReply(pathname, params) {
  if (/\/functions(?:\/|$)/i.test(pathname)) {
    return jsonReply(403, { error: 'Functions and live services are disabled in this local preview.' });
  }
  if (/\/auth(?:\/|$)/i.test(pathname) || /\/entities\/User(?:\/|$)/.test(pathname)) {
    return jsonReply(401, { error: 'Anonymous local preview. Authentication is disabled.' });
  }
  const match = pathname.match(/^\/api\/apps\/([^/]+)\/entities\/([A-Za-z]+)\/?$/);
  if (!match || match[1] !== APP_ID) {
    return jsonReply(403, { error: 'Only explicit public fixture reads are allowed.' });
  }
  const entity = match[2];
  if (EMPTY_PUBLIC_LISTS.has(entity)) return jsonReply(200, []);
  if (entity !== 'Product') return jsonReply(403, { error: 'This entity is not available in the public local preview.' });
  try {
    const filter = JSON.parse(params.get('q') || '{}');
    if (!filter || Array.isArray(filter) || typeof filter !== 'object' ||
      Object.values(filter).some(value => value !== null && !['string', 'boolean', 'number'].includes(typeof value))) {
      throw new Error('Only exact scalar public product filters are allowed');
    }
    const products = LOCAL_CATALOG.filter(product => Object.entries(filter)
      .every(([key, value]) => Object.hasOwn(product, key) && product[key] === value));
    const skip = integerParameter(params, 'skip', 0);
    const limit = integerParameter(params, 'limit', products.length);
    // The fallback has no sort_order values; retain its authoritative sequence.
    return jsonReply(200, products.slice(skip, skip + Math.min(limit, LOCAL_CATALOG.length)));
  } catch {
    return jsonReply(400, { error: 'Invalid public catalog query.' });
  }
}

export async function createPreviewHandler({ dist, port = 4196 }) {
  const resolvedDist = await fs.realpath(path.resolve(dist));
  const indexPath = path.join(resolvedDist, 'index.html');
  if (!within(resolvedDist, await fs.realpath(indexPath))) throw new Error('index.html escapes the requested dist');
  // Refuse a source directory or a missing/unfinished build.
  const indexHtml = await fs.readFile(indexPath, 'utf8');
  if (!/<script\b[^>]*\bsrc=["']\/assets\//i.test(indexHtml)) {
    throw new Error('The selected --dist must contain a built Vite index.html');
  }
  for (const product of LOCAL_CATALOG) {
    const photo = await fs.realpath(path.join(resolvedDist, product.image_url));
    if (!within(resolvedDist, photo)) throw new Error('A local product photo escapes the requested dist');
  }
  const htmlWithBadge = Buffer.from(injectPreviewBadge(indexHtml));
  return async (req, res) => {
    res.setHeader('Content-Security-Policy', PREVIEW_CSP);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('X-Desktop-Preview', 'local-historical-catalog; no-live-checkout; no-proxy');
    const send = ({ status, type, body }) => {
      res.statusCode = status;
      res.setHeader('Content-Type', type);
      res.setHeader('Content-Length', body.length);
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    try {
      // Every non-read method is denied before any route or fixture dispatch.
      if (!['GET', 'HEAD'].includes(req.method)) return send(jsonReply(403, { error: 'All writes are disabled in this local preview.' }));
      if (![undefined, `127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) {
        return send(jsonReply(403, { error: 'Loopback preview host required.' }));
      }
      let pathname;
      try { pathname = safeRequestPath(req.url); }
      catch { return send(jsonReply(400, { error: 'Invalid request path.' })); }
      const params = new URL(req.url, `http://127.0.0.1:${port}`).searchParams;
      if (pathname === '/api' || pathname.startsWith('/api/') || /\/functions(?:\/|$)/i.test(pathname)) return send(apiReply(pathname, params));
      const candidate = path.resolve(resolvedDist, `.${pathname}`);
      if (!within(resolvedDist, candidate)) return send(jsonReply(403, { error: 'Path not allowed.' }));
      let realFile;
      try {
        realFile = await fs.realpath(candidate);
        if (!within(resolvedDist, realFile)) return send(jsonReply(403, { error: 'Path not allowed.' }));
        if (!(await fs.stat(realFile)).isFile()) realFile = undefined;
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      }
      if (realFile) {
        const extension = path.extname(realFile).toLowerCase();
        if (!MIME[extension]) return send(jsonReply(403, { error: 'File type not available in preview.' }));
        const body = extension === '.html'
          ? Buffer.from(injectPreviewBadge(await fs.readFile(realFile, 'utf8')))
          : await fs.readFile(realFile);
        return send({ status: 200, type: MIME[extension], body });
      }
      // Missing JSON/assets never become a successful SPA HTML response.
      const extension = path.extname(pathname).toLowerCase();
      if (extension && extension !== '.html') return send(jsonReply(404, { error: 'Local file not found.' }));
      if ((req.headers.accept || '').includes('application/json')) return send(jsonReply(403, { error: 'Unknown JSON read is disabled.' }));
      return send({ status: 200, type: MIME['.html'], body: htmlWithBadge });
    } catch (error) {
      console.error(`Preview request failed locally: ${error.code || error.name}`);
      return send(jsonReply(500, { error: 'Local preview could not read this resource.' }));
    }
  };
}

async function main() {
  const options = parseArguments();
  if (options.help) {
    console.log('Usage: node scripts/qa/serve-desktop-preview.mjs [--dist /absolute/built/dist] [--port 4196]\nDefault: this repository’s dist on 127.0.0.1:4196. Use --dist with --port 4197 for a baseline comparison.');
    return;
  }
  const handler = await createPreviewHandler(options);
  const server = http.createServer(handler);
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', resolve);
  });
  console.log(`${PREVIEW_LABEL}\nURL: http://127.0.0.1:${options.port}/\nBuilt files: ${options.dist}\nCatalog: checked-in historical fallback; local photos; no proxy; every write/function request returns 403.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
