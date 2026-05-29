import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['admin', 'staff'].includes(user.role)) return Response.json({ error: 'Forbidden: Staff or Admin access required' }, { status: 403 });

    const { log_type, data, min_value, max_value } = await req.json();

    // Validate required fields based on log type
    const requiredFields = {
      temperature: ['log_date', 'log_time', 'staff_member', 'location', 'temperature'],
      pH: ['log_date', 'log_time', 'staff_member', 'batch_id', 'ph_value'],
      CCP: ['log_date', 'log_time', 'staff_member', 'ccp_point', 'batch_id', 'result'],
      sanitation: ['log_date', 'log_time', 'staff_member', 'area', 'cleaned', 'sanitized'],
      corrective: ['log_date', 'log_time', 'staff_member', 'issue_type', 'corrective_action_taken'],
    };

    const required = requiredFields[log_type] || [];
    const missing = required.filter(field => !data[field]);

    if (missing.length > 0) {
      return Response.json({
        valid: false,
        errors: [`Missing required fields: ${missing.join(', ')}`],
      }, { status: 400 });
    }

    // Check if value is in range (for temperature and pH)
    const isOutOfRange = (data.temperature || data.ph_value) && min_value && max_value
      ? (data.temperature || data.ph_value) < min_value || (data.temperature || data.ph_value) > max_value
      : false;

    // If out of range, alert and require corrective action
    if (isOutOfRange) {
      const alert = await base44.asServiceRole.entities.ComplianceAlert.create({
        alert_type: 'Out of Range',
        severity: 'High',
        message: `${log_type} value ${data.temperature || data.ph_value} is outside range ${min_value}-${max_value}`,
        triggered_date: new Date().toISOString().split('T')[0],
        triggered_time: new Date().toISOString().split('T')[1].slice(0, 5),
        status: 'Active',
      });

      return Response.json({
        valid: true,
        warning: true,
        message: 'Value is out of range. Corrective action log will be required.',
        alert_id: alert.id,
      });
    }

    return Response.json({ valid: true, warning: false });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});