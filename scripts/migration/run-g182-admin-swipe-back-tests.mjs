#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installAdminSwipeBack } from '../../src/lib/adminSwipeBack.js';

const checks = [];
function fixture() {
  const handlers = new Map();
  let allowed = true;
  let backCount = 0;
  let progress = 0;
  let prevented = 0;
  const target = {
    addEventListener: (type, handler) => handlers.set(type, handler),
    removeEventListener: type => handlers.delete(type),
  };
  const dispose = installAdminSwipeBack(target, {
    canStart: source => allowed && source !== 'editing',
    canNavigate: () => allowed,
    onBack: () => backCount++,
    onProgress: value => { progress = value; },
  });
  const send = (type, x, y = 700, options = {}) => {
    const touch = { identifier: 1, clientX: x, clientY: y };
    handlers.get(type)?.({
      target: options.target,
      touches: type === 'touchend' ? [] : [touch],
      changedTouches: [touch],
      cancelable: true,
      preventDefault: () => prevented++,
      ...options,
    });
  };
  return { send, dispose, handlers, block: () => { allowed = false; }, state: () => ({ backCount, progress, prevented }) };
}
function check(name, run) { run(); checks.push(name); }

check('left-edge full swipe goes back exactly once while scrolled below the header', () => {
  const f = fixture();
  f.send('touchstart', 12);
  f.send('touchmove', 110);
  assert.equal(f.state().progress, 1);
  f.send('touchend', 110);
  f.send('touchend', 110);
  assert.deepEqual(f.state(), { backCount: 1, progress: 0, prevented: 1 });
});
check('non-edge horizontal content swipes do not navigate', () => {
  const f = fixture();
  f.send('touchstart', 90); f.send('touchmove', 200); f.send('touchend', 200);
  assert.equal(f.state().backCount, 0);
  assert.equal(f.state().prevented, 0);
});
check('vertical scrolling stays available', () => {
  const f = fixture();
  f.send('touchstart', 12); f.send('touchmove', 16, 790); f.send('touchend', 110, 790);
  assert.equal(f.state().backCount, 0);
  assert.equal(f.state().prevented, 0);
});
check('short or reversed gestures cancel', () => {
  for (const endX of [50, 10]) {
    const f = fixture();
    f.send('touchstart', 12); f.send('touchmove', 110); f.send('touchmove', endX); f.send('touchend', endX);
    assert.equal(f.state().backCount, 0);
    assert.equal(f.state().progress, 0);
  }
});
check('touch cancellation and multitouch do not navigate', () => {
  for (const cancel of ['touchcancel', 'multitouch']) {
    const f = fixture();
    f.send('touchstart', 12); f.send('touchmove', 110);
    if (cancel === 'touchcancel') f.send('touchcancel', 110);
    else f.send('touchmove', 110, 700, { touches: [{ identifier: 1 }, { identifier: 2 }] });
    f.send('touchend', 110);
    assert.equal(f.state().backCount, 0);
  }
});
check('editing controls and open overlays block the gesture', () => {
  const editing = fixture();
  editing.send('touchstart', 12, 700, { target: 'editing' });
  editing.send('touchmove', 110); editing.send('touchend', 110);
  assert.equal(editing.state().backCount, 0);
  const dialog = fixture();
  dialog.send('touchstart', 12); dialog.send('touchmove', 110); dialog.block(); dialog.send('touchend', 110);
  assert.equal(dialog.state().backCount, 0);
});
check('route unmount removes every listener', () => {
  const f = fixture();
  f.send('touchstart', 12); f.send('touchmove', 110); f.dispose();
  assert.equal(f.handlers.size, 0);
  assert.equal(f.state().progress, 0);
});
check('shared operations header installs a page-wide gesture with existing back semantics', () => {
  const header = fs.readFileSync('src/components/admin/AdminOpsHeader.jsx', 'utf8');
  assert.match(header, /installAdminSwipeBack\(document,/);
  assert.match(header, /onBack: \(\) => onBack \? onBack\(\) : navigate\(backTo\)/);
  assert.match(header, /pointer: coarse/);
  assert.match(header, /location\.pathname\.startsWith\('\/admin'\)/);
  assert.match(header, /data-state="open"/);
  assert.match(header, /document\.activeElement\?\.matches/);
  assert.match(header, /createPortal\([\s\S]*document\.body/);
  assert.match(header, /aria-label="Back to admin operations"/);
});
console.log(JSON.stringify({ ok: true, suite: 'g182-admin-swipe-back', checks, provider_calls: false, writes_performed: false }, null, 2));
