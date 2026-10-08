#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
import { PROGRAMS, DAILY_PROGRAM_SCHEDULES } from '../../src/lib/program-catalog.js';
import { approvedProductMedia } from '../../src/lib/approved-product-media.js';

const result = await build({
  entryPoints: ['src/components/program/BrowserConsumptionGuide.jsx'], bundle: true,
  write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom'], mainFields: ['module', 'main'],
  alias: { '@': `${process.cwd()}/src` }, loader: { '.css': 'empty' },
});
const module = { exports: {} };
vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url), console, window: { self: null, top: null } });
const { default: Guide, ProgramGuideDay } = module.exports;
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const checks = [];

for (const program of PROGRAMS) for (const option of program.durationOptions) {
  const html = render(Guide, { programKey: program.key, days: option.days });
  assert.equal((html.match(/role="tab"/g) || []).length, option.days);
  assert.equal((html.match(/class="nv-guide-stop"/g) || []).length, 4);
  assert.ok(html.includes(`${option.bottles} total`));
  assert.ok(html.includes('No optional shot selected for this day.'));
  const schedule = DAILY_PROGRAM_SCHEDULES[program.key];
  for (const item of schedule) {
    const media = approvedProductMedia({ title: item.product });
    assert.ok(html.includes(media.card));
    assert.ok(fs.existsSync(`public${media.card}`));
    assert.ok(html.includes(item.suggestedTime));
  }
  const totals = {};
  for (const item of schedule) totals[item.product] = (totals[item.product] || 0) + option.days;
  for (const component of option.bundleComposition) assert.equal(totals[component.product_name], component.quantity);
}
checks.push('All five duration options render four daily bottles matching the purchased formula, with existing product photos');

for (const shotNames of [[], ['Reset Shot'], ['Reset Shot', 'Hydration Shot'], ['Reset Shot', 'Reset Shot', 'Reset Shot']]) {
  for (let day = 1; day <= 3; day++) {
    const html = render(ProgramGuideDay, { schedule: DAILY_PROGRAM_SCHEDULES.reset, day, shotName: shotNames[day - 1] });
    assert.equal(html.includes('before your morning RE-NU'), Boolean(shotNames[day - 1]));
    assert.equal(html.includes('Just your juices today'), !shotNames[day - 1]);
    if (shotNames[day - 1]) assert.ok(html.includes(`${shotNames[day - 1]} before`));
    assert.equal((html.match(/class="nv-guide-stop"/g) || []).length, 4);
  }
}
checks.push('Zero, partial, mixed and full optional shot plans only show the assigned shot on its day');

const html = render(Guide, { programKey: 'radiance', days: 2, shotNames: null });
assert.ok(html.includes('40°F or below'));
assert.ok(html.includes('printed date'));
assert.ok(html.includes('Suggested times are flexible'));
assert.equal(render(Guide, { programKey: 'unknown' }), '');
const page = fs.readFileSync('src/pages/ProgramDetail.jsx', 'utf8');
assert.match(page, /desktop \? <BrowserConsumptionGuide[\s\S]*?: <ConsumptionSchedule/);
assert.match(page, /<BrowserConsumptionGuide[\s\S]*?shotNames=\{selectedShotNames\}/);
assert.ok(fs.readFileSync('src/components/program/BrowserConsumptionGuide.jsx', 'utf8').includes('key={`${programKey}-${option.days}`}'));
checks.push('Flexible timing and storage guidance remain; day selection resets for duration changes; native layout stays separate');

const guideStyles = postcss.parse(fs.readFileSync('src/components/program/BrowserConsumptionGuide.css', 'utf8'));
const controlSelector = '[data-desktop-brand="true"] .nv-consumption-guide .nv-guide-day-tabs';
function declarations(selector) {
  const values = {};
  guideStyles.walkRules(selector, rule => rule.walkDecls(decl => { values[decl.prop] = decl.value; }));
  return values;
}
// The component scope outranks the shared main[data-storefront-page] pill rule.
const track = declarations(controlSelector);
const segment = declarations(`${controlSelector} [role="tab"]`);
assert.equal(track.display, 'grid');
assert.equal(track['grid-auto-columns'], 'minmax(76px,1fr)');
assert.equal(track['max-width'], '100%');
assert.equal(track['border-radius'], '8px');
assert.equal(segment['border-radius'], '4px');
assert.equal(parseInt(track['border-radius']), parseInt(segment['border-radius']) + parseInt(track.padding));
assert.equal(parseInt(track.height), parseInt(segment.height) + 2 * parseInt(track.padding));
assert.ok(parseInt(segment['min-height']) >= 44);
assert.equal(declarations(`${controlSelector} [role="tab"][data-state="active"]`).background, 'var(--nv-program-accent)');
assert.ok(declarations(`${controlSelector} [role="tab"]:focus-visible`).outline);
checks.push('Equal-width day segments keep matching inset corners, 44px targets, program accents and visible keyboard focus');

const discoveryResult = await build({
  entryPoints: ['src/components/program/BrowserProgramDiscovery.jsx'], bundle: true,
  write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom', 'react-router-dom'],
  alias: { '@': `${process.cwd()}/src` }, loader: { '.css': 'empty' },
});
const discoveryModule = { exports: {} };
const require = createRequire(import.meta.url);
vm.runInNewContext(discoveryResult.outputFiles[0].text, {
  module: discoveryModule, exports: discoveryModule.exports,
  require: name => name === 'react-router-dom'
    ? { Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children) }
    : require(name),
});
for (const current of PROGRAMS) for (const option of current.durationOptions) {
  const markup = render(discoveryModule.exports.default, { programKey: current.key, days: option.days });
  assert.ok(!markup.includes(`href="/program/${current.key}`));
  assert.equal((markup.match(/class="nv-program-discovery-link"/g) || []).length, PROGRAMS.length - 1);
  for (const other of PROGRAMS.filter(program => program.key !== current.key)) {
    const matchingOption = other.durationOptions.find(candidate => candidate.days === option.days) || other.durationOptions[0];
    assert.ok(markup.includes(`href="/program/${other.key}?days=${matchingOption.days}"`));
    assert.ok(markup.includes(`aria-label="Explore ${other.name}"`));
    assert.ok(markup.includes(matchingOption.composition));
    assert.ok(markup.includes(`$${matchingOption.price}`));
    const media = approvedProductMedia({ title: matchingOption.bundleComposition[0].product_name });
    assert.ok(markup.includes(media.primary));
    assert.ok(fs.existsSync(`public${media.primary}`));
  }
}
assert.match(page, /desktop && <BrowserProgramDiscovery programKey=\{program.key\} days=\{selectedOption.days\}/);
assert.ok(page.indexOf('<BrowserProgramDiscovery') > page.indexOf('</main>'));
checks.push('Bottom-of-page discovery excludes the current program, preserves supported durations and uses real catalog prices, quantities and approved product imagery without native changes');

console.log(JSON.stringify({ ok: true, suite: 'browser-consumption-guide', checks, productionWrites: false, providerCalls: false }, null, 2));
