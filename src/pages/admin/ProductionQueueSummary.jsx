import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardCheck, Database, Lock, Package, Play, RefreshCw } from 'lucide-react';
import { AdminStatusLegend, AdminStatusPill } from '@/components/admin/AdminStatusPill';
import StaffMemberPicker from '@/components/admin/StaffMemberPicker';
import ProductionPreStartModal from '@/components/admin/ProductionPreStartModal';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/admin-access';
import { unwrapBase44Result } from '@/lib/base44-result';
import { usePageVisibility } from '@/lib/usePageVisibility';

function todayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = `${today.getMonth() + 1}`.padStart(2, '0');
  const day = `${today.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const LIVE_INVENTORY_DEDUCTION_REQUIRES_EXACT_APPROVAL = true;

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

function productionQueueDatePresets(today) {
  return [
    {
      id: 'today',
      label: 'Today + 14',
      dateFrom: today,
      dateTo: addDays(today, 14),
      tab: 'today',
    },
    {
      id: 'last31',
      label: 'Last 31 Days',
      dateFrom: addDays(today, -30),
      dateTo: today,
      tab: 'history',
    },
  ];
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

function formatSourceWarning(value) {
  return formatLabel(value)
    .replace(/\bHub\b/g, 'Source')
    .replace(/\bhub\b/g, 'source');
}

function sourceTypeSummary(sourceTypeCounts) {
  const entries = Object.entries(sourceTypeCounts || {});
  if (entries.length === 0) return 'No source mix';
  return entries
    .map(([source, count]) => `${formatLabel(source)}: ${count}`)
    .join(' · ');
}

function isNativeBatch(batch) {
  return batch?.source === 'customer_app_native';
}

function batchSourceLabel(batch) {
  if (batch?.source_label) return batch.source_label;
  return isNativeBatch(batch) ? 'Native Customer App' : 'Source';
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

      <p className={`text-xs ${preview.live_allowed ? 'text-green-700 dark:text-green-300' : 'text-cyan-700 dark:text-cyan-300'}`}>
        {previewStatusText(preview)}
      </p>

      {(blockers.length > 0 || warnings.length > 0) && (
        <div className="space-y-1">
          {blockers.map(blocker => (
            <p key={`blocker-${blocker}`} className="text-xs text-cyan-800 dark:text-cyan-200">Blocker: {formatLabel(blocker)}</p>
          ))}
          {warnings.map(warning => (
            <p key={`warning-${warning}`} className="text-xs text-muted-foreground">Warning: {formatLabel(warning)}</p>
          ))}
        </div>
      )}

      {projectedWrites.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Checked fields: {projectedWrites.map(formatLabel).join(', ')}
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
  const [preStartModalOpen, setPreStartModalOpen] = useState(false);
  const [preStartReady, setPreStartReady] = useState(false);
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
    if (action === 'start') setPreStartModalOpen(true);
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
      const result = unwrapBase44Result(res);
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
    if (action === 'start' && !preStartReady) {
      setMessage({ type: 'error', text: 'Complete the record-backed pre-start checklist before running Start for this batch.' });
      setPreStartModalOpen(true);
      return;
    }
    const label = formatLabel(action);
    if (!window.confirm(`${label} ${batch.batch_id || batch.product_name}? This runs the approved source-backed production command for this exact batch.`)) {
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
      const result = unwrapBase44Result(res);
      if (!result?.success) throw new Error(result?.error || `${action}_failed`);
      setMessage({
        type: result.skipped ? 'warn' : 'success',
        text: result.skipped ? `${label} was already recorded.` : `${label} completed.`,
      });
      setPreview(null);
      setActiveAction(null);
      await onActionSuccess?.();
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || `Unable to run ${action}. Source gates may still be closed.` });
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
            Start, Complete, and Verify are the working batch steps. Each action checks exact batch permissions before saving.
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
                ? 'bg-nuvira-gradient text-white border-primary'
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
          <div className="sm:col-span-2">
            <StaffMemberPicker
              label="Staff on duty"
              value={completeForm.staff_on_duty}
              onChange={value => setCompleteForm(form => ({ ...form, staff_on_duty: value }))}
              multiple
              helperText="Tap names to build the staff list, or type another name if needed."
            />
          </div>
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
              ? 'text-cyan-700 dark:text-cyan-300'
              : 'text-green-700 dark:text-green-300'
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
            disabled={!preview?.live_allowed || Boolean(pending) || (activeAction === 'start' && !preStartReady)}
            className="h-8 rounded-lg bg-nuvira-gradient px-3 text-xs font-semibold text-white disabled:opacity-50"
          >
            {pending === `live_${activeAction}`
              ? 'Running...'
              : activeAction === 'start' && !preStartReady
                ? 'Complete Pre-start Checklist First'
                : `Run ${formatLabel(activeAction)}`}
          </button>
        </div>
      )}

      <PreviewResult preview={preview} />
      <ProductionPreStartModal
        batch={batch}
        open={preStartModalOpen}
        onOpenChange={setPreStartModalOpen}
        onReadyChange={setPreStartReady}
        onContinue={() => {
          setPreStartModalOpen(false);
          runPreview('start');
        }}
      />
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
      const result = unwrapBase44Result(res);
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
    if (!window.confirm(`Deduct inventory for ${batch.batch_id || batch.product_name}? This updates source inventory stock and cannot be previewed again as a new deduction.`)) {
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
      const result = unwrapBase44Result(res);
      if (!result?.success) throw new Error(result?.error || 'deduction_failed');
      setMessage({
        type: result.skipped ? 'warn' : 'success',
        text: result.skipped ? 'Inventory deduction was already recorded.' : 'Inventory deduction completed.',
      });
      setPreview(null);
      await onDeductionSuccess?.();
    } catch {
      setMessage({ type: 'error', text: 'Unable to deduct inventory. Source gates may still be closed.' });
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
            Preview-only until an exact inventory deduction is approved. No stock deduction, purchase orders, or Customer App records are updated here.
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
              ? 'text-cyan-700 dark:text-cyan-300'
              : 'text-green-700 dark:text-green-300'
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
                <div key={`blocker-${blocker}`} className="flex items-start gap-2 text-xs text-cyan-800 dark:text-cyan-200">
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
              disabled={LIVE_INVENTORY_DEDUCTION_REQUIRES_EXACT_APPROVAL || deductPending}
              className="h-9 rounded-lg bg-nuvira-gradient px-3 text-xs font-semibold text-white disabled:opacity-60"
            >
              {LIVE_INVENTORY_DEDUCTION_REQUIRES_EXACT_APPROVAL ? 'Deduction Requires Approval' : deductPending ? 'Deducting...' : 'Deduct Inventory'}
            </button>
          )}

          {preview.live_allowed && LIVE_INVENTORY_DEDUCTION_REQUIRES_EXACT_APPROVAL && (
            <div className="flex items-start gap-2 text-xs text-cyan-800 dark:text-cyan-200">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Preview passed, but live inventory deduction is still disabled until an exact deduction run is approved. Use this as procurement context only.</span>
            </div>
          )}

          {!preview.live_allowed && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Live deduction remains gated until the source preview allows this exact batch.</span>
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
      const result = unwrapBase44Result(res);
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
      const result = unwrapBase44Result(res);
      if (!result?.success) throw new Error(result?.error || 'ingredient_usage_correction_failed');
      setMessage({
        type: result.skipped ? 'warn' : 'success',
        text: result.skipped ? 'Ingredient usage correction was already recorded.' : 'Ingredient usage correction completed.',
      });
      setPreview(null);
      await onCorrectionSuccess?.();
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to correct ingredient usage. Source gates may still be closed.' });
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
              ? 'text-cyan-700 dark:text-cyan-300'
              : 'text-green-700 dark:text-green-300'
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
                <div key={`correction-${blocker}`} className="flex items-start gap-2 text-xs text-cyan-800 dark:text-cyan-200">
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
                          <p className="text-[10px] text-cyan-700 dark:text-cyan-300">Procurement needed</p>
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
              className="h-9 rounded-lg bg-nuvira-gradient px-3 text-xs font-semibold text-white disabled:opacity-50"
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
      const result = unwrapBase44Result(res);
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
      const result = unwrapBase44Result(res);
      if (!result?.success) throw new Error(result?.error || 'pack_tasks_failed');
      setMessage({
        type: result.skipped ? 'warn' : 'success',
        text: result.skipped ? 'Task pack cascade was already recorded.' : `Packed ${result.packed_task_count || taskIds.length} task(s).`,
      });
      setPreview(null);
      await onCascadeSuccess?.();
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to pack fulfillment tasks. Source gates may still be closed.' });
    } finally {
      setActionPending(null);
    }
  }

  async function bottleSingleOrder() {
    const eligibleOrders = (preview?.order_update_summaries || []).filter(row => row?.will_update && row?.order_id);
    const order = eligibleOrders[0];
    if (!preview?.bottled_order_cascade_allowed || eligibleOrders.length !== 1 || !order) return;
    if (!window.confirm(`Mark order ${order.order_number || order.order_id} bottled for ${batch.batch_id || batch.product_name}? Customer App sync and notifications remain deferred by the source command.`)) {
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
      const result = unwrapBase44Result(res);
      if (!result?.success) throw new Error(result?.error || 'bottle_order_failed');
      setMessage({
        type: result.skipped ? 'warn' : 'success',
        text: result.skipped ? 'Order bottled cascade was already recorded.' : 'Order marked bottled.',
      });
      setPreview(null);
      await onCascadeSuccess?.();
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to bottle order. Source gates may still be closed.' });
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
              ? 'text-cyan-700 dark:text-cyan-300'
              : 'text-green-700 dark:text-green-300'
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
                <div key={`cascade-blocker-${blocker}`} className="flex items-start gap-2 text-xs text-cyan-800 dark:text-cyan-200">
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
              className="h-9 rounded-lg bg-nuvira-gradient px-3 text-xs font-semibold text-white disabled:opacity-50"
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
            <p className="text-[10px] text-cyan-700 dark:text-cyan-300">
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

function NativeBatchReadOnlyNotice() {
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 dark:border-sky-900/60 dark:bg-sky-950/30">
      <div className="flex items-start gap-2">
        <Database className="w-4 h-4 text-sky-700 mt-0.5 shrink-0 dark:text-sky-300" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-sky-900 dark:text-sky-100">Native Customer App batch</p>
          <p className="text-xs text-sky-800 mt-1 dark:text-sky-200/80">
            This row can be worked directly in the Customer App backend. Ingredient correction,
            post-verify packing, and inventory deduction stay separated so each operational write remains traceable.
          </p>
        </div>
      </div>
    </div>
  );
}


function nativePreviewReadyForAction(preview, action) {
  if (!preview) return false;
  if (preview.action === action && preview.lifecycle_ready === true) return true;

  if (action === 'start') {
    return Number(preview.start_preview?.ready_count || 0) > 0 &&
      Number(preview.start_preview?.blocked_count || 0) === 0;
  }
  if (action === 'complete') {
    return preview.completion_preview_ready === true ||
      Number(preview.complete_ready_count || preview.complete_preview?.ready_count || 0) > 0;
  }
  if (action === 'verify') {
    return preview.verification_preview_ready === true ||
      Number(preview.verify_ready_count || preview.verify_preview?.ready_count || 0) > 0;
  }
  return false;
}

function nativePreviewWriteAvailable(preview, action) {
  if (!preview || preview.action !== action) return false;
  return preview.native_write_allowed === true || preview.live_command_available === true;
}

function nativePreviewGateBlockers(preview) {
  return Array.isArray(preview?.live_command_blockers) ? preview.live_command_blockers : [];
}

function nativePreviewProjectedWrites(preview, action) {
  if (Array.isArray(preview?.projected_writes) && preview.projected_writes.length > 0) {
    return preview.projected_writes;
  }
  const actionPreview = preview?.[`${action}_preview`];
  return Array.isArray(actionPreview?.expected_writes_if_later_approved)
    ? actionPreview.expected_writes_if_later_approved
    : [];
}

function NativeLifecyclePreviewPanel({ batch, onActionSuccess }) {
  const [activeAction, setActiveAction] = useState(null);
  const [preview, setPreview] = useState(null);
  const [pending, setPending] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [message, setMessage] = useState(null);
  const [preStartModalOpen, setPreStartModalOpen] = useState(false);
  const [preStartReady, setPreStartReady] = useState(false);
  const [completeForm, setCompleteForm] = useState({
    actual_units: batch.actual_units || batch.planned_units || '',
    pH_result: batch.pH_result || '',
    pH_passed_failed: batch.pH_passed_failed || '',
    calibration_checked: batch.calibration_checked === true,
    ccp_check_complete: batch.ccp_check_complete === true,
    sanitation_verification_complete: batch.sanitation_verification_complete === true,
    labels_applied: batch.labels_applied === true,
    passed_failed: batch.passed_failed || '',
    staff_on_duty: Array.isArray(batch.staff_on_duty) ? batch.staff_on_duty.join(', ') : '',
    bottles_produced: batch.bottles_produced || '',
    bottles_rejected_or_wasted: batch.bottles_rejected_or_wasted || '',
    final_usable_quantity: batch.final_usable_quantity || '',
    storage_location: batch.storage_location || '',
    use_by_date: batch.use_by_date || '',
    verification_notes: '',
  });

  useEffect(() => {
    if (activeAction !== 'start') setPreStartReady(false);
  }, [activeAction]);

  function baseNativePayload(action, prefix) {
    return {
      action,
      mode: 'dry_run',
      production_batch_id: batch.id,
      batch_id: batch.batch_id,
      batch,
      request_id: requestIdFor(prefix, batch),
    };
  }

  function nativeCompletionFields() {
    return {
      actual_units: Number(completeForm.actual_units),
      bottles_produced: completeForm.bottles_produced === '' ? undefined : Number(completeForm.bottles_produced),
      bottles_rejected_or_wasted: completeForm.bottles_rejected_or_wasted === '' ? undefined : Number(completeForm.bottles_rejected_or_wasted),
      final_usable_quantity: completeForm.final_usable_quantity === '' ? undefined : Number(completeForm.final_usable_quantity),
      storage_location: completeForm.storage_location,
      use_by_date: completeForm.use_by_date,
    };
  }

  function nativeVerificationFields() {
    return {
      pH_result: Number(completeForm.pH_result),
      pH_passed_failed: completeForm.pH_passed_failed,
      calibration_checked: completeForm.calibration_checked,
      ccp_check_complete: completeForm.ccp_check_complete,
      sanitation_verification_complete: completeForm.sanitation_verification_complete,
      labels_applied: completeForm.labels_applied,
      passed_failed: completeForm.passed_failed,
      staff_on_duty: completeForm.staff_on_duty
        .split(',')
        .map(value => value.trim())
        .filter(Boolean),
      verification_notes: completeForm.verification_notes,
    };
  }

  function executionPayload(action) {
    return {
      mode: 'live',
      confirmation: 'execute_native_production_batch_lifecycle',
      production_batch_id: batch.id,
      batch_id: batch.batch_id,
      action,
      request_id: requestIdFor(`native_${action}_execute`, batch),
      reason: `Admin Production Queue native ${formatLabel(action)}.`,
      ...(action === 'complete' ? nativeCompletionFields() : {}),
      ...(action === 'verify' ? nativeVerificationFields() : {}),
    };
  }

  async function runPreview(action) {
    setActiveAction(action);
    setPending(true);
    setMessage(null);

    try {
      const res = await base44.functions.invoke('previewNativeProductionBatchLifecycle', {
        ...baseNativePayload(action, `native_${action}_preview`),
        ...(action === 'complete' ? nativeCompletionFields() : {}),
        ...(action === 'verify' ? nativeVerificationFields() : {}),
      });
      const result = unwrapBase44Result(res);
      if (result?.error && result?.success !== true) throw new Error(result.error);
      const actionReady = nativePreviewReadyForAction(result, action);
      const writeAvailable = nativePreviewWriteAvailable(result, action);
      setPreview(result);
      setMessage({
        type: actionReady && writeAvailable ? 'success' : 'warn',
        text: actionReady
          ? writeAvailable
            ? `${formatLabel(action)} readiness preview passed and the native operational gate is open.`
            : `${formatLabel(action)} readiness preview passed. Native execution is still blocked by an operational safety gate.`
          : `${formatLabel(action)} has preview blockers or warnings.`,
      });
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || `Unable to preview native ${action}.` });
    } finally {
      setPending(false);
    }
  }

  async function runNative(action) {
    if (!batch.id && !batch.batch_id) {
      setMessage({ type: 'error', text: 'A native ProductionBatch id or batch id is required before execution.' });
      return;
    }
    if (!nativePreviewReadyForAction(preview, action)) {
      setMessage({ type: 'error', text: 'Run a passing preview for this action before executing it.' });
      return;
    }
    if (!nativePreviewWriteAvailable(preview, action)) {
      const gateBlockers = nativePreviewGateBlockers(preview).map(formatLabel).join(', ');
      setMessage({
        type: 'error',
        text: gateBlockers
          ? `Native ${formatLabel(action)} is ready but an operational safety gate is closed: ${gateBlockers}.`
          : `Native ${formatLabel(action)} is ready but an operational safety gate is closed.`,
      });
      return;
    }
    if (action === 'start' && !preStartReady) {
      setMessage({ type: 'error', text: 'Complete the record-backed pre-start checklist before saving Start for this native batch.' });
      setPreStartModalOpen(true);
      return;
    }

    const label = formatLabel(action);
    const warning = action === 'verify'
      ? 'This may create one batch compliance log and link it to this exact ProductionBatch. It will not deduct inventory, update orders, update delivery tasks, send notifications, or call providers.'
      : 'This updates this exact ProductionBatch lifecycle record and audit log. It will not deduct inventory, update orders, update delivery tasks, send notifications, or call providers.';
    if (!window.confirm(`Save ${label} for ${batch.batch_id || batch.product_name}? ${warning}`)) {
      return;
    }

    setActionPending(true);
    setMessage(null);

    try {
      const res = await base44.functions.invoke('executeNativeProductionBatchLifecycle', executionPayload(action));
      const result = unwrapBase44Result(res);
      if (!result?.success) throw new Error(result?.error || result?.error_code || `native_${action}_failed`);
      setMessage({
        type: result.skipped ? 'warn' : 'success',
        text: result.skipped ? `Native ${label} was already recorded.` : `Native ${label} completed.`,
      });
      setPreview(null);
      await onActionSuccess?.();
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || `Unable to run native ${action}. Native gates may still be closed.` });
    } finally {
      setActionPending(false);
    }
  }

  const blockers = Array.isArray(preview?.blockers) ? preview.blockers : [];
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
  const projectedWrites = nativePreviewProjectedWrites(preview, activeAction);
  const actionReady = nativePreviewReadyForAction(preview, activeAction);
  const writeAvailable = nativePreviewWriteAvailable(preview, activeAction);
  const gateBlockers = nativePreviewGateBlockers(preview);
  const actions = [
    {
      key: 'start',
      label: 'Start',
      enabled: !batch.is_locked && !isInProgressStatus(batch.status) && !isNeedsVerificationStatus(batch.status) && !isDoneStatus(batch.status),
    },
    { key: 'complete', label: 'Complete', enabled: isInProgressStatus(batch.status) },
    { key: 'verify', label: 'Verify', enabled: isNeedsVerificationStatus(batch.status) },
  ];

  return (
    <div className="rounded-lg border border-border/50 bg-background p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-primary" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Batch Workflow</p>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Start captures pre-start compliance. Complete records final output. Verify records quality/staff checks.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {actions.map(action => (
          <button
            key={action.key}
            type="button"
            data-testid={`native-lifecycle-${action.key}-${batch.batch_id || batch.id || 'unknown'}`}
            disabled={!action.enabled || pending || actionPending || (!batch.id && !batch.batch_id)}
            onClick={() => {
              if (action.key === 'start') {
                setActiveAction('start');
                setPreview(null);
                setMessage(null);
                setPreStartModalOpen(true);
                return;
              }
              runPreview(action.key);
            }}
            className={`h-9 rounded-lg border px-2 text-xs font-semibold ${
              activeAction === action.key
                ? 'bg-nuvira-gradient text-white border-primary'
                : 'bg-card text-foreground border-border disabled:opacity-50'
            }`}
          >
            {pending && activeAction === action.key ? 'Previewing...' : action.label}
          </button>
        ))}
      </div>

      {!activeAction && isDoneStatus(batch.status) && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
          <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-100">Lifecycle complete.</p>
          <p className="mt-1 text-[11px] leading-relaxed text-emerald-800 dark:text-emerald-200">
            This verified batch is audit-only. Start, Complete, and Verify are closed.
          </p>
        </div>
      )}

      {!activeAction && !isDoneStatus(batch.status) && (
        <div className="rounded-lg border border-border/50 bg-card/70 p-3">
          <p className="text-xs font-semibold text-foreground">Choose the next batch step.</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Start opens pre-start sanitation, daily checklist, and temperature capture for this exact batch. Complete and Verify stay separated for clean records and traceability.
          </p>
        </div>
      )}

      {(activeAction === 'complete' || activeAction === 'verify') && (
        <div className="rounded-lg border border-border/50 bg-card/70 p-3 space-y-3">
          {activeAction === 'complete' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Actual units</span>
                  <input
                    type="number"
                    min="0"
                    value={completeForm.actual_units}
                    onChange={event => setCompleteForm(prev => ({ ...prev, actual_units: event.target.value }))}
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Final usable quantity</span>
                  <input
                    type="number"
                    min="0"
                    value={completeForm.final_usable_quantity}
                    onChange={event => setCompleteForm(prev => ({ ...prev, final_usable_quantity: event.target.value }))}
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Bottles produced</span>
                  <input
                    type="number"
                    min="0"
                    value={completeForm.bottles_produced}
                    onChange={event => setCompleteForm(prev => ({ ...prev, bottles_produced: event.target.value }))}
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Rejected/wasted</span>
                  <input
                    type="number"
                    min="0"
                    value={completeForm.bottles_rejected_or_wasted}
                    onChange={event => setCompleteForm(prev => ({ ...prev, bottles_rejected_or_wasted: event.target.value }))}
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Storage location</span>
                  <input
                    value={completeForm.storage_location}
                    onChange={event => setCompleteForm(prev => ({ ...prev, storage_location: event.target.value }))}
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Use by date</span>
                  <input
                    type="date"
                    value={completeForm.use_by_date}
                    onChange={event => setCompleteForm(prev => ({ ...prev, use_by_date: event.target.value }))}
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs"
                  />
                </label>
              </div>
            </>
          )}

          {activeAction === 'verify' && (
            <>
              <div className="rounded-lg border border-cyan-200 bg-cyan-50/80 p-3 text-[11px] text-cyan-950 dark:border-cyan-900/60 dark:bg-cyan-950/20 dark:text-cyan-100">
                Measure pH from this finished batch, confirm the meter was calibrated, and compare the reading to NuVira's approved product/HACCP limit. The system never invents a pH value or pass/fail result.
              </div>
              <div className="grid grid-cols-1 gap-2">
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">pH result</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={completeForm.pH_result}
                    onChange={event => setCompleteForm(prev => ({ ...prev, pH_result: event.target.value }))}
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">pH pass/fail</span>
                  <select
                    value={completeForm.pH_passed_failed}
                    onChange={event => setCompleteForm(prev => ({ ...prev, pH_passed_failed: event.target.value }))}
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs"
                  >
                    <option value="">Select after measuring</option>
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Batch pass/fail</span>
                  <select
                    value={completeForm.passed_failed}
                    onChange={event => setCompleteForm(prev => ({ ...prev, passed_failed: event.target.value }))}
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs"
                  >
                    <option value="">Select after QC review</option>
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[
                  ['calibration_checked', 'pH meter calibration checked'],
                  ['ccp_check_complete', 'CCP monitoring complete'],
                  ['sanitation_verification_complete', 'Sanitation verification complete'],
                  ['labels_applied', 'Labels applied and checked'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 rounded-lg border border-border bg-background p-2.5 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={completeForm[key]}
                      onChange={event => setCompleteForm(prev => ({ ...prev, [key]: event.target.checked }))}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <StaffMemberPicker
                label="Staff on duty"
                value={completeForm.staff_on_duty}
                onChange={value => setCompleteForm(prev => ({ ...prev, staff_on_duty: value }))}
                multiple
                helperText="Tap names to build the staff list, or type another name if needed."
              />
              <label className="space-y-1 block">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Verification notes</span>
                <textarea
                  rows={2}
                  value={completeForm.verification_notes}
                  onChange={event => setCompleteForm(prev => ({ ...prev, verification_notes: event.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs resize-none"
                />
              </label>
            </>
          )}
        </div>
      )}

      {(activeAction === 'complete' || activeAction === 'verify') && (
        <button
          type="button"
          data-testid="native-lifecycle-refresh-preview"
          disabled={pending || actionPending}
          onClick={() => runPreview(activeAction)}
          className="w-full h-9 rounded-lg border border-primary/40 bg-primary/5 px-3 text-xs font-semibold text-primary disabled:opacity-50"
        >
          {pending ? 'Checking readiness...' : `Check ${formatLabel(activeAction)} Readiness`}
        </button>
      )}

      {message && (
        <p className={`text-xs ${
          message.type === 'error'
            ? 'text-destructive'
            : message.type === 'warn'
              ? 'text-cyan-700 dark:text-cyan-300'
              : 'text-green-700 dark:text-green-300'
        }`}>
          {message.text}
        </p>
      )}

      {preview && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Ready</p>
              <p className="text-sm font-bold">{actionReady ? 'Yes' : 'No'}</p>
            </div>
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Execution Gate</p>
              <p className="text-sm font-bold">{writeAvailable ? 'Open' : actionReady ? 'Closed' : 'No'}</p>
            </div>
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Action</p>
              <p className="text-sm font-bold">{formatLabel(preview.action || activeAction)}</p>
            </div>
          </div>

          {(blockers.length > 0 || warnings.length > 0) && (
            <div className="space-y-1">
              {blockers.map(blocker => (
                <div key={`native-blocker-${blocker}`} className="flex items-start gap-2 text-xs text-cyan-800 dark:text-cyan-200">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Blocker: {formatLabel(blocker)}</span>
                </div>
              ))}
              {warnings.map(warning => (
                <div key={`native-warning-${warning}`} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{formatLabel(warning)}</span>
                </div>
              ))}
            </div>
          )}

          {gateBlockers.length > 0 && (
            <div className="space-y-1">
              {gateBlockers.map(blocker => (
                <div key={`native-gate-${blocker}`} className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Write gate: {formatLabel(blocker)}</span>
                </div>
              ))}
            </div>
          )}

          {projectedWrites.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Checked fields: {projectedWrites.map(formatLabel).join(', ')}
            </p>
          )}

          <button
            type="button"
            disabled={actionPending || pending || !actionReady || !writeAvailable || (activeAction === 'start' && !preStartReady)}
            onClick={() => runNative(activeAction)}
            className="w-full h-10 rounded-lg bg-nuvira-gradient text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {actionPending
              ? `Saving ${formatLabel(activeAction)}...`
              : activeAction === 'start' && !preStartReady
                ? 'Complete Pre-start Checklist First'
                : writeAvailable
                ? `Save ${formatLabel(activeAction)}`
                : actionReady
                  ? `Write Gate Closed for ${formatLabel(activeAction)}`
                  : `Save ${formatLabel(activeAction)}`}
          </button>

          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>If a gate blocks this action, use the blockers above as diagnostics before retrying.</span>
          </div>
        </div>
      )}
      <ProductionPreStartModal
        batch={batch}
        open={preStartModalOpen}
        onOpenChange={setPreStartModalOpen}
        onReadyChange={setPreStartReady}
        onContinue={() => {
          setPreStartModalOpen(false);
          runPreview('start');
        }}
      />
    </div>
  );
}

function BatchCard({ batch, onActionSuccess }) {
  const nativeBatch = isNativeBatch(batch);
  const categoryAccent = nativeBatch
    ? 'border-l-sky-500'
    : isShotCategory(batch.product_category)
      ? 'border-l-cyan-400'
      : 'border-l-primary';

  return (
    <div
      className={`rounded-xl border border-border/50 border-l-4 ${categoryAccent} bg-card p-4 space-y-3`}
      data-testid={`production-batch-card-${batch.batch_id || batch.id || 'unknown'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-bold text-foreground mt-0.5">{batch.product_name || 'Unnamed product'}</h2>
          <p className="text-xs text-muted-foreground">{batch.product_category || 'Uncategorized'}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <AdminStatusPill
            value={nativeBatch ? 'native' : 'source'}
            label={batchSourceLabel(batch)}
          />
          {batch.is_test_batch === true && (
            <AdminStatusPill value="warning" label="Internal Test" tone="warning" />
          )}
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
          Last {nativeBatch ? 'native' : 'source'} update: {formatDateTime(batch.updated_date)}
        </p>
      )}

      {nativeBatch ? (
        <>
          <NativeBatchReadOnlyNotice />
          <NativeLifecyclePreviewPanel batch={batch} onActionSuccess={onActionSuccess} />
        </>
      ) : (
        <>
          <ProductionLifecyclePanel batch={batch} onActionSuccess={onActionSuccess} />
          <IngredientUsageCorrectionPanel batch={batch} onCorrectionSuccess={onActionSuccess} />
          {batch.status === 'verified_logged' && (
            <PostVerifyCascadesPanel batch={batch} onCascadeSuccess={onActionSuccess} />
          )}
          <InventoryDeductionPanel batch={batch} onDeductionSuccess={onActionSuccess} />
        </>
      )}
    </div>
  );
}

function ProductionDateSection({ date, batches, today, onActionSuccess }) {
  const isToday = date === today;
  const isPast = date !== 'unscheduled' && date < today;
  const neededUnits = batches.reduce((total, batch) => total + (Number(batch.planned_units) || 0), 0);
  const producedUnits = batches.reduce((total, batch) => total + (Number(batch.actual_units) || 0), 0);
  const productCount = batches.length;
  const nativeCount = batches.filter(isNativeBatch).length;
  const hubCount = productCount - nativeCount;
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
            {nativeCount > 0 ? `Source ${hubCount} · Native ${nativeCount}` : 'Source Production'}
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

function planningProductGroups(planningData) {
  const groupsByProduct = new Map();
  const dateGroups = Array.isArray(planningData?.dates) ? planningData.dates : [];
  for (const dateGroup of dateGroups) {
    const productionDate = dateGroup.production_date || 'date_pending';
    for (const group of Array.isArray(dateGroup.product_groups) ? dateGroup.product_groups : []) {
      const key = `${group.product_name || 'Product'}|${group.product_category || ''}`;
      const current = groupsByProduct.get(key) || {
        product_name: group.product_name || 'Product',
        product_category: group.product_category || null,
        planned_units: 0,
        source_order_count: 0,
        production_dates: new Set(),
      };
      current.planned_units += Number(group.planned_units || 0);
      current.source_order_count += Number(group.source_order_count || 0);
      if (productionDate) current.production_dates.add(productionDate);
      groupsByProduct.set(key, current);
    }
  }
  return Array.from(groupsByProduct.values())
    .sort((a, b) => Number(b.planned_units || 0) - Number(a.planned_units || 0))
    .map(group => ({
      ...group,
      production_dates: Array.from(group.production_dates),
    }));
}

function ProductionDemandHandoffPanel({ planningData, queueNeededUnits, isLoading, isError, error }) {
  const summary = planningData?.summary || {};
  const nativeOverlay = planningData?.native_overlay || {};
  const plannedUnits = Number(summary.planned_units || 0);
  const queuedUnits = Number(queueNeededUnits || 0);
  const unbatchedUnits = Math.max(0, plannedUnits - Number(queueNeededUnits || 0));
  const queueOnlyUnits = Math.max(0, queuedUnits - plannedUnits);
  const groups = planningProductGroups(planningData).slice(0, 8);
  const missingMasterDataCount = [
    nativeOverlay.missing_recipe_count,
    nativeOverlay.ambiguous_recipe_count,
    nativeOverlay.missing_inventory_count,
    nativeOverlay.missing_yield_count,
    nativeOverlay.ambiguous_yield_count,
  ].reduce((total, value) => total + Number(value || 0), 0);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-4">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-primary animate-spin" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Loading planning handoff</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 dark:border-cyan-900/60 dark:bg-cyan-950/30">
        <p className="text-sm font-semibold text-cyan-900 dark:text-cyan-100">Production planning handoff unavailable</p>
        <p className="text-xs text-cyan-800 mt-1 dark:text-cyan-200/80">{error?.message || 'Open Production Planning for demand details.'}</p>
      </div>
    );
  }

  if (plannedUnits <= 0 && groups.length === 0) return null;

  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 space-y-3 dark:border-cyan-900/50 dark:bg-card/90">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-800 dark:text-cyan-300">Demand and event-stock handoff</p>
          <h2 className="text-sm font-bold text-blue-950 dark:text-foreground">
            {queueOnlyUnits > 0
              ? 'Queue includes event/manual stock'
              : unbatchedUnits > 0
                ? 'Demand exists before a production batch is scheduled'
                : 'Demand is covered by scheduled batches'}
          </h2>
          <p className="text-xs text-blue-900/80 mt-1 dark:text-muted-foreground">
            Customer-order demand is read-only here. Event/manual stock appears in the queue after approved batch creation.
          </p>
        </div>
        <AdminStatusPill
          label={unbatchedUnits > 0 ? 'Unbatched demand' : queueOnlyUnits > 0 ? 'Event stock queued' : 'Covered by queue'}
          tone={unbatchedUnits > 0 ? 'warning' : 'native'}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <div className="rounded-lg bg-white/70 border border-blue-100 p-2 dark:border-border/70 dark:bg-background/70">
          <p className="text-[10px] uppercase tracking-wider text-blue-800 font-semibold dark:text-muted-foreground">Order Demand</p>
          <p className="text-lg font-black text-blue-950 dark:text-foreground">{formatNumber(plannedUnits)}</p>
        </div>
        <div className="rounded-lg bg-white/70 border border-blue-100 p-2 dark:border-border/70 dark:bg-background/70">
          <p className="text-[10px] uppercase tracking-wider text-blue-800 font-semibold dark:text-muted-foreground">Queue Units</p>
          <p className="text-lg font-black text-blue-950 dark:text-foreground">{formatNumber(queuedUnits)}</p>
        </div>
        <div className="rounded-lg bg-white/70 border border-blue-100 p-2 dark:border-border/70 dark:bg-background/70">
          <p className="text-[10px] uppercase tracking-wider text-blue-800 font-semibold dark:text-muted-foreground">Unbatched</p>
          <p className="text-lg font-black text-blue-950 dark:text-foreground">{formatNumber(unbatchedUnits)}</p>
        </div>
        <div className="rounded-lg bg-white/70 border border-blue-100 p-2 dark:border-border/70 dark:bg-background/70">
          <p className="text-[10px] uppercase tracking-wider text-blue-800 font-semibold dark:text-muted-foreground">Event Stock</p>
          <p className="text-lg font-black text-blue-950 dark:text-foreground">{formatNumber(queueOnlyUnits)}</p>
        </div>
        <div className="rounded-lg bg-white/70 border border-blue-100 p-2 dark:border-border/70 dark:bg-background/70">
          <p className="text-[10px] uppercase tracking-wider text-blue-800 font-semibold dark:text-muted-foreground">Master Data Gaps</p>
          <p className="text-lg font-black text-blue-950 dark:text-foreground">{formatNumber(missingMasterDataCount)}</p>
        </div>
      </div>

      {Number(nativeOverlay.order_count || 0) > 0 && (
        <p className="text-xs text-blue-900 dark:text-muted-foreground">
          Customer-app order demand: {formatNumber(nativeOverlay.order_count)} order{Number(nativeOverlay.order_count) === 1 ? '' : 's'} · {formatNumber(nativeOverlay.planned_units)} units · {formatNumber(nativeOverlay.ingredient_count)} ingredient rows.
        </p>
      )}

      {queueOnlyUnits > 0 && (
        <p className="text-xs text-blue-900 dark:text-muted-foreground">
          Queue-only/event stock: {formatNumber(queueOnlyUnits)} unit{queueOnlyUnits === 1 ? '' : 's'} already scheduled outside customer-order demand.
        </p>
      )}

      {groups.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {groups.map(group => (
            <div key={`${group.product_name}-${group.product_category}`} className="rounded-lg border border-blue-100 bg-white/70 p-3 dark:border-border/70 dark:bg-background/70">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-blue-950 dark:text-foreground">{group.product_name}</p>
                  <p className="text-[10px] uppercase tracking-wider text-blue-700 dark:text-muted-foreground">{group.product_category || 'Product'}</p>
                </div>
                <p className="text-sm font-black text-blue-950 dark:text-foreground">{formatNumber(group.planned_units)} units</p>
              </div>
              <p className="mt-2 text-[11px] text-blue-900 dark:text-muted-foreground">
                {formatNumber(group.source_order_count)} source order{Number(group.source_order_count) === 1 ? '' : 's'} · {group.production_dates.map(formatDate).join(', ')}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <a href="/admin/production-planning" className="h-8 px-3 rounded-lg bg-blue-700 text-white text-xs font-semibold inline-flex items-center dark:bg-primary dark:text-primary-foreground">
          Open Production Planning
        </a>
        <a href="/admin/inventory-status" className="h-8 px-3 rounded-lg border border-blue-200 bg-white/80 text-blue-900 text-xs font-semibold inline-flex items-center dark:border-border dark:bg-background/70 dark:text-foreground">
          Open Inventory Status
        </a>
      </div>
    </section>
  );
}

export default function ProductionQueueSummary() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isPageVisible = usePageVisibility();
  const [searchParams] = useSearchParams();
  const defaultFrom = useMemo(() => todayDate(), []);
  const defaultTo = useMemo(() => addDays(defaultFrom, 14), [defaultFrom]);
  const datePresets = useMemo(() => productionQueueDatePresets(defaultFrom), [defaultFrom]);
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [tab, setTab] = useState('today');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [testBatchMode, setTestBatchMode] = useState('exclude');
  const showInternalTestValidation = searchParams.get('internal_test_validation') === '1';

  const rangeDays = dateFrom && dateTo ? daysInclusive(dateFrom, dateTo) : null;
  const rangeInvalid = Boolean(!dateFrom || !dateTo || dateTo < dateFrom || rangeDays > 31);
  const rangeIsPast = Boolean(dateTo && dateTo < defaultFrom);

  useEffect(() => {
    if (rangeIsPast && tab === 'today') {
      setTab('history');
    }
  }, [rangeIsPast, tab]);

  function setDateFromValue(value) {
    setDateFrom(value);
    if (dateTo && dateTo < defaultFrom && tab === 'today') {
      setTab('history');
    }
  }

  function setDateToValue(value) {
    setDateTo(value);
    if (value && value < defaultFrom && tab === 'today') {
      setTab('history');
    }
  }

  function applyDatePreset(preset) {
    setDateFrom(preset.dateFrom);
    setDateTo(preset.dateTo);
    setTab(preset.tab);
    setCategoryFilter('all');
    setStatusFilter('all');
  }

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ['admin-production-queue-summary', dateFrom, dateTo, testBatchMode],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminProductionQueueSummary', {
        date_from: dateFrom,
        date_to: dateTo,
        limit: 100,
        test_batch_mode: testBatchMode,
      });
      const result = unwrapBase44Result(res);
      if (result?.error) throw new Error(result.error);
      return result || { batches: [] };
    },
    enabled: isAdminUser(user) && isPageVisible && !rangeInvalid,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });

  const {
    data: planningData,
    isLoading: planningLoading,
    isError: planningError,
    error: planningQueryError,
  } = useQuery({
    queryKey: ['admin-production-queue-planning-handoff', dateFrom, dateTo],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminProductionPlanningSummary', {
        preset: 'custom',
        date_from: dateFrom,
        date_to: dateTo,
      });
      const result = unwrapBase44Result(res);
      if (result?.error) throw new Error(result.error);
      return result || { summary: {}, dates: [], ingredients: [] };
    },
    enabled: isAdminUser(user) && isPageVisible && !rangeInvalid,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });

  async function refreshProductionActionSummaries() {
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ['admin-production-planning-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-inventory-status-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin_compliance_ops_summary'] }),
      queryClient.invalidateQueries({ queryKey: ['compliance_logs_parity_summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-delivery-route-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-operations-dashboard-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-shopify-ops-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-sync-health-summary'] }),
    ]);
  }

  if (!isAdminUser(user)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Admin access required.</p>
      </div>
    );
  }

  const allBatches = data?.batches || [];
  const categoryOptions = uniqueOptions(allBatches, 'product_category');
  const statusOptions = uniqueOptions(allBatches, 'status');
  const batchesMatchingFilters = allBatches.filter(batch => {
    if (categoryFilter !== 'all' && batch.product_category !== categoryFilter) return false;
    if (statusFilter !== 'all' && batch.status !== statusFilter) return false;
    return true;
  });
  const filteredBatches = batchesMatchingFilters.filter(batch => getBatchTab(batch, defaultFrom) === tab);
  const historyBatchesInRange = batchesMatchingFilters.filter(batch => getBatchTab(batch, defaultFrom) === 'history').length;
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
    <div className="min-h-screen bg-background pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-10">
      <AdminOpsHeader
        title="Production Queue"
        subtitle="Customer App production queue for daily batch work"
        badge={testBatchMode === 'only' ? 'Internal Test View' : 'Ops v1'}
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
                onChange={event => setDateFromValue(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">To</span>
              <input
                type="date"
                value={dateTo}
                onChange={event => setDateToValue(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {datePresets.map(preset => {
              const isActive = dateFrom === preset.dateFrom && dateTo === preset.dateTo && tab === preset.tab;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyDatePreset(preset)}
                  className={`h-8 rounded-lg border px-3 text-[11px] font-semibold transition-colors ${
                    isActive
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          {rangeInvalid ? (
            <p className="text-xs text-destructive">Choose a valid production date range of 31 days or fewer.</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Showing production batches from {formatDate(dateFrom)} through {formatDate(dateTo)}.
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            Customer App and source-backed production data. Batch steps are guarded by exact-batch checks; inventory deduction stays separate.
          </p>
          <details className="rounded-lg border border-border/60 bg-background/70 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-foreground">Need an older date?</summary>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Use the From/To fields above for retroactive production or compliance review. Historical one-off event shortcuts were removed from the primary workflow so this page stays focused on today, upcoming, and recent production.
            </p>
          </details>
          {(showInternalTestValidation || testBatchMode === 'only') && (
            <button
              type="button"
              onClick={() => {
                setTestBatchMode(mode => mode === 'only' ? 'exclude' : 'only');
                setCategoryFilter('all');
                setStatusFilter('all');
                setTab('today');
              }}
              className={`h-9 rounded-lg border px-3 text-xs font-semibold ${
                testBatchMode === 'only'
                  ? 'border-amber-500 bg-amber-100 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100'
                  : 'border-border bg-background text-muted-foreground'
              }`}
            >
              {testBatchMode === 'only' ? 'Return to Operational Queue' : 'Open Internal Test Validation'}
            </button>
          )}
          {testBatchMode === 'only' && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              Internal test batches only. These records are excluded from operational totals, production planning, procurement, inventory, delivery, and customer reporting.
            </p>
          )}
          {Array.isArray(data?.warnings) && data.warnings.length > 0 && (
            <p className="text-[10px] text-cyan-700 dark:text-cyan-300">
              Data warning: {data.warnings.map(formatSourceWarning).join(', ')}
            </p>
          )}
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

        {testBatchMode === 'exclude' && (
          <ProductionDemandHandoffPanel
            planningData={planningData}
            queueNeededUnits={totalNeeded}
            isLoading={planningLoading}
            isError={planningError}
            error={planningQueryError}
          />
        )}

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
            <p className="text-sm font-semibold text-foreground">
              {rangeIsPast ? 'No production batches in this selected range' : 'No upcoming production scheduled'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {rangeIsPast
                ? 'History is scoped to the selected production date range. Use Last 31 Days or select the exact production date.'
                : 'This date range has no Customer App or source-backed production batch rows yet. Check the planning handoff above for unbatched demand.'}
            </p>
          </div>
        ) : !rangeInvalid && filteredBatches.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No production batches match this view</p>
            <p className="text-xs text-muted-foreground mt-1">
              {historyBatchesInRange > 0 && tab !== 'history'
                ? `This range has ${historyBatchesInRange} history batch${historyBatchesInRange === 1 ? '' : 'es'} after the current filters. Open History or clear filters.`
                : 'History is scoped to the selected production date range. Use Last 31 Days or select the exact production date.'}
            </p>
          </div>
        ) : !rangeInvalid ? (
          <div className="space-y-6">
            {data?.truncated && (
              <p className="text-xs text-cyan-700 bg-cyan-50 border border-cyan-200 rounded-lg p-3 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-200">
                Results are capped at 100 batches. Narrow the date range for a complete view.
              </p>
            )}
            {sortedDates.map(date => (
              <ProductionDateSection
                key={date}
                    date={date}
                    batches={groupedBatches[date]}
                    today={defaultFrom}
                    onActionSuccess={refreshProductionActionSummaries}
                  />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
