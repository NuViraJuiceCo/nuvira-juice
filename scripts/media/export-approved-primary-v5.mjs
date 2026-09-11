#!/usr/bin/env node
// Deterministic, local-only encoding of owner-approved V5 crops; no image generation.
// Usage: node scripts/media/export-approved-primary-v5.mjs --source-root /path/to/NuVira --sharp /path/to/sharp
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
const base = 'public/images/approved-lifestyle/20260911-v5';
const provenancePath = 'scripts/media/approved-primary-photo-provenance-20260911-v5.json';
const sourceBase = 'marketing/meta-reels-v5-review-20260911/photo-set-label-preserved';
const digitalSourceType = 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia';
const sources = {
  aura: {
    master: '1d06ee0b2bae111ef60ea8331050e16c175068af297d8d9b55e33ec59dccbee5',
    primary: 'ab8101b6646f977bbc7532ade5b6ace6efe304a7106ebec66914289d28f49e4c',
    square: '0d584fd0470396328ba3e44eab485060a6635df912e78ceb84c633da5efeec14',
  },
  oasis: {
    master: 'bc748b93fd0f4148948dc5f218d5bde56a02b0aec927f3e1e8779347093f7fd2',
    primary: '203bb505ff85328a45f6a41a41c3b6b4637688ad37f3c7c862999b44004d880b',
    square: '4e85cc97d1bd9b57f23536e539e10f22a8131f2a6f1d382c5e075168876d7917',
  },
  're-nu': {
    master: '9270442b7851b487d15e728c4c4d64a766caada8dd7298f4d6af18ddaf023b2f',
    primary: '994cd9468c8344a665b2b5af8a7a33ddf65b0daa9b8d8ce31874a791c7422889',
    square: '6fb0ecd43d5214fe91ac2321eb1b78d4eb5311de966372238338503342cbfdbb',
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
    const source = `${sourceBase}/${key}/${key}-v5-label-preserved-${suffix}.png`;
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
  base_commit: '1bf90985d7a3bda4106b4baadfecbcf2a189be16',
  scope: 'Owner-approved V5 AURA, OASIS and RE-NU static photo rollout only. Render-time media mapping; no provider Product records or reel publication.',
  digital_source_type: digitalSourceType,
  preparation: 'Encode approved 1080x1350 crops directly as WebP quality 88 and provider JPEG quality 95 4:4:4 (no resize/upscale); downsize approved 1080-square crops to 640-square WebP quality 84; encode the same square crops as optional Merchant JPEG quality 95 4:4:4 without resizing. No new crop, generation, relabeling, retouch, lighting or color adjustments. Original crop XMP retained; no C2PA signature copied.',
  preservation_boundary: 'Exact source master/crop pixels verified before lossy delivery encoding. Encoded WebP/JPEG pixels are not asserted to be bit-identical to PNG sources.',
  gallery_policy: 'New V5 primary plus unchanged authentic photographic gallery. Retired V4 hero/card URLs are excluded from visible target-product galleries but old files and catalog/cart failure fallbacks remain available.',
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
