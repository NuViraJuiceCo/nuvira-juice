import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function DesktopMerch({ items, loadingItems, onAdd, email, onEmail, submitted, submitting, onNotify }) {
  return (
    <div className="nv-information-page nv-goods-page">
      <header className="nv-information-intro nv-brand-width"><div><p className="nv-brand-eyebrow">Beyond the Bottle</p><h1>NuVira Goods</h1><p>A little NuVira, wherever the day takes you.</p></div><Link className="nv-brand-text-link" to="/shop">Shop Juices & Shots <ArrowRight size={18} /></Link></header>
      <section className="nv-goods-collection" aria-label="NuVira goods">
        <div className="nv-brand-width">
          {loadingItems ? <div className="nv-goods-loading" role="status">Loading NuVira goods...</div> : items.map(item => <article className="nv-goods-product" key={item.id}>
            <Link className="nv-goods-photo" to={item.path || '/shop?filter=merch'}><img src={item.image_url} alt={item.name} width="640" height="960" /></Link>
            <div className="nv-goods-copy"><p className="nv-brand-eyebrow">The NuVira Collection</p><h2><Link to={item.path || '/shop?filter=merch'}>{item.name}</Link></h2>
              {item.description && <p className="nv-goods-description">{item.description}</p>}
              {item.sizes?.length > 0 && <p className="nv-goods-size">Size: {item.sizes.join(', ')}</p>}
              <div className="nv-goods-price"><strong>${item.price.toFixed(2)}</strong><span>{item.is_available ? 'Available Now' : 'Coming Soon'}</span></div>
              <Button className="nv-brand-button" onClick={event => onAdd(item, event.currentTarget)} disabled={!item.is_available}><ShoppingBag size={18} />Add to Bag</Button>
              <Link className="nv-brand-text-link" to={item.path || '/shop?filter=merch'}>View Product Details <ArrowRight size={17} /></Link>
            </div>
          </article>)}
          {!loadingItems && items.length === 0 && <div className="nv-goods-waitlist"><h2>Good things are on the way.</h2><p>Be the first to hear about the next NuVira goods release.</p>{submitted ? <p role="status">You are on the list.</p> : <form onSubmit={event => { event.preventDefault(); onNotify(); }}><label htmlFor="goods-email">Email Address</label><div><Input id="goods-email" type="email" value={email} onChange={event => onEmail(event.target.value)} required /><Button className="nv-brand-button" type="submit" disabled={submitting || !email}>{submitting ? 'Submitting...' : 'Notify Me'}</Button></div></form>}</div>}
        </div>
      </section>
      <div className="nv-goods-outro nv-brand-width"><ShoppingBag size={25} aria-hidden="true" /><p>Rooted in Wentzville. Part of your everyday.</p><Link className="nv-brand-text-link" to="/about">Our Story <ArrowRight size={18} /></Link></div>
    </div>
  );
}
