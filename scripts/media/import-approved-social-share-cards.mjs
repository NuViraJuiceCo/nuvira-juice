#!/usr/bin/env node
// Copy the existing approved JPEG exports only: no resizing, re-encoding,
// generation or provider action. Retire only the six never-deployed PNG copies.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sourceRoot = process.argv[2];
assert.ok(sourceRoot, 'Pass the workspace containing marketing/link-preview-cards-20260911/review-v1');
const require = createRequire(import.meta.url);
const sharp = require(process.argv[3] || 'sharp');
const sourceDirectory = 'marketing/link-preview-cards-20260911/review-v1';
const expected = {
  oasis: '2e95bd053c9caf337e011b4de0378887863688edba8d77a6a1bb4ec33724f5fb',
  aura: 'ef5a3fb787307a6ceaa5eb57c2c9b035a570d687b54efdac385466f043c502d1',
  're-nu': '7f39bac751addadf516b26d82e02569aaba0abdd3c030902e8a098c2cd45834e',
  trio: 'b1269619db5b873d98698ab4b55d58087b355a1106ca94c41d605602f46f0e84',
  homepage: 'c07e989f6217ebbe75a232ca2947723e3a2c5f050f714c0c93437c1a06501e2b',
  shop: '18bd9edaffab1a04ff416be88edc43cb27bfd6cb9568c7042c358c1231845fe4',
};
const destination = 'public/images/social-share/20260911-approved-jpeg-v1';
const retiredDirectory = 'public/images/social-share/20260911-approved-v1';
const receiptPath = 'scripts/media/approved-social-share-jpeg-provenance-20260911.json';
assert.equal(fs.existsSync(path.join(root, destination)), false, 'Immutable output directory already exists');
assert.equal(fs.existsSync(path.join(root, receiptPath)), false, 'Provenance already exists');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, sourceDirectory, 'manifest.json'), 'utf8'));
const retiredReceipt = JSON.parse(fs.readFileSync(path.join(root, 'scripts/media/approved-social-share-provenance-20260911.json'), 'utf8'));
assert.equal(retiredReceipt.assets.length, 6);
assert.deepEqual(fs.readdirSync(path.join(root, retiredDirectory)).sort(), Object.keys(expected).map(key => `${key}-share-1200x630.png`).sort());
for (const asset of retiredReceipt.assets) {
  assert.equal(asset.path, `${retiredDirectory}/${asset.key}-share-1200x630.png`);
  assert.equal(sha(fs.readFileSync(path.join(root, asset.path))), asset.sha256, 'Retired PNG changed; stop before removal');
}
const digitalSourceType = 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia';
const assets = [];
for (const [key, hash] of Object.entries(expected)) {
  const source = `${sourceDirectory}/${key}-share-1200x630.jpg`;
  const bytes = fs.readFileSync(path.join(sourceRoot, source));
  assert.equal(sha(bytes), hash, `${key}: approved bytes changed`);
  assert.equal(manifest.cards.find(card => card.key === key)?.jpeg, source);
  assert.equal(bytes.readUInt16BE(0), 0xffd8);
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 630);
  assert.ok(metadata.xmp?.toString().includes(digitalSourceType), `${key}: composite XMP missing`);
  assets.push({ key, source, path: `${destination}/${key}-share-1200x630.jpg`, sha256: hash, bytes: bytes.length, dimensions: [1200, 630], xmp_sha256: sha(metadata.xmp), data: bytes });
}
for (const source of manifest.sources) assert.equal(sha(fs.readFileSync(source.path)), source.sha256);
fs.mkdirSync(path.join(root, destination), { recursive: true });
for (const asset of assets) fs.writeFileSync(path.join(root, asset.path), asset.data, { flag: 'wx' });
const receipt = {
  approval: 'Owner approved all six review-v1 cards on September 11, 2026; supersedes the historical review-only manifest status.',
  source_release: '6798d21d32397b5df7d950c8f23c94f5f0b2169c',
  method: 'Exact existing approved review-v1 JPEG byte copies; no new crop, resize, retouch, regeneration or encoding.',
  reason: 'PNG site package was rejected at 53,383,538 extracted bytes; no site deployment occurred. Existing approved JPEG exports reduce the six cards from 7,776,852 to 1,660,898 bytes.',
  historical_manifest_note: 'Original review manifest records JPEG paths and PNG hashes. Exact existing JPEG hashes were independently verified and are pinned here and in the importer/tests.',
  digital_source_type: digitalSourceType,
  photo_versions: { oasis: 'contact-relight-v3', aura: 'contact-relight-v3', 're-nu': 'edge-cleanup-v4' },
  scope: 'OpenGraph/Twitter cards only. Product photos, Product JSON-LD, Merchant feeds, prices, inventory, native heroes and provider records unchanged.',
  source_manifest_sha256: sha(fs.readFileSync(path.join(sourceRoot, sourceDirectory, 'manifest.json'))),
  sources: manifest.sources,
  assets: assets.map(({ data: _data, ...asset }) => asset),
  retired_pngs: retiredReceipt.assets.map(({ path: retiredPath, sha256 }) => ({ path: retiredPath, sha256, recovery: 'Git merge 6798d21d32397b5df7d950c8f23c94f5f0b2169c and untouched review-v1 source exports' })),
  publication_performed: false,
};
fs.writeFileSync(path.join(root, receiptPath), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
for (const asset of retiredReceipt.assets) fs.unlinkSync(path.join(root, asset.path));
fs.rmdirSync(path.join(root, retiredDirectory));
console.log(JSON.stringify({ ok: true, copied: assets.length, total_bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0), publication_performed: false }, null, 2));
