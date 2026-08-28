#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const appSource = read('src/App.jsx');
const landingSource = read('src/pages/LocalSeoLanding.jsx');
const sitemapSource = read('public/sitemap.xml');
const supportSource = read('src/pages/Support.jsx');

const routes = [
  ['cold-pressed-juice-delivery', 'ColdPressedJuiceDelivery'],
  ['fresh-juice-delivery-st-louis', 'FreshJuiceDeliveryStLouis'],
  ['cold-pressed-juice-wentzville', 'ColdPressedJuiceWentzville'],
  ['juice-cleanse-wentzville', 'JuiceCleanseWentzville'],
  ['all-natural-juice-wentzville', 'AllNaturalJuiceWentzville'],
  ['juice-catering-st-louis', 'JuiceCateringStLouis'],
  ['cold-pressed-juice-ofallon-mo', 'ColdPressedJuiceOfallonMo'],
  ['juice-delivery-st-charles-mo', 'JuiceDeliveryStCharlesMo'],
  ['juice-delivery-lake-saint-louis', 'JuiceDeliveryLakeSaintLouis'],
  ['wellness-shots-wentzville', 'WellnessShotsWentzville'],
  ['corporate-juice-catering-st-louis', 'CorporateJuiceCateringStLouis'],
  ['fresh-juice-for-events-st-louis', 'FreshJuiceForEventsStLouis'],
];

const failures = [];
const pass = (name, condition, detail = '') => {
  if (!condition) failures.push({ name, detail });
  return { name, ok: Boolean(condition), detail };
};

const results = [];
const metadata = [];
for (const [slug, component] of routes) {
  const wrapperPath = `src/pages/${component}.jsx`;
  const wrapper = read(wrapperPath);
  results.push(pass(`${slug}: distinct lazy page import`, appSource.includes(`const ${component} = React.lazy(() => import('@/pages/${component}'));`)));
  results.push(pass(`${slug}: route uses distinct page`, appSource.includes(`<Route path="/${slug}" element={<${component} />} />`)));
  results.push(pass(`${slug}: wrapper uses exact contract key`, wrapper.includes(`<LocalSeoLanding pageKey="${slug}" />`)));
  results.push(pass(`${slug}: source metadata exists`, landingSource.includes(`'${slug}': {`) && landingSource.includes(`path: '/${slug}'`)));
  results.push(pass(`${slug}: sitemap entry exists`, sitemapSource.includes(`<loc>https://nuvirajuice.com/${slug}</loc>`)));

  const start = landingSource.indexOf(`  '${slug}': {`);
  const nextSlug = routes[routes.findIndex(([candidate]) => candidate === slug) + 1]?.[0];
  const end = nextSlug
    ? landingSource.indexOf(`  '${nextSlug}': {`, start)
    : landingSource.indexOf('\n};', start);
  const contract = landingSource.slice(start, end);
  const title = contract.match(/\n\s+title:\s*(['"])(.*?)\1,/s)?.[2] || '';
  const description = contract.match(/\n\s+metaDescription:\s*(['"])(.*?)\1,/s)?.[2] || '';
  metadata.push({ slug, title, description });
  results.push(pass(`${slug}: crawler title is usable`, title.length >= 10 && title.length <= 60, `length=${title.length}`));
  results.push(pass(`${slug}: crawler description is usable`, description.length > 0 && description.length <= 160, `length=${description.length}`));
}

results.push(pass('generic LocalSeoLanding route boundary removed', !appSource.includes("const LocalSeoLanding = React.lazy(() => import('@/pages/LocalSeoLanding'));")));
results.push(pass('App routes no longer pass local SEO page keys directly', !appSource.includes('<LocalSeoLanding pageKey=')));
results.push(pass('all route components are unique', new Set(routes.map(([, component]) => component)).size === routes.length));
results.push(pass('all route slugs are unique', new Set(routes.map(([slug]) => slug)).size === routes.length));
results.push(pass('all crawler titles are unique', new Set(metadata.map(({ title }) => title)).size === routes.length));
results.push(pass('all crawler descriptions are unique', new Set(metadata.map(({ description }) => description)).size === routes.length));
results.push(pass('customer-facing subscription FAQ removed', !supportSource.includes('Can I subscribe to receive juices regularly?') && !supportSource.includes('Subscriptions are not available yet.')));
results.push(pass('Support SEO contract remains current', supportSource.includes('delivery, ingredients, programs, and customer support.')));

const output = {
  ok: failures.length === 0,
  suite: 'g148-route-seo-page-boundary',
  route_count: routes.length,
  case_count: results.length,
  writes_performed: false,
  provider_calls_performed: false,
  failures,
};

console.log(JSON.stringify(output, null, 2));
if (failures.length) process.exit(1);
