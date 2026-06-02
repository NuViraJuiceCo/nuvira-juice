import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

export default function CCPLogForm({ onClose }) {
  const [, setUser] = useState(null);
  const [formData, setFormData] = useState({
    log_date: new Date().toISOString().split('T')[0],
    log_time: new Date().toTimeString().slice(0, 5),
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
    try {
      await base44.functions.invoke('saveAdminComplianceRecord', {
        record_type: 'ccp',
        data: formData,
      });

      queryClient.invalidateQueries({ queryKey: ['CCP_logs'] });
      queryClient.invalidateQueries({ queryKey: ['CCP_logs_today'] });
      queryClient.invalidateQueries({ queryKey: ['admin_compliance_ops_summary'] });
      queryClient.invalidateQueries({ queryKey: ['compliance_logs_parity_summary'] });
      onClose?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>⚠️ CCP Log (Critical Control Point)</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Date</label>
              <input
                type="date"
                value={formData.log_date}
                onChange={(e) => handleChange('log_date', e.target.value)}
                className="w-full border rounded-md p-2 mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Time</label>
              <input
                type="time"
                value={formData.log_time}
                onChange={(e) => handleChange('log_time', e.target.value)}
                className="w-full border rounded-md p-2 mt-1"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Staff Member</label>
            <input
              type="text"
              value={formData.staff_member}
              onChange={(e) => handleChange('staff_member', e.target.value)}
              className="w-full border rounded-md p-2 mt-1"
              disabled
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">CCP Point</label>
              <select
                value={formData.ccp_point}
                onChange={(e) => handleChange('ccp_point', e.target.value)}
                className="w-full border rounded-md p-2 mt-1"
              >
                <option>Pasteurization</option>
                <option>Cooling</option>
                <option>pH Control</option>
                <option>Microbial Test</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Batch ID</label>
              <input
                type="text"
                value={formData.batch_id}
                onChange={(e) => handleChange('batch_id', e.target.value)}
                placeholder="e.g., #101"
                className="w-full border rounded-md p-2 mt-1"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Measurement</label>
              <input
                type="text"
                value={formData.measurement}
                onChange={(e) => handleChange('measurement', e.target.value)}
                placeholder="e.g., 72°C for 15 min"
                className="w-full border rounded-md p-2 mt-1"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">Critical Limit</label>
              <input
                type="text"
                value={formData.critical_limit}
                onChange={(e) => handleChange('critical_limit', e.target.value)}
                placeholder="e.g., 72°C for 15 min"
                className="w-full border rounded-md p-2 mt-1"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Result</label>
            <select
              value={formData.result}
              onChange={(e) => handleChange('result', e.target.value)}
              className="w-full border rounded-md p-2 mt-1"
            >
              <option>Pass</option>
              <option>Fail</option>
            </select>
          </div>

          {isCritical && (
            <div className="flex gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-800">
                <p className="font-semibold">🚨 CRITICAL: CCP FAILURE</p>
                <p>This batch has failed a critical control point. Immediate corrective action is required.</p>
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Additional observations..."
              className="w-full border rounded-md p-2 mt-1 resize-none"
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
