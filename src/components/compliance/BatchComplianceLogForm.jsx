import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

function parseList(value) {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parseIngredientRows(value) {
  return value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [ingredient_name, quantity, unit, lot_number] = line.split(',').map(part => part?.trim() || '');
      return {
        ingredient_name,
        quantity: quantity ? Number(quantity) : undefined,
        unit,
        lot_number,
      };
    })
    .filter(row => row.ingredient_name);
}

export default function BatchComplianceLogForm({ onClose }) {
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    batch_id: '',
    juice_flavor: '',
    quantity_produced: '',
    pH_result: '',
    passed_failed: 'passed',
    start_time: '',
    end_time: '',
    staff_on_duty_text: '',
    ingredients_text: '',
    notes: '',
  });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(user => {
      setFormData(prev => ({ ...prev, staff_on_duty_text: user?.full_name || user?.email || '' }));
    }).catch(() => null);
  }, []);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (error) setError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!formData.batch_id || !formData.juice_flavor || !formData.quantity_produced) {
      setError('Batch ID, product, and quantity produced are required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const quantityProduced = Number(formData.quantity_produced);
      if (!Number.isFinite(quantityProduced) || quantityProduced <= 0) {
        setError('Quantity produced must be greater than zero.');
        return;
      }

      await base44.functions.invoke('saveAdminComplianceRecord', {
        record_type: 'batch_compliance',
        data: {
          date: formData.date,
          batch_id: formData.batch_id,
          juice_flavor: formData.juice_flavor,
          quantity_produced: quantityProduced,
          pH_result: formData.pH_result ? Number(formData.pH_result) : undefined,
          passed_failed: formData.passed_failed,
          start_time: formData.start_time,
          end_time: formData.end_time,
          staff_on_duty: parseList(formData.staff_on_duty_text),
          ingredients: parseIngredientRows(formData.ingredients_text),
          notes: formData.notes,
        },
      });

      queryClient.invalidateQueries({ queryKey: ['admin_compliance_ops_summary'] });
      queryClient.invalidateQueries({ queryKey: ['compliance_logs_parity_summary'] });
      onClose?.();
    } catch {
      setError('Unable to save batch compliance log. Check required fields and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Batch Compliance Log</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="text-sm font-medium">Date</label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => handleChange('date', e.target.value)}
                className="mt-1 w-full rounded-md border bg-background p-2 text-foreground"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Batch ID</label>
              <input
                type="text"
                value={formData.batch_id}
                onChange={(e) => handleChange('batch_id', e.target.value)}
                placeholder="BATCH-YYYYMMDD-FLAVOR"
                className="mt-1 w-full rounded-md border bg-background p-2 text-foreground"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Product / Flavor</label>
              <input
                type="text"
                value={formData.juice_flavor}
                onChange={(e) => handleChange('juice_flavor', e.target.value)}
                placeholder="Oasis"
                className="mt-1 w-full rounded-md border bg-background p-2 text-foreground"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div>
              <label className="text-sm font-medium">Quantity Produced</label>
              <input
                type="number"
                min="1"
                step="1"
                value={formData.quantity_produced}
                onChange={(e) => handleChange('quantity_produced', e.target.value)}
                className="mt-1 w-full rounded-md border bg-background p-2 text-foreground"
              />
            </div>
            <div>
              <label className="text-sm font-medium">pH Result</label>
              <input
                type="number"
                step="0.01"
                value={formData.pH_result}
                onChange={(e) => handleChange('pH_result', e.target.value)}
                className="mt-1 w-full rounded-md border bg-background p-2 text-foreground"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Start Time</label>
              <input
                type="time"
                value={formData.start_time}
                onChange={(e) => handleChange('start_time', e.target.value)}
                className="mt-1 w-full rounded-md border bg-background p-2 text-foreground"
              />
            </div>
            <div>
              <label className="text-sm font-medium">End Time</label>
              <input
                type="time"
                value={formData.end_time}
                onChange={(e) => handleChange('end_time', e.target.value)}
                className="mt-1 w-full rounded-md border bg-background p-2 text-foreground"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Result</label>
              <select
                value={formData.passed_failed}
                onChange={(e) => handleChange('passed_failed', e.target.value)}
                className="mt-1 w-full rounded-md border bg-background p-2 text-foreground"
              >
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Staff On Duty</label>
              <input
                type="text"
                value={formData.staff_on_duty_text}
                onChange={(e) => handleChange('staff_on_duty_text', e.target.value)}
                placeholder="Name, Name"
                className="mt-1 w-full rounded-md border bg-background p-2 text-foreground"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Ingredients / Lots</label>
            <textarea
              value={formData.ingredients_text}
              onChange={(e) => handleChange('ingredients_text', e.target.value)}
              placeholder="One per line: ingredient, quantity, unit, lot number"
              rows={4}
              className="mt-1 w-full rounded-md border bg-background p-2 text-foreground"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border bg-background p-2 text-foreground"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Batch Log'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
