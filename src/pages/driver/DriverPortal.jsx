import React from 'react';
import { Leaf, ExternalLink, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';

const HUB_DRIVER_PORTAL_URL = 'https://nuvira-flow-core.base44.app/driver-portal';

export default function DriverPortal() {
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
        <Leaf className="w-10 h-10 text-primary mb-4" />
        <h1 className="font-heading text-xl font-bold mb-2">Sign In Required</h1>
        <p className="text-sm text-muted-foreground mb-6">Please sign in with your driver account.</p>
        <button
          onClick={() => base44.auth.redirectToLogin('/driver')}
          className="px-6 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold"
        >
          Sign In
        </button>
      </div>
    );
  }

  const isAuthorized = user?.role === 'driver' || user?.role === 'admin';

  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
        <h1 className="font-heading text-xl font-bold mb-2">Access Restricted</h1>
        <p className="text-sm text-muted-foreground">This area is for NuVira drivers only.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
      {/* Back button for admins */}
      {user?.role === 'admin' && (
        <button
          onClick={() => navigate('/admin/orders')}
          className="absolute top-6 left-4 flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> Admin
        </button>
      )}

      <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
        <Leaf className="w-8 h-8 text-primary" />
      </div>

      <h1 className="font-heading text-2xl font-bold mb-3">Driver Portal Has Moved</h1>

      <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mb-8">
        Delivery routes are managed from the NuVira Hub to keep production, fulfillment, and delivery records in sync.
        Please use the Hub Driver Portal for live routes.
      </p>

      <a
        href={HUB_DRIVER_PORTAL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-6 py-3.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold active:scale-95 transition-transform"
      >
        Open Hub Driver Portal
        <ExternalLink className="w-4 h-4" />
      </a>

      <p className="text-[11px] text-muted-foreground mt-6">
        Signed in as {user.email}
      </p>
    </div>
  );
}