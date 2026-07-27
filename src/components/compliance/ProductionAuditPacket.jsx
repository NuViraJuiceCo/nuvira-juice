import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import {
  ClipboardCheck, Thermometer, ShieldCheck, Beaker, Package,
  AlertTriangle, CheckCircle2, Printer, X, ChevronDown, ChevronUp,
  Pen, Clock, Zap
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { unwrapBase44Result } from '@/lib/base44-result';
import moment from 'moment';

/**
 * ProductionAuditPacket
 *
 * Given a production_date, fetches and renders a structured audit packet:
 * - Receiving / Sanitation Logs
 * - Daily Checklist
 * - Temperature Logs
 * - Batch Logs (one per product)
 * - Corrective Actions
 * - Operator / Admin Sign-Off section
 * - Print / Export
 */

function Section({ icon: Icon, title, color = 'text-foreground', children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 text-left"
      >
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${color}`} />
          <span className="font-semibold text-sm">{title}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 py-4 space-y-3">{children}</div>}
    </div>
  );
}

function Field({ label, value, highlight }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-muted-foreground min-w-[140px] shrink-0">{label}</span>
      <span className={`font-medium ${highlight === 'fail' ? 'text-red-600' : highlight === 'pass' ? 'text-green-600' : 'text-foreground'}`}>
        {value ?? <span className="text-muted-foreground italic">—</span>}
      </span>
    </div>
  );
}

function StatusPill({ value }) {
  const v = (value || '').toLowerCase();
  const isPass = v === 'pass' || v === 'passed' || v === 'complete' || v === 'Complete';
  const isFail = v === 'fail' || v === 'failed';
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
      isPass ? 'bg-green-100 text-green-700' : isFail ? 'bg-red-100 text-red-700' : 'bg-cyan-100 text-cyan-700'
    }`}>
      {(value || 'Pending').toUpperCase()}
    </span>
  );
}

const COMPLETED_BATCH_STATUSES = new Set([
  'completed',
  'completed_pending_verification',
  'verified',
  'verified_logged',
  'fulfilled',
  'closed',
]);

const ACTIVE_BATCH_STATUSES = new Set([
  'in_production',
  ...COMPLETED_BATCH_STATUSES,
]);

function normalizeId(value) {
  return (value ?? '').toString().trim().toLowerCase();
}

function hasTruthyValue(value) {
  return value !== null && value !== undefined && value !== '' && value !== false;
}

function parseTimeMinutes(value) {
  const match = (value || '').toString().trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function isPmTemperatureLog(log) {
  const shift = (log?.shift || '').toString().toLowerCase();
  if (['afternoon', 'evening', 'night', 'closing', 'pm'].some(label => shift.includes(label))) {
    return true;
  }
  const minutes = parseTimeMinutes(log?.log_time);
  return minutes !== null && minutes >= 12 * 60;
}

function temperatureUnit(log) {
  return (log?.unit || 'F').toString().replace(/^°/, '');
}

function formatTemperature(value, unit) {
  if (value === null || value === undefined || value === '') return '—';
  return `${value}°${unit || 'F'}`;
}

function batchNeedsCcp(batch) {
  const phStatus = (batch?.pH_passed_failed || '').toString().toLowerCase();
  const overall = (batch?.passed_failed || '').toString().toLowerCase();
  return batch?.ccp_check_complete === true ||
    batch?.corrective_action_required === true ||
    phStatus === 'failed' ||
    overall === 'failed';
}

function batchHasProductionLog(batch) {
  const status = (batch?.status || '').toString().toLowerCase();
  return COMPLETED_BATCH_STATUSES.has(status) ||
    hasTruthyValue(batch?.actual_end_time) ||
    hasTruthyValue(batch?.actual_units) ||
    hasTruthyValue(batch?.actual_quantity_produced) ||
    hasTruthyValue(batch?.bottles_produced) ||
    hasTruthyValue(batch?.final_usable_quantity);
}

function batchIsActiveOrComplete(batch) {
  const status = (batch?.status || '').toString().toLowerCase();
  return ACTIVE_BATCH_STATUSES.has(status) || hasTruthyValue(batch?.actual_start_time) || batchHasProductionLog(batch);
}

function batchLogMatchesBatch(log, batch) {
  const batchKeys = [
    batch?.batch_id,
    batch?.id,
    batch?.compliance_log_id,
    batch?.test_batch_id,
  ].map(normalizeId).filter(Boolean);

  const logKeys = [
    log?.batch_id,
    log?.source_production_batch_id,
    log?.id,
    log?.test_batch_id,
  ].map(normalizeId).filter(Boolean);

  return batchKeys.some(key => logKeys.includes(key));
}

function findBatchComplianceLog(batch, batchLogs = []) {
  return (batchLogs || []).find(log => batchLogMatchesBatch(log, batch));
}

function buildAuditStatus(filtered) {
  const batches = filtered?.batches || [];
  const batchLogs = filtered?.batchLogs || [];
  const dailyChecklists = filtered?.dailyChecklists || [];
  const temperatureLogs = filtered?.temperatureLogs || [];
  const ccpLogs = filtered?.ccpLogs || [];
  const correctiveActions = filtered?.correctiveActions || [];

  const batchLogsComplete = batches.length > 0
    ? batches.every(batch => (
      Boolean(findBatchComplianceLog(batch, batchLogs)) ||
      Boolean(batch?.compliance_log_id) ||
      batch?.compliance_log_id_present === true ||
      batchHasProductionLog(batch)
    ))
    : batchLogs.length > 0;

  const ccpRequired = ccpLogs.length > 0 ||
    correctiveActions.length > 0 ||
    batches.some(batchNeedsCcp);

  const dailyChecklistComplete = dailyChecklists.some(log => {
    const status = (log?.overall_status || '').toString().toLowerCase();
    return status.includes('complete') ||
      (
        log?.morning_fridge_temp_logged === true &&
        log?.sanitizer_levels_checked === true &&
        log?.equipment_sanitized === true &&
        log?.work_areas_cleaned === true
      );
  });

  return {
    sanitationComplete: (filtered?.sanitationLogs || []).length > 0,
    dailyChecklistComplete,
    temperatureStarted: temperatureLogs.length > 0 ||
      dailyChecklists.some(log => log?.morning_fridge_temp_logged === true || log?.evening_fridge_temp_logged === true),
    pmTemperatureLogged: dailyChecklists.some(log => log?.evening_fridge_temp_logged === true) ||
      temperatureLogs.some(isPmTemperatureLog),
    batchLogsComplete,
    ccpRequired,
    ccpComplete: !ccpRequired ||
      ccpLogs.length > 0 ||
      dailyChecklists.some(log => log?.ccp_logs_completed === true),
    productionHasActivity: batches.some(batchIsActiveOrComplete),
  };
}

function OptionalLogPlaceholder({ label, description }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-100">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
      <div>
        <p className="font-medium">{label}</p>
        <p className="mt-0.5 text-emerald-700 opacity-90 dark:text-emerald-100/80">{description}</p>
      </div>
    </div>
  );
}

function MissingLogPlaceholder({ label, isSetupPhase }) {
  if (isSetupPhase) {
    // During setup, show as informational
    return (
      <div className="flex items-center gap-2 py-3 px-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
        <Clock className="w-3.5 h-3.5 shrink-0 text-blue-500" />
        <div>
          <p className="font-medium">{label} will be logged when production starts.</p>
          <p className="text-blue-700 mt-0.5 opacity-80">This section will populate as staff complete tasks.</p>
        </div>
      </div>
    );
  }

  // Production is active but logs are missing - show as warning
  return (
    <div className="flex items-center gap-2 py-3 px-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-500" />
      <div>
        <p className="font-medium">Missing {label} logs for this production date.</p>
        <p className="text-red-700 mt-0.5 opacity-90">Production is active but required compliance data is not being logged.</p>
      </div>
    </div>
  );
}

function ReadinessProgressBar({ steps, productionDate, productionStarted }) {
  const completedCount = steps.filter(s => s.complete).length;
  const progressPercent = (completedCount / steps.length) * 100;
  const isSetupPhase = !productionStarted && completedCount < steps.length;
  const isReady = !productionStarted && completedCount === steps.length;

  return (
    <div className="bg-gradient-to-r from-primary/5 to-accent/5 border border-primary/20 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-bold text-sm flex items-center gap-2">
            {productionStarted ? (
              <>
                <Zap className="w-4 h-4 text-lime-500" />
                Production Active
              </>
            ) : isReady ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Production Ready
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 text-cyan-500" />
                Setup In Progress
              </>
            )}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {moment(productionDate).format('MMMM D, YYYY')} — {completedCount}/{steps.length} audit checks complete
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1.5">
        <Progress value={progressPercent} className="h-2" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{Math.round(progressPercent)}% Complete</span>
          <span>{completedCount}/{steps.length} Steps</span>
        </div>
      </div>

      {/* Checklist Items */}
      <div className="space-y-2">
        {steps.map((step) => (
          <div key={step.key} className="flex items-center gap-2">
            {step.complete ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                <span className="text-sm text-foreground opacity-70">{step.label}</span>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 text-cyan-500 shrink-0" />
                <span className="text-sm text-foreground font-medium">{step.label}</span>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Status Message */}
      {productionStarted && (
        <div className="mt-3 p-3 bg-lime-50 border border-lime-200 rounded-lg flex items-start gap-2">
          <Zap className="w-4 h-4 text-lime-600 shrink-0 mt-0.5" />
          <p className="text-xs text-lime-800">
            Production is active. Continue logging compliance data throughout the day.
          </p>
        </div>
      )}
      {isReady && !productionStarted && (
        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
          <p className="text-xs text-green-800">
            All prerequisite compliance logs are initialized. Production can proceed.
          </p>
        </div>
      )}
      {isSetupPhase && (
        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2">
          <Clock className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-800">
            Complete the remaining compliance setup steps before starting production.
          </p>
        </div>
      )}
    </div>
  );
}

export default function ProductionAuditPacket({ productionDate, onClose }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signOffNote, setSignOffNote] = useState('');
  const [signed, setSigned] = useState(false);
  const [readinessSteps, setReadinessSteps] = useState([]);
  const [productionStarted, setProductionStarted] = useState(false);

  useEffect(() => {
    if (!productionDate) return;
    loadAll();
  }, [productionDate]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getAdminComplianceOpsSummary', {
        date_from: productionDate,
        date_to: productionDate,
      });
      const result = unwrapBase44Result(res);
      if (result?.error) throw new Error(result.error);
      const records = result?.native?.records || {};

      const today = productionDate;
      const filtered = {
        sanitationLogs: (records.sanitation || []).filter(l => l.log_date === today),
        dailyChecklists: (records.daily_checklists || []).filter(l => l.checklist_date === today),
        temperatureLogs: (records.temperature || []).filter(l => l.log_date === today),
        ccpLogs: (records.ccp || []).filter(l => l.log_date === today),
        batchLogs: (records.batch_compliance || []).filter(l => l.date === today),
        correctiveActions: [
          ...(records.corrective_actions || []).filter(l => l.log_date === today),
          ...(records.unified_logs || []).filter(l => l.log_date === today && l.log_type === 'corrective_action'),
        ],
        batches: records.production_batches || [],
      };

      const auditStatus = buildAuditStatus(filtered);

      // Check if production has officially started or moved through a completion/verification state.
      const hasStarted = auditStatus.productionHasActivity;
      setProductionStarted(hasStarted);
      setData({ ...filtered, auditStatus });

      // Calculate readiness steps
      const steps = [
        {
          key: 'sanitation',
          label: 'Sanitation Complete',
          complete: auditStatus.sanitationComplete,
        },
        {
          key: 'checklist',
          label: 'Daily Checklist Complete',
          complete: auditStatus.dailyChecklistComplete,
        },
        {
          key: 'temperature',
          label: 'Temperature Logs Started',
          complete: auditStatus.temperatureStarted,
        },
        ...(hasStarted ? [{
          key: 'pm_temperature',
          label: 'PM Fridge Temp Logged',
          complete: auditStatus.pmTemperatureLogged,
        }] : []),
        {
          key: 'batch',
          label: 'Batch Logs Complete',
          complete: auditStatus.batchLogsComplete,
        },
        {
          key: 'ccp',
          label: auditStatus.ccpRequired ? 'CCP / Correction Log Present' : 'CCP / Correction Not Required',
          complete: auditStatus.ccpComplete,
        },
      ];
      setReadinessSteps(steps);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleSignOff = () => {
    // Launch-safe: acknowledge review in the current packet view only.
    // Persistent batch audit-trail sign-off needs a dedicated backend command before it is re-enabled.
    setSigned(true);
  };

  if (!productionDate) return null;

  const auditStatus = data?.auditStatus || {};
  const packetItems = data ? [
    { label: 'Receiving / Sanitation Log', count: data.sanitationLogs.length, complete: auditStatus.sanitationComplete },
    { label: 'Daily Checklist', count: data.dailyChecklists.length, complete: auditStatus.dailyChecklistComplete },
    { label: 'Temperature Log', count: data.temperatureLogs.length, complete: auditStatus.temperatureStarted },
    {
      label: auditStatus.ccpRequired ? 'CCP / Correction Log' : 'CCP / Correction',
      count: data.ccpLogs.length,
      complete: auditStatus.ccpComplete,
      note: auditStatus.ccpRequired ? null : 'Not required',
    },
    { label: `Batch Logs (${data.batches.length} batches)`, count: data.batchLogs.length, complete: auditStatus.batchLogsComplete },
    {
      label: 'Corrective Actions',
      count: data.correctiveActions.length,
      complete: true,
      note: data.correctiveActions.length > 0 ? null : 'None',
    },
  ] : [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/75 p-4">
      <div className="my-4 max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card text-card-foreground shadow-2xl shadow-black/40">
        {/* Header */}
        <div className="bg-primary px-5 py-4 rounded-t-2xl flex items-start justify-between print:bg-white print:text-black">
          <div>
            <p className="text-primary-foreground text-xs font-semibold uppercase tracking-wider">NuVira Juice Co. — Production Audit Packet</p>
            <h2 className="text-primary-foreground font-bold text-lg mt-0.5">
              Production Date: {moment(productionDate).format('MMMM D, YYYY')}
            </h2>
            <p className="text-primary-foreground/70 text-xs mt-0.5">
              Generated {moment().format('MMM D, YYYY [at] h:mm A')} by {user?.full_name || user?.email || 'Admin'}
            </p>
          </div>
          <button onClick={onClose} className="text-primary-foreground/70 hover:text-primary-foreground ml-4 print:hidden">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="p-5 space-y-4">

            {/* Production Readiness Dashboard */}
            <ReadinessProgressBar
              steps={readinessSteps}
              productionDate={productionDate}
              productionStarted={productionStarted}
            />

            {/* Packet index */}
            <div className="bg-muted/30 border border-border rounded-xl p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Audit Packet Contents</p>
              <div className="grid grid-cols-2 gap-1 text-xs">
                {packetItems.map(item => (
                  <div key={item.label} className="flex items-center gap-1.5">
                    {item.complete
                      ? <CheckCircle2 className="w-3 h-3 text-green-600 shrink-0" />
                      : <AlertTriangle className="w-3 h-3 text-cyan-500 shrink-0" />
                    }
                    <span className={item.complete ? 'text-foreground' : 'text-cyan-700'}>{item.label}</span>
                    <span className="text-muted-foreground">{item.note || `(${item.count})`}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 1. Receiving / Sanitation Log */}
            <Section icon={ShieldCheck} title="Receiving / Sanitation Log" color="text-green-600">
              {data.sanitationLogs.length === 0 ? (
                <MissingLogPlaceholder
                  label="Sanitation"
                  isSetupPhase={!productionStarted}
                  logType="sanitation"
                />
              ) : data.sanitationLogs.map((log, i) => (
                <div key={log.id || i} className="border border-border rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold">{log.area} — {log.log_time}</span>
                    <StatusPill value={log.sanitized ? 'Pass' : 'Fail'} />
                  </div>
                  <Field label="Staff Member" value={log.staff_member} />
                  <Field label="Sanitizer Type" value={log.sanitizer_type} />
                  <Field label="Sanitizer Level" value={log.sanitizer_level} />
                  <Field label="Cleaned" value={log.cleaned ? 'Yes' : 'No'} />
                  <Field label="Sanitized" value={log.sanitized ? 'Yes' : 'No'} />
                  {log.notes && <Field label="Notes" value={log.notes} />}
                  {log.verified_by && <Field label="Verified By" value={log.verified_by} />}
                </div>
              ))}
            </Section>

            {/* 2. Daily Checklist */}
            <Section icon={ClipboardCheck} title="Daily Checklist" color="text-blue-600">
              {data.dailyChecklists.length === 0 ? (
                <MissingLogPlaceholder
                  label="Daily Checklist"
                  isSetupPhase={!productionStarted}
                  logType="checklist"
                />
              ) : data.dailyChecklists.map((log, i) => {
                  const pmLogged = log.evening_fridge_temp_logged === true || auditStatus.pmTemperatureLogged === true;
                  const batchLogsDone = log.batch_logs_completed === true || auditStatus.batchLogsComplete === true;
                  const ccpDone = auditStatus.ccpRequired ? (log.ccp_logs_completed === true || auditStatus.ccpComplete === true) : true;
                  return (
                    <div key={log.id || i} className="border border-border rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold">{log.staff_member} — {log.shift} Shift</span>
                        <StatusPill value={log.overall_status} />
                      </div>
                      <Field label="Fridge Temp (AM)" value={log.morning_fridge_temp_logged ? `Logged ${log.morning_fridge_time || ''}` : 'Not logged'} highlight={log.morning_fridge_temp_logged ? 'pass' : 'fail'} />
                      <Field label="Fridge Temp (PM)" value={pmLogged ? (log.evening_fridge_temp_logged ? `Logged ${log.evening_fridge_time || ''}` : 'Logged in Temperature Log') : 'Not logged'} highlight={pmLogged ? 'pass' : 'fail'} />
                      <Field label="Sanitizer Checked" value={log.sanitizer_levels_checked ? 'Yes' : 'No'} highlight={log.sanitizer_levels_checked ? 'pass' : 'fail'} />
                      <Field label="Equipment Sanitized" value={log.equipment_sanitized ? 'Yes' : 'No'} highlight={log.equipment_sanitized ? 'pass' : 'fail'} />
                      <Field label="Work Areas Cleaned" value={log.work_areas_cleaned ? 'Yes' : 'No'} highlight={log.work_areas_cleaned ? 'pass' : 'fail'} />
                      <Field label="Batch Logs Completed" value={batchLogsDone ? (log.batch_logs_completed ? 'Yes' : 'Completed in Batch Logs') : 'No'} highlight={batchLogsDone ? 'pass' : 'fail'} />
                      <Field label="CCP / Correction" value={auditStatus.ccpRequired ? (ccpDone ? 'Yes' : 'No') : 'Not required'} highlight={auditStatus.ccpRequired ? (ccpDone ? 'pass' : 'fail') : undefined} />
                      {log.issues_reported && <Field label="Issues Reported" value={log.issues_reported} highlight="fail" />}
                      {log.manager_reviewed && <Field label="Manager Reviewed" value={`Yes${log.manager_comments ? ' — ' + log.manager_comments : ''}`} />}
                    </div>
                  );
              })}
            </Section>

            {/* 3. Temperature Log */}
            <Section icon={Thermometer} title="Temperature Log" color="text-red-500">
              {data.temperatureLogs.length === 0 ? (
                <MissingLogPlaceholder
                  label="Temperature"
                  isSetupPhase={!productionStarted}
                  logType="temperature"
                />
              ) : data.temperatureLogs.map((log, i) => (
                <div key={log.id || i} className="border border-border rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold">{log.location} — {log.log_time} ({log.shift})</span>
                    <StatusPill value={log.within_range ? 'Pass' : 'Fail'} />
                  </div>
                  <Field label="Staff Member" value={log.staff_member} />
                  <Field label="Temperature" value={formatTemperature(log.temperature, temperatureUnit(log))} highlight={log.within_range ? 'pass' : 'fail'} />
                  <Field label="Acceptable Range" value={log.min_range != null && log.max_range != null ? `${formatTemperature(log.min_range, temperatureUnit(log))} – ${formatTemperature(log.max_range, temperatureUnit(log))}` : '—'} />
                  <Field label="Within Range" value={log.within_range ? 'Yes' : 'No'} highlight={log.within_range ? 'pass' : 'fail'} />
                  {log.notes && <Field label="Notes" value={log.notes} />}
                </div>
              ))}
            </Section>

            {/* 4. CCP Log */}
            <Section icon={Beaker} title="CCP / Corrective Action Log" color="text-purple-600">
              {data.ccpLogs.length === 0 ? (
                auditStatus.ccpRequired ? (
                  <MissingLogPlaceholder
                    label="CCP / corrective action"
                    isSetupPhase={!productionStarted}
                    logType="ccp"
                  />
                ) : (
                  <OptionalLogPlaceholder
                    label="No CCP/corrective-action log required"
                    description="Normal production does not require a separate CCP log unless a CCP check, failed pH, or corrective action is recorded."
                  />
                )
              ) : data.ccpLogs.map((log, i) => (
                <div key={log.id || i} className="border border-border rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold">{log.ccp_point} — {log.log_time}</span>
                    <StatusPill value={log.result} />
                  </div>
                  <Field label="Staff Member" value={log.staff_member} />
                  <Field label="Batch ID" value={log.batch_id} />
                  <Field label="Measurement" value={log.measurement} />
                  <Field label="Critical Limit" value={log.critical_limit} />
                  <Field label="Result" value={log.result} highlight={log.result === 'Pass' ? 'pass' : 'fail'} />
                  {log.notes && <Field label="Notes" value={log.notes} />}
                </div>
              ))}
            </Section>

            {/* 5. Batch Logs */}
            <Section icon={Package} title={`Batch Logs (${data.batches.length} batches scheduled)`} color="text-cyan-600">
              {data.batches.length === 0 && data.batchLogs.length === 0 ? (
                <MissingLogPlaceholder
                  label="Batch"
                  isSetupPhase={!productionStarted}
                  logType="batch"
                />
              ) : (
                <>
                  {/* Show planned batches from ProductionBatch entity */}
                  {data.batches.map((batch, i) => {
                    const complianceLog = findBatchComplianceLog(batch, data.batchLogs);
                    const batchCcpRequired = batchNeedsCcp(batch);
                    const batchCcpComplete = !batchCcpRequired ||
                      batch.ccp_check_complete === true ||
                      data.ccpLogs.some(log => batchLogMatchesBatch(log, batch));
                    const yieldVariance = batch.planned_units && batch.actual_units
                      ? ((batch.actual_units - batch.planned_units) / batch.planned_units * 100).toFixed(1)
                      : null;
                    return (
                      <div key={batch.id || i} className="border border-border rounded-xl p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-bold text-sm">{batch.product_name}</p>
                            <p className="text-xs text-muted-foreground">{batch.batch_id}</p>
                          </div>
                          <StatusPill value={complianceLog?.passed_failed || batch.passed_failed || batch.status} />
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                          <Field label="Production Date" value={batch.production_date} />
                          <Field label="Assigned To" value={batch.assigned_to} />
                          <Field label="Planned Units" value={batch.planned_units} />
                          <Field label="Actual Units" value={complianceLog?.quantity_produced ?? batch.actual_units ?? '—'} />
                          {yieldVariance !== null && (
                            <Field label="Yield Variance" value={`${yieldVariance > 0 ? '+' : ''}${yieldVariance}%`} highlight={Math.abs(yieldVariance) > 10 ? 'fail' : 'pass'} />
                          )}
                          <Field label="Start Time" value={batch.actual_start_time ? moment(batch.actual_start_time).format('h:mm A') : '—'} />
                          <Field label="End Time" value={batch.actual_end_time ? moment(batch.actual_end_time).format('h:mm A') : '—'} />
                          <Field label="Started By" value={batch.started_by} />
                          <Field label="Completed By" value={batch.completed_by} />
                          <Field label="Staff on Duty" value={(batch.staff_on_duty || []).join(', ') || '—'} />
                          <Field label="Equipment Used" value={(batch.equipment_used || []).join(', ') || '—'} />
                          <Field label="Formula / Recipe" value={batch.formula_or_recipe_used} />
                          <Field label="Bottle Size" value={batch.bottle_size} />
                          <Field label="Bottles Produced" value={batch.bottles_produced} />
                          <Field label="Bottles Rejected" value={batch.bottles_rejected_or_wasted ?? '—'} />
                          <Field label="Final Usable Qty" value={batch.final_usable_quantity ?? '—'} />
                          <Field label="Storage Location" value={batch.storage_location} />
                          <Field label="Use By Date" value={batch.use_by_date} />
                          <Field label="pH Result" value={batch.pH_result != null ? String(batch.pH_result) : (complianceLog?.pH_result != null ? String(complianceLog.pH_result) : '—')} highlight={batch.pH_passed_failed === 'passed' || complianceLog?.passed_failed === 'passed' ? 'pass' : batch.pH_passed_failed === 'failed' ? 'fail' : undefined} />
                          <Field label="pH Meter ID" value={batch.pH_meter_id} />
                          <Field label="Calibration Checked" value={batch.calibration_checked ? 'Yes' : (batch.calibration_checked === false ? 'No' : '—')} />
                          <Field label="Pre-Op Sanitation" value={batch.pre_op_sanitation_confirmed ? 'Confirmed' : '—'} highlight={batch.pre_op_sanitation_confirmed ? 'pass' : undefined} />
                          <Field label="CCP / Correction" value={batchCcpRequired ? (batchCcpComplete ? 'Yes' : 'No') : 'Not required'} highlight={batchCcpRequired ? (batchCcpComplete ? 'pass' : 'fail') : undefined} />
                          <Field label="Overall Result" value={complianceLog?.passed_failed || batch.passed_failed} highlight={complianceLog?.passed_failed === 'passed' || batch.passed_failed === 'passed' ? 'pass' : 'fail'} />
                          <Field label="Verified By" value={complianceLog?.verified_by || batch.verified_by} />
                          <Field label="Verified At" value={complianceLog?.verified_at ? moment(complianceLog.verified_at).format('MMM D, YYYY h:mm A') : (batch.verified_at ? moment(batch.verified_at).format('MMM D, YYYY h:mm A') : '—')} />
                        </div>
                        {/* Ingredient / lot references */}
                        {(batch.ingredients_used || []).length > 0 && (
                          <div className="mt-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Ingredients Used</p>
                            <div className="space-y-0.5">
                              {batch.ingredients_used.map((ing, j) => (
                                <div key={j} className="text-xs flex gap-2">
                                  <span className="text-foreground font-medium">{ing.ingredient_name}</span>
                                  <span className="text-muted-foreground">{ing.quantity} {ing.unit}</span>
                                  {ing.lot_number && <span className="text-muted-foreground">Lot: {ing.lot_number}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Source orders */}
                        {(batch.order_sources || []).length > 0 && (
                          <div className="mt-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Source Orders</p>
                            <div className="space-y-0.5">
                              {batch.order_sources.map((src, j) => (
                                <div key={j} className="text-xs text-muted-foreground">
                                  {src.order_number} — {src.customer_name} ({src.quantity} units)
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Corrective actions on this batch */}
                        {batch.corrective_action_required && (
                          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900/70 dark:bg-red-950/30">
                            <p className="mb-1 flex items-center gap-1.5 text-xs font-bold text-red-700 dark:text-red-200">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Corrective Action Required
                            </p>
                            {batch.issue_identified && <Field label="Issue" value={batch.issue_identified} />}
                            {batch.detection_method && <Field label="Detected By" value={batch.detection_method} />}
                            {batch.action_taken && <Field label="Action Taken" value={batch.action_taken} />}
                            {batch.disposed != null && <Field label="Product Disposed" value={batch.disposed ? `Yes (${batch.quantity_disposed ?? 0} units)` : 'No'} />}
                            {batch.preventive_steps && <Field label="Preventive Steps" value={batch.preventive_steps} />}
                          </div>
                        )}
                        {/* Audit trail overrides */}
                        {(batch.audit_trail || []).filter(e => e.action === 'PreProductionChecklistOverride').map((entry, j) => (
                          <div key={j} className="mt-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs dark:border-cyan-900/70 dark:bg-cyan-950/30">
                            <p className="flex items-center gap-1.5 font-bold text-cyan-800 dark:text-cyan-200">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Checklist Override Recorded
                            </p>
                            <p className="mt-0.5 text-cyan-700 dark:text-cyan-200/80">By {entry.performed_by} at {moment(entry.timestamp).format('h:mm A')}</p>
                            <p className="text-cyan-700 dark:text-cyan-200/80">Reason: {entry.reason}</p>
                            {entry.before?.missing_checks?.length > 0 && (
                              <p className="text-cyan-600 dark:text-cyan-300/80">Missing: {entry.before.missing_checks.join(', ')}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </>
              )}
            </Section>

            {/* 6. Corrective Actions */}
            <Section icon={AlertTriangle} title="Corrective Actions" color="text-red-500" defaultOpen={data.correctiveActions.length > 0}>
              {data.correctiveActions.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No corrective actions recorded for this production date.</p>
              ) : data.correctiveActions.map((log, i) => (
                <div key={log.id || i} className="border border-red-200 bg-red-50 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-red-800">{log.log_time || ''}</span>
                    <StatusPill value={log.status || log.passed_failed} />
                  </div>
                  <Field label="Staff Member" value={log.staff_member} />
                  <Field label="Notes" value={log.notes} />
                  {log.verified_by && <Field label="Verified By" value={log.verified_by} />}
                </div>
              ))}
            </Section>

            {/* 7. Operator / Admin Sign-Off */}
            <Section icon={Pen} title="Operator / Admin Sign-Off" color="text-primary">
              {signed ? (
                <div className="flex items-center gap-2 py-3 px-4 bg-green-50 border border-green-200 rounded-xl">
                  <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-green-800">Packet Review Acknowledged</p>
                    <p className="text-xs text-green-700">
                      Local print-session acknowledgement by {user?.email} at {moment().format('h:mm A')} — {signOffNote || 'Audit packet reviewed.'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">Reviewed By</p>
                      <p className="font-medium">{user?.full_name || user?.email}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Date / Time</p>
                      <p className="font-medium">{moment().format('MMM D, YYYY h:mm A')}</p>
                    </div>
                  </div>
                  <textarea
                    value={signOffNote}
                    onChange={e => setSignOffNote(e.target.value)}
                    rows={2}
                    placeholder="Optional review note for this print/export session"
                    className="w-full text-sm border border-border rounded-xl px-3 py-2.5 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <p className="text-xs text-cyan-700 bg-cyan-50 border border-cyan-200 rounded-lg px-3 py-2">
                    Persistent ProductionBatch audit-trail sign-off is locked until a dedicated backend command is approved.
                  </p>
                  <Button onClick={handleSignOff} className="w-full gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Acknowledge Review For Print
                  </Button>
                </div>
              )}
            </Section>

            {/* Actions */}
            <div className="flex gap-3 pt-2 print:hidden">
              <Button variant="outline" onClick={onClose} className="flex-1">
                <X className="w-4 h-4 mr-2" /> Close
              </Button>
              <Button onClick={handlePrint} className="flex-1 gap-2">
                <Printer className="w-4 h-4" />
                Print / Export Packet
              </Button>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
