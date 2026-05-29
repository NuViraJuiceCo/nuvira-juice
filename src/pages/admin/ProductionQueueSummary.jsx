import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardCheck, Database, Lock, Package, Play, RefreshCw } from 'lucide-react';
import { AdminStatusLegend, AdminStatusPill } from '@/components/admin/AdminStatusPill';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

function todayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = `${today.getMonth() + 1}`.padStart(2, '0');
  const day = `${today.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseLocalDate(str) {
  if (!str) return null;
  const [year, month, day] = str.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function daysInclusive(from, to) {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
}

function formatDate(value) {
  if (!value) return 'Date pending';
  try {
    return format(parseLocalDate(value), 'MMM d, yyyy');
  } catch {
    return value;
  }
}

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
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function sourceTypeSummary(sourceTypeCounts) {
  const entries = Object.entries(sourceTypeCounts || {});
  if (entries.length === 0) return 'No source mix';
  return entries
    .map(([source, count]) => `${formatLabel(source)}: ${count}`)
    .join(' · ');
}

function compactOrderNumbers(orderNumbers) {
  if (!Array.isArray(orderNumbers) || orderNumbers.length === 0) return 'No order refs';
  const visible = orderNumbers.slice(0, 8);
  const remaining = orderNumbers.length - visible.length;
  return remaining > 0 ? `${visible.join(', ')} +${remaining} more` : visible.join(', ');
}

function isDoneStatus(status) {
  const key = (status || '').toString().toLowerCase();
  return ['verified_logged', 'completed', 'archived', 'fulfilled'].includes(key);
}

function isInProgressStatus(status) {
  const key = (status || '').toString().toLowerCase();
  return key === 'in_production' || key.includes('in progress');
}

function isNeedsVerificationStatus(status) {
  const key = (status || '').toString().toLowerCase();
  return key === 'completed_pending_verification' || key.includes('pending verification') || key.includes('needs verification');
}

function isShotCategory(category) {
  return (category || '').toString().toLowerCase() === 'shot';
}

function requestIdFor(prefix, batch) {
  const fallback = Math.random().toString(36).slice(2);
  const randomId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallback;
  return `${prefix}_${batch.id || batch.batch_id || 'batch'}_${Date.now()}_${randomId}`;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '-';
  return Math.round(parsed * 1000) / 1000;
}

function previewStatusText(preview) {
  if (!preview) return null;
  const blockers = Array.isArray(preview.blockers) ? preview.blockers : [];
  const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
  if (preview.live_allowed) return 'Preview allows this action for the exact batch.';
  if (blockers.length > 0) return `Blocked: ${blockers.map(formatLabel).join(', ')}`;
  if (warnings.length > 0) return `Warnings: ${warnings.map(formatLabel).join(', ')}`;
  return 'Preview returned no live approval.';
}

function PreviewResult({ preview }) {
  if (!preview) return null;
  const blockers = Array.isArray(preview.blockers) ? preview.blockers : [];
  const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
  const projectedWrites = Array.isArray(preview.projected_writes) ? preview.projected_writes : [];

  return (
    <div className="rounded-lg bg-card p-2 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Allowed</p>
          <p className="text-xs font-bold">{preview.live_allowed ? 'Yes' : 'No'}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Status</p>
          <p className="text-xs font-bold">{formatLabel(preview.current_status)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Locked</p>
          <p className="text-xs font-bold">{preview.is_locked ? 'Yes' : 'No'}</p>
        </div>
      </div>

      <p className={`text-xs ${preview.live_allowed ? 'text-green-700' : 'text-amber-700'}`}>
        {previewStatusText(preview)}
      </p>

      {(blockers.length > 0 || warnings.length > 0) && (
        <div className="space-y-1">
          {blockers.map(blocker => (
            <p key={`blocker-${blocker}`} className="text-xs text-amber-800">Blocker: {formatLabel(blocker)}</p>
          ))}
          {warnings.map(warning => (
            <p key={`warning-${warning}`} className="text-xs text-muted-foreground">Warning: {formatLabel(warning)}</p>
          ))}
        </div>
      )}

      {projectedWrites.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Writes if approved: {projectedWrites.map(formatLabel).join(', ')}
        </p>
      )}
    </div>
  );
}

function ProductionLifecyclePanel({ batch, onActionSuccess }) {
  const [activeAction, setActiveAction] = useState(null);
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState(null);
  const [pending, setPending] = useState(null);
  const [completeForm, setCompleteForm] = useState({
    actual_units: batch.actual_units || batch.planned_units || '',
    pH_result: '',
    pH_passed_failed: 'passed',
    passed_failed: 'passed',
    staff_on_duty: '',
    calibration_checked: true,
    ccp_check_complete: true,
    sanitation_verification_complete: true,
    labels_applied: true,
    notes: '',
  });

  const canStart = !batch.is_locked && !isInProgressStatus(batch.status) && !isNeedsVerificationStatus(batch.status) && !isDoneStatus(batch.status);
  const canComplete = isInProgressStatus(batch.status);
  const canVerify = isNeedsVerificationStatus(batch.status);

  function resetFor(action) {
    setActiveAction(action);
    setPreview(null);
    setMessage(null);
  }

  function basePayload(prefix) {
    return {
      production_batch_id: batch.id,
      batch_id: batch.batch_id,
      expected_status: batch.status,
      request_id: requestIdFor(prefix, batch),
    };
  }

  function completePayload(prefix) {
    return {
      ...basePayload(prefix),
      actual_units: Number(completeForm.actual_units),
      pH_result: Number(completeForm.pH_result),
      pH_passed_failed: completeForm.pH_passed_failed,
      passed_failed: completeForm.passed_failed,
      calibration_checked: completeForm.calibration_checked,
      ccp_check_complete: completeForm.ccp_check_complete,
      sanitation_verification_complete: completeForm.sanitation_verification_complete,
      labels_applied: completeForm.labels_applied,
      staff_on_duty: completeForm.staff_on_duty
        .split(',')
        .map(value => value.trim())
        .filter(Boolean),
      notes: completeForm.notes,
    };
  }

  async function runPreview(action) {
    setPending(`preview_${action}`);
    setMessage(null);

    try {
      const functionName = {
        start: 'previewAdminProductionBatchStart',
        complete: 'previewAdminProductionBatchComplete',
        verify: 'previewAdminProductionBatchVerify',
      }[action];
      const payload = action === 'complete'
        ? completePayload('preview_complete')
        : basePayload(`preview_${action}`);

      const res = await base44.functions.invoke(functionName, payload);
      const result = res?.data || res;
      if (result?.error && result?.success !== true) throw new Error(result.error);
      setPreview(result);
      setActiveAction(action);
      setMessage({
        type: result.live_allowed ? 'success' : 'warn',
        text: result.live_allowed ? `${formatLabel(action)} is allowed for this batch.` : `${formatLabel(action)} is not currently allowed.`,
      });
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || `Unable to preview ${action}.` });
    } finally {
      setPending(null);
    }
  }

  async function runLive(action) {
    if (!preview?.live_allowed) return;
    const label = formatLabel(action);
    if (!window.confirm(`${label} ${batch.batch_id || batch.product_name}? This runs the approved Hub-backed production command for this exact batch.`)) {
      return;
    }

    setPending(`live_${action}`);
    setMessage(null);

    try {
      const functionName = {
        start: 'startAdminProductionBatch',
        complete: 'completeAdminProductionBatch',
        verify: 'verifyAdminProductionBatch',
      }[action];
      const payload = action === 'complete'
        ? completePayload('complete')
        : {
            ...basePayload(action),
            reason: `Admin Production Queue ${label}.`,
          };

      const res = await base44.functions.invoke(functionName, payload);
      const result = res?.data || res;
      if (!result?.success) throw new Error(result?.error || `${action}_failed`);
      setMessage({
        type: result.skipped ? 'warn' : 'success',
        text: result.skipped ? `${label} was already recorded.` : `${label} completed.`,
      });
      await onActionSuccess?.();
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || `Unable to run ${action}. Hub gates may still be closed.` });
    } finally {
      setPending(null);
    }
  }

  const actionButtons = [
    { key: 'start', label: 'Start', icon: Play, enabled: canStart },
    { key: 'complete', label: 'Complete', icon: CheckCircle2, enabled: canComplete },
    { key: 'verify', label: 'Verify', icon: ClipboardCheck, enabled: canVerify },
  ];

  return (
    <div className="rounded-lg border border-border/50 bg-background p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-primary" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Production Lifecycle</p>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Preview-first Hub-backed actions. Live commands run only when the exact batch preview allows them.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {actionButtons.map(({ key, label, icon: Icon, enabled }) => (
          <button
            key={key}
            type="button"
            disabled={!enabled || !batch.id}
            onClick={() => resetFor(key)}
            className={`h-9 rounded-lg border px-2 text-xs font-semibold flex items-center justify-center gap-1.5 ${
              activeAction === key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-foreground border-border disabled:opacity-50'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {activeAction === 'complete' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Actual Units</span>
            <input
              type="number"
              min="1"
              value={completeForm.actual_units}
              onChange={event => setCompleteForm(form => ({ ...form, actual_units: event.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-card px-2 text-xs"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">pH Result</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={completeForm.pH_result}
              onChange={event => setCompleteForm(form => ({ ...form, pH_result: event.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-card px-2 text-xs"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">pH Status</span>
            <select
              value={completeForm.pH_passed_failed}
              onChange={event => setCompleteForm(form => ({ ...form, pH_passed_failed: event.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-card px-2 text-xs"
            >
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Batch Status</span>
            <select
              value={completeForm.passed_failed}
              onChange={event => setCompleteForm(form => ({ ...form, passed_failed: event.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-card px-2 text-xs"
            >
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Staff On Duty</span>
            <input
              value={completeForm.staff_on_duty}
              onChange={event => setCompleteForm(form => ({ ...form, staff_on_duty: event.target.value }))}
              placeholder="Comma-separated names"
              className="w-full h-9 rounded-lg border border-border bg-card px-2 text-xs"
            />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Notes</span>
            <textarea
              value={completeForm.notes}
              onChange={event => setCompleteForm(form => ({ ...form, notes: event.target.value }))}
              rows={2}
              className="w-full rounded-lg border border-border bg-card px-2 py-2 text-xs"
            />
          </label>
          {[
            ['calibration_checked', 'Calibration checked'],
            ['ccp_check_complete', 'CCP check complete'],
            ['sanitation_verification_complete', 'Sanitation verified'],
            ['labels_applied', 'Labels applied'],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={completeForm[key]}
                onChange={event => setCompleteForm(form => ({ ...form, [key]: event.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
      )}

      {message && (
        <p className={`text-xs ${
          message.type === 'error'
            ? 'text-destructive'
            : message.type === 'warn'
              ? 'text-amber-700'
              : 'text-green-700'
        }`}>
          {message.text}
        </p>
      )}

      {activeAction && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => runPreview(activeAction)}
            disabled={Boolean(pending)}
            className="h-8 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground disabled:opacity-60"
          >
            {pending === `preview_${activeAction}` ? 'Previewing...' : `Preview ${formatLabel(activeAction)}`}
          </button>
          <button
            type="button"
            onClick={() => runLive(activeAction)}
            disabled={!preview?.live_allowed || Boolean(pending)}
            className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {pending === `live_${activeAction}` ? 'Running...' : `Run ${formatLabel(activeAction)}`}
          </button>
        </div>
      )}

      <PreviewResult preview={preview} />
    </div>
  );
}

function InventoryDeductionPanel({ batch, onDeductionSuccess }) {
  const [preview, setPreview] = useState(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [deductPending, setDeductPending] = useState(false);
  const [message, setMessage] = useState(null);

  async function previewDeduction() {
    setPreviewPending(true);
    setMessage(null);

    try {
      const res = await base44.functions.invoke('previewAdminProductionInventoryDeduction', {
        production_batch_id: batch.id,
        batch_id: batch.batch_id,
        expected_status: batch.status,
        request_id: requestIdFor('inventory_preview', batch),
      });
      const result = res?.data || res;
      if (result?.error && result?.success !== true) throw new Error(result.error);
      setPreview(result);
      setMessage({
        type: result?.live_allowed ? 'success' : 'warn',
        text: result?.live_allowed
          ? 'Inventory deduction is allowed for this batch.'
          : 'Inventory deduction is not currently allowed. Review blockers below.',
      });
    } catch {
      setMessage({ type: 'error', text: 'Unable to preview inventory deduction.' });
    } finally {
      setPreviewPending(false);
    }
  }

  async function deductInventory() {
    if (!preview?.live_allowed) return;
    if (!window.confirm(`Deduct inventory for ${batch.batch_id || batch.product_name}? This updates Hub inventory stock and cannot be previewed again as a new deduction.`)) {
      return;
    }

    setDeductPending(true);
    setMessage(null);

    try {
      const res = await base44.functions.invoke('deductAdminProductionInventory', {
        production_batch_id: batch.id,
        batch_id: batch.batch_id,
        expected_status: batch.status,
        request_id: requestIdFor('inventory_deduct', batch),
        reason: 'Admin Production Queue inventory deduction.',
      });
      const result = res?.data || res;
      if (!result?.success) throw new Error(result?.error || 'deduction_failed');
      setMessage({
        type: result.skipped ? 'warn' : 'success',
        text: result.skipped ? 'Inventory deduction was already recorded.' : 'Inventory deduction completed.',
      });
      await onDeductionSuccess?.();
    } catch {
      setMessage({ type: 'error', text: 'Unable to deduct inventory. Hub gates may still be closed.' });
    } finally {
      setDeductPending(false);
    }
  }

  const blockers = Array.isArray(preview?.blockers) ? preview.blockers : [];
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
  const rows = Array.isArray(preview?.deduction_preview_rows) ? preview.deduction_preview_rows : [];

  return (
    <div className="rounded-lg border border-border/50 bg-background p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Inventory Deduction</p>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Preview-first Hub action. No purchase orders or Customer App records are updated.
          </p>
        </div>
        <button
          type="button"
          onClick={previewDeduction}
          disabled={previewPending || !batch.id}
          className="h-8 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground disabled:opacity-60"
        >
          {previewPending ? 'Previewing...' : 'Preview'}
        </button>
      </div>

      {message && (
        <p className={`text-xs ${
          message.type === 'error'
            ? 'text-destructive'
            : message.type === 'warn'
              ? 'text-amber-700'
              : 'text-green-700'
        }`}>
          {message.text}
        </p>
      )}

      {preview && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Rows</p>
              <p className="text-sm font-bold">{preview.deduction_preview_count ?? rows.length}</p>
            </div>
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Used</p>
              <p className="text-sm font-bold">{preview.ingredients_used_count ?? '-'}</p>
            </div>
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Allowed</p>
              <p className="text-sm font-bold">{preview.live_allowed ? 'Yes' : 'No'}</p>
            </div>
          </div>

          {(blockers.length > 0 || warnings.length > 0) && (
            <div className="space-y-1">
              {blockers.map(blocker => (
                <div key={`blocker-${blocker}`} className="flex items-start gap-2 text-xs text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{formatLabel(blocker)}</span>
                </div>
              ))}
              {warnings.map(warning => (
                <div key={`warning-${warning}`} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{formatLabel(warning)}</span>
                </div>
              ))}
            </div>
          )}

          {rows.length > 0 && (
            <div className="space-y-1.5">
              {rows.slice(0, 8).map(row => (
                <div
                  key={`${row.ingredient_name}-${row.inventory_item_id}`}
                  className="rounded-md bg-card px-2 py-1.5 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{row.ingredient_name || 'Ingredient'}</p>
                      <p className="text-muted-foreground">
                        Deduct {formatNumber(row.quantity_to_deduct)} {row.inventory_unit || row.unit || ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <AdminStatusPill value={row.status} label={formatLabel(row.status)} />
                      <p className="text-muted-foreground">
                        {formatNumber(row.current_stock)} → {formatNumber(row.projected_stock)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              {rows.length > 8 && (
                <p className="text-[10px] text-muted-foreground">Showing 8 of {rows.length} preview rows.</p>
              )}
            </div>
          )}

          {preview.live_allowed && (
            <button
              type="button"
              onClick={deductInventory}
              disabled={deductPending}
              className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
            >
              {deductPending ? 'Deducting...' : 'Deduct Inventory'}
            </button>
          )}

          {!preview.live_allowed && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Live deduction remains gated until the Hub preview allows this exact batch.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IngredientUsageCorrectionPanel({ batch, onCorrectionSuccess }) {
  const [preview, setPreview] = useState(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [correctionPending, setCorrectionPending] = useState(false);
  const [message, setMessage] = useState(null);

  async function previewCorrection() {
    setPreviewPending(true);
    setMessage(null);

    try {
      const res = await base44.functions.invoke('previewAdminProductionIngredientUsageCorrection', {
        production_batch_id: batch.id,
        batch_id: batch.batch_id,
        expected_status: batch.status,
        request_id: requestIdFor('ingredient_usage_preview', batch),
      });
      const result = res?.data || res;
      if (result?.error && result?.success !== true) throw new Error(result.error);
      setPreview(result);
      setMessage({
        type: result?.usage_correction_allowed ? 'success' : 'warn',
        text: result?.usage_correction_allowed
          ? 'Ingredient usage correction is ready for this batch.'
          : 'Ingredient usage correction has blockers. Review the rows below.',
      });
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to preview ingredient usage correction.' });
    } finally {
      setPreviewPending(false);
    }
  }

  async function correctIngredientUsage() {
    if (!preview?.usage_correction_allowed) return;
    if (!window.confirm(`Correct ingredient usage for ${batch.batch_id || batch.product_name}? This writes batch ingredient usage only; it does not deduct inventory or create purchase orders.`)) {
      return;
    }

    setCorrectionPending(true);
    setMessage(null);

    try {
      const res = await base44.functions.invoke('correctAdminProductionIngredientUsage', {
        production_batch_id: batch.id,
        batch_id: batch.batch_id,
        expected_status: batch.status,
        request_id: requestIdFor('ingredient_usage_correct', batch),
        reason: 'Admin Production Queue ingredient usage correction.',
      });
      const result = res?.data || res;
      if (!result?.success) throw new Error(result?.error || 'ingredient_usage_correction_failed');
      setMessage({
        type: result.skipped ? 'warn' : 'success',
        text: result.skipped ? 'Ingredient usage correction was already recorded.' : 'Ingredient usage correction completed.',
      });
      await onCorrectionSuccess?.();
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to correct ingredient usage. Hub gates may still be closed.' });
    } finally {
      setCorrectionPending(false);
    }
  }

  const rows = Array.isArray(preview?.proposed_ingredient_usage_rows) ? preview.proposed_ingredient_usage_rows : [];
  const correctionBlockers = Array.isArray(preview?.correction_blockers) ? preview.correction_blockers : [];
  const deductionBlockers = Array.isArray(preview?.deduction_blockers) ? preview.deduction_blockers : [];
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];

  return (
    <div className="rounded-lg border border-border/50 bg-background p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Ingredient Usage</p>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Preview recipe-derived usage rows. Corrections do not deduct inventory or create purchase orders.
          </p>
        </div>
        <button
          type="button"
          onClick={previewCorrection}
          disabled={previewPending || !batch.id}
          className="h-8 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground disabled:opacity-60"
        >
          {previewPending ? 'Previewing...' : 'Preview'}
        </button>
      </div>

      {message && (
        <p className={`text-xs ${
          message.type === 'error'
            ? 'text-destructive'
            : message.type === 'warn'
              ? 'text-amber-700'
              : 'text-green-700'
        }`}>
          {message.text}
        </p>
      )}

      {preview && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Rows</p>
              <p className="text-sm font-bold">{preview.usage_correction_preview_count ?? rows.length}</p>
            </div>
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Ready</p>
              <p className="text-sm font-bold">{preview.usage_correction_ready_count ?? 0}</p>
            </div>
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Procure</p>
              <p className="text-sm font-bold">{preview.procurement_needed_count ?? 0}</p>
            </div>
          </div>

          {(correctionBlockers.length > 0 || deductionBlockers.length > 0 || warnings.length > 0) && (
            <div className="space-y-1">
              {correctionBlockers.map(blocker => (
                <div key={`correction-${blocker}`} className="flex items-start gap-2 text-xs text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Correction blocker: {formatLabel(blocker)}</span>
                </div>
              ))}
              {deductionBlockers.map(blocker => (
                <div key={`deduction-${blocker}`} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Deduction blocker: {formatLabel(blocker)}</span>
                </div>
              ))}
              {warnings.map(warning => (
                <div key={`ingredient-warning-${warning}`} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{formatLabel(warning)}</span>
                </div>
              ))}
            </div>
          )}

          {rows.length > 0 && (
            <div className="space-y-1.5">
              {rows.slice(0, 8).map(row => {
                const usage = row.proposed_ingredient_usage || {};
                return (
                  <div
                    key={`${row.matched_recipe_ingredient_name || usage.ingredient_name}-${usage.unit || row.recipe_unit_label}`}
                    className="rounded-md bg-card px-2 py-1.5 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground truncate">
                          {usage.ingredient_name || row.matched_recipe_ingredient_name || 'Ingredient'}
                        </p>
                        <p className="text-muted-foreground">
                          Use {formatNumber(usage.quantity)} {usage.unit || ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <AdminStatusPill
                          value={row.usage_row_ready ? 'ready' : 'blocked'}
                          label={row.usage_row_ready ? 'Ready' : 'Blocked'}
                        />
                        {row.procurement_needed && (
                          <p className="text-[10px] text-amber-700">Procurement needed</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {rows.length > 8 && (
                <p className="text-[10px] text-muted-foreground">Showing 8 of {rows.length} proposed rows.</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={correctIngredientUsage}
              disabled={!preview.usage_correction_allowed || correctionPending}
              className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {correctionPending ? 'Correcting...' : 'Correct Usage'}
            </button>
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Inventory deduction remains a separate gated action.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PostVerifyCascadesPanel({ batch, onCascadeSuccess }) {
  const [preview, setPreview] = useState(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [actionPending, setActionPending] = useState(null);
  const [message, setMessage] = useState(null);

  async function previewCascades() {
    setPreviewPending(true);
    setMessage(null);

    try {
      const res = await base44.functions.invoke('previewAdminProductionVerifyCascades', {
        production_batch_id: batch.id,
        batch_id: batch.batch_id,
        expected_status: batch.status,
        request_id: requestIdFor('verify_cascade_preview', batch),
      });
      const result = res?.data || res;
      if (result?.error && result?.success !== true) throw new Error(result.error);
      setPreview(result);
      setMessage({
        type: result?.cascade_preview_allowed ? 'success' : 'warn',
        text: result?.cascade_preview_allowed
          ? 'Post-verify cascade preview is ready.'
          : 'Post-verify cascades are not currently eligible.',
      });
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to preview post-verify cascades.' });
    } finally {
      setPreviewPending(false);
    }
  }

  async function packFulfillmentTasks() {
    const taskIds = (preview?.task_update_summaries || [])
      .filter(row => row?.will_update && row?.task_id)
      .map(row => row.task_id);
    if (!preview?.pack_cascade_allowed || taskIds.length === 0) return;
    if (!window.confirm(`Pack ${taskIds.length} fulfillment task${taskIds.length === 1 ? '' : 's'} for ${batch.batch_id || batch.product_name}? Order status cascades remain deferred.`)) {
      return;
    }

    setActionPending('pack');
    setMessage(null);

    try {
      const res = await base44.functions.invoke('packAdminProductionVerifyFulfillmentTasks', {
        production_batch_id: batch.id,
        batch_id: batch.batch_id,
        expected_status: batch.status,
        fulfillment_task_ids: taskIds,
        request_id: requestIdFor('pack_tasks', batch),
        reason: 'Admin Production Queue post-verify task pack.',
      });
      const result = res?.data || res;
      if (!result?.success) throw new Error(result?.error || 'pack_tasks_failed');
      setMessage({
        type: result.skipped ? 'warn' : 'success',
        text: result.skipped ? 'Task pack cascade was already recorded.' : `Packed ${result.packed_task_count || taskIds.length} task(s).`,
      });
      await onCascadeSuccess?.();
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to pack fulfillment tasks. Hub gates may still be closed.' });
    } finally {
      setActionPending(null);
    }
  }

  async function bottleSingleOrder() {
    const eligibleOrders = (preview?.order_update_summaries || []).filter(row => row?.will_update && row?.order_id);
    const order = eligibleOrders[0];
    if (!preview?.bottled_order_cascade_allowed || eligibleOrders.length !== 1 || !order) return;
    if (!window.confirm(`Mark order ${order.order_number || order.order_id} bottled for ${batch.batch_id || batch.product_name}? Customer App sync and notifications remain deferred by the Hub command.`)) {
      return;
    }

    setActionPending('bottle');
    setMessage(null);

    try {
      const res = await base44.functions.invoke('bottleAdminProductionVerifyShopifyOrder', {
        production_batch_id: batch.id,
        batch_id: batch.batch_id,
        expected_status: batch.status,
        shopify_order_id: order.order_id,
        expected_production_status: order.current_production_status || 'packed',
        request_id: requestIdFor('bottle_order', batch),
        reason: 'Admin Production Queue post-verify order bottled cascade.',
      });
      const result = res?.data || res;
      if (!result?.success) throw new Error(result?.error || 'bottle_order_failed');
      setMessage({
        type: result.skipped ? 'warn' : 'success',
        text: result.skipped ? 'Order bottled cascade was already recorded.' : 'Order marked bottled.',
      });
      await onCascadeSuccess?.();
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to bottle order. Hub gates may still be closed.' });
    } finally {
      setActionPending(null);
    }
  }

  const taskRows = Array.isArray(preview?.task_update_summaries) ? preview.task_update_summaries : [];
  const orderRows = Array.isArray(preview?.order_update_summaries) ? preview.order_update_summaries : [];
  const blockers = Array.isArray(preview?.blockers) ? preview.blockers : [];
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
  const eligibleOrders = orderRows.filter(row => row?.will_update && row?.order_id);
  const packableTasks = taskRows.filter(row => row?.will_update && row?.task_id);
  const canBottleOneOrder = preview?.bottled_order_cascade_allowed && eligibleOrders.length === 1;

  return (
    <div className="rounded-lg border border-border/50 bg-background p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-primary" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Post-Verify Cascades</p>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Preview linked task packing and one-order bottled cascade. Subscription and multi-order cascades remain guarded.
          </p>
        </div>
        <button
          type="button"
          onClick={previewCascades}
          disabled={previewPending || !batch.id}
          className="h-8 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground disabled:opacity-60"
        >
          {previewPending ? 'Previewing...' : 'Preview'}
        </button>
      </div>

      {message && (
        <p className={`text-xs ${
          message.type === 'error'
            ? 'text-destructive'
            : message.type === 'warn'
              ? 'text-amber-700'
              : 'text-green-700'
        }`}>
          {message.text}
        </p>
      )}

      {preview && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Tasks</p>
              <p className="text-sm font-bold">{preview.packable_task_count || 0}/{preview.linked_task_count || 0}</p>
            </div>
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Orders</p>
              <p className="text-sm font-bold">{preview.eligible_bottled_order_count || 0}/{preview.linked_order_count || 0}</p>
            </div>
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Subs</p>
              <p className="text-sm font-bold">{preview.subscription_order_count || 0}</p>
            </div>
          </div>

          {(blockers.length > 0 || warnings.length > 0) && (
            <div className="space-y-1">
              {blockers.map(blocker => (
                <div key={`cascade-blocker-${blocker}`} className="flex items-start gap-2 text-xs text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Blocker: {formatLabel(blocker)}</span>
                </div>
              ))}
              {warnings.map(warning => (
                <div key={`cascade-warning-${warning}`} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{formatLabel(warning)}</span>
                </div>
              ))}
            </div>
          )}

          {(taskRows.length > 0 || orderRows.length > 0) && (
            <div className="space-y-2">
              {taskRows.slice(0, 5).map(row => (
                <div key={`task-${row.task_id || row.order_number}`} className="rounded-md bg-card px-2 py-1.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{row.order_number || row.task_id || 'Fulfillment task'}</p>
                      <p className="text-muted-foreground">{formatLabel(row.current_status)} → {formatLabel(row.projected_status)}</p>
                    </div>
                    <AdminStatusPill value={row.will_update ? 'ready' : 'blocked'} label={row.will_update ? 'Pack' : 'Blocked'} />
                  </div>
                </div>
              ))}
              {orderRows.slice(0, 5).map(row => (
                <div key={`order-${row.order_id || row.order_number}`} className="rounded-md bg-card px-2 py-1.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{row.order_number || row.order_id || 'Order'}</p>
                      <p className="text-muted-foreground">
                        {formatLabel(row.current_production_status)} → {formatLabel(row.projected_production_status)}
                      </p>
                    </div>
                    <AdminStatusPill value={row.will_update ? 'ready' : 'blocked'} label={row.will_update ? 'Bottle' : 'Blocked'} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={packFulfillmentTasks}
              disabled={!preview.pack_cascade_allowed || packableTasks.length === 0 || Boolean(actionPending)}
              className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {actionPending === 'pack' ? 'Packing...' : `Pack Tasks (${packableTasks.length})`}
            </button>
            <button
              type="button"
              onClick={bottleSingleOrder}
              disabled={!canBottleOneOrder || Boolean(actionPending)}
              className="h-9 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground disabled:opacity-50"
            >
              {actionPending === 'bottle' ? 'Bottling...' : 'Bottle One Order'}
            </button>
          </div>

          {preview.bottled_order_cascade_allowed && eligibleOrders.length !== 1 && (
            <p className="text-[10px] text-amber-700">
              Bottled cascade requires exactly one eligible non-subscription order from this page. Use a narrower, approved command for multi-order cases.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function getBatchTab(batch, today) {
  if (isNeedsVerificationStatus(batch.status)) return 'verify';
  if (isInProgressStatus(batch.status)) return 'in_progress';
  if (isDoneStatus(batch.status) || (batch.production_date && batch.production_date < today)) return 'history';
  return 'today';
}

function uniqueOptions(items, field) {
  return [...new Set(items.map(item => item[field]).filter(Boolean))]
    .sort((a, b) => formatLabel(a).localeCompare(formatLabel(b)));
}

function groupByProductionDate(items) {
  return items.reduce((groups, batch) => {
    const date = batch.production_date || 'unscheduled';
    if (!groups[date]) groups[date] = [];
    groups[date].push(batch);
    return groups;
  }, {});
}

function BatchCard({ batch, onActionSuccess }) {
  const categoryAccent = isShotCategory(batch.product_category) ? 'border-l-amber-400' : 'border-l-primary';

  return (
    <div className={`rounded-xl border border-border/50 border-l-4 ${categoryAccent} bg-card p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-bold text-foreground mt-0.5">{batch.product_name || 'Unnamed product'}</h2>
          <p className="text-xs text-muted-foreground">{batch.product_category || 'Uncategorized'}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {batch.is_locked && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground border border-border/60">
              <Lock className="w-3 h-3" />
              Locked
            </span>
          )}
          <AdminStatusPill value={batch.status} label={formatLabel(batch.status)} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-secondary/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Needed</p>
          <p className="text-sm font-bold">{batch.planned_units ?? '-'}</p>
        </div>
        <div className="rounded-lg bg-secondary/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Produced</p>
          <p className="text-sm font-bold">{batch.actual_units ?? '-'}</p>
        </div>
        <div className="rounded-lg bg-secondary/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Orders</p>
          <p className="text-sm font-bold">{batch.order_count || 0}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Batch ID</p>
        <p className="text-xs font-medium text-foreground break-words">{batch.batch_id || 'No batch id'}</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Order refs</p>
        <p className="text-xs text-foreground break-words">{compactOrderNumbers(batch.order_numbers)}</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Source mix</p>
        <p className="text-xs text-foreground">{sourceTypeSummary(batch.source_type_counts)}</p>
      </div>

      {batch.updated_date && (
        <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
          Last Hub update: {formatDateTime(batch.updated_date)}
        </p>
      )}

      <ProductionLifecyclePanel batch={batch} onActionSuccess={onActionSuccess} />
      <IngredientUsageCorrectionPanel batch={batch} onCorrectionSuccess={onActionSuccess} />
      {batch.status === 'verified_logged' && (
        <PostVerifyCascadesPanel batch={batch} onCascadeSuccess={onActionSuccess} />
      )}
      <InventoryDeductionPanel batch={batch} onDeductionSuccess={onActionSuccess} />
    </div>
  );
}

function ProductionDateSection({ date, batches, today, onActionSuccess }) {
  const isToday = date === today;
  const isPast = date !== 'unscheduled' && date < today;
  const neededUnits = batches.reduce((total, batch) => total + (Number(batch.planned_units) || 0), 0);
  const producedUnits = batches.reduce((total, batch) => total + (Number(batch.actual_units) || 0), 0);
  const productCount = batches.length;
  const headerClass = isToday
    ? 'bg-primary/10 border-primary/30'
    : isPast
      ? 'bg-muted/40 border-border'
      : 'bg-muted/30 border-border';
  const titleClass = isToday ? 'text-primary' : 'text-foreground';
  const dateLabel = date === 'unscheduled'
    ? 'Production Date Pending'
    : isToday
      ? `Today - ${formatDate(date)}`
      : formatDate(date);

  return (
    <section className="space-y-3">
      <div className={`rounded-xl border p-3 ${headerClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className={`text-sm font-bold ${titleClass}`}>{dateLabel}</h2>
            <p className="text-xs text-foreground/70 mt-0.5 font-medium">
              {productCount} product{productCount !== 1 ? 's' : ''} · {neededUnits} needed
              {` · ${producedUnits} produced`}
            </p>
          </div>
          <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-card/70 border border-border text-muted-foreground">
            Hub Production
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {batches.map(batch => (
          <BatchCard
            key={batch.id || batch.batch_id}
            batch={batch}
            onActionSuccess={onActionSuccess}
          />
        ))}
      </div>
    </section>
  );
}

export default function ProductionQueueSummary() {
  const { user } = useAuth();
  const defaultFrom = useMemo(() => todayDate(), []);
  const defaultTo = useMemo(() => addDays(defaultFrom, 14), [defaultFrom]);
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [tab, setTab] = useState('today');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const rangeDays = dateFrom && dateTo ? daysInclusive(dateFrom, dateTo) : null;
  const rangeInvalid = Boolean(!dateFrom || !dateTo || dateTo < dateFrom || rangeDays > 31);

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ['admin-production-queue-summary', dateFrom, dateTo],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminProductionQueueSummary', {
        date_from: dateFrom,
        date_to: dateTo,
        limit: 100,
      });
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result || { batches: [] };
    },
    enabled: user?.role === 'admin' && !rangeInvalid,
    staleTime: 60000,
  });

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Admin access required.</p>
      </div>
    );
  }

  const allBatches = data?.batches || [];
  const categoryOptions = uniqueOptions(allBatches, 'product_category');
  const statusOptions = uniqueOptions(allBatches, 'status');
  const filteredBatches = allBatches.filter(batch => {
    if (categoryFilter !== 'all' && batch.product_category !== categoryFilter) return false;
    if (statusFilter !== 'all' && batch.status !== statusFilter) return false;
    return getBatchTab(batch, defaultFrom) === tab;
  });
  const groupedBatches = groupByProductionDate(filteredBatches);
  const sortedDates = Object.keys(groupedBatches).sort((a, b) => {
    if (a === 'unscheduled') return 1;
    if (b === 'unscheduled') return -1;
    return a.localeCompare(b);
  });
  const totalNeeded = filteredBatches.reduce((total, batch) => total + (Number(batch.planned_units) || 0), 0);

  const tabs = [
    { id: 'today', label: 'Today & Upcoming' },
    { id: 'in_progress', label: 'In Progress' },
    { id: 'verify', label: 'Needs Verification' },
    { id: 'history', label: 'History' },
  ];

  return (
    <div className="min-h-screen bg-background pb-10">
      <AdminOpsHeader
        title="Production Queue"
        subtitle="Hub production summary with gated inventory actions"
        badge="Ops v1"
        badgeTone="warning"
      />

      <div className="px-4 mt-4 space-y-4">
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Production date range</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={event => setDateFrom(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">To</span>
              <input
                type="date"
                value={dateTo}
                onChange={event => setDateTo(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
          </div>
          {rangeInvalid ? (
            <p className="text-xs text-destructive">Choose a valid production date range of 31 days or fewer.</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Showing production batches from {formatDate(dateFrom)} through {formatDate(dateTo)}.
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            Hub data · Inventory deduction is preview-first and remains blocked unless the Hub gates allow the exact batch.
          </p>
          <AdminStatusLegend />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-border/50 bg-card p-3">
            <Package className="w-4 h-4 text-primary mb-1" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Batches</p>
            <p className="text-lg font-bold">{filteredBatches.length}</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Needed</p>
            <p className="text-lg font-bold">{totalNeeded}</p>
            <p className="text-[10px] text-muted-foreground">units</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-3">
            <RefreshCw className={`w-4 h-4 text-primary mb-1 ${isFetching ? 'animate-spin' : ''}`} />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Status</p>
            <p className="text-xs font-semibold">{isFetching ? 'Refreshing' : data?.truncated ? 'Truncated' : 'Current'}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex gap-0 border-b overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
            {tabs.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`shrink-0 whitespace-nowrap px-3 py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
                  tab === item.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Category</span>
              <select
                value={categoryFilter}
                onChange={event => setCategoryFilter(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All</option>
                {categoryOptions.map(category => (
                  <option key={category} value={category}>{formatLabel(category)}</option>
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
                <option value="all">All</option>
                {statusOptions.map(status => (
                  <option key={status} value={status}>{formatLabel(status)}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load production queue summary</p>
            <p className="text-xs text-muted-foreground mt-1">{error?.message || 'Try again later.'}</p>
          </div>
        ) : !rangeInvalid && allBatches.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No upcoming production scheduled</p>
            <p className="text-xs text-muted-foreground mt-1">This date range has no Hub production queue summary yet.</p>
          </div>
        ) : !rangeInvalid && filteredBatches.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No production batches match this view</p>
            <p className="text-xs text-muted-foreground mt-1">Try another Hub production tab, category, or status filter.</p>
          </div>
        ) : !rangeInvalid ? (
          <div className="space-y-6">
            {data?.truncated && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Results are capped at 100 batches. Narrow the date range for a complete view.
              </p>
            )}
            {sortedDates.map(date => (
              <ProductionDateSection
                key={date}
                    date={date}
                    batches={groupedBatches[date]}
                    today={defaultFrom}
                    onActionSuccess={refetch}
                  />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
