import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';

export default function ComplianceDashboard({ summary }) {
  const native = summary?.native || {};

  const phFailureCount = Number(native.issues?.ph_out_of_range || 0);
  const tempOutOfRangeCount = Number(native.issues?.temp_out_of_range || 0);
  const ccpFailureCount = Number(native.issues?.ccp_failed || 0);
  const checklistsComplete = Math.max(Number(native.summary?.daily_checklists || 0) - Number(native.issues?.incomplete_checklists || 0), 0);
  const checklistsIncomplete = Number(native.issues?.incomplete_checklists || 0);
  const activeAlerts = native.active_alerts || [];

  const metrics = [
    {
      label: 'Temperature Logs',
      value: native.summary?.temperature || 0,
      status: tempOutOfRangeCount === 0 ? 'good' : 'warning',
      icon: '🌡️',
    },
    {
      label: 'pH Tests',
      value: native.summary?.ph || 0,
      status: phFailureCount === 0 ? 'good' : 'critical',
      icon: '🧪',
    },
    {
      label: 'CCP Checks',
      value: native.summary?.ccp || 0,
      status: ccpFailureCount === 0 ? 'good' : 'critical',
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

      {activeAlerts && activeAlerts.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-900">🚨 Active Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {activeAlerts.map((alert, i) => (
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

      {(tempOutOfRangeCount > 0 || phFailureCount > 0 || ccpFailureCount > 0) && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-900">🔴 Compliance Attention</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {tempOutOfRangeCount > 0 && <p className="text-sm text-red-800">{tempOutOfRangeCount} temperature log{tempOutOfRangeCount === 1 ? '' : 's'} out of range.</p>}
              {phFailureCount > 0 && <p className="text-sm text-red-800">{phFailureCount} pH log{phFailureCount === 1 ? '' : 's'} out of range.</p>}
              {ccpFailureCount > 0 && <p className="text-sm text-red-800">{ccpFailureCount} CCP failure{ccpFailureCount === 1 ? '' : 's'} recorded.</p>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
