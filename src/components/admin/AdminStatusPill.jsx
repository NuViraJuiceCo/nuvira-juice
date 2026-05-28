import React from 'react';

const toneClasses = {
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  progress: 'bg-blue-50 text-blue-800 border-blue-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-red-50 text-red-800 border-red-200',
  source: 'bg-violet-50 text-violet-800 border-violet-200',
  native: 'bg-teal-50 text-teal-800 border-teal-200',
  hub: 'bg-slate-100 text-slate-700 border-slate-200',
  neutral: 'bg-secondary text-secondary-foreground border-border/60',
};

const sizeClasses = {
  sm: 'px-2 py-0.5 text-[10px]',
  md: 'px-2.5 py-0.5 text-xs',
};

export function formatAdminLabel(value) {
  if (value === null || value === undefined || value === '') return 'Not set';
  return value
    .toString()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(word => {
      const lower = word.toLowerCase();
      if (['pos', 'sms', 'api', 'id', 'ok'].includes(lower)) return lower.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

export function adminStatusTone(value, context = 'status') {
  const key = (value || '').toString().trim().toLowerCase();
  const ctx = (context || '').toString().trim().toLowerCase();

  if (!key) return 'neutral';
  if (ctx.includes('source')) {
    if (key.includes('native') || key.includes('customer app')) return 'native';
    if (key.includes('hub')) return 'hub';
    if (key.includes('pos') || key.includes('event')) return 'source';
    return 'neutral';
  }
  if (ctx.includes('severity')) {
    if (['critical', 'high'].includes(key)) return 'danger';
    if (['warning', 'medium'].includes(key)) return 'warning';
    if (['info', 'low'].includes(key)) return 'progress';
    return 'neutral';
  }

  if (
    key.includes('error') ||
    key.includes('fail') ||
    key.includes('blocked') ||
    key.includes('missing') ||
    key.includes('short') ||
    key.includes('critical') ||
    key.includes('out_of_stock') ||
    key.includes('out of stock') ||
    key.includes('cancel') ||
    key.includes('refund') ||
    key.includes('review') ||
    key.includes('incomplete')
  ) {
    return key.includes('review') || key.includes('incomplete') ? 'warning' : 'danger';
  }

  if (
    key.includes('pending') ||
    key.includes('scheduled') ||
    key.includes('low') ||
    key.includes('procurement') ||
    key.includes('hold') ||
    key.includes('warn') ||
    key.includes('unassigned')
  ) {
    return 'warning';
  }

  if (
    key.includes('progress') ||
    key.includes('production') ||
    key.includes('transit') ||
    key.includes('out for delivery') ||
    key.includes('active') ||
    key.includes('ack')
  ) {
    return 'progress';
  }

  if (
    key.includes('paid') ||
    key.includes('fulfilled') ||
    key.includes('delivered') ||
    key.includes('complete') ||
    key.includes('verified') ||
    key.includes('ready') ||
    key.includes('picked') ||
    key.includes('resolved') ||
    key.includes('dismissed') ||
    key === 'ok' ||
    key === 'covered'
  ) {
    return 'success';
  }

  return 'neutral';
}

export function AdminStatusPill({
  value,
  label,
  context = 'status',
  tone,
  size = 'sm',
  className = '',
}) {
  const resolvedTone = tone || adminStatusTone(value ?? label, context);
  return (
    <span className={`inline-flex items-center rounded-full border font-semibold whitespace-nowrap ${sizeClasses[size] || sizeClasses.sm} ${toneClasses[resolvedTone] || toneClasses.neutral} ${className}`}>
      {label || formatAdminLabel(value)}
    </span>
  );
}

export function AdminStatusLegend({ className = '' }) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      <AdminStatusPill label="Ready / Complete" tone="success" />
      <AdminStatusPill label="In Progress" tone="progress" />
      <AdminStatusPill label="Needs Attention" tone="warning" />
      <AdminStatusPill label="Blocked" tone="danger" />
      <AdminStatusPill label="POS / Event" tone="source" />
      <AdminStatusPill label="Hub Fallback" tone="hub" />
    </div>
  );
}
