#!/usr/bin/env node
// Local-only faithful delivery encoding. No installation, upload, source edits,
// cropping, retouching, sharpening, color adjustments, or image generation.
// node scripts/media/export-website-image-derivatives.mjs --sharp /path/to/sharp
// Add --verify to re-encode and byte-verify existing output without writing.
// Optional --qa-dir /outside/repository writes side-by-side visual-review PNGs.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const sharp = createRequire(import.meta.url)(option('--sharp') ? path.resolve(option('--sharp')) : 'sharp');
const verify = args.includes('--verify');
const qaDir = option('--qa-dir') ? path.resolve(option('--qa-dir')) : null;
const inputFile = 'scripts/media/website-image-inputs-20261006.json';
const provenanceFile = 'scripts/media/website-image-provenance-20261006.json';
const outputBase = 'public/images/website-performance-20261006';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const frozen = JSON.parse(await fs.readFile(path.join(root, inputFile), 'utf8'));
const records = [];
const comparisons = [];
let outputBytes = 0;
assert.equal(sharp.versions.sharp, '0.35.4', 'Use the recorded existing Sharp version; do not silently change the encoder');
assert.equal(sharp.versions.webp, '1.6.0');
if (qaDir) {
  assert.ok(!qaDir.startsWith(path.join(root, 'public') + path.sep), 'QA images must not enter the site package');
  await fs.mkdir(qaDir, { recursive: true });
}
async function verifyOrCreate(relative, bytes) {
  const file = path.join(root, relative);
  const existing = await fs.readFile(file).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing) assert.ok(existing.equals(bytes), `Refusing to overwrite different existing bytes: ${relative}`);
  else {
    assert.equal(verify, false, `Missing derivative: ${relative}`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes, { flag: 'wx' });
  }
}
for (const input of frozen.inputs) {
  const bytes = await fs.readFile(path.join(root, input.path));
  assert.equal(sha(bytes), input.sha256, `Original changed: ${input.path}`);
  const metadata = await sharp(bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], [input.width, input.height]);
  assert.ok(!metadata.orientation || metadata.orientation === 1, 'Do not silently rotate a source');
  assert.equal(metadata.space, 'srgb', 'Unexpected source color space requires review');
  const record = { ...input, xmp_sha256: metadata.xmp ? sha(metadata.xmp) : null, outputs: [] };
  for (const width of input.widths) {
    const quality = input.role === 'hero' ? 82 : 84;
    let pipeline = sharp(bytes).resize({ width, withoutEnlargement: true, kernel: 'lanczos3' });
    if (metadata.xmp) pipeline = pipeline.withXmp(metadata.xmp.toString());
    const encoded = await pipeline.webp({ quality, effort: 6 }).toBuffer();
    const output = await sharp(encoded).metadata();
    assert.equal(output.width, width);
    // libvips JPEG shrink-on-load can round the inferred height by one pixel.
    assert.ok(Math.abs(output.height - input.height * width / input.width) <= 1, 'Aspect ratio must be preserved within one output pixel');
    assert.deepEqual(output.xmp, metadata.xmp, 'Preserve truthful source metadata');
    const stem = path.basename(input.path, '.jpg');
    const relative = `${outputBase}/${input.role === 'hero' ? 'heroes' : 'gallery'}/${stem}-${width}.webp`;
    const originalScaled = await sharp(bytes).resize({ width, withoutEnlargement: true, kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
    const actual = await sharp(encoded).removeAlpha().raw().toBuffer();
    assert.equal(originalScaled.length, actual.length);
    let squaredError = 0;
    for (let i = 0; i < actual.length; i++) squaredError += (actual[i] - originalScaled[i]) ** 2;
    const psnr = 10 * Math.log10(255 ** 2 / (squaredError / actual.length));
    assert.ok(psnr > 28, `Unexpected fidelity loss requires visual review: ${relative}`);
    record.outputs.push({ path: relative, bytes: encoded.length, sha256: sha(encoded), width: output.width, height: output.height, quality, effort: 6, xmp_preserved: true, psnr_db_against_same_size_original: Number(psnr.toFixed(3)), bytes_saved_against_original: bytes.length - encoded.length, reduction_percent: Number(((1 - encoded.length / bytes.length) * 100).toFixed(2)) });
    outputBytes += encoded.length;
    comparisons.push({ input: input.path, stem, width, source: bytes, encoded, role: input.role });
    await verifyOrCreate(relative, encoded);
  }
  records.push(record);
}
assert.ok(outputBytes <= 1_400_000, 'Preserve at least 300KB site headroom; do not expand this asset set silently');
const provenance = {
  source_commit: frozen.source_commit,
  input_manifest: inputFile,
  policy: frozen.policy,
  encoder: { sharp: sharp.versions.sharp, vips: sharp.versions.vips, webp: sharp.versions.webp, resize_kernel: 'lanczos3', crop: 'none', orientation_change: 'none', color_adjustment: 'none' },
  website_only: true,
  originals_retained: true,
  native_original_paths_retained: true,
  metadata: 'Original XMP retained byte-for-byte; orientation already1. Resizing and lossy encoding are disclosed; decoded pixels are not claimed identical.',
  output_count: records.reduce((sum, record) => sum + record.outputs.length, 0),
  output_bytes: outputBytes,
  assets: records,
};
await verifyOrCreate(provenanceFile, Buffer.from(JSON.stringify(provenance, null, 2) + '\n'));
if (qaDir) {
  // Small review sheets show original (left) and encoded derivative (right),
  // normalized to identical viewing dimensions, without new crop or retouching.
  for (const role of ['hero', 'gallery-thumbnail']) {
    const items = comparisons.filter(item => item.role === role);
    for (let start = 0; start < items.length; start += 4) {
      const page = items.slice(start, start + 4);
      const overlays = [];
      for (let index = 0; index < page.length; index++) {
        const item = page[index];
        const top = index * 290;
        const label = Buffer.from(`<svg width="900" height="26"><rect width="900" height="26" fill="#fff"/><text x="10" y="18" font-family="sans-serif" font-size="14">${item.stem} — ${item.width}px | original left; encoded right</text></svg>`);
        overlays.push({ input: label, left: 0, top });
        for (const [side, bytes] of [item.source, item.encoded].entries()) {
          const tile = await sharp(bytes).resize({ width: 440, height: 250, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
          overlays.push({ input: tile.data, left: side * 450 + Math.round((440 - tile.info.width) / 2), top: top + 30 });
        }
      }
      await sharp({ create: { width: 900, height: page.length * 290, channels: 3, background: '#eee' } }).composite(overlays).png().toFile(path.join(qaDir, `${role}-${Math.floor(start / 4) + 1}.png`));
    }
  }
}
console.log(JSON.stringify({ ok: true, mode: verify ? 'verified byte-identical re-encoding' : 'generated or verified existing identical derivatives', provenance: provenanceFile, source_count: records.length, output_count: provenance.output_count, output_bytes: outputBytes, qa_directory: qaDir }, null, 2));
