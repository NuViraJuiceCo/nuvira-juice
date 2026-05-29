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
      isPass ? 'bg-green-100 text-green-700' : isFail ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
    }`}>
      {(value || 'Pending').toUpperCase()}
    </span>
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
                <Zap className="w-4 h-4 text-orange-500" />
                Production Active
              </>
            ) : isReady ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Production Ready
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 text-amber-500" />
                Setup In Progress
              </>
            )}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {moment(productionDate).format('MMMM D, YYYY')} — {completedCount}/{steps.length} setup steps complete
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
                <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="text-sm text-foreground font-medium">{step.label}</span>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Status Message */}
      {productionStarted && (
        <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg flex items-start gap-2">
          <Zap className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
          <p className="text-xs text-orange-800">
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
      const [
        sanitationLogs,
        dailyChecklists,
        temperatureLogs,
        ccpLogs,
        batchLogs,
        complianceLogs,
        batches,
      ] = await Promise.all([
        base44.entities.SanitationLog?.list('-log_date', 200).catch(() => []),
        base44.entities.DailyChecklist?.list('-checklist_date', 50).catch(() => []),
        base44.entities.TemperatureLog?.list('-log_date', 200).catch(() => []),
        base44.entities.CCPLog?.list('-log_date', 200).catch(() => []),
        base44.entities.BatchComplianceLog?.list('-date', 200).catch(() => []),
        base44.entities.ComplianceLog?.list('-log_date', 200).catch(() => []),
        base44.entities.ProductionBatch?.filter({ production_date: productionDate }).catch(() => []),
      ]);

      // Filter all to this production date
      const today = productionDate;
      const filtered = {
        sanitationLogs: (sanitationLogs || []).filter(l => l.log_date === today),
        dailyChecklists: (dailyChecklists || []).filter(l => l.checklist_date === today),
        temperatureLogs: (temperatureLogs || []).filter(l => l.log_date === today),
        ccpLogs: (ccpLogs || []).filter(l => l.log_date === today),
        batchLogs: (batchLogs || []).filter(l => l.date === today),
        correctiveActions: (complianceLogs || []).filter(l => l.log_date === today && l.log_type === 'corrective_action'),
        batches: batches || [],
      };

      setData(filtered);

      // Check if production has officially started (batch has actual_start_time or is marked in_production)
      const hasStarted = (filtered.batches || []).some(b => b.actual_start_time || b.status === 'in_production');
      setProductionStarted(hasStarted);

      // Calculate readiness steps
      const steps = [
        {
          key: 'sanitation',
          label: 'Sanitation Complete',
          complete: filtered.sanitationLogs.length > 0,
        },
        {
          key: 'checklist',
          label: 'Daily Checklist Complete',
          complete: filtered.dailyChecklists.length > 0,
        },
        {
          key: 'temperature',
          label: 'Temperature Logs Started',
          complete: filtered.temperatureLogs.length > 0,
        },
        {
          key: 'ccp',
          label: 'CCP Monitoring Started',
          complete: filtered.ccpLogs.length > 0,
        },
        {
          key: 'batch',
          label: 'Batch Logs Active',
          complete: filtered.batchLogs.length > 0,
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

  const handleSignOff = async () => {
    // Record sign-off on all batches for this date
    if (data?.batches?.length) {
      for (const batch of data.batches) {
        try {
          const existing = Array.isArray(batch.audit_trail) ? batch.audit_trail : [];
          await base44.entities.ProductionBatch.update(batch.id, {
            audit_trail: [...existing, {
              timestamp: new Date().toISOString(),
              action: 'AdminSignOff',
              performed_by: user?.email,
              reason: signOffNote || 'Audit packet reviewed and signed off.',
              before: {},
              after: { signed_off: true },
            }],
          });
        } catch (e) {
          console.warn('Sign-off save failed:', e.message);
        }
      }
    }
    setSigned(true);
  };

  if (!productionDate) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-2xl my-4">
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
                {[
                  { label: 'Receiving / Sanitation Log', count: data.sanitationLogs.length },
                  { label: 'Daily Checklist', count: data.dailyChecklists.length },
                  { label: 'Temperature Log', count: data.temperatureLogs.length },
                  { label: 'CCP Log', count: data.ccpLogs.length },
                  { label: `Batch Logs (${data.batches.length} batches)`, count: data.batchLogs.length },
                  { label: 'Corrective Actions', count: data.correctiveActions.length },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-1.5">
                    {item.count > 0
                      ? <CheckCircle2 className="w-3 h-3 text-green-600 shrink-0" />
                      : <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                    }
                    <span className={item.count > 0 ? 'text-foreground' : 'text-amber-700'}>{item.label}</span>
                    <span className="text-muted-foreground">({item.count})</span>
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
              ) : data.dailyChecklists.map((log, i) => (
                <div key={log.id || i} className="border border-border rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold">{log.staff_member} — {log.shift} Shift</span>
                    <StatusPill value={log.overall_status} />
                  </div>
                  <Field label="Fridge Temp (AM)" value={log.morning_fridge_temp_logged ? `Logged ${log.morning_fridge_time || ''}` : 'Not logged'} highlight={log.morning_fridge_temp_logged ? 'pass' : 'fail'} />
                  <Field label="Fridge Temp (PM)" value={log.evening_fridge_temp_logged ? `Logged ${log.evening_fridge_time || ''}` : 'Not logged'} highlight={log.evening_fridge_temp_logged ? 'pass' : 'fail'} />
                  <Field label="Sanitizer Checked" value={log.sanitizer_levels_checked ? 'Yes' : 'No'} highlight={log.sanitizer_levels_checked ? 'pass' : 'fail'} />
                  <Field label="Equipment Sanitized" value={log.equipment_sanitized ? 'Yes' : 'No'} highlight={log.equipment_sanitized ? 'pass' : 'fail'} />
                  <Field label="Work Areas Cleaned" value={log.work_areas_cleaned ? 'Yes' : 'No'} highlight={log.work_areas_cleaned ? 'pass' : 'fail'} />
                  <Field label="Batch Logs Completed" value={log.batch_logs_completed ? 'Yes' : 'No'} highlight={log.batch_logs_completed ? 'pass' : 'fail'} />
                  <Field label="CCP Logs Completed" value={log.ccp_logs_completed ? 'Yes' : 'No'} highlight={log.ccp_logs_completed ? 'pass' : 'fail'} />
                  {log.issues_reported && <Field label="Issues Reported" value={log.issues_reported} highlight="fail" />}
                  {log.manager_reviewed && <Field label="Manager Reviewed" value={`Yes${log.manager_comments ? ' — ' + log.manager_comments : ''}`} />}
                </div>
              ))}
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
                  <Field label="Temperature" value={log.temperature != null ? `${log.temperature}°C` : '—'} highlight={log.within_range ? 'pass' : 'fail'} />
                  <Field label="Acceptable Range" value={log.min_range != null && log.max_range != null ? `${log.min_range}°C – ${log.max_range}°C` : '—'} />
                  <Field label="Within Range" value={log.within_range ? 'Yes' : 'No'} highlight={log.within_range ? 'pass' : 'fail'} />
                  {log.notes && <Field label="Notes" value={log.notes} />}
                </div>
              ))}
            </Section>

            {/* 4. CCP Log */}
            <Section icon={Beaker} title="CCP Monitoring Log" color="text-purple-600">
              {data.ccpLogs.length === 0 ? (
                <MissingLogPlaceholder
                  label="CCP Monitoring"
                  isSetupPhase={!productionStarted}
                  logType="ccp"
                />
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
            <Section icon={Package} title={`Batch Logs (${data.batches.length} batches scheduled)`} color="text-amber-600">
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
                    const complianceLog = data.batchLogs.find(l => l.batch_id === batch.batch_id);
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
                          <Field label="CCP Complete" value={batch.ccp_check_complete ? 'Yes' : '—'} highlight={batch.ccp_check_complete ? 'pass' : undefined} />
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
                          <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                            <p className="text-xs font-bold text-red-700 mb-1">⚠️ Corrective Action Required</p>
                            {batch.issue_identified && <Field label="Issue" value={batch.issue_identified} />}
                            {batch.detection_method && <Field label="Detected By" value={batch.detection_method} />}
                            {batch.action_taken && <Field label="Action Taken" value={batch.action_taken} />}
                            {batch.disposed != null && <Field label="Product Disposed" value={batch.disposed ? `Yes (${batch.quantity_disposed ?? 0} units)` : 'No'} />}
                            {batch.preventive_steps && <Field label="Preventive Steps" value={batch.preventive_steps} />}
                          </div>
                        )}
                        {/* Audit trail overrides */}
                        {(batch.audit_trail || []).filter(e => e.action === 'PreProductionChecklistOverride').map((entry, j) => (
                          <div key={j} className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs">
                            <p className="font-bold text-amber-800">⚠️ Checklist Override Recorded</p>
                            <p className="text-amber-700 mt-0.5">By {entry.performed_by} at {moment(entry.timestamp).format('h:mm A')}</p>
                            <p className="text-amber-700">Reason: {entry.reason}</p>
                            {entry.before?.missing_checks?.length > 0 && (
                              <p className="text-amber-600">Missing: {entry.before.missing_checks.join(', ')}</p>
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
                    <p className="text-sm font-bold text-green-800">Packet Signed Off</p>
                    <p className="text-xs text-green-700">By {user?.email} at {moment().format('h:mm A')} — {signOffNote || 'Audit packet reviewed.'}</p>
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
                    placeholder="Optional sign-off note (e.g. All logs reviewed and compliant...)"
                    className="w-full text-sm border border-border rounded-xl px-3 py-2.5 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <Button onClick={handleSignOff} className="w-full gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Sign Off Audit Packet
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
