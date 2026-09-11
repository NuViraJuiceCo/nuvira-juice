#!/usr/bin/env node
// Local-only delivery encoding of the owner-approved RE-NU v4 correction.
// No generation, retouching, provider upload, or modification of older assets.
// Usage: node scripts/media/export-approved-primary-re-nu-v4.mjs --source-root /path/to/NuVira --sharp /path/to/sharp
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
assert.ok(args.includes('--source-root'), 'Pass the workspace containing the approved photo sources');
const sourceRoot = path.resolve(option('--source-root'));
const require = createRequire(import.meta.url);
const sharp = require(args.includes('--sharp') ? path.resolve(option('--sharp')) : 'sharp');
const base = 'public/images/approved-lifestyle/20260911-re-nu-v4';
const provenancePath = 'scripts/media/approved-primary-photo-provenance-20260911-re-nu-v4.json';
const sourceBase = 'marketing/product-contact-review-20260911/re-nu-edge-cleanup-v4';
const digitalSourceType = 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia';
const sources = {
  master: { suffix: '9x16', dimensions: [1080, 1920], sha256: '3543b29c3b935ca06e9280636b0fd2519efa153c00738146e210bf1188b0ddd0' },
  primary: { suffix: '4x5', dimensions: [1080, 1350], sha256: '1cdc1499ecdfc376b98d2116f5495a2239612d0102fa54fd1300be25be6fc505' },
  square: { suffix: '1x1', dimensions: [1080, 1080], sha256: '9952494b092bba9cb747af92b1ebcfc43303a33c607e1307347a90b7fd3feedf' },
};
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const exists = async file => fs.access(file).then(() => true, () => false);
assert.equal(await exists(path.join(root, base)), false, 'Refusing to overwrite an existing approved version');
assert.equal(await exists(path.join(root, provenancePath)), false, 'Refusing to overwrite existing provenance');

const inputs = {};
for (const [kind, expected] of Object.entries(sources)) {
  const source = `${sourceBase}/re-nu-edge-cleanup-v4-${expected.suffix}.png`;
  const bytes = await fs.readFile(path.join(sourceRoot, source));
  assert.equal(sha(bytes), expected.sha256, `${kind}: source differs from owner-approved bytes`);
  const metadata = await sharp(bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], expected.dimensions, source);
  assert.ok(metadata.xmp?.toString().includes(digitalSourceType), `${source}: missing truthful composite XMP`);
  inputs[kind] = { source, bytes, metadata };
}
for (const [kind, top, height] of [['primary', 250, 1350], ['square', 380, 1080]]) {
  const crop = await sharp(inputs.master.bytes).extract({ left: 0, top, width: 1080, height }).ensureAlpha().raw().toBuffer();
  const actual = await sharp(inputs[kind].bytes).ensureAlpha().raw().toBuffer();
  assert.ok(crop.equals(actual), `${kind}: approved source must be an exact master crop`);
}

const previousPath = 'marketing/product-contact-review-20260911/re-nu-contact-relight-v3/re-nu-contact-relight-v3-9x16.png';
const previousBytes = await fs.readFile(path.join(sourceRoot, previousPath));
assert.equal(sha(previousBytes), '74ca8c776d38ef02fa6b371074859d8fb0db2f058a37b016e1faa9cbfd822794');
const before = await sharp(previousBytes).removeAlpha().raw().toBuffer();
const after = await sharp(inputs.master.bytes).removeAlpha().raw().toBuffer();
assert.equal(before.length, after.length);
const editBounds = { left: 682, top: 1338, right: 1000, bottom: 1440 };
let changedPixels = 0;
for (let i = 0; i < before.length; i += 3) {
  if (before[i] === after[i] && before[i + 1] === after[i + 1] && before[i + 2] === after[i + 2]) continue;
  const pixel = i / 3;
  const x = pixel % 1080;
  const y = Math.floor(pixel / 1080);
  assert.ok(x >= editBounds.left && x < editBounds.right && y >= editBounds.top && y < editBounds.bottom, 'Pixels outside approved base/contact region must be unchanged');
  changedPixels += 1;
}
assert.equal(changedPixels, 28795);

const asset = {
  master_source: inputs.master.source, master_sha256: sources.master.sha256,
  primary_source: inputs.primary.source, primary_source_sha256: sources.primary.sha256,
  square_source: inputs.square.source, square_source_sha256: sources.square.sha256,
  approved_source_crop_pixel_parity: 'PASS',
  previous_master_source: previousPath,
  previous_master_sha256: sha(previousBytes),
  edited_bounds: editBounds,
  changed_pixels: changedPixels,
  outside_edit_region_changed_pixels: 0,
  protected_above_y1338_changed_pixels: 0,
  outputs: {},
};
const record = {
  approval_date: '2026-09-11',
  approval_status: 'OWNER APPROVED RE-NU V4 HERO REPLACEMENT; REEL WORK STOPPED',
  approval_scope: 'Latest explicit owner approval supersedes the historical review-pending status in the source verification receipt. RE-NU only; OASIS and AURA remain unchanged.',
  historical_verification: `${sourceBase}/verification.json`,
  base_commit: '1866463859d9578dea65eb00cbb91885718b51ed',
  scope: 'RE-NU render-time primary/card replacement only; no catalog/provider writes or identity resolver expansion.',
  digital_source_type: digitalSourceType,
  preparation: 'Same approved pipeline: 1080x1350 WebP quality 88; 640-square WebP quality 84; 1080x1350 provider JPEG and 1080-square Merchant JPEG quality 95, 4:4:4. No new crop, retouch, lighting, generation or color changes. Source XMP retained; no C2PA signature copied.',
  preservation_boundary: 'Exact source master/crop pixels verified before lossy delivery encoding. Only the approved unprinted bottle-base/contact region differs from v3. Label, cap, headspace and all source pixels outside the edit bounds are unchanged; encoded pixels are not asserted bit-identical to PNG sources.',
  gallery_policy: 'RE-NU v3 primary/card join its retired hero list; authentic secondaries and old files remain available. OASIS and AURA mapping/assets are unchanged.',
  provider_upload_performed: false,
  assets: { 're-nu': asset },
};
await fs.mkdir(path.join(root, base), { recursive: true });
for (const kind of ['primary', 'card', 'merchant', 'provider']) {
  const portrait = kind === 'primary' || kind === 'provider';
  const jpeg = kind === 'merchant' || kind === 'provider';
  const input = portrait ? inputs.primary : inputs.square;
  let pipeline = sharp(input.bytes).withXmp(input.metadata.xmp.toString());
  if (kind === 'card') pipeline = pipeline.resize(640, 640, { fit: 'inside', withoutEnlargement: true });
  const output = await (jpeg ? pipeline.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }) : pipeline.webp({ quality: kind === 'card' ? 84 : 88, effort: 6 })).toBuffer();
  const metadata = await sharp(output).metadata();
  const dimensions = portrait ? [1080, 1350] : kind === 'card' ? [640, 640] : [1080, 1080];
  assert.deepEqual([metadata.width, metadata.height], dimensions);
  assert.deepEqual(metadata.xmp, input.metadata.xmp, `${kind}: XMP must survive encoding`);
  assert.ok(output.length < (kind === 'card' ? 80_000 : kind === 'primary' ? 500_000 : 5_000_000));
  const file = `${base}/re-nu-${kind}.${jpeg ? 'jpg' : 'webp'}`;
  await fs.writeFile(path.join(root, file), output, { flag: 'wx' });
  asset.outputs[kind] = { path: file, sha256: sha(output), bytes: output.length, dimensions, xmp_sha256: sha(metadata.xmp), xmp_preserved: true };
}
await fs.writeFile(path.join(root, provenancePath), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ ok: true, provenance: provenancePath, assets: record.assets }, null, 2));
