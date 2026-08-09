import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import {
  RefreshCw,
  Search,
  ShieldCheck,
  UsersRound,
  Wrench,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/admin-access';

function formatDateTime(value) {
  if (!value) return null;
  try {
    return format(new Date(value), 'MMM d, yyyy - h:mm a');
  } catch {
    return value;
  }
}

function formatLabel(value) {
  if (!value) return 'Not set';
  return value
    .toString()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function statusClass(status) {
  const key = (status || '').toString().toLowerCase();
  if (key === 'active' || key === 'operational') return 'bg-emerald-50 text-emerald-700';
  if (key === 'maintenance' || key === 'on leave') return 'bg-cyan-50 text-cyan-700';
  if (key === 'broken' || key === 'inactive') return 'bg-red-50 text-red-700';
  return 'bg-muted text-muted-foreground';
}

function StatCard({ icon: Icon, label, value, sublabel, isRefreshing }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-3">
      {Icon && <Icon className={`w-4 h-4 text-primary mb-1 ${isRefreshing ? 'animate-spin' : ''}`} />}
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className="text-lg font-bold">{value ?? 0}</p>
      {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
    </div>
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass(status)}`}>
      {formatLabel(status)}
    </span>
  );
}

function categoryOptions(team, equipment, selectedCategory) {
  const options = new Set();
  if (team.length > 0) options.add('Team Member');
  if (equipment.length > 0) options.add('Equipment');
  if (selectedCategory !== 'all') options.add(selectedCategory);
  return [...options];
}

function TeamCard({ member }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Team Member</p>
          <h2 className="font-heading text-base font-bold text-foreground mt-0.5 truncate">
            {member.display_name || 'Unnamed team member'}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{member.role || 'Role pending'}</p>
        </div>
        <StatusBadge status={member.status} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="rounded-lg border border-border/50 bg-background p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Shift</p>
          <p className="text-xs font-semibold mt-1">{member.shift_label || 'Not set'}</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-background p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Last source update</p>
          <p className="text-xs font-semibold mt-1">{formatDateTime(member.updated_date) || '-'}</p>
        </div>
      </div>
    </div>
  );
}

function EquipmentTable({ equipment }) {
  return (
    <div className="hidden sm:block bg-card border border-border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Equipment</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
              <th className="hidden lg:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Last Service</th>
              <th className="hidden xl:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Last source update</th>
            </tr>
          </thead>
          <tbody>
            {equipment.map(item => (
              <tr key={item.resource_id || item.equipment_name} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3.5 font-medium text-foreground">{item.equipment_name || 'Unnamed equipment'}</td>
                <td className="px-4 py-3.5 text-muted-foreground">{item.equipment_type || '-'}</td>
                <td className="px-4 py-3.5"><StatusBadge status={item.equipment_status} /></td>
                <td className="hidden lg:table-cell px-4 py-3.5 text-muted-foreground">{item.last_service_date || '-'}</td>
                <td className="hidden xl:table-cell px-4 py-3.5 text-muted-foreground">{formatDateTime(item.updated_date) || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EquipmentCards({ equipment }) {
  return (
    <div className="sm:hidden space-y-3">
      {equipment.map(item => (
        <div key={item.resource_id || item.equipment_name} className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground text-sm">{item.equipment_name || 'Unnamed equipment'}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{item.equipment_type || 'Type pending'}</p>
            </div>
            <StatusBadge status={item.equipment_status} />
          </div>

          <div className="grid grid-cols-1 gap-2 pt-2 border-t border-border/30">
            <div className="rounded-lg border border-border/50 bg-background p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Last Service</p>
              <p className="text-xs font-semibold mt-1">{item.last_service_date || '-'}</p>
            </div>
            <div className="rounded-lg border border-border/50 bg-background p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Last source update</p>
              <p className="text-xs font-semibold mt-1">{formatDateTime(item.updated_date) || '-'}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Resources() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['admin-resources-summary', categoryFilter, statusFilter, search],
    queryFn: async () => {
      const payload = {
        limit: 200,
      };
      if (search.trim()) payload.search = search.trim();
      if (categoryFilter !== 'all') payload.category = categoryFilter;
      if (statusFilter !== 'all') payload.status = statusFilter;

      const res = await base44.functions.invoke('getAdminResourcesSummary', payload);
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result || { summary: {}, sections: { team: [], equipment: [] } };
    },
    enabled: isAdminUser(user),
    staleTime: 60000,
  });

  const summary = data?.summary || {};
  const team = data?.sections?.team || [];
  const equipment = data?.sections?.equipment || [];
  const warnings = Array.isArray(data?.warnings) ? data.warnings.filter(Boolean) : [];
  const categories = useMemo(() => categoryOptions(team, equipment, categoryFilter), [categoryFilter, equipment, team]);
  const hasResults = team.length > 0 || equipment.length > 0;

  if (!isAdminUser(user)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-10">
      <AdminOpsHeader
        title="Resources"
        subtitle="Customer App team and equipment context"
        badge="Customer App"
      />

      <div className="px-4 mt-4 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <StatCard icon={UsersRound} label="Team" value={summary.team_count ?? 0} />
          <StatCard icon={Wrench} label="Equipment" value={summary.equipment_count ?? 0} />
          <StatCard icon={ShieldCheck} label="Operational" value={summary.operational_equipment ?? 0} />
          <StatCard icon={RefreshCw} label="Maintenance" value={summary.maintenance_equipment ?? 0} isRefreshing={isFetching} />
        </div>

        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              className="w-full h-10 rounded-lg border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Search team, roles, equipment, types, or status..."
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Category</span>
              <select
                value={categoryFilter}
                onChange={event => setCategoryFilter(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Categories</option>
                <option value="Team Member">Team Member</option>
                <option value="Equipment">Equipment</option>
                {categories
                  .filter(category => category !== 'Team Member' && category !== 'Equipment')
                  .map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
              <select
                value={statusFilter}
                onChange={event => setStatusFilter(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="on leave">On Leave</option>
                <option value="inactive">Inactive</option>
                <option value="operational">Operational</option>
                <option value="maintenance">Maintenance</option>
                <option value="broken">Broken</option>
              </select>
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-foreground">
              Customer App resources
            </p>
            <p className="text-[10px] text-muted-foreground">
              Active operators and equipment recorded by native production activity.
            </p>
          </div>
          <RefreshCw className={`w-4 h-4 text-primary ${isFetching ? 'animate-spin' : ''}`} />
        </div>

        {warnings.length > 0 && (
          <p className="text-xs text-cyan-700 bg-cyan-50 border border-cyan-200 rounded-lg p-3">
            {warnings.slice(0, 2).join(', ')}
          </p>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load resources summary</p>
            <p className="text-xs text-muted-foreground mt-1">{error?.message || 'Try again later.'}</p>
          </div>
        ) : !hasResults ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No resources found</p>
            <p className="text-xs text-muted-foreground mt-1">Try another search, category, or status filter.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {data?.truncated && (
              <p className="text-xs text-cyan-700 bg-cyan-50 border border-cyan-200 rounded-lg p-3">
                Results are capped. Narrow the search or filters for a more complete view.
              </p>
            )}

            {team.length > 0 && (
              <section className="space-y-3">
                <div>
                  <h2 className="text-sm font-bold text-foreground">Team</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Read-only team resource cards</p>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {team.map(member => (
                    <TeamCard key={member.resource_id || member.display_name} member={member} />
                  ))}
                </div>
              </section>
            )}

            {equipment.length > 0 && (
              <section className="space-y-3">
                <div>
                  <h2 className="text-sm font-bold text-foreground">Equipment</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Read-only equipment status and service visibility</p>
                </div>
                <EquipmentTable equipment={equipment} />
                <EquipmentCards equipment={equipment} />
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
