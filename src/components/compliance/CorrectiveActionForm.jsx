import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import StaffMemberPicker from '@/components/admin/StaffMemberPicker';

export default function CorrectiveActionForm({ onClose }) {
  const [, setUser] = useState(null);
  const [formData, setFormData] = useState({
    log_date: new Date().toISOString().split('T')[0],
    log_time: new Date().toTimeString().slice(0, 5),
    staff_member: '',
    issue_type: 'Temperature Out of Range',
    related_log_id: '',
    issue_description: '',
    corrective_action_taken: '',
    action_completed_time: '',
    verification: '',
    verified_by: '',
    status: 'Initiated',
    notes: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      setFormData(prev => ({ ...prev, staff_member: u.full_name || u.email || '' }));
    }).catch(() => null);
  }, []);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.corrective_action_taken) return;

    setIsSubmitting(true);
    try {
      await base44.functions.invoke('saveAdminComplianceRecord', {
        record_type: 'corrective_action',
        data: formData,
      });

      queryClient.invalidateQueries({ queryKey: ['corrective_logs'] });
      queryClient.invalidateQueries({ queryKey: ['admin_compliance_ops_summary'] });
      queryClient.invalidateQueries({ queryKey: ['compliance_logs_parity_summary'] });
      onClose?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="mb-6 border-border/60 bg-card text-card-foreground">
      <CardHeader>
        <CardTitle>Corrective Action Log</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Date</label>
              <input
                type="date"
                value={formData.log_date}
                onChange={(e) => handleChange('log_date', e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background p-2 text-foreground"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Time</label>
              <input
                type="time"
                value={formData.log_time}
                onChange={(e) => handleChange('log_time', e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background p-2 text-foreground"
              />
            </div>
          </div>

          <div>
            <StaffMemberPicker
              label="Staff member"
              value={formData.staff_member}
              onChange={(value) => handleChange('staff_member', value)}
              helperText="Select the person responsible for the correction, or type another name."
            />
          </div>

          <div>
            <label className="text-sm font-medium">Issue Type</label>
            <select
              value={formData.issue_type}
              onChange={(e) => handleChange('issue_type', e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-foreground"
            >
              <option>Temperature Out of Range</option>
              <option>pH Failure</option>
              <option>CCP Failure</option>
              <option>Sanitation Issue</option>
              <option>Equipment Problem</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">Issue Description</label>
            <textarea
              value={formData.issue_description}
              onChange={(e) => handleChange('issue_description', e.target.value)}
              placeholder="What happened? Why is corrective action needed?"
              className="mt-1 w-full resize-none rounded-md border border-border bg-background p-2 text-foreground placeholder:text-muted-foreground"
              rows="3"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Corrective Action Taken *</label>
            <textarea
              value={formData.corrective_action_taken}
              onChange={(e) => handleChange('corrective_action_taken', e.target.value)}
              placeholder="What specific action was taken to correct the issue?"
              className="mt-1 w-full resize-none rounded-md border border-border bg-background p-2 text-foreground placeholder:text-muted-foreground"
              rows="3"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Action Completed Time</label>
              <input
                type="time"
                value={formData.action_completed_time}
                onChange={(e) => handleChange('action_completed_time', e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background p-2 text-foreground"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Status</label>
              <select
                value={formData.status}
                onChange={(e) => handleChange('status', e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background p-2 text-foreground"
              >
                <option>Initiated</option>
                <option>In Progress</option>
                <option>Completed</option>
                <option>Verified</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Verification Method</label>
            <input
              type="text"
              value={formData.verification}
              onChange={(e) => handleChange('verification', e.target.value)}
              placeholder="How was the correction verified? (e.g., retest at 5pm)"
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div>
            <StaffMemberPicker
              label="Verified by"
              value={formData.verified_by}
              onChange={(value) => handleChange('verified_by', value)}
              placeholder="Manager or supervisor name"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Notes (Optional)</label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Additional information..."
              className="mt-1 w-full resize-none rounded-md border border-border bg-background p-2 text-foreground placeholder:text-muted-foreground"
              rows="2"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              {isSubmitting ? 'Saving...' : 'Save Corrective Action'}
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
