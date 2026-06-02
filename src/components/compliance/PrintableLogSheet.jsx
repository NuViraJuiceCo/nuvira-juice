import React from 'react';
import moment from 'moment';
import { resolveIngredients } from '@/lib/batchIngredientResolver';

const LOG_TITLES = {
  temperature: 'Temperature Log',
  pH: 'pH Monitoring Log',
  CCP: 'Critical Control Point (CCP) Log',
  sanitation: 'Sanitation Verification Log',
  corrective_action: 'Corrective Action Log',
  daily_checklist: 'Daily Checklist Log',
  batch_log: 'Batch Production Compliance Log',
};

function buildFileName(log) {
  const isBatch = log.source === 'production_batch';
  const logType = isBatch ? 'BatchCompliance' : (log.log_type || 'Log').replace(/_/g, '');
  const product = (log.juice_flavor || log.product_name || log.area || 'Unknown').replace(/\s+/g, '-');
  const date = log.log_date || log.date || moment().format('YYYY-MM-DD');
  const ref = log.batch_id || log.id?.slice(0, 8) || 'REF';
  return `NuVira_ComplianceLog_${logType}_${product}_${date}_${ref}`;
}

function Section({ title, children }) {
  return (
    <div className="mb-5">
      <div className="bg-gray-100 border-l-4 border-green-700 px-3 py-1 mb-2">
        <p className="text-xs font-bold uppercase text-green-900 tracking-wide">{title}</p>
      </div>
      <div className="px-2 space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, value, highlight }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex justify-between items-start border-b border-gray-100 pb-1.5 text-sm">
      <span className="text-gray-500 font-medium w-48 shrink-0">{label}</span>
      <span className={`text-right font-medium ${highlight === 'pass' ? 'text-green-700' : highlight === 'fail' ? 'text-red-700' : 'text-gray-800'}`}>
        {String(value)}
      </span>
    </div>
  );
}

export default function PrintableLogSheet({ log, onClose }) {
  if (!log) return null;

  const isBatch = log.source === 'production_batch';
  const title = isBatch ? LOG_TITLES.batch_log : (LOG_TITLES[log.log_type] || 'Compliance Log');
  const date = log.log_date || log.date || '';
  const staffMember = log.staff_member || log.verified_by?.split('@')[0] || '—';
  const passFail = log.passed_failed || log.status || '';
  const fileName = buildFileName(log);

  const handlePrint = () => {
    const originalTitle = document.title;
    document.title = fileName;
    window.print();
    document.title = originalTitle;
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 overflow-y-auto">
      {/* Screen controls */}
      <div className="print:hidden w-full max-w-2xl mb-3 flex items-center justify-between">
        <div>
          <p className="text-white text-sm font-medium">Preview — Individual Record Export</p>
          <p className="text-white/60 text-xs">Only this selected log will be exported.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
            ✕ Close
          </button>
          <button onClick={handlePrint} className="px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-medium hover:bg-green-800">
            🖨️ Export PDF / Print
          </button>
        </div>
      </div>

      {/* Printable sheet */}
      <div
        id="printable-log"
        className="bg-white w-full max-w-2xl rounded-lg shadow-xl p-8 print:shadow-none print:rounded-none print:p-6 print:max-w-full"
        style={{ fontFamily: 'Arial, sans-serif' }}
      >
        {/* Branding Header */}
        <div className="border-b-4 border-green-700 pb-4 mb-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-green-800">NuVira Juice Co.</h1>
              <h2 className="text-base font-semibold text-gray-700 mt-0.5">{title}</h2>
              <p className="text-xs text-gray-400 mt-1">Official Compliance Record — Retain per food safety regulations</p>
            </div>
            <div className="text-right">
              <p className="font-bold text-gray-800">{moment(date).format('MMMM D, YYYY')}</p>
              {log.log_time && <p className="text-sm text-gray-500">{log.log_time}</p>}
              <p className="text-xs text-gray-400 mt-1">Record ID: {log.id?.slice(0, 12)}</p>
            </div>
          </div>
        </div>

        {/* ── BATCH COMPLIANCE LOG ── */}
        {isBatch && (
          <>
            <Section title="Batch Information">
              <Field label="Batch ID" value={log.batch_id} />
              <Field label="Product / Flavor" value={log.juice_flavor || log.product_name} />
              <Field label="Production Date" value={moment(log.date || log.log_date).format('MMMM D, YYYY')} />
              <Field label="Quantity Produced" value={log.quantity_produced ? `${log.quantity_produced} units` : null} />
            </Section>

            <Section title="Quality Control">
              <Field label="pH Result" value={log.pH_result} />
              <Field
                label="Pass / Fail"
                value={(log.passed_failed || '').toUpperCase()}
                highlight={log.passed_failed === 'passed' ? 'pass' : log.passed_failed === 'failed' ? 'fail' : null}
              />
            </Section>

            <Section title="Production Times & Staff">
              <Field label="Start Time" value={log.start_time ? moment(log.start_time).format('MMM D, YYYY HH:mm') : null} />
              <Field label="End Time" value={log.end_time ? moment(log.end_time).format('MMM D, YYYY HH:mm') : null} />
              <Field label="Staff on Duty" value={log.staff_on_duty?.length ? log.staff_on_duty.join(', ') : null} />
            </Section>

            {(() => {
              const { ingredients, source, lotNotes } = resolveIngredients(log);
              const hasQty = ingredients?.some(i => i.quantity || i.quantity_oz);
              return (
                <>
                  <Section title="Ingredients Used">
                    {ingredients?.length > 0 ? (
                      <>
                        <table className="w-full text-sm border border-gray-200 rounded">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-2 py-1.5 text-xs text-gray-500 font-semibold">Ingredient</th>
                              {hasQty && <th className="text-left px-2 py-1.5 text-xs text-gray-500 font-semibold">Qty</th>}
                              {hasQty && <th className="text-left px-2 py-1.5 text-xs text-gray-500 font-semibold">Unit</th>}
                              <th className="text-left px-2 py-1.5 text-xs text-gray-500 font-semibold">Lot #</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ingredients.map((ing, i) => (
                              <tr key={i} className="border-t border-gray-100">
                                <td className="px-2 py-1">{ing.ingredient_name || '—'}</td>
                                {hasQty && <td className="px-2 py-1">{ing.quantity ?? ing.quantity_oz ?? '—'}</td>}
                                {hasQty && <td className="px-2 py-1">{ing.unit ?? '—'}</td>}
                                <td className="px-2 py-1">{ing.lot_number ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {source && (
                          <p className="text-xs text-gray-400 mt-1.5 italic">Formula source: {source}</p>
                        )}
                      </>
                    ) : (
                      <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                        ⚠️ Formula not found — manual review required
                      </div>
                    )}
                  </Section>
                  {lotNotes && (
                    <Section title="Ingredient Lot / Source Notes">
                      <p className="text-sm text-gray-700 whitespace-pre-line">{lotNotes}</p>
                    </Section>
                  )}
                </>
              );
            })()}

            <Section title="Verification">
              <Field label="Verified By" value={log.verified_by} />
              <Field label="Verified At" value={log.verified_at ? moment(log.verified_at).format('MMM D, YYYY HH:mm') : null} />
              <Field label="Locked" value={log.locked ? 'Yes — Record Immutable' : 'No'} />
              {log.source_production_batch_id && <Field label="Source Batch Record" value={log.source_production_batch_id} />}
            </Section>
          </>
        )}

        {/* ── CCP LOG ── */}
        {!isBatch && log.ccp_point && (
          <>
            <Section title="CCP Details">
              <Field label="CCP Point" value={log.ccp_point} />
              <Field label="Measurement" value={log.measurement} />
              <Field label="Critical Limit" value={log.critical_limit} />
              <Field
                label="Result"
                value={(log.result || '').toUpperCase()}
                highlight={log.result === 'Pass' ? 'pass' : log.result === 'Fail' ? 'fail' : null}
              />
              <Field label="Batch ID" value={log.batch_id} />
              <Field label="Staff Member" value={staffMember} />
            </Section>
          </>
        )}

        {/* ── SANITATION LOG ── */}
        {!isBatch && log.area && (
          <>
            <Section title="Sanitation Details">
              <Field label="Area / Equipment" value={log.area} />
              <Field label="Sanitizer Type" value={log.sanitizer_type} />
              <Field label="Sanitizer Level" value={log.sanitizer_level} />
              <Field label="Cleaned" value={log.cleaned !== undefined ? (log.cleaned ? 'Yes' : 'No') : null} />
              <Field label="Sanitized" value={log.sanitized !== undefined ? (log.sanitized ? 'Yes' : 'No') : null} />
              <Field label="Staff Member" value={staffMember} />
              <Field label="Verified By" value={log.verified_by} />
              <Field label="Linked Batch ID" value={log.batch_id} />
            </Section>
          </>
        )}

        {/* ── CORRECTIVE ACTION LOG ── */}
        {!isBatch && log.issue_description && (
          <>
            <Section title="Corrective Action">
              <Field label="Issue Type" value={log.issue_type} />
              <Field label="Issue Description" value={log.issue_description} />
              <Field label="Action Taken" value={log.corrective_action_taken} />
              <Field
                label="Status"
                value={(log.status || '').toUpperCase()}
                highlight={log.status === 'Completed' ? 'pass' : null}
              />
              <Field label="Staff Member" value={staffMember} />
              <Field label="Verified By" value={log.verified_by} />
            </Section>
          </>
        )}

        {/* ── GENERIC / TEMPERATURE / PH / OTHER ── */}
        {!isBatch && !log.ccp_point && !log.area && !log.issue_description && (
          <Section title="Log Details">
            <Field label="Staff Member" value={staffMember} />
            <Field label="Shift" value={log.shift} />
            <Field
              label="Status / Result"
              value={(passFail || '').toUpperCase()}
              highlight={passFail === 'passed' || passFail === 'pass' ? 'pass' : passFail === 'failed' || passFail === 'fail' ? 'fail' : null}
            />
            {log.temperature && <Field label="Temperature" value={`${log.temperature}°`} />}
            {log.location && <Field label="Location" value={log.location} />}
            {log.pH_result && <Field label="pH Result" value={log.pH_result} />}
          </Section>
        )}

        {/* Notes */}
        {log.notes && (
          <div className="mb-5 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">
            <p className="font-semibold text-gray-700 mb-1">Notes</p>
            <p className="text-gray-600">{log.notes}</p>
          </div>
        )}

        {/* Signature Lines */}
        <div className="mt-8 pt-5 border-t-2 border-gray-300 grid grid-cols-2 gap-10">
          <div>
            <p className="text-xs text-gray-500 mb-1">Staff Signature / Initials</p>
            <div className="w-full h-10 border-b border-gray-400 mt-4"></div>
            <p className="text-xs text-gray-400 mt-1.5">Print Name: ________________________  Date: __________</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Manager / Supervisor Verification</p>
            <div className="w-full h-10 border-b border-gray-400 mt-4"></div>
            <p className="text-xs text-gray-400 mt-1.5">Print Name: ________________________  Date: __________</p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-gray-200 text-xs text-gray-400 flex justify-between">
          <span>Record ID: {log.id}</span>
          <span>Generated: {moment().format('MMM D, YYYY HH:mm')} — NuVira Juice Co. — Official Compliance Record</span>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #printable-log, #printable-log * { visibility: visible; }
          #printable-log { position: fixed; left: 0; top: 0; width: 100%; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
}