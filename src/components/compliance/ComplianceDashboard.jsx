import React from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';

export default function ComplianceDashboard() {
  const today = new Date().toISOString().split('T')[0];

  const { data: tempLogs } = useQuery({
    queryKey: ['temp_logs_today'],
    queryFn: async () => {
      const logs = await base44.entities.TemperatureLog.list('-log_date', 500);
      return logs.filter(l => l.log_date === today);
    },
  });

  const { data: phLogs } = useQuery({
    queryKey: ['pH_logs_today'],
    queryFn: async () => {
      const logs = await base44.entities.pHLog.list('-log_date', 500);
      return logs.filter(l => l.log_date === today);
    },
  });

  const { data: ccpLogs } = useQuery({
    queryKey: ['CCP_logs_today'],
    queryFn: async () => {
      const logs = await base44.entities.CCPLog.list('-log_date', 500);
      return logs.filter(l => l.log_date === today);
    },
  });

  const { data: alerts } = useQuery({
    queryKey: ['alerts_today'],
    queryFn: async () => {
      const allAlerts = await base44.entities.ComplianceAlert.list('-triggered_date', 500);
      return allAlerts.filter(a => a.triggered_date === today && a.status === 'Active');
    },
  });

  const { data: checklists } = useQuery({
    queryKey: ['checklists_today'],
    queryFn: () => base44.entities.DailyChecklist.filter({ checklist_date: today }),
  });

  const phFailures = phLogs?.filter(l => l.within_range === false) || [];
  const tempOutOfRange = tempLogs?.filter(l => l.within_range === false) || [];
  const ccpFailures = ccpLogs?.filter(l => l.result === 'Fail') || [];
  const checklistsComplete = checklists?.filter(c => c.overall_status === 'Complete')?.length || 0;
  const checklistsIncomplete = checklists?.filter(c => c.overall_status === 'Incomplete')?.length || 0;

  const metrics = [
    {
      label: 'Temperature Logs',
      value: tempLogs?.length || 0,
      status: tempOutOfRange.length === 0 ? 'good' : 'warning',
      icon: '🌡️',
    },
    {
      label: 'pH Tests',
      value: phLogs?.length || 0,
      status: phFailures.length === 0 ? 'good' : 'critical',
      icon: '🧪',
    },
    {
      label: 'CCP Checks',
      value: ccpLogs?.length || 0,
      status: ccpFailures.length === 0 ? 'good' : 'critical',
      icon: '⚠️',
    },
    {
      label: 'Checklists',
      value: `${checklistsComplete}/${checklistsComplete + checklistsIncomplete}`,
      status: checklistsIncomplete === 0 ? 'good' : 'warning',
      icon: '📋',
    },
  ];

  const getStatusColor = (status) => {
    switch (status) {
      case 'good':
        return 'bg-green-50 border-green-200';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200';
      case 'critical':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-slate-50 border-slate-200';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'good':
        return <CheckCircle2 className="w-5 h-5 text-green-600" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
      case 'critical':
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      default:
        return <Clock className="w-5 h-5 text-slate-600" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {metrics.map((metric, i) => (
          <Card key={i} className={`border-2 ${getStatusColor(metric.status)}`}>
            <CardContent className="pt-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm text-muted-foreground">{metric.label}</p>
                  <p className="text-3xl font-bold mt-2">{metric.value}</p>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-2xl">{metric.icon}</span>
                  {getStatusIcon(metric.status)}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {alerts && alerts.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-900">🚨 Active Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {alerts.map((alert, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-red-900">{alert.message}</p>
                    <p className="text-xs text-red-700 mt-1">{alert.alert_type} • {alert.triggered_time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {tempOutOfRange.length > 0 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader>
            <CardTitle className="text-yellow-900">⚠️ Out of Range Values</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {tempOutOfRange.map((log, i) => (
                <p key={i} className="text-sm text-yellow-800">
                  {log.location}: {log.temperature}°C
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {(phFailures.length > 0 || ccpFailures.length > 0) && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-900">🔴 Critical Failures</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {phFailures.map((log, i) => (
                <p key={i} className="text-sm text-red-800">
                  pH Failure: Batch {log.batch_id} pH {log.ph_value}
                </p>
              ))}
              {ccpFailures.map((log, i) => (
                <p key={i} className="text-sm text-red-800">
                  CCP Failure: {log.ccp_point} (Batch {log.batch_id})
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}