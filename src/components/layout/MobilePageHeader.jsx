/**
 * MobilePageHeader — G40D safe-area-aware page header for customer app pages.
 *
 * Provides a sticky header that respects iOS safe-area-inset-top so page
 * titles and back buttons never sit under the status bar / notch on mobile.
 *
 * Usage:
 *   <MobilePageHeader title="Events & Community" backTo="/account" />
 *   <MobilePageHeader title="Track Your Order" onBack={() => navigate(-1)} />
 *   <MobilePageHeader title="Rewards" /> // no back button
 *
 * Props:
 *   title      — string, page heading text
 *   backTo     — Link href (uses <Link>)
 *   onBack     — function (uses <button onClick>)
 *   actions    — ReactNode, optional right-side slot
 *   className  — optional extra classes for the outer wrapper
 *   dark       — bool, use white text (for colored/gradient headers)
 *   style      — optional extra inline style for the outer wrapper
 *
 * The component does NOT add a bottom border by default; pass className="border-b border-border/40" if needed.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/**
 * Returns the CSS value used for safe top padding.
 * Minimum 16px so it looks right on desktop/web too.
 * On iOS notch devices env(safe-area-inset-top) ≈ 44–59px, which takes over.
 */
export const SAFE_TOP_PADDING = 'max(1rem, env(safe-area-inset-top))';

/**
 * A full sticky page header with safe-area handling.
 */
export default function MobilePageHeader({
  title,
  backTo,
  onBack,
  actions,
  className = '',
  dark = false,
  style = {},
}) {
  const hasBack = backTo || onBack;

  const BackButton = () => {
    const btnClass = `
      w-11 h-11 flex items-center justify-center rounded-full
      ${dark ? 'bg-white/20 hover:bg-white/30' : 'hover:bg-muted'}
      transition-colors shrink-0 -ml-1
    `;
    const iconClass = `w-4 h-4 ${dark ? 'text-white' : ''}`;

    if (backTo) {
      return (
        <Link to={backTo} aria-label="Go back" className={btnClass.trim()}>
          <ArrowLeft className={iconClass} />
        </Link>
      );
    }
    if (onBack) {
      return (
        <button type="button" onClick={onBack} aria-label="Go back" className={btnClass.trim()}>
          <ArrowLeft className={iconClass} />
        </button>
      );
    }
    return null;
  };

  return (
    <div
      className={`sticky top-0 z-10 bg-background/95 backdrop-blur-xl border-b border-border/40 ${className}`}
      style={{
        paddingTop: SAFE_TOP_PADDING,
        ...style,
      }}
    >
      <div className="flex items-center gap-2 px-4 pb-3">
        {hasBack && <BackButton />}
        <span
          className={`font-heading text-base font-semibold flex-1 min-w-0 truncate ${dark ? 'text-white' : ''}`}
        >
          {title}
        </span>
        {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * Inline (non-sticky) safe-area top spacer for pages whose first element
 * is NOT a sticky header but still needs top padding on iOS.
 *
 * Usage:
 *   <SafeAreaTop />                 — adds max(1rem, env(safe-area-inset-top)) padding-top
 *   <SafeAreaTop extra="2rem" />    — adds max(2rem, env(safe-area-inset-top))
 */
export function SafeAreaTop({ extra = '1rem', className = '', style = {} }) {
  return (
    <div
      className={className}
      style={{
        paddingTop: `max(${extra}, env(safe-area-inset-top))`,
        ...style,
      }}
    />
  );
}