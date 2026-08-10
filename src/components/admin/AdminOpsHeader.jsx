import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AdminStatusPill } from './AdminStatusPill';

export default function AdminOpsHeader({
  title,
  subtitle,
  mobileTitle,
  mobileSubtitle,
  compactMobile = false,
  badge,
  badgeTone = 'hub',
  backTo = '/admin/operations',
  onBack,
  actions,
}) {
  const BackControl = onBack ? 'button' : Link;
  const backProps = onBack ? { type: 'button', onClick: onBack } : { to: backTo };

  return (
    <div className={`border-b border-emerald-500/35 nuvira-admin-header px-4 text-white shadow-sm shadow-slate-950/20 ${compactMobile ? 'py-2.5 md:py-3' : 'py-3'}`}>
      <div className={`mx-auto flex w-full max-w-[1440px] flex-col sm:flex-row sm:items-center sm:justify-between ${compactMobile ? 'gap-2 md:gap-3' : 'gap-3'}`}>
        <div className="flex w-full min-w-0 items-start gap-3 sm:items-center">
          <BackControl
            {...backProps}
            className={`flex shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-emerald-300 transition-colors hover:border-emerald-400 hover:text-emerald-200 ${compactMobile ? 'h-8 w-8 md:h-9 md:w-9' : 'h-9 w-9'}`}
            aria-label="Back to admin operations"
          >
            <ArrowLeft className="h-4 w-4" />
          </BackControl>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {mobileTitle ? (
                <>
                  <h1 className="max-w-full break-words text-lg font-bold leading-tight text-white md:hidden">{mobileTitle}</h1>
                  <h1 className="hidden max-w-full break-words text-lg font-bold leading-tight text-white md:block sm:text-xl">{title}</h1>
                </>
              ) : (
                <h1 className="max-w-full break-words text-lg font-bold leading-tight text-white sm:text-xl">{title}</h1>
              )}
              {badge && <AdminStatusPill label={badge} tone={badgeTone} />}
            </div>
            {mobileSubtitle ? (
              <>
                <p className="mt-0.5 truncate text-[11px] font-medium text-slate-300 md:hidden">{mobileSubtitle}</p>
                {subtitle && <p className="mt-0.5 hidden text-xs font-medium text-slate-300 md:block">{subtitle}</p>}
              </>
            ) : subtitle ? (
              <p className="mt-0.5 text-xs font-medium text-slate-300">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {actions && <div className="w-full shrink-0 text-emerald-300 sm:w-auto [&_svg]:text-emerald-300">{actions}</div>}
      </div>
    </div>
  );
}
