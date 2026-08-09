import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import moment from 'moment';
import { base44 } from '@/api/base44Client';
import { unwrapBase44Result } from '@/lib/base44-result';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const DOCUMENT_TYPES = ['Certification', 'Permit', 'Audit', 'Inspection', 'Review', 'Log', 'License'];
const EMPTY_FORM = {
  name: '',
  type: 'Permit',
  owner: '',
  issuing_body: '',
  issued_date: '',
  expiry_date: '',
  reminder_days: '30',
  file_url: '',
  notes: '',
};

const statusStyle = {
  Valid: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200',
  'Due Soon': 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-200',
  Overdue: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200',
  Expired: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200',
  Pending: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200',
};
const statusIcon = { Valid: CheckCircle2, 'Due Soon': Clock, Overdue: AlertTriangle, Expired: AlertTriangle, Pending: Clock };

function documentForm(record) {
  if (!record) return { ...EMPTY_FORM };
  return Object.fromEntries(Object.keys(EMPTY_FORM).map(key => [
    key,
    key === 'reminder_days' ? String(record[key] ?? 30) : String(record[key] ?? ''),
  ]));
}

function saveErrorMessage(error) {
  const code = String(error || '');
  if (code.includes('duplicate_compliance_document')) return 'A document with this name and renewal date already exists.';
  if (code.includes('dates_out_of_order')) return 'The renewal date must be on or after the issue date.';
  if (code.includes('date_invalid')) return 'Enter valid issue and renewal dates.';
  if (code.includes('url_invalid')) return 'The document link must begin with http:// or https://.';
  if (code.includes('Forbidden') || code.includes('Unauthorized')) return 'Your admin session is no longer authorized. Sign in again and retry.';
  return 'The document could not be saved. No changes were confirmed; retry when ready.';
}

function StatCard({ label, value, icon: Icon }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-xs">{label}</p>
          <p className="mt-1 text-xl font-bold text-foreground sm:mt-2 sm:text-2xl">{value}</p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:h-10 sm:w-10">
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
      </div>
    </div>
  );
}

function Field({ label, required = false, children }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-foreground">
        {label}{required ? ' *' : ''}
      </Label>
      {children}
    </div>
  );
}

export default function ComplianceDocumentsTab({ nativeCompliance, onSaved }) {
  const docs = nativeCompliance?.records?.compliance_documents || [];
  const loading = !nativeCompliance;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setField = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const openCreate = () => {
    setEditing(null);
    setForm(documentForm(null));
    setError('');
    setDialogOpen(true);
  };
  const openEdit = record => {
    setEditing(record);
    setForm(documentForm(record));
    setError('');
    setDialogOpen(true);
  };
  const closeDialog = () => {
    if (saving) return;
    setDialogOpen(false);
    setEditing(null);
    setError('');
  };

  const saveDocument = async event => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await base44.functions.invoke('saveAdminComplianceRecord', {
        record_type: 'compliance_document',
        existing_id: editing?.id || null,
        data: {
          ...form,
          reminder_days: Number(form.reminder_days || 30),
        },
      });
      const result = unwrapBase44Result(response);
      if (result?.success !== true || !result?.record_id) {
        throw new Error(result?.error || 'save_not_confirmed');
      }
      await onSaved?.();
      setDialogOpen(false);
      setEditing(null);
    } catch (saveError) {
      setError(saveErrorMessage(saveError?.message));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  const valid = docs.filter(doc => doc.status === 'Valid').length;
  const dueSoon = docs.filter(doc => doc.status === 'Due Soon').length;
  const overdue = docs.filter(doc => doc.status === 'Overdue' || doc.status === 'Expired').length;

  return (
    <div className="w-full space-y-6 overflow-x-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Compliance Documents</h2>
          <p className="mt-1 text-muted-foreground">Certifications, permits, inspections, licenses, and renewal dates</p>
        </div>
        <Button onClick={openCreate} className="gap-2 self-start sm:self-auto">
          <Plus className="h-4 w-4" /> Add Document
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <StatCard label="Valid" value={valid} icon={ShieldCheck} />
        <StatCard label="Due Soon" value={dueSoon} icon={Clock} />
        <StatCard label="Overdue" value={overdue} icon={AlertTriangle} />
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-900 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-100">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Admins can add or update records here. Expiry status is calculated from the renewal date. Destructive document changes remain controlled.</p>
      </div>

      <div className="space-y-3">
        {docs.map(doc => {
          const Icon = statusIcon[doc.status] || CheckCircle2;
          return (
            <div key={doc.id} className="relative flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-shadow hover:shadow-sm sm:gap-4 sm:p-4">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${statusStyle[doc.status] || 'bg-muted text-muted-foreground'}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{doc.name}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{doc.type} · {doc.owner || doc.issuing_body || 'No owner recorded'}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 sm:hidden">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle[doc.status] || 'bg-muted text-muted-foreground'}`}>{doc.status}</span>
                  {doc.expiry_date && <span className="text-xs text-muted-foreground">Renews {moment(doc.expiry_date).format('MMM D, YYYY')}</span>}
                </div>
              </div>
              <div className="hidden shrink-0 flex-col items-end gap-1 text-right sm:flex">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle[doc.status] || 'bg-muted text-muted-foreground'}`}>{doc.status}</span>
                {doc.expiry_date && <p className="text-xs text-muted-foreground">Renews {moment(doc.expiry_date).format('MMM D, YYYY')}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {doc.file_url && (
                  <Button variant="ghost" size="icon" asChild title="Open document">
                    <a href={doc.file_url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${doc.name}`}>
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={() => openEdit(doc)} title="Edit document" aria-label={`Edit ${doc.name}`}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
        {docs.length === 0 && (
          <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium text-foreground">No compliance documents recorded</p>
            <p className="mt-1 text-sm text-muted-foreground">Add the first current NuVira permit, license, inspection, or certification.</p>
            <Button onClick={openCreate} size="sm" className="mt-4 gap-2">
              <Plus className="h-4 w-4" /> Add Document
            </Button>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={open => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent className="max-w-2xl p-0">
          <form onSubmit={saveDocument}>
            <DialogHeader className="border-b border-border px-5 py-4 pr-12 sm:px-6">
              <DialogTitle>{editing ? 'Edit compliance document' : 'Add compliance document'}</DialogTitle>
              <DialogDescription>
                Record the official document and renewal details. Status updates automatically from the renewal date.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[calc(100dvh-13rem)] space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
              {error && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-100">
                  {error}
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Document name" required>
                  <Input value={form.name} onChange={event => setField('name', event.target.value)} maxLength={160} required autoFocus />
                </Field>
                <Field label="Document type" required>
                  <select
                    value={form.type}
                    onChange={event => setField('type', event.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    required
                  >
                    {DOCUMENT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </Field>
                <Field label="Responsible owner">
                  <Input value={form.owner} onChange={event => setField('owner', event.target.value)} maxLength={160} placeholder="NuVira Juice Co." />
                </Field>
                <Field label="Issuing authority">
                  <Input value={form.issuing_body} onChange={event => setField('issuing_body', event.target.value)} maxLength={160} />
                </Field>
                <Field label="Issue date">
                  <Input type="date" value={form.issued_date} onChange={event => setField('issued_date', event.target.value)} />
                </Field>
                <Field label="Renewal or expiry date">
                  <Input type="date" value={form.expiry_date} onChange={event => setField('expiry_date', event.target.value)} />
                </Field>
                <Field label="Reminder window (days)">
                  <Input type="number" min="0" max="365" step="1" value={form.reminder_days} onChange={event => setField('reminder_days', event.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Document link">
                  <Input type="url" value={form.file_url} onChange={event => setField('file_url', event.target.value)} maxLength={500} placeholder="https://" />
                </Field>
              </div>
              <Field label="Notes">
                <Textarea value={form.notes} onChange={event => setField('notes', event.target.value)} maxLength={1000} rows={4} />
              </Field>
            </div>

            <DialogFooter className="gap-2 border-t border-border px-5 py-4 sm:px-6">
              <Button type="button" variant="outline" onClick={closeDialog} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving || !form.name.trim() || !form.type} className="gap-2">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? 'Saving...' : editing ? 'Save changes' : 'Add document'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
