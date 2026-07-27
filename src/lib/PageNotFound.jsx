import { Link, useLocation } from 'react-router-dom';
import SEO from '@/components/SEO';

const suggestedLinks = [
  { to: '/', label: 'Home' },
  { to: '/shop', label: 'Shop' },
  { to: '/support', label: 'Support' },
  { to: '/admin/operations', label: 'Admin Console' },
];

export default function PageNotFound() {
  const location = useLocation();
  const pageName = location.pathname || '/';

  return (
    <div className="min-h-screen bg-background px-6 py-10 text-foreground">
      <SEO
        title="Page Not Found"
        description="This NuVira page could not be found."
        noindex
      />
      <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center text-center">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">Page not found</p>
        <h1 className="mt-3 font-heading text-4xl font-bold">This page is not available</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The link may be old, mistyped, or moved. Choose a NuVira destination below to keep going.
        </p>
        <div className="mt-5 rounded-2xl border border-border bg-card px-4 py-3 text-left">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Requested path</p>
          <p className="mt-1 break-all font-mono text-xs text-foreground/80">{pageName}</p>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-2">
          {suggestedLinks.map(link => (
            <Link
              key={link.to}
              to={link.to}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
            >
              {link.label}
            </Link>
          ))}
        </div>
        <Link
          to="/"
          className="nuvira-gradient-button mt-3 inline-flex h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold"
        >
          Return Home
        </Link>
      </div>
    </div>
  );
}
