import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CheckSquare,
  Download,
  FileText,
  FlaskConical,
  LayoutDashboard,
  PackageCheck,
  Plus,
  ShieldAlert,
  ShieldCheck,
  SprayCan,
  Tag,
  Thermometer,
  Wrench,
} from 'lucide-react';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import ComplianceDashboard from '@/components/compliance/ComplianceDashboard';
import TemperatureLogForm from '@/components/compliance/TemperatureLogForm';
import PHLogForm from '@/components/compliance/pHLogForm';
import CCPLogForm from '@/components/compliance/CCPLogForm';
import SanitationLogForm from '@/components/compliance/SanitationLogForm';
import CorrectiveActionForm from '@/components/compliance/CorrectiveActionForm';
import DailyChecklistForm from '@/components/compliance/DailyChecklistForm';
import ComplianceMonitor from '@/components/compliance/ComplianceMonitor';
import ComplianceLogsParity from '@/components/compliance/ComplianceLogsParity';
import ComplianceDocumentsTab from '@/components/compliance/ComplianceDocumentsTab';
import LabelAllergenTab from '@/components/compliance/LabelAllergenTab';
import HACCPPlanTab from '@/components/compliance/HACCPPlanTab';
import BatchComplianceLogForm from '@/components/compliance/BatchComplianceLogForm';
import { isAdminUser } from '@/lib/admin-access';
import { unwrapBase44Result } from '@/lib/base44-result';
import { usePageVisibility } from '@/lib/usePageVisibility';

const PRODUCTION_COMPLIANCE_READ_MODEL_MODE = 'PRODUCTION_COMPLIANCE_LIFECYCLE';
const SUPPORTED_PRODUCTION_COMPLIANCE_READ_MODEL_VERSION = 'g48c_production_compliance_lifecycle_v1';

const complianceTabs = [
  { value: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { value: 'hub-parity', label: 'Audit Packets', Icon: Archive },
  { value: 'documents', label: 'Documents', Icon: FileText },
  { value: 'temperature', label: 'Temperature', Icon: Thermometer },
  { value: 'pH', label: 'pH', Icon: FlaskConical },
  { value: 'CCP', label: 'CCP', Icon: ShieldAlert },
  { value: 'sanitation', label: 'Sanitation', Icon: SprayCan },
  { value: 'corrective', label: 'Corrective', Icon: Wrench },
  { value: 'checklist', label: 'Checklist', Icon: CheckSquare },
  { value: 'batch', label: 'Batch Logs', Icon: PackageCheck },
  { value: 'labels', label: 'Labels', Icon: Tag },
  { value: 'haccp', label: 'HACCP', Icon: ShieldCheck },
  { value: 'export', label: 'Export', Icon: Download },
];

function ComplianceWorkflowPanel({ setActiveTab }) {
  const shortcuts = [
    { label: 'Temp Log', tab: 'temperature', Icon: Thermometer },
    { label: 'Sanitation', tab: 'sanitation', Icon: SprayCan },
    { label: 'Checklist', tab: 'checklist', Icon: CheckSquare },
    { label: 'Batch Log', tab: 'batch', Icon: PackageCheck },
  ];

  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Compliance Flow</p>
          <h2 className="mt-1 text-sm font-black text-foreground">Batch-linked first, standalone when needed</h2>
          <p className="mt-1 max-w-3xl text-xs font-medium leading-relaxed text-muted-foreground">
            Production Start captures pre-op sanitation, daily checklist, and temperature logs for the exact batch. Use this center for standalone or retroactive records, binder review, label/allergen review, and audit export.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/production-queue"
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-nuvira-gradient px-3 text-xs font-semibold text-white"
          >
            <PackageCheck className="h-3.5 w-3.5" />
            Production Queue
          </Link>
          {shortcuts.map(({ label, tab, Icon }) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground hover:border-primary/60"
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function ComplianceOps() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showNewEntry, setShowNewEntry] = useState(null);
  const [user, setUser] = useState(null);
  const isPageVisible = usePageVisibility();

  const { data: complianceSummary, isFetching: complianceSummaryFetching, isError: complianceSummaryError } = useQuery({
    queryKey: ['admin_compliance_ops_summary'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminComplianceOpsSummary', {});
      const result = unwrapBase44Result(res);
      if (result?.error) throw new Error(result.error);
      return result;
    },
    enabled: isAdminUser(user) && isPageVisible,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });

  const { data: productionComplianceSummary } = useQuery({
    queryKey: ['admin_production_compliance_lifecycle_read_model'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminProductionPlanningSummary', {
        preset: 'this_week',
        read_model_mode: PRODUCTION_COMPLIANCE_READ_MODEL_MODE,
      });
      const result = unwrapBase44Result(res);
      if (result?.error) throw new Error(result.error);
      return result;
    },
    enabled: isAdminUser(user) && isPageVisible,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    base44.auth.me().then(u => setUser(u));
  }, []);

  const nativeCompliance = complianceSummary?.native || {};
  const productionComplianceReadModel = productionComplianceSummary?.production_compliance_lifecycle_read_model;
  const productionComplianceReadModelSupported = productionComplianceSummary?.production_compliance_read_model_available === true &&
    productionComplianceSummary?.production_compliance_read_model_enabled === true &&
    productionComplianceSummary?.production_compliance_read_model_version === SUPPORTED_PRODUCTION_COMPLIANCE_READ_MODEL_VERSION &&
    productionComplianceReadModel?.read_model_enabled === true &&
    productionComplianceReadModel?.read_model_version === SUPPORTED_PRODUCTION_COMPLIANCE_READ_MODEL_VERSION;
  const criticalAlerts = (nativeCompliance.active_alerts || []).filter(a => a.severity === 'Critical');
  const incompleteChecklistCount = Number(nativeCompliance.issues?.incomplete_checklists || 0);
  const complianceWarnings = Array.isArray(complianceSummary?.warnings)
    ? complianceSummary.warnings.filter(Boolean)
    : [];
  const hubComplianceWarning = complianceWarnings.find(warning => String(warning).toLowerCase().includes('hub') || String(warning).toLowerCase().includes('unable to load'));
  const nativeComplianceReady = Boolean(nativeCompliance?.summary && typeof nativeCompliance.summary === 'object');

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdminUser(user)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminOpsHeader
        title="Compliance Center"
        subtitle="Native Customer App compliance logs, checklists, alerts, label review, HACCP review, and audit export"
        badge="Native"
        badgeTone="success"
      />

      <div className="border-b border-border bg-card p-4">
        <div className="max-w-7xl mx-auto">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Operations, Audit & Compliance Tracking</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Create and review official Customer App compliance records. Source fallback remains available while native records are proven.
              </p>
            </div>
            <ComplianceMonitor />
          </div>

          {(criticalAlerts.length > 0 || incompleteChecklistCount > 0) && (
            <div className="grid gap-2 mt-4">
              {criticalAlerts.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex items-start gap-3 dark:border-red-900/60 dark:bg-red-950/30">
                  <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0 dark:text-red-300" />
                  <div>
                    <p className="font-semibold text-red-900 dark:text-red-100">{criticalAlerts.length} Critical Alert{criticalAlerts.length > 1 ? 's' : ''}</p>
                    <p className="text-sm text-red-700 dark:text-red-200/80">{criticalAlerts[0].message}</p>
                  </div>
                </div>
              )}
              {incompleteChecklistCount > 0 && (
                <div className="bg-lime-50 border border-lime-200 rounded-lg p-3 flex items-start gap-3 dark:border-lime-900/60 dark:bg-lime-950/30">
                  <AlertTriangle className="w-5 h-5 text-lime-600 mt-0.5 flex-shrink-0 dark:text-lime-300" />
                  <div>
                    <p className="font-semibold text-lime-900 dark:text-lime-100">{incompleteChecklistCount} Incomplete Checklist{incompleteChecklistCount === 1 ? '' : 's'}</p>
                    <p className="text-sm text-lime-700 dark:text-lime-200/80">Daily checklists must be completed before end of shift.</p>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100">
            <p className="font-semibold">
              Native compliance summary {complianceSummaryFetching ? 'refreshing' : complianceSummaryError ? 'unavailable' : 'ready'}
            </p>
            <p className="mt-0.5 text-emerald-800 dark:text-emerald-200/80">
              Native logs: {nativeCompliance.summary?.temperature || 0} temp · {nativeCompliance.summary?.ph || 0} pH · {nativeCompliance.summary?.ccp || 0} CCP · {nativeCompliance.summary?.sanitation || 0} sanitation · {nativeCompliance.summary?.daily_checklists || 0} checklists · {nativeCompliance.summary?.production_batches || 0} production batches.
            </p>
          </div>
          {hubComplianceWarning && !nativeComplianceReady && (
            <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-900 dark:border-cyan-900/70 dark:bg-cyan-950/40 dark:text-cyan-100">
              <p className="font-semibold">Primary compliance summary is not fully available</p>
              <p className="mt-0.5 text-cyan-800 dark:text-cyan-200">
                Native Customer App compliance records, production batch links, and audit-entry forms remain available. Source fallback returned: {hubComplianceWarning}
              </p>
            </div>
          )}
          {productionComplianceReadModelSupported && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100">
              <p className="font-semibold">Production/compliance lifecycle read model ready</p>
              <p className="mt-0.5 text-blue-800 dark:text-blue-200/80">
                Exact matches: {productionComplianceReadModel.summary?.exact_batch_log_match_count || 0} · missing logs: {productionComplianceReadModel.summary?.missing_log_count || 0} · review required: {productionComplianceReadModel.summary?.review_required_count || 0}. Hub fallback remains available and existing compliance write actions remain unchanged.
              </p>
            </div>
          )}
          <div className="mt-4">
            <ComplianceWorkflowPanel setActiveTab={setActiveTab} />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="mb-6">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/70 p-1">
              {complianceTabs.map(({ value, label, Icon }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="h-9 flex-1 basis-[calc(50%-0.25rem)] gap-1.5 px-2 text-xs sm:basis-[calc(33.333%-0.25rem)] lg:flex-none lg:basis-auto lg:px-3"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="dashboard">
            <ComplianceDashboard summary={complianceSummary} />
          </TabsContent>

          <TabsContent value="hub-parity">
            <ComplianceLogsParity />
          </TabsContent>

          <TabsContent value="documents">
            <ComplianceDocumentsTab nativeCompliance={nativeCompliance} />
          </TabsContent>

          <TabsContent value="temperature">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Temperature Logs</h2>
                <Button onClick={() => setShowNewEntry('temperature')} size="sm">
                  <Plus className="w-4 h-4 mr-2" /> New Log
                </Button>
              </div>
              {showNewEntry === 'temperature' && <TemperatureLogForm onClose={() => setShowNewEntry(null)} />}
              <TemperatureLogsList nativeCompliance={nativeCompliance} />
            </div>
          </TabsContent>

          <TabsContent value="pH">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">pH Logs</h2>
                <Button onClick={() => setShowNewEntry('pH')} size="sm">
                  <Plus className="w-4 h-4 mr-2" /> New Log
                </Button>
              </div>
              {showNewEntry === 'pH' && <PHLogForm onClose={() => setShowNewEntry(null)} />}
              <PHLogsList nativeCompliance={nativeCompliance} />
            </div>
          </TabsContent>

          <TabsContent value="CCP">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">CCP Logs</h2>
                <Button onClick={() => setShowNewEntry('CCP')} size="sm">
                  <Plus className="w-4 h-4 mr-2" /> New Log
                </Button>
              </div>
              {showNewEntry === 'CCP' && <CCPLogForm onClose={() => setShowNewEntry(null)} />}
              <CCPLogsList nativeCompliance={nativeCompliance} />
            </div>
          </TabsContent>

          <TabsContent value="sanitation">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Sanitation Logs</h2>
                <Button onClick={() => setShowNewEntry('sanitation')} size="sm">
                  <Plus className="w-4 h-4 mr-2" /> New Log
                </Button>
              </div>
              {showNewEntry === 'sanitation' && <SanitationLogForm onClose={() => setShowNewEntry(null)} />}
              <SanitationLogsList nativeCompliance={nativeCompliance} />
            </div>
          </TabsContent>

          <TabsContent value="corrective">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Corrective Actions</h2>
                <Button onClick={() => setShowNewEntry('corrective')} size="sm">
                  <Plus className="w-4 h-4 mr-2" /> New Action
                </Button>
              </div>
              {showNewEntry === 'corrective' && <CorrectiveActionForm onClose={() => setShowNewEntry(null)} />}
              <CorrectiveActionsList nativeCompliance={nativeCompliance} />
            </div>
          </TabsContent>

          <TabsContent value="checklist">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Daily Checklists</h2>
              </div>
              <DailyChecklistForm nativeCompliance={nativeCompliance} />
              <DailyChecklistsList nativeCompliance={nativeCompliance} />
            </div>
          </TabsContent>

          <TabsContent value="batch">
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-2xl font-bold">Batch Compliance Logs</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Record batch compliance details natively. This does not verify production, deduct inventory, or change order status.
                  </p>
                </div>
                <Button onClick={() => setShowNewEntry('batch')} size="sm">
                  <Plus className="w-4 h-4 mr-2" /> New Batch Log
                </Button>
              </div>
              {showNewEntry === 'batch' && <BatchComplianceLogForm onClose={() => setShowNewEntry(null)} />}
              <BatchComplianceLogsList nativeCompliance={nativeCompliance} />
            </div>
          </TabsContent>

          <TabsContent value="labels">
            <LabelAllergenTab nativeCompliance={nativeCompliance} />
          </TabsContent>

          <TabsContent value="haccp">
            <HACCPPlanTab nativeCompliance={nativeCompliance} />
          </TabsContent>

          <TabsContent value="export">
            <ExportCenter />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

const hiddenComplianceDetailFields = new Set([
  'id',
  'created_by',
  'updated_by',
  'created_date',
  'updated_date',
  'owner',
]);

const hiddenComplianceDetailPatterns = [
  /auth/i,
  /authorization/i,
  /bearer/i,
  /credential/i,
  /password/i,
  /payload/i,
  /provider/i,
  /secret/i,
  /shopify/i,
  /stack/i,
  /stripe/i,
  /token/i,
];

function isSafeComplianceDetailField(key) {
  return !hiddenComplianceDetailFields.has(key) && !hiddenComplianceDetailPatterns.some(pattern => pattern.test(key));
}

function formatComplianceDetailLabel(value) {
  return value
    .toString()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function formatComplianceDetailValue(value) {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    return value.length ? value.map(formatComplianceDetailValue).join(', ') : 'None';
  }
  if (typeof value === 'object') return 'Structured details available in audit export';
  return value.toString();
}

function ComplianceRecordDetails({ record }) {
  const entries = Object.entries(record || {})
    .filter(([key, value]) => isSafeComplianceDetailField(key) && value !== null && value !== undefined && value !== '')
    .slice(0, 28);

  if (entries.length === 0) return null;

  return (
    <details className="mt-3 rounded-lg border border-border/50 bg-background p-2">
      <summary className="cursor-pointer text-xs font-semibold text-foreground">View details</summary>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="rounded-md bg-card p-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{formatComplianceDetailLabel(key)}</p>
            <p className="mt-0.5 break-words text-xs text-foreground">{formatComplianceDetailValue(value)}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

// Compliance list cards stay read-only; record creation is handled by the form tabs above.
function TemperatureLogsList({ nativeCompliance }) {
  const logs = nativeCompliance?.records?.temperature || [];

  if (!logs.length) return <p className="text-muted-foreground">No temperature logs in the current compliance range.</p>;

  return (
    <div className="space-y-2">
      {logs.map(log => (
        <div key={log.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex justify-between items-start gap-3">
            <div>
              <p className="font-semibold">{log.location}</p>
              <p className="text-sm text-muted-foreground">{log.log_date} {log.log_time} • {log.staff_member}</p>
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm">
                {log.temperature}{log.unit || ''}
                {log.within_range ? (
                  <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    In range
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Review
                  </span>
                )}
              </p>
            </div>
          </div>
          <ComplianceRecordDetails record={log} />
        </div>
      ))}
    </div>
  );
}

function PHLogsList({ nativeCompliance }) {
  const logs = nativeCompliance?.records?.ph || [];

  if (!logs.length) return <p className="text-muted-foreground">No pH logs in the current compliance range.</p>;

  return (
    <div className="space-y-2">
      {logs.map(log => (
        <div key={log.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex justify-between items-start gap-3">
            <div>
              <p className="font-semibold">{log.batch_id} • {log.product_name}</p>
              <p className="text-sm text-muted-foreground">{log.log_date} {log.log_time} • {log.staff_member}</p>
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm">
                pH {log.ph_value}
                {log.within_range ? (
                  <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    In range
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Review
                  </span>
                )}
              </p>
            </div>
          </div>
          <ComplianceRecordDetails record={log} />
        </div>
      ))}
    </div>
  );
}

function CCPLogsList({ nativeCompliance }) {
  const logs = nativeCompliance?.records?.ccp || [];

  if (!logs.length) return <p className="text-muted-foreground">No CCP logs in the current compliance range.</p>;

  return (
    <div className="space-y-2">
      {logs.map(log => (
        <div key={log.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex justify-between items-start gap-3">
            <div>
              <p className="font-semibold">{log.ccp_point}</p>
              <p className="text-sm text-muted-foreground">{log.log_date} {log.log_time} • {log.staff_member}</p>
              <p className={`mt-1 inline-flex items-center gap-1 text-sm font-semibold ${log.result === 'Pass' ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                {log.result === 'Pass' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                {log.result}
              </p>
            </div>
          </div>
          <ComplianceRecordDetails record={log} />
        </div>
      ))}
    </div>
  );
}

function SanitationLogsList({ nativeCompliance }) {
  const logs = nativeCompliance?.records?.sanitation || [];

  if (!logs.length) return <p className="text-muted-foreground">No sanitation logs in the current compliance range.</p>;

  return (
    <div className="space-y-2">
      {logs.map(log => (
        <div key={log.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex justify-between items-start gap-3">
            <div>
              <p className="font-semibold">{log.area}</p>
              <p className="text-sm text-muted-foreground">{log.log_date} {log.log_time} • {log.staff_member}</p>
              <p className={`mt-1 inline-flex items-center gap-1 text-sm ${log.cleaned && log.sanitized ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>
                {log.cleaned && log.sanitized ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                {log.cleaned && log.sanitized ? 'Complete' : 'Incomplete'}
              </p>
            </div>
          </div>
          <ComplianceRecordDetails record={log} />
        </div>
      ))}
    </div>
  );
}

function CorrectiveActionsList({ nativeCompliance }) {
  const logs = nativeCompliance?.records?.corrective_actions || [];

  if (!logs.length) return <p className="text-muted-foreground">No corrective actions in the current compliance range.</p>;

  return (
    <div className="space-y-2">
      {logs.map(log => (
        <div key={log.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex justify-between items-start gap-3">
            <div>
              <p className="font-semibold">{log.issue_type}</p>
              <p className="text-sm text-muted-foreground">{log.log_date} {log.log_time} • {log.staff_member}</p>
              <p className="text-sm mt-1">{log.corrective_action_taken}</p>
              <span className={`inline-block text-xs px-2 py-1 rounded mt-2 ${log.status === 'Verified' ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200'}`}>{log.status}</span>
            </div>
          </div>
          <ComplianceRecordDetails record={log} />
        </div>
      ))}
    </div>
  );
}

function DailyChecklistsList({ nativeCompliance }) {
  const checklists = nativeCompliance?.records?.daily_checklists || [];

  if (!checklists.length) return <p className="text-muted-foreground">No checklists in the current compliance range.</p>;

  return (
    <div className="space-y-2">
      {checklists.map(checklist => (
        <div key={checklist.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex justify-between items-start gap-3">
            <div>
              <p className="font-semibold">{checklist.staff_member} • {checklist.shift} Shift</p>
              <p className="mt-1 inline-flex items-center gap-1 text-sm text-muted-foreground">
                {checklist.overall_status === 'Complete' ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-300" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300" />}
                Completed: {checklist.overall_status === 'Complete' ? 'Yes' : 'Needs review'}
              </p>
            </div>
          </div>
          <ComplianceRecordDetails record={checklist} />
        </div>
      ))}
    </div>
  );
}

function BatchComplianceLogsList({ nativeCompliance }) {
  const logs = nativeCompliance?.records?.batch_compliance || [];

  if (!logs.length) return <p className="text-muted-foreground">No batch compliance logs in the current compliance range.</p>;

  return (
    <div className="space-y-2">
      {logs.map(log => (
        <div key={log.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex justify-between items-start gap-3">
            <div>
              <p className="font-semibold">{log.batch_id} • {log.juice_flavor}</p>
              <p className="text-sm text-muted-foreground">
                {log.date} • {log.quantity_produced || 0} units • {log.verified_by || 'verification pending'}
              </p>
              <p className={`text-sm mt-1 font-semibold ${log.passed_failed === 'passed' ? 'text-emerald-700' : 'text-rose-700'}`}>
                {log.passed_failed || 'status pending'}
              </p>
            </div>
          </div>
          <ComplianceRecordDetails record={log} />
        </div>
      ))}
    </div>
  );
}

function ExportCenter() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerateAudit = async () => {
    if (!startDate || !endDate) return;
    setIsLoading(true);
    try {
      const response = await base44.functions.invoke('generateAuditPacket', {
        start_date: startDate,
        end_date: endDate,
      });
      if (response.data.file_url) {
        window.open(response.data.file_url, '_blank');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate Audit Packet</CardTitle>
        <CardDescription>Compile all compliance logs into a single professional PDF</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Start Date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full border rounded-md p-2 mt-1 bg-background text-foreground" />
          </div>
          <div>
            <label className="text-sm font-medium">End Date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full border rounded-md p-2 mt-1 bg-background text-foreground" />
          </div>
        </div>
        <Button onClick={handleGenerateAudit} disabled={isLoading} className="w-full">
          <Download className="w-4 h-4 mr-2" />
          {isLoading ? 'Generating...' : 'Generate Audit Packet'}
        </Button>
      </CardContent>
    </Card>
  );
}
