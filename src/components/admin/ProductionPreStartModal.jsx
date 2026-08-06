import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, ClipboardList, RefreshCw, SprayCan, Thermometer } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { unwrapBase44Result } from '@/lib/base44-result';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import StaffMemberPicker from '@/components/admin/StaffMemberPicker';

function todayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentTime() {
  const now = new Date();
  return `${now.getHours()}`.padStart(2, '0') + ':' + `${now.getMinutes()}`.padStart(2, '0');
}

function batchPayload(batch) {
  return {
    production_batch_id: batch?.id,
    batch_id: batch?.batch_id,
    production_date: batch?.production_date || todayDate(),
    is_test_batch: batch?.is_test_batch === true,
  };
}

function batchLinkFields(batch) {
  const batchId = String(batch?.batch_id || '').trim();
  const sourceId = String(batch?.id || '').trim();
  return {
    ...(batchId ? { batch_id: batchId, related_batch_ids: [batchId] } : {}),
    ...(sourceId ? { source_production_batch_id: sourceId, related_source_production_batch_ids: [sourceId] } : {}),
    is_test_record: batch?.is_test_batch === true,
  };
}

const ITEM_CONFIG = {
  sanitation: {
    label: 'Pre-op sanitation',
    description: 'Confirm the work area was cleaned, sanitized, and the sanitizer level is usable.',
    icon: SprayCan,
  },
  daily_checklist: {
    label: 'Daily checklist',
    description: 'Confirm the four required pre-production checks for this shift.',
    icon: ClipboardList,
  },
  temperature: {
    label: 'Cold storage temperature',
    description: 'Record a current cold-storage reading in the approved 35–40°F range.',
    icon: Thermometer,
  },
};

function initialForm(batch) {
  return {
    log_date: batch?.production_date || todayDate(),
    log_time: currentTime(),
    staff_member: '',
    shift: 'Morning',
    area: 'Prep Area',
    sanitizer_type: 'Bleach Solution',
    sanitizer_level: 'Adequate',
    cleaned: false,
    sanitized: false,
    verified_by: '',
    location: 'Cold Room 1',
    temperature: '',
    morning_fridge_temp_logged: false,
    sanitizer_levels_checked: false,
    equipment_sanitized: false,
    work_areas_cleaned: false,
    notes: '',
  };
}

function messageClass(type) {
  if (type === 'error') return 'text-destructive';
  if (type === 'success') return 'text-emerald-700 dark:text-emerald-300';
  return 'text-amber-700 dark:text-amber-300';
}

export default function ProductionPreStartModal({ batch, open, onOpenChange, onReadyChange, onContinue }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState('overview');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState(null);
  const [message, setMessage] = useState(null);
  const [form, setForm] = useState(() => initialForm(batch));

  const items = useMemo(() => {
    const byKey = Object.fromEntries((status?.items || []).map(item => [item.key, item]));
    return Object.keys(ITEM_CONFIG).map(key => ({ key, ...ITEM_CONFIG[key], ...(byKey[key] || {}) }));
  }, [status]);
  const readyCount = items.filter(item => item.ready).length;

  async function refreshStatus({ keepMessage = false } = {}) {
    setLoading(true);
    if (!keepMessage) setMessage(null);
    try {
      const response = await base44.functions.invoke('getAdminProductionQueueSummary', {
        action: 'pre_start_status',
        ...batchPayload(batch),
      });
      const result = unwrapBase44Result(response);
      if (!result?.success) throw new Error(result?.error || 'pre_start_status_unavailable');
      setStatus(result);
      onReadyChange?.(result.ready === true, result);
      return result;
    } catch (error) {
      setStatus(null);
      onReadyChange?.(false, null);
      setMessage({ type: 'error', text: error?.message || 'Unable to check pre-start compliance.' });
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setView('overview');
    setMessage(null);
    setForm(previous => ({
      ...initialForm(batch),
      staff_member: previous.staff_member,
      verified_by: previous.verified_by,
    }));
    refreshStatus();
    base44.auth.me().then(user => {
      setForm(previous => ({
        ...previous,
        staff_member: previous.staff_member || user?.full_name || '',
      }));
    }).catch(() => null);
  }, [open, batch?.id, batch?.batch_id]);

  function update(field, value) {
    setForm(previous => ({ ...previous, [field]: value }));
  }

  async function refreshComplianceViews() {
    await queryClient.invalidateQueries({ queryKey: ['admin_compliance_ops_summary'] });
    await queryClient.invalidateQueries({ queryKey: ['compliance_logs_parity_summary'] });
    await queryClient.invalidateQueries({ queryKey: ['admin-production-queue-summary'] });
  }

  function validate(recordType) {
    if (!form.staff_member.trim()) return 'Select or enter the staff member responsible for this log.';
    if (recordType === 'sanitation' && (!form.cleaned || !form.sanitized)) {
      return 'Confirm both cleaning and sanitizing before saving.';
    }
    if (recordType === 'temperature') {
      const temperature = Number(form.temperature);
      if (!Number.isFinite(temperature)) return 'Enter the current cold storage temperature.';
    }
    if (recordType === 'daily_checklist') {
      const complete = form.morning_fridge_temp_logged && form.sanitizer_levels_checked && form.equipment_sanitized && form.work_areas_cleaned;
      if (!complete) return 'Complete all four required pre-production checks before saving.';
    }
    return null;
  }

  async function saveRecord(recordType) {
    const validationError = validate(recordType);
    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const common = {
        log_date: form.log_date,
        log_time: form.log_time,
        staff_member: form.staff_member,
        notes: form.notes,
        ...batchLinkFields(batch),
      };
      let data;
      if (recordType === 'sanitation') {
        data = {
          ...common,
          area: form.area,
          sanitizer_type: form.sanitizer_type,
          sanitizer_level: form.sanitizer_level,
          cleaned: form.cleaned,
          sanitized: form.sanitized,
          verified_by: form.verified_by,
        };
      } else if (recordType === 'temperature') {
        data = {
          ...common,
          location: form.location,
          temperature: Number(form.temperature),
          min_range: 35,
          max_range: 40,
          unit: 'F',
          shift: form.shift,
          production_date: form.log_date,
        };
      } else {
        data = {
          checklist_date: form.log_date,
          staff_member: form.staff_member,
          ...batchLinkFields(batch),
          batches_logged: batch?.batch_id || '',
          shift: form.shift,
          morning_fridge_temp_logged: form.morning_fridge_temp_logged,
          morning_fridge_time: form.log_time,
          sanitizer_levels_checked: form.sanitizer_levels_checked,
          sanitizer_check_time: form.log_time,
          equipment_sanitized: form.equipment_sanitized,
          sanitization_time: form.log_time,
          work_areas_cleaned: form.work_areas_cleaned,
          cleaning_time: form.log_time,
          batch_logs_completed: false,
          ccp_logs_completed: false,
          issues_reported: form.notes,
          overall_status: 'Pre-Production Complete',
          completed_at: new Date().toISOString(),
        };
      }

      const response = await base44.functions.invoke('saveAdminComplianceRecord', {
        record_type: recordType,
        data,
      });
      const result = unwrapBase44Result(response);
      if (!result?.success) throw new Error(result?.error || 'pre_start_record_save_failed');

      setView('overview');
      await refreshComplianceViews();
      const next = await refreshStatus({ keepMessage: true });
      setMessage({
        type: 'success',
        text: next?.ready
          ? `${ITEM_CONFIG[recordType].label} saved. All pre-start items are ready.`
          : `${ITEM_CONFIG[recordType].label} saved. Choose the next missing item.`,
      });
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to save this pre-start record.' });
    } finally {
      setSaving(false);
    }
  }

  async function linkExisting(item) {
    if (!item.reusable_record_id) return;
    setLinking(item.key);
    setMessage(null);
    try {
      const response = await base44.functions.invoke('saveAdminComplianceRecord', {
        action: 'link_pre_start_record',
        ...batchPayload(batch),
        record_type: item.key,
        record_id: item.reusable_record_id,
      });
      const result = unwrapBase44Result(response);
      if (!result?.success) throw new Error(result?.error || 'pre_start_record_link_failed');
      await refreshComplianceViews();
      const next = await refreshStatus({ keepMessage: true });
      setMessage({
        type: 'success',
        text: next?.ready
          ? `${item.label} linked. All pre-start items are ready.`
          : `${item.label} linked. Choose the next missing item.`,
      });
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to use the existing same-day log.' });
    } finally {
      setLinking(null);
    }
  }

  const activeConfig = ITEM_CONFIG[view];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-border bg-secondary/40 px-5 py-4 pr-12 text-left">
          <DialogTitle>{activeConfig ? activeConfig.label : 'Start production batch'}</DialogTitle>
          <DialogDescription>
            {activeConfig
              ? 'Save this item, then you will return to the batch-start checklist.'
              : `${batch?.batch_id || batch?.product_name || 'Batch'} · ${readyCount}/3 pre-start items ready`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          {view === 'overview' ? (
            <>
              <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
                <div>
                  <p className="text-sm font-semibold">Pre-start compliance</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Existing batch-linked records are recognized automatically. A valid same-day facility log can be linked instead of entered twice.
                  </p>
                </div>
                <button type="button" onClick={() => refreshStatus()} disabled={loading} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold disabled:opacity-50">
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              <div className="space-y-2" data-testid="production-prestart-checklist">
                {items.map(item => {
                  const Icon = item.icon;
                  return (
                    <div key={item.key} className={`rounded-xl border p-3 ${item.ready ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/20' : 'border-border bg-card'}`}>
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 rounded-lg p-2 ${item.ready ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-secondary text-foreground'}`}>
                          {item.ready ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold">{item.label}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                            </div>
                            {item.ready ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">Logged</span>
                            ) : item.reusable_same_day_record ? (
                              <button type="button" onClick={() => linkExisting(item)} disabled={Boolean(linking) || saving} className="h-8 rounded-lg border border-primary/40 bg-primary/5 px-3 text-xs font-semibold text-primary disabled:opacity-50">
                                {linking === item.key ? 'Linking...' : "Use today's log"}
                              </button>
                            ) : (
                              <button type="button" onClick={() => { setView(item.key); setMessage(null); }} disabled={loading || saving} className="h-8 rounded-lg bg-nuvira-gradient px-3 text-xs font-semibold text-white disabled:opacity-50">
                                Log item
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <button type="button" onClick={() => { setView('overview'); setMessage(null); }} className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                <ChevronLeft className="h-4 w-4" /> Back to missing items
              </button>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Production date</span>
                  <input type="date" value={form.log_date} onChange={event => update('log_date', event.target.value)} className="h-9 w-full rounded-lg border border-border bg-card px-2 text-xs" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Time</span>
                  <input type="time" value={form.log_time} onChange={event => update('log_time', event.target.value)} className="h-9 w-full rounded-lg border border-border bg-card px-2 text-xs" />
                </label>
                <div className="sm:col-span-2">
                  <StaffMemberPicker label="Production staff" value={form.staff_member} onChange={value => update('staff_member', value)} helperText="This staff selection carries to the remaining pre-start items." />
                </div>
              </div>

              {view === 'sanitation' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="space-y-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Area</span><select value={form.area} onChange={event => update('area', event.target.value)} className="h-9 w-full rounded-lg border border-border bg-card px-2 text-xs"><option>Prep Area</option><option>Production Floor</option><option>Packing Area</option><option>Cold Storage</option><option>Equipment</option></select></label>
                    <label className="space-y-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sanitizer</span><select value={form.sanitizer_type} onChange={event => update('sanitizer_type', event.target.value)} className="h-9 w-full rounded-lg border border-border bg-card px-2 text-xs"><option>Bleach Solution</option><option>Quaternary Ammonium</option><option>Iodine</option><option>Alcohol 70%</option></select></label>
                    <label className="space-y-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sanitizer level</span><select value={form.sanitizer_level} onChange={event => update('sanitizer_level', event.target.value)} className="h-9 w-full rounded-lg border border-border bg-card px-2 text-xs"><option>Adequate</option><option>Optimal</option><option>Low</option></select></label>
                    <StaffMemberPicker label="Verified by" value={form.verified_by} onChange={value => update('verified_by', value)} placeholder="Optional verifier" />
                  </div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.cleaned} onChange={event => update('cleaned', event.target.checked)} /> Area cleaned</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.sanitized} onChange={event => update('sanitized', event.target.checked)} /> Area sanitized</label>
                </div>
              )}

              {view === 'temperature' && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="space-y-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cold storage</span><select value={form.location} onChange={event => update('location', event.target.value)} className="h-9 w-full rounded-lg border border-border bg-card px-2 text-xs"><option>Cold Room 1</option><option>Cold Room 2</option><option>Walk-in Cooler</option><option>Freezer</option></select></label>
                  <label className="space-y-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Shift</span><select value={form.shift} onChange={event => update('shift', event.target.value)} className="h-9 w-full rounded-lg border border-border bg-card px-2 text-xs"><option>Morning</option><option>Afternoon</option><option>Night</option></select></label>
                  <label className="space-y-1 sm:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Temperature °F</span><input type="number" step="0.1" value={form.temperature} onChange={event => update('temperature', event.target.value)} placeholder="37.0" className="h-9 w-full rounded-lg border border-border bg-card px-2 text-xs" /><span className="text-[10px] text-muted-foreground">Approved refrigerator range: 35–40°F. Out-of-range readings are recorded but will not clear Start.</span></label>
                </div>
              )}

              {view === 'daily_checklist' && (
                <div className="space-y-3 rounded-lg border border-border bg-card p-3">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.morning_fridge_temp_logged} onChange={event => update('morning_fridge_temp_logged', event.target.checked)} /> Refrigerator temperature was logged</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.sanitizer_levels_checked} onChange={event => update('sanitizer_levels_checked', event.target.checked)} /> Sanitizer levels were checked</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.equipment_sanitized} onChange={event => update('equipment_sanitized', event.target.checked)} /> Equipment was sanitized</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.work_areas_cleaned} onChange={event => update('work_areas_cleaned', event.target.checked)} /> Work areas were cleaned</label>
                </div>
              )}

              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</span>
                <textarea rows={2} value={form.notes} onChange={event => update('notes', event.target.value)} placeholder="Issues or observations" className="w-full resize-none rounded-lg border border-border bg-card px-2 py-2 text-xs" />
              </label>
            </div>
          )}

          {message && <p className={`text-xs ${messageClass(message.type)}`}>{message.text}</p>}
        </div>

        <DialogFooter className="gap-2 border-t border-border px-5 py-4 sm:space-x-0">
          {view === 'overview' ? (
            <>
              <button type="button" onClick={() => onOpenChange?.(false)} className="h-9 rounded-lg border border-border px-3 text-xs font-semibold">Close</button>
              <button type="button" onClick={() => onContinue?.(status)} disabled={!status?.ready || loading || saving || Boolean(linking)} data-testid="production-prestart-continue" className="h-9 rounded-lg bg-nuvira-gradient px-4 text-xs font-semibold text-white disabled:opacity-50">
                {status?.ready ? 'Continue to Start Preview' : `${3 - readyCount} item${3 - readyCount === 1 ? '' : 's'} remaining`}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => saveRecord(view)} disabled={saving} data-testid={`production-prestart-save-${view}`} className="h-9 w-full rounded-lg bg-nuvira-gradient px-4 text-xs font-semibold text-white disabled:opacity-50">
              {saving ? 'Saving...' : `Save ${activeConfig?.label}`}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
