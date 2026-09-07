#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installAdminSwipeBack } from '../../src/lib/adminSwipeBack.js';

const checks = [];
function fixture() {
  const handlers = new Map();
  const frames = new Map();
  let frameId = 0;
  let allowed = true;
  let backCount = 0;
  let prevented = 0;
  const target = {
    defaultView: {
      requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
      cancelAnimationFrame: id => frames.delete(id),
    },
    addEventListener: (type, handler) => handlers.set(type, handler),
    removeEventListener: type => handlers.delete(type),
  };
  const dispose = installAdminSwipeBack(target, {
    canStart: source => allowed && source !== 'editing',
    canNavigate: () => allowed,
    onBack: () => backCount++,
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
  const paint = () => {
    const ready = Array.from(frames.values());
    frames.clear();
    ready.forEach(callback => callback());
  };
  return { send, dispose, handlers, frames, paint, block: () => { allowed = false; }, state: () => ({ backCount, prevented }) };
}
function check(name, run) { run(); checks.push(name); }

check('left-edge full swipe goes back exactly once while scrolled below the header', () => {
  const f = fixture();
  f.send('touchstart', 12);
  f.send('touchmove', 110);
  f.send('touchend', 110);
  f.send('touchend', 110);
  assert.equal(f.state().backCount, 0, 'route stays mounted during touchend');
  f.paint();
  assert.equal(f.state().backCount, 0, 'the touch origin survives the first paint');
  f.paint();
  f.paint();
  assert.deepEqual(f.state(), { backCount: 1, prevented: 1 });
});
check('queued navigation is canceled by unmount, touchcancel, or a new gesture at either frame', () => {
  for (const cancel of ['unmount', 'touchcancel', 'new gesture']) {
    for (const afterPaint of [false, true]) {
      const f = fixture();
      f.send('touchstart', 12); f.send('touchmove', 110); f.send('touchend', 110);
      if (afterPaint) f.paint();
      const staleCallback = Array.from(f.frames.values())[0];
      if (cancel === 'unmount') f.dispose();
      else if (cancel === 'touchcancel') f.send('touchcancel', 110);
      else f.send('touchstart', 205);
      assert.equal(f.frames.size, 0);
      staleCallback();
      f.paint(); f.paint();
      assert.equal(f.state().backCount, 0, `${cancel} must retire pending navigation`);
    }
  }
});
check('navigation guards are checked again after the gesture settles', () => {
  const f = fixture();
  f.send('touchstart', 12); f.send('touchmove', 110); f.send('touchend', 110);
  f.paint(); f.block(); f.paint();
  assert.equal(f.state().backCount, 0);
  assert.equal(f.frames.size, 0);
});
check('a replacement valid swipe navigates only once', () => {
  const f = fixture();
  f.send('touchstart', 12); f.send('touchmove', 110); f.send('touchend', 110);
  f.paint();
  f.send('touchstart', 14); f.send('touchmove', 120); f.send('touchend', 120);
  f.paint(); f.paint(); f.paint();
  assert.equal(f.state().backCount, 1);
});
check('non-edge horizontal content swipes do not navigate', () => {
  const f = fixture();
  f.send('touchstart', 90); f.send('touchmove', 200); f.send('touchend', 200);
  f.paint(); f.paint();
  assert.equal(f.state().backCount, 0);
  assert.equal(f.state().prevented, 0);
});
check('vertical scrolling stays available', () => {
  const f = fixture();
  f.send('touchstart', 12); f.send('touchmove', 16, 790); f.send('touchend', 110, 790);
  f.paint(); f.paint();
  assert.equal(f.state().backCount, 0);
  assert.equal(f.state().prevented, 0);
});
check('short or reversed gestures cancel', () => {
  for (const endX of [50, 10]) {
    const f = fixture();
    f.send('touchstart', 12); f.send('touchmove', 110); f.send('touchmove', endX); f.send('touchend', endX);
    f.paint(); f.paint();
    assert.equal(f.state().backCount, 0);
  }
});
check('touch cancellation and multitouch do not navigate', () => {
  for (const cancel of ['touchcancel', 'multitouch']) {
    const f = fixture();
    f.send('touchstart', 12); f.send('touchmove', 110);
    if (cancel === 'touchcancel') f.send('touchcancel', 110);
    else f.send('touchmove', 110, 700, { touches: [{ identifier: 1 }, { identifier: 2 }] });
    f.send('touchend', 110);
    f.paint(); f.paint();
    assert.equal(f.state().backCount, 0);
  }
});
check('editing controls and open overlays block the gesture', () => {
  const editing = fixture();
  editing.send('touchstart', 12, 700, { target: 'editing' });
  editing.send('touchmove', 110); editing.send('touchend', 110);
  editing.paint(); editing.paint();
  assert.equal(editing.state().backCount, 0);
  const dialog = fixture();
  dialog.send('touchstart', 12); dialog.send('touchmove', 110); dialog.block(); dialog.send('touchend', 110);
  dialog.paint(); dialog.paint();
  assert.equal(dialog.state().backCount, 0);
});
check('route unmount removes every listener', () => {
  const f = fixture();
  f.send('touchstart', 12); f.send('touchmove', 110); f.dispose();
  assert.equal(f.handlers.size, 0);
});
check('shared operations header installs a page-wide gesture with existing back semantics', () => {
  const header = fs.readFileSync('src/components/admin/AdminOpsHeader.jsx', 'utf8');
  assert.match(header, /installAdminSwipeBack\(document,/);
  assert.match(header, /onBack: \(\) => onBack \? onBack\(\) : navigate\(backTo\)/);
  assert.match(header, /pointer: coarse/);
  assert.match(header, /location\.pathname\.startsWith\('\/admin'\)/);
  assert.match(header, /data-state="open"/);
  assert.match(header, /document\.activeElement\?\.matches/);
  assert.doesNotMatch(header, /createPortal|swipeProgress|onProgress|data-admin-swipe-back/);
  assert.match(header, /aria-label="Back to admin operations"/);
});
check('gesture movement does not render an overlay or replace the existing page transition', () => {
  const gesture = fs.readFileSync('src/lib/adminSwipeBack.js', 'utf8');
  const layout = fs.readFileSync('src/components/layout/AppLayout.jsx', 'utf8');
  assert.doesNotMatch(gesture, /onProgress|createPortal|setState/);
  assert.match(layout, /data-page-transition="true"/);
});
console.log(JSON.stringify({ ok: true, suite: 'g182-admin-swipe-back', checks, provider_calls: false, writes_performed: false }, null, 2));
