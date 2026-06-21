// ════════════════════════════════════════════════════════════════════════════
// mailer.js — sends notification emails via Google Workspace SMTP (nodemailer).
// Never throws to the caller: if email is misconfigured or fails, it logs and
// returns false so it can't break the operation that triggered it.
//
// Required env vars (set in Railway):
//   SMTP_USER   — the Google Workspace address that sends, e.g. finance@direct-truck.com
//   SMTP_PASS   — a Google APP PASSWORD for that account (NOT the normal password)
//   MAIL_FROM   — optional display sender, defaults to SMTP_USER
//                 e.g. "Direct Truck Sales <finance@direct-truck.com>"
//   DEPOSIT_NOTIFY_TO — comma-separated recipients, e.g.
//                 "finance@direct-truck.com,you@direct-truck.com,olia@direct-truck.com"
//
// Google app password: Google Account → Security → 2-Step Verification → App
// passwords. Requires 2FA enabled on that Workspace account.
// ════════════════════════════════════════════════════════════════════════════

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (e) {
  console.warn('[mailer] nodemailer not installed — email disabled until "npm install nodemailer"');
}

const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;

let _transport = null;
function transport() {
  if (_transport) return _transport;
  if (!nodemailer || !SMTP_USER || !SMTP_PASS) return null;
  _transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return _transport;
}

function recipients() {
  const raw = process.env.DEPOSIT_NOTIFY_TO || 'finance@direct-truck.com';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// Core sender. Returns true on success, false otherwise (never throws).
async function sendEmail({ to, subject, html, text }) {
  const t = transport();
  if (!t) { console.warn('[mailer] SMTP not configured — skipping email:', subject); return false; }
  const list = Array.isArray(to) ? to : [to];
  if (!list.length) { console.warn('[mailer] no recipients — skipping:', subject); return false; }
  try {
    await t.sendMail({ from: MAIL_FROM, to: list.join(', '), subject, html, text });
    return true;
  } catch (e) {
    console.error('[mailer] send failed:', e.message);
    return false;
  }
}

function money(v) {
  const n = parseFloat(String(v || '').replace(/[^0-9.]/g, ''));
  return isNaN(n) ? String(v || '') : '$' + n.toLocaleString();
}

// Build the deposit notification content from a saved bill of sale.
function depositContent(d, savedBy) {
  const customer = d.personalName || d.businessName || '(no name)';
  const unit = (Array.isArray(d.units) && d.units.length)
    ? d.units.map(u => u.unit).filter(Boolean).join(', ')
    : (d.unit || '');
  const desc = (Array.isArray(d.units) && d.units.length)
    ? d.units.map(u => `${u.year || ''} ${u.make || ''} ${u.model || ''}`.trim()).filter(Boolean).join('; ')
    : `${d.year || ''} ${d.make || ''} ${d.model || ''}`.trim();
  const date = d.date || new Date().toISOString().split('T')[0];
  const subject = `Deposit received — ${customer} (${money(d.depositAmount)})`;
  const rows = [
    ['Customer', customer],
    ['Deposit', money(d.depositAmount) + (d.depositType ? ` (${d.depositType})` : '')],
    ['Unit', unit || '—'],
    ['Vehicle', desc || '—'],
    ['Sale total', money(d.total)],
    ['Salesperson', d.salesperson || '—'],
    ['Date', date],
    ['Entered by', savedBy || '—'],
  ];
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;">
      <h2 style="color:#1a1a1a;margin:0 0 4px;">Deposit Received</h2>
      <p style="color:#555;margin:0 0 16px;font-size:14px;">A bill of sale was created with a deposit.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        ${rows.map(([k, v]) => `<tr>
          <td style="padding:7px 10px;border-bottom:1px solid #eee;color:#888;width:130px;">${k}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #eee;color:#1a1a1a;font-weight:600;">${v}</td>
        </tr>`).join('')}
      </table>
      <p style="color:#999;font-size:12px;margin-top:16px;">Direct Truck Sales Inc. — automated notification</p>
    </div>`;
  const text = `Deposit Received\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nDirect Truck Sales Inc.`;
  return { subject, html, text, summary: `${customer} — ${money(d.depositAmount)} deposit on ${unit || 'unit'}` };
}

async function notifyDeposit(d, savedBy) {
  const c = depositContent(d, savedBy);
  const ok = await sendEmail({ to: recipients(), subject: c.subject, html: c.html, text: c.text });
  if (ok) console.log('[mailer] deposit email sent:', c.summary);
  return ok;
}

module.exports = { sendEmail, notifyDeposit, depositContent, recipients };
