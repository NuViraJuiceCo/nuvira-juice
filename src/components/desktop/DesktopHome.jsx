import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, MapPin } from 'lucide-react';
import { BRAND_IMAGES, websiteBrandImageProps } from '@/lib/brandImages';
import { approvedProductMedia } from '@/lib/approved-product-media';
import { deliveryLandingProducts } from '@/lib/localDeliveryShopping';
import ProductCard from '@/components/shop/ProductCard';
import QuickReorder from '@/components/home/QuickReorder';
import ActiveProgramJourneyCard from '@/components/program/ActiveProgramJourneyCard';
import DeliveryAvailabilityCard from '@/components/delivery/DeliveryAvailabilityCard';
import DesktopPrograms from '@/components/desktop/DesktopPrograms';
import { desktopHeroStatement } from './desktopHeroCopy';

const FLAVORS = {
  aura: 'Carrot, orange & pineapple',
  oasis: 'Watermelon, pineapple & citrus',
  're-nu': 'Apple, cucumber & greens',
};

export default function DesktopHome({ products, lastOrder, hasMember }) {
  const [deliveryProgram, setDeliveryProgram] = React.useState(null);
  const { hash } = useLocation();
  const headline = desktopHeroStatement();
  React.useEffect(() => {
    if (!['#programs', '#delivery', '#community'].includes(hash)) return undefined;
    const frame = window.requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }));
    return () => window.cancelAnimationFrame(frame);
  }, [hash]);
  const signature = ['aura', 'oasis', 're-nu'].map(key => products.find(product => approvedProductMedia(product)?.key === key)).filter(Boolean);
  const trio = deliveryLandingProducts(products).find(product => product.slug === 'the-nuvira-trio');
  if (trio) signature.push(trio);
  return (
    <div className="nv-brand-home">
      <section className="nv-brand-hero" aria-labelledby="nv-brand-heading">
        <img className="nv-brand-hero-photo" {...websiteBrandImageProps(BRAND_IMAGES.bottlesCoolerWide, { website: true })} alt="Fresh AURA, RE-NU, and OASIS juices chilled together, with their NuVira labels visible" width="1800" height="1200" {...{ fetchpriority: 'high' }} />
        <div className="nv-brand-hero-shade" />
        <div className="nv-brand-hero-content nv-brand-width">
          <p className="nv-brand-eyebrow">NuVira Juice Company</p>
          <h1 id="nv-brand-heading">{headline.map(line => <span key={line}>{line}</span>)}</h1>
          <p className="nv-brand-hero-description">{headline[0] === '100% All-Natural.' ? 'Real. Living. Nutrition.' : '100% All-Natural. Cold-Pressed Juice.'}</p>
          <p className="nv-brand-hero-detail">Real fruits. Real vegetables. Pressed in small batches<br />and delivered fresh from Wentzville.</p>
          <div className="nv-brand-actions">
            <Link className="nv-brand-button nv-brand-button-primary" to="/shop">Shop Juices <ArrowRight size={18} aria-hidden="true" /></Link>
            <Link className="nv-brand-button nv-brand-button-glass" to="/#delivery">Check Delivery <MapPin size={18} aria-hidden="true" /></Link>
          </div>
        </div>
      </section>

      <div className="nv-brand-promise-strip"><span>Cold-pressed in small batches</span><span>Real fruits & vegetables</span><span>Local delivery, thoughtfully planned</span></div>

      {hasMember && <div className="nv-brand-member nv-brand-width" aria-label="Your NuVira orders and program"><QuickReorder lastOrder={lastOrder} website /><ActiveProgramJourneyCard enabled={hasMember} /></div>}

      <section id="signature" className="nv-brand-section nv-brand-width" aria-labelledby="nv-signature-heading">
        <div className="nv-brand-section-heading"><div><p className="nv-brand-eyebrow">The Signature Collection</p><h2 id="nv-signature-heading">A taste for the everyday.</h2><p className="nv-brand-section-description">Sun-bright citrus. Cool watermelon. Crisp, clean greens.</p></div><Link className="nv-brand-text-link" to="/shop">Shop All Juices & Shots <ArrowUpRight size={18} aria-hidden="true" /></Link></div>
        <div className="nv-brand-signature-grid">{signature.map(product => {
          const flavor = product === trio ? 'AURA, OASIS & RE-NU in one bundle' : FLAVORS[approvedProductMedia(product)?.key];
          return <div className="nv-brand-flavor" key={product.id}><ProductCard product={product} /><p className="nv-brand-flavor-note">{flavor}</p></div>;
        })}</div>
        <div className="nv-brand-minimum-note"><p>Minimum 3 juices, 6 shots, or an equivalent mix. Delivery fees and area minimums apply.</p><Link to="/delivery.html">Delivery Details <ArrowRight size={16} aria-hidden="true" /></Link></div>
      </section>

      <DesktopPrograms onSelectionChange={setDeliveryProgram} />

      <section id="delivery" className="nv-brand-section nv-brand-width nv-brand-delivery" aria-labelledby="nv-delivery-heading">
        <div><p className="nv-brand-eyebrow">From Wentzville, With Care</p><h2 id="nv-delivery-heading">Fresh juice.<br />Closer to home.</h2><p className="nv-brand-body">We make your juice in small batches and deliver on planned local routes. Check your area, build your mix, and choose an available delivery date at checkout.</p><Link className="nv-brand-text-link" to="/delivery.html">How Delivery Works <ArrowRight size={17} aria-hidden="true" /></Link></div>
        <div className="nv-brand-delivery-tool"><div className="nv-brand-delivery-location"><MapPin size={20} aria-hidden="true" /><span>Wentzville & Greater St. Louis</span></div><DeliveryAvailabilityCard programSelection={deliveryProgram} /></div>
      </section>

      <section id="community" className="nv-brand-community" aria-labelledby="nv-community-heading">
        <div className="nv-brand-community-heading nv-brand-width">
          <div>
            <p className="nv-brand-eyebrow">Beyond the Bottle</p>
            <h2 id="nv-community-heading">Good company.<br /><span>Great juice.</span></h2>
          </div>
          <div className="nv-brand-community-intro">
            <p className="nv-brand-community-lead">Give your guests something worth gathering around.</p>
            <p>Bring fresh, small-batch NuVira juice to your next team day, studio event, or celebration. Real fruits and vegetables. Bright flavors. A local touch that makes it yours.</p>
          </div>
        </div>
        <figure className="nv-brand-community-scene">
          <img {...websiteBrandImageProps(BRAND_IMAGES.aboutHeroEvent, { website: true })} alt="The NuVira team sharing cold-pressed juice with guests at a local outdoor event" width="1800" height="1271" loading="lazy" />
          <figcaption className="nv-brand-community-caption"><MapPin size={16} aria-hidden="true" />Wentzville roots. St. Louis connections.</figcaption>
        </figure>
        <div className="nv-brand-community-paths nv-brand-width">
          <div className="nv-brand-community-event">
            <div><p className="nv-brand-eyebrow">Events & Catering</p><h3>Your next event, made fresher.</h3></div>
            <Link className="nv-brand-button" to="/book-event">Plan Your Event <ArrowUpRight size={18} aria-hidden="true" /></Link>
          </div>
          <Link className="nv-brand-community-story" to="/about"><span><strong>Meet the people behind the pour.</strong><span>Our Story</span></span><ArrowRight size={22} aria-hidden="true" /></Link>
        </div>
      </section>

      <section className="nv-brand-perks nv-brand-width"><div><p className="nv-brand-eyebrow">Stay Connected</p><h2>More From NuVira</h2></div><Link to="/rewards"><span>Rewards</span><p>Make every order count.</p><ArrowUpRight size={20} aria-hidden="true" /></Link><Link to="/return-reward"><span>Return + Reward</span><p>A fresh reason to return.</p><ArrowUpRight size={20} aria-hidden="true" /></Link><Link to="/merch"><span>NuVira Goods</span><p>Take the good with you.</p><ArrowUpRight size={20} aria-hidden="true" /></Link></section>

    </div>
  );
}
