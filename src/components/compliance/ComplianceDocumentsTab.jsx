import { ShieldCheck, AlertTriangle, Clock, CheckCircle2, Plus, FileText, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import moment from 'moment';

const statusStyle = {
  Valid: 'bg-emerald-50 text-emerald-700',
  'Due Soon': 'bg-amber-50 text-amber-700',
  Overdue: 'bg-red-50 text-red-700',
  Expired: 'bg-red-100 text-red-800',
  Pending: 'bg-blue-50 text-blue-700',
};
const statusIcon = { Valid: CheckCircle2, 'Due Soon': Clock, Overdue: AlertTriangle, Expired: AlertTriangle, Pending: Clock };

function StatCard({ label, value, icon: Icon }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
        </div>
        <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export default function ComplianceDocumentsTab({ nativeCompliance }) {
  const docs = nativeCompliance?.records?.compliance_documents || [];
  const loading = !nativeCompliance;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const valid = docs.filter(d => d.status === 'Valid').length;
  const dueSoon = docs.filter(d => d.status === 'Due Soon').length;
  const overdue = docs.filter(d => d.status === 'Overdue' || d.status === 'Expired').length;

  return (
    <div className="space-y-6 w-full overflow-x-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Compliance Documents</h2>
          <p className="text-muted-foreground mt-1">Certifications, permits and regulatory requirements</p>
        </div>
        <Button onClick={() => {}} className="gap-2 self-start sm:self-auto">
          <Plus className="h-4 w-4" /> Add Document
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <StatCard label="Valid" value={valid} icon={ShieldCheck} />
        <StatCard label="Due Soon" value={dueSoon} icon={Clock} />
        <StatCard label="Overdue" value={overdue} icon={AlertTriangle} />
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Document deletes are locked during launch operations. Use the existing compliance fallback/admin process for destructive document changes.</p>
      </div>

      <div className="space-y-3">
        {docs.map(doc => {
          const Icon = statusIcon[doc.status] || CheckCircle2;
          return (
            <div key={doc.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4 hover:shadow-sm transition-shadow relative">
              <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${statusStyle[doc.status] || 'bg-gray-50 text-gray-700'}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-foreground">{doc.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{doc.type} · {doc.owner || doc.issuing_body || '—'}</p>
              </div>
              <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle[doc.status] || 'bg-gray-50 text-gray-700'}`}>{doc.status}</span>
                {doc.expiry_date && <p className="text-xs text-muted-foreground">Expires {moment(doc.expiry_date).format('MMM D, YYYY')}</p>}
                {doc.file_url && (
                  <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
                    <FileText className="h-3 w-3" /> View
                  </a>
                )}
              </div>
            </div>
          );
        })}
        {docs.length === 0 && <p className="text-center text-muted-foreground py-12">No compliance documents yet.</p>}
      </div>
    </div>
  );
}
