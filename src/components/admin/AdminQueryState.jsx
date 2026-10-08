import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function AdminQueryState({ loading = false, error, retry, title = 'Data unavailable' }) {
  return <div className="nv-admin-query-state" role={error ? 'alert' : 'status'}>
    {loading ? <RefreshCw size={20} className="animate-spin" /> : <AlertCircle size={20} />}
    <div><strong>{loading ? 'Loading current records' : title}</strong><p>{loading ? 'Checking the latest information.' : 'This view could not be refreshed. Counts and readiness are unknown until the read succeeds.'}</p></div>
    {!loading && retry && <button type="button" onClick={() => retry()}><RefreshCw size={16} />Retry</button>}
  </div>;
}
