import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';

const statusConfig = {
  ready: {
    label: 'Usable now',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    iconClassName: 'text-emerald-700',
    icon: CheckCircle2,
  },
  controlled: {
    label: 'Controlled action',
    className: 'border-sky-200 bg-sky-50 text-sky-950',
    iconClassName: 'text-sky-700',
    icon: ShieldCheck,
  },
  fallback: {
    label: 'Hub-backed',
    className: 'border-violet-200 bg-violet-50 text-violet-950',
    iconClassName: 'text-violet-700',
    icon: ShieldCheck,
  },
  watch: {
    label: 'Watch',
    className: 'border-amber-200 bg-amber-50 text-amber-950',
    iconClassName: 'text-amber-700',
    icon: AlertTriangle,
  },
  frozen: {
    label: 'Frozen',
    className: 'border-slate-200 bg-slate-50 text-slate-950',
    iconClassName: 'text-slate-700',
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
  title = 'May 30 operational readiness',
  description,
  items = [],
  actions = [],
  footnote,
}) {
  if (!items.length) return null;

  return (
    <section className="rounded-xl border border-slate-300 bg-white p-3 shadow-sm">
      <div className="mb-3">
        <p className="text-sm font-black text-slate-950">{title}</p>
        {description && <p className="mt-0.5 text-xs font-medium text-slate-600">{description}</p>}
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
      {footnote && <p className="mt-3 text-[10px] font-semibold text-slate-500">{footnote}</p>}
    </section>
  );
}
