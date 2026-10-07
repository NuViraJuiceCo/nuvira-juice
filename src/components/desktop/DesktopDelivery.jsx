import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, MapPin, Route, Truck } from 'lucide-react';
import { BRAND_IMAGES, websiteBrandImageProps } from '@/lib/brandImages';
import { DELIVERY_POLICY_CONTENT, DELIVERY_WINDOWS, DELIVERY_ZONE_SUMMARY } from '@/lib/delivery-policy';

export default function DesktopDelivery() {
  return (
    <div className="nv-information-page nv-delivery-page">
      <section className="nv-information-intro nv-brand-width">
        <div><p className="nv-brand-eyebrow">Fresh From Wentzville</p><h1>Local Juice Delivery</h1><p>Freshly pressed. Delivered on a schedule you can plan around.</p></div>
        <Link className="nv-brand-button" to="/#delivery">Check Your Area <MapPin size={18} /></Link>
      </section>
      <section className="nv-delivery-schedule" aria-labelledby="delivery-windows-heading">
        <div className="nv-brand-width">
          <div className="nv-information-heading"><div><p className="nv-brand-eyebrow">Two Weekly Delivery Windows</p><h2 id="delivery-windows-heading">A fresh week starts here.</h2></div><p>{DELIVERY_POLICY_CONTENT.schedule}</p></div>
          <div className="nv-delivery-window-grid">
            {DELIVERY_WINDOWS.map(window => <article className="nv-delivery-window" key={window.deliveryDay}>
              <CalendarDays size={23} aria-hidden="true" />
              <p className="nv-brand-eyebrow">{window.productionDay} Production</p>
              <h3>{window.deliveryDay}</h3><p className="nv-delivery-time">{window.deliveryWindow}</p>
              <div><span>Standard Order Cutoff</span><strong>{window.cutoff}</strong></div>
            </article>)}
            <aside className="nv-delivery-address"><MapPin size={24} aria-hidden="true" /><h3>Made for your neighborhood.</h3><p>{DELIVERY_POLICY_CONTENT.addressCheck}</p><Link className="nv-brand-text-link" to="/#delivery">Check Your ZIP Code <ArrowRight size={17} /></Link></aside>
          </div>
        </div>
      </section>
      <section className="nv-delivery-fees nv-brand-width" aria-labelledby="delivery-fees-heading">
        <div className="nv-information-heading"><div><p className="nv-brand-eyebrow">No Guesswork at Checkout</p><h2 id="delivery-fees-heading">Delivery Fees & Minimums</h2></div><p>Minimum 3 juices, 6 shots, or an equivalent mix. The area minimums below also apply.</p></div>
        <table><thead><tr><th scope="col">Driving Distance</th><th scope="col">Delivery Fee</th><th scope="col">Area Minimum</th><th scope="col">Availability</th></tr></thead><tbody>
          {DELIVERY_ZONE_SUMMARY.map(zone => <tr key={zone.distance}><th scope="row">{zone.distance}</th><td className="nv-delivery-fee">{zone.fee}</td><td>{zone.minimum}</td><td><span className="nv-delivery-status" data-review={zone.review}>{zone.review ? <Route size={15} /> : <Truck size={15} />}{zone.review ? 'Route review' : 'Automatic'}</span></td></tr>)}
        </tbody></table>
        <div className="nv-delivery-notes">
          <details open><summary>What Does Route Review Mean?</summary><p>{DELIVERY_POLICY_CONTENT.routeReview}</p></details>
          <details open><summary>Outside Our Current Delivery Area?</summary><p>{DELIVERY_POLICY_CONTENT.waitlist}</p><Link className="nv-brand-text-link" to="/#delivery">Check Your Area <ArrowRight size={16} /></Link></details>
        </div>
        <p className="nv-delivery-exceptions">{DELIVERY_POLICY_CONTENT.exceptions}</p>
      </section>
      <section className="nv-delivery-close">
        <img {...websiteBrandImageProps(BRAND_IMAGES.bottlesCoolerWide, { website: true })} alt="Fresh NuVira juices chilled together before serving" width="1800" height="1200" loading="lazy" />
        <div className="nv-brand-width"><div><p className="nv-brand-eyebrow">Your Next Fresh Delivery</p><h2>Choose your flavors.<br />We will bring the fresh.</h2></div><Link className="nv-brand-button nv-brand-button-glass" to="/shop">Shop Juices <ArrowRight size={18} /></Link></div>
      </section>
      <nav className="nv-information-links nv-brand-width" aria-label="Delivery help"><Link to="/returns.html">Refund & Return Policy <ArrowRight size={16} /></Link><Link to="/support">Contact Support <ArrowRight size={16} /></Link></nav>
    </div>
  );
}
