import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexHtml = fs.readFileSync('index.html', 'utf8');
const seoSource = fs.readFileSync('src/components/SEO.jsx', 'utf8');
const approvedPhone = '+1-636-697-6028';
const retiredPhone = '+1-559-826-2823';

assert.ok(indexHtml.includes(`"telephone": "${approvedPhone}"`));
assert.ok(seoSource.includes(`"telephone": "${approvedPhone}"`));
assert.ok(!indexHtml.includes(retiredPhone));
assert.ok(!seoSource.includes(retiredPhone));
assert.match(indexHtml, /"@type"\s*:\s*"LocalBusiness"/);
assert.match(seoSource, /"@type": \["LocalBusiness", "FoodEstablishment"\]/);

console.log('G139 local-business identity tests passed (6/6).');
