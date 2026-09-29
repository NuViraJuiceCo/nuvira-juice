// Local, provider-free browser regression. Imports the actual candidate hook.
// No payment, backend, storage or analytics transport is imported.
import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useCheckoutReceiptHandoff } from '@/lib/useCheckoutReceiptHandoff';

const Cart = createContext(null);
const cases = [
  { id: 'released-mutation', label: 'Released sequence exposes the race', released: true, clear: true, destination: '/receipt', expected: '/cart', units: 0 },
  ...['paid-guest','paid-member','reward-completion','reward-replay','reward-recovery'].map(id => ({ id, label: id, clear: true, destination: '/receipt', expected: '/receipt', units: 0 })),
  { id: 'route-review', label: 'Authorization route review', clear: true, destination: '/route-review', expected: '/route-review', units: 0, state: { requestNumber: 'synthetic-route', total: 42.99 } },
  ...['paid-recovery-succeeded','paid-recovery-processing','stripe-return','pwa-return'].map(id => ({ id, label: id, clear: false, destination: '/receipt', expected: '/receipt', units: 3 })),
  { id: 'ordinary-empty', label: 'Ordinary cart clear remains guarded', ordinary: true, expected: '/cart', units: 0 },
];
const log = [];
function CartProvider({ children }) {
  const [items, setItems] = useState([{ quantity: 3 }]);
  // Same state-changing operation as the real CartProvider.
  const clearCart = () => setItems([]);
  return <Cart.Provider value={{ items, setItems, clearCart }}>{children}</Cart.Provider>;
}
function CheckoutCase({ scenario }) {
  const { items, clearCart } = useContext(Cart);
  const navigate = useNavigate();
  const { receiptHandoff, handoffToReceipt } = useCheckoutReceiptHandoff({ clearCart, navigate });
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    // Models the asynchronous resolution of a callback, not a fake payment.
    Promise.resolve().then(() => {
      log.push(`${scenario.id}: callback`);
      if (scenario.ordinary) { clearCart(); return; }
      if (scenario.released) { clearCart(); navigate(scenario.destination); return; }
      handoffToReceipt(scenario.destination, { clearPurchasedCart: scenario.clear, state: scenario.state });
    });
  }, []);
  if (receiptHandoff) return <p role="status">Opening your order…</p>;
  const checkoutStartLocked = false;
  if (items.length === 0 && !checkoutStartLocked) return <Navigate to="/cart" replace />;
  return <p>Stateful checkout case running: {scenario.label}</p>;
}
function Outcome({ finish }) {
  const location = useLocation(); const { items } = useContext(Cart);
  useEffect(() => {
    // Allow the lower-priority receipt transition and any competing Navigate
    // effect to settle before measuring the final committed route.
    const timer = setTimeout(() => finish(location, items.reduce((sum, item) => sum + item.quantity, 0)), 150);
    return () => clearTimeout(timer);
  }, [location, items, finish]);
  return <p>Committed route: {location.pathname}</p>;
}
function Suite() {
  const navigate = useNavigate(); const location = useLocation(); const { setItems } = useContext(Cart);
  const [index, setIndex] = useState(-1); const [phase, setPhase] = useState('idle'); const [results, setResults] = useState([]);
  const finished = useRef(new Set()); const scenario = cases[index];
  const prepare = next => {
    setPhase('preparing'); setItems([{ quantity: 3 }]); setIndex(next); navigate('/checkout');
  };
  useEffect(() => { if (phase === 'preparing' && location.pathname === '/checkout') setPhase('running'); }, [phase, location.pathname]);
  const finish = (end, units) => {
    if (phase !== 'running' || !scenario || finished.current.has(scenario.id)) return;
    finished.current.add(scenario.id);
    const passed = end.pathname === scenario.expected && units === scenario.units
      && (!scenario.state || JSON.stringify(end.state) === JSON.stringify(scenario.state));
    log.push(`${scenario.id}: ${end.pathname}, cart units ${units}, ${passed ? 'PASS' : 'FAIL'}`);
    setResults(previous => [...previous, { id: scenario.id, route: end.pathname, units, passed }]);
    setPhase('settled');
  };
  useEffect(() => {
    if (phase !== 'settled') return;
    if (index + 1 === cases.length) { setPhase('done'); return; }
    const timer = setTimeout(() => prepare(index + 1), 30); return () => clearTimeout(timer);
  }, [phase]);
  return <main style={{ fontFamily: 'system-ui', maxWidth: 860, margin: '2rem auto', padding: 20 }}>
    <h1>Checkout receipt handoff regression</h1>
    <p>Local-only: actual candidate hook, React stateful cart, default BrowserRouter transitions. No provider/backend calls. Original sequence is a deliberate failing-behavior control, not a shipped option.</p>
    <button disabled={!['idle','done'].includes(phase)} onClick={() => { finished.current.clear(); log.length = 0; setResults([]); prepare(0); }}>Run all 12 local regression cases</button>
    <p role="status">{phase === 'done' ? `${results.filter(result => result.passed).length}/${cases.length} cases passed` : `Suite: ${phase}`}</p>
    {phase === 'running' && <Routes>
      <Route path="/checkout" element={<CheckoutCase key={scenario.id} scenario={scenario}/>} />
      {['/receipt','/route-review','/cart'].map(route => <Route key={route} path={route} element={<Outcome finish={finish}/>} />)}
    </Routes>}
    <ol>{results.map(result => <li key={result.id}>{result.passed ? 'PASS' : 'FAIL'} — {result.id}: {result.route}; cart units {result.units}</li>)}</ol>
    <pre style={{ whiteSpace: 'pre-wrap' }}>{log.join('\n')}</pre>
    <p>These are navigation/scheduling regressions, not provider or fulfillment tests.</p>
  </main>;
}
const fixtureBase = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
createRoot(document.getElementById('root')).render(<BrowserRouter basename={fixtureBase}><CartProvider><Suite/></CartProvider></BrowserRouter>);
