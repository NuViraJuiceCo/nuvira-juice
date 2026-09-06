import React, { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AdminStatusPill } from './AdminStatusPill';
import { installAdminSwipeBack } from '@/lib/adminSwipeBack';

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
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!location.pathname.startsWith('/admin')) return undefined;
    const editingSelector = 'input, textarea, select, [contenteditable="true"], [role="slider"], [data-no-swipe-back]';
    const canNavigate = () => window.matchMedia('(max-width: 767px) and (pointer: coarse)').matches
      && !document.activeElement?.matches(editingSelector)
      && !document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], dialog[open], [role="menu"][data-state="open"], [role="listbox"][data-state="open"], [data-admin-navigation-blocked="true"]');
    return installAdminSwipeBack(document, {
      canStart: target => canNavigate() && !target?.closest?.(editingSelector),
      canNavigate,
      onBack: () => onBack ? onBack() : navigate(backTo),
    });
  }, [backTo, location.pathname, navigate, onBack]);

  const BackControl = onBack ? 'button' : Link;
  const backProps = onBack ? { type: 'button', onClick: onBack } : { to: backTo };
  const mobileHeading = mobileTitle || title;
  const mobileDescription = mobileSubtitle || subtitle;

  return (
    <header
      className={`nuvira-admin-header border-b border-emerald-500/35 px-3 pb-3 text-white shadow-sm shadow-slate-950/20 md:px-4 md:pb-3 ${compactMobile ? 'md:pt-3' : ''}`}
      data-admin-header-layout="responsive"
    >
      <div className="mx-auto grid w-full max-w-[1440px] grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-3 md:flex md:justify-between md:gap-3">
        <BackControl
          {...backProps}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-slate-950/55 text-emerald-200 shadow-sm shadow-slate-950/20 transition-colors hover:border-emerald-300/70 hover:bg-slate-950/70 hover:text-white md:h-9 md:w-9 md:rounded-lg"
          aria-label="Back to admin operations"
        >
          <ArrowLeft className="h-4 w-4" />
        </BackControl>

        <div className="min-w-0 py-0.5 md:flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="line-clamp-2 min-w-0 text-[17px] font-bold leading-5 text-white md:hidden">
              {mobileHeading}
            </h1>
            <h1 className="hidden max-w-full break-words text-lg font-bold leading-tight text-white md:block sm:text-xl">
              {title}
            </h1>
            {badge && (
              <span className="hidden md:inline-flex">
                <AdminStatusPill label={badge} tone={badgeTone} />
              </span>
            )}
          </div>
          {mobileDescription && (
            <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-4 text-emerald-50/75 md:hidden">
              {mobileDescription}
            </p>
          )}
          {subtitle && (
            <p className="mt-0.5 hidden text-xs font-medium text-slate-300 md:block">
              {subtitle}
            </p>
          )}
        </div>

        <div className="flex min-h-11 shrink-0 items-center justify-end gap-2 text-emerald-200 [&_svg]:text-emerald-200 md:min-h-0">
          {badge && !actions && (
            <span className="max-w-[7.25rem] overflow-hidden max-[359px]:hidden md:hidden">
              <AdminStatusPill label={badge} tone={badgeTone} />
            </span>
          )}
          {actions && (
            <div className="flex min-h-11 min-w-11 items-center justify-center md:min-h-0 md:min-w-0">
              {actions}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
