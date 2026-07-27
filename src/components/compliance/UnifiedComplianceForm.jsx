import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StaffMemberPicker from '@/components/admin/StaffMemberPicker';

const LOG_TYPES = {
  temperature: {
    label: 'Temperature',
    fields: ['location', 'temperature'],
    defaults: { location: 'Cold Room 1', temperature: '', min_range: 35, max_range: 40 }
  },
  pH: {
    label: 'pH',
    fields: ['batch_id', 'product_name', 'ph_value', 'min_ph', 'max_ph'],
    defaults: { batch_id: '', product_name: '', ph_value: '', min_ph: 3.5, max_ph: 4.5 }
  },
  CCP: {
    label: 'CCP',
    fields: ['ccp_point', 'batch_id', 'measurement', 'critical_limit'],
    defaults: { ccp_point: 'Pasteurization', batch_id: '', measurement: '', critical_limit: '' }
  },
  sanitation: {
    label: 'Sanitation',
    fields: ['area', 'sanitizer_type', 'cleaned', 'sanitized'],
    defaults: { area: 'Prep Area', sanitizer_type: '', cleaned: false, sanitized: false }
  },
  corrective_action: {
    label: 'Corrective Action',
    fields: ['issue_type', 'issue_description', 'corrective_action_taken', 'verified_by'],
    defaults: { issue_type: 'Temperature Out of Range', issue_description: '', corrective_action_taken: '', verified_by: '' }
  },
  daily_checklist: {
    label: 'Daily Checklist',
    fields: ['shift', 'fridge_logged', 'sanitizer_checked', 'equipment_sanitized', 'areas_cleaned', 'batches_logged'],
    defaults: { shift: 'Morning', fridge_logged: false, sanitizer_checked: false, equipment_sanitized: false, areas_cleaned: false, batches_logged: false }
  },
  batch: {
    label: 'Batch Log',
    fields: ['batch_id', 'juice_flavor', 'ingredients', 'start_time', 'end_time', 'quantity', 'staff_on_duty', 'ph_result', 'passed_failed'],
    defaults: { batch_id: '', juice_flavor: '', ingredients: '', start_time: '', end_time: '', quantity: '', staff_on_duty: '', ph_result: '', passed_failed: 'pass' }
  },
  receiving: {
    label: 'Receiving',
    fields: ['supplier', 'item', 'quantity', 'condition', 'accepted', 'stored_at'],
    defaults: { supplier: '', item: '', quantity: '', condition: '', accepted: true, stored_at: '' }
  },
  pest_monitoring: {
    label: 'Pest Monitoring',
    fields: ['inspection_area', 'evidence_observed', 'pest_type', 'action_taken', 'reported_manager'],
    defaults: { inspection_area: '', evidence_observed: '', pest_type: '', action_taken: '', reported_manager: '' }
  },
  employee_illness: {
    label: 'Employee Illness',
    fields: ['employee_name', 'symptoms', 'excluded_from_work', 'return_date', 'reported_manager'],
    defaults: { employee_name: '', symptoms: '', excluded_from_work: false, return_date: '', reported_manager: '' }
  },
  calibration: {
    label: 'Calibration',
    fields: ['equipment_id', 'equipment_type', 'calibration_method', 'expected_value', 'observed_value', 'within_range', 'adjusted'],
    defaults: { equipment_id: '', equipment_type: '', calibration_method: '', expected_value: '', observed_value: '', within_range: true, adjusted: false }
  }
};

export default function UnifiedComplianceForm() {
  const [activeTab, setActiveTab] = useState('temperature');
  const [formData, setFormData] = useState(LOG_TYPES.temperature.defaults);
  const [user, setUser] = useState(null);
  const [staffMember, setStaffMember] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const queryClient = useQueryClient();

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const recipes = await base44.entities.Recipe.list('product_name', 100);
      return recipes.filter(r => r.is_active !== false);
    },
    select: (recipes) => recipes.map(r => ({ id: r.id, name: r.product_name, batch_id: r.product_sku, recipe: r }))
  });

  const allRecipes = useQuery({
    queryKey: ['recipes'],
    queryFn: async () => {
      const data = await base44.entities.Recipe.list('product_name', 100);
      return data.filter(r => r.is_active !== false);
    },
  }).data || [];

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      setStaffMember(u?.full_name || u?.email || '');
    });
  }, []);

  const handleLogTypeChange = (type) => {
    setActiveTab(type);
    setFormData(LOG_TYPES[type].defaults);
    setMessage('');
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleProductSelect = (productId) => {
    const product = products.find(p => p.id === productId);
    if (product) {
      const recipe = allRecipes.find(r => r.product_name === product.name);
      const ingredientsList = recipe?.ingredients?.map(ing => `${ing.ingredient_name} (${ing.quantity_oz}${ing.unit || 'oz'})`).join(', ') || '';

      setFormData(prev => ({
        ...prev,
        product_name: product.name,
        juice_flavor: product.name,
        ingredients: ingredientsList,
        batch_id: product.batch_id || prev.batch_id
      }));
    }
  };

  const handleSubmit = async () => {
    if (!user) return;
    setLoading(true);
    setMessage('');

    try {
      // Use Chicago timezone for all timestamp data
      const chicagoTime = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
      const chicagoDate = new Date(chicagoTime);

      const logEntry = {
        log_type: activeTab,
        log_date: chicagoDate.toISOString().split('T')[0],
        log_time: chicagoDate.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
        staff_member: staffMember || user.full_name || user.email,
        shift: getShift(),
        data: formData,
        status: getStatus(activeTab, formData),
        notes: '', // Ensure notes field exists
        within_range: getStatus(activeTab, formData) === 'pass' // Add within_range for compliance schema
      };

      await base44.functions.invoke('saveAdminComplianceRecord', {
        record_type: 'unified',
        data: logEntry,
      });
      queryClient.invalidateQueries({ queryKey: ['admin_compliance_ops_summary'] });
      queryClient.invalidateQueries({ queryKey: ['compliance_logs_parity_summary'] });
      setMessage('Log saved successfully');
      setFormData(LOG_TYPES[activeTab].defaults);

      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('Save error:', error);
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getShift = () => {
    // Use America/Chicago timezone for shift determination
    const chicagoTime = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
    const hour = new Date(chicagoTime).getHours();
    if (hour < 12) return 'Morning';
    if (hour < 17) return 'Afternoon';
    return 'Night';
  };

  const getStatus = (type, data) => {
    if (type === 'temperature') {
      const temp = parseFloat(data.temperature);
      return (!isNaN(temp) && temp >= data.min_range && temp <= data.max_range) ? 'pass' : 'fail';
    }
    if (type === 'pH') {
      const ph = parseFloat(data.ph_value);
      return (!isNaN(ph) && ph >= data.min_ph && ph <= data.max_ph) ? 'pass' : 'fail';
    }
    if (type === 'sanitation') {
      return (data.cleaned && data.sanitized) ? 'complete' : 'incomplete';
    }
    return 'pass';
  };

  const config = LOG_TYPES[activeTab];
  const isValid = config.fields.every(f => formData[f] !== '' && formData[f] !== null);
  const staffMemberValid = Boolean(String(staffMember || '').trim());
  const status = getStatus(activeTab, formData);
  const staffFieldLabels = {
    staff_on_duty: 'Staff on duty',
    verified_by: 'Verified by',
    employee_name: 'Employee name',
    reported_manager: 'Reported manager',
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Compliance Log Entry</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={handleLogTypeChange} className="w-full">
          <div className="flex flex-wrap gap-2 mb-4">
            {Object.entries(LOG_TYPES).map(([key, val]) => (
              <button
                key={key}
                onClick={() => handleLogTypeChange(key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${
                  activeTab === key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-foreground border-border hover:bg-muted'
                }`}
              >
                {val.label}
              </button>
            ))}
          </div>

          {Object.entries(LOG_TYPES).map(([logType, cfg]) => (
            <TabsContent key={logType} value={logType} className="space-y-4">
              {logType === 'batch' && (
                <div>
                  <label className="text-sm font-medium">Select Juice Product</label>
                  <select
                    onChange={(e) => handleProductSelect(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-foreground"
                  >
                    <option value="">-- Choose a product --</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <StaffMemberPicker
                label="Responsible staff member"
                value={staffMember}
                onChange={setStaffMember}
                helperText="Select from the active team list or type another staff name."
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cfg.fields.map(field => (
                  <div key={field}>
                    {staffFieldLabels[field] ? (
                      <StaffMemberPicker
                        label={staffFieldLabels[field]}
                        value={formData[field]}
                        onChange={(value) => handleChange(field, value)}
                        multiple={field === 'staff_on_duty'}
                        helperText={field === 'staff_on_duty' ? 'Select each person who worked the batch, or type another name.' : undefined}
                      />
                    ) : (
                      <>
                        <label className="text-sm font-medium capitalize">{field.replace(/_/g, ' ')}</label>
                        {typeof formData[field] === 'boolean' ? (
                      <input
                        type="checkbox"
                        checked={formData[field]}
                        onChange={(e) => handleChange(field, e.target.checked)}
                        className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-foreground"
                      />
                        ) : (
                      <input
                        type={field.includes('range') || field.includes('temp') || field.includes('pH') ? 'number' : 'text'}
                        value={formData[field]}
                        onChange={(e) => handleChange(field, e.target.value)}
                        className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-foreground placeholder:text-muted-foreground"
                        placeholder={`Enter ${field}`}
                      />
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Status indicator */}
              {['temperature', 'pH'].includes(logType) && formData[logType === 'temperature' ? 'temperature' : 'ph_value'] && (
                <div className={`flex items-center gap-2 p-3 rounded-lg border ${
                  status === 'pass'
                    ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30'
                    : 'border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30'
                }`}>
                  {status === 'pass' ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-300" />
                      <span className="text-sm text-green-700 dark:text-green-200">Within range</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-300" />
                      <span className="text-sm text-red-700 dark:text-red-200">Out of range</span>
                    </>
                  )}
                </div>
              )}

              {message && (
                <div className={`p-3 rounded-lg border text-sm ${
                  message.includes('Error')
                    ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
                }`}>
                  {message}
                </div>
              )}

              <Button
                onClick={handleSubmit}
                disabled={!isValid || !staffMemberValid || loading}
                className="w-full"
              >
                {loading ? 'Saving...' : 'Save Log Entry'}
              </Button>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
