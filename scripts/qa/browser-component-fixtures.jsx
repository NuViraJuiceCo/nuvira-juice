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

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
function Fixtures() {
  const [free, setFree] = useState(false);
  const [reward, setReward] = useState(false);
  const [result, setResult] = useState('');
  const [reject, setReject] = useState(false);
  const freeTriggerRef = useRef(null);
  const rewardTriggerRef = useRef(null);
  const select = async () => { if (reject) throw new Error('Fixture selection rejected. Please try again.'); setResult('Fixture selection complete. No live account changed.'); };
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
