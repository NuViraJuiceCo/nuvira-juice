import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

const MAX_RANGE_DAYS = 31;
const presetOptions = [
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: 'Last 7 Days' },
  { value: 'last_30_days', label: 'Last 30 Days' },
];

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

function daysInclusive(from, to) {
  if (!from || !to) return 0;
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
}

function validateRange(from, to) {
  if (!from || !to) return 'Choose a start and end date.';
  if (to < from) return 'End date must be on or after start date.';
  if (daysInclusive(from, to) > MAX_RANGE_DAYS) return `Date range must be ${MAX_RANGE_DAYS} days or fewer.`;
  return null;
}

function formatDate(value) {
  if (!value) return 'Date pending';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(value) {
  if (!value) return 'Not returned';
  try {
    return new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function isPosCancellationPreviewRow(row) {
  return [
    'historical_pos_test_order_cancelled',
    'historical_pos_test_order_needs_cancellation',
    'historical_pos_test_order_already_cancelled',
  ].includes(row?.reason);
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

const SAFE_ADMIN_PRODUCTION_LABELS = new Set([
  'planned',
  'ready_for_production',
  'in_production',
  'completed_pending_verification',
  'verified_logged',
  'archived',
  'blocked',
  'held',
  'pending',
  'completed',
]);

function sanitizeAdminText(value) {
  if (!value) return '';
  return value
    .toString()
    .replace(/\b(?:ch|re|pi|cs|cus|sub|evt|in|pm|seti|si|src|tok|po|li)_[A-Za-z0-9]{8,}\b/g, match => (SAFE_ADMIN_PRODUCTION_LABELS.has(match.toLowerCase()) ? match : '[redacted]'))
    .replace(/\bgid:\/\/shopify\/[A-Za-z]+\/[A-Za-z0-9_-]+\b/g, '[redacted]');
}

function lifecycleStartChip(row) {
  if (row?.start_state === 'already_started') return 'Start already started';
  if (row?.can_start) return 'Can start preview';
  if (row?.start_state === 'not_applicable_terminal_or_completed') return 'Start not applicable';
  return 'Start blocked';
}

function lifecycleStatusChip(row) {
  if (row?.current_status === 'in_production') return 'In Production';
  return row?.classification || 'preview';
}

function lifecycleCompleteChip(row) {
  if (row?.can_complete) return 'Can complete preview';
  if (row?.complete_state === 'complete_blocked_missing_completion_fields') return 'Complete pending actual units';
  return 'Complete blocked';
}

function lifecycleVerifyChip(row) {
  if (row?.can_verify) return 'Can verify preview';
  if (row?.verify_state === 'verify_blocked_until_completion') return 'Verify held until complete';
  return 'Verify blocked';
}

function statusClass(value) {
  const key = (value || '').toString().toLowerCase();
  if (key.includes('success') || key.includes('active')) return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (key.includes('fail') || key.includes('error')) return 'bg-red-50 text-red-700 border-red-100';
  if (key.includes('pending') || key.includes('stale')) return 'bg-cyan-50 text-cyan-800 border-cyan-100';
  if (key.includes('deprecated') || key.includes('disabled')) return 'bg-secondary text-secondary-foreground border-border/50';
  return 'bg-blue-50 text-blue-700 border-blue-100';
}

function StatusChip({ value }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-semibold ${statusClass(value)}`}>
      {formatLabel(value)}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, sublabel, tone = 'default', isRefreshing }) {
  const toneClass = {
    default: 'border-border/50 bg-card',
    success: 'border-emerald-100 bg-emerald-50/60',
    warning: 'border-cyan-100 bg-cyan-50/60',
    danger: 'border-red-100 bg-red-50/60',
    info: 'border-blue-100 bg-blue-50/60',
  }[tone] || 'border-border/50 bg-card';

  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      {Icon && <Icon className={`w-4 h-4 text-primary mb-1 ${isRefreshing ? 'animate-spin' : ''}`} />}
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
      {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
    </div>
  );
}

function DirectionCard({ title, description, direction }) {
  const stats = direction || {};
  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard label="Total" value={formatNumber(stats.total)} />
        <StatCard label="Success" value={formatNumber(stats.success)} tone="success" />
        <StatCard label="Failed" value={formatNumber(stats.failed)} tone="danger" />
        <StatCard label="Pending" value={formatNumber(stats.pending)} tone="warning" />
      </div>
    </section>
  );
}

function ErrorCategories({ categories }) {
  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-foreground">Error Categories</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Sanitized aggregate categories only. Raw logs are not shown.</p>
      </div>
      {categories.length === 0 ? (
        <p className="text-xs text-muted-foreground rounded-lg border border-border/50 bg-background p-3">
          No error categories returned for this range.
        </p>
      ) : (
        <div className="space-y-2">
          {categories.map((category, index) => (
            <div key={`${category.category}-${index}`} className="rounded-lg border border-border/50 bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">{category.category || 'Other'}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Latest seen: {formatDateTime(category.latest_seen_at)}
                  </p>
                </div>
                <StatusChip value={`${formatNumber(category.count)} events`} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DeprecatedTools({ tools }) {
  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-foreground">Disabled / Deprecated Tools</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Static owner context only. No repair, replay, or sync controls are available here.</p>
      </div>
      {tools.length === 0 ? (
        <p className="text-xs text-muted-foreground rounded-lg border border-border/50 bg-background p-3">
          No disabled or deprecated tool context returned.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {tools.map((tool, index) => (
            <div key={`${tool.name}-${index}`} className="rounded-lg border border-border/50 bg-background p-3 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{tool.name || 'Tool'}</p>
                <StatusChip value={tool.status || 'unknown'} />
              </div>
              {tool.note && <p className="text-xs text-muted-foreground leading-relaxed">{tool.note}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function NativeCutoverReadinessPreview({
  preview,
  isRunning,
  error,
  orderNumber,
  onOrderNumberChange,
  onRun,
  pilotApproval,
  isPilotApprovalRunning,
  pilotApprovalError,
  onRunPilotApproval,
}) {
  const readiness = preview?.readiness || {};
  const hubRetirement = preview?.hub_retirement_readiness || {};
  const gates = preview?.gates || {};
  const targets = Array.isArray(preview?.targets) ? preview.targets : [];
  const safety = preview?.safety || {};
  const retirementSubsystems = Array.isArray(hubRetirement.subsystems) ? hubRetirement.subsystems : [];
  const retirementBlockers = Array.isArray(hubRetirement.blockers) ? hubRetirement.blockers : [];
  const retirementWarnings = Array.isArray(hubRetirement.warnings) ? hubRetirement.warnings : [];
  const nativeWriter = gates.native_safe_sync_writer || {};
  const may30Ops = gates.may30_native_order_ops || {};
  const taskMaterialization = gates.native_fulfillment_task_materialization || {};
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers : [];
  const warnings = Array.isArray(readiness.warnings) ? readiness.warnings : [];
  const approval = pilotApproval?.approval || {};
  const approvalBlockers = Array.isArray(approval.blockers) ? approval.blockers : [];
  const approvalWarnings = Array.isArray(approval.warnings) ? approval.warnings : [];
  const writerSummary = approval.writer_dry_run_equivalent || {};
  const gateSnapshot = approval.gate_snapshot || {};
  const canRequestApprovalPacket = Boolean(orderNumber?.trim()) && readiness.classification === 'pilot_ready_with_exact_order_approval';

  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <ShieldCheck className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div>
            <h2 className="text-sm font-bold text-foreground">Native Cutover Readiness Gate</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              G27 read-only dry run for paid Customer App order ownership. It checks native order/task context and existing parity planning; it does not sync, repair, replay, or write records.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={isRunning}
          onClick={onRun}
          className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors ${
            isRunning
              ? 'bg-muted text-muted-foreground border-border cursor-not-allowed'
              : 'bg-nuvira-gradient text-white border-primary hover:opacity-90'
          }`}
        >
          {isRunning ? 'Checking...' : 'Run Read-Only Cutover Check'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-2 items-end">
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Optional exact order number</span>
          <input
            type="text"
            value={orderNumber}
            onChange={event => onOrderNumberChange(event.target.value)}
            placeholder="Leave blank to check recent paid delivery orders"
            className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          />
        </label>
        <p className="text-[10px] text-muted-foreground leading-relaxed rounded-lg border border-border/50 bg-background p-2">
          Exact order checks are still preview-only. Live pilot remains separately approved per order.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
        Safety contract: dry-run only; no native writer broadening, Hub retirement, provider call, notification, production batch, inventory mutation, delivery mutation, or customer-facing status change.
      </div>

      {preview && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-amber-950">Exact-Order Pilot Approval Packet</p>
              <p className="text-[10px] text-amber-900 mt-0.5">
                G28 packet generation is read-only. It formalizes the separate approval boundary for one exact order and does not execute the native writer.
              </p>
            </div>
            <button
              type="button"
              disabled={isPilotApprovalRunning || !canRequestApprovalPacket}
              onClick={onRunPilotApproval}
              className={`h-8 px-3 rounded-lg border text-[11px] font-semibold transition-colors ${
                isPilotApprovalRunning || !canRequestApprovalPacket
                  ? 'bg-muted text-muted-foreground border-border cursor-not-allowed'
                  : 'bg-background text-amber-950 border-amber-300 hover:bg-amber-100'
              }`}
            >
              {isPilotApprovalRunning ? 'Generating...' : 'Generate Read-Only Packet'}
            </button>
          </div>
          {!orderNumber?.trim() && (
            <p className="text-[10px] text-amber-900">Enter an exact order number before generating a pilot approval packet.</p>
          )}
          {orderNumber?.trim() && !canRequestApprovalPacket && (
            <p className="text-[10px] text-amber-900">Run a clean exact-order readiness check before generating a pilot approval packet.</p>
          )}
          {pilotApprovalError && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">{pilotApprovalError}</p>
          )}
          {pilotApproval && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <StatusChip value={approval.approval_packet_ready ? 'Packet Ready' : 'Packet Held'} />
                <StatusChip value="Separate Approval Required" />
                <StatusChip value={approval.live_execution_not_run ? 'No Live Execution' : 'Execution State Unknown'} />
                <StatusChip value={pilotApproval?.safety?.writes_performed === false ? 'No Writes Performed' : 'Write State Unknown'} />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
                <div className="rounded-lg border border-amber-200 bg-background p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Approval phrase</p>
                  <p className="mt-1 text-xs font-semibold text-foreground break-words">{approval.exact_order_approval_phrase || 'Not generated'}</p>
                </div>
                <div className="rounded-lg border border-amber-200 bg-background p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Writer dry-run equivalent</p>
                  <p className="mt-1 text-xs text-foreground">
                    {writerSummary.action ? `${formatLabel(writerSummary.action)} · ${writerSummary.would_update_order ? 'Would Update' : writerSummary.would_create_order ? 'Would Create' : 'No Order Write'}` : 'Not returned'}
                  </p>
                </div>
                <div className="rounded-lg border border-amber-200 bg-background p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Writer gates</p>
                  <p className="mt-1 text-xs text-foreground">
                    {gateSnapshot.native_safe_sync_writer?.enabled ? 'Enabled' : 'Disabled'} · {gateSnapshot.native_safe_sync_writer?.kill_switch ? 'Kill Switch On' : 'Kill Switch Off'} · {gateSnapshot.native_safe_sync_writer?.broad_real_order_mode ? 'Broad Mode On' : 'Broad Mode Off'}
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-background p-3 text-[10px] text-muted-foreground">
                Live execution contract: exact order only; requires actor allowlist, order allowlist, live mode, separate approval, Hub fallback retained, no provider calls, no notifications, no repair/replay, and no production/inventory/delivery mutation expansion.
              </div>
              {(approvalBlockers.length > 0 || approvalWarnings.length > 0) && (
                <p className="text-[10px] text-muted-foreground">
                  {approvalBlockers.length > 0 ? `Packet blockers: ${approvalBlockers.map(item => formatLabel(sanitizeAdminText(item))).join(', ')}` : ''}
                  {approvalBlockers.length > 0 && approvalWarnings.length > 0 ? ' · ' : ''}
                  {approvalWarnings.length > 0 ? `Packet warnings: ${approvalWarnings.map(item => formatLabel(sanitizeAdminText(item))).join(', ')}` : ''}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <StatCard
              label="Classification"
              value={formatLabel(readiness.classification)}
              tone={blockers.length > 0 ? 'warning' : 'success'}
            />
            <StatCard label="Targets" value={formatNumber(readiness.target_count)} />
            <StatCard label="Pilot Ready" value={formatNumber(readiness.pilot_ready_target_count)} tone={Number(readiness.pilot_ready_target_count || 0) > 0 ? 'success' : 'default'} />
            <StatCard label="Usable Targets" value={formatNumber(readiness.usable_target_count)} tone={Number(readiness.usable_target_count || 0) > 0 ? 'success' : 'default'} />
            <StatCard label="Generated" value={formatDateTime(preview.generated_at)} />
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusChip value={readiness.next_action || 'review'} />
            {hubRetirement.status && <StatusChip value={`Hub retirement: ${formatLabel(hubRetirement.status)}`} />}
            <StatusChip value={readiness.hub_bridge_remains_fallback ? 'Hub bridge remains fallback' : 'Hub fallback missing'} />
            <StatusChip value={readiness.live_pilot_requires_exact_order_approval ? 'Exact order approval required' : 'Approval state unknown'} />
            <StatusChip value={safety.writes_performed === false ? 'No writes performed' : 'Write state unknown'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
            <div className="rounded-lg border border-border/50 bg-background p-3 space-y-2">
              <p className="text-xs font-bold text-foreground">Native safeSync writer</p>
              <div className="flex flex-wrap gap-2">
                <StatusChip value={nativeWriter.enabled ? 'Enabled' : 'Disabled'} />
                <StatusChip value={nativeWriter.kill_switch ? 'Kill switch on' : 'Kill switch off'} />
                <StatusChip value={nativeWriter.broad_real_order_mode ? 'Broad mode active' : 'Broad mode off'} />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Order allowlist: {formatNumber(nativeWriter.order_allowlist_count)} · Actor allowlist: {formatNumber(nativeWriter.actor_allowlist_count)}
              </p>
            </div>
            <div className="rounded-lg border border-border/50 bg-background p-3 space-y-2">
              <p className="text-xs font-bold text-foreground">May 30 native ops</p>
              <div className="flex flex-wrap gap-2">
                <StatusChip value={may30Ops.enabled ? 'Enabled' : 'Disabled'} />
                <StatusChip value={may30Ops.secret_configured ? 'Secret configured' : 'Secret missing'} />
                <StatusChip value={may30Ops.hub_bridge_fallback_expected ? 'Hub fallback expected' : 'Fallback state unknown'} />
              </div>
            </div>
            <div className="rounded-lg border border-border/50 bg-background p-3 space-y-2">
              <p className="text-xs font-bold text-foreground">Task materialization</p>
              <div className="flex flex-wrap gap-2">
                <StatusChip value={taskMaterialization.enabled ? 'Enabled' : 'Disabled'} />
                <StatusChip value={taskMaterialization.kill_switch ? 'Kill switch on' : 'Kill switch off'} />
                <StatusChip value={taskMaterialization.broad_real_order_mode ? 'Broad mode active' : 'Broad mode off'} />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Order allowlist: {formatNumber(taskMaterialization.order_allowlist_count)} · Actor allowlist: {formatNumber(taskMaterialization.actor_allowlist_count)}
              </p>
            </div>
          </div>

          {retirementSubsystems.length > 0 && (
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-purple-950">Hub Retirement Operational Readiness</p>
                  <p className="text-[10px] text-purple-900 mt-0.5">
                    G30 read-only subsystem map. This is separate from exact-order pilot readiness and does not approve Hub retirement.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusChip value={formatLabel(hubRetirement.status || 'review')} />
                  <StatusChip value={hubRetirement.hub_bridge_fallback_required ? 'Hub fallback required' : 'Fallback status unknown'} />
                  <StatusChip value={hubRetirement.live_writes_required_for_this_check === false ? 'No live writes required' : 'Write state unknown'} />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <StatCard label="Subsystems" value={formatNumber(hubRetirement.subsystem_count)} />
                <StatCard label="Retirement Blockers" value={formatNumber(hubRetirement.blocker_count)} tone={Number(hubRetirement.blocker_count || 0) > 0 ? 'warning' : 'success'} />
                <StatCard label="Retirement Warnings" value={formatNumber(hubRetirement.warning_count)} tone={Number(hubRetirement.warning_count || 0) > 0 ? 'warning' : 'default'} />
                <StatCard label="Next Action" value={formatLabel(hubRetirement.next_action || 'review')} />
              </div>

              {(retirementBlockers.length > 0 || retirementWarnings.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  <div className="rounded-lg border border-purple-200 bg-background p-3">
                    <p className="text-xs font-bold text-purple-950">Hub retirement blockers</p>
                    {retirementBlockers.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-[10px] text-purple-900">
                        {retirementBlockers.map(blocker => (
                          <li key={blocker}>• {formatLabel(sanitizeAdminText(blocker))}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-[10px] text-purple-900">No Hub-retirement blockers returned.</p>
                    )}
                  </div>
                  <div className="rounded-lg border border-purple-200 bg-background p-3">
                    <p className="text-xs font-bold text-purple-950">Hub retirement warnings</p>
                    {retirementWarnings.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-[10px] text-purple-900">
                        {retirementWarnings.map(warning => (
                          <li key={warning}>• {formatLabel(sanitizeAdminText(warning))}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-[10px] text-purple-900">No Hub-retirement warnings returned.</p>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {retirementSubsystems.map(subsystem => {
                  const subsystemBlockers = Array.isArray(subsystem.blockers) ? subsystem.blockers : [];
                  const subsystemWarnings = Array.isArray(subsystem.warnings) ? subsystem.warnings : [];
                  return (
                    <div key={subsystem.key || subsystem.label} className="rounded-lg border border-purple-200 bg-background p-3 space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-foreground">{subsystem.label || formatLabel(subsystem.key || 'Subsystem')}</p>
                        <StatusChip value={formatLabel(subsystem.status || 'review')} />
                      </div>
                      {(subsystemBlockers.length > 0 || subsystemWarnings.length > 0) && (
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          {subsystemBlockers.length > 0 ? `Blockers: ${subsystemBlockers.map(item => formatLabel(sanitizeAdminText(item))).join(', ')}` : ''}
                          {subsystemBlockers.length > 0 && subsystemWarnings.length > 0 ? ' · ' : ''}
                          {subsystemWarnings.length > 0 ? `Warnings: ${subsystemWarnings.map(item => formatLabel(sanitizeAdminText(item))).join(', ')}` : ''}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(blockers.length > 0 || warnings.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                <p className="text-xs font-bold text-cyan-950">Readiness blockers</p>
                {blockers.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-[10px] text-cyan-900">
                    {blockers.map(blocker => (
                      <li key={blocker}>• {formatLabel(sanitizeAdminText(blocker))}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[10px] text-cyan-900">No aggregate blockers returned.</p>
                )}
              </div>
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                <p className="text-xs font-bold text-cyan-950">Warnings</p>
                {warnings.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-[10px] text-cyan-900">
                    {warnings.map(warning => (
                      <li key={warning}>• {formatLabel(sanitizeAdminText(warning))}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[10px] text-cyan-900">No aggregate warnings returned.</p>
                )}
              </div>
            </div>
          )}

          {targets.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Target order readiness</p>
              {targets.map(target => {
                const targetBlockers = Array.isArray(target.blockers) ? target.blockers : [];
                const targetWarnings = Array.isArray(target.warnings) ? target.warnings : [];
                const nativeTasks = Array.isArray(target.native_tasks) ? target.native_tasks : [];
                return (
                  <div key={target.customer_app_order_id || target.native_shopify_order_id || target.order_number || target.classification} className="rounded-lg border border-border/50 bg-background p-3 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{target.order_number || 'Order pending'}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {[
                            target.customer_app_order_id ? `Customer App ${target.customer_app_order_id}` : null,
                            target.native_shopify_order_id ? `Native ${target.native_shopify_order_id}` : null,
                            target.payment_status ? formatLabel(target.payment_status) : null,
                            target.fulfillment_method ? formatLabel(target.fulfillment_method) : null,
                          ].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <StatusChip value={target.classification || 'review'} />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <StatusChip value={target.native_order_present ? 'Native Ops Mirror' : 'Native mirror missing'} />
                      <StatusChip value={`${formatNumber(target.native_task_count)} Native Tasks`} />
                      <StatusChip value={`${formatNumber(target.native_task_display_metadata_complete_count)} Tasks Metadata Complete`} />
                      <StatusChip value={target.address_complete ? 'Address Complete' : 'Address Incomplete'} />
                      <StatusChip value={`${formatNumber(target.line_item_count)} Line Items`} />
                    </div>

                    {nativeTasks.length > 0 && (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        {nativeTasks.map(task => (
                          <div key={task.id || `${target.order_number}-${task.delivery_date}`} className="rounded-lg border border-border/50 bg-card p-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="text-xs font-semibold text-foreground">{task.id || 'Native task'}</p>
                              <StatusChip value={task.display_metadata_complete ? 'Metadata Complete' : 'Metadata Incomplete'} />
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {[
                                task.status ? `Status ${formatLabel(task.status)}` : null,
                                task.delivery_date ? `Delivery ${task.delivery_date}` : null,
                                task.production_date ? `Production ${task.production_date}` : null,
                                task.source_type ? formatLabel(task.source_type) : null,
                                task.schedule_source ? formatLabel(task.schedule_source) : null,
                              ].filter(Boolean).join(' · ') || 'No display metadata returned'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {(targetBlockers.length > 0 || targetWarnings.length > 0) && (
                      <p className="text-[10px] text-muted-foreground">
                        {targetBlockers.length > 0 ? `Blockers: ${targetBlockers.map(item => formatLabel(sanitizeAdminText(item))).join(', ')}` : ''}
                        {targetBlockers.length > 0 && targetWarnings.length > 0 ? ' · ' : ''}
                        {targetWarnings.length > 0 ? `Warnings: ${targetWarnings.map(item => formatLabel(sanitizeAdminText(item))).join(', ')}` : ''}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground rounded-lg border border-border/50 bg-background p-3">
              No target orders returned. Check an exact paid delivery order number or wait for a natural paid app order.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function NativeProductionInventoryReadinessPreview({
  preview,
  isRunning,
  error,
  orderNumber,
  onRun,
}) {
  const demandRows = Array.isArray(preview?.production_demand_rows) ? preview.production_demand_rows : [];
  const bundleRows = Array.isArray(preview?.bundle_decomposition_rows) ? preview.bundle_decomposition_rows : [];
  const recipeRows = Array.isArray(preview?.recipe_match_rows) ? preview.recipe_match_rows : [];
  const ingredientRows = Array.isArray(preview?.ingredient_need_rows) ? preview.ingredient_need_rows : [];
  const blockers = Array.isArray(preview?.blockers) ? preview.blockers : [];
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
  const safety = preview?.safety || {};
  const pendingYieldItems = Array.isArray(preview?.pending_yield_items) ? preview.pending_yield_items : [];
  const traceIngredientItems = Array.isArray(preview?.trace_ingredient_items) ? preview.trace_ingredient_items : [];
  const deferredStockUnitItems = Array.isArray(preview?.deferred_stock_unit_items) ? preview.deferred_stock_unit_items : [];
  const exactOrderNumber = orderNumber?.trim();

  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Database className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div>
            <h2 className="text-sm font-bold text-foreground">Native Production / Inventory Readiness</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              G31A exact-order read-only preview. It translates native paid order line items into production demand, recipe demand, and ingredient/procurement context without creating batches, deducting inventory, or creating purchase orders.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={isRunning || !exactOrderNumber}
          onClick={onRun}
          className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors ${
            isRunning || !exactOrderNumber
              ? 'bg-muted text-muted-foreground border-border cursor-not-allowed'
              : 'bg-nuvira-gradient text-white border-primary hover:opacity-90'
          }`}
        >
          {isRunning ? 'Previewing...' : 'Run Production / Inventory Preview'}
        </button>
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
        Uses the exact order number from the Native Cutover Readiness Gate above. This panel is preview-only: no production batch, inventory deduction, purchase order, provider call, notification, sync, repair, or replay can be run from here.
      </div>

      {!exactOrderNumber && (
        <p className="text-xs text-muted-foreground rounded-lg border border-border/50 bg-background p-3">
          Enter an exact paid native order number above before running the production/inventory readiness preview.
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <StatCard
              label="Classification"
              value={formatLabel(preview.classification)}
              tone={blockers.length > 0 || warnings.length > 0 ? 'warning' : 'success'}
            />
            <StatCard label="Demand Rows" value={formatNumber(demandRows.length)} tone={demandRows.length > 0 ? 'success' : 'default'} />
            <StatCard label="Ingredient Rows" value={formatNumber(ingredientRows.length)} tone={ingredientRows.length > 0 ? 'success' : 'default'} />
            <StatCard label="Procurement Needed" value={formatNumber(preview.procurement_needed_count)} tone={Number(preview.procurement_needed_count || 0) > 0 ? 'warning' : 'success'} />
            <StatCard label="Blockers" value={formatNumber(blockers.length)} tone={blockers.length > 0 ? 'warning' : 'success'} />
            <StatCard label="Generated" value={formatDateTime(preview.generated_at)} />
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusChip value={preview.production_ready ? 'Production demand ready' : 'Production demand blocked'} />
            <StatusChip value={preview.inventory_calculation_ready ? 'Inventory calculation ready' : 'Inventory calculation blocked'} />
            <StatusChip value={preview.inventory_deduction_ready ? 'Inventory deduction theoretically ready' : 'Inventory deduction held'} />
            <StatusChip value={preview.procurement_conversion_ready ? 'Procurement conversion ready' : 'Procurement conversion pending'} />
            {pendingYieldItems.length > 0 && <StatusChip value={`Yield details pending: ${pendingYieldItems.length}`} />}
            {traceIngredientItems.length > 0 && <StatusChip value={`Trace ingredients pending: ${traceIngredientItems.length}`} />}
            {deferredStockUnitItems.length > 0 && <StatusChip value={`Stock units deferred: ${deferredStockUnitItems.length}`} />}
            <StatusChip value={preview.procurement_needed ? 'Procurement needed' : 'Procurement not needed'} />
            <StatusChip value={preview.hub_fallback_required ? 'Hub fallback required' : 'Hub fallback state unknown'} />
            <StatusChip value={safety.writes_performed === false ? 'No writes performed' : 'Write state unknown'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Order context</p>
              <p className="mt-1 text-xs text-foreground">
                {[
                  preview.order_number ? `Order ${preview.order_number}` : null,
                  preview.customer_app_order_present ? 'Customer App order present' : 'Customer App order missing',
                  preview.native_shopify_order_present ? 'Native mirror present' : 'Native mirror missing',
                  preview.native_fulfillment_task_present ? 'Native task present' : 'Native task missing',
                  `${formatNumber(preview.line_item_count)} line items`,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Schedule context</p>
              <p className="mt-1 text-xs text-foreground">
                {[
                  preview.production_date ? `Production ${preview.production_date}` : 'Production date pending',
                  preview.delivery_date ? `Delivery ${preview.delivery_date}` : 'Delivery date pending',
                  preview.fulfillment_type ? formatLabel(preview.fulfillment_type) : null,
                  preview.order_type ? formatLabel(preview.order_type) : null,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Master data read</p>
              <p className="mt-1 text-xs text-foreground">
                {[
                  `${formatNumber(preview.master_data_summary?.recipe_count)} recipes`,
                  `${formatNumber(preview.master_data_summary?.bundle_count)} bundles`,
                  `${formatNumber(preview.master_data_summary?.inventory_item_count)} inventory items`,
                  `${formatNumber(preview.master_data_summary?.ingredient_yield_count)} yields`,
                ].join(' · ')}
              </p>
            </div>
          </div>

          {(blockers.length > 0 || warnings.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                <p className="text-xs font-bold text-cyan-950">Production / inventory blockers</p>
                {blockers.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-[10px] text-cyan-900">
                    {blockers.map(blocker => (
                      <li key={blocker}>• {formatLabel(sanitizeAdminText(blocker))}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[10px] text-cyan-900">No blockers returned.</p>
                )}
              </div>
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                <p className="text-xs font-bold text-cyan-950">Warnings</p>
                {warnings.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-[10px] text-cyan-900">
                    {warnings.map(warning => (
                      <li key={warning}>• {formatLabel(sanitizeAdminText(warning))}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[10px] text-cyan-900">No warnings returned.</p>
                )}
              </div>
            </div>
          )}

          {demandRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Production demand rows</p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {demandRows.slice(0, 12).map((row, index) => (
                  <div key={`${row.product_name}-${row.source_line_item}-${index}`} className="rounded-lg border border-border/50 bg-background p-3 space-y-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-foreground">{row.product_name || 'Product pending'}</p>
                      <StatusChip value={row.recipe_match_status || 'recipe pending'} />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {[
                        `Qty ${formatNumber(row.quantity)}`,
                        row.source_line_item ? `From ${row.source_line_item}` : null,
                        row.bundle_name ? `Bundle ${row.bundle_name}` : null,
                        row.recipe_name ? `Recipe ${row.recipe_name}` : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {bundleRows.length > 0 && (
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <p className="text-xs font-bold text-foreground">Bundle decomposition</p>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {bundleRows.slice(0, 12).map(row => `${formatNumber(row.total_component_quantity)}x ${row.component_product_name} from ${row.bundle_name}`).join(' · ')}
              </p>
            </div>
          )}

          {recipeRows.length > 0 && (
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <p className="text-xs font-bold text-foreground">Recipe matching</p>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {recipeRows.slice(0, 12).map(row => `${row.product_name}: ${formatLabel(row.recipe_match_status)}`).join(' · ')}
              </p>
            </div>
          )}

          {ingredientRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Ingredient and procurement needs</p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {ingredientRows.slice(0, 12).map((row, index) => (
                  <div key={`${row.ingredient_name}-${index}`} className="rounded-lg border border-border/50 bg-background p-3 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-foreground">{row.ingredient_name || 'Ingredient pending'}</p>
                      <StatusChip value={row.procurement_needed ? 'Procurement needed' : row.status || 'covered'} />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {[
                        `Need ${formatNumber(row.proposed_quantity)} ${row.unit || 'units'}`,
                        row.current_stock !== null && row.current_stock !== undefined ? `Stock ${formatNumber(row.current_stock)} ${row.unit || ''}` : 'Stock unavailable',
                        row.projected_stock !== null && row.projected_stock !== undefined ? `Projected ${formatNumber(row.projected_stock)} ${row.unit || ''}` : null,
                        row.shortfall_quantity ? `Shortfall ${formatNumber(row.shortfall_quantity)} ${row.unit || ''}` : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {[
                        row.inventory_item_name ? `Inventory ${row.inventory_item_name}` : 'Inventory match missing',
                        row.ingredient_yield_name ? `Yield ${row.ingredient_yield_name}` : 'Yield match missing',
                        row.procurement_quantity ? `Procure ${formatNumber(row.procurement_quantity)} ${row.procurement_unit || row.purchase_unit || ''}` : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}


function NativeProductionDemandMaterializationPreview({
  preview,
  isRunning,
  error,
  orderNumber,
  onRun,
}) {
  const exactOrderNumber = orderNumber?.trim();
  const blockers = Array.isArray(preview?.materialization_blockers) ? preview.materialization_blockers : [];
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
  const batchRows = Array.isArray(preview?.proposed_production_batch_rows) ? preview.proposed_production_batch_rows : [];
  const sourceRows = Array.isArray(preview?.proposed_order_source_rows) ? preview.proposed_order_source_rows : [];
  const demandRows = Array.isArray(preview?.product_demand_rows) ? preview.product_demand_rows : [];
  const ingredientRows = Array.isArray(preview?.ingredient_need_rows) ? preview.ingredient_need_rows : [];
  const existingRows = Array.isArray(preview?.existing_native_batch_matches) ? preview.existing_native_batch_matches : [];
  const safety = preview?.safety || {};

  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Database className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div>
            <h2 className="text-sm font-bold text-foreground">Native Production Demand Materialization Preview</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              G31K read-only preview of the native ProductionBatch plan that would be created later if an exact gated materialization command is approved. No batch, inventory, purchase-order, task, order, provider, notification, sync, repair, or replay action is available here.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={isRunning || !exactOrderNumber}
          onClick={onRun}
          className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors ${
            isRunning || !exactOrderNumber
              ? 'bg-muted text-muted-foreground border-border cursor-not-allowed'
              : 'bg-nuvira-gradient text-white border-primary hover:opacity-90'
          }`}
        >
          {isRunning ? 'Previewing...' : 'Run Demand Materialization Preview'}
        </button>
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
        Preview only. No ProductionBatch, ManualProductionBatch, inventory deduction, purchase order, compliance log, sync, repair, replay, provider, payment, or notification write is exposed from this panel.
      </div>

      {!exactOrderNumber && (
        <p className="text-xs text-muted-foreground rounded-lg border border-border/50 bg-background p-3">
          Enter an exact paid native order number above before running the native production demand materialization preview.
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <StatCard label="Materialization" value={preview.materialization_ready ? 'Ready' : 'Held'} tone={preview.materialization_ready ? 'success' : 'warning'} />
            <StatCard label="Proposed Batches" value={formatNumber(batchRows.length)} tone={batchRows.length > 0 ? 'success' : 'warning'} />
            <StatCard label="Demand Rows" value={formatNumber(demandRows.length)} />
            <StatCard label="Order Sources" value={formatNumber(sourceRows.length)} />
            <StatCard label="Blockers" value={formatNumber(blockers.length)} tone={blockers.length > 0 ? 'warning' : 'success'} />
            <StatCard label="Generated" value={formatDateTime(preview.generated_at)} />
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusChip value={preview.production_ready ? 'Production ready' : 'Production blocked'} />
            <StatusChip value={preview.procurement_needed ? 'Procurement needed' : 'Procurement not needed'} />
            <StatusChip value={preview.procurement_conversion_ready ? 'Procurement conversion ready' : 'Procurement conversion pending'} />
            <StatusChip value={preview.inventory_deduction_ready ? 'Inventory deduction ready' : 'Inventory deduction held'} />
            <StatusChip value={preview.hub_fallback_required ? 'Hub fallback required' : 'Hub fallback state unknown'} />
            <StatusChip value={safety.writes_performed === false ? 'No writes performed' : 'Write state unknown'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Order context</p>
              <p className="mt-1 text-xs text-foreground">
                {[
                  preview.order_number ? `Order ${preview.order_number}` : null,
                  preview.customer_app_order_present ? 'Customer App order present' : 'Customer App order missing',
                  preview.native_shopify_order_present ? 'Native mirror present' : 'Native mirror missing',
                  preview.native_fulfillment_task_present ? 'Native task present' : 'Native task missing',
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Schedule context</p>
              <p className="mt-1 text-xs text-foreground">
                {[
                  preview.production_date ? `Production ${preview.production_date}` : 'Production date pending',
                  preview.delivery_date ? `Delivery ${preview.delivery_date}` : 'Delivery date pending',
                  preview.fulfillment_type ? formatLabel(preview.fulfillment_type) : null,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Next action</p>
              <p className="mt-1 text-xs text-foreground">{formatLabel(preview.next_action)}</p>
            </div>
          </div>

          {(blockers.length > 0 || warnings.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                <p className="text-xs font-bold text-cyan-950">Materialization blockers</p>
                {blockers.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-[10px] text-cyan-900">
                    {blockers.map(blocker => <li key={blocker}>• {formatLabel(sanitizeAdminText(blocker))}</li>)}
                  </ul>
                ) : (
                  <p className="mt-2 text-[10px] text-cyan-900">No materialization blockers returned.</p>
                )}
              </div>
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                <p className="text-xs font-bold text-cyan-950">Warnings</p>
                {warnings.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-[10px] text-cyan-900">
                    {warnings.slice(0, 16).map(warning => <li key={warning}>• {formatLabel(sanitizeAdminText(warning))}</li>)}
                  </ul>
                ) : (
                  <p className="mt-2 text-[10px] text-cyan-900">No warnings returned.</p>
                )}
              </div>
            </div>
          )}

          {batchRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Proposed native ProductionBatch rows</p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {batchRows.slice(0, 12).map((row, index) => (
                  <div key={`${row.batch_key}-${index}`} className="rounded-lg border border-border/50 bg-background p-3 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-foreground">{sanitizeAdminText(row.product_name) || 'Product pending'}</p>
                      <StatusChip value={row.would_skip_existing ? 'Dedupe existing' : row.would_update_existing ? 'Would update existing' : row.would_create ? 'Would create' : 'Preview'} />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {[
                        row.batch_key,
                        row.production_date ? `Production ${row.production_date}` : null,
                        `Planned ${formatNumber(row.planned_units)} units`,
                        `${formatNumber(row.source_order_count)} source orders`,
                      ].filter(Boolean).join(' · ')}
                    </p>
                    {row.existing_batch_key && (
                      <p className="text-[10px] text-muted-foreground">
                        Existing: {sanitizeAdminText(row.existing_batch_key)} · {formatLabel(sanitizeAdminText(row.existing_batch_status))}{row.existing_batch_locked ? ' · locked' : ''}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {sourceRows.length > 0 && (
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <p className="text-xs font-bold text-foreground">Order source rows</p>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {sourceRows.slice(0, 12).map(row => `${formatNumber(row.quantity_contribution)}x ${sanitizeAdminText(row.product_name)} from ${sanitizeAdminText(row.source_line_item)} (${formatLabel(row.demand_source_type)})`).join(' · ')}
              </p>
            </div>
          )}

          {existingRows.length > 0 && (
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <p className="text-xs font-bold text-foreground">Existing native batch context</p>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {existingRows.slice(0, 8).map(row => `${sanitizeAdminText(row.batch_id || row.production_batch_id)} · ${sanitizeAdminText(row.product_name)} · ${formatLabel(sanitizeAdminText(row.status))}${row.source_match ? ' · source match' : ''}`).join(' · ')}
              </p>
            </div>
          )}

          {ingredientRows.length > 0 && (
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <p className="text-xs font-bold text-foreground">Ingredient/procurement summary</p>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {ingredientRows.slice(0, 12).map(row => `${sanitizeAdminText(row.ingredient_name)}: need ${formatNumber(row.proposed_quantity)} ${row.unit || 'units'}${row.procurement_needed ? ' · procurement needed' : ''}${row.yield_details_pending ? ' · yield pending' : ''}`).join(' · ')}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}


function NativeProductionLifecyclePreview({
  preview,
  isRunning,
  error,
  orderNumber,
  onRun,
}) {
  const exactOrderNumber = orderNumber?.trim();
  const batchRows = Array.isArray(preview?.batch_lifecycle_rows) ? preview.batch_lifecycle_rows : [];
  const blockers = Array.isArray(preview?.blockers) ? preview.blockers : [];
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
  const startPreview = preview?.start_preview || {};
  const completePreview = preview?.complete_preview || {};
  const verifyPreview = preview?.verify_preview || {};
  const compliancePreview = preview?.compliance_preview || {};
  const cascadePreview = preview?.cascade_preview || {};
  const safety = preview?.safety || {};

  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <ShieldCheck className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div>
            <h2 className="text-sm font-bold text-foreground">Native Production Lifecycle Preview</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              G31N read-only preview for native ProductionBatch start, complete, and verify readiness. It does not start, complete, verify, create compliance logs, mutate orders/tasks, deduct inventory, create purchase orders, call providers, send notifications, sync, repair, or replay.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={isRunning || !exactOrderNumber}
          onClick={onRun}
          className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors ${
            isRunning || !exactOrderNumber
              ? 'bg-muted text-muted-foreground border-border cursor-not-allowed'
              : 'bg-nuvira-gradient text-white border-primary hover:opacity-90'
          }`}
        >
          {isRunning ? 'Previewing...' : 'Run Lifecycle Preview'}
        </button>
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
        Preview only. No Start, Complete, Verify, Pack Task, Bottle Order, compliance log, inventory deduction, purchase order, sync, repair, replay, provider, payment, or notification write is exposed from this panel.
      </div>

      {!exactOrderNumber && (
        <p className="text-xs text-muted-foreground rounded-lg border border-border/50 bg-background p-3">
          Enter an exact paid native order number above before running the native production lifecycle preview.
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <StatCard label="Batches" value={formatNumber(preview.batch_count)} tone={Number(preview.batch_count || 0) > 0 ? 'success' : 'warning'} />
            <StatCard label="Ready to Start" value={formatNumber(startPreview.ready_count)} tone={Number(startPreview.ready_count || 0) > 0 ? 'success' : 'default'} />
            <StatCard label="Ready to Complete" value={formatNumber(completePreview.ready_count)} tone={Number(completePreview.ready_count || 0) > 0 ? 'success' : 'default'} />
            <StatCard label="Ready to Verify" value={formatNumber(verifyPreview.ready_count)} tone={Number(verifyPreview.ready_count || 0) > 0 ? 'success' : 'default'} />
            <StatCard label="Blockers" value={formatNumber(blockers.length)} tone={blockers.length > 0 ? 'warning' : 'success'} />
            <StatCard label="Generated" value={formatDateTime(preview.generated_at)} />
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusChip value={safety.writes_performed === false ? 'No writes performed' : 'Write state unknown'} />
            <StatusChip value={preview.live_execution_approved ? 'Live execution approved' : 'Preview only'} />
            <StatusChip value={preview.inventory_deduction_ready ? 'Inventory deduction ready' : 'Inventory deduction held'} />
            <StatusChip value={preview.purchase_order_ready ? 'PO automation ready' : 'PO automation held'} />
            <StatusChip value={preview.hub_fallback_required ? 'Hub fallback required' : 'Hub fallback state unknown'} />
            <StatusChip value={cascadePreview.customer_facing_status_impact || 'No customer status impact'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Order context</p>
              <p className="mt-1 text-xs text-foreground">
                {[
                  preview.order_number ? `Order ${preview.order_number}` : null,
                  preview.customer_app_order_present ? 'Customer App order present' : 'Customer App order missing',
                  preview.native_shopify_order_present ? 'Native mirror present' : 'Native mirror missing',
                  preview.native_fulfillment_task_present ? 'Native task present' : 'Native task missing',
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Schedule context</p>
              <p className="mt-1 text-xs text-foreground">
                {[
                  preview.production_date ? `Production ${preview.production_date}` : 'Production date pending',
                  preview.delivery_date ? `Delivery ${preview.delivery_date}` : 'Delivery date pending',
                  preview.fulfillment_type ? formatLabel(preview.fulfillment_type) : null,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Next action</p>
              <p className="mt-1 text-xs text-foreground">{formatLabel(preview.next_action)}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
              <p className="text-xs font-bold text-emerald-950">Start preview</p>
              <p className="mt-1 text-[10px] text-emerald-900">{formatNumber(startPreview.ready_count)} ready · {formatNumber(startPreview.blocked_count)} blocked{Number(startPreview.already_started_count || 0) > 0 ? ` · ${formatNumber(startPreview.already_started_count)} already started` : ''}</p>
              <p className="mt-2 text-[10px] text-emerald-900">Expected later writes: {(startPreview.expected_writes_if_later_approved || []).map(item => formatLabel(item)).join(', ') || 'None'}</p>
            </div>
            <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
              <p className="text-xs font-bold text-cyan-950">Complete preview</p>
              <p className="mt-1 text-[10px] text-cyan-900">{formatNumber(completePreview.ready_count)} ready · {formatNumber(completePreview.blocked_count)} blocked</p>
              <p className="mt-2 text-[10px] text-cyan-900">Actual units and completion data are required before completion can pass.</p>
            </div>
            <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
              <p className="text-xs font-bold text-cyan-950">Verify / compliance preview</p>
              <p className="mt-1 text-[10px] text-cyan-900">{formatNumber(verifyPreview.ready_count)} ready · {formatNumber(verifyPreview.blocked_count)} blocked</p>
              <p className="mt-2 text-[10px] text-cyan-900">Compliance log creation held. Missing data: {(compliancePreview.missing_compliance_data || []).map(item => formatLabel(item)).join(', ') || 'None returned'}.</p>
            </div>
          </div>

          {(blockers.length > 0 || warnings.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                <p className="text-xs font-bold text-cyan-950">Preview blockers</p>
                {blockers.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-[10px] text-cyan-900">
                    {blockers.map(blocker => <li key={blocker}>• {formatLabel(sanitizeAdminText(blocker))}</li>)}
                  </ul>
                ) : (
                  <p className="mt-2 text-[10px] text-cyan-900">No top-level lifecycle preview blockers returned.</p>
                )}
              </div>
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                <p className="text-xs font-bold text-cyan-950">Warnings</p>
                {warnings.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-[10px] text-cyan-900">
                    {warnings.slice(0, 16).map(warning => <li key={warning}>• {formatLabel(sanitizeAdminText(warning))}</li>)}
                  </ul>
                ) : (
                  <p className="mt-2 text-[10px] text-cyan-900">No warnings returned.</p>
                )}
              </div>
            </div>
          )}

          {batchRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Native ProductionBatch lifecycle rows</p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {batchRows.slice(0, 12).map((row, index) => (
                  <div key={`${row.batch_id || row.production_batch_id}-${index}`} className="rounded-lg border border-border/50 bg-background p-3 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-foreground">{sanitizeAdminText(row.product_name) || 'Product pending'}</p>
                      <StatusChip value={lifecycleStatusChip(row)} />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {[
                        sanitizeAdminText(row.batch_id || row.production_batch_id),
                        row.production_date ? `Production ${row.production_date}` : null,
                        row.current_status ? `Status ${formatLabel(sanitizeAdminText(row.current_status))}` : null,
                        `Planned ${formatNumber(row.planned_units)} units`,
                        row.next_allowed_transition ? `Next ${formatLabel(row.next_allowed_transition)}` : row.start_state === 'already_started' ? 'Next Complete after actual units' : 'No next transition',
                      ].filter(Boolean).join(' · ')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <StatusChip value={lifecycleStartChip(row)} />
                      <StatusChip value={lifecycleCompleteChip(row)} />
                      <StatusChip value={lifecycleVerifyChip(row)} />
                    </div>
                    {Array.isArray(row.lifecycle_warnings) && row.lifecycle_warnings.length > 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        Warnings: {row.lifecycle_warnings.slice(0, 5).map(item => formatLabel(sanitizeAdminText(item))).join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border/50 bg-background p-3">
            <p className="text-xs font-bold text-foreground">Cascade preview</p>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {[
                cascadePreview.fulfillment_task_pack_cascade_ready ? 'Fulfillment task pack cascade ready' : 'Fulfillment task pack cascade held',
                cascadePreview.shopify_order_bottled_cascade_ready ? 'ShopifyOrder bottled cascade ready' : 'ShopifyOrder bottled cascade held',
                cascadePreview.no_task_order_mutation ? 'No task/order mutation' : 'Task/order write state unknown',
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function NativeProductionMasterDataParityPreview({
  preview,
  isRunning,
  error,
  orderNumber,
  onRun,
}) {
  const exactOrderNumber = orderNumber?.trim();
  const requiredRows = Array.isArray(preview?.required_master_data_rows) ? preview.required_master_data_rows : [];
  const mirrorReadyRows = Array.isArray(preview?.mirror_ready_rows) ? preview.mirror_ready_rows : [];
  const mirrorBlockers = Array.isArray(preview?.mirror_blockers) ? preview.mirror_blockers : [];
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
  const customerAppCounts = preview?.customer_app_counts || {};
  const hubCounts = preview?.hub_counts || {};
  const safety = preview?.safety || {};
  const missingNativeRecipes = Array.isArray(preview?.missing_native_recipes) ? preview.missing_native_recipes : [];
  const missingNativeBundles = Array.isArray(preview?.missing_native_bundles) ? preview.missing_native_bundles : [];
  const missingNativeInventory = Array.isArray(preview?.missing_native_inventory_items) ? preview.missing_native_inventory_items : [];
  const missingNativeYields = Array.isArray(preview?.missing_native_ingredient_yields) ? preview.missing_native_ingredient_yields : [];
  const gapClosure = preview?.master_data_gap_closure_preview || {};
  const seedPacketRows = Array.isArray(preview?.seed_packet_rows) ? preview.seed_packet_rows : [];
  const blockedRows = Array.isArray(preview?.blocked_rows) ? preview.blocked_rows : [];
  const manualMappingRows = Array.isArray(preview?.manual_mapping_required_rows) ? preview.manual_mapping_required_rows : [];
  const ownerInputRows = Array.isArray(preview?.owner_input_required_rows) ? preview.owner_input_required_rows : [];
  const hubMissingRows = Array.isArray(preview?.hub_missing_rows) ? preview.hub_missing_rows : [];
  const aliasCandidateRows = Array.isArray(preview?.alias_candidate_rows) ? preview.alias_candidate_rows : [];
  const productionMasterDataReady = Boolean(preview?.production_master_data_ready ?? gapClosure.production_master_data_ready);
  const nonStockSeedReady = Boolean(preview?.non_stock_master_data_seed_ready ?? gapClosure.non_stock_master_data_seed_ready ?? preview?.seed_packet_ready);
  const procurementConversionReady = Boolean(preview?.procurement_conversion_ready ?? gapClosure.procurement_conversion_ready);
  const inventoryDeductionReady = Boolean(preview?.inventory_deduction_ready ?? gapClosure.inventory_deduction_ready);
  const yieldDetailsPending = Boolean(preview?.yield_details_pending ?? gapClosure.yield_details_pending);
  const pendingYieldItems = Array.isArray(preview?.pending_yield_items)
    ? preview.pending_yield_items
    : Array.isArray(gapClosure.pending_yield_items)
      ? gapClosure.pending_yield_items
      : [];
  const approvedAliasMappings = Array.isArray(preview?.approved_alias_mappings)
    ? preview.approved_alias_mappings
    : Array.isArray(gapClosure.approved_alias_mappings)
      ? gapClosure.approved_alias_mappings
      : [];
  const inventorySeedPolicy = preview?.inventory_seed_policy || gapClosure.inventory_seed_policy;
  const yieldPolicy = preview?.yield_policy || gapClosure.yield_policy;
  const nonStockImportPreview = preview?.customer_app_non_stock_master_data_import_preview || {};
  const nonStockImportCreateRows = Array.isArray(nonStockImportPreview.create_rows) ? nonStockImportPreview.create_rows : [];
  const nonStockImportDeferredRows = Array.isArray(nonStockImportPreview.deferred_rows) ? nonStockImportPreview.deferred_rows : [];
  const nonStockImportBlockedRows = Array.isArray(nonStockImportPreview.blocked_rows) ? nonStockImportPreview.blocked_rows : [];
  const nonStockImportReady = Boolean(preview?.non_stock_import_preview_ready ?? gapClosure.non_stock_import_preview_ready ?? nonStockImportPreview.import_ready);

  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Database className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div>
            <h2 className="text-sm font-bold text-foreground">Native Production Master Data Parity</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              G31B/G31E read-only preview comparing Customer App native Recipe, Bundle, InventoryItem, and IngredientYield readiness against Hub master data and approved make-to-order seed policies. It does not import, seed, mirror, or write master data.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={isRunning || !exactOrderNumber}
          onClick={onRun}
          className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors ${
            isRunning || !exactOrderNumber
              ? 'bg-muted text-muted-foreground border-border cursor-not-allowed'
              : 'bg-nuvira-gradient text-white border-primary hover:opacity-90'
          }`}
        >
          {isRunning ? 'Previewing...' : 'Run Master Data Parity Preview'}
        </button>
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
        Preview only. No Recipe, Bundle, InventoryItem, IngredientYield, ProductionBatch, inventory deduction, purchase order, sync, repair, or replay action is available from this panel.
      </div>

      {!exactOrderNumber && (
        <p className="text-xs text-muted-foreground rounded-lg border border-border/50 bg-background p-3">
          Enter an exact paid native order number above before running the master-data parity preview.
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <StatCard
              label="Next Action"
              value={formatLabel(preview.recommended_next_action)}
              tone={mirrorBlockers.length > 0 ? 'warning' : 'success'}
            />
            <StatCard label="Required Rows" value={formatNumber(requiredRows.length)} />
            <StatCard label="Mirror Ready" value={formatNumber(mirrorReadyRows.length)} tone={mirrorReadyRows.length > 0 ? 'success' : 'default'} />
            <StatCard label="Mirror Blockers" value={formatNumber(mirrorBlockers.length)} tone={mirrorBlockers.length > 0 ? 'warning' : 'success'} />
            <StatCard label="Line Items" value={formatNumber(preview.line_item_count)} />
            <StatCard label="Generated" value={formatDateTime(preview.generated_at)} />
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusChip value={preview.native_production_readiness_after_mirror ? 'Ready after mirror' : 'Still blocked after mirror'} />
            <StatusChip value={productionMasterDataReady ? 'Production master data ready' : 'Production master data blocked'} />
            <StatusChip value={nonStockSeedReady ? 'Non-stock mirror ready' : 'Non-stock mirror held'} />
            <StatusChip value={procurementConversionReady ? 'Procurement conversion ready' : 'Procurement conversion pending'} />
            <StatusChip value={inventoryDeductionReady ? 'Inventory deduction ready' : 'Inventory deduction held'} />
            <StatusChip value={preview.hub_fallback_required ? 'Hub fallback required' : 'Hub fallback state unknown'} />
            <StatusChip value={preview.hub_lookup?.available ? 'Hub master data reachable' : 'Hub master data unavailable'} />
            <StatusChip value={safety.writes_performed === false ? 'No writes performed' : 'Write state unknown'} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <StatCard label="Production Master Data" value={productionMasterDataReady ? 'Ready' : 'Blocked'} tone={productionMasterDataReady ? 'success' : 'warning'} />
            <StatCard label="Non-Stock Seed" value={nonStockSeedReady ? 'Ready' : 'Held'} tone={nonStockSeedReady ? 'success' : 'warning'} />
            <StatCard label="Procurement Conversion" value={procurementConversionReady ? 'Ready' : 'Pending'} tone={procurementConversionReady ? 'success' : 'warning'} />
            <StatCard label="Inventory Deduction" value={inventoryDeductionReady ? 'Ready' : 'Held'} tone={inventoryDeductionReady ? 'warning' : 'default'} />
            <StatCard label="Yield Details" value={yieldDetailsPending ? 'Pending' : 'Complete'} tone={yieldDetailsPending ? 'warning' : 'success'} />
          </div>

          {(inventorySeedPolicy || yieldPolicy || pendingYieldItems.length > 0 || approvedAliasMappings.length > 0) && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
              <p className="text-xs font-bold text-emerald-950">Approved make-to-order master-data policy</p>
              <p className="text-[10px] text-emerald-900">
                {[
                  inventorySeedPolicy ? `Inventory seed policy: ${formatLabel(inventorySeedPolicy)}` : null,
                  yieldPolicy ? `Yield policy: ${formatLabel(yieldPolicy)}` : null,
                  pendingYieldItems.length > 0 ? `Pending yield details: ${pendingYieldItems.map(item => sanitizeAdminText(item)).join(', ')}` : null,
                ].filter(Boolean).join(' · ')}
              </p>
              {approvedAliasMappings.length > 0 && (
                <ul className="space-y-1 text-[10px] text-emerald-900">
                  {approvedAliasMappings.slice(0, 6).map((mapping, index) => (
                    <li key={`${mapping.source_name}-${mapping.target_hub_id || index}`}>
                      • Approved alias: {sanitizeAdminText(mapping.source_name)} → {sanitizeAdminText(mapping.target_hub_name)}{mapping.target_hub_id ? ` · Hub ${mapping.target_hub_id}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[10px] text-emerald-900">
                Missing yield purchase-conversion details remain warnings only for production demand visibility; inventory deduction and PO automation remain held.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <p className="text-xs font-bold text-foreground">Customer App native counts</p>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {[
                  `${formatNumber(customerAppCounts.recipe_count)} recipes`,
                  `${formatNumber(customerAppCounts.bundle_count)} bundles`,
                  `${formatNumber(customerAppCounts.inventory_item_count)} inventory items`,
                  `${formatNumber(customerAppCounts.ingredient_yield_count)} yields`,
                ].join(' · ')}
              </p>
            </div>
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <p className="text-xs font-bold text-foreground">Hub master-data counts</p>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {[
                  `${formatNumber(hubCounts.recipe_count)} recipes`,
                  `${formatNumber(hubCounts.bundle_count)} bundles`,
                  `${formatNumber(hubCounts.inventory_item_count)} inventory items`,
                  `${formatNumber(hubCounts.ingredient_yield_count)} yields`,
                ].join(' · ')}
              </p>
            </div>
          </div>

          {(missingNativeRecipes.length > 0 || missingNativeBundles.length > 0 || missingNativeInventory.length > 0 || missingNativeYields.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                <p className="text-xs font-bold text-cyan-950">Missing native product master data</p>
                <p className="mt-2 text-[10px] text-cyan-900">
                  {[
                    missingNativeRecipes.length > 0 ? `Recipes: ${missingNativeRecipes.map(item => formatLabel(sanitizeAdminText(item))).join(', ')}` : null,
                    missingNativeBundles.length > 0 ? `Bundles: ${missingNativeBundles.map(item => formatLabel(sanitizeAdminText(item))).join(', ')}` : null,
                  ].filter(Boolean).join(' · ') || 'No missing native recipe or bundle rows returned.'}
                </p>
              </div>
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                <p className="text-xs font-bold text-cyan-950">Missing native ingredient master data</p>
                <p className="mt-2 text-[10px] text-cyan-900">
                  {[
                    missingNativeInventory.length > 0 ? `Inventory: ${missingNativeInventory.map(item => formatLabel(sanitizeAdminText(item))).join(', ')}` : null,
                    missingNativeYields.length > 0 ? `Yields: ${missingNativeYields.map(item => formatLabel(sanitizeAdminText(item))).join(', ')}` : null,
                  ].filter(Boolean).join(' · ') || 'No missing native inventory or yield rows returned.'}
                </p>
              </div>
            </div>
          )}

          {seedPacketRows.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-amber-950">Master Data Gap Closure Preview</p>
                  <p className="mt-1 text-[10px] text-amber-900">
                    Read-only seed packet preview. No Bundle, Recipe, InventoryItem, IngredientYield, ProductionBatch, inventory, or purchase-order writes are available here.
                  </p>
                </div>
                <StatusChip value={safety.writes_performed === false ? 'No writes performed' : 'Write state unknown'} />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                <StatCard
                  label="Seed Packet"
                  value={nonStockSeedReady ? 'Ready' : 'Not Ready'}
                  tone={nonStockSeedReady ? 'success' : 'warning'}
                />
                <StatCard label="Gap Next Action" value={formatLabel(preview.next_action || gapClosure.next_action)} tone="warning" />
                <StatCard label="Seed Rows" value={formatNumber(seedPacketRows.length)} />
                <StatCard label="Blocked" value={formatNumber(blockedRows.length)} tone={blockedRows.length > 0 ? 'warning' : 'success'} />
                <StatCard label="Manual / Alias" value={formatNumber(manualMappingRows.length)} tone={manualMappingRows.length > 0 ? 'warning' : 'default'} />
                <StatCard label="Owner Input" value={formatNumber(ownerInputRows.length)} tone={ownerInputRows.length > 0 ? 'warning' : 'default'} />
              </div>

              {(hubMissingRows.length > 0 || aliasCandidateRows.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  <div className="rounded-lg border border-amber-200 bg-background/80 p-3">
                    <p className="text-xs font-bold text-foreground">Hub missing / owner-input rows</p>
                    {hubMissingRows.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-[10px] text-muted-foreground">
                        {hubMissingRows.slice(0, 8).map((row, index) => (
                          <li key={`${row.entity_type}-${row.customer_app_target_name}-${index}`}>
                            • {formatLabel(row.entity_type)}: {sanitizeAdminText(row.customer_app_target_name)} · {formatLabel(row.proposed_action)}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-[10px] text-muted-foreground">No Hub-missing rows returned.</p>
                    )}
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-background/80 p-3">
                    <p className="text-xs font-bold text-foreground">Alias / manual mapping candidates</p>
                    {aliasCandidateRows.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-[10px] text-muted-foreground">
                        {aliasCandidateRows.slice(0, 8).map((row, index) => (
                          <li key={`${row.entity_type}-${row.customer_app_target_name}-${index}`}>
                            • {formatLabel(row.entity_type)}: {sanitizeAdminText(row.customer_app_target_name)} → {sanitizeAdminText(row.hub_source_name || row.alias_candidate_type || 'candidate')} · {formatLabel(row.proposed_action)}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-[10px] text-muted-foreground">No alias/manual mapping candidates returned.</p>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-amber-900 font-semibold">Seed packet rows</p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {seedPacketRows.slice(0, 12).map((row, index) => (
                    <div key={`${row.entity_type}-${row.customer_app_target_name}-${index}`} className="rounded-lg border border-amber-200 bg-background/80 p-3 space-y-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground">{sanitizeAdminText(row.customer_app_target_name) || 'Seed row'}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {formatLabel(row.entity_type)} · {formatLabel(row.status)} · {formatLabel(row.proposed_action)}
                          </p>
                        </div>
                        <StatusChip value={row.seed_ready ? 'Seed ready' : 'Held'} />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {[
                          row.hub_source_id ? `Hub ${row.hub_source_id}` : null,
                          row.hub_source_name ? `Source ${sanitizeAdminText(row.hub_source_name)}` : null,
                          row.alias_confidence ? `Alias confidence ${formatNumber(row.alias_confidence)}` : null,
                          Array.isArray(row.owner_input_fields_required) && row.owner_input_fields_required.length > 0 ? `Owner input: ${row.owner_input_fields_required.join(', ')}` : null,
                        ].filter(Boolean).join(' · ') || 'No Hub source details returned.'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {nonStockImportPreview?.dry_run && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-emerald-950">Customer App Non-Stock Mirror Import Preview</p>
                  <p className="mt-1 text-[10px] text-emerald-900">
                    G31F schema-safe import packet preview. It shows exact Customer App Recipe, Bundle, InventoryItem, and matched IngredientYield payloads that could be approved later. It does not create or update records.
                  </p>
                </div>
                <StatusChip value={nonStockImportPreview.writes_performed === false ? 'No writes performed' : 'Write state unknown'} />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                <StatCard
                  label="Import Preview"
                  value={nonStockImportReady ? 'Ready' : 'Held'}
                  tone={nonStockImportReady ? 'success' : 'warning'}
                />
                <StatCard label="Create Rows" value={formatNumber(nonStockImportCreateRows.length)} tone={nonStockImportCreateRows.length > 0 ? 'success' : 'default'} />
                <StatCard label="Deferred Rows" value={formatNumber(nonStockImportDeferredRows.length)} tone={nonStockImportDeferredRows.length > 0 ? 'warning' : 'default'} />
                <StatCard label="Blocked Rows" value={formatNumber(nonStockImportBlockedRows.length)} tone={nonStockImportBlockedRows.length > 0 ? 'warning' : 'success'} />
                <StatCard label="Procurement Conversion" value={nonStockImportPreview.procurement_conversion_ready ? 'Ready' : 'Pending'} tone="warning" />
                <StatCard label="Inventory Deduction" value={nonStockImportPreview.inventory_deduction_ready ? 'Ready' : 'Held'} tone="warning" />
              </div>

              <div className="rounded-lg border border-emerald-200 bg-background/80 p-3">
                <p className="text-xs font-bold text-foreground">Import packet policy</p>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  {[
                    nonStockImportPreview.inventory_seed_policy ? `Inventory: ${formatLabel(nonStockImportPreview.inventory_seed_policy)}` : null,
                    nonStockImportPreview.yield_policy ? `Yield: ${formatLabel(nonStockImportPreview.yield_policy)}` : null,
                    nonStockImportPreview.next_action ? `Next: ${formatLabel(nonStockImportPreview.next_action)}` : null,
                    nonStockImportPreview.required_approval_phrase_template ? `Approval template: ${nonStockImportPreview.required_approval_phrase_template}` : null,
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>

              {nonStockImportCreateRows.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-emerald-900 font-semibold">Create-if-missing preview rows</p>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {nonStockImportCreateRows.slice(0, 12).map((row, index) => (
                      <div key={`${row.target_entity}-${row.match_value}-${index}`} className="rounded-lg border border-emerald-200 bg-background/80 p-3 space-y-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-foreground">{sanitizeAdminText(row.match_value) || 'Import row'}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {formatLabel(row.target_entity)} · {formatLabel(row.operation)} · {formatLabel(row.proposed_action)}
                            </p>
                          </div>
                          <StatusChip value={row.import_ready ? 'Schema safe' : 'Held'} />
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {[
                            row.source_hub_id ? `Hub ${row.source_hub_id}` : null,
                            row.source_hub_name ? `Source ${sanitizeAdminText(row.source_hub_name)}` : null,
                            row.match_field ? `Match ${row.match_field}` : null,
                            row.payload?.stock === 0 && row.target_entity === 'InventoryItem' ? 'Stock seeded 0' : null,
                          ].filter(Boolean).join(' · ') || 'No import source details returned.'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {nonStockImportDeferredRows.length > 0 && (
                <div className="rounded-lg border border-emerald-200 bg-background/80 p-3">
                  <p className="text-xs font-bold text-foreground">Deferred yield details</p>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    {nonStockImportDeferredRows.slice(0, 12).map(row => sanitizeAdminText(row.match_value)).filter(Boolean).join(', ')}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Deferred yield rows are not guessed and do not block production demand visibility. They keep procurement conversion, inventory deduction, and PO automation held.
                  </p>
                </div>
              )}
            </div>
          )}

          {(mirrorBlockers.length > 0 || warnings.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                <p className="text-xs font-bold text-cyan-950">Mirror blockers</p>
                {mirrorBlockers.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-[10px] text-cyan-900">
                    {mirrorBlockers.map(blocker => (
                      <li key={blocker}>• {formatLabel(sanitizeAdminText(blocker))}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[10px] text-cyan-900">No mirror blockers returned.</p>
                )}
              </div>
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                <p className="text-xs font-bold text-cyan-950">Warnings</p>
                {warnings.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-[10px] text-cyan-900">
                    {warnings.map(warning => (
                      <li key={warning}>• {formatLabel(sanitizeAdminText(warning))}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[10px] text-cyan-900">No warnings returned.</p>
                )}
              </div>
            </div>
          )}

          {requiredRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Required master-data rows</p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {requiredRows.slice(0, 16).map((row, index) => (
                  <div key={`${row.required_type}-${row.required_name}-${index}`} className="rounded-lg border border-border/50 bg-background p-3 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground">{row.required_name || 'Master data row'}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {formatLabel(row.required_type)} · Source {row.source_line_item || 'not returned'}
                        </p>
                      </div>
                      <StatusChip value={row.mirror_readiness || 'review'} />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {[
                        row.native_present ? 'Native present' : 'Native missing',
                        row.hub_match_status ? `Hub ${formatLabel(row.hub_match_status)}` : null,
                        row.field_compatibility_status ? `Schema ${formatLabel(row.field_compatibility_status)}` : null,
                        row.hub_id ? `Hub ${row.hub_id}` : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function HistoricalBackfillPreview({ preview, isRunning, error, onRun }) {
  const summary = preview?.summary || {};
  const fetchStats = preview?.fetch_stats || {};
  const rows = Array.isArray(preview?.preview_rows) ? preview.preview_rows : [];
  const posCancellationRows = rows.filter(isPosCancellationPreviewRow);
  const nonPosRows = rows.filter(row => !isPosCancellationPreviewRow(row));
  const posCancellationOrderNumbers = posCancellationRows
    .map(row => row.order?.order_number)
    .filter(Boolean)
    .join(', ');
  const countsByAction = summary.counts_by_action || {};
  const countsByReason = summary.counts_by_reason || {};
  const posCancellationCount =
    Number(countsByReason.historical_pos_test_order_cancelled || 0) +
    Number(countsByReason.historical_pos_test_order_needs_cancellation || 0) +
    Number(countsByReason.historical_pos_test_order_already_cancelled || 0);

  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Database className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div>
            <h2 className="text-sm font-bold text-foreground">Historical Hub Backfill Preview</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Read-only comparison of Hub historical orders against native Customer App operational records. No backfill writes run from this page.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={isRunning}
          onClick={onRun}
          className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors ${
            isRunning
              ? 'bg-muted text-muted-foreground border-border cursor-not-allowed'
              : 'bg-nuvira-gradient text-white border-primary hover:opacity-90'
          }`}
        >
          {isRunning ? 'Previewing...' : 'Run Read-Only Preview'}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <StatCard label="Hub Orders Scanned" value={formatNumber(summary.hub_orders_scanned)} />
        <StatCard label="Already Native" value={formatNumber(summary.already_native_count)} tone="success" />
        <StatCard label="Create / Update" value={formatNumber(summary.candidate_create_or_update_count)} tone={Number(summary.candidate_create_or_update_count || 0) > 0 ? 'warning' : 'default'} />
        <StatCard label="Blocked" value={formatNumber(summary.blocked_count)} tone={Number(summary.blocked_count || 0) > 0 ? 'warning' : 'default'} />
        <StatCard label="Hub Fetches" value={formatNumber(fetchStats.hub_fetches_attempted)} sublabel={fetchStats.scope || preview?.scope || 'not run'} />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {preview && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
          Preview only. Live backfill remains disabled and requires a separate scoped approval with idempotency and snapshots.
        </div>
      )}

      {preview && (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-cyan-950">Historical POS test cancellation candidates</p>
              <p className="text-[10px] text-cyan-800 mt-0.5">
                These rows are treated as archived/canceled historical POS tests and excluded from production demand. Live backfill still requires exact allowlisting and include_archived.
              </p>
            </div>
            <StatusChip value={`${formatNumber(posCancellationCount)} POS test rows`} />
          </div>
          {posCancellationRows.length > 0 ? (
            <div className="space-y-2">
              {posCancellationOrderNumbers && (
                <div className="rounded-lg border border-cyan-200 bg-white/70 p-2">
                  <p className="text-[10px] uppercase tracking-wider text-cyan-800 font-semibold">Exact allowlist candidates</p>
                  <p className="text-xs font-semibold text-cyan-950 break-words mt-1">{posCancellationOrderNumbers}</p>
                </div>
              )}
              {posCancellationRows.slice(0, 20).map((row, index) => (
                <div key={`pos-${row.order?.order_number || index}-${row.reason}`} className="rounded-lg border border-cyan-200 bg-white/80 p-3 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-cyan-950">{row.order?.order_number || 'Order pending'}</p>
                      <p className="text-[10px] text-cyan-800 mt-0.5">
                        {[
                          row.order?.customer_name || row.order?.customer_email || null,
                          row.order?.source_channel ? formatLabel(row.order.source_channel) : 'POS',
                          row.order?.payment_status ? formatLabel(row.order.payment_status) : null,
                          row.order?.total_price ? `$${Number(row.order.total_price).toFixed(2)}` : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <StatusChip value={row.reason} />
                  </div>
                  {row.order?.items?.length > 0 && (
                    <p className="text-[10px] text-cyan-900">
                      Items: {row.order.items.map(item => `${item.quantity}x ${item.title}`).join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-cyan-900 rounded-lg border border-cyan-200 bg-white/70 p-2">
              No POS test cancellation rows were returned in the preview rows.
            </p>
          )}
        </div>
      )}

      {Object.keys(countsByAction).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(countsByAction).map(([action, count]) => (
            <StatusChip key={action} value={`${formatLabel(action)}: ${formatNumber(count)}`} />
          ))}
        </div>
      )}

      {rows.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Preview Rows Requiring Attention</p>
          {nonPosRows.slice(0, 12).map((row, index) => (
            <div key={`${row.order?.order_number || index}-${row.reason}`} className="rounded-lg border border-border/50 bg-background p-3 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">{row.order?.order_number || 'Order pending'}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {[
                      row.order?.customer_name || row.order?.customer_email || null,
                      row.order?.source_channel ? formatLabel(row.order.source_channel) : null,
                      row.order?.payment_status ? formatLabel(row.order.payment_status) : null,
                      row.order?.line_item_count ? `${row.order.line_item_count} item rows` : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <StatusChip value={row.action} />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Reason: {formatLabel(row.reason)}
                {row.diff_fields?.length > 0 ? ` · Diff: ${row.diff_fields.map(formatLabel).join(', ')}` : ''}
              </p>
              {row.order?.items?.length > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  Items: {row.order.items.map(item => `${item.quantity}x ${item.title}`).join(', ')}
                </p>
              )}
            </div>
          ))}
          {nonPosRows.length === 0 && (
            <p className="text-xs text-muted-foreground rounded-lg border border-border/50 bg-background p-3">
              All returned attention rows are POS test cancellation candidates shown above.
            </p>
          )}
        </div>
      ) : preview ? (
        <p className="text-xs text-muted-foreground rounded-lg border border-border/50 bg-background p-3">
          No missing or blocked historical rows returned by the preview.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground rounded-lg border border-border/50 bg-background p-3">
          Run the preview before approving any historical backfill. The preview reads Hub and Customer App records only.
        </p>
      )}
    </section>
  );
}

function NativeCustomerAppContext({ context }) {
  const summary = context?.summary || {};
  const reviewIssues = Array.isArray(context?.recent_review_issues) ? context.recent_review_issues : [];
  const syncLogs = Array.isArray(context?.recent_sync_logs) ? context.recent_sync_logs : [];

  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
      <div>
        <h2 className="text-sm font-bold text-foreground">Native Customer App Review / Issues</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Native OrderReviewQueue and OrderSyncLog context. Read-only; no retry, repair, replay, or recovery controls.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <StatCard label="Native Sync Logs" value={formatNumber(summary.native_sync_events)} />
        <StatCard label="Native Success" value={formatNumber(summary.native_success_count)} tone="success" />
        <StatCard label="Native Failed" value={formatNumber(summary.native_failed_count)} tone={Number(summary.native_failed_count || 0) > 0 ? 'danger' : 'default'} />
        <StatCard label="Native Pending" value={formatNumber(summary.native_pending_count)} tone={Number(summary.native_pending_count || 0) > 0 ? 'warning' : 'default'} />
        <StatCard label="Active Reviews" value={formatNumber(summary.active_review_count)} tone={Number(summary.active_review_count || 0) > 0 ? 'warning' : 'default'} />
      </div>

      {reviewIssues.length === 0 ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
          <p className="text-xs font-semibold text-emerald-800">No active native review issues returned.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Active Native Review Items</p>
          {reviewIssues.map(issue => (
            <div key={issue.id || `${issue.order_number}-${issue.incident_type}`} className="rounded-lg border border-cyan-100 bg-cyan-50/70 p-3 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-cyan-950">{formatLabel(issue.incident_type)}</p>
                  <p className="text-[10px] text-cyan-800 mt-0.5">
                    {[issue.order_number ? `Order ${issue.order_number}` : null, issue.source ? formatLabel(issue.source) : null, `Last seen ${formatDateTime(issue.last_seen_at)}`].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <StatusChip value={issue.status || 'pending'} />
              </div>
              {issue.issue && <p className="text-xs text-cyan-900 leading-relaxed">{issue.issue}</p>}
              {issue.recommended_action && (
                <p className="text-[10px] font-semibold text-cyan-900">Recommended: {formatLabel(issue.recommended_action)}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {syncLogs.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Recent Native Sync Logs</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {syncLogs.slice(0, 8).map(log => (
              <div key={log.id || `${log.order_number}-${log.timestamp}`} className="rounded-lg border border-border/50 bg-background p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">{log.order_number || 'Order pending'}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {[log.source ? formatLabel(log.source) : null, log.event_type ? formatLabel(log.event_type) : null, formatDateTime(log.timestamp)].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <StatusChip value={log.status || 'unknown'} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  {[log.action ? `Action: ${formatLabel(log.action)}` : null, log.reason ? `Reason: ${sanitizeAdminText(log.reason)}` : null].filter(Boolean).join(' · ') || 'No reason returned'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default function SyncHealth() {
  const { user } = useAuth();
  const today = useMemo(() => todayDate(), []);
  const [preset, setPreset] = useState('last_7_days');
  const [dateFrom, setDateFrom] = useState(addDays(today, -6));
  const [dateTo, setDateTo] = useState(today);
  const [appliedDateFrom, setAppliedDateFrom] = useState(addDays(today, -6));
  const [appliedDateTo, setAppliedDateTo] = useState(today);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [backfillPreview, setBackfillPreview] = useState(null);
  const [backfillPreviewError, setBackfillPreviewError] = useState('');
  const [isBackfillPreviewRunning, setIsBackfillPreviewRunning] = useState(false);
  const [cutoverOrderNumber, setCutoverOrderNumber] = useState('');
  const [cutoverPreview, setCutoverPreview] = useState(null);
  const [cutoverPreviewError, setCutoverPreviewError] = useState('');
  const [isCutoverPreviewRunning, setIsCutoverPreviewRunning] = useState(false);
  const [pilotApprovalPreview, setPilotApprovalPreview] = useState(null);
  const [pilotApprovalError, setPilotApprovalError] = useState('');
  const [isPilotApprovalRunning, setIsPilotApprovalRunning] = useState(false);
  const [productionInventoryPreview, setProductionInventoryPreview] = useState(null);
  const [productionInventoryPreviewError, setProductionInventoryPreviewError] = useState('');
  const [isProductionInventoryPreviewRunning, setIsProductionInventoryPreviewRunning] = useState(false);
  const [masterDataParityPreview, setMasterDataParityPreview] = useState(null);
  const [masterDataParityPreviewError, setMasterDataParityPreviewError] = useState('');
  const [isMasterDataParityPreviewRunning, setIsMasterDataParityPreviewRunning] = useState(false);
  const [demandMaterializationPreview, setDemandMaterializationPreview] = useState(null);
  const [demandMaterializationPreviewError, setDemandMaterializationPreviewError] = useState('');
  const [isDemandMaterializationPreviewRunning, setIsDemandMaterializationPreviewRunning] = useState(false);
  const [productionLifecyclePreview, setProductionLifecyclePreview] = useState(null);
  const [productionLifecyclePreviewError, setProductionLifecyclePreviewError] = useState('');
  const [isProductionLifecyclePreviewRunning, setIsProductionLifecyclePreviewRunning] = useState(false);
  const isCustom = preset === 'custom';
  const rangeError = validateRange(dateFrom, dateTo);
  const requestDateFrom = isCustom ? appliedDateFrom : null;
  const requestDateTo = isCustom ? appliedDateTo : null;

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['admin-sync-health-summary', preset, requestDateFrom, requestDateTo, statusFilter, sourceFilter, actionFilter],
    queryFn: async () => {
      const payload = {
        limit: 300,
      };
      if (isCustom) {
        payload.preset = 'custom';
        payload.date_from = appliedDateFrom;
        payload.date_to = appliedDateTo;
      } else {
        payload.preset = preset;
      }
      if (statusFilter !== 'all') payload.status = statusFilter;
      if (sourceFilter !== 'all') payload.source = sourceFilter;
      if (actionFilter !== 'all') payload.action = actionFilter;

      const res = await base44.functions.invoke('getAdminSyncHealthSummary', payload);
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result || { summary: {}, directions: {}, error_categories: [], disabled_or_deprecated_tools: [] };
    },
    enabled: user?.role === 'admin',
    staleTime: 60000,
  });

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Admin access required.</p>
      </div>
    );
  }

  const summary = data?.summary || {};
  const directions = data?.directions || {};
  const errorCategories = data?.error_categories || [];
  const deprecatedTools = data?.disabled_or_deprecated_tools || [];
  const nativeCustomerApp = data?.native_customer_app || {};
  const pendingStale = Number(summary.pending_count || 0) + Number(summary.stale_count || 0);
  const showError = isError && !data && !isFetching;
  const nativeSummary = nativeCustomerApp.summary || {};
  const nativeActivity =
    Number(nativeSummary.native_sync_events || 0) > 0 ||
    Number(nativeSummary.total_review_count || 0) > 0;
  const hasActivity = Number(summary.total_events || 0) > 0 || errorCategories.length > 0 || deprecatedTools.length > 0 || nativeActivity;
  const contextLabel = (() => {
    if (isCustom) {
      const hasCurrentResponse = data?.date_from === appliedDateFrom && data?.date_to === appliedDateTo;
      const from = hasCurrentResponse ? data.date_from : appliedDateFrom;
      const to = hasCurrentResponse ? data.date_to : appliedDateTo;
      return `${formatDate(from)} - ${formatDate(to)}`;
    }
    if (data?.date_from && data?.date_to) {
      return `${formatDate(data.date_from)} - ${formatDate(data.date_to)}`;
    }
    return presetOptions.find(option => option.value === preset)?.label || 'Last 7 Days';
  })();

  const runHistoricalBackfillPreview = async () => {
    setBackfillPreviewError('');
    setIsBackfillPreviewRunning(true);
    try {
      const res = await base44.functions.invoke('previewAdminHistoricalHubBackfill', {
        scope: 'hub_all',
        hub_limit: 500,
      });
      const result = res?.data || res;
      if (!result?.success) {
        throw new Error(result?.message || result?.error_code || 'Backfill preview failed.');
      }
      setBackfillPreview(result);
    } catch (previewError) {
      setBackfillPreviewError(previewError?.message || 'Unable to run historical backfill preview.');
    } finally {
      setIsBackfillPreviewRunning(false);
    }
  };

  const runNativeCutoverReadinessPreview = async () => {
    setCutoverPreviewError('');
    setPilotApprovalError('');
    setPilotApprovalPreview(null);
    setIsCutoverPreviewRunning(true);
    try {
      const exactOrderNumber = cutoverOrderNumber.trim();
      const payload = exactOrderNumber
        ? { mode: 'dry_run', order_number: exactOrderNumber }
        : { mode: 'dry_run', limit: 5 };
      const res = await base44.functions.invoke('previewNativeOrderCutoverReadiness', payload);
      const result = res?.data || res;
      if (!result || result.error) {
        throw new Error(result?.message || result?.error || 'Native cutover readiness check failed.');
      }
      setCutoverPreview(result);
    } catch (previewError) {
      setCutoverPreviewError(previewError?.message || 'Unable to run native cutover readiness check.');
    } finally {
      setIsCutoverPreviewRunning(false);
    }
  };

  const updateCutoverOrderNumber = value => {
    setCutoverOrderNumber(value);
    setPilotApprovalPreview(null);
    setPilotApprovalError('');
    setProductionInventoryPreview(null);
    setProductionInventoryPreviewError('');
    setMasterDataParityPreview(null);
    setMasterDataParityPreviewError('');
    setDemandMaterializationPreview(null);
    setDemandMaterializationPreviewError('');
    setProductionLifecyclePreview(null);
    setProductionLifecyclePreviewError('');
  };

  const runNativePilotApprovalPreview = async () => {
    setPilotApprovalError('');
    setIsPilotApprovalRunning(true);
    try {
      const exactOrderNumber = cutoverOrderNumber.trim();
      if (!exactOrderNumber) {
        throw new Error('Exact order number is required for a pilot approval packet.');
      }
      const res = await base44.functions.invoke('previewNativeExactOrderPilotApproval', {
        mode: 'dry_run',
        order_number: exactOrderNumber,
      });
      const result = res?.data || res;
      if (!result || result.error) {
        throw new Error(result?.message || result?.error_code || 'Native pilot approval packet failed.');
      }
      setPilotApprovalPreview(result);
    } catch (previewError) {
      setPilotApprovalError(previewError?.message || 'Unable to generate native pilot approval packet.');
    } finally {
      setIsPilotApprovalRunning(false);
    }
  };

  const runNativeProductionInventoryPreview = async () => {
    setProductionInventoryPreviewError('');
    setIsProductionInventoryPreviewRunning(true);
    try {
      const exactOrderNumber = cutoverOrderNumber.trim();
      if (!exactOrderNumber) {
        throw new Error('Exact order number is required for production/inventory readiness preview.');
      }
      const res = await base44.functions.invoke('previewNativeProductionInventoryReadiness', {
        mode: 'dry_run',
        order_number: exactOrderNumber,
      });
      const result = res?.data || res;
      if (!result || result.error || (result.success === false && result.error_code)) {
        throw new Error(result?.message || result?.error || result?.error_code || 'Native production/inventory readiness preview failed.');
      }
      setProductionInventoryPreview(result);
    } catch (previewError) {
      setProductionInventoryPreviewError(previewError?.message || 'Unable to run native production/inventory readiness preview.');
    } finally {
      setIsProductionInventoryPreviewRunning(false);
    }
  };

  const runNativeProductionDemandMaterializationPreview = async () => {
    setDemandMaterializationPreviewError('');
    setIsDemandMaterializationPreviewRunning(true);
    try {
      const exactOrderNumber = cutoverOrderNumber.trim();
      if (!exactOrderNumber) {
        throw new Error('Exact order number is required for production demand materialization preview.');
      }
      const res = await base44.functions.invoke('previewNativeProductionDemandMaterialization', {
        mode: 'dry_run',
        order_number: exactOrderNumber,
      });
      const result = res?.data || res;
      if (!result || result.error || (result.success === false && result.error_code)) {
        throw new Error(result?.message || result?.error || result?.error_code || 'Native production demand materialization preview failed.');
      }
      setDemandMaterializationPreview(result);
    } catch (previewError) {
      setDemandMaterializationPreviewError(previewError?.message || 'Unable to run native production demand materialization preview.');
    } finally {
      setIsDemandMaterializationPreviewRunning(false);
    }
  };

  const runNativeProductionLifecyclePreview = async () => {
    setProductionLifecyclePreviewError('');
    setIsProductionLifecyclePreviewRunning(true);
    try {
      const exactOrderNumber = cutoverOrderNumber.trim();
      if (!exactOrderNumber) {
        throw new Error('Exact order number is required for production lifecycle preview.');
      }
      const res = await base44.functions.invoke('previewNativeProductionBatchLifecycle', {
        mode: 'dry_run',
        order_number: exactOrderNumber,
      });
      const result = res?.data || res;
      if (!result || result.error || (result.success === false && result.error_code)) {
        throw new Error(result?.message || result?.error || result?.error_code || 'Native production lifecycle preview failed.');
      }
      setProductionLifecyclePreview(result);
    } catch (previewError) {
      setProductionLifecyclePreviewError(previewError?.message || 'Unable to run native production lifecycle preview.');
    } finally {
      setIsProductionLifecyclePreviewRunning(false);
    }
  };

  const runNativeProductionMasterDataParityPreview = async () => {
    setMasterDataParityPreviewError('');
    setIsMasterDataParityPreviewRunning(true);
    try {
      const exactOrderNumber = cutoverOrderNumber.trim();
      if (!exactOrderNumber) {
        throw new Error('Exact order number is required for master-data parity preview.');
      }
      const res = await base44.functions.invoke('previewNativeProductionMasterDataParity', {
        mode: 'dry_run',
        order_number: exactOrderNumber,
      });
      const result = res?.data || res;
      if (!result || result.error || (result.success === false && result.error_code)) {
        throw new Error(result?.message || result?.error || result?.error_code || 'Native production master-data parity preview failed.');
      }
      setMasterDataParityPreview(result);
    } catch (previewError) {
      setMasterDataParityPreviewError(previewError?.message || 'Unable to run native production master-data parity preview.');
    } finally {
      setIsMasterDataParityPreviewRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-10">
      <AdminOpsHeader
        title="Sync Health"
        subtitle="Read-only bridge health"
        badge="Read-only"
      />

      <div className="px-4 mt-4 space-y-4">
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sync range</p>
                <p className="text-xs font-semibold text-foreground mt-0.5">{contextLabel}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Generated</p>
              <p className="text-xs text-foreground">{formatDateTime(data?.generated_at)}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {presetOptions.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPreset(option.value)}
                className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors ${
                  preset === option.value
                    ? 'bg-nuvira-gradient text-white border-primary'
                    : 'bg-background text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Custom From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={event => setDateFrom(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Custom To</span>
              <input
                type="date"
                value={dateTo}
                onChange={event => setDateTo(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
              />
            </label>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={Boolean(rangeError)}
              onClick={() => {
                if (rangeError) return;
                setAppliedDateFrom(dateFrom);
                setAppliedDateTo(dateTo);
                setPreset('custom');
              }}
              className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors ${
                rangeError
                  ? 'bg-muted text-muted-foreground border-border cursor-not-allowed'
                  : preset === 'custom' && appliedDateFrom === dateFrom && appliedDateTo === dateTo
                    ? 'bg-nuvira-gradient text-white border-primary'
                    : 'bg-background text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              Apply Range
            </button>
          </div>

          {rangeError && (
            <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-800">
              {rangeError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Status</span>
              <select
                value={statusFilter}
                onChange={event => setStatusFilter(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Statuses</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
                <option value="pending">Pending</option>
                <option value="stale">Stale</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Source</span>
              <select
                value={sourceFilter}
                onChange={event => setSourceFilter(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Sources</option>
                <option value="customer_app_to_hub">Customer App to Hub</option>
                <option value="hub_to_customer_app">Hub to Customer App</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Action</span>
              <select
                value={actionFilter}
                onChange={event => setActionFilter(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Actions</option>
                <option value="order_sync">Order Sync</option>
                <option value="status_sync">Status Sync</option>
                <option value="subscription_sync">Subscription Sync</option>
                <option value="refund_sync">Refund Sync</option>
                <option value="delivery_status_sync">Delivery Status Sync</option>
              </select>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
          <StatCard icon={Activity} label="Total Sync Events" value={formatNumber(summary.total_events)} isRefreshing={isFetching} />
          <StatCard icon={CheckCircle2} label="Success" value={formatNumber(summary.success_count)} tone="success" />
          <StatCard icon={XCircle} label="Failed" value={formatNumber(summary.failed_count)} tone="danger" />
          <StatCard icon={AlertTriangle} label="Pending / Stale" value={formatNumber(pendingStale)} tone="warning" />
          <StatCard icon={Clock3} label="Latest Success" value={formatDateTime(summary.latest_success_at)} />
          <StatCard icon={Clock3} label="Latest Failure" value={formatDateTime(summary.latest_failure_at)} />
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-foreground">Hub Sync Health view</p>
            <p className="text-[10px] text-muted-foreground">Read-only bridge visibility. If Hub summary is unavailable, native Customer App review and sync context still loads below. Sync, retry, recover, replay, repair, export, and raw-log actions are not available here.</p>
          </div>
          <RefreshCw className={`w-4 h-4 text-primary ${isFetching ? 'animate-spin' : ''}`} />
        </div>

        <HistoricalBackfillPreview
          preview={backfillPreview}
          isRunning={isBackfillPreviewRunning}
          error={backfillPreviewError}
          onRun={runHistoricalBackfillPreview}
        />

        <NativeCutoverReadinessPreview
          preview={cutoverPreview}
          isRunning={isCutoverPreviewRunning}
          error={cutoverPreviewError}
          orderNumber={cutoverOrderNumber}
          onOrderNumberChange={updateCutoverOrderNumber}
          onRun={runNativeCutoverReadinessPreview}
          pilotApproval={pilotApprovalPreview}
          isPilotApprovalRunning={isPilotApprovalRunning}
          pilotApprovalError={pilotApprovalError}
          onRunPilotApproval={runNativePilotApprovalPreview}
        />

        <NativeProductionInventoryReadinessPreview
          preview={productionInventoryPreview}
          isRunning={isProductionInventoryPreviewRunning}
          error={productionInventoryPreviewError}
          orderNumber={cutoverOrderNumber}
          onRun={runNativeProductionInventoryPreview}
        />

        <NativeProductionDemandMaterializationPreview
          preview={demandMaterializationPreview}
          isRunning={isDemandMaterializationPreviewRunning}
          error={demandMaterializationPreviewError}
          orderNumber={cutoverOrderNumber}
          onRun={runNativeProductionDemandMaterializationPreview}
        />

        <NativeProductionLifecyclePreview
          preview={productionLifecyclePreview}
          isRunning={isProductionLifecyclePreviewRunning}
          error={productionLifecyclePreviewError}
          orderNumber={cutoverOrderNumber}
          onRun={runNativeProductionLifecyclePreview}
        />

        <NativeProductionMasterDataParityPreview
          preview={masterDataParityPreview}
          isRunning={isMasterDataParityPreviewRunning}
          error={masterDataParityPreviewError}
          orderNumber={cutoverOrderNumber}
          onRun={runNativeProductionMasterDataParityPreview}
        />

        {showError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load sync health summary</p>
            <p className="text-xs text-muted-foreground mt-1">{error?.message || 'Try again later.'}</p>
          </div>
        )}

        {data?.hub_available === false && (
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              {data.hub_error
                ? `Hub sync health summary unavailable (${data.hub_error}); native Customer App issue context is still shown.`
                : 'Hub sync health summary unavailable; native Customer App issue context is still shown.'}
            </span>
          </div>
        )}

        {data?.truncated && (
          <p className="text-xs text-cyan-700 bg-cyan-50 border border-cyan-200 rounded-lg p-3">
            Results are capped. Narrow the date range or filters for a more complete sync health view.
          </p>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !showError && !hasActivity ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No sync health activity found</p>
            <p className="text-xs text-muted-foreground mt-1">Try another preset, filter, or valid custom date range.</p>
          </div>
        ) : !showError ? (
          <div className="space-y-4">
            <DirectionCard
              title="Customer App to Hub"
              description="Aggregate outbound bridge activity"
              direction={directions.customer_app_to_hub}
            />
            <DirectionCard
              title="Hub to Customer App"
              description="Aggregate inbound status bridge activity"
              direction={directions.hub_to_customer_app}
            />
            <NativeCustomerAppContext context={nativeCustomerApp} />
            <ErrorCategories categories={errorCategories} />
            <DeprecatedTools tools={deprecatedTools} />
          </div>
        ) : null}

        <div className="rounded-xl border border-border/50 bg-card p-3 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Browser requests stop at the Customer App wrapper. Hub credentials stay server-side.
          </p>
        </div>
      </div>
    </div>
  );
}
