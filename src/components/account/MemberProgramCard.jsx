import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Play, RefreshCw, Sparkles } from 'lucide-react';
import { PROGRAM_BY_KEY } from '@/lib/program-catalog';

function LoadingCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card p-4 shadow-sm" aria-label="Loading program status">
      <div className="h-3 w-28 animate-pulse rounded bg-muted" />
      <div className="mt-3 h-7 w-48 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-3 w-full max-w-sm animate-pulse rounded bg-muted" />
      <div className="mt-4 h-10 w-full animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

function ErrorCard({ onRetry }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-destructive/25 bg-card p-4 shadow-sm sm:p-5" role="status">
      <div className="flex items-start gap-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <RefreshCw className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-lg font-bold text-foreground">Program status unavailable</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-foreground/60 dark:text-muted-foreground/85">
            Your program information is safe. Try loading it again.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background/70 px-4 py-2.5 text-sm font-bold text-foreground active:scale-[0.985] transition-transform"
      >
        <RefreshCw className="h-4 w-4" />
        Try Again
      </button>
    </div>
  );
}

function ActiveJourneyCard({ journey }) {
  const program = PROGRAM_BY_KEY[journey.program_key] || PROGRAM_BY_KEY.hydration;
  const totalSteps = Math.max(1, Number(journey.total_steps || Number(journey.program_days || 3) * 4));
  const completedSteps = Math.min(totalSteps, Math.max(0, Number(journey.completed_steps || 0)));
  const progress = Math.round((completedSteps / totalSteps) * 100);
  const isReady = journey.status === 'ready';

  return (
    <div
      className="relative overflow-hidden rounded-2xl border shadow-[0_14px_36px_rgba(14,35,27,0.14)]"
      style={{
        borderColor: program.palette.border,
        background: `linear-gradient(135deg, ${program.palette.ink}, ${program.palette.primary})`,
      }}
    >
      <img
        src={journey.program_image_url || program.image}
        alt=""
        className={`absolute inset-0 h-full w-full object-cover opacity-20 ${program.imagePosition}`}
      />
      <div className="relative p-4 text-white sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.16em] text-white/75">
            {isReady ? <Sparkles className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {isReady ? 'Delivered and ready' : 'Program in progress'}
          </p>
          <span className="rounded-full border border-white/20 bg-black/10 px-2 py-1 text-[10px] font-black">
            {progress}%
          </span>
        </div>

        <div className="mt-3">
          <p className="font-heading text-2xl font-bold leading-tight">{journey.program_name || program.name}</p>
          <p className="mt-1 text-[11px] text-white/75">
            {isReady ? 'Choose your start date when you are ready.' : `${completedSteps} of ${totalSteps} daily moments complete.`}
          </p>
        </div>

        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full transition-[width]" style={{ width: `${progress}%`, backgroundColor: program.palette.glow }} />
        </div>

        <Link
          to={`/account/programs/${encodeURIComponent(journey.id)}`}
          className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-900 active:scale-[0.985] transition-transform"
        >
          {isReady ? <Play className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
          {isReady ? 'Begin My Program' : 'Continue My Program'}
        </Link>
      </div>
    </div>
  );
}

function ProgramDiscoveryCard({ completedCount }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-primary/25 bg-card p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3.5">
        <div className="nuvira-icon-badge flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-primary">Your next fresh routine</p>
          <h2 className="mt-1 font-heading text-xl font-bold text-foreground">Find your NuVira program</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-foreground/60 dark:text-muted-foreground/85">
            Choose a structured two- or three-day program and your private guide will appear here after delivery.
          </p>
        </div>
      </div>

      <div className={`mt-4 grid gap-2 ${completedCount > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <Link
          to="/#programs"
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-nuvira-gradient px-2.5 py-2.5 text-xs font-bold text-white active:scale-[0.985] transition-transform"
        >
          <span className="whitespace-nowrap">Explore Programs</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
        {completedCount > 0 && (
          <Link
            to="/account/programs"
            className="flex min-h-11 items-center justify-center rounded-xl border border-border bg-background/70 px-3 py-2.5 text-center text-xs font-bold text-foreground active:scale-[0.985] transition-transform"
          >
            Past Journeys ({completedCount})
          </Link>
        )}
      </div>
    </div>
  );
}

export default function MemberProgramCard({ journey, journeys = [], isLoading = false, isError = false, onRetry }) {
  if (isLoading) return <LoadingCard />;
  if (isError) return <ErrorCard onRetry={onRetry} />;
  if (journey) return <ActiveJourneyCard journey={journey} />;

  const completedCount = journeys.filter((item) => item.status === 'completed').length;
  return <ProgramDiscoveryCard completedCount={completedCount} />;
}
