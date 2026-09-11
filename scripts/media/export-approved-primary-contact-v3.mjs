#!/usr/bin/env node
// Deterministic, local-only encoding of owner-approved contact-relight-v3 crops; no image generation.
// Usage: node scripts/media/export-approved-primary-contact-v3.mjs --source-root /path/to/NuVira --sharp /path/to/sharp
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
assert.ok(args.includes('--source-root'), 'Pass the workspace containing the approved marketing/photo sources');
const sourceRoot = path.resolve(option('--source-root'));
const require = createRequire(import.meta.url);
const sharp = require(args.includes('--sharp') ? path.resolve(option('--sharp')) : 'sharp');
const base = 'public/images/approved-lifestyle/20260911-contact-v3';
const provenancePath = 'scripts/media/approved-primary-photo-provenance-20260911-contact-v3.json';
const sourceBase = 'marketing/product-contact-review-20260911';
const digitalSourceType = 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia';
const sources = {
  aura: {
    master: 'db0245ac372cbba90d4d6122c64198b155d51dc6e5d4498e48cd1441b4e9c839',
    primary: '0cc7ea1a3c1698f50fef5002603443b6f953a7eb476b147d0e774fc7225d6bd2',
    square: '25c35a0a7404f6e22b90a7fa939058e2aa17ef7b19ee1e922b2bd4247a9d94b7',
  },
  oasis: {
    master: 'a258d1ad90ae9bd4588bf97dbc38ab90b098d3c82b9dfc5b4014b2117beaeae3',
    primary: 'dcdba59f641377f385d2b88920c99140c835a375e95014209c341b0f63e04987',
    square: 'a00ca513736c7f10063b33083eefb4f118ec7e1da04ec0b2b470b1a2d9257e08',
  },
  're-nu': {
    master: '74ca8c776d38ef02fa6b371074859d8fb0db2f058a37b016e1faa9cbfd822794',
    primary: 'd526764dca1e289142a69f42720d0d115f06c11c15bb3a4e569e4c17fcfe98f9',
    square: '3cd24c7b2a49523b0d4f68badad60cfd7334d4aac2b27edc80bfef2f4ba37b9e',
  },
};
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const exists = async file => fs.access(file).then(() => true, () => false);
assert.equal(await exists(path.join(root, base)), false, 'Refusing to overwrite an existing approved version');
assert.equal(await exists(path.join(root, provenancePath)), false, 'Refusing to overwrite existing provenance');

// Validate every frozen source and exact master crop before creating any output.
const inputs = {};
for (const [key, expected] of Object.entries(sources)) {
  inputs[key] = {};
  for (const [kind, suffix, dimensions] of [['master', '9x16', [1080, 1920]], ['primary', '4x5', [1080, 1350]], ['square', '1x1', [1080, 1080]]]) {
    const source = `${sourceBase}/${key}-contact-relight-v3/${key}-contact-relight-v3-${suffix}.png`;
    const bytes = await fs.readFile(path.join(sourceRoot, source));
    assert.equal(sha(bytes), expected[kind], `${key} ${kind}: source differs from owner-approved bytes`);
    const metadata = await sharp(bytes).metadata();
    assert.deepEqual([metadata.width, metadata.height], dimensions, source);
    assert.ok(metadata.xmp?.toString().includes(digitalSourceType), `${source}: missing truthful composite XMP`);
    inputs[key][kind] = { source, bytes, metadata };
  }
  for (const [kind, top, height] of [['primary', 250, 1350], ['square', 380, 1080]]) {
    const crop = await sharp(inputs[key].master.bytes).extract({ left: 0, top, width: 1080, height }).ensureAlpha().raw().toBuffer();
    const actual = await sharp(inputs[key][kind].bytes).ensureAlpha().raw().toBuffer();
    assert.ok(crop.equals(actual), `${key} ${kind}: approved source is not an exact master crop`);
  }
}

const record = {
  approval_date: '2026-09-11',
  approval_status: 'OWNER APPROVED FOR PHOTO ROLLOUT; REEL WORK STOPPED',
  approval_scope: 'Latest explicit owner approval covers contact-relight-v3 photos across all channel sizes. Historical review-manifest approval-pending text is retained as history, not the current approval state.',
  historical_review_manifest: 'marketing/product-contact-review-20260911/review-manifest.json',
  base_commit: '5b757f261896b2c909761cec16f2909912cc0c9b',
  scope: 'Owner-approved contact-relight-v3 AURA, OASIS and RE-NU static photo rollout across all channel sizes. Render-time media mapping; no provider Product records or reel publication.',
  digital_source_type: digitalSourceType,
  preparation: 'Encode approved 1080x1350 crops directly as WebP quality 88 and provider JPEG quality 95 4:4:4 (no resize/upscale); downsize approved 1080-square crops to 640-square WebP quality 84; encode the same square crops as optional Merchant JPEG quality 95 4:4:4 without resizing. No new crop, generation, relabeling, retouch, lighting or color adjustments. Original crop XMP retained; no C2PA signature copied.',
  preservation_boundary: 'Exact source master/crop pixels verified before lossy delivery encoding. Encoded WebP/JPEG pixels are not asserted to be bit-identical to PNG sources.',
  gallery_policy: 'New contact-relight-v3 primary plus unchanged authentic photographic gallery. Retired V4 and V5 hero/card URLs are excluded from visible target-product galleries but old files and catalog/cart failure fallbacks remain available.',
  provider_upload_performed: false,
  assets: {},
};
await fs.mkdir(path.join(root, base), { recursive: true });
for (const [key, expected] of Object.entries(sources)) {
  const source = inputs[key];
  const asset = {
    master_source: source.master.source, master_sha256: expected.master,
    primary_source: source.primary.source, primary_source_sha256: expected.primary,
    square_source: source.square.source, square_source_sha256: expected.square,
    approved_source_crop_pixel_parity: 'PASS',
    outputs: {},
  };
  for (const kind of ['primary', 'card', 'merchant', 'provider']) {
    const portrait = kind === 'primary' || kind === 'provider';
    const jpeg = kind === 'merchant' || kind === 'provider';
    const input = portrait ? source.primary : source.square;
    let pipeline = sharp(input.bytes).withXmp(input.metadata.xmp.toString());
    if (kind === 'card') pipeline = pipeline.resize(640, 640, { fit: 'inside', withoutEnlargement: true });
    const output = await (jpeg
      ? pipeline.jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
      : pipeline.webp({ quality: kind === 'card' ? 84 : 88, effort: 6 })).toBuffer();
    const metadata = await sharp(output).metadata();
    const dimensions = portrait ? [1080, 1350] : kind === 'card' ? [640, 640] : [1080, 1080];
    assert.deepEqual([metadata.width, metadata.height], dimensions);
    assert.deepEqual(metadata.xmp, input.metadata.xmp, `${key} ${kind}: XMP must survive encoding`);
    assert.ok(output.length < (kind === 'card' ? 80_000 : kind === 'primary' ? 500_000 : 5_000_000), `${key} ${kind}: over size budget`);
    const file = `${base}/${key}-${kind}.${jpeg ? 'jpg' : 'webp'}`;
    await fs.writeFile(path.join(root, file), output, { flag: 'wx' });
    asset.outputs[kind] = { path: file, sha256: sha(output), bytes: output.length, dimensions, xmp_sha256: sha(metadata.xmp), xmp_preserved: true };
  }
  record.assets[key] = asset;
}
await fs.writeFile(path.join(root, provenancePath), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ ok: true, provenance: provenancePath, assets: record.assets }, null, 2));
