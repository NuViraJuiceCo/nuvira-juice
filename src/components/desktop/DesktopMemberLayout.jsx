import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import { UserRound, Package, Sparkles, Star, Gift, Settings, Bell, HelpCircle, ArrowUpRight } from 'lucide-react';
import SEO from '@/components/SEO';
import '@/styles/desktop-member.css';

const links = [
  [UserRound, 'Overview', '/account'],
  [Package, 'Orders', '/account/orders'],
  [Sparkles, 'My Programs', '/account/programs'],
  [Star, 'Rewards', '/rewards'],
  [Gift, 'Refer & Earn', '/referral'],
  [Bell, 'Updates', '/notifications'],
  [Settings, 'Settings', '/account/settings'],
];

export default function DesktopMemberLayout({ title, description, children, action }) {
  return <div className="nv-member-layout">
    <SEO title={title} description={description} />
    <aside className="nv-member-rail">
      <p className="nv-member-kicker">Your NuVira</p>
      <nav aria-label="Member navigation">{links.map(([Icon, label, path]) =>
        <NavLink key={path} to={path} end={path === '/account'}><Icon size={18} aria-hidden="true" />{label}</NavLink>
      )}</nav>
      <Link className="nv-member-help" to="/support"><HelpCircle size={18} aria-hidden="true" /><span>Need a hand?<small>Contact & Support</small></span><ArrowUpRight size={16} aria-hidden="true" /></Link>
    </aside>
    <div className="nv-member-main">
      <header className="nv-member-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</header>
      {children}
    </div>
  </div>;
}
