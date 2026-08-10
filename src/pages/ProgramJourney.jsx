import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  BellRing,
  CalendarDays,
  Check,
  ChevronDown,
  CircleCheckBig,
  Clock3,
  Droplets,
  Leaf,
  LockKeyhole,
  Refrigerator,
  ShieldCheck,
  Sparkles,
  SunMedium,
} from 'lucide-react';
import { toast } from 'sonner';
import { invokeCustomerGateway } from '@/api/base44Client';
import { DAILY_PROGRAM_SCHEDULES, PROGRAM_BY_KEY } from '@/lib/program-catalog';
import SEO from '@/components/SEO';

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const LONG_DATE_FORMAT = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

function dateFromKey(value) {
  return new Date(`${value}T12:00:00`);
}

function formatDate(value, long = false) {
  if (!value) return 'Not available';
  const date = dateFromKey(value);
  return Number.isFinite(date.getTime()) ? (long ? LONG_DATE_FORMAT : DATE_FORMAT).format(date) : value;
}

function addDays(value, days) {
  const date = dateFromKey(value);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function availableStartDates(journey) {
  if (!journey?.today || !journey?.latest_start_date) return [];
  const first = journey.today > journey.delivered_date ? journey.today : journey.delivered_date;
  const dates = [];
  for (let cursor = first; cursor <= journey.latest_start_date && dates.length < 7; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function commandId(prefix) {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${id}`;
}

function programTheme(journey) {
  return PROGRAM_BY_KEY[journey?.program_key] || PROGRAM_BY_KEY.hydration;
}

function progressPercent(journey) {
  return Math.round((Number(journey?.completed_steps || 0) / Math.max(1, Number(journey?.total_steps || 12))) * 100);
}

function buildPreviewJourney(state = 'in_progress') {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = addDays(today, -1);
  const schedule = [];
  for (let day = 1; day <= 3; day += 1) {
    DAILY_PROGRAM_SCHEDULES.hydration.forEach((slot, index) => {
      const completed = day === 1 || (day === 2 && index === 0);
      schedule.push({
        step_id: `day-${day}-${slot.timeKey}`,
        day_number: day,
        date: addDays(startDate, day - 1),
        sequence: index + 1,
        time_key: slot.timeKey,
        time_label: slot.time,
        suggested_time: slot.suggestedTime,
        product_name: slot.product,
        completed_at: completed ? new Date().toISOString() : null,
        morning_shot_name: day === 2 && slot.timeKey === 'morning' ? 'GINGER Wellness Shot' : null,
      });
    });
  }
  const completedSteps = state === 'completed' ? 12 : state === 'ready' ? 0 : 5;
  if (state === 'completed') schedule.forEach((step) => { step.completed_at = new Date().toISOString(); });
  if (state === 'ready') schedule.forEach((step) => { step.completed_at = null; });
  return {
    id: 'preview-hydration',
    journey_key: 'preview-hydration',
    order_number: 'NV-PREVIEW',
    program_key: 'hydration',
    program_name: 'Hydration',
    program_image_url: PROGRAM_BY_KEY.hydration.image,
    status: state,
    delivered_date: addDays(today, -1),
    quality_target_date: addDays(today, 3),
    use_by_date: addDays(today, 5),
    use_by_source: 'production_batch',
    latest_start_date: addDays(today, 3),
    freshness_state: 'within_quality_target',
    start_date: state === 'ready' ? null : startDate,
    today,
    schedule: state === 'ready' ? [] : schedule,
    completed_steps: completedSteps,
    total_steps: 12,
    reminders_enabled: state === 'ready' ? false : true,
    reminder_delivery_available: true,
  };
}

function PageShell({ children }) {
  return <div className="min-h-screen bg-background pb-28">{children}</div>;
}

function LoadingState() {
  return (
    <PageShell>
      <div className="mx-auto max-w-3xl px-5 pt-16">
        <div className="h-72 animate-pulse rounded-[2rem] bg-muted" />
        <div className="mt-4 h-36 animate-pulse rounded-3xl bg-muted/70" />
      </div>
    </PageShell>
  );
}

function EmptyPrograms({ onBack }) {
  return (
    <PageShell>
      <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col items-center justify-center px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <Leaf className="h-7 w-7 text-primary" />
        </div>
        <h1 className="mt-5 font-heading text-2xl font-bold">Your program journeys will live here</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          After a paid NuVira program is delivered, its three-day guide becomes available here.
        </p>
        <button type="button" onClick={onBack} className="nuvira-gradient-button mt-6 h-11 rounded-xl px-6 text-sm font-bold">
          Explore Programs
        </button>
      </div>
    </PageShell>
  );
}

function FreshnessCard({ journey, compact = false }) {
  const exact = journey.use_by_source === 'production_batch';
  const ended = journey.freshness_state === 'ended' || journey.freshness_state === 'cannot_finish';
  return (
    <div className={`rounded-2xl border p-4 ${ended ? 'border-amber-400/40 bg-amber-400/10' : 'border-border/55 bg-card/80'}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Refrigerator className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-foreground">Freshness window</p>
            <span className="rounded-full border border-border/50 bg-background/70 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
              {exact ? 'Batch-linked' : 'Estimated'}
            </span>
          </div>
          <div className={`mt-3 grid ${compact ? 'grid-cols-2' : 'grid-cols-2'} gap-2`}>
            <div className="rounded-xl bg-secondary/45 px-3 py-2.5">
              <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Best enjoyed by</p>
              <p className="mt-0.5 text-sm font-bold">{formatDate(journey.quality_target_date)}</p>
            </div>
            <div className="rounded-xl bg-secondary/45 px-3 py-2.5">
              <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{exact ? 'Use by' : 'Estimated finish by'}</p>
              <p className="mt-0.5 text-sm font-bold">{formatDate(journey.use_by_date)}</p>
            </div>
          </div>
          {!compact && (
            <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
              NuVira juices typically have a 5–7 day refrigerated shelf life. The date printed on each bottle always takes priority over this guide.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgramList({ journeys, onOpen, onShop }) {
  return (
    <PageShell>
      <SEO title="My Program Journeys" description="Your interactive NuVira three-day program guides." noindex />
      <header className="border-b border-border/40 bg-background/90 px-5 pb-4 backdrop-blur-xl" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">NuVira Rituals</p>
        <h1 className="mt-1 font-heading text-3xl font-bold">My Program Journeys</h1>
        <p className="mt-1 text-xs text-muted-foreground">Delivered programs, paced beautifully from first bottle to final check-in.</p>
      </header>
      <main className="mx-auto max-w-4xl space-y-4 px-5 pt-5">
        {journeys.map((journey, index) => {
          const program = programTheme(journey);
          const progress = progressPercent(journey);
          return (
            <motion.button
              type="button"
              key={journey.journey_key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.06 }}
              onClick={() => onOpen(journey.id)}
              className="relative block w-full overflow-hidden rounded-[1.75rem] border text-left shadow-[0_18px_50px_rgba(13,32,25,0.14)]"
              style={{ borderColor: program.palette.border }}
            >
              <div className="relative h-52 overflow-hidden">
                <img src={journey.program_image_url || program.image} alt="" className={`h-full w-full object-cover ${program.imagePosition}`} />
                <div className="absolute inset-0" style={{ background: `linear-gradient(0deg, ${program.palette.ink}F2 0%, ${program.palette.ink}6A 54%, transparent 100%)` }} />
                <div className="absolute inset-x-0 bottom-0 p-5 text-white">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/65">{journey.status === 'ready' ? 'Ready when you are' : journey.status.replaceAll('_', ' ')}</p>
                      <h2 className="mt-1 font-heading text-3xl font-bold">{journey.program_name}</h2>
                      <p className="mt-1 text-xs text-white/70">Order {journey.order_number}</p>
                    </div>
                    <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-black/20 text-sm font-black backdrop-blur">
                      {progress}%
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-4" style={{ background: `linear-gradient(135deg, ${program.palette.soft}, white)` }}>
                <div className="h-1.5 overflow-hidden rounded-full bg-black/10">
                  <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: program.palette.primary }} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold" style={{ color: program.palette.ink }}>
                    {journey.status === 'ready' ? `Start by ${formatDate(journey.latest_start_date)}` : `${journey.completed_steps} of ${journey.total_steps} moments complete`}
                  </p>
                  <span className="text-xs font-black" style={{ color: program.palette.primary }}>Open journey →</span>
                </div>
              </div>
            </motion.button>
          );
        })}
        <button type="button" onClick={onShop} className="h-12 w-full rounded-2xl border border-border bg-card text-sm font-bold">
          Explore another program
        </button>
      </main>
    </PageShell>
  );
}

function StartPanel({ journey, selectedDate, setSelectedDate, remindersEnabled, setRemindersEnabled, onStart, pending }) {
  const dates = availableStartDates(journey);
  const unavailable = dates.length === 0;
  return (
    <section className="rounded-[1.75rem] border border-border/55 bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-primary" />
        <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Choose your beginning</p>
      </div>
      <h2 className="mt-2 font-heading text-2xl font-bold">When would you like to start?</h2>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Select a date that leaves enough time to complete all three days within the refrigerated freshness window.
      </p>
      {unavailable ? (
        <div className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4">
          <p className="text-sm font-bold">The full three-day window has passed.</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Do not use the app to extend a bottle’s printed date. Contact NuVira if you need help with this order.</p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {dates.map((date) => (
            <button
              type="button"
              key={date}
              onClick={() => setSelectedDate(date)}
              className={`rounded-2xl border px-3 py-3 text-left transition ${selectedDate === date ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-border bg-background'}`}
            >
              <p className="text-[9px] font-black uppercase tracking-wide opacity-70">{date === journey.today ? 'Today' : 'Start date'}</p>
              <p className="mt-0.5 text-sm font-bold">{formatDate(date, true)}</p>
              <p className="mt-1 text-[9px] opacity-65">Ends {formatDate(addDays(date, 2))}</p>
            </button>
          ))}
        </div>
      )}
      {!unavailable && journey.reminder_delivery_available && (
        <button
          type="button"
          onClick={() => setRemindersEnabled((value) => !value)}
          className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-border/55 bg-secondary/35 p-3 text-left"
        >
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${remindersEnabled ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground'}`}>
            <BellRing className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">Gentle program reminders</p>
            <p className="text-[10px] leading-relaxed text-muted-foreground">Optional, quiet-hours aware, and never more than one reminder for the same moment.</p>
          </div>
          <span className={`h-6 w-11 rounded-full p-1 transition ${remindersEnabled ? 'bg-primary' : 'bg-muted'}`}>
            <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${remindersEnabled ? 'translate-x-5' : ''}`} />
          </span>
        </button>
      )}
      <button
        type="button"
        disabled={unavailable || !selectedDate || pending}
        onClick={onStart}
        className="nuvira-gradient-button mt-4 h-12 w-full rounded-2xl text-sm font-black disabled:opacity-45"
      >
        {pending ? 'Preparing your journey…' : 'Begin My Program'}
      </button>
    </section>
  );
}

function SafetyWellnessCard() {
  return (
    <details className="group overflow-hidden rounded-2xl border border-border/55 bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10"><ShieldCheck className="h-4 w-4 text-primary" /></div>
          <div>
            <p className="text-sm font-bold">Safety & wellness guidance</p>
            <p className="text-[10px] text-muted-foreground">Storage, freshness, labels, and personal considerations</p>
          </div>
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-border/45 px-4 py-4 text-xs leading-relaxed text-muted-foreground">
        <div className="flex gap-2.5"><Refrigerator className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>Keep every bottle refrigerated at 40°F or below and refrigerate promptly after delivery.</p></div>
        <div className="flex gap-2.5"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>Discard perishable juice left unrefrigerated for more than 2 hours, or more than 1 hour when the temperature is above 90°F.</p></div>
        <div className="flex gap-2.5"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>Check the seal, appearance, aroma, printed date, ingredients, allergens, and any processing warning on each bottle. Do not drink a swollen, leaking, damaged, or questionable bottle.</p></div>
        <div className="flex gap-2.5"><SunMedium className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>The bottle label is authoritative. If it carries an unpasteurized-juice warning, follow it; people who are pregnant, very young, older, or immunocompromised should seek qualified guidance before consuming untreated juice.</p></div>
        <div className="rounded-xl bg-secondary/40 p-3 text-[10px]">This is a flexible food-and-beverage routine, not medical advice, and it does not promise a health outcome. Ask a qualified clinician about personal health conditions, medications, allergies, or dietary needs.</div>
      </div>
    </details>
  );
}

function DaySchedule({ day, journey, onToggle, pendingStep }) {
  const steps = journey.schedule.filter((step) => Number(step.day_number) === day);
  if (!steps.length) return null;
  const completeCount = steps.filter((step) => step.completed_at).length;
  const futureDay = steps[0].date > journey.today;
  return (
    <section className="overflow-hidden rounded-[1.5rem] border border-border/55 bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border/40 p-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Day {day}</p>
          <h3 className="mt-0.5 font-heading text-lg font-bold">{formatDate(steps[0].date, true)}</h3>
        </div>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold text-muted-foreground">{completeCount}/4 complete</span>
      </div>
      <div className="divide-y divide-border/35">
        {steps.map((step) => {
          const done = Boolean(step.completed_at);
          const disabled = (futureDay && !done) || journey.freshness_state === 'ended' || pendingStep === step.step_id;
          return (
            <button
              type="button"
              key={step.step_id}
              disabled={disabled}
              onClick={() => onToggle(step, !done)}
              className="flex w-full items-center gap-3 p-4 text-left transition active:bg-secondary/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${done ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary/45 text-muted-foreground'}`}>
                {done ? <Check className="h-4 w-4" /> : <Droplets className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">{step.time_label}</span>
                  <span className="text-[10px] font-semibold text-muted-foreground">{step.suggested_time}</span>
                </span>
                {step.morning_shot_name && <span className="mt-1 block text-[10px] font-semibold text-primary">{step.morning_shot_name} first · then</span>}
                <span className={`mt-0.5 block text-sm font-bold ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{step.product_name}</span>
              </span>
              <span className="text-[10px] font-bold text-muted-foreground">{done ? 'Undo' : futureDay ? 'Upcoming' : 'Mark enjoyed'}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function JourneyDetail({ journey, onBack, onStart, onToggle, onSetReminders, pending, pendingStep }) {
  const program = programTheme(journey);
  const progress = progressPercent(journey);
  const [selectedDate, setSelectedDate] = React.useState(availableStartDates(journey)[0] || '');
  const [remindersEnabled, setRemindersEnabled] = React.useState(journey.reminders_enabled === true);
  const ready = journey.status === 'ready' || (journey.is_virtual && journey.status !== 'freshness_window_ended');
  const completed = journey.status === 'completed';

  return (
    <PageShell>
      <SEO title={`${journey.program_name} Program Journey`} description="Your private NuVira program guide and progress." noindex />
      <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between px-4 pb-3 md:left-60" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <button type="button" onClick={onBack} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/25 text-white backdrop-blur-xl">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="rounded-full border border-white/20 bg-black/25 px-3 py-2 text-[10px] font-black uppercase tracking-[0.15em] text-white backdrop-blur-xl">Private journey</span>
      </header>

      <section className="relative min-h-[29rem] overflow-hidden">
        <img src={journey.program_image_url || program.image} alt={`${journey.program_name} program`} className={`absolute inset-0 h-full w-full object-cover ${program.imagePosition}`} />
        <div className="absolute inset-0" style={{ background: `linear-gradient(0deg, ${program.palette.ink} 0%, ${program.palette.ink}D8 38%, ${program.palette.ink}3A 72%, transparent 100%)` }} />
        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-4xl p-5 pb-7 text-white md:p-8">
          <div className="flex items-end justify-between gap-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/65"><Sparkles className="h-3.5 w-3.5" /> {ready ? 'Ready to begin' : completed ? 'Journey complete' : 'Your three-day ritual'}</div>
              <h1 className="mt-3 font-heading text-5xl font-bold leading-[0.9] md:text-6xl">{journey.program_name}</h1>
              <p className="mt-3 text-sm font-medium text-white/75">{program.tagline}</p>
            </div>
            <div className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(${program.palette.glow} ${progress * 3.6}deg, rgba(255,255,255,.16) 0deg)` }}>
              <div className="flex h-[4.15rem] w-[4.15rem] flex-col items-center justify-center rounded-full bg-black/45 backdrop-blur">
                <span className="text-lg font-black">{progress}%</span>
                <span className="text-[8px] font-bold uppercase tracking-wide text-white/60">complete</span>
              </div>
            </div>
          </div>
          {!ready && (
            <div className="mt-5 flex items-center gap-3 rounded-2xl border border-white/15 bg-black/20 p-3 backdrop-blur-sm">
              <CircleCheckBig className="h-5 w-5" style={{ color: program.palette.glow }} />
              <div><p className="text-sm font-bold">{journey.completed_steps} of {journey.total_steps} moments enjoyed</p><p className="text-[10px] text-white/60">Small check-ins, no pressure. Your schedule remains flexible.</p></div>
            </div>
          )}
        </div>
      </section>

      <main className="mx-auto max-w-4xl space-y-4 px-4 pt-4 md:px-6">
        <FreshnessCard journey={journey} />

        {ready && (
          <StartPanel
            journey={journey}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            remindersEnabled={remindersEnabled}
            setRemindersEnabled={setRemindersEnabled}
            onStart={() => onStart(selectedDate, remindersEnabled)}
            pending={pending}
          />
        )}

        {!ready && (
          <>
            {completed && (
              <section className="overflow-hidden rounded-[1.75rem] border p-5 text-center" style={{ borderColor: program.palette.border, background: `linear-gradient(145deg, ${program.palette.soft}, white)` }}>
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full text-white" style={{ backgroundColor: program.palette.primary }}><CircleCheckBig className="h-6 w-6" /></div>
                <p className="mt-4 text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: program.palette.primary }}>Three days complete</p>
                <h2 className="mt-1 font-heading text-2xl font-bold" style={{ color: program.palette.ink }}>A ritual worth celebrating.</h2>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Thank you for making NuVira part of your routine. Your completed journey stays here as a private record.</p>
              </section>
            )}
            {[1, 2, 3].map((day) => <DaySchedule key={day} day={day} journey={journey} onToggle={onToggle} pendingStep={pendingStep} />)}
            {journey.reminder_delivery_available && <button
              type="button"
              onClick={() => onSetReminders(!journey.reminders_enabled)}
              disabled={pending || completed}
              className="flex w-full items-center gap-3 rounded-2xl border border-border/55 bg-card p-4 text-left disabled:opacity-55"
            >
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${journey.reminders_enabled ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}><BellRing className="h-4 w-4" /></div>
              <div className="flex-1"><p className="text-sm font-bold">Gentle reminders</p><p className="text-[10px] text-muted-foreground">{journey.reminders_enabled ? 'On for this journey' : 'Off for this journey'}</p></div>
              <span className="text-[10px] font-black uppercase tracking-wide text-primary">{journey.reminders_enabled ? 'Turn off' : 'Turn on'}</span>
            </button>}
          </>
        )}

        <SafetyWellnessCard />
        <p className="px-3 pb-4 text-center text-[9px] leading-relaxed text-muted-foreground">Suggested times are optional. Never use a completed check-in as evidence that a bottle remained refrigerated or safe.</p>
      </main>
    </PageShell>
  );
}

export default function ProgramJourney({ previewMode = false }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingStep, setPendingStep] = React.useState(null);
  const previewState = previewMode ? new URLSearchParams(window.location.search).get('state') || 'in_progress' : 'in_progress';
  const previewJourney = React.useMemo(() => buildPreviewJourney(previewState), [previewState]);

  const listQuery = useQuery({
    queryKey: ['program-journeys'],
    queryFn: async () => (await invokeCustomerGateway('manageProgramJourney', { action: 'list' })).data,
    enabled: !previewMode,
    staleTime: 60 * 1000,
  });

  const detailQuery = useQuery({
    queryKey: ['program-journey', id],
    queryFn: async () => (await invokeCustomerGateway('manageProgramJourney', { action: 'get', journey_id: id })).data?.journey,
    enabled: !previewMode && Boolean(id),
    staleTime: 30 * 1000,
  });

  const mutation = useMutation({
    mutationFn: async (payload) => (await invokeCustomerGateway('manageProgramJourney', payload)).data,
    onSuccess: (data) => {
      queryClient.setQueryData(['program-journey', id], data?.journey);
      queryClient.invalidateQueries({ queryKey: ['program-journeys'] });
    },
    onError: (error) => {
      const code = error?.data?.error || error?.message;
      const messages = {
        start_date_outside_freshness_window: 'Choose a start date that keeps all three days inside the freshness window.',
        freshness_window_ended: 'That bottle’s freshness window has ended. Follow its printed date and contact NuVira if you need help.',
        future_program_step_cannot_be_completed: 'That moment becomes available on its scheduled day.',
      };
      toast.error(messages[code] || 'We could not update your journey. Please try again.');
    },
    onSettled: () => setPendingStep(null),
  });

  if (previewMode) {
    return <JourneyDetail journey={previewJourney} onBack={() => navigate('/')} onStart={() => {}} onToggle={() => {}} onSetReminders={() => {}} pending={false} pendingStep={null} />;
  }
  if (listQuery.isLoading || (id && detailQuery.isLoading)) return <LoadingState />;
  if (listQuery.isError || (id && detailQuery.isError)) {
    return (
      <PageShell><div className="mx-auto max-w-sm px-6 pt-24 text-center"><h1 className="font-heading text-2xl font-bold">We could not load your journey</h1><p className="mt-2 text-sm text-muted-foreground">Your progress is still protected. Check your connection and try again.</p><button onClick={() => { listQuery.refetch(); detailQuery.refetch(); }} className="nuvira-gradient-button mt-5 h-11 rounded-xl px-6 text-sm font-bold">Try again</button></div></PageShell>
    );
  }

  if (!id) {
    const journeys = listQuery.data?.journeys || [];
    if (!journeys.length) return <EmptyPrograms onBack={() => navigate('/#programs')} />;
    return <ProgramList journeys={journeys} onOpen={(journeyId) => navigate(`/account/programs/${encodeURIComponent(journeyId)}`)} onShop={() => navigate('/#programs')} />;
  }

  const journey = detailQuery.data;
  if (!journey) return <EmptyPrograms onBack={() => navigate('/account/programs')} />;
  return (
    <JourneyDetail
      journey={journey}
      onBack={() => navigate('/account/programs')}
      pending={mutation.isPending}
      pendingStep={pendingStep}
      onStart={(startDate, remindersEnabled) => mutation.mutate({ action: 'start', journey_id: id, start_date: startDate, reminders_enabled: remindersEnabled, command_id: commandId('start') })}
      onToggle={(step, completed) => {
        setPendingStep(step.step_id);
        mutation.mutate({ action: 'toggle_step', journey_id: id, step_id: step.step_id, completed, command_id: commandId('step') });
      }}
      onSetReminders={(enabled) => mutation.mutate({ action: 'set_reminders', journey_id: id, reminders_enabled: enabled, command_id: commandId('reminders') })}
    />
  );
}
