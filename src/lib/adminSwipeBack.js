const EDGE_WIDTH = 28;
const MIN_DISTANCE = 80;
const MAX_VERTICAL_DISTANCE = 48;

export function installAdminSwipeBack(target, { canStart, canNavigate, onBack, onProgress }) {
  let gesture = null;
  const reset = () => {
    gesture = null;
    onProgress(0);
  };
  const start = event => {
    reset();
    if (event.touches.length !== 1 || !canStart(event.target)) return;
    const touch = event.touches[0];
    if (touch.clientX < 0 || touch.clientX > EDGE_WIDTH) return;
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, distance: 0 };
  };
  const move = event => {
    if (!gesture) return;
    if (event.touches.length !== 1 || !canNavigate()) return reset();
    const touch = event.touches[0];
    if (touch.identifier !== gesture.id) return reset();
    const dx = touch.clientX - gesture.x;
    const dy = Math.abs(touch.clientY - gesture.y);
    if (dx < -8 || dy > MAX_VERTICAL_DISTANCE || (dy > 12 && dy > Math.abs(dx))) return reset();
    gesture.distance = Math.max(0, dx);
    if (dx > 12 && dx > dy * 1.5) {
      if (event.cancelable) event.preventDefault();
      onProgress(Math.min(1, dx / MIN_DISTANCE));
    }
  };
  const end = event => {
    const current = gesture;
    const touch = Array.from(event.changedTouches || []).find(item => item.identifier === current?.id);
    const completed = current && touch && event.touches.length === 0
      && current.distance >= MIN_DISTANCE
      && touch.clientX - current.x >= MIN_DISTANCE
      && Math.abs(touch.clientY - current.y) <= MAX_VERTICAL_DISTANCE
      && canNavigate();
    reset();
    if (completed) onBack();
  };

  target.addEventListener('touchstart', start, { passive: true });
  target.addEventListener('touchmove', move, { passive: false });
  target.addEventListener('touchend', end, { passive: true });
  target.addEventListener('touchcancel', reset, { passive: true });
  return () => {
    target.removeEventListener('touchstart', start);
    target.removeEventListener('touchmove', move);
    target.removeEventListener('touchend', end);
    target.removeEventListener('touchcancel', reset);
    reset();
  };
}
