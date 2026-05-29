import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { ShieldCheck, AlertTriangle, Clock, CheckCircle2, Plus, FileText, Trash2 } from 'lucide-react';
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

export default function ComplianceDocumentsTab() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    base44.entities.ComplianceDoc.list('-expiry_date', 50).then(data => {
      setDocs(data);
      setLoading(false);
    });
  }, []);

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      await base44.entities.ComplianceDoc.delete(id);
      setDocs(docs.filter(d => d.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} document(s)?`)) return;
    setDeleting(true);
    try {
      await Promise.all(Array.from(selected).map(id => base44.entities.ComplianceDoc.delete(id)));
      setDocs(docs.filter(d => !selected.has(d.id)));
      setSelected(new Set());
    } finally {
      setDeleting(false);
    }
  };

  const toggleSelect = (id) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelected(newSelected);
  };

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

      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <span className="text-sm font-medium text-blue-900">{selected.size} selected</span>
          <button onClick={handleBulkDelete} disabled={deleting} className="text-sm px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
            {deleting ? 'Deleting...' : 'Delete Selected'}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-sm px-3 py-1.5 rounded border border-blue-200 text-blue-700 hover:bg-blue-100">
            Cancel
          </button>
        </div>
      )}

      <div className="space-y-3">
        {docs.map(doc => {
          const Icon = statusIcon[doc.status] || CheckCircle2;
          return (
            <div key={doc.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4 hover:shadow-sm transition-shadow relative">
              <input
                type="checkbox"
                checked={selected.has(doc.id)}
                onChange={() => toggleSelect(doc.id)}
                className="absolute top-3 left-3"
              />
              <button
                onClick={() => handleDelete(doc.id)}
                disabled={deleting === doc.id}
                className="absolute top-3 right-3 text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${statusStyle[doc.status] || 'bg-gray-50 text-gray-700'}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0 pl-6">
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
