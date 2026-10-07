import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { PROGRAMS } from '@/lib/program-catalog';
import ProgramBottleMix from '@/components/program/ProgramBottleMix';

const PROGRAM_TASTE = {
  radiance: 'Bright citrus. A refreshing watermelon finish.',
  hydration: 'Watermelon freshness, balanced with bright citrus.',
  reset: 'Crisp apple and cucumber, with a splash of watermelon.',
};

export default function DesktopPrograms() {
  const [selection, setSelection] = useState({ index: 0, days: null });
  const tabs = useRef([]);
  const program = PROGRAMS[selection.index];
  const startingOption = program.durationOptions.reduce((lowest, option) => option.price < lowest.price ? option : lowest);
  const selectedOption = program.durationOptions.find(option => option.days === selection.days) || startingOption;
  const dailyBottles = selectedOption.bottles / selectedOption.days;
  const selectProgram = index => setSelection(current => ({ ...current, index }));

  const handleTabKey = (event, index) => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % PROGRAMS.length;
    else if (event.key === 'ArrowLeft') next = (index + PROGRAMS.length - 1) % PROGRAMS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = PROGRAMS.length - 1;
    else return;
    event.preventDefault();
    selectProgram(next);
    tabs.current[next]?.focus();
  };

  return (
    <section id="programs" className="nv-brand-program-band" data-program={program.key} aria-labelledby="nv-programs-heading">
      <div className="nv-brand-width nv-brand-section">
        <div className="nv-brand-program-heading">
          <div className="nv-brand-program-intro">
            <p className="nv-brand-eyebrow">Your juice routine, already planned.</p>
            <h2 id="nv-programs-heading">NuVira Juice Programs</h2>
            <p className="nv-brand-program-explanation">{dailyBottles === 4 ? 'Four' : dailyBottles} cold-pressed juices each day, thoughtfully paired with a simple daily guide.</p>
          </div>
          <div className="nv-brand-program-tabs" role="tablist" aria-label="Explore juice programs">
            {PROGRAMS.map((item, index) => (
              <button key={item.key} ref={element => { tabs.current[index] = element; }} type="button" role="tab"
                id={`nv-program-tab-${item.key}`} aria-selected={index === selection.index} aria-controls="nv-program-panel"
                tabIndex={index === selection.index ? 0 : -1} data-program={item.key}
                onClick={() => selectProgram(index)} onKeyDown={event => handleTabKey(event, index)}>
                {item.name}
              </button>
            ))}
          </div>
        </div>
        <div id="nv-program-panel" className="nv-brand-program-panel" role="tabpanel" aria-labelledby={`nv-program-tab-${program.key}`} tabIndex={0}>
          <div className="nv-brand-program-details">
            <div className="nv-brand-program-story">
              <p className="nv-brand-eyebrow">Your Flavor Pairing</p>
              <h3>{program.name}</h3>
              <p className="nv-brand-program-tagline">{PROGRAM_TASTE[program.key] || program.tagline}</p>
            </div>
            <div className="nv-brand-program-length" role="group" aria-label={`${program.name} program length`}>
              <p>{program.durationOptions.length > 1 ? 'Choose Your Length' : 'Your Program Includes'}</p>
              <div className="nv-brand-program-length-options">
                {program.durationOptions.map(option => (
                  <button type="button" key={option.days} aria-pressed={option.days === selectedOption.days}
                    onClick={() => setSelection(current => ({ ...current, days: option.days }))}>
                    <span className="nv-brand-program-length-title">{option.days} Days{option.days === selectedOption.days && <Check size={16} aria-hidden="true" />}</span>
                    <span className="nv-brand-program-length-bottles">{option.bottles} bottles</span>
                    <strong>${option.price}</strong>
                  </button>
                ))}
              </div>
            </div>
            <div className="nv-brand-program-choose">
              <p className="nv-brand-program-price"><span>Program total</span><strong>${selectedOption.price}</strong></p>
              <Link className="nv-brand-button nv-brand-program-cta" to={`/program/${program.key}?days=${selectedOption.days}`}>Explore {program.name}<ArrowRight size={18} aria-hidden="true" /></Link>
            </div>
          </div>
          <div className="nv-brand-program-package">
            <p className="nv-brand-program-package-label"><strong>Inside Your Program</strong><span>{selectedOption.bottles} bottles for {selectedOption.days} days</span></p>
            <ProgramBottleMix showcase components={selectedOption.bundleComposition} days={selectedOption.days} label={`${program.name} ${selectedOption.days}-day package: ${selectedOption.composition}`} />
          </div>
        </div>
      </div>
    </section>
  );
}
