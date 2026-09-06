// Local-only synthetic contracts. This module has no network transport.
const scenario = new URLSearchParams(location.search).get('scenario');
window.__checkoutCalls = [];
export const options = [
  { option_id:'synthetic-wed', delivery_date:'2026-09-09', production_date:'2026-09-08', delivery_window_label:'4–7 PM', is_default:true, is_earliest:true },
  { option_id:'synthetic-sat', delivery_date:'2026-09-12', production_date:'2026-09-11', delivery_window_label:'12–3 PM' },
];
const profile = { id:'synthetic-profile', customer_email:'qa@example.invalid', first_name:'Demo', last_name:'Customer', phone:'2025550100', address:'123 Example St, Wentzville, MO, 63385', onboarding_complete:true };
const rows = {
  UserProfile: [profile], NuViraCredit:[{balance:2}], UserPoints:[{total_points:500}],
  Order:[{ id:'synthetic-prior', status:'delivered', payment_status:'paid', payment_captured:true, items:[{quantity:3}] }],
};
export async function invokeCustomerGateway(name, data) {
  window.__checkoutCalls.push({name,data});
  if (name === 'addressSuggest') {
    if (window.__addressLookup) return window.__addressLookup(data);
    return {data:{suggestions:[{street:'123 Example St',city:'Wentzville',state:'MO',zip:'63385',formatted_address:'123 Example St, Wentzville, MO 63385'}]}};
  }
  if (name === 'validateDeliveryEligibility') return {data:{zone_type:scenario==='route'?'route_review':'core', zone_key:'synthetic-core', checkout_allowed:scenario!=='blocked', delivery_fee:5, customer_message:scenario==='blocked'?'Delivery unavailable for this address.':'Local delivery available.'}};
  throw new Error('Unexpected synthetic gateway: '+name);
}
export const base44 = {
  entities: new Proxy({}, {get:(_,name)=>({
    filter:async()=>rows[name] || [], list:async()=>rows[name] || [],
    update:async(id,data)=>{window.__checkoutCalls.push({name:name+'.update',id,data});return{id,...data};},
    create:async(data)=>{window.__checkoutCalls.push({name:name+'.create',data});return{id:'synthetic-record',...data};},
  })}),
  functions:{invoke:async(name,data)=>{
    window.__checkoutCalls.push({name,data});
    if(name==='calculateNuViraFulfillmentSchedule')return {data:{ok:true,options:scenario==='no-dates'?[]:options}};
    if(name==='createPaymentIntent') {
      if(data.mode==='validate_discount_code')return {data:{ok:true,discount:{type:'promotion',code:'LOCALTEST',label:'Test discount',amount:3,eligible_subtotal:data.eligible_subtotal}}};
      if(scenario==='unknown')throw new Error('Synthetic lost response');
      return {data:{clientSecret:'pi_synthetic_secret_local',publishableKey:'pk_test_synthetic',orderNumber:'SYNTHETIC-ONLY',effectiveTotal:41,confirmedDeliverySchedule:data.selected_schedule_option}};
    }
    return {data:{ok:true}};
  }},
  auth:{isAuthenticated:async()=>false,me:async()=>null},
};
