import React from 'react';
import { Link } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, Check, Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { useCart } from '@/lib/cartContext';
import { orderMinimumGuidance } from '@/lib/orderMinimumGuidance';
import { isEarnedRewardItem } from '@/lib/rewardSelection';
import ProductPhoto from '@/components/shop/ProductPhoto';
import '@/styles/cart-preview.css';

const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

export default function CartPreview() {
  const { items, subtotal, itemCount, cartPreview, closeCartPreview, restoreCartPreviewFocus, updateQuantity, removeItem } = useCart();
  const guidance = orderMinimumGuidance(items);
  const addedItemPresent = cartPreview?.addedTitle && items.some(item => item.title === cartPreview.addedTitle);
  return (
    <Dialog.Root open={Boolean(cartPreview?.open)} onOpenChange={open => { if (!open) closeCartPreview(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="nv-cart-preview-overlay" />
        <Dialog.Content className="nv-cart-preview" onCloseAutoFocus={event => { event.preventDefault(); restoreCartPreviewFocus(); }}>
          <header className="nv-cart-preview-header">
            <p className="nv-cart-preview-eyebrow">Fresh From NuVira</p>
            <div className="nv-cart-preview-title"><Dialog.Title>Your Bag</Dialog.Title><span>{itemCount} {itemCount === 1 ? 'item' : 'items'}</span></div>
            <Dialog.Description className="nv-cart-preview-confirmation">
              {addedItemPresent ? <><Check size={16} aria-hidden="true" /><span>{cartPreview.addedTitle} added to your bag</span></> : 'Your fresh picks, all in one place.'}
            </Dialog.Description>
            <Dialog.Close className="nv-cart-preview-close" aria-label="Close bag" title="Close bag"><X size={20} aria-hidden="true" /></Dialog.Close>
          </header>

          <div className="nv-cart-preview-body">
            {items.length ? <>
              {guidance.visible && <section className="nv-cart-preview-minimum" aria-label="Order minimum">
                <div role="status" aria-live="polite" aria-atomic="true">
                  <p className="nv-cart-preview-minimum-title">{guidance.meetsMinimum && <Check size={16} aria-hidden="true" />}{guidance.title}</p>
                  {guidance.alternative && <p>{guidance.alternative}</p>}
                </div>
                <div className="nv-cart-preview-progress" role="progressbar" aria-label="Order count minimum" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(guidance.progress)} aria-valuetext={guidance.title}>
                  <span style={{ width: `${guidance.progress}%` }} />
                </div>
                <p>{guidance.meetsMinimum ? 'Delivery-area dollar minimums still apply.' : 'Minimum: 3 juices, 6 shots, or an equivalent mix.'}</p>
              </section>}
              <ul className="nv-cart-preview-items">
                {items.map(item => {
                  const key = item.cart_line_key || item.product_id;
                  const fixedQuantity = isEarnedRewardItem(item) || item.isBirthdayReward;
                  return <li key={key} className="nv-cart-preview-item">
                    <div className="nv-cart-preview-photo"><ProductPhoto product={item} thumbnail alt="" width="80" height="96" loading="lazy" fallback={<ShoppingBag size={28} aria-hidden="true" />} /></div>
                    <div className="nv-cart-preview-item-info">
                      <h3>{item.title}</h3>
                      {item.size && <p className="nv-cart-preview-item-size">{item.size}</p>}
                      <strong>{money(item.price * item.quantity)}</strong>
                      <div className="nv-cart-preview-item-controls">
                        {fixedQuantity ? <span className="nv-cart-preview-fixed">Qty {item.quantity} · Reward</span> : <div className="nv-cart-preview-stepper" role="group" aria-label={`${item.title} quantity`}>
                          <button type="button" onClick={() => updateQuantity(key, item.quantity - 1)} aria-label={`Decrease ${item.title} quantity`} title="Decrease quantity"><Minus size={15} aria-hidden="true" /></button>
                          <output aria-label={`${item.title} quantity`}>{item.quantity}</output>
                          <button type="button" disabled={item.quantity >= 100} onClick={() => updateQuantity(key, item.quantity + 1)} aria-label={`Increase ${item.title} quantity`} title="Increase quantity"><Plus size={15} aria-hidden="true" /></button>
                        </div>}
                        <button type="button" className="nv-cart-preview-remove" onClick={() => removeItem(key)} aria-label={`Remove ${item.title}`} title={`Remove ${item.title}`}><Trash2 size={17} aria-hidden="true" /></button>
                      </div>
                    </div>
                  </li>;
                })}
              </ul>
            </> : <div className="nv-cart-preview-empty">
              <ShoppingBag size={38} strokeWidth={1.25} aria-hidden="true" />
              <h3>A fresh start.</h3>
              <p>Your bag is empty. Find your favorite blends and build your mix.</p>
            </div>}
          </div>

          <footer className="nv-cart-preview-footer">
            {items.length > 0 && <>
              <div className="nv-cart-preview-subtotal" aria-live="polite" aria-atomic="true"><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
              <p>Delivery, taxes, and any discounts are confirmed at checkout.</p>
            </>}
            <Link to={items.length ? '/cart' : '/shop'} onClick={closeCartPreview} className="nv-cart-preview-primary">{items.length ? 'View Cart' : 'Shop Juices'}<ArrowRight size={19} aria-hidden="true" /></Link>
            <Dialog.Close className="nv-cart-preview-continue">Continue Shopping</Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
