import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, ShieldCheck, CheckCircle2, X } from 'lucide-react';
import { getStatusClasses } from '@/lib/statusColors';

const CHECKLIST_FIELDS = [
  { key: 'hazard_analysis_reviewed', label: 'Hazard Analysis Reviewed' },
  { key: 'ccp_steps_reviewed', label: 'CCP Steps Reviewed' },
  { key: 'critical_limits_reviewed', label: 'Critical Limits Reviewed' },
  { key: 'monitoring_procedures_reviewed', label: 'Monitoring Procedures Reviewed' },
  { key: 'corrective_actions_reviewed', label: 'Corrective Actions Reviewed' },
  { key: 'verification_procedures_reviewed', label: 'Verification Procedures Reviewed' },
  { key: 'recordkeeping_reviewed', label: 'Recordkeeping Reviewed' },
];

function HACCPForm({ existing, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(existing || {
    plan_version: '', review_period: '', review_date: '', reviewed_by: '',
    approval_status: 'Pending', approved_by: '', approval_date: '',
    hazard_analysis_reviewed: false, ccp_steps_reviewed: false,
    critical_limits_reviewed: false, monitoring_procedures_reviewed: false,
    corrective_actions_reviewed: false, verification_procedures_reviewed: false,
    recordkeeping_reviewed: false, changes_made: false, change_summary: '',
    linked_document_url: '', next_review_date: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.plan_version || !form.review_date) return;
    setSaving(true);
    await base44.functions.invoke('saveAdminComplianceRecord', {
      record_type: 'haccp_plan',
      existing_id: existing?.id || null,
      data: form,
    });
    qc.invalidateQueries({ queryKey: ['haccp_plan_reviews'] });
    qc.invalidateQueries({ queryKey: ['admin_compliance_ops_summary'] });
    qc.invalidateQueries({ queryKey: ['compliance_logs_parity_summary'] });
    setSaving(false);
    onClose();
  };

  const completedCount = CHECKLIST_FIELDS.filter(f => form[f.key]).length;

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{existing ? 'Edit HACCP Review' : 'New HACCP Plan Review'}</CardTitle>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            ['Plan Version *', 'plan_version'],
            ['Review Period', 'review_period'],
            ['Review Date *', 'review_date', 'date'],
            ['Next Review Date', 'next_review_date', 'date'],
            ['Reviewed By (email)', 'reviewed_by', 'email'],
            ['Approved By (email)', 'approved_by', 'email'],
            ['Approval Date', 'approval_date', 'date'],
          ].map(([label, key, type = 'text']) => (
            <div key={key}>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
              <input type={type} value={form[key] || ''} onChange={e => set(key, e.target.value)}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
            </div>
          ))}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Approval Status</label>
            <select value={form.approval_status} onChange={e => set('approval_status', e.target.value)}
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background">
              {['Pending', 'Approved', 'Rejected', 'Requires Update'].map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
        </div>

        {/* Review Checklist */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Review Checklist ({completedCount}/{CHECKLIST_FIELDS.length} complete)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {CHECKLIST_FIELDS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm cursor-pointer p-2 rounded-lg hover:bg-muted/50">
                <input type="checkbox" checked={!!form[key]} onChange={e => set(key, e.target.checked)} className="h-4 w-4 accent-primary" />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" id="changes_made" checked={!!form.changes_made} onChange={e => set('changes_made', e.target.checked)} className="h-4 w-4 accent-primary" />
          <label htmlFor="changes_made" className="text-sm">Changes were made to the plan</label>
        </div>

        {form.changes_made && (
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Change Summary</label>
            <textarea value={form.change_summary || ''} onChange={e => set('change_summary', e.target.value)} rows={2}
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none" />
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</label>
          <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={2}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none" />
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={handleSave} disabled={saving || !form.plan_version || !form.review_date} size="sm">
            {saving ? 'Saving...' : existing ? 'Save Changes' : 'Create Review Record'}
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function HACCPPlanTab({ nativeCompliance }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const records = nativeCompliance?.records?.haccp_plan_reviews || [];
  const isLoading = !nativeCompliance;

  if (showForm || editing) {
    return <HACCPForm existing={editing} onClose={() => { setShowForm(false); setEditing(null); }} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">HACCP Plan Review</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Hazard Analysis Critical Control Point plan review history and approvals</p>
        </div>
        <Button onClick={() => setShowForm(true)} size="sm">
          <Plus className="w-4 h-4 mr-2" /> New Review Record
        </Button>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading native compliance records...</p>}

      {!isLoading && records.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <ShieldCheck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">No HACCP Plan Review records found yet.</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">Create a review record when the HACCP plan is ready for review or version update.</p>
            <Button className="mt-4" size="sm" onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4 mr-2" /> Create Review Record
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {records.map(r => {
          const checkedCount = CHECKLIST_FIELDS.filter(f => r[f.key]).length;
          return (
            <Card key={r.id} className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => setEditing(r)}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <p className="font-semibold text-foreground">HACCP Plan {r.plan_version}</p>
                      {r.review_period && <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{r.review_period}</span>}
                      {r.approval_status && (
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${getStatusClasses(r.approval_status)}`}>
                          {r.approval_status}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {r.review_date && <span>Reviewed {r.review_date}</span>}
                      {r.reviewed_by && <span>by {r.reviewed_by.split('@')[0]}</span>}
                      <span className={checkedCount === CHECKLIST_FIELDS.length ? 'text-emerald-700' : 'text-amber-700'}>
                        {checkedCount}/{CHECKLIST_FIELDS.length} sections reviewed
                      </span>
                      {r.changes_made && <span className="text-amber-700">• Changes made</span>}
                    </div>
                  </div>
                  {checkedCount === CHECKLIST_FIELDS.length && (
                    <CheckCircle2 className="h-5 w-5 text-emerald-700 shrink-0 mt-0.5" />
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
