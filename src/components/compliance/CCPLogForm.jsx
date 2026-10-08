import { requireConfirmedAdminWrite } from '@/lib/confirmedAdminWrite';
import { businessDateTime } from '@/lib/businessDate';
import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, ShieldAlert } from 'lucide-react';
import StaffMemberPicker from '@/components/admin/StaffMemberPicker';

export default function CCPLogForm({ onClose }) {
  const [, setUser] = useState(null);
  const [formData, setFormData] = useState({
    log_date: businessDateTime().date,
    log_time: businessDateTime().time,
    staff_member: '',
    ccp_point: 'Pasteurization',
    batch_id: '',
    measurement: '',
    critical_limit: '',
    result: 'Pass',
    notes: '',
  });
  const [isCritical, setIsCritical] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveError, setSaveError] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      setFormData(prev => ({ ...prev, staff_member: u.full_name }));
    });
  }, []);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    if (field === 'result' && value === 'Fail') {
      setIsCritical(true);
    } else if (field === 'result') {
      setIsCritical(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.batch_id || !formData.measurement) return;

    setIsSubmitting(true);
    setSaveError('');
    try {
      requireConfirmedAdminWrite(await base44.functions.invoke('saveAdminComplianceRecord', {
        record_type: 'ccp',
        data: formData,
      }));

      queryClient.invalidateQueries({ queryKey: ['CCP_logs'] });
      queryClient.invalidateQueries({ queryKey: ['CCP_logs_today'] });
      queryClient.invalidateQueries({ queryKey: ['admin_compliance_ops_summary'] });
      queryClient.invalidateQueries({ queryKey: ['compliance_logs_parity_summary'] });
      onClose?.();
    } catch {
      setSaveError('The save could not be confirmed. Your entries are still here. Check the records before retrying to avoid a duplicate.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-primary" />
          CCP Log
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {saveError && <p role="alert" className="nv-admin-form-error">{saveError}</p>}
          <p className="nv-admin-form-timezone">Dates and times: America/Chicago</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="CCPLogForm-field-2958" className="text-sm font-medium">Date</label>
              <input aria-label="log date" id="CCPLogForm-field-2958"
                type="date"
                value={formData.log_date}
                onChange={(e) => handleChange('log_date', e.target.value)}
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
              />
            </div>
            <div>
              <label htmlFor="CCPLogForm-field-3336" className="text-sm font-medium">Time</label>
              <input aria-label="log time" id="CCPLogForm-field-3336"
                type="time"
                value={formData.log_time}
                onChange={(e) => handleChange('log_time', e.target.value)}
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
              />
            </div>
          </div>

          <StaffMemberPicker
            label="Staff member"
            value={formData.staff_member}
            onChange={(value) => handleChange('staff_member', value)}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="CCPLogForm-field-3991" className="text-sm font-medium">CCP Point</label>
              <select aria-label="ccp point" id="CCPLogForm-field-3991"
                value={formData.ccp_point}
                onChange={(e) => handleChange('ccp_point', e.target.value)}
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
              >
                <option>Pasteurization</option>
                <option>Cooling</option>
                <option>pH Control</option>
                <option>Microbial Test</option>
              </select>
            </div>
            <div>
              <label htmlFor="CCPLogForm-field-4552" className="text-sm font-medium">Batch ID</label>
              <input aria-label="batch id" id="CCPLogForm-field-4552"
                type="text"
                value={formData.batch_id}
                onChange={(e) => handleChange('batch_id', e.target.value)}
                placeholder="e.g., #101"
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="CCPLogForm-field-5087" className="text-sm font-medium">Measurement</label>
              <input aria-label="measurement" id="CCPLogForm-field-5087"
                type="text"
                value={formData.measurement}
                onChange={(e) => handleChange('measurement', e.target.value)}
                placeholder="e.g., 72°C for 15 min"
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
                required
              />
            </div>
            <div>
              <label htmlFor="CCPLogForm-field-5558" className="text-sm font-medium">Critical Limit</label>
              <input aria-label="critical limit" id="CCPLogForm-field-5558"
                type="text"
                value={formData.critical_limit}
                onChange={(e) => handleChange('critical_limit', e.target.value)}
                placeholder="e.g., 72°C for 15 min"
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
              />
            </div>
          </div>

          <div>
            <label htmlFor="CCPLogForm-field-6014" className="text-sm font-medium">Result</label>
            <select aria-label="result" id="CCPLogForm-field-6014"
              value={formData.result}
              onChange={(e) => handleChange('result', e.target.value)}
              className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
            >
              <option>Pass</option>
              <option>Fail</option>
            </select>
          </div>

          {isCritical && (
            <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-950/30">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5 dark:text-red-300" />
              <div className="text-sm text-red-800 dark:text-red-100">
                <p className="font-semibold">Critical: CCP failure</p>
                <p>This batch has failed a critical control point. Immediate corrective action is required.</p>
              </div>
            </div>
          )}

          <div>
            <label htmlFor="CCPLogForm-field-7007" className="text-sm font-medium">Notes</label>
            <textarea aria-label="notes" id="CCPLogForm-field-7007"
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Additional observations..."
              className="w-full border rounded-md p-2 mt-1 resize-none bg-background text-foreground"
              rows="3"
            />
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              {isSubmitting ? 'Saving...' : 'Save CCP Log'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
