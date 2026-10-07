import React from "react";
import { Link } from 'react-router-dom';
import useDesktopStorefront from '@/hooks/useDesktopStorefront';
import { BRAND_IMAGES } from '@/lib/brandImages';

export default function AuthLayout({ icon: Icon, title, subtitle, footer, children }) {
  const desktop = useDesktopStorefront();
  return (
    <div data-desktop-auth={desktop ? 'true' : undefined} className="min-h-screen flex items-center justify-center bg-background px-4">
      {desktop && <Link className="nv-auth-brand" to="/" aria-label="NuVira home"><img src={BRAND_IMAGES.wordmark} alt="NuVira Juice Company" /></Link>}
      <div className="nv-auth-content w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
            <Icon className="w-7 h-7 text-primary-foreground" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-2">{subtitle}</p>}
        </div>
        <div className="nv-auth-form bg-card rounded-2xl shadow-sm border border-border p-8">
          {children}
        </div>
        {footer && (
          <p className="text-center text-sm text-muted-foreground mt-6">{footer}</p>
        )}
      </div>
    </div>
  );
}
