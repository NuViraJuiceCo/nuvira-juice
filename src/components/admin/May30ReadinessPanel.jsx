import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';

const statusConfig = {
  ready: {
    label: 'Usable now',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100',
    iconClassName: 'text-emerald-700 dark:text-emerald-300',
    icon: CheckCircle2,
  },
  controlled: {
    label: 'Live workflow',
    className: 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-100',
    iconClassName: 'text-sky-700 dark:text-sky-300',
    icon: ShieldCheck,
  },
  fallback: {
    label: 'Live source',
    className: 'border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-100',
    iconClassName: 'text-violet-700 dark:text-violet-300',
    icon: ShieldCheck,
  },
  watch: {
    label: 'Watch',
    className: 'border-cyan-200 bg-cyan-50 text-cyan-950 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-100',
    iconClassName: 'text-cyan-700 dark:text-cyan-300',
    icon: AlertTriangle,
  },
  frozen: {
    label: 'Protected safeguard',
    className: 'border-slate-200 bg-slate-50 text-slate-950 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-100',
    iconClassName: 'text-slate-700 dark:text-slate-300',
    icon: ShieldCheck,
  },
};

function ReadinessItem({ item }) {
  const config = statusConfig[item.status] || statusConfig.ready;
  const Icon = config.icon;

  return (
    <div className={`rounded-lg border p-3 ${config.className}`}>
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${config.iconClassName}`} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-black uppercase tracking-wider">{item.label}</p>
            <span className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-black">
              {item.statusLabel || config.label}
            </span>
          </div>
          {item.detail && <p className="mt-1 text-xs font-medium leading-relaxed opacity-85">{item.detail}</p>}
        </div>
      </div>
    </div>
  );
}

function ActionLink({ action }) {
  const className = 'inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-slate-950 px-3 text-xs font-black text-white transition-colors hover:border-emerald-500 hover:bg-slate-900';
  if (action.to) {
    return (
      <Link to={action.to} className={className}>
        {action.label}
      </Link>
    );
  }

  return (
    <a href={action.href} className={className}>
      {action.label}
    </a>
  );
}

export default function May30ReadinessPanel({
  title = 'Operational readiness',
  description,
  items = [],
  actions = [],
  footnote,
}) {
  if (!items.length) return null;

  return (
    <section className="rounded-xl border border-slate-300 bg-white p-3 shadow-sm dark:border-border/70 dark:bg-card/95">
      <div className="mb-3">
        <p className="text-sm font-black text-slate-950 dark:text-foreground">{title}</p>
        {description && <p className="mt-0.5 text-xs font-medium text-slate-600 dark:text-muted-foreground">{description}</p>}
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {items.map(item => (
          <ReadinessItem key={item.label} item={item} />
        ))}
      </div>
      {actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map(action => (
            <ActionLink key={action.label} action={action} />
          ))}
        </div>
      )}
      {footnote && <p className="mt-3 text-[10px] font-semibold text-slate-500 dark:text-muted-foreground">{footnote}</p>}
    </section>
  );
}
