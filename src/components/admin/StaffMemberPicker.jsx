import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { unwrapBase44Result } from '@/lib/base44-result';

function splitStaff(value = '') {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function uniqueNames(values) {
  const seen = new Set();
  return values
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .filter(value => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function userDisplayName(user) {
  return user?.full_name || user?.name || user?.email || '';
}

function resourceDisplayName(member) {
  return member?.display_name || member?.full_name || member?.name || member?.email || '';
}

export default function StaffMemberPicker({
  label = 'Staff member',
  value,
  onChange,
  multiple = false,
  placeholder,
  helperText,
}) {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ['admin-staff-member-options'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminResourcesSummary', {
        category: 'Team Member',
        status: 'active',
        limit: 100,
      });
      const result = unwrapBase44Result(res);
      if (result?.error) throw new Error(result.error);
      return result || { sections: { team: [] } };
    },
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const options = useMemo(() => {
    const team = data?.sections?.team || [];
    return uniqueNames([
      userDisplayName(user),
      ...team.map(resourceDisplayName),
      ...splitStaff(value),
    ]);
  }, [data?.sections?.team, user, value]);

  const selected = useMemo(() => splitStaff(value), [value]);

  function toggleName(name) {
    if (!multiple) {
      onChange?.(name);
      return;
    }

    const selectedKeys = new Set(selected.map(item => item.toLowerCase()));
    const next = selectedKeys.has(name.toLowerCase())
      ? selected.filter(item => item.toLowerCase() !== name.toLowerCase())
      : [...selected, name];
    onChange?.(next.join(', '));
  }

  return (
    <div className="space-y-2">
      <label className="space-y-1 block">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <input
          value={value || ''}
          onChange={event => onChange?.(event.target.value)}
          placeholder={placeholder || (multiple ? 'Select or type team members' : 'Select or type a team member')}
          className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </label>
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {options.map(name => {
            const isSelected = multiple
              ? selected.some(item => item.toLowerCase() === name.toLowerCase())
              : String(value || '').trim().toLowerCase() === name.toLowerCase();
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggleName(name)}
                className={`h-7 rounded-full border px-2.5 text-[11px] font-semibold transition-colors ${
                  isSelected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:border-primary/60'
                }`}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}
      {helperText && <p className="text-[10px] leading-relaxed text-muted-foreground">{helperText}</p>}
    </div>
  );
}
