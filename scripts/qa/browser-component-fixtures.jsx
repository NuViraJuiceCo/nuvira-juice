import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SubscriptionManagement from '../../src/pages/SubscriptionManagement';
import FreeProductPicker from '../../src/components/FreeProductPicker';
import { birthdayProductEligible } from '../../src/lib/birthdayCheckoutEligibility';
import RewardProductPicker from '../../src/components/RewardProductPicker';
import ProgramJourney from '../../src/pages/ProgramJourney';
import CheckoutExperience, { CheckoutAction } from '../../src/components/checkout/CheckoutExperience';
import QuickReorder from '../../src/components/home/QuickReorder';
import DesktopPrograms from '../../src/components/desktop/DesktopPrograms';
import { deliveryContinuation } from '../../src/lib/deliveryContinuation';
import { Switch } from '../../src/components/ui/switch';
import { Button } from '../../src/components/ui/button';
import { BRAND_IMAGES } from '../../src/lib/brandImages';

const fixtureItem = { product_id: 'fixture-reset', title: 'Reset Program (3-Day)', quantity: 1, price: 144, category: 'bundle' };
const fixtureParams = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', fixtureParams.get('theme') === 'dark');

function CheckoutFixture() {
  const [ready, setReady] = useState(fixtureParams.get('ready') !== '0');
  const [points, setPoints] = useState(false);
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState('');
  const locked = fixtureParams.get('locked') === '1';
  return <CheckoutExperience items={[fixtureItem]} total={points ? 136.99 : 151.99} locked={locked} paymentReady={ready} memberReady contactReady deliveryReady
    contactSummary="Browser QA · browser-qa@example.invalid" deliverySummary="Saturday, October 10" onBack={() => {}}
    onEditBenefits={() => setReady(false)} benefitsLabel="Save up to $15.00 with points · Offers"
    summary={<div><h3 className="text-muted-foreground text-xs mb-3">ORDER SUMMARY</h3><div className="nv-checkout-item"><span>1x Reset Program (3-Day)</span><strong>$144.00</strong></div><div className="flex justify-between text-muted-foreground"><span>Delivery</span><span>$7.99</span></div><div className="flex justify-between"><strong>Total</strong><strong>$151.99</strong></div></div>}
    benefits={<div className="space-y-4"><div className="rounded-xl bg-secondary p-4 flex items-center justify-between gap-4"><label htmlFor="fixture-points"><strong>Use Loyalty Points</strong><p className="text-xs text-muted-foreground">1,543 pts · save $15.00</p></label><Switch id="fixture-points" checked={points} onCheckedChange={setPoints} /></div><div><label htmlFor="fixture-discount" className="text-muted-foreground">Discount Code</label><div className="flex gap-2"><input id="fixture-discount" value={code} onChange={event => setCode(event.target.value)} placeholder="Enter discount code" className="w-full" /><Button disabled={!code.trim()} onClick={() => setApplied(code)}>Apply</Button></div><p role="status">{applied && `Fixture code: ${applied}`}</p></div></div>}
    contact={<p className="text-foreground">Browser QA</p>}
    delivery={<><div className="text-primary mb-4">Your address is in our delivery zone.</div><div className="grid grid-cols-2 gap-3"><button className="bg-secondary p-4 rounded-xl text-left">Saturday<br /><strong>October 10</strong><p className="text-muted-foreground">12 PM - 3 PM</p></button><button className="bg-secondary p-4 rounded-xl text-left">Wednesday<br /><strong>October 14</strong><p className="text-muted-foreground">5 PM - 8 PM</p></button></div></>}
    payment={<div><p className="text-muted-foreground">Secure checkout</p><p className="text-primary mt-4">Confirmed delivery: Saturday, October 10</p><CheckoutAction><Button disabled>Payment Disabled in Fixture</Button></CheckoutAction></div>} />;
}

function MemberFixture() {
  return <div data-desktop-brand="true" className="nv-brand-home"><div className="nv-brand-width" style={{ paddingBlock: 32 }}><img src={BRAND_IMAGES.wordmark} alt="NuVira Juice Company" style={{ width: 120 }} /></div><div className="nv-brand-promise-strip">Cold-pressed in small batches</div><div className="nv-brand-member nv-brand-width"><QuickReorder lastOrder={{ items: [fixtureItem] }} website /></div><div className="nv-brand-section nv-brand-width"><h2>The Signature Collection</h2></div></div>;
}

function DeliveryFlowFixture() {
  const [program, setProgram] = useState(null);
  const continuation = deliveryContinuation({ programSelection: program });
  return <div data-desktop-brand="true"><DesktopPrograms onSelectionChange={setProgram} /><div style={{ padding: 32 }}><p>Successful ZIP result (synthetic)</p><a href={continuation.to}>{continuation.label}</a></div></div>;
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
function Fixtures() {
  const [free, setFree] = useState(false);
  const [reward, setReward] = useState(false);
  const [result, setResult] = useState('');
  const [reject, setReject] = useState(false);
  const freeTriggerRef = useRef(null);
  const rewardTriggerRef = useRef(null);
  const select = async () => { if (reject) throw new Error('Fixture selection rejected. Please try again.'); setResult('Fixture selection complete. No live account changed.'); };
  if (location.pathname === '/checkout') return <CheckoutFixture />;
  if (location.pathname === '/returning-member') return <MemberFixture />;
  if (location.pathname === '/delivery-flow') return <DeliveryFlowFixture />;
  return <div data-desktop-brand="true" data-desktop-storefront="true">
    <header style={{ padding: 20, borderBottom: '1px solid #ccc' }}><h1>Browser Component QA</h1><p>Synthetic data only. No network or provider actions.</p><nav style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}><a href="/subscriptions">Subscriptions</a><a href="/pickers">Reward Pickers</a><a href="/journey?state=in_progress">Active Journey</a><a href="/journey?state=completed&celebration=complete">Completed Journey</a></nav></header>
    {location.pathname === '/subscriptions' ? <SubscriptionManagement /> : location.pathname === '/journey' ? <ProgramJourney previewMode /> : <main style={{ padding: 24 }}>
      <label><input type="checkbox" checked={reject} onChange={event => setReject(event.target.checked)} /> Simulate Selection Failure</label>
      <div style={{ display: 'flex', gap: 24, marginTop: 24 }}><button ref={freeTriggerRef} onClick={() => setFree(true)}>Open Free Product Picker</button><button ref={rewardTriggerRef} onClick={() => setReward(true)}>Open Reward Product Picker</button></div>
      <p role="status">{result}</p><a href="/subscriptions">Background Link</a>
      <FreeProductPicker open={free} onClose={() => setFree(false)} onSelect={select} category="juice" isEligible={birthdayProductEligible} triggerRef={freeTriggerRef} />
      <RewardProductPicker open={reward} onClose={() => setReward(false)} onSelect={async choices => { await select(choices); setReward(false); }} reward={{ id: 'fixture-reward', title: 'Fixture Free Bottle', reward_type: 'free_bottle', points_required: 1000 }} triggerRef={rewardTriggerRef} />
    </main>}
  </div>;
}
createRoot(document.getElementById('root')).render(<HelmetProvider><BrowserRouter><QueryClientProvider client={queryClient}><Fixtures /></QueryClientProvider></BrowserRouter></HelmetProvider>);
