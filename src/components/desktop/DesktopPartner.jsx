import React from 'react';
import { ArrowRight, Dumbbell, Heart, Building2, Store, Check, Mail } from 'lucide-react';
import { BRAND_IMAGES, websiteBrandImageProps } from '@/lib/brandImages';
import SEO from '@/components/SEO';
import '@/styles/desktop-member.css';

const audiences = [
  [Dumbbell, 'Gym / Fitness Studio', 'A fresh finish to a strong session.'],
  [Heart, 'Wellness Center', 'Real ingredients, thoughtfully paired with your space.'],
  [Building2, 'Office / Corporate', 'Something brighter for the break room.'],
  [Store, 'Other Business', 'Make fresh juice part of your next gathering.'],
];

export default function DesktopPartner({ form, setForm, loading, onSubmit }) {
  const field = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  return <div className="nv-partnership-page">
    <SEO title="Partner With NuVira" description="Bring fresh, locally made NuVira juice to your gym, studio, office, or next gathering." />
    <header className="nv-partnership-hero">
      <img {...websiteBrandImageProps(BRAND_IMAGES.aboutHeroEvent, { website: true })} alt="NuVira serving fresh juice at a local community event" width="1800" height="1271" />
      <div className="nv-brand-width"><p className="nv-member-kicker">Fresh Juice. Shared Locally.</p><h1>NuVira<br />Partnerships</h1><p>Give your community something worth coming back for. Fresh, cold-pressed juice, made locally and brought to your space.</p><a href="#partnership-inquiry" className="nv-brand-button nv-brand-button-glass">Let's Talk<ArrowRight size={18} /></a></div>
    </header>
    <div className="nv-partnership-audiences nv-brand-width">{audiences.map(([Icon, label, description]) => <div key={label}><Icon size={23} aria-hidden="true" /><h2>{label}</h2><p>{description}</p></div>)}</div>
    <div className="nv-partnership-contact nv-brand-width">
      <section><p className="nv-member-kicker">Made for Your Community</p><h2>Your space.<br />A fresh possibility.</h2><p>From a post-workout pour to a team wellness day, we'll help you find the right juice mix and delivery plan for the people you serve.</p><ul>{['Fresh juice on an agreed schedule', 'Bundle options built around your volume', 'A dedicated contact, from planning to delivery'].map(item => <li key={item}><Check size={18} aria-hidden="true" />{item}</li>)}</ul><a className="nv-member-text-link" href="mailto:support@nuvirajuice.com"><Mail size={17} />support@nuvirajuice.com</a></section>
      <form id="partnership-inquiry" className="nv-partnership-form" onSubmit={event => { event.preventDefault(); onSubmit(); }}><p className="nv-member-kicker">Start the Conversation</p><h2>Tell us about your space.</h2><div className="nv-partnership-fields">{[['name', 'Your Name', 'text', 'name'], ['business', 'Business Name', 'text', 'organization'], ['email', 'Email Address', 'email', 'email'], ['phone', 'Phone Number', 'tel', 'tel']].map(([key, label, type, complete]) => <label key={key} htmlFor={`partner-${key}`}>{label}<input id={`partner-${key}`} type={type} autoComplete={complete} required value={form[key]} onChange={event => field(key, event.target.value)} /></label>)}</div><label htmlFor="partner-type">Business Type <span>(Optional)</span></label><select id="partner-type" value={form.type} onChange={event => field('type', event.target.value)}><option value="">Select Your Business Type</option>{audiences.map(([, label]) => <option key={label}>{label}</option>)}</select><label htmlFor="partner-notes">What Do You Have in Mind? <span>(Optional)</span></label><textarea id="partner-notes" rows={3} value={form.notes} placeholder="Your location, team size, or an upcoming event..." onChange={event => field('notes', event.target.value)} /><div className="nv-partnership-submit"><p>No commitment required.<br />We'll respond within 48 hours.</p><button className="nv-brand-button nv-brand-button-primary" disabled={loading}>{loading ? 'Sending...' : 'Send Inquiry'}<ArrowRight size={18} /></button></div></form>
    </div>
  </div>;
}
