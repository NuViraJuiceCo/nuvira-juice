import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Printer, Download, FileText } from 'lucide-react';
import moment from 'moment';
import { resolveIngredients } from '@/lib/batchIngredientResolver';

// Normalize product names so variations group together
function normalizeProduct(name) {
  if (!name) return 'Unknown';
  return name
    .replace(/\s+/g, ' ')
    .replace(/re[\s-]?nu/i, 'Re-Nu')
    .trim();
}

function calcSummary(logs) {
  const pHValues = logs.map(l => parseFloat(l.pH_result)).filter(v => !isNaN(v));
  const passed = logs.filter(l => (l.passed_failed || '').toLowerCase() === 'passed');
  const failed = logs.filter(l => (l.passed_failed || '').toLowerCase() === 'failed');
  const corrective = logs.filter(l => l.corrective_action_required || (l.notes || '').toLowerCase().includes('corrective'));
  const allStaff = [...new Set(logs.flatMap(l => l.staff_on_duty || []))].filter(Boolean);
  const dates = logs.map(l => l.date || l.log_date).filter(Boolean).sort();

  return {
    count: logs.length,
    totalQty: logs.reduce((s, l) => s + (parseInt(l.quantity_produced) || 0), 0),
    avgPH: pHValues.length ? (pHValues.reduce((s, v) => s + v, 0) / pHValues.length).toFixed(2) : '—',
    passed: passed.length,
    failed: failed.length,
    corrective: corrective.length,
    staff: allStaff,
    firstDate: dates[0] || '',
    lastDate: dates[dates.length - 1] || '',
    allVerified: logs.every(l => l.verified_by || l.locked),
  };
}

function exportProductMonthPDF(productName, monthLabel, logs) {
  const now = moment().format('MMMM D, YYYY h:mm A');
  const summary = calcSummary(logs);
  const fileName = `NuVira_${productName.replace(/\s+/g, '-')}_BatchLogs_${monthLabel.replace(' ', '_')}`;

  const logsHTML = logs
    .sort((a, b) => (a.date || '') > (b.date || '') ? 1 : -1)
    .map(log => {
      const pf = (log.passed_failed || '').toLowerCase();
      return `
      <div style="border:1px solid #e5e7eb;border-left:4px solid ${pf === 'passed' ? '#16a34a' : pf === 'failed' ? '#dc2626' : '#d1d5db'};border-radius:4px;padding:10px 14px;margin-bottom:10px;page-break-inside:avoid;">
        <div style="font-weight:bold;font-size:12px;margin-bottom:6px;">${log.batch_id || '—'} — ${moment(log.date || log.log_date).format('MMMM D, YYYY')}</div>
        ${row('Quantity Produced', log.quantity_produced ? `${log.quantity_produced} units` : '—')}
        ${row('pH Result', log.pH_result ?? '—')}
        ${row('Pass / Fail', `<span style="font-weight:bold;color:${pf === 'passed' ? '#16a34a' : pf === 'failed' ? '#dc2626' : '#374151'}">${(log.passed_failed || '').toUpperCase()}</span>`)}
        ${row('Staff on Duty', log.staff_on_duty?.join(', ') || '—')}
        ${row('Start Time', log.start_time ? moment(log.start_time).format('MMM D HH:mm') : '—')}
        ${row('End Time', log.end_time ? moment(log.end_time).format('MMM D HH:mm') : '—')}
        ${row('Verified By', log.verified_by || '—')}
        ${row('Verified At', log.verified_at ? moment(log.verified_at).format('MMM D, YYYY HH:mm') : '—')}
        ${log.notes ? `<div style="margin-top:6px;padding:6px;background:#fefce8;border-radius:4px;font-size:10px;color:#78350f;">Notes: ${log.notes}</div>` : ''}
        ${(() => {
          const { ingredients, source, lotNotes } = resolveIngredients(log);
          const hasQty = ingredients?.some(i => i.quantity || i.quantity_oz);
          if (!ingredients?.length) {
            return `<div style="margin-top:8px;padding:5px 8px;background:#fffbeb;border:1px solid #fcd34d;border-radius:4px;font-size:10px;color:#92400e;">⚠️ Formula not found — manual review required</div>`;
          }
          return `<div style="margin-top:8px;">
            <div style="font-size:9px;font-weight:bold;color:#6b7280;text-transform:uppercase;margin-bottom:4px;">Ingredients Used${source ? ` (${source})` : ''}</div>
            <table style="width:100%;border-collapse:collapse;font-size:10px;">
              <thead><tr style="background:#f9fafb;">
                <th style="text-align:left;padding:3px 6px;border-bottom:1px solid #e5e7eb;">Ingredient</th>
                ${hasQty ? '<th style="text-align:left;padding:3px 6px;border-bottom:1px solid #e5e7eb;">Qty</th><th style="text-align:left;padding:3px 6px;border-bottom:1px solid #e5e7eb;">Unit</th>' : ''}
                <th style="text-align:left;padding:3px 6px;border-bottom:1px solid #e5e7eb;">Lot #</th>
              </tr></thead>
              <tbody>${ingredients.map(ing => `<tr>
                <td style="padding:3px 6px;">${ing.ingredient_name || '—'}</td>
                ${hasQty ? `<td style="padding:3px 6px;">${ing.quantity ?? ing.quantity_oz ?? '—'}</td><td style="padding:3px 6px;">${ing.unit || '—'}</td>` : ''}
                <td style="padding:3px 6px;">${ing.lot_number || '—'}</td>
              </tr>`).join('')}</tbody>
            </table>
            ${lotNotes ? `<div style="margin-top:4px;font-size:9px;color:#6b7280;">Lot/Source Notes: ${lotNotes}</div>` : ''}
          </div>`;
        })()}
      </div>`;
    }).join('');

  const html = `<!DOCTYPE html><html><head><title>${fileName}</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:Arial,sans-serif; font-size:11px; color:#1a1a1a; padding:28px; }
      @media print { body { print-color-adjust:exact; -webkit-print-color-adjust:exact; } }
    </style></head><body>
    <div style="background:#14532d;color:white;padding:16px 20px;margin:-28px -28px 20px;border-radius:0;">
      <div style="font-size:20px;font-weight:bold;">NuVira Juice Co.</div>
      <div style="font-size:12px;color:#bbf7d0;margin-top:2px;">Batch Compliance Logs — ${productName} — ${monthLabel}</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px;">
      ${statBox('Batches', summary.count)}
      ${statBox('Total Units', summary.totalQty)}
      ${statBox('Avg pH', summary.avgPH)}
      ${statBox('Passed', summary.passed, '#16a34a')}
      ${statBox('Failed', summary.failed, '#dc2626')}
      ${statBox('Corrective', summary.corrective, summary.corrective > 0 ? '#d97706' : '#6b7280')}
    </div>
    ${logsHTML}
    <div style="margin-top:32px;padding-top:20px;border-top:2px solid #d1d5db;display:grid;grid-template-columns:1fr 1fr;gap:40px;">
      <div><p style="font-size:10px;color:#6b7280;">Reviewed By (Manager)</p>
        <div style="border-bottom:1px solid #374151;height:36px;margin-top:8px;"></div>
        <p style="font-size:9px;color:#9ca3af;margin-top:4px;">Name: _______________________ Date: __________</p>
      </div>
      <div><p style="font-size:10px;color:#6b7280;">Approved By (Owner/Admin)</p>
        <div style="border-bottom:1px solid #374151;height:36px;margin-top:8px;"></div>
        <p style="font-size:9px;color:#9ca3af;margin-top:4px;">Name: _______________________ Date: __________</p>
      </div>
    </div>
    <div style="margin-top:16px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:9px;color:#9ca3af;display:flex;justify-content:space-between;">
      <span>NuVira Juice Co. — Official Compliance Record</span><span>Generated: ${now}</span>
    </div>
  </body></html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.document.title = fileName; win.print(); };
}

function row(label, value) {
  return `<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #f3f4f6;font-size:10px;">
    <span style="color:#6b7280;font-weight:600;text-transform:uppercase;font-size:9px;">${label}</span>
    <span>${value}</span>
  </div>`;
}

function statBox(label, value, color = '#14532d') {
  return `<div style="border:1px solid #d1fae5;background:#f0fdf4;border-radius:6px;padding:10px;text-align:center;">
    <div style="font-size:22px;font-weight:bold;color:${color};">${value}</div>
    <div style="font-size:9px;color:#6b7280;margin-top:2px;">${label}</div>
  </div>`;
}

// ── Product Group Card ──────────────────────────────────────────────────────

function ProductGroupCard({ productName, logs, monthLabel, onPrintLog }) {
  const [expanded, setExpanded] = useState(false);
  const summary = calcSummary(logs);
  const hasFailed = summary.failed > 0;

  return (
    <div className={`border rounded-xl overflow-hidden ${hasFailed ? 'border-red-200' : 'border-border'}`}>
      {/* Header */}
      <div
        className={`flex items-center justify-between px-4 py-3 cursor-pointer select-none ${hasFailed ? 'bg-red-50' : 'bg-muted/30'}`}
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: hasFailed ? '#dc2626' : '#16a34a' }} />
          <div>
            <h3 className="font-semibold text-sm">{productName} <span className="text-muted-foreground font-normal">— {monthLabel}</span></h3>
            <div className="flex flex-wrap gap-3 mt-0.5 text-xs text-muted-foreground">
              <span>{summary.count} batch{summary.count !== 1 ? 'es' : ''}</span>
              <span>{summary.totalQty} units</span>
              <span>Avg pH: {summary.avgPH}</span>
              <span className="text-green-700 font-medium">{summary.passed} passed</span>
              {summary.failed > 0 && <span className="text-red-700 font-medium">{summary.failed} failed</span>}
              {summary.corrective > 0 && <span className="text-cyan-700 font-medium">{summary.corrective} corrective</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs hidden sm:flex"
            onClick={e => { e.stopPropagation(); exportProductMonthPDF(productName, monthLabel, logs); }}
          >
            <Download className="w-3.5 h-3.5" />
            Export {productName}
          </Button>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {/* Summary stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
        {[
          { label: 'Batches', value: summary.count, color: '' },
          { label: 'Total Units', value: summary.totalQty, color: '' },
          { label: 'Passed', value: summary.passed, color: 'text-green-700' },
          { label: 'Failed', value: summary.failed, color: summary.failed > 0 ? 'text-red-700' : 'text-muted-foreground' },
        ].map(s => (
          <div key={s.label} className="bg-card px-4 py-2 text-center">
            <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Mobile export button */}
      <div className="sm:hidden px-4 py-2 border-t bg-card">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs w-full"
          onClick={() => exportProductMonthPDF(productName, monthLabel, logs)}
        >
          <Download className="w-3.5 h-3.5" />
          Export {productName} {monthLabel} Logs
        </Button>
      </div>

      {/* Expanded individual logs */}
      {expanded && (
        <div className="border-t bg-card divide-y divide-border">
          {logs.sort((a, b) => (a.date || '') > (b.date || '') ? 1 : -1).map(log => {
            const pf = (log.passed_failed || '').toLowerCase();
            const isPassed = pf === 'passed';
            const isFailed = pf === 'failed';
            return (
              <div key={log.id} className={`px-4 py-3 flex items-start justify-between gap-4 ${isFailed ? 'bg-red-50/50' : ''}`}>
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  {isPassed
                    ? <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                    : isFailed
                    ? <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                    : <FileText className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{log.batch_id || '—'}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
                      <span>{moment(log.date || log.log_date).format('MMM D, YYYY')}</span>
                      <span>{log.quantity_produced ? `${log.quantity_produced} units` : '—'}</span>
                      <span>pH: {log.pH_result ?? '—'}</span>
                      {log.staff_on_duty?.length > 0 && <span>Staff: {log.staff_on_duty.join(', ')}</span>}
                      {log.verified_by && <span className="text-green-700">✓ Verified</span>}
                    </div>
                    {log.notes && <p className="text-xs text-muted-foreground mt-1 italic">📝 {log.notes}</p>}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs shrink-0"
                  onClick={() => onPrintLog({ ...log, source: 'production_batch' })}
                >
                  <Printer className="w-3.5 h-3.5" />
                  Export Log
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

const MONTHS = moment.months().map((m, i) => ({ value: String(i + 1).padStart(2, '0'), label: m }));
const YEARS = Array.from({ length: 5 }, (_, i) => String(moment().year() - 2 + i));

export default function BatchLogsGrouped({ batchLogs, onPrintLog }) {
  const [month, setMonth] = useState(moment().format('MM'));
  const [year, setYear] = useState(moment().format('YYYY'));
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCorrective, setFilterCorrective] = useState('all');

  const startDate = `${year}-${month}-01`;
  const endDate = moment(startDate).endOf('month').format('YYYY-MM-DD');
  const monthLabel = moment(startDate).format('MMMM YYYY');

  // Filter to selected month
  const monthLogs = useMemo(() => {
    return (batchLogs || []).filter(l => {
      const d = l.date || l.log_date || '';
      return d >= startDate && d <= endDate;
    });
  }, [batchLogs, startDate, endDate]);

  // Apply search + status + corrective filters
  const filtered = useMemo(() => {
    return monthLogs.filter(l => {
      if (search && !(l.batch_id || '').toLowerCase().includes(search.toLowerCase())
        && !(normalizeProduct(l.juice_flavor || l.product_name)).toLowerCase().includes(search.toLowerCase())) return false;
      if (filterStatus === 'passed' && (l.passed_failed || '').toLowerCase() !== 'passed') return false;
      if (filterStatus === 'failed' && (l.passed_failed || '').toLowerCase() !== 'failed') return false;
      if (filterCorrective === 'yes' && !l.corrective_action_required && !(l.notes || '').toLowerCase().includes('corrective')) return false;
      return true;
    });
  }, [monthLogs, search, filterStatus, filterCorrective]);

  // Group by normalized product name
  const groups = useMemo(() => {
    const map = {};
    filtered.forEach(l => {
      const key = normalizeProduct(l.juice_flavor || l.product_name);
      if (!map[key]) map[key] = [];
      map[key].push(l);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const handleExportAllBatchLogs = () => {
    if (monthLogs.length === 0) {
      alert('No batch logs for the selected month.');
      return;
    }
    // Export all products in one PDF — grouped
    const now = moment().format('MMMM D, YYYY h:mm A');
    const fileName = `NuVira_AllBatchLogs_${monthLabel.replace(' ', '_')}`;

    const groupsHTML = Object.entries(
      monthLogs.reduce((acc, l) => {
        const k = normalizeProduct(l.juice_flavor || l.product_name);
        (acc[k] = acc[k] || []).push(l);
        return acc;
      }, {})
    ).sort(([a], [b]) => a.localeCompare(b)).map(([prod, logs]) => {
      const s = calcSummary(logs);
      return `
        <div style="margin-bottom:28px;page-break-inside:avoid;">
          <div style="background:#f0fdf4;border-left:4px solid #15803d;padding:8px 12px;margin-bottom:10px;">
            <div style="font-size:14px;font-weight:bold;color:#14532d;">${prod}</div>
            <div style="font-size:10px;color:#6b7280;margin-top:2px;">
              ${s.count} batches · ${s.totalQty} units · Avg pH: ${s.avgPH} · ${s.passed} passed · ${s.failed} failed
            </div>
          </div>
          ${logs.sort((a, b) => (a.date || '') > (b.date || '') ? 1 : -1).map(log => {
            const pf = (log.passed_failed || '').toLowerCase();
            const { ingredients, source } = resolveIngredients(log);
            const ingLine = ingredients?.length
              ? ingredients.map(i => i.ingredient_name).join(', ')
              : '⚠️ Formula not found';
            return `<div style="border:1px solid #e5e7eb;border-left:3px solid ${pf === 'passed' ? '#16a34a' : pf === 'failed' ? '#dc2626' : '#d1d5db'};border-radius:4px;padding:8px 12px;margin-bottom:6px;font-size:10px;">
              <strong>${log.batch_id || '—'}</strong> — ${moment(log.date || log.log_date).format('MMM D, YYYY')} &nbsp;|&nbsp; ${log.quantity_produced ?? '—'} units &nbsp;|&nbsp; pH: ${log.pH_result ?? '—'} &nbsp;|&nbsp; <span style="font-weight:bold;color:${pf === 'passed' ? '#16a34a' : '#dc2626'}">${(log.passed_failed || '').toUpperCase()}</span>
              ${log.staff_on_duty?.length ? `<br><span style="color:#6b7280;">Staff: ${log.staff_on_duty.join(', ')}</span>` : ''}
              <br><span style="color:#374151;">Ingredients (${source || 'lookup'}): ${ingLine}</span>
            </div>`;
          }).join('')}
        </div>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><title>${fileName}</title>
      <style>* {margin:0;padding:0;box-sizing:border-box;} body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:28px;} @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact;}}</style>
      </head><body>
      <div style="background:#14532d;color:white;padding:16px 20px;margin:-28px -28px 20px;">
        <div style="font-size:20px;font-weight:bold;">NuVira Juice Co.</div>
        <div style="font-size:12px;color:#bbf7d0;margin-top:2px;">All Batch Compliance Logs — ${monthLabel}</div>
      </div>
      ${groupsHTML}
      <div style="margin-top:16px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:9px;color:#9ca3af;display:flex;justify-content:space-between;">
        <span>NuVira Juice Co. — Official Compliance Record</span><span>Generated: ${now}</span>
      </div>
    </body></html>`;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.onload = () => { win.document.title = fileName; win.print(); };
  };

  return (
    <div className="space-y-4">
      {/* Month/Year selector + export */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">Month</label>
          <select value={month} onChange={e => setMonth(e.target.value)} className="p-2 border rounded-lg text-sm bg-background">
            {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">Year</label>
          <select value={year} onChange={e => setYear(e.target.value)} className="p-2 border rounded-lg text-sm bg-background">
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleExportAllBatchLogs}
            disabled={monthLogs.length === 0}
          >
            <Download className="w-4 h-4" />
            Export All {monthLabel} Batches
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search batch ID or product…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] p-2 border rounded-lg text-sm bg-background"
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="p-2 border rounded-lg text-sm bg-background">
          <option value="all">All Status</option>
          <option value="passed">Passed Only</option>
          <option value="failed">Failed Only</option>
        </select>
        <select value={filterCorrective} onChange={e => setFilterCorrective(e.target.value)} className="p-2 border rounded-lg text-sm bg-background">
          <option value="all">All Batches</option>
          <option value="yes">Corrective Action Only</option>
        </select>
      </div>

      {/* Summary count */}
      <div className="text-xs text-muted-foreground">
        {groups.length > 0
          ? `${groups.length} product${groups.length !== 1 ? 's' : ''} · ${filtered.length} log${filtered.length !== 1 ? 's' : ''} for ${monthLabel}`
          : `No batch logs found for ${monthLabel}`}
      </div>

      {/* Product groups */}
      {groups.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-xl">
          <p className="text-base font-medium">No batch compliance logs for {monthLabel}</p>
          <p className="text-sm mt-1">Batches are added here after Verify & Log is completed in Production.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(([productName, logs]) => (
            <ProductGroupCard
              key={productName}
              productName={productName}
              logs={logs}
              monthLabel={monthLabel}
              onPrintLog={onPrintLog}
            />
          ))}
        </div>
      )}
    </div>
  );
}
