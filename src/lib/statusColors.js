const STATUS_MAP = {
  paid: 'success',
  captured: 'success',
  completed: 'success',
  verified_logged: 'success',
  passed: 'success',
  delivered: 'success',
  fulfilled: 'success',
  active: 'success',
  Valid: 'success',
  Completed: 'success',
  Approved: 'success',
  bottled: 'success',
  packed: 'success',

  scheduled: 'info',
  in_production: 'info',
  production_scheduled: 'info',
  in_cold_storage: 'info',
  assigned_for_delivery: 'info',
  assigned_for_pickup: 'info',
  In: 'info',
  Scheduled: 'info',
  Packed: 'info',
  Reviewed: 'info',
  'In Review': 'info',

  pending: 'warning',
  awaiting_production: 'warning',
  new: 'warning',
  Pending: 'warning',
  'Due Soon': 'warning',
  'Requires Update': 'warning',
  'Needs Changes': 'warning',
  Incomplete: 'warning',

  failed: 'danger',
  Failed: 'danger',
  blocked: 'danger',
  canceled: 'danger',
  Cancelled: 'danger',
  refunded: 'danger',
  Expired: 'danger',
  Overdue: 'danger',
  Rejected: 'danger',

  admin: 'admin',
};

const BUCKET_CLASSES = {
  success: 'bg-emerald-100 text-emerald-900 border border-emerald-300',
  info: 'bg-sky-100 text-sky-900 border border-sky-300',
  warning: 'bg-amber-100 text-amber-950 border border-amber-300',
  danger: 'bg-rose-100 text-rose-900 border border-rose-300',
  admin: 'bg-violet-100 text-violet-900 border border-violet-300',
  neutral: 'bg-muted text-muted-foreground border border-border',
};

const BUCKET_DOT = {
  success: 'bg-emerald-600',
  info: 'bg-sky-600',
  warning: 'bg-amber-500',
  danger: 'bg-rose-600',
  admin: 'bg-violet-600',
  neutral: 'bg-muted-foreground',
};

export function getStatusClasses(status) {
  const bucket = STATUS_MAP[status] || 'neutral';
  return BUCKET_CLASSES[bucket];
}

export function getStatusDot(status) {
  const bucket = STATUS_MAP[status] || 'neutral';
  return BUCKET_DOT[bucket];
}

export function getStatusTextClass(status) {
  const bucket = STATUS_MAP[status] || 'neutral';
  return {
    success: 'text-emerald-700',
    info: 'text-sky-700',
    warning: 'text-amber-700',
    danger: 'text-rose-700',
    admin: 'text-violet-700',
    neutral: 'text-muted-foreground',
  }[bucket];
}

export { BUCKET_CLASSES, STATUS_MAP };
