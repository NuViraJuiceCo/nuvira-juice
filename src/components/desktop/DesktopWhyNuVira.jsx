import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Refrigerator, RotateCcw, GlassWater } from 'lucide-react';
import { BRAND_IMAGES, websiteBrandImageProps } from '@/lib/brandImages';

export default function DesktopWhyNuVira({ principles, processSteps }) {
  return (
    <div className="nv-information-page nv-difference-page">
      <section className="nv-difference-hero">
        <img {...websiteBrandImageProps(BRAND_IMAGES.bottlesCoolerWide, { website: true })} alt="AURA, RE-NU, and OASIS cold-pressed juices with their real ingredients on the labels" width="1800" height="1200" />
        <div className="nv-brand-width"><p className="nv-brand-eyebrow">Real. Living. Nutrition.</p><h1>The NuVira<br />Difference</h1><p>Real produce. Small batches. Fresh juice that stays close to where it is made.</p><Link className="nv-brand-button nv-brand-button-glass" to="/shop">Find Your Flavor <ArrowRight size={18} /></Link></div>
      </section>
      <section className="nv-difference-standards nv-brand-width" aria-labelledby="nv-standards-heading">
        <div className="nv-information-heading"><div><p className="nv-brand-eyebrow">What Goes Into Every Bottle</p><h2 id="nv-standards-heading">Nothing complicated.<br />Nothing overlooked.</h2></div><p>Freshness is a series of choices, from the ingredients we press to the way your juice reaches you.</p></div>
        <div className="nv-difference-principles">{principles.map(({ icon: Icon, title, body }) => <article key={title}><Icon size={26} aria-hidden="true" /><h3>{title}</h3><p>{body}</p></article>)}</div>
      </section>
      <section className="nv-difference-process" aria-labelledby="nv-process-heading"><div className="nv-brand-width">
        <div className="nv-information-heading"><div><p className="nv-brand-eyebrow">From Produce to Your Routine</p><h2 id="nv-process-heading">A shorter journey.<br />A fresher bottle.</h2></div><p>Made in focused batches and served locally. Each step keeps freshness at the center.</p></div>
        <ol>{processSteps.map(({ icon: Icon, title, body }, index) => <li key={title}><div className="nv-process-marker"><Icon size={24} aria-hidden="true" /><span>0{index + 1}</span></div><h3>{title}</h3><p>{body}</p></li>)}</ol>
        <Link className="nv-brand-text-link" to="/delivery.html">Explore Local Delivery <ArrowRight size={18} /></Link>
      </div></section>
      <section className="nv-difference-care nv-brand-width"><div><p className="nv-brand-eyebrow">Enjoy It at Its Freshest</p><h2>Real juice.<br />A little care.</h2><p>Follow the storage and freshness instructions on your bottle.</p></div><div className="nv-care-steps">
        <div><Refrigerator size={27} /><h3>Keep It Chilled</h3><p>Refrigerate your juice.</p></div><div><RotateCcw size={27} /><h3>Shake Gently</h3><p>Bring the ingredients together.</p></div><div><GlassWater size={27} /><h3>Enjoy Fresh</h3><p>Follow the bottle's date.</p></div>
      </div></section>
      <section className="nv-difference-finish"><div className="nv-brand-width"><div><p className="nv-brand-eyebrow">Taste the Difference</p><h2>Your next favorite starts with a sip.</h2></div><Link className="nv-brand-button" to="/shop">Shop Juices <ArrowRight size={18} /></Link></div></section>
    </div>
  );
}
