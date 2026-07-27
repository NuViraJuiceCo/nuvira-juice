import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, CheckCircle2, Clock, AlertTriangle, ClipboardList, Factory, FlaskConical, ShieldAlert, Thermometer } from 'lucide-react';

export default function ComplianceDashboard({ summary }) {
  const native = summary?.native || {};

  const phFailureCount = Number(native.issues?.ph_out_of_range || 0);
  const tempOutOfRangeCount = Number(native.issues?.temp_out_of_range || 0);
  const ccpFailureCount = Number(native.issues?.ccp_failed || 0);
  const checklistsComplete = Math.max(Number(native.summary?.daily_checklists || 0) - Number(native.issues?.incomplete_checklists || 0), 0);
  const checklistsIncomplete = Number(native.issues?.incomplete_checklists || 0);
  const productionBatchCount = Number(native.summary?.production_batches || 0);
  const activeAlerts = native.active_alerts || [];

  const metrics = [
    {
      label: 'Production Batches',
      value: productionBatchCount,
      status: productionBatchCount > 0 ? 'good' : 'neutral',
      Icon: Factory,
    },
    {
      label: 'Temperature Logs',
      value: native.summary?.temperature || 0,
      status: tempOutOfRangeCount === 0 ? 'good' : 'warning',
      Icon: Thermometer,
    },
    {
      label: 'pH Tests',
      value: native.summary?.ph || 0,
      status: phFailureCount === 0 ? 'good' : 'critical',
      Icon: FlaskConical,
    },
    {
      label: 'CCP Checks',
      value: native.summary?.ccp || 0,
      status: ccpFailureCount === 0 ? 'good' : 'critical',
      Icon: ShieldAlert,
    },
    {
      label: 'Checklists',
      value: `${checklistsComplete}/${checklistsComplete + checklistsIncomplete}`,
      status: checklistsIncomplete === 0 ? 'good' : 'warning',
      Icon: ClipboardList,
    },
  ];

  const getStatusColor = (status) => {
    switch (status) {
      case 'good':
        return 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900/60';
      case 'warning':
        return 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900/60';
      case 'critical':
        return 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900/60';
      default:
        return 'bg-card border-border';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'good':
        return <CheckCircle2 className="w-5 h-5 text-green-600" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-lime-600" />;
      case 'critical':
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      default:
        return <Clock className="w-5 h-5 text-slate-600" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {metrics.map((metric, i) => {
          const MetricIcon = metric.Icon;
          return (
          <Card key={i} className={`border-2 ${getStatusColor(metric.status)}`}>
            <CardContent className="pt-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm text-muted-foreground">{metric.label}</p>
                  <p className="text-3xl font-bold mt-2">{metric.value}</p>
                </div>
                <div className="flex flex-col gap-2">
                  <MetricIcon className="h-6 w-6 text-primary" />
                  {getStatusIcon(metric.status)}
                </div>
              </div>
            </CardContent>
          </Card>
          );
        })}
      </div>

      {activeAlerts && activeAlerts.length > 0 && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30">
          <CardHeader>
            <CardTitle className="text-red-900 dark:text-red-100">Active Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {activeAlerts.map((alert, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0 dark:text-red-300" />
                  <div>
                    <p className="font-medium text-red-900 dark:text-red-100">{alert.message}</p>
                    <p className="text-xs text-red-700 mt-1 dark:text-red-200/80">{alert.alert_type} • {alert.triggered_time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {(tempOutOfRangeCount > 0 || phFailureCount > 0 || ccpFailureCount > 0) && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30">
          <CardHeader>
            <CardTitle className="text-red-900 dark:text-red-100">Compliance Attention</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {tempOutOfRangeCount > 0 && <p className="text-sm text-red-800 dark:text-red-100">{tempOutOfRangeCount} temperature log{tempOutOfRangeCount === 1 ? '' : 's'} out of range.</p>}
              {phFailureCount > 0 && <p className="text-sm text-red-800 dark:text-red-100">{phFailureCount} pH log{phFailureCount === 1 ? '' : 's'} out of range.</p>}
              {ccpFailureCount > 0 && <p className="text-sm text-red-800 dark:text-red-100">{ccpFailureCount} CCP failure{ccpFailureCount === 1 ? '' : 's'} recorded.</p>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
