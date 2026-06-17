import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MapPin, Calendar, Users, ExternalLink, Gift } from 'lucide-react';
import MobilePageHeader from '@/components/layout/MobilePageHeader';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import SEO from '@/components/SEO';
import { isEventCheckInVisible } from '@/lib/eventCheckIn';
import { eventStructuredDateTimes, resolveEventTimeSemantics } from '@/lib/eventTimeSemantics';

function buildEventSchema(events) {
  if (!events.length) return null;
  return events.map(e => ({
    "@context": "https://schema.org",
    "@type": "Event",
    "name": e.title,
    "description": e.description || undefined,
    "image": e.image_url || undefined,
    "startDate": eventStructuredDateTimes(e).startDate,
    "endDate": eventStructuredDateTimes(e).endDate,
    "eventStatus": "https://schema.org/EventScheduled",
    "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
    "location": {
      "@type": "Place",
      "name": e.location || "Wentzville, MO",
      "address": {
        "@type": "PostalAddress",
        "addressLocality": "Wentzville",
        "addressRegion": "MO",
        "addressCountry": "US"
      }
    },
    "organizer": {
      "@type": "Organization",
      "name": "NuVira Juice Co.",
      "url": "https://www.nuvirajuice.com"
    },
    ...(e.tickets_link ? { "offers": { "@type": "Offer", "url": e.tickets_link, "availability": "https://schema.org/InStock" } } : {}),
  }));
}

const TRIO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/99e225ed4_DSC02438-Edit-2.jpg";

const HARDCODED_EVENTS = [];

const typeColors = {
  'Pop-Up': 'bg-accent/20 text-accent-foreground',
  'Community': 'bg-primary/10 text-primary',
  'Drop': 'bg-secondary text-secondary-foreground',
  'Festival': 'bg-purple-100 text-purple-700',
};

function asList(value) {
  return Array.isArray(value) ? value : [];
}

export default function Events() {
  const { data: dbEvents = [] } = useQuery({
    queryKey: ['events'],
    queryFn: () => base44.entities.Event.filter({ is_active: true }, 'date', 50),
  });
  const dbEventsList = asList(dbEvents);

  // Merge: hub-synced events take precedence, hardcoded ones fill in if not already covered
  const hubEventTitles = new Set(dbEventsList.map(e => e.title));
  const hardcodedFiltered = HARDCODED_EVENTS.filter(e => !hubEventTitles.has(e.title));
  const events = [
    ...dbEventsList.map(e => ({ ...e, id: e.id })),
    ...hardcodedFiltered,
  ];

  const eventSchema = buildEventSchema(events);
  const showEventCheckIn = isEventCheckInVisible();

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Events & Community"
        description="Join NuVira Juice Co. at pop-ups, community events, and wellness gatherings across the St. Louis area."
        structuredData={eventSchema?.length === 1 ? eventSchema[0] : eventSchema?.length > 1 ? { "@context": "https://schema.org", "@graph": eventSchema } : undefined}
      />
      {/* Header — safe-area-aware via MobilePageHeader (G40D) */}
      <MobilePageHeader title="Events & Community" backTo="/account" />

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
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(200,232,106,0.22) 0%, rgba(29,140,53,0.82) 42%, rgba(6,42,32,0.72) 100%)' }} />
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

        {showEventCheckIn && (
        <Link
          to="/event/may30"
          className="flex items-center gap-3 rounded-2xl border p-4 text-left nuvira-premium-card"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl nuvira-icon-badge">
            <Gift className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-foreground">Event Check-In</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              Claim the one-time 250 point event visit bonus.
            </span>
          </span>
        </Link>
        )}

        {/* Events List */}
        <div className="space-y-4">
          <h3 className="font-heading text-lg font-semibold">Upcoming</h3>
          {events.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No upcoming events at this time. Check back soon!</p>
          )}
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
                    <span>{event.date} · {resolveEventTimeSemantics(event).displayTime}</span>
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
                      className="flex-1 text-center text-xs font-bold nuvira-gradient-button px-3 py-2 rounded-xl">
                      Get Tickets
                    </a>
                  )}
                  {event.website_link && (
                    <a href={event.website_link} target="_blank" rel="noopener noreferrer"
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