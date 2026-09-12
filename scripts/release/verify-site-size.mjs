#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Base44 rejects extracted sites above 50 MB. Leave 1 MB of explicit headroom.
export const SITE_SIZE_LIMIT_BYTES = 49_000_000;
export function assertSiteSize(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > SITE_SIZE_LIMIT_BYTES) {
    throw new Error(`Site package is ${bytes} bytes; maximum permitted is ${SITE_SIZE_LIMIT_BYTES} bytes before publishing.`);
  }
  return bytes;
}
export function measureSiteSize(directory) {
  let bytes = 0;
  let files = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Site package must not contain a symlink: ${target}`);
    if (entry.isDirectory()) {
      const child = measureSiteSize(target);
      bytes += child.bytes;
      files += child.files;
    } else if (entry.isFile()) {
      bytes += fs.statSync(target).size;
      files++;
    } else throw new Error(`Unsupported site package entry: ${target}`);
  }
  return { bytes, files };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(process.argv[2] || 'dist');
  const result = measureSiteSize(directory);
  assertSiteSize(result.bytes);
  console.log(JSON.stringify({ ok: true, suite: 'built-site-size', directory, ...result, limit_bytes: SITE_SIZE_LIMIT_BYTES, headroom_bytes: SITE_SIZE_LIMIT_BYTES - result.bytes }));
}
