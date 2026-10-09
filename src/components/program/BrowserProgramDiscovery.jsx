import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowRight } from 'lucide-react';
import { PROGRAMS, programOptionForDays } from '@/lib/program-catalog';
import { approvedProductMedia } from '@/lib/approved-product-media';
import './BrowserProgramDiscovery.css';

export default function BrowserProgramDiscovery({ programKey, days, collection = false }) {
  const alternatives = PROGRAMS.filter(program => program.key !== programKey);
  if (!alternatives.length) return null;

  return (
    <section className="nv-program-discovery" data-collection={collection || undefined} aria-labelledby="nv-discovery-heading">
      <div className="nv-program-discovery-inner">
        <header className="nv-program-discovery-heading">
          <div><p>{collection ? 'Your daily juice routine, already paired.' : 'More ways to make it your daily ritual'}</p><h2 id="nv-discovery-heading">{collection ? 'Juice Programs' : 'Explore another pairing.'}</h2></div>
          <p>{collection ? 'Two or three days. Four juices each day. A simple daily guide, included.' : 'A different flavor focus. The same four-juice daily routine.'}</p>
        </header>
        <div className="nv-program-discovery-grid">
          {alternatives.map(program => {
            const option = collection ? program.durationOptions[0] : programOptionForDays(program, days);
            if (!option) return null;
            const leadJuice = option.bundleComposition[0]?.product_name;
            const media = approvedProductMedia({ title: leadJuice });
            return (
              <Link key={program.key} className="nv-program-discovery-link" data-program={program.key}
                to={`/program/${program.key}?days=${option.days}`} aria-label={`Explore ${program.name}`}>
                <div className="nv-program-discovery-photo">
                  <img src={media?.primary || program.image} alt={media?.alt || `${program.name} juice program`} loading="lazy" decoding="async" />
                </div>
                <div className="nv-program-discovery-copy">
                  <div className="nv-program-discovery-name"><h3>{program.name}</h3><ArrowUpRight aria-hidden="true" /></div>
                  <p className="nv-program-discovery-tagline">{program.tagline}</p>
                  <p className="nv-program-discovery-mix">{collection ? `${option.bundleComposition.map(item => `${item.quantity / option.days} ${item.product_name}`).join(' + ')} each day` : option.composition}</p>
                  <div className="nv-program-discovery-price"><span>{collection ? program.durationOptions.map(item => item.days).join(' or ') : option.days} days <span aria-hidden="true">·</span> {collection ? program.durationOptions.map(item => item.bottles).join(' or ') : option.bottles} bottles</span><strong>{collection && program.durationOptions.length > 1 ? 'From ' : ''}${option.price}</strong></div>
                  <span className="nv-program-discovery-cta">Explore {program.name}<ArrowRight aria-hidden="true" /></span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
