function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function money(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : '$0.00';
}

function itemRows(items = []) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return items.slice(0, 40).map((item) => {
    const title = escapeHtml(item?.title || item?.name || 'NuVira item');
    const quantity = Math.max(1, Number(item?.quantity || 1));
    const price = Number(item?.price || 0) * quantity;
    return `<tr><td style="padding:10px 0;border-bottom:1px solid #e6eee9;color:#33443a;">${title} × ${quantity}</td><td style="padding:10px 0;border-bottom:1px solid #e6eee9;text-align:right;color:#173f2c;font-weight:600;">${money(price)}</td></tr>`;
  }).join('');
}

export function buildOrderEmailHtml({ copy, order, actionUrl, supportEmail = 'support@nuvirajuice.com' }) {
  const number = escapeHtml(order?.order_number || order?.id || '');
  const firstName = escapeHtml(String(order?.customer_name || '').trim().split(/\s+/)[0] || 'there');
  const safeUrl = escapeHtml(actionUrl);
  const rows = itemRows(order?.items);
  const total = Number(order?.total || 0);
  const orderSummary = rows ? `
    <div style="margin:24px 0;padding:18px 20px;border:1px solid #dce9e1;border-radius:14px;background:#f7fbf8;">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5f7568;margin-bottom:6px;">Order #${number}</div>
      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>
      <div style="padding-top:14px;text-align:right;color:#173f2c;font-size:16px;font-weight:700;">Total ${money(total)}</div>
    </div>` : `
    <div style="margin:24px 0;padding:18px 20px;border:1px solid #dce9e1;border-radius:14px;background:#f7fbf8;">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5f7568;">Order #${number}</div>
    </div>`;

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f1ea;color:#26362d;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(copy.detail)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(23,63,44,.08);">
        <tr><td style="background:#173f2c;padding:28px 32px;text-align:center;">
          <div style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:.01em;">NuVira Juice Company</div>
          <div style="margin-top:6px;color:#cfe6d8;font-size:12px;letter-spacing:.16em;text-transform:uppercase;">Real. Living. Nutrition.</div>
        </td></tr>
        <tr><td style="padding:34px 32px 30px;">
          <p style="margin:0 0 16px;font-size:15px;color:#53655b;">Hi ${firstName},</p>
          <h1 style="margin:0 0 14px;font-size:27px;line-height:1.2;color:#173f2c;">${escapeHtml(copy.heading)}</h1>
          <p style="margin:0;font-size:16px;line-height:1.65;color:#405248;">${escapeHtml(copy.detail)}</p>
          ${orderSummary}
          <div style="text-align:center;margin:28px 0 22px;">
            <a href="${safeUrl}" style="display:inline-block;background:#173f2c;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:999px;font-size:14px;font-weight:700;">${escapeHtml(copy.cta)}</a>
          </div>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7b72;">Need help? Reply to this email or contact <a href="mailto:${escapeHtml(supportEmail)}" style="color:#236843;">${escapeHtml(supportEmail)}</a>.</p>
          <p style="margin:22px 0 0;font-size:14px;line-height:1.6;color:#405248;">Thank you for being part of NuVira Juice Company.</p>
        </td></tr>
        <tr><td style="border-top:1px solid #edf1ee;padding:20px 32px;text-align:center;color:#7a8980;font-size:11px;line-height:1.5;">
          This is an order-related service message for order #${number}.<br>NuVira Juice Company, 619 N. Main St., O'Fallon, MO 63366
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
