import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { BRAND_IMAGES } from '@/lib/brandImages';

export default function DesktopFooter() {
  return (
    <footer className="nv-brand-footer">
      <div className="nv-brand-footer-inner">
        <div className="nv-brand-footer-identity">
          <img src={BRAND_IMAGES.wordmark} width="154" height="60" alt="NuVira Juice Company" loading="lazy" />
          <p>Real. Living. Nutrition.</p>
          <span>Rooted in Wentzville, Missouri.<br />Made for your everyday.</span>
        </div>
        <nav aria-label="Footer shop"><h2>Shop</h2><Link to="/shop">Juices & Shots</Link><Link to="/#programs">Juice Programs</Link><Link to="/merch">NuVira Goods</Link><Link to="/rewards">Rewards</Link></nav>
        <nav aria-label="Footer NuVira"><h2>NuVira</h2><Link to="/about">Our Story</Link><Link to="/why-nuvira">The NuVira Difference</Link><Link to="/events">In the Community</Link><Link to="/juice-catering-st-louis">Events & Catering</Link></nav>
        <nav aria-label="Footer customer care"><h2>Customer Care</h2><Link to="/delivery.html">Delivery & Service Areas</Link><Link to="/support">FAQs</Link><Link to="/contact">Contact Us <ArrowUpRight size={14} aria-hidden="true" /></Link><Link to="/account/orders">Your Orders</Link></nav>
      </div>
      <div className="nv-brand-footer-base"><span>&copy; {new Date().getFullYear()} NuVira Juice Co.</span><div><Link to="/legal#licensing-insurance">Licensing & Insurance</Link><Link to="/legal">Privacy & Terms</Link><Link to="/returns.html">Returns</Link><Link to="/cold-pressed-juice-delivery">Local Juice Delivery</Link></div></div>
    </footer>
  );
}
