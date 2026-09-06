import React, { useEffect } from 'react';
const stripe = {
  confirmCardPayment:async()=>{window.__stripeConfirmCount=(window.__stripeConfirmCount||0)+1;return{error:{message:'Synthetic declined card. No payment was attempted.'}};},
};
const elements = {getElement:()=>({}),submit:async()=>({})};
export const loadStripe = async()=>stripe;
export const Elements = ({children})=>children;
export const useStripe = ()=>stripe;
export const useElements = ()=>elements;
export const CardNumberElement = ()=> <input style={{width:'100%'}} aria-label="Synthetic card number" placeholder="Test card field" />;
export const CardExpiryElement = ()=> <input style={{width:'100%'}} aria-label="Synthetic card expiry" placeholder="MM / YY" />;
export const CardCvcElement = ()=> <input style={{width:'100%'}} aria-label="Synthetic card CVC" placeholder="CVC" />;
export function ExpressCheckoutElement({onReady}) {
  useEffect(()=>{onReady?.({availablePaymentMethods:null});},[]);
  return null;
}
