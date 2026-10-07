import React from 'react';
import { approvedProductMedia } from '@/lib/approved-product-media';

const TASTING_NOTES = {
  AURA: 'Orange, pineapple & ginger',
  OASIS: 'Watermelon, pineapple & citrus',
  'RE-NU': 'Apple, cucumber & greens',
};

export default function ProgramBottleMix({ components, days = 1, showcase = false, label }) {
  return (
    <div className="nv-program-bottle-display" data-display={showcase ? 'showcase' : 'total'} aria-label={label} style={{ '--nv-blend-columns': Math.min(components.length, 3) }}>
      {components.map(component => {
        const media = approvedProductMedia({ title: component.product_name });
        const count = component.quantity;
        const dailyCount = count / days;
        return (
          <figure className="nv-program-blend" key={component.product_name}>
            {media && <img src={media.primary} alt={media.alt} width="1080" height="1350" loading="lazy" decoding="async" />}
            <figcaption>
              {showcase ? (
                <>
                  <div><h4>{count} {component.product_name} <span className="nv-program-bottle-unit">{count === 1 ? 'bottle' : 'bottles'}</span></h4><p>{TASTING_NOTES[component.product_name] || 'Cold-pressed juice'}</p></div>
                  <p className="nv-program-daily-quantity">Enjoy <strong>{dailyCount}</strong> {dailyCount === 1 ? 'bottle' : 'bottles'} each day</p>
                </>
              ) : (
                <>
                  <strong>{count}<span>bottles</span></strong>
                  <div><h4>{component.product_name}</h4><p>{dailyCount} {dailyCount === 1 ? 'bottle' : 'bottles'} each day</p></div>
                </>
              )}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
