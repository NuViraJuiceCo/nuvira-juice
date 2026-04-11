import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, MapPin, Calendar, Users, ExternalLink } from 'lucide-react';

const TRIO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/99e225ed4_DSC02438-Edit-2.jpg";

const FESTIVAL_LOGO = 'https://static.wixstatic.com/media/44fb75_aec8657df9b14cdda95892acea64c86c~mv2.png/v1/fill/w_274,h_275,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Untitled%20design.png';

const events = [
  {
    id: 1,
    title: 'Missouri Spirit Festival',
    date: 'Saturday, May 30, 2026',
    time: '3:00 PM – 7:00 PM',
    location: '5521 Water St, Augusta, MO 63332',
    description: 'A high-energy celebration of craft spirits, food, and community set in the historic river town of Augusta. Over 40 vendors, live music, food trucks, artisan vendors, and family-friendly activities — NuVira will be there with our booth. Come taste our cold-pressed juice lineup and connect with the team. Benefiting STL Hero Network.',
    type: 'Festival',
    image_url: FESTIVAL_LOGO,
    link: 'https://www.mospiritfestival.com',
    tickets_link: 'https://www.mospiritfestival.com/events/the-missouri-spirit-festival',
    highlights: ['40+ Vendors', 'Live Music', 'Family Friendly', 'Benefiting STL Hero Network'],
  },
];

const typeColors = {
  'Pop-Up': 'bg-accent/20 text-accent-foreground',
  'Community': 'bg-primary/10 text-primary',
  'Drop': 'bg-secondary text-secondary-foreground',
  'Festival': 'bg-purple-100 text-purple-700',
};

export default function Events() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3">
        <Link to="/account">
          <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <span className="font-heading text-base font-semibold">Events & Community</span>
      </div>

      <div className="px-4 py-6 space-y-6">
        {/* Intro */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center px-2"
        >
          <h2 className="font-heading text-2xl font-bold mb-2">Find Your People.</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            NuVira is more than a juice — it's a movement. Join us in St. Louis and beyond as we build a community around wellness, freshness, and intentional living.
          </p>
        </motion.div>

        {/* Community Banner */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="relative rounded-2xl overflow-hidden h-36"
        >
          <img src={TRIO_URL} alt="NuVira Community" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-primary/80 to-primary/40" />
          <div className="absolute inset-0 flex items-center px-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-primary-foreground/80" />
                <span className="text-primary-foreground/80 text-xs font-medium">STL Wellness Community</span>
              </div>
              <p className="font-heading text-xl font-bold text-primary-foreground">
                Growing Together.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Events List */}
        <div className="space-y-4">
          <h3 className="font-heading text-lg font-semibold">Upcoming</h3>
          {events.map((event, i) => (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.08 }}
              className="bg-card border border-border/40 rounded-2xl overflow-hidden"
            >
              <div className="h-36 overflow-hidden">
                <img src={event.image_url} alt={event.title} className="w-full h-full object-cover" />
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h4 className="font-semibold text-sm leading-tight flex-1">{event.title}</h4>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${typeColors[event.type]}`}>
                    {event.type}
                  </span>
                </div>
                <div className="space-y-1 mb-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar className="w-3 h-3" />
                    <span>{event.date} · {event.time}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <MapPin className="w-3 h-3" />
                    <span>{event.location}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{event.description}</p>
                {event.highlights && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {event.highlights.map(h => (
                      <span key={h} className="text-[10px] font-semibold bg-secondary px-2 py-0.5 rounded-full text-muted-foreground">{h}</span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 mt-3">
                  {event.tickets_link && (
                    <a href={event.tickets_link} target="_blank" rel="noopener noreferrer"
                      className="flex-1 text-center text-xs font-bold bg-primary text-primary-foreground px-3 py-2 rounded-xl">
                      Get Tickets
                    </a>
                  )}
                  {event.link && (
                    <a href={event.link} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs font-semibold text-primary px-3 py-2 rounded-xl border border-primary/30">
                      <ExternalLink className="w-3 h-3" />
                      Website
                    </a>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Community Message */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-secondary/60 rounded-2xl p-5 text-center"
        >
          <p className="font-heading text-base font-semibold mb-2">Stay in the Loop</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Enable notifications to be the first to know about new drops, pop-ups, and community events.
          </p>
        </motion.div>
      </div>
    </div>
  );
}