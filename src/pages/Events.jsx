import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MapPin, Calendar, Users, ExternalLink } from 'lucide-react';
import MobilePageHeader from '@/components/layout/MobilePageHeader';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import SEO from '@/components/SEO';
import PullToRefresh from '@/components/PullToRefresh';
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
      "url": "https://nuvirajuice.com/"
    },
    ...(e.tickets_link ? { "offers": { "@type": "Offer", "url": e.tickets_link, "availability": "https://schema.org/InStock" } } : {}),
  }));
}

const TRIO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/99e225ed4_DSC02438-Edit-2.jpg";

const HARDCODED_EVENTS = [];

const typeColors = {
  'Pop-Up': 'bg-orange-500/15 text-orange-700 dark:text-orange-200',
  'Community': 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200',
  'Drop': 'bg-lime-500/18 text-lime-800 dark:text-lime-200',
  'Festival': 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-200',
};

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function eventCategory(event = {}) {
  const explicitCategory = [event.event_type, event.type]
    .map(value => String(value || '').trim())
    .find(value => value && value.toLowerCase() !== 'event');
  if (explicitCategory) return explicitCategory;
  return asList(event.tags).map(tag => String(tag || '').trim()).find(Boolean) || 'Community';
}

function chicagoDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function eventStartDateString(event = {}) {
  const startDate = eventStructuredDateTimes(event).startDate || '';
  const match = String(startDate || event.date || event.event_date || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function eventSortValue(event = {}) {
  const startDate = eventStructuredDateTimes(event).startDate || event.date || event.event_date || '';
  const date = new Date(startDate);
  return Number.isNaN(date.getTime()) ? Number.MAX_SAFE_INTEGER : date.getTime();
}

export default function Events() {
  const { data: dbEvents = [], refetch } = useQuery({
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
  ]
    .filter(event => {
      const date = eventStartDateString(event);
      return !date || date >= chicagoDateString();
    })
    .sort((a, b) => eventSortValue(a) - eventSortValue(b));

  const eventSchema = buildEventSchema(events);

  return (
    <PullToRefresh onRefresh={refetch}>
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
          className="nuvira-citrus-panel rounded-2xl border p-5 text-center"
        >
          <h2 className="font-heading text-2xl font-bold mb-2">Find Your People.</h2>
          <p className="text-sm leading-relaxed text-foreground/75">
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
                <Users className="w-4 h-4 text-white/85 drop-shadow-sm" />
                <span className="text-white/85 text-xs font-medium drop-shadow-sm">STL Wellness Community</span>
              </div>
              <p className="font-heading text-xl font-bold text-white drop-shadow-sm">
                Growing Together.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Events List */}
        <div className="space-y-4">
          <h3 className="font-heading text-lg font-semibold">Upcoming</h3>
          {events.length === 0 && (
            <div className="nuvira-premium-card rounded-2xl p-5 text-center">
              <p className="font-heading text-lg font-bold">Next dates are being finalized.</p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Public pop-ups and partner events will appear here as soon as they are active in the NuVira event calendar.
              </p>
              <Link to="/book-event" className="nuvira-gradient-button mt-4 inline-flex h-11 items-center justify-center rounded-xl px-5 text-sm font-bold">
                Book NuVira for an Event
              </Link>
            </div>
          )}
          {events.map((event, i) => {
            const category = eventCategory(event);
            return (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.08 }}
                className="nuvira-premium-card rounded-2xl overflow-hidden"
              >
                <div className="h-36 overflow-hidden">
                  <img src={event.image_url} alt={event.title} className="w-full h-full object-cover" />
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h4 className="font-semibold text-sm leading-tight flex-1">{event.title}</h4>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${typeColors[category] || 'bg-primary/10 text-primary'}`}>
                      {category}
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
                        <span key={h} className="text-[10px] font-semibold bg-primary/10 px-2 py-0.5 rounded-full text-primary">{h}</span>
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
                        className="flex items-center gap-1 text-xs font-semibold text-primary px-3 py-2 rounded-xl border border-primary/30 bg-card/70">
                        <ExternalLink className="w-3 h-3" />
                        Website
                      </a>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Community Message */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="nuvira-citrus-panel rounded-2xl border p-5 text-center"
        >
          <p className="font-heading text-base font-semibold mb-2">Stay in the Loop</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Enable notifications to be the first to know about new drops, pop-ups, and community events.
          </p>
        </motion.div>
      </div>
    </div>
    </PullToRefresh>
  );
}
