import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Bell,
  ChevronRight,
  ClipboardList,
  Package,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

const sections = [
  {
    title: 'Orders',
    description: 'Order operations and Hub context',
    cards: [
      {
        title: 'Admin Orders',
        route: '/admin/orders',
        description: 'Order operations, Hub panels, fulfillment context, timeline visibility, and internal notes.',
        icon: ClipboardList,
        badges: ['Hub-backed', 'Internal note write available'],
      },
    ],
  },
  {
    title: 'Production',
    description: 'Production and stock visibility',
    cards: [
      {
        title: 'Production Queue',
        route: '/admin/production-queue',
        description: 'Read-only production batches and demand grouped by production date.',
        icon: Package,
        badges: ['Read-only', 'Hub-backed'],
      },
      {
        title: 'Inventory Status',
        route: '/admin/inventory-status',
        description: 'Read-only stock levels, reorder health, suppliers, and storage locations.',
        icon: Package,
        badges: ['Read-only', 'Hub-backed'],
      },
    ],
  },
  {
    title: 'Delivery',
    description: 'Route and delivery visibility',
    cards: [
      {
        title: 'Delivery Queue',
        route: '/admin/delivery-queue',
        description: 'Read-only delivery stops, proof visibility, drop locations, and completed deliveries.',
        icon: Truck,
        badges: ['Read-only', 'Hub-backed'],
      },
    ],
  },
  {
    title: 'Monitoring',
    description: 'Sanitized operations inbox',
    cards: [
      {
        title: 'Ops Alerts',
        route: '/admin/ops-alerts',
        description: 'Read-only sanitized operations alerts without raw payloads or alert actions.',
        icon: Bell,
        badges: ['Read-only', 'Hub-backed'],
      },
    ],
  },
];

function Badge({ label }) {
  const isWriteBadge = label.includes('write');
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
      isWriteBadge
        ? 'bg-amber-50 text-amber-800 border border-amber-200'
        : 'bg-secondary text-secondary-foreground border border-border/50'
    }`}>
      {label}
    </span>
  );
}

function OperationCard({ card }) {
  const Icon = card.icon;

  return (
    <Link to={card.route} className="block">
      <div className="group rounded-xl border border-border/50 bg-card p-4 active:scale-[0.99] transition-all hover:border-primary/30 hover:shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/15 dark:bg-primary/20 flex items-center justify-center shrink-0 border border-primary/20">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-foreground">{card.title}</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{card.description}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </div>

            <div className="flex flex-wrap gap-1.5 mt-3">
              {card.badges.map(badge => (
                <Badge key={badge} label={badge} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

function OperationSection({ section }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-bold text-foreground">{section.title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{section.description}</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {section.cards.map(card => (
          <OperationCard key={card.route} card={card} />
        ))}
      </div>
    </section>
  );
}

export default function Operations() {
  const { user } = useAuth();

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-10">
      <div className="bg-primary px-4 pt-10 pb-5">
        <Link to="/account" className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center mb-3">
          <ArrowLeft className="w-4 h-4 text-white" />
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-bold text-primary-foreground">Operations</h1>
            <p className="text-primary-foreground/70 text-xs mt-0.5">Hub-backed admin tools</p>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-white/20 text-white">
            <ShieldCheck className="w-3 h-3" />
            Admin-only
          </span>
        </div>
      </div>

      <div className="px-4 mt-4 space-y-5">
        <div className="rounded-xl border border-border/50 bg-card p-3">
          <p className="text-xs font-semibold text-foreground">Migrated Hub surfaces</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Navigation-only workspace for existing Customer App admin operations pages.
          </p>
        </div>

        {sections.map(section => (
          <OperationSection key={section.title} section={section} />
        ))}
      </div>
    </div>
  );
}
