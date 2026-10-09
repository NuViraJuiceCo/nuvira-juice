import React from 'react';
import { ArrowUpRight, Building2, ShieldCheck } from 'lucide-react';
import './DesktopLicensing.css';

export default function DesktopLicensing() {
  return (
    <section id="licensing-insurance" className="nv-licensing" aria-labelledby="nv-licensing-title">
      <header>
        <p className="nv-licensing-eyebrow">NuVira Juice Company · Wentzville, Missouri</p>
        <h2 id="nv-licensing-title">Licensing &amp; Insurance</h2>
        <p>Information about our local food-service license and liability insurance.</p>
      </header>
      <div className="nv-licensing-grid">
        <article>
          <Building2 size={24} aria-hidden="true" />
          <p className="nv-licensing-eyebrow">Licensing authority</p>
          <h3>St. Charles County</h3>
          <p className="nv-licensing-subtitle">Department of Public Health</p>
          <p>NuVira Juice Company is licensed to operate through the St. Charles County Department of Public Health.</p>
          <a href="https://www.sccmo.org/814/Food" target="_blank" rel="noopener noreferrer">County food-safety program <ArrowUpRight size={16} aria-hidden="true" /></a>
        </article>
        <article>
          <ShieldCheck size={24} aria-hidden="true" />
          <p className="nv-licensing-eyebrow">Commercial general liability</p>
          <h3>FLIP</h3>
          <p className="nv-licensing-subtitle">Food Liability Insurance Program</p>
          <p>Coverage for NuVira Juice Company LLC, with Accelerant National Insurance Company listed as the insurer.</p>
          <dl>
            <div><dt>Each occurrence</dt><dd>$1,000,000</dd></div>
            <div><dt>Products-completed operations aggregate</dt><dd>$2,000,000</dd></div>
            <div><dt>Certificate policy period</dt><dd><time dateTime="2025-11-28">Nov. 28, 2025</time> – <time dateTime="2026-11-28">Nov. 28, 2026</time></dd></div>
          </dl>
          <a href="https://www.fliprogram.com/" target="_blank" rel="noopener noreferrer">About FLIP <ArrowUpRight size={16} aria-hidden="true" /></a>
        </article>
      </div>
      <div className="nv-licensing-contact">
        <div><h3>Need documentation?</h3><p>Contact us for licensing information or a certificate of insurance for your venue, event, or business.</p></div>
        <a href="mailto:support@nuvirajuice.com?subject=Licensing%20and%20insurance%20documentation">Request information <ArrowUpRight size={16} aria-hidden="true" /></a>
      </div>
      <p className="nv-licensing-note">Insurance details reflect the certificate period shown, not a guarantee of coverage for every claim. Coverage is subject to policy terms, conditions, exclusions, and applicable limits. Licensing and insurance do not constitute a product endorsement.</p>
    </section>
  );
}
