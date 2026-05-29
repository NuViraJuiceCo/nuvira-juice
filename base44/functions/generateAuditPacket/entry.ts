import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { jsPDF } from 'npm:jspdf@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const {
      start_date,
      end_date,
      log_types = [
        'temperature',
        'pH',
        'CCP',
        'sanitation',
        'corrective',
        'daily_checklist',
        'batch',
        'haccp',
        'label_allergen',
      ],
    } = await req.json();

    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Fetch all logs for date range
    const [
      tempLogs,
      phLogs,
      ccpLogs,
      sanitationLogs,
      correctiveLogs,
      dailyChecklists,
      batchComplianceLogs,
      haccpReviews,
      labelAllergenReviews,
    ] = await Promise.all([
      log_types.includes('temperature') ? base44.asServiceRole.entities.TemperatureLog.list('-log_date', 500) : [],
      log_types.includes('pH') ? base44.asServiceRole.entities.pHLog.list('-log_date', 500) : [],
      log_types.includes('CCP') ? base44.asServiceRole.entities.CCPLog.list('-log_date', 500) : [],
      log_types.includes('sanitation') ? base44.asServiceRole.entities.SanitationLog.list('-log_date', 500) : [],
      log_types.includes('corrective') ? base44.asServiceRole.entities.CorrectiveActionLog.list('-log_date', 500) : [],
      log_types.includes('daily_checklist') ? base44.asServiceRole.entities.DailyChecklist.list('-checklist_date', 500) : [],
      log_types.includes('batch') ? base44.asServiceRole.entities.BatchComplianceLog.list('-date', 500) : [],
      log_types.includes('haccp') ? base44.asServiceRole.entities.HACCPPlanReview.list('-review_date', 500) : [],
      log_types.includes('label_allergen') ? base44.asServiceRole.entities.LabelAllergenReview.list('-review_date', 500) : [],
    ]);

    // Filter by date range
    const filterByDate = (logs, dateFields = ['log_date', 'checklist_date', 'date', 'review_date']) => logs.filter(log => {
      const logDate = dateFields.map(field => log[field]).find(Boolean);
      return logDate >= start_date && logDate <= end_date;
    });

    const filtered = {
      temperature: filterByDate(tempLogs),
      pH: filterByDate(phLogs),
      CCP: filterByDate(ccpLogs),
      sanitation: filterByDate(sanitationLogs),
      corrective: filterByDate(correctiveLogs),
      daily_checklist: filterByDate(dailyChecklists),
      batch: filterByDate(batchComplianceLogs),
      haccp: filterByDate(haccpReviews),
      label_allergen: filterByDate(labelAllergenReviews),
    };

    // Create PDF
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210;
    const margin = 18;
    let y = 20;

    // Header
    doc.setFillColor(22, 101, 52);
    doc.rect(0, 0, W, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('NuVira Compliance Audit Packet', margin, 15);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`${start_date} to ${end_date}`, margin, 28);
    doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 35);

    doc.setTextColor(40, 40, 40);
    y = 50;

    const addSection = (title, logs) => {
      if (y > 250) doc.addPage();
      doc.setFillColor(240, 253, 244);
      doc.rect(margin - 2, y - 5, W - margin * 2 + 4, 10, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(22, 101, 52);
      doc.text(title, margin, y);
      y += 12;

      if (logs.length === 0) {
        doc.setFontSize(10);
        doc.setTextColor(160, 160, 160);
        doc.text('No entries for this period', margin + 5, y);
        y += 8;
        return;
      }

      logs.forEach(log => {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }
        doc.setFontSize(9);
        doc.setTextColor(40, 40, 40);
        const logDate = log.log_date || log.checklist_date;
        doc.text(`${logDate} ${log.log_time || ''} — ${log.staff_member || log.checklist_member || 'N/A'}`, margin + 3, y);
        y += 5;

        let details = '';
        if (log.location) details += `Location: ${log.location} | `;
        if (log.temperature) details += `Temp: ${log.temperature}°C | `;
        if (log.batch_id) details += `Batch: ${log.batch_id} | `;
        if (log.product_name) details += `Product: ${log.product_name} | `;
        if (log.juice_flavor) details += `Flavor: ${log.juice_flavor} | `;
        if (log.shift) details += `Shift: ${log.shift} | `;
        if (log.overall_status) details += `Status: ${log.overall_status} | `;
        if (log.approval_status) details += `Approval: ${log.approval_status} | `;
        if (log.result) details += `Result: ${log.result} | `;
        if (log.passed_failed) details += `Batch Result: ${log.passed_failed} | `;
        if (log.within_range !== undefined) details += `Range: ${log.within_range ? 'OK' : 'OUT OF RANGE'} | `;

        if (details) {
          doc.setFontSize(8);
          doc.setTextColor(100, 100, 100);
          doc.text(details.slice(0, -3), margin + 5, y);
          y += 4;
        }

        if (log.notes) {
          doc.setFontSize(8);
          doc.setTextColor(120, 120, 120);
          const wrapped = doc.splitTextToSize(`Notes: ${log.notes}`, W - margin * 2 - 8);
          doc.text(wrapped, margin + 5, y);
          y += wrapped.length * 3;
        }

        y += 3;
      });

      y += 5;
    };

    addSection('🌡️ TEMPERATURE LOGS', filtered.temperature);
    addSection('🧪 pH LOGS', filtered.pH);
    addSection('⚠️ CRITICAL CONTROL POINTS (CCP)', filtered.CCP);
    addSection('🧹 SANITATION LOGS', filtered.sanitation);
    addSection('🔧 CORRECTIVE ACTIONS', filtered.corrective);
    addSection('📋 DAILY CHECKLISTS', filtered.daily_checklist);
    addSection('🧾 BATCH COMPLIANCE LOGS', filtered.batch);
    addSection('🛡️ HACCP PLAN REVIEWS', filtered.haccp);
    addSection('🏷️ LABEL / ALLERGEN REVIEWS', filtered.label_allergen);

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(160, 160, 160);
    doc.text(`NuVira Juice Company — Compliance Record — ${new Date().getFullYear()}`, margin, 280);

    const pdfBase64 = doc.output('datauristring').split(',')[1];
    const pdfBuffer = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));

    // For now, return the PDF as data URI since blob upload has issues
    const pdfDataUri = `data:application/pdf;base64,${pdfBase64}`;

    // TODO: Once blob upload is fixed, uncomment the code below:
    // const uploadRes = await base44.asServiceRole.integrations.Core.UploadFile({
    //   file: new Blob([pdfBuffer], { type: 'application/pdf' }),
    // });
    // return Response.json({ success: true, file_url: uploadRes.file_url, ... })

    console.log(`[AUDIT] Generated audit packet for ${start_date} to ${end_date}`);

    return Response.json({
      success: true,
      file_url: pdfDataUri,
      summary: {
        temperature_logs: filtered.temperature.length,
        pH_logs: filtered.pH.length,
        CCP_logs: filtered.CCP.length,
        sanitation_logs: filtered.sanitation.length,
        corrective_logs: filtered.corrective.length,
        daily_checklists: filtered.daily_checklist.length,
        batch_compliance_logs: filtered.batch.length,
        haccp_reviews: filtered.haccp.length,
        label_allergen_reviews: filtered.label_allergen.length,
      },
    });
  } catch (error) {
    console.error('generateAuditPacket error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
