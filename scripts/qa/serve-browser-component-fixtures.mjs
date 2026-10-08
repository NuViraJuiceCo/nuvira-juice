#!/usr/bin/env node
// Isolated component QA. Real components, synthetic reads, no provider transport.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';
import { createPreviewHandler, LOCAL_CATALOG, REPO_ROOT, PREVIEW_CSP } from './serve-desktop-preview.mjs';

const port = Number(process.env.PORT || 4205);
const dist = path.join(REPO_ROOT, 'dist');
const user = { id: 'fixture-user', email: 'browser-qa@example.invalid', full_name: 'Browser QA', role: 'user' };
const compiled = await build({
  entryPoints: [path.join(REPO_ROOT, 'scripts/qa/browser-component-fixtures.jsx')],
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', minify: true,
  define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env': '{}', 'import.meta.env.DEV': 'true' },
  loader: { '.css': 'empty' }, logLevel: 'silent',
  plugins: [{ name: 'no-live-transport', setup(builder) {
    builder.onResolve({ filter: /(^|\/)EmbeddedPayment$|(^|\/)RewardEmbeddedCheckout$|(^|\/)SubscriptionEmbeddedCheckout$|(^|\/)SubscriptionPaymentPanel$/ }, () => ({ path: 'payment', namespace: 'blocked-payment' }));
    builder.onLoad({ filter: /.*/, namespace: 'blocked-payment' }, () => ({ contents: 'export default function PaymentDisabled(){return null;}', loader: 'js' }));
    builder.onResolve({ filter: /^@\/lib\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
    builder.onResolve({ filter: /^@\/lib\/cartContext$/ }, () => ({ path: 'cart', namespace: 'fixture' }));
    builder.onResolve({ filter: /^@\/api\/base44Client$/ }, () => ({ path: 'api', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({ loader: 'js', resolveDir: REPO_ROOT, contents: name === 'auth'
      ? `export const useAuth = () => ({user:${JSON.stringify(user)},isLoadingAuth:false});`
      : name === 'cart' ? `import {useState} from 'react';
        const initial=location.pathname==='/checkout-reward-recovery'?[${JSON.stringify({ ...LOCAL_CATALOG.find(p => p.title === 'AURA'), product_id: 'fixture-aura', title: 'AURA', quantity: 3, price: 13, category: 'juice' })}]:[];
        export const useCart=()=>{const [items,setItems]=useState(initial);return{items,subtotal:items.reduce((sum,item)=>sum+item.price*item.quantity,0),clearCart:()=>setItems([]),trackCheckoutStarted:()=>{},clearEarnedRewardItems:()=>setItems(items=>items.filter(item=>!item.isFreeReward&&!item.reward_id))};};`
      : `const products=${JSON.stringify(LOCAL_CATALOG)};
         const dashboard={all_subscriptions:[{id:'fixture-sub',plan_id:'fixture-plan',status:'active',created_date:'2026-09-01',next_delivery_date:'2026-10-10'}]};
         const blocked=async()=>{throw new Error('Fixture: provider actions are disabled');};
         export const invokeCustomerGateway=async(name)=>name==='validateDeliveryEligibility'?{data:{zone_type:'core',checkout_allowed:true,delivery_fee:3.99,customer_message:'Your address is in our delivery zone.'}}:blocked();
         export const base44={functions:{invoke:async(name,input)=>{
           if(name==='calculateNuViraFulfillmentSchedule'&&input.mode==='options')return{data:{ok:true,options:[{option_id:'qa-wednesday',delivery_date:'2026-10-14',delivery_window_label:'Wednesday 5 PM - 8 PM',is_default:true}]}};
           if(name==='createPaymentIntent'&&input.mode==='preview_reward_checkout')throw Object.assign(new Error('Synthetic stale reward'),{response:{data:{error_code:'REWARD_QUANTITY_MISMATCH'}}});
           if(name==='getCustomerAccountDashboardData')return{data:dashboard};if(name==='validateDeliveryEligibility' && input?.zip_only_check)return{data:input.address_postal_code==='00000'?{zone_type:'waitlist_only',checkout_allowed:false,reason_code:'WAITLIST_ONLY'}:{zone_type:'core',checkout_allowed:false,reason_code:'MINIMUM_ORDER_NOT_MET',minimum_order:50}};return blocked();}},entities:new Proxy({}, {get:(_,entity)=>({filter:async(filter={})=>entity==='Product'?products.filter(p=>Object.entries(filter).every(([key,value])=>p[key]===value)):entity==='UserProfile'?[{first_name:'Browser',last_name:'QA',phone:'5550101234',address:'123 Test St, Wentzville, MO, 63385',onboarding_complete:true}]:entity==='UserPoints'?[{total_points:1500,reserved_points:0}]:entity==='SubscriptionPlan'?[{id:'fixture-plan',name:'QA Subscription',bottle_count:12,frequency:'monthly'}]:[],create:blocked,update:blocked,delete:blocked})})};`
    }));
    builder.onResolve({ filter: /^@\// }, async args => {
      const candidate = path.join(REPO_ROOT, 'src', args.path.slice(2));
      for (const file of [candidate, `${candidate}.js`, `${candidate}.jsx`]) {
        try { if ((await fs.stat(file)).isFile()) return { path: file }; } catch {}
      }
      throw new Error(`Missing fixture import: ${args.path}`);
    });
  } }],
});
const javascript = compiled.outputFiles[0].contents;
const index = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
const styles = [...index.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(match => match[0]).join('');
const handler = await createPreviewHandler({ dist, port });
const checkoutCss = await fs.readFile(path.join(REPO_ROOT, 'src/components/checkout/checkout-experience.css'), 'utf8');
const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<link rel="stylesheet" href="/checkout-fixture.css"><title>Browser Component QA</title></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`;
const server = http.createServer((req, res) => {
  if (req.headers.host !== `127.0.0.1:${port}` || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(403); res.end('Read-only loopback fixtures'); return; }
  res.setHeader('Content-Security-Policy', PREVIEW_CSP.replace("connect-src 'self'", "connect-src 'none'"));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.url.startsWith('/api')) { res.writeHead(403); res.end('No network in fixtures'); return; }
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(javascript); return; }
  if (req.url === '/checkout-fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(checkoutCss); return; }
  if (['/', '/subscriptions', '/pickers', '/journey', '/checkout', '/checkout-reward-recovery', '/returning-member', '/delivery-flow', '/delivery-result'].includes(req.url.split('?')[0])) { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  return handler(req, res);
});
server.listen(port, '127.0.0.1', () => console.log(`Isolated browser component QA: http://127.0.0.1:${port}/subscriptions`));
