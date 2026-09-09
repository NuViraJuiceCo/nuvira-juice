import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import Checkout from '@/pages/Checkout';
import PaidCheckoutRecovery from '@/components/checkout/PaidCheckoutRecovery';
import '@/index.css';
document.documentElement.classList.toggle('dark', new URLSearchParams(location.search).get('theme') !== 'light');
function RecoveryFixture() {
  const [result, setResult] = React.useState('');
  const guest = new URLSearchParams(location.search).get('mode') === 'guest';
  return <><p className="p-4 text-center text-sm">ISOLATED SIMULATION — no customer or provider connection</p>
    <PaidCheckoutRecovery attempt={{ owner: guest ? 'guest' : 'account:synthetic-user',
      attempt_key: 'synthetic-attempt-key-123456789', order_number: 'NV-AAAAAAAAAAAAAAAAAAAAAAAA',
      guest_order_token: guest ? 'synthetic-guest-token-123456789' : null }}
      onCancelled={() => setResult('Verified cancellation callback')}
      onReceipt={() => setResult('Receipt navigation callback')} />
    <output aria-label="Fixture outcome">{result}</output></>;
}
createRoot(document.getElementById('root')).render(<HelmetProvider><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/checkout']}>
  {new URLSearchParams(location.search).get('view') === 'paid-recovery' ? <RecoveryFixture /> : <Checkout />}
</MemoryRouter></QueryClientProvider></HelmetProvider>);
