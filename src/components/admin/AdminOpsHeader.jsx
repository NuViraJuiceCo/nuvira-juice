import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AdminStatusPill } from './AdminStatusPill';

export default function AdminOpsHeader({
  title,
  subtitle,
  badge,
  badgeTone = 'hub',
  backTo = '/admin/operations',
  onBack,
  actions,
}) {
  const BackControl = onBack ? 'button' : Link;
  const backProps = onBack ? { type: 'button', onClick: onBack } : { to: backTo };

  return (
    <div className="border-b border-emerald-500/35 nuvira-admin-header px-4 py-3 text-white shadow-sm shadow-slate-950/20">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full min-w-0 items-start gap-3 sm:items-center">
          <BackControl
            {...backProps}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-emerald-300 transition-colors hover:border-emerald-400 hover:text-emerald-200"
          >
            <ArrowLeft className="h-4 w-4" />
          </BackControl>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="max-w-full break-words text-lg font-bold leading-tight text-white sm:text-xl">{title}</h1>
              {badge && <AdminStatusPill label={badge} tone={badgeTone} />}
            </div>
            {subtitle && <p className="mt-0.5 text-xs font-medium text-slate-300">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="w-full shrink-0 text-emerald-300 sm:w-auto [&_svg]:text-emerald-300">{actions}</div>}
      </div>
    </div>
  );
}
