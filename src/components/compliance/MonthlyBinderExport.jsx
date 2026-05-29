import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X, BookOpen, Loader2 } from 'lucide-react';
import moment from 'moment';

const LOG_TYPE_OPTIONS = [
  { value: 'all', label: 'All Log Types' },
  { value: 'batch_log', label: 'Batch Logs' },
  { value: 'sanitation', label: 'Sanitation Logs' },
  { value: 'CCP', label: 'CCP Logs' },
  { value: 'temperature', label: 'Temperature Logs' },
  { value: 'corrective_action', label: 'Corrective Actions' },
];

const MONTHS = moment.months().map((m, i) => ({ value: String(i + 1).padStart(2, '0'), label: m }));
const YEARS = Array.from({ length: 5 }, (_, i) => String(moment().year() - 2 + i));

export default function MonthlyBinderExport({ user, onClose }) {
  const [month, setMonth] = useState(moment().format('MM'));
  const [year, setYear] = useState(moment().format('YYYY'));
  const [logTypeFilter, setLogTypeFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState(null);
  const [countLoading, setCountLoading] = useState(false);

  const startDate = `${year}-${month}-01`;
  const endDate = moment(startDate).endOf('month').format('YYYY-MM-DD');
  const monthLabel = moment(startDate).format('MMMM YYYY');

  // Load preview counts when month/year/filter changes
  useEffect(() => {
    let cancelled = false;
    async function loadCounts() {
      setCountLoading(true);
      setCounts(null);
      try {
        const [batchLogs, sanitationLogs, ccpLogs, tempLogs, correctiveLogs] = await Promise.all([
          base44.entities.BatchComplianceLog?.list('-date', 500).catch(() => []),
          base44.entities.SanitationLog?.list('-log_date', 500).catch(() => []),
          base44.entities.CCPLog?.list('-log_date', 500).catch(() => []),
          base44.entities.TemperatureLog?.list('-log_date', 500).catch(() => []),
          base44.entities.CorrectiveActionLog?.list('-log_date', 500).catch(() => []),
        ]);

        if (cancelled) return;

        const inRange = (d) => d >= startDate && d <= endDate;

        const c = {
          batch: batchLogs.filter(l => inRange(l.date || l.log_date)),
          sanitation: sanitationLogs.filter(l => inRange(l.log_date)),
          ccp: ccpLogs.filter(l => inRange(l.log_date)),
          temperature: tempLogs.filter(l => inRange(l.log_date)),
          corrective: correctiveLogs.filter(l => inRange(l.log_date)),
        };
        setCounts(c);
      } finally {
        if (!cancelled) setCountLoading(false);
      }
    }
    loadCounts();
    return () => { cancelled = true; };
  }, [month, year]);

  const totalRecords = counts
    ? Object.values(counts).reduce((s, arr) => s + arr.length, 0)
    : 0;

  const handleExport = () => {
    if (!counts) return;
    setLoading(true);

    // Build printable HTML content for all sections
    const sections = buildBinderHTML({ counts, monthLabel, startDate, endDate, user, logTypeFilter });

    const printWindow = window.open('', '_blank');
    const fileName = `NuVira_Compliance_Binder_${moment(startDate).format('MMMM')}_${year}`;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${fileName}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a1a; }
          .page { page-break-after: always; padding: 24px 28px; min-height: 100vh; }
          .page:last-child { page-break-after: avoid; }
          h1 { font-size: 22px; font-weight: bold; color: #14532d; }
          h2 { font-size: 16px; font-weight: bold; color: #14532d; margin-bottom: 8px; }
          h3 { font-size: 13px; font-weight: bold; color: #1a1a1a; margin-bottom: 4px; }
          .header-bar { background: #14532d; color: white; padding: 16px 24px; margin: -24px -28px 20px; }
          .header-bar h1 { color: white; }
          .header-bar p { color: #bbf7d0; font-size: 12px; margin-top: 4px; }
          .section-header { background: #f0fdf4; border-left: 4px solid #15803d; padding: 8px 12px; margin: 20px 0 12px; }
          .record-card { border: 1px solid #e5e7eb; border-radius: 4px; padding: 10px 14px; margin-bottom: 8px; page-break-inside: avoid; }
          .record-card.fail { border-left: 4px solid #dc2626; }
          .record-card.pass { border-left: 4px solid #16a34a; }
          .field-row { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid #f3f4f6; }
          .field-label { color: #6b7280; font-size: 10px; font-weight: 600; text-transform: uppercase; }
          .field-value { color: #111827; font-size: 11px; text-align: right; max-width: 55%; }
          .pass-badge { color: #15803d; font-weight: bold; }
          .fail-badge { color: #dc2626; font-weight: bold; }
          .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0; }
          .summary-card { border: 1px solid #d1fae5; background: #f0fdf4; border-radius: 6px; padding: 12px; text-align: center; }
          .summary-card .count { font-size: 28px; font-weight: bold; color: #14532d; }
          .summary-card .label { font-size: 10px; color: #6b7280; margin-top: 2px; }
          .sig-section { border-top: 2px solid #d1d5db; margin-top: 32px; padding-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
          .sig-line { border-bottom: 1px solid #374151; height: 40px; margin-top: 8px; }
          .sig-label { font-size: 9px; color: #9ca3af; margin-top: 6px; }
          .footer { margin-top: 20px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 9px; color: #9ca3af; display: flex; justify-content: space-between; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 6px; }
          th { background: #f9fafb; padding: 5px 8px; text-align: left; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 9px; text-transform: uppercase; }
          td { padding: 5px 8px; border-bottom: 1px solid #f3f4f6; }
          @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
        </style>
      </head>
      <body>${sections}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.document.title = fileName;
      printWindow.print();
      setLoading(false);
    };
    setTimeout(() => setLoading(false), 3000);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card text-card-foreground rounded-xl shadow-xl w-full max-w-md p-6 border border-border">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-green-700" />
            <h2 className="text-lg font-bold">Export Monthly Binder</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Month / Year selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">Month</label>
              <select
                value={month}
                onChange={e => setMonth(e.target.value)}
                className="w-full p-2 border border-border rounded-lg text-sm bg-background text-foreground"
              >
                {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">Year</label>
              <select
                value={year}
                onChange={e => setYear(e.target.value)}
                className="w-full p-2 border border-border rounded-lg text-sm bg-background text-foreground"
              >
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {/* Log type filter */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">Log Types</label>
            <select
              value={logTypeFilter}
              onChange={e => setLogTypeFilter(e.target.value)}
              className="w-full p-2 border border-border rounded-lg text-sm bg-background text-foreground"
            >
              {LOG_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Preview counts */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-xs font-semibold text-green-800 mb-3">Records for {monthLabel}</p>
            {countLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading counts…
              </div>
            ) : counts ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[
                  { label: 'Batch Logs', count: counts.batch.length, key: 'batch_log' },
                  { label: 'Sanitation', count: counts.sanitation.length, key: 'sanitation' },
                  { label: 'CCP', count: counts.ccp.length, key: 'CCP' },
                  { label: 'Temperature', count: counts.temperature.length, key: 'temperature' },
                  { label: 'Corrective Actions', count: counts.corrective.length, key: 'corrective_action' },
                ].filter(r => logTypeFilter === 'all' || r.key === logTypeFilter)
                  .map(r => (
                    <div key={r.label} className="flex justify-between">
                      <span className="text-gray-600">{r.label}</span>
                      <span className={`font-bold ${r.count > 0 ? 'text-green-700' : 'text-gray-400'}`}>{r.count}</span>
                    </div>
                  ))}
                <div className="col-span-2 border-t border-green-200 pt-2 flex justify-between font-semibold">
                  <span>Total Records</span>
                  <span className="text-green-700">{totalRecords}</span>
                </div>
              </div>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground italic">
            This will export records for {monthLabel} only. Individual log exports remain available separately.
          </p>
        </div>

        <div className="flex gap-3 mt-6">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
          <Button
            onClick={handleExport}
            disabled={loading || countLoading || totalRecords === 0}
            className="flex-1 gap-2"
          >
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : `Export Binder`}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function f(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<div class="field-row"><span class="field-label">${label}</span><span class="field-value">${value}</span></div>`;
}

function passBadge(val) {
  const v = (val || '').toLowerCase();
  if (v === 'passed' || v === 'pass') return `<span class="pass-badge">PASSED</span>`;
  if (v === 'failed' || v === 'fail') return `<span class="fail-badge">FAILED</span>`;
  return val || '—';
}

function buildBinderHTML({ counts, monthLabel, startDate, endDate, user, logTypeFilter }) {
  const now = moment().format('MMMM D, YYYY h:mm A');
  const adminName = user?.full_name || user?.email || 'Admin';
  const include = (key) => logTypeFilter === 'all' || logTypeFilter === key;

  const totalBatch = counts.batch.length;
  const totalSan = counts.sanitation.length;
  const totalCCP = counts.ccp.length;
  const totalTemp = counts.temperature.length;
  const totalCA = counts.corrective.length;
  const total = totalBatch + totalSan + totalCCP + totalTemp + totalCA;

  // Cover page
  let html = `
    <div class="page">
      <div class="header-bar">
        <h1>NuVira Juice Co.</h1>
        <p>Monthly Compliance Binder — ${monthLabel}</p>
      </div>
      <div style="margin-top: 32px;">
        ${f('Period', `${startDate} to ${endDate}`)}
        ${f('Generated', now)}
        ${f('Prepared By', adminName)}
        ${f('Total Records', String(total))}
      </div>
      <div style="margin-top: 24px; padding: 12px; background: #f9fafb; border-radius: 6px; font-size: 10px; color: #6b7280;">
        This document is an official compliance record for NuVira Juice Co. and must be retained per applicable food safety regulations.
        All records are read-only exports from the NuVira Hub system.
      </div>
      <div class="footer">
        <span>NuVira Juice Co. — Monthly Compliance Binder — ${monthLabel}</span>
        <span>Generated: ${now}</span>
      </div>
    </div>`;

  // Summary page
  html += `
    <div class="page">
      <h2>Summary — ${monthLabel}</h2>
      <div class="summary-grid">
        <div class="summary-card"><div class="count">${totalBatch}</div><div class="label">Batch Logs</div></div>
        <div class="summary-card"><div class="count">${totalSan}</div><div class="label">Sanitation Logs</div></div>
        <div class="summary-card"><div class="count">${totalCCP}</div><div class="label">CCP Logs</div></div>
        <div class="summary-card"><div class="count">${totalTemp}</div><div class="label">Temperature Logs</div></div>
        <div class="summary-card"><div class="count">${totalCA}</div><div class="label">Corrective Actions</div></div>
        <div class="summary-card"><div class="count">${total}</div><div class="label">Total Records</div></div>
      </div>
      <div class="footer">
        <span>NuVira Juice Co. — ${monthLabel}</span><span>Page 2</span>
      </div>
    </div>`;

  // Section 1: Batch Logs
  if (include('batch_log') && totalBatch > 0) {
    html += `<div class="page"><div class="section-header"><h2>Section 1 — Production Batch Compliance Logs</h2></div>`;
    counts.batch.sort((a, b) => (a.date || '') > (b.date || '') ? 1 : -1).forEach(log => {
      const pf = (log.passed_failed || '').toLowerCase();
      html += `
        <div class="record-card ${pf === 'passed' ? 'pass' : pf === 'failed' ? 'fail' : ''}">
          <h3>${log.batch_id || '—'} — ${log.juice_flavor || log.product_name || '—'}</h3>
          ${f('Production Date', log.date || log.log_date)}
          ${f('Quantity Produced', log.quantity_produced ? `${log.quantity_produced} units` : null)}
          ${f('pH Result', log.pH_result)}
          ${f('Pass / Fail', passBadge(log.passed_failed))}
          ${f('Staff on Duty', log.staff_on_duty?.join(', '))}
          ${f('Start Time', log.start_time ? moment(log.start_time).format('MMM D HH:mm') : null)}
          ${f('End Time', log.end_time ? moment(log.end_time).format('MMM D HH:mm') : null)}
          ${f('Verified By', log.verified_by)}
          ${f('Verified At', log.verified_at ? moment(log.verified_at).format('MMM D, YYYY HH:mm') : null)}
          ${log.notes ? `<div style="margin-top:6px;padding:6px;background:#fefce8;border-radius:4px;font-size:10px;color:#78350f;">Notes: ${log.notes}</div>` : ''}
          ${log.ingredients?.length ? `
            <table style="margin-top:8px;">
              <thead><tr><th>Ingredient</th><th>Qty</th><th>Unit</th><th>Lot #</th></tr></thead>
              <tbody>${log.ingredients.map(ing => `<tr><td>${ing.ingredient_name||'—'}</td><td>${ing.quantity??'—'}</td><td>${ing.unit||'—'}</td><td>${ing.lot_number||'—'}</td></tr>`).join('')}</tbody>
            </table>` : ''}
        </div>`;
    });
    html += `<div class="footer"><span>Section 1 — Batch Logs</span><span>NuVira Juice Co. — ${monthLabel}</span></div></div>`;
  }

  // Section 2: Sanitation Logs
  if (include('sanitation') && totalSan > 0) {
    html += `<div class="page"><div class="section-header"><h2>Section 2 — Sanitation Verification Logs</h2></div>`;
    counts.sanitation.sort((a, b) => (a.log_date || '') > (b.log_date || '') ? 1 : -1).forEach(log => {
      html += `
        <div class="record-card">
          <h3>${log.area || '—'} — ${log.log_date || '—'}</h3>
          ${f('Date', log.log_date)} ${f('Time', log.log_time)}
          ${f('Area / Equipment', log.area)}
          ${f('Sanitizer Type', log.sanitizer_type)}
          ${f('Sanitizer Level', log.sanitizer_level)}
          ${f('Cleaned', log.cleaned !== undefined ? (log.cleaned ? 'Yes' : 'No') : null)}
          ${f('Sanitized', log.sanitized !== undefined ? (log.sanitized ? 'Yes' : 'No') : null)}
          ${f('Staff Member', log.staff_member)}
          ${f('Verified By', log.verified_by)}
          ${f('Linked Batch ID', log.batch_id)}
          ${log.notes ? `<div style="margin-top:6px;padding:6px;background:#fefce8;border-radius:4px;font-size:10px;color:#78350f;">Notes: ${log.notes}</div>` : ''}
        </div>`;
    });
    html += `<div class="footer"><span>Section 2 — Sanitation Logs</span><span>NuVira Juice Co. — ${monthLabel}</span></div></div>`;
  }

  // Section 3: CCP Logs
  if (include('CCP') && totalCCP > 0) {
    html += `<div class="page"><div class="section-header"><h2>Section 3 — CCP Monitoring Logs</h2></div>`;
    counts.ccp.sort((a, b) => (a.log_date || '') > (b.log_date || '') ? 1 : -1).forEach(log => {
      const res = (log.result || '').toLowerCase();
      html += `
        <div class="record-card ${res === 'pass' ? 'pass' : res === 'fail' ? 'fail' : ''}">
          <h3>${log.ccp_point || '—'} — ${log.log_date || '—'}</h3>
          ${f('Date', log.log_date)} ${f('Time', log.log_time)}
          ${f('CCP Point', log.ccp_point)}
          ${f('Measurement', log.measurement)}
          ${f('Critical Limit', log.critical_limit)}
          ${f('Result', passBadge(log.result))}
          ${f('Staff Member', log.staff_member)}
          ${f('Linked Batch ID', log.batch_id)}
          ${log.notes ? `<div style="margin-top:6px;padding:6px;background:#fefce8;border-radius:4px;font-size:10px;color:#78350f;">Notes: ${log.notes}</div>` : ''}
        </div>`;
    });
    html += `<div class="footer"><span>Section 3 — CCP Logs</span><span>NuVira Juice Co. — ${monthLabel}</span></div></div>`;
  }

  // Section 4: Temperature Logs
  if (include('temperature') && totalTemp > 0) {
    html += `<div class="page"><div class="section-header"><h2>Section 4 — Temperature Logs</h2></div>`;
    counts.temperature.sort((a, b) => (a.log_date || '') > (b.log_date || '') ? 1 : -1).forEach(log => {
      html += `
        <div class="record-card">
          <h3>${log.location || 'Temperature'} — ${log.log_date || '—'}</h3>
          ${f('Date', log.log_date)} ${f('Time', log.log_time)}
          ${f('Location / Unit', log.location)}
          ${f('Temperature', log.temperature ? `${log.temperature}°` : null)}
          ${f('Within Range', log.within_range !== undefined ? (log.within_range ? 'Yes' : 'OUT OF RANGE') : null)}
          ${f('Staff Member', log.staff_member)}
          ${log.notes ? `<div style="margin-top:6px;padding:6px;background:#fefce8;border-radius:4px;font-size:10px;color:#78350f;">Notes: ${log.notes}</div>` : ''}
        </div>`;
    });
    html += `<div class="footer"><span>Section 4 — Temperature Logs</span><span>NuVira Juice Co. — ${monthLabel}</span></div></div>`;
  }

  // Section 5: Corrective Actions
  if (include('corrective_action') && totalCA > 0) {
    html += `<div class="page"><div class="section-header"><h2>Section 5 — Corrective Actions</h2></div>`;
    counts.corrective.sort((a, b) => (a.log_date || '') > (b.log_date || '') ? 1 : -1).forEach(log => {
      html += `
        <div class="record-card fail">
          <h3>${log.issue_type || 'Corrective Action'} — ${log.log_date || '—'}</h3>
          ${f('Date', log.log_date)} ${f('Time', log.log_time)}
          ${f('Issue Type', log.issue_type)}
          ${f('Issue Description', log.issue_description)}
          ${f('Action Taken', log.corrective_action_taken)}
          ${f('Status', log.status)}
          ${f('Staff Member', log.staff_member)}
          ${f('Verified By', log.verified_by)}
          ${log.notes ? `<div style="margin-top:6px;padding:6px;background:#fefce8;border-radius:4px;font-size:10px;color:#78350f;">Notes: ${log.notes}</div>` : ''}
        </div>`;
    });
    html += `<div class="footer"><span>Section 5 — Corrective Actions</span><span>NuVira Juice Co. — ${monthLabel}</span></div></div>`;
  }

  // Final signature page
  html += `
    <div class="page">
      <div class="section-header"><h2>Monthly Review &amp; Verification</h2></div>
      <div style="margin-top:16px;">
        ${f('Month', monthLabel)}
        ${f('Total Records Reviewed', String(total))}
        ${f('Review Date', '')}
      </div>
      <div style="margin-top:20px;font-size:11px;color:#374151;">
        <p>I confirm that the compliance records for ${monthLabel} have been reviewed and are accurate to the best of my knowledge.</p>
      </div>
      <div class="sig-section">
        <div>
          <p style="font-size:10px;color:#6b7280;">Prepared By (Staff)</p>
          <div class="sig-line"></div>
          <p class="sig-label">Name: ________________________________ Date: ___________</p>
        </div>
        <div>
          <p style="font-size:10px;color:#6b7280;">Reviewed &amp; Approved (Manager)</p>
          <div class="sig-line"></div>
          <p class="sig-label">Name: ________________________________ Date: ___________</p>
        </div>
      </div>
      <div class="footer" style="margin-top:40px;">
        <span>NuVira Juice Co. — Official Compliance Record — Retain per food safety regulations</span>
        <span>Generated: ${now}</span>
      </div>
    </div>`;

  return html;
}