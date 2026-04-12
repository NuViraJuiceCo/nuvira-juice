import React from 'react';
import SEO from '@/components/SEO';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

const socials = [
  {
    name: 'Instagram',
    handle: '@nuvirajuiceco',
    url: 'https://www.instagram.com/nuvirajuiceco',
    description: 'Follow our journey — behind the bottle, fresh drops & STL community vibes.',
    color: 'from-pink-500 to-purple-600',
    bg: 'bg-pink-50 border-pink-200',
    textColor: 'text-pink-600',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
      </svg>
    ),
  },
  {
    name: 'TikTok',
    handle: '@nuvirajuiceco',
    url: 'https://www.tiktok.com/@nuvirajuiceco',
    description: 'Watch us press, bottle, and deliver — short-form content for the wellness curious.',
    color: 'from-gray-800 to-gray-600',
    bg: 'bg-gray-50 border-gray-200',
    textColor: 'text-gray-700',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z"/>
      </svg>
    ),
  },
  {
    name: 'Facebook',
    handle: 'NuVira Juice Co',
    url: 'https://www.facebook.com/nuvirajuiceco',
    description: 'Stay updated on events, new flavors, and community highlights.',
    color: 'from-blue-600 to-blue-500',
    bg: 'bg-blue-50 border-blue-200',
    textColor: 'text-blue-600',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
      </svg>
    ),
  },
];

const links = [
  {
    name: 'Website',
    url: 'https://www.nuvirajuice.com',
    desc: 'Our full brand experience online',
    bg: 'bg-primary/8 border-primary/20',
    textColor: 'text-primary',
  },
  {
    name: 'Google Business',
    url: 'https://g.page/nuvirajuiceco',
    desc: 'Leave us a review on Google',
    bg: 'bg-yellow-50 border-yellow-200',
    textColor: 'text-yellow-700',
  },
];

export default function Connect() {
  const navigate = useNavigate();

  return (
    <div className="pb-10">
      <SEO title="Connect With Us" description="Follow NuVira Juice Co on Instagram, TikTok, and Facebook. Fresh content, drops, events & STL community vibes." />
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-secondary rounded-full flex items-center justify-center">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-heading text-xl font-bold">Connect With Us</h1>
      </div>

      {/* Hero */}
      <div className="mx-4 mb-6 rounded-2xl bg-gradient-to-br from-primary to-primary/70 p-5 text-center">
        <img src={LOGO_URL} alt="NuVira" className="h-7 mx-auto mb-3 brightness-0 invert opacity-90" />
        <p className="text-primary-foreground font-heading text-lg font-bold">Follow the Journey</p>
        <p className="text-primary-foreground/75 text-xs mt-1">Fresh content, drops, events & community — all in one place.</p>
      </div>

      {/* Social Cards */}
      <div className="px-4 mb-6 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Social Media</p>
        {socials.map((s, i) => (
          <motion.a
            key={s.name}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            className={`flex items-center gap-4 p-4 rounded-2xl border ${s.bg} active:scale-98 transition-transform block`}
          >
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-white shrink-0 shadow-sm`}>
              {s.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-bold">{s.name}</p>
                <span className={`text-xs font-medium ${s.textColor}`}>{s.handle}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{s.description}</p>
            </div>
            <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
          </motion.a>
        ))}
      </div>

      {/* Other Links */}
      <div className="px-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">More</p>
        {links.map((l, i) => (
          <motion.a
            key={l.name}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 + i * 0.07 }}
            className={`flex items-center justify-between p-4 rounded-2xl border ${l.bg} block`}
          >
            <div>
              <p className={`text-sm font-bold ${l.textColor}`}>{l.name}</p>
              <p className="text-xs text-muted-foreground">{l.desc}</p>
            </div>
            <ExternalLink className="w-4 h-4 text-muted-foreground" />
          </motion.a>
        ))}
      </div>
    </div>
  );
}