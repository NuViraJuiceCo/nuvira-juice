#!/usr/bin/env node
// Copy approved PNG bytes only: no resizing, re-encoding, generation or provider action.
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
  oasis: 'fcaaf562bc9fa013779a1591da6335292969d2e168cdee6f5379c14e030caf12',
  aura: '0cf8af24c3cbf75aaf2a141e95705cfe89bd9d76af4af2d92d71a8c9147cd323',
  're-nu': '8733a01ef83627fa326f0fb060f1d6fdfd90377dbe93e66e742d7d5eeec2272a',
  trio: 'd22b04cbb5af4d6648744ab6fafd65b074c1877253be4343694ef9c51e66ef26',
  homepage: '9539688df045b5cb8d2d2af54c3127d31790867ea82b8feaece266e95925d1bb',
  shop: 'b78a55aa9865ab19cdacacdcef9adb5e92dab1fcdcda16e4cf9ce77ba5dfcddf',
};
const destination = 'public/images/social-share/20260911-approved-v1';
const receiptPath = 'scripts/media/approved-social-share-provenance-20260911.json';
assert.equal(fs.existsSync(path.join(root, destination)), false, 'Immutable output directory already exists');
assert.equal(fs.existsSync(path.join(root, receiptPath)), false, 'Provenance already exists');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, sourceDirectory, 'manifest.json'), 'utf8'));
const digitalSourceType = 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia';
const assets = [];
for (const [key, hash] of Object.entries(expected)) {
  const source = `${sourceDirectory}/${key}-share-1200x630.png`;
  const bytes = fs.readFileSync(path.join(sourceRoot, source));
  assert.equal(sha(bytes), hash, `${key}: approved bytes changed`);
  assert.equal(manifest.cards.find(card => card.key === key)?.png_sha256, hash);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
  const metadata = await sharp(bytes).metadata();
  assert.ok(metadata.xmp?.toString().includes(digitalSourceType), `${key}: composite XMP missing`);
  assets.push({ key, source, path: `${destination}/${key}-share-1200x630.png`, sha256: hash, bytes: bytes.length, dimensions: [1200, 630], xmp_sha256: sha(metadata.xmp), data: bytes });
}
for (const source of manifest.sources) assert.equal(sha(fs.readFileSync(source.path)), source.sha256);
fs.mkdirSync(path.join(root, destination), { recursive: true });
for (const asset of assets) fs.writeFileSync(path.join(root, asset.path), asset.data, { flag: 'wx' });
const receipt = {
  approval: 'Owner approved all six review-v1 cards on September 11, 2026; supersedes the historical review-only manifest status.',
  source_release: '077a9eb1309c06dda34fb6b66aac0c49c20f7690',
  method: 'Exact approved PNG byte copies; no new crop, resize, retouch, regeneration or encoding.',
  digital_source_type: digitalSourceType,
  photo_versions: { oasis: 'contact-relight-v3', aura: 'contact-relight-v3', 're-nu': 'edge-cleanup-v4' },
  scope: 'OpenGraph/Twitter cards only. Product photos, Product JSON-LD, Merchant feeds, prices, inventory, native heroes and provider records unchanged.',
  source_manifest_sha256: sha(fs.readFileSync(path.join(sourceRoot, sourceDirectory, 'manifest.json'))),
  sources: manifest.sources,
  assets: assets.map(({ data: _data, ...asset }) => asset),
  publication_performed: false,
};
fs.writeFileSync(path.join(root, receiptPath), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ ok: true, copied: assets.length, total_bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0), publication_performed: false }, null, 2));
