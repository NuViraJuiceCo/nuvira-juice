import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

export default function PHLogForm({ onClose }) {
  const [, setUser] = useState(null);
  const [formData, setFormData] = useState({
    log_date: new Date().toISOString().split('T')[0],
    log_time: new Date().toTimeString().slice(0, 5),
    staff_member: '',
    batch_id: '',
    product_name: 'Green Glow Juice',
    ph_value: '',
    min_ph: 4.0,
    max_ph: 5.0,
    notes: '',
  });
  const [warning, setWarning] = useState('');
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

    if (field === 'ph_value') {
      const ph = parseFloat(value);
      if (ph < formData.min_ph || ph > formData.max_ph) {
        setWarning(`pH ${ph} is outside range ${formData.min_ph}-${formData.max_ph}`);
      } else {
        setWarning('');
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.ph_value || !formData.batch_id) return;

    setIsSubmitting(true);
    try {
      const ph = parseFloat(formData.ph_value);
      const isInRange = ph >= formData.min_ph && ph <= formData.max_ph;

      await base44.functions.invoke('saveAdminComplianceRecord', {
        record_type: 'ph',
        data: {
          ...formData,
          ph_value: ph,
          within_range: isInRange,
        },
      });

      queryClient.invalidateQueries({ queryKey: ['pH_logs'] });
      queryClient.invalidateQueries({ queryKey: ['pH_logs_today'] });
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
        <CardTitle>🧪 pH Test Log</CardTitle>
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
            <div>
              <label className="text-sm font-medium">Product</label>
              <select
                value={formData.product_name}
                onChange={(e) => handleChange('product_name', e.target.value)}
                className="w-full border rounded-md p-2 mt-1"
              >
                <option>Green Glow Juice</option>
                <option>Berry Blast Juice</option>
                <option>Citrus Fresh Juice</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">pH Value</label>
            <input
              type="number"
              step="0.1"
              value={formData.ph_value}
              onChange={(e) => handleChange('ph_value', e.target.value)}
              placeholder="e.g., 4.5"
              className="w-full border rounded-md p-2 mt-1"
              required
            />
            <p className="text-xs text-muted-foreground mt-1">Target range: {formData.min_ph} - {formData.max_ph}</p>
          </div>

          {warning && (
            <div className="flex gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-800">
                <p className="font-semibold">⚠️ CRITICAL: pH OUT OF RANGE</p>
                <p>{warning}</p>
                <p className="mt-1">Corrective action log is REQUIRED immediately.</p>
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium">Notes (Optional)</label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Any additional observations..."
              className="w-full border rounded-md p-2 mt-1 resize-none"
              rows="3"
            />
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              {isSubmitting ? 'Saving...' : 'Save pH Log'}
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
