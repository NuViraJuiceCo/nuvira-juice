import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, AlertTriangle, Plus, Download } from 'lucide-react';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import May30ReadinessPanel from '@/components/admin/May30ReadinessPanel';
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

const complianceReadinessItems = [
  {
    label: 'Native log entry',
    status: 'controlled',
    detail: 'Temperature, pH, CCP, sanitation, corrective action, daily checklist, label, and HACCP records write through the admin compliance wrapper.',
  },
  {
    label: 'Batch compliance',
    status: 'fallback',
    detail: 'Batch logs stay tied to production verification so production and compliance records remain aligned.',
  },
  {
    label: 'Audit packets',
    status: 'ready',
    detail: 'Audit packet and binder views use compliance summaries without broad repair or sync tools.',
  },
  {
    label: 'Frozen tools',
    status: 'frozen',
    detail: 'Legacy diagnostic and repair endpoints remain disabled; use normal compliance forms and production lifecycle actions.',
  },
];

export default function ComplianceOps() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showNewEntry, setShowNewEntry] = useState(null);
  const [user, setUser] = useState(null);

  const { data: complianceSummary, isFetching: complianceSummaryFetching, isError: complianceSummaryError } = useQuery({
    queryKey: ['admin_compliance_ops_summary'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminComplianceOpsSummary', {});
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result;
    },
    enabled: user?.role === 'admin',
    staleTime: 60000,
  });

  useEffect(() => {
    base44.auth.me().then(u => setUser(u));
  }, []);

  const nativeCompliance = complianceSummary?.native || {};
  const criticalAlerts = (nativeCompliance.active_alerts || []).filter(a => a.severity === 'Critical');
  const incompleteChecklistCount = Number(nativeCompliance.issues?.incomplete_checklists || 0);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (user.role !== 'admin') {
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
              <h1 className="text-2xl font-bold text-foreground">Operations, Audit Readiness & Compliance Tracking</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Create and review official Customer App compliance records. Hub compliance remains available as fallback while native records are proven.
              </p>
            </div>
            <ComplianceMonitor />
          </div>

          {(criticalAlerts.length > 0 || incompleteChecklistCount > 0) && (
            <div className="grid gap-2 mt-4">
              {criticalAlerts.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-red-900">{criticalAlerts.length} Critical Alert{criticalAlerts.length > 1 ? 's' : ''}</p>
                    <p className="text-sm text-red-700">{criticalAlerts[0].message}</p>
                  </div>
                </div>
              )}
              {incompleteChecklistCount > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-yellow-900">{incompleteChecklistCount} Incomplete Checklist{incompleteChecklistCount === 1 ? '' : 's'}</p>
                    <p className="text-sm text-yellow-700">Daily checklists must be completed before end of shift.</p>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
            <p className="font-semibold">
              Native compliance summary {complianceSummaryFetching ? 'refreshing' : complianceSummaryError ? 'unavailable' : 'ready'}
            </p>
            <p className="mt-0.5 text-emerald-800">
              Native logs: {nativeCompliance.summary?.temperature || 0} temp · {nativeCompliance.summary?.ph || 0} pH · {nativeCompliance.summary?.ccp || 0} CCP · {nativeCompliance.summary?.sanitation || 0} sanitation · {nativeCompliance.summary?.daily_checklists || 0} checklists. Hub fallback remains available.
            </p>
          </div>
          <div className="mt-4">
            <May30ReadinessPanel
              title="Compliance usability"
              description="Compliance can be run from this Customer App page for event-day records while batch verification remains linked to production."
              items={complianceReadinessItems}
              actions={[
                { label: 'Production Queue', to: '/admin/production-queue' },
                { label: 'Production Planning', to: '/admin/production-planning' },
                { label: 'Review / Sync Health', to: '/admin/sync-health' },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="overflow-x-auto pb-1 mb-6">
            <TabsList className="inline-flex w-max min-w-full">
              <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              <TabsTrigger value="hub-parity">🗂️ Audit Packets & Binder</TabsTrigger>
              <TabsTrigger value="documents">📋 Documents</TabsTrigger>
              <TabsTrigger value="temperature">🌡️ Temperature</TabsTrigger>
              <TabsTrigger value="pH">🧪 pH</TabsTrigger>
              <TabsTrigger value="CCP">⚠️ CCP</TabsTrigger>
              <TabsTrigger value="sanitation">🧹 Sanitation</TabsTrigger>
              <TabsTrigger value="corrective">🔧 Corrective</TabsTrigger>
              <TabsTrigger value="checklist">📋 Checklist</TabsTrigger>
              <TabsTrigger value="batch">🧾 Batch Logs</TabsTrigger>
              <TabsTrigger value="labels">🏷️ Labels & Allergens</TabsTrigger>
              <TabsTrigger value="haccp">🛡️ HACCP Plan</TabsTrigger>
              <TabsTrigger value="export">📊 Export</TabsTrigger>
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
              <div>
                <h2 className="text-2xl font-bold">Batch Compliance Logs</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Batch verification logs created by production workflows. Create/verify batch logs from the production lifecycle action, not from this tab.
                </p>
              </div>
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
        <div key={log.id} className="border rounded-lg p-3">
          <div className="flex justify-between items-start gap-3">
            <div>
              <p className="font-semibold">{log.location}</p>
              <p className="text-sm text-muted-foreground">{log.log_date} {log.log_time} • {log.staff_member}</p>
              <p className="text-sm mt-1">{log.temperature}{log.unit || ''} {log.within_range ? '✓' : '⚠️'}</p>
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
        <div key={log.id} className="border rounded-lg p-3">
          <div className="flex justify-between items-start gap-3">
            <div>
              <p className="font-semibold">{log.batch_id} • {log.product_name}</p>
              <p className="text-sm text-muted-foreground">{log.log_date} {log.log_time} • {log.staff_member}</p>
              <p className="text-sm mt-1">pH {log.ph_value} {log.within_range ? '✓' : '⚠️'}</p>
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
        <div key={log.id} className="border rounded-lg p-3">
          <div className="flex justify-between items-start gap-3">
            <div>
              <p className="font-semibold">{log.ccp_point}</p>
              <p className="text-sm text-muted-foreground">{log.log_date} {log.log_time} • {log.staff_member}</p>
              <p className={`text-sm mt-1 font-semibold ${log.result === 'Pass' ? 'text-green-600' : 'text-red-600'}`}>{log.result}</p>
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
        <div key={log.id} className="border rounded-lg p-3">
          <div className="flex justify-between items-start gap-3">
            <div>
              <p className="font-semibold">{log.area}</p>
              <p className="text-sm text-muted-foreground">{log.log_date} {log.log_time} • {log.staff_member}</p>
              <p className="text-sm mt-1">{log.cleaned && log.sanitized ? '✓ Complete' : '⚠️ Incomplete'}</p>
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
        <div key={log.id} className="border rounded-lg p-3">
          <div className="flex justify-between items-start gap-3">
            <div>
              <p className="font-semibold">{log.issue_type}</p>
              <p className="text-sm text-muted-foreground">{log.log_date} {log.log_time} • {log.staff_member}</p>
              <p className="text-sm mt-1">{log.corrective_action_taken}</p>
              <span className={`inline-block text-xs px-2 py-1 rounded mt-2 ${log.status === 'Verified' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{log.status}</span>
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
        <div key={checklist.id} className="border rounded-lg p-3">
          <div className="flex justify-between items-start gap-3">
            <div>
              <p className="font-semibold">{checklist.staff_member} • {checklist.shift} Shift</p>
              <p className="text-sm text-muted-foreground">Completed: {checklist.overall_status === 'Complete' ? '✓' : '⚠️'}</p>
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
        <div key={log.id} className="border rounded-lg p-3">
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
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Start Date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full border rounded-md p-2 mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">End Date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full border rounded-md p-2 mt-1" />
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
