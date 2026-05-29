import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Tag, X } from 'lucide-react';
import { getStatusClasses } from '@/lib/statusColors';

function LabelForm({ existing, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(existing || {
    product_name: '', label_version: '', ingredient_statement: '',
    allergen_statement: '', contains_allergens: false, allergens_present: [],
    may_contain_statement: '', nutrition_label_status: 'Not Required',
    net_volume: '', business_name_and_address: '', barcode_or_sku: '',
    review_status: 'Pending', reviewed_by: '', review_date: '',
    approval_status: 'Pending', approved_by: '', approval_date: '',
    next_review_date: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.product_name) return;
    setSaving(true);
    if (existing?.id) {
      await base44.entities.LabelAllergenReview.update(existing.id, form);
    } else {
      await base44.entities.LabelAllergenReview.create(form);
    }
    qc.invalidateQueries({ queryKey: ['label_allergen_reviews'] });
    setSaving(false);
    onClose();
  };

  const field = (label, key, type = 'text', opts = {}) => (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
      {type === 'textarea' ? (
        <textarea
          value={form[key] || ''}
          onChange={e => set(key, e.target.value)}
          rows={2}
          className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none"
          {...opts}
        />
      ) : type === 'select' ? (
        <select
          value={form[key] || ''}
          onChange={e => set(key, e.target.value)}
          className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
        >
          {opts.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type={type}
          value={form[key] || ''}
          onChange={e => set(key, e.target.value)}
          className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
          {...opts}
        />
      )}
    </div>
  );

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{existing ? 'Edit Label Review' : 'New Label / Allergen Review'}</CardTitle>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('Product Name *', 'product_name')}
          {field('Label Version', 'label_version')}
          {field('Net Volume', 'net_volume')}
          {field('Barcode / SKU', 'barcode_or_sku')}
        </div>
        {field('Ingredient Statement', 'ingredient_statement', 'textarea')}
        {field('Allergen Statement', 'allergen_statement', 'textarea')}
        {field('May Contain Statement', 'may_contain_statement')}
        {field('Business Name & Address on Label', 'business_name_and_address')}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {field('Nutrition Label Status', 'nutrition_label_status', 'select', { options: ['Not Required', 'Draft', 'Reviewed', 'Approved'] })}
          {field('Review Status', 'review_status', 'select', { options: ['Pending', 'In Review', 'Reviewed', 'Needs Changes'] })}
          {field('Approval Status', 'approval_status', 'select', { options: ['Pending', 'Approved', 'Rejected', 'Requires Update'] })}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('Reviewed By (email)', 'reviewed_by', 'email')}
          {field('Review Date', 'review_date', 'date')}
          {field('Approved By (email)', 'approved_by', 'email')}
          {field('Approval Date', 'approval_date', 'date')}
          {field('Next Review Date', 'next_review_date', 'date')}
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="contains_allergens" checked={!!form.contains_allergens} onChange={e => set('contains_allergens', e.target.checked)} className="h-4 w-4 accent-primary" />
          <label htmlFor="contains_allergens" className="text-sm">Contains allergens</label>
        </div>
        {field('Notes', 'notes', 'textarea')}
        <div className="flex gap-2 pt-2">
          <Button onClick={handleSave} disabled={saving || !form.product_name} size="sm">
            {saving ? 'Saving...' : existing ? 'Save Changes' : 'Create Review Record'}
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function LabelAllergenTab() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['label_allergen_reviews'],
    queryFn: () => base44.entities.LabelAllergenReview.list('-updated_date', 100),
  });

  if (showForm || editing) {
    return (
      <LabelForm
        existing={editing}
        onClose={() => { setShowForm(false); setEditing(null); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Labels & Allergens</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Product label review, allergen declarations, and approval tracking</p>
        </div>
        <Button onClick={() => setShowForm(true)} size="sm">
          <Plus className="w-4 h-4 mr-2" /> New Review Record
        </Button>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading...</p>}

      {!isLoading && records.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Tag className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">No Product Label / Allergen Review records found yet.</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">Create a review record when a product label is ready for compliance review.</p>
            <Button className="mt-4" size="sm" onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4 mr-2" /> Create Review Record
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {records.map(r => (
          <Card key={r.id} className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => setEditing(r)}>
            <CardContent className="py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <p className="font-semibold text-foreground">{r.product_name}</p>
                    {r.label_version && <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{r.label_version}</span>}
                    {r.approval_status && (
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${getStatusClasses(r.approval_status)}`}>
                        {r.approval_status}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {r.allergen_statement || (r.contains_allergens ? 'Contains allergens' : 'No allergens declared')}
                  </p>
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                    {r.review_date && <span>Reviewed {r.review_date}</span>}
                    {r.reviewed_by && <span>by {r.reviewed_by.split('@')[0]}</span>}
                    {r.next_review_date && <span>• Next review {r.next_review_date}</span>}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
