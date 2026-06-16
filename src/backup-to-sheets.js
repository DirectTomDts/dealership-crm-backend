// ════════════════════════════════════════════════════════════════════════════
// backup-to-sheets.js — Nightly backup: Postgres → Google Sheets
//
// Writes the current database contents back into the Sheet tabs so Google Sheets
// stays a human-readable, restorable backup. Overwrites each tab wholesale at an
// explicit A1 origin (no append quirks). Safe to run repeatedly.
//
// Schedule it with Railway Cron (e.g. "0 6 * * *" = 06:00 UTC daily) pointing at:
//   node src/backup-to-sheets.js
//
// Requires env: DATABASE_URL, GOOGLE_CREDENTIALS, SHEET_ID
// ════════════════════════════════════════════════════════════════════════════
const { google } = require('googleapis');
const { query, pool } = require('./db');

const SHEET_ID = process.env.SHEET_ID;

function sheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}

async function ensureTab(sheets, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const exists = (meta.data.sheets||[]).some(s => s.properties.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] } });
  }
}

async function writeTab(sheets, title, header, rows) {
  await ensureTab(sheets, title);
  // Clear then write from A1
  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: title });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `${title}!A1`, valueInputOption: 'RAW',
    requestBody: { values: [header, ...rows] }
  });
  console.log(`  ${title}: ${rows.length} rows backed up`);
}

(async () => {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
  const sheets = sheetsClient();
  console.log('Nightly backup: Postgres → Sheets', new Date().toISOString());

  // LEADS → "Backup_Leads"
  const leads = (await query('SELECT * FROM leads ORDER BY created_at')).rows;
  await writeTab(sheets, 'Backup_Leads',
    ['ID','First','Last','Company','Phone','Email','Unit','Source','Status','Salesperson','Followup','Notes',
     'Archived','Address','City','State','Zip','BizAddress','BizCity','BizState','BizZip','BizPhone','DL#','DLState','Updated'],
    leads.map(l => [l.id,l.first_name,l.last_name,l.company,l.phone,l.email,l.unit,l.source,l.status,l.salesperson,
      l.followup,l.notes,l.archived,l.address,l.city,l.state,l.zip,l.biz_address,l.biz_city,l.biz_state,l.biz_zip,
      l.biz_phone,l.dl_number,l.dl_state, l.updated_at ? new Date(l.updated_at).toISOString() : '']));

  // BILLS OF SALE (flattened header + units summary) → "Backup_BillsOfSale"
  const bos = (await query('SELECT * FROM bills_of_sale ORDER BY created_at')).rows;
  const bosRows = [];
  for (const b of bos) {
    const u = (await query('SELECT * FROM bos_units WHERE bos_id=$1 ORDER BY unit_number', [b.id])).rows;
    const unitsSummary = u.map(x => `${x.unit||''} ${x.year||''} ${x.make||''} ${x.model||''} VIN:${x.vin||''} $${x.sale_price||''}`.trim()).join(' || ');
    bosRows.push([b.id, b.bos_date, b.personal_name, b.business_name, b.phone, b.email,
      [b.address,b.city,b.state,b.zip].filter(Boolean).join(', '), b.total, b.salesperson, b.lead_id||'', unitsSummary]);
  }
  await writeTab(sheets, 'Backup_BillsOfSale',
    ['ID','Date','Personal Name','Business Name','Phone','Email','Address','Total','Salesperson','Lead ID','Units'],
    bosRows);

  // TEST DRIVES → "Backup_TestDrives"
  const td = (await query('SELECT * FROM test_drives ORDER BY created_at')).rows;
  await writeTab(sheets, 'Backup_TestDrives',
    ['Date','Customer','Phone','Unit','Make','Model','VIN','Salesperson','Lead ID'],
    td.map(t => [t.drive_date,t.customer_name,t.phone,t.unit,t.make,t.model,t.vin,t.salesperson,t.lead_id||'']));

  // CLOSING PACKAGES → "Backup_ClosingPackages"
  const cp = (await query('SELECT * FROM closing_packages ORDER BY created_at')).rows;
  await writeTab(sheets, 'Backup_ClosingPackages',
    ['ID','Date','Customer','Business','Unit','Make','Model','VIN','Salesperson','USDOT','MC','Role','Lead ID','BOS ID'],
    cp.map(c => [c.id,c.cp_date,c.personal_name,c.business_name,c.unit,c.make,c.model,c.vin,c.salesperson,
      c.usdot,c.mc_number,c.role,c.lead_id||'',c.bos_id||'']));

  console.log('Backup complete.');
  await pool.end();
})().catch(e => { console.error('BACKUP FAILED:', e.message); process.exit(1); });
