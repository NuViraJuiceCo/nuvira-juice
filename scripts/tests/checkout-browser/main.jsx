import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import Checkout from '@/pages/Checkout';
import '@/index.css';
document.documentElement.classList.toggle('dark', new URLSearchParams(location.search).get('theme') !== 'light');
createRoot(document.getElementById('root')).render(<HelmetProvider><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/checkout']}><Checkout /></MemoryRouter></QueryClientProvider></HelmetProvider>);
