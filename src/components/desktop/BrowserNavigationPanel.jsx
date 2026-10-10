import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUpRight, Menu } from 'lucide-react';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { isAdminUser } from '@/lib/admin-access';

export default function BrowserNavigationPanel({ navigation, user, navigationIntent }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const destination = useRef(null);

  useEffect(() => { setOpen(false); }, [location.key]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 600px)');
    const closeOnWideScreen = () => { if (!media.matches) setOpen(false); };
    media.addEventListener('change', closeOnWideScreen);
    return () => media.removeEventListener('change', closeOnWideScreen);
  }, []);

  const close = event => {
    const href = event.currentTarget.getAttribute('href');
    destination.current = {
      changed: href !== `${location.pathname}${location.search || ''}${location.hash}`,
      anchor: href.startsWith('/#') ? href.slice(2) : null,
    };
    setOpen(false);
  };
  const accountLinks = [
    { to: '/account', label: user ? 'My Account' : 'Sign In / Create Account' },
    ...(user ? [
      { to: '/account/orders', label: 'Orders' },
      { to: '/account/programs', label: 'My Program' },
      { to: '/notifications', label: 'Notifications' },
    ] : []),
    ...(isAdminUser(user) ? [{ to: '/admin/operations', label: 'Admin Operations' }] : []),
  ];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button type="button" className="nv-brand-icon nv-brand-compact-menu" aria-label="Website navigation" title="Menu">
          <Menu size={22} aria-hidden="true" />
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="nv-mobile-navigation-sheet" aria-describedby={undefined}
        onCloseAutoFocus={event => {
          // Restoring trigger focus after navigation would undo the destination's anchor scroll.
          const selected = destination.current;
          destination.current = null;
          if (selected?.changed || selected?.anchor) {
            event.preventDefault();
            if (selected.anchor) document.getElementById(selected.anchor)?.scrollIntoView({ block: 'start' });
            return;
          }
          // A resize can hide the menu trigger before Radix restores focus.
          if (!window.matchMedia('(max-width: 600px)').matches) {
            event.preventDefault();
            document.querySelector('.nv-brand-logo')?.focus();
          }
        }}>
        <div className="nv-mobile-navigation-heading">
          <p>NuVira Juice Company</p>
          <SheetTitle>Explore NuVira</SheetTitle>
        </div>
        <div className="nv-mobile-navigation-scroll" onFocusCapture={event => {
          // Keep keyboard focus visible when the dialog wraps to its last link.
          event.target.closest('a')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }}>
          <nav aria-label="Mobile main navigation" className="nv-mobile-navigation-primary">
            {navigation.map(({ to, label, matches }) => (
              <SheetClose asChild key={to}>
                <Link to={to} onClick={close} {...navigationIntent(to, Boolean(user?.email))}
                  aria-current={(to === '/#programs' ? location.hash === '#programs' || matches(location.pathname) : matches(location.pathname)) ? 'page' : undefined}>
                  <span>{label}</span><ArrowUpRight size={20} aria-hidden="true" />
                </Link>
              </SheetClose>
            ))}
          </nav>
          <nav aria-label="Mobile account navigation" className="nv-mobile-navigation-secondary">
            <p>Your NuVira</p>
            {accountLinks.map(({ to, label }) => <SheetClose asChild key={to}><Link to={to} onClick={close} {...navigationIntent(to, Boolean(user?.email))}>{label}<ArrowUpRight size={17} aria-hidden="true" /></Link></SheetClose>)}
          </nav>
          <nav aria-label="Mobile customer care" className="nv-mobile-navigation-secondary">
            <p>Here to Help</p>
            <SheetClose asChild><Link to="/delivery.html" onClick={close}>Delivery Details<ArrowUpRight size={17} aria-hidden="true" /></Link></SheetClose>
            <SheetClose asChild><Link to="/support" onClick={close} {...navigationIntent('/support')}>Help & Support<ArrowUpRight size={17} aria-hidden="true" /></Link></SheetClose>
          </nav>
        </div>
      </SheetContent>
    </Sheet>
  );
}
