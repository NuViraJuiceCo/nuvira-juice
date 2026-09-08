import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RewardProductPicker from '@/components/RewardProductPicker';
import { earnedRewardCartItems } from '@/lib/rewardSelection';
import { fixtureState } from './mock-client';
import '@/index.css';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const options = [
  { id: 'vip', title: 'VIP Wellness Box', reward_type: 'vip_box', points_required: 6000 },
  { id: 'upgrade', title: 'Wellness Bundle Upgrade', reward_type: 'bundle_upgrade', points_required: 4000 },
  { id: 'bottle', title: 'Free Add-On Bottle', reward_type: 'free_bottle', points_required: 1000 },
  { id: 'shot', title: 'Free Wellness Shot', reward_type: 'free_shot', points_required: 500 },
];
function App() {
  const [reward, setReward] = useState(null);
  const [saved, setSaved] = useState([]);
  const [failSave, setFailSave] = useState(false);
  return <main style={{ padding: 24 }}>
    <h1>Isolated reward selection test</h1><p>No customer, payment, or provider data is connected.</p>
    <label><input type="checkbox" checked={failSave} onChange={event => setFailSave(event.target.checked)} /> Simulate failed save</label>
    <label><input type="checkbox" onChange={event => { fixtureState.unavailable = event.target.checked; }} /> Make OASIS unavailable</label>
    <label><input type="checkbox" onChange={event => { fixtureState.unavailableOnRefresh = event.target.checked; fixtureState.reads = 0; }} /> Remove OASIS on refresh</label>
    <label><input type="checkbox" onChange={event => { fixtureState.error = event.target.checked; }} /> Simulate catalog outage</label>
    <div>{options.map(option => <button style={{ padding: 16 }} type="button" key={option.id} onClick={() => setReward(option)}>{option.title}</button>)}</div>
    <output aria-label="Saved selection">{JSON.stringify(saved)}</output>
    <RewardProductPicker open={!!reward} reward={reward} onClose={() => setReward(null)} onSelect={async choices => {
      if (failSave) throw new Error('Synthetic save failed. No points used.');
      const lines = earnedRewardCartItems(reward, choices); fixtureState.saves++;
      setSaved(lines); setReward(null);
    }} />
  </main>;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
