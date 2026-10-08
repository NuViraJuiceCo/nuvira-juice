import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowRight } from 'lucide-react';
import { PROGRAMS, programOptionForDays } from '@/lib/program-catalog';
import { approvedProductMedia } from '@/lib/approved-product-media';
import './BrowserProgramDiscovery.css';

export default function BrowserProgramDiscovery({ programKey, days }) {
  const alternatives = PROGRAMS.filter(program => program.key !== programKey);
  if (!alternatives.length) return null;

  return (
    <section className="nv-program-discovery" aria-labelledby="nv-discovery-heading">
      <div className="nv-program-discovery-inner">
        <header className="nv-program-discovery-heading">
          <div><p>More ways to make it your daily ritual</p><h2 id="nv-discovery-heading">Explore another pairing.</h2></div>
          <p>A different flavor focus. The same four-juice daily routine.</p>
        </header>
        <div className="nv-program-discovery-grid">
          {alternatives.map(program => {
            const option = programOptionForDays(program, days);
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
                  <p className="nv-program-discovery-mix">{option.composition}</p>
                  <div className="nv-program-discovery-price"><span>{option.days} days <span aria-hidden="true">·</span> {option.bottles} bottles</span><strong>${option.price}</strong></div>
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
