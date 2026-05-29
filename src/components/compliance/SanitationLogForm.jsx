import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

export default function SanitationLogForm({ onClose }) {
  const [, setUser] = useState(null);
  const [formData, setFormData] = useState({
    log_date: new Date().toISOString().split('T')[0],
    log_time: new Date().toTimeString().slice(0, 5),
    staff_member: '',
    area: 'Prep Area',
    sanitizer_type: 'Bleach Solution',
    sanitizer_level: 'Adequate',
    cleaned: false,
    sanitized: false,
    verified_by: '',
    notes: '',
  });
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
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.cleaned || !formData.sanitized) return;

    setIsSubmitting(true);
    try {
      await base44.functions.invoke('saveAdminComplianceRecord', {
        record_type: 'sanitation',
        data: formData,
      });

      queryClient.invalidateQueries({ queryKey: ['sanitation_logs'] });
      onClose?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>🧹 Sanitation Log</CardTitle>
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
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Time</label>
              <input
                type="time"
                value={formData.log_time}
                onChange={(e) => handleChange('log_time', e.target.value)}
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Staff Member</label>
            <input
              type="text"
              value={formData.staff_member}
              onChange={(e) => handleChange('staff_member', e.target.value)}
                className="w-full border rounded-md p-2 mt-1 bg-muted text-foreground"
              disabled
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Area</label>
              <select
                value={formData.area}
                onChange={(e) => handleChange('area', e.target.value)}
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
              >
                <option>Prep Area</option>
                <option>Production Floor</option>
                <option>Packing Area</option>
                <option>Cold Storage</option>
                <option>Equipment</option>
                <option>Bathrooms</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Sanitizer Type</label>
              <select
                value={formData.sanitizer_type}
                onChange={(e) => handleChange('sanitizer_type', e.target.value)}
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
              >
                <option>Bleach Solution</option>
                <option>Quaternary Ammonium</option>
                <option>Iodine</option>
                <option>Alcohol 70%</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Sanitizer Level</label>
            <select
              value={formData.sanitizer_level}
              onChange={(e) => handleChange('sanitizer_level', e.target.value)}
              className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
            >
              <option>Low</option>
              <option>Adequate</option>
              <option>Optimal</option>
            </select>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={formData.cleaned}
                onCheckedChange={(checked) => handleChange('cleaned', checked)}
                id="cleaned"
              />
              <label htmlFor="cleaned" className="text-sm cursor-pointer">✓ Area cleaned</label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={formData.sanitized}
                onCheckedChange={(checked) => handleChange('sanitized', checked)}
                id="sanitized"
              />
              <label htmlFor="sanitized" className="text-sm cursor-pointer">✓ Area sanitized</label>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Verified By (Optional)</label>
            <input
              type="text"
              value={formData.verified_by}
              onChange={(e) => handleChange('verified_by', e.target.value)}
              placeholder="Manager or supervisor name"
              className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Notes (Optional)</label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Any issues or observations..."
              className="w-full border rounded-md p-2 mt-1 resize-none bg-background text-foreground"
              rows="3"
            />
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting || !formData.cleaned || !formData.sanitized} className="flex-1">
              {isSubmitting ? 'Saving...' : 'Save Sanitation Log'}
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
