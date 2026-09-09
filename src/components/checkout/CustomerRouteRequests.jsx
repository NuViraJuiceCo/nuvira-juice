import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

export default function CustomerRouteRequests() {
  const { user } = useAuth();
  const { data, isError } = useQuery({ queryKey: ['owned-route-requests', user?.id], enabled: Boolean(user?.email),
    staleTime: 15000, queryFn: async () => {
      const rows = [];
      for (let offset = 0; offset < 2000; offset += 100) {
        const page = await base44.entities.DeliveryApprovalRequest.filter({ customer_email: user.email }, '-created_date', 100, offset);
        if (!Array.isArray(page) || page.some(row => row.customer_email !== user.email)) throw new Error('Request read unconfirmed');
        rows.push(...page);
        if (page.length < 100) return rows.filter(row => ['pending_authorization', 'pending_review'].includes(row.status));
      }
      throw new Error('Request read incomplete');
    } });
  if (isError) return <p role="status" className="mx-4 mb-4 rounded-xl border p-3 text-xs">Delivery requests could not be loaded. Refresh this page before submitting another request.</p>;
  if (!data?.length) return null;
  return <section className="mx-4 mb-5 rounded-2xl border border-cyan-500/25 bg-cyan-500/5 p-4">
    <h2 className="font-semibold">Your delivery requests</h2>
    <p className="mt-1 text-xs text-muted-foreground">These need route approval before production. No need to place them again.</p>
    {data.map(row => <Link key={row.id} to={`/zone3-review-submitted?request=${encodeURIComponent(row.request_number)}`}
      className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background p-3 text-sm">
      <span>{row.request_number}</span><span className="font-semibold text-primary">{row.status === 'pending_review' ? 'In review' : 'Awaiting confirmation'} →</span>
    </Link>)}
  </section>;
}
