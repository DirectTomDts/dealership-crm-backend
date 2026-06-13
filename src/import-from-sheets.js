// ════════════════════════════════════════════════════════════════════════════
// import-from-sheets.js — One-time (idempotent) migration: Sheets → Postgres
//
// Usage on Railway (or locally with env vars set):
//   node src/import-from-sheets.js
//
// Idempotent: re-running upserts by primary key, so it's safe to run multiple
// times. It never deletes anything. Run it, check the printed counts, run it
// again if needed.
//
// Requires env: DATABASE_URL, GOOGLE_CREDENTIALS, SHEET_ID
// ════════════════════════════════════════════════════════════════════════════
const { google } = require('googleapis');
const { query, withTransaction, pool } = require('./db');

const SHEET_ID = process.env.SHEET_ID;
const INV_SHEET_ID = '1_R2mmi6O_KQW1mSd1Nu26fJDwrXKtRwH9vTwGnA2fN4';

function sheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  return google.sheets({ version: 'v4', auth });
}

async function getRows(sheets, spreadsheetId, range) {
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return r.data.values || [];
  } catch (e) { console.warn(`  (could not read ${range}: ${e.message})`); return []; }
}

const g = (row, i) => (row[i] != null ? String(row[i]) : '');
const boolish = (v) => String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'yes';

async function importLeads(sheets) {
  const rows = await getRows(sheets, SHEET_ID, 'Sheet1');
  let n = 0;
  for (const r of rows.slice(1)) {
    const id = g(r, 0);
    if (!id) continue;
    await query(`
      INSERT INTO leads (id, first_name, last_name, company, phone, email, unit, source, status,
        salesperson, followup, notes, archived, address, city, state, zip,
        biz_address, biz_city, biz_state, biz_zip, biz_phone, dl_number, dl_state, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24, now())
      ON CONFLICT (id) DO UPDATE SET
        first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name, company=EXCLUDED.company,
        phone=EXCLUDED.phone, email=EXCLUDED.email, unit=EXCLUDED.unit, source=EXCLUDED.source,
        status=EXCLUDED.status, salesperson=EXCLUDED.salesperson, followup=EXCLUDED.followup,
        notes=EXCLUDED.notes, archived=EXCLUDED.archived, address=EXCLUDED.address, city=EXCLUDED.city,
        state=EXCLUDED.state, zip=EXCLUDED.zip, biz_address=EXCLUDED.biz_address, biz_city=EXCLUDED.biz_city,
        biz_state=EXCLUDED.biz_state, biz_zip=EXCLUDED.biz_zip, biz_phone=EXCLUDED.biz_phone,
        dl_number=EXCLUDED.dl_number, dl_state=EXCLUDED.dl_state, updated_at=now()`,
      [id, g(r,1), g(r,2), g(r,3), g(r,4), g(r,5), g(r,6), g(r,7), g(r,8) || 'Prospect',
       g(r,9), g(r,10), g(r,11), boolish(g(r,12)), g(r,13), g(r,14), g(r,15), g(r,16),
       g(r,17), g(r,18), g(r,19), g(r,20), g(r,21), g(r,22), g(r,23)]);

    // deals JSON (col 24) -> nothing to import into a table directly; deals are
    // reconstructed from bills_of_sale/test_drives/closing rows by lead_id.
    n++;
  }
  return n;
}

async function importInventory(sheets) {
  const rows = await getRows(sheets, INV_SHEET_ID, 'Sheet1');
  let n = 0;
  for (const r of rows.slice(1)) {
    const unit = g(r, 0);
    if (!unit) continue;
    await query(`
      INSERT INTO inventory (unit, year, make, model, hours, miles, apu, color, ratio, hp,
        list_price, sale_price, status, vin, synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
      ON CONFLICT (unit) DO UPDATE SET
        year=EXCLUDED.year, make=EXCLUDED.make, model=EXCLUDED.model, hours=EXCLUDED.hours,
        miles=EXCLUDED.miles, apu=EXCLUDED.apu, color=EXCLUDED.color, ratio=EXCLUDED.ratio,
        hp=EXCLUDED.hp, list_price=EXCLUDED.list_price, sale_price=EXCLUDED.sale_price,
        status=EXCLUDED.status, vin=EXCLUDED.vin, synced_at=now()`,
      [unit, g(r,1), g(r,2), g(r,3), g(r,4), g(r,5), g(r,6), g(r,7), g(r,8), g(r,9),
       g(r,10), g(r,11), g(r,12), g(r,13)]);
    n++;
  }
  return n;
}

async function importTestDrives(sheets) {
  const rows = await getRows(sheets, SHEET_ID, 'TestDrives');
  let n = 0;
  for (const r of rows.slice(1)) {
    if (!g(r, 1)) continue; // needs a customer name
    await query(`
      INSERT INTO test_drives (lead_id, drive_date, customer_name, phone, address, city, state, zip,
        dl_number, dl_state, unit, make, model, vin, plate, return_time, salesperson)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [g(r,16) || null, g(r,0), g(r,1), g(r,2), g(r,3), g(r,4), g(r,5), g(r,6),
       g(r,7), g(r,8), g(r,9), g(r,10), g(r,11), g(r,12), g(r,13), g(r,14), g(r,15)]);
    n++;
  }
  return n;
}

async function importBillsOfSale(sheets) {
  const rows = await getRows(sheets, SHEET_ID, 'BillsOfSale');
  let n = 0;
  for (const r of rows.slice(1)) {
    const id = g(r, 0);
    if (!id || (!g(r,2) && !g(r,3))) continue;
    await withTransaction(async (c) => {
      await c.query(`
        INSERT INTO bills_of_sale (id, lead_id, bos_date, personal_name, business_name,
          address, city, state, zip, biz_address, biz_city, biz_state, biz_zip,
          phone, biz_phone, email, dl_number, dl_state, deposit_amount, deposit_type, total, salesperson)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
        ON CONFLICT (id) DO NOTHING`,
        [id, g(r,43) || null, g(r,1), g(r,2), g(r,3), g(r,4), g(r,5), g(r,6), g(r,7),
         g(r,8), g(r,9), g(r,10), g(r,11), g(r,12), g(r,13), g(r,14), g(r,15), g(r,16),
         g(r,35), g(r,36), g(r,37), g(r,38)]);

      // Units: prefer the JSON in column 44, else fall back to flat single-unit columns
      let units = [];
      try { units = r[44] ? JSON.parse(r[44]) : []; } catch { units = []; }
      if (!units.length) {
        units = [{ unit:g(r,17), year:g(r,18), make:g(r,19), model:g(r,20), vin:g(r,21),
                   miles:g(r,22), apu:g(r,23), color:g(r,24), ratio:g(r,25), hp:g(r,26),
                   warrantyCoverage:g(r,27), salePrice:g(r,28), serviceContractLevel:g(r,29),
                   serviceContractCoverage:g(r,30), serviceContractPrice:g(r,31),
                   salesTax:g(r,32), titleFee:g(r,33), docFee:g(r,34),
                   item1:g(r,39), item2:g(r,40), item3:g(r,41), item4:g(r,42) }];
      }
      // clear any existing units for idempotency, then re-insert
      await c.query('DELETE FROM bos_units WHERE bos_id=$1', [id]);
      let un = 1;
      for (const u of units) {
        await c.query(`
          INSERT INTO bos_units (bos_id, unit_number, unit, year, make, model, vin, miles, apu, color, ratio, hp,
            warranty_coverage, sc_level, sc_coverage, sc_price, sale_price, sales_tax, title_fee, doc_fee,
            item1, item2, item3, item4)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
          [id, un++, u.unit||'', u.year||'', u.make||'', u.model||'', u.vin||'', u.miles||'',
           u.apu||'', u.color||'', u.ratio||'', u.hp||'', u.warrantyCoverage||'',
           u.serviceContractLevel||'', u.serviceContractCoverage||'', u.serviceContractPrice||'',
           u.salePrice||'', u.salesTax||'', u.titleFee||'', u.docFee||'',
           u.item1||'', u.item2||'', u.item3||'', u.item4||'']);
      }
    });
    n++;
  }
  return n;
}

async function importClosing(sheets) {
  const rows = await getRows(sheets, SHEET_ID, 'ClosingPackages');
  let n = 0;
  for (const r of rows.slice(1)) {
    const id = g(r, 0);
    if (!id || (!g(r,2) && !g(r,3))) continue;
    await query(`
      INSERT INTO closing_packages (id, cp_date, personal_name, business_name, address, city, state, zip, phone,
        unit, year, make, model, vin, salesperson, usdot, mc_number, is_leased,
        carrier_name, carrier_address, carrier_city, carrier_state, carrier_zip, carrier_phone,
        role, bos_id, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
      ON CONFLICT (id) DO NOTHING`,
      [id, g(r,1), g(r,2), g(r,3), g(r,4), g(r,5), g(r,6), g(r,7), g(r,8),
       g(r,9), g(r,10), g(r,11), g(r,12), g(r,13), g(r,14), g(r,15), g(r,16), boolish(g(r,17)),
       g(r,18), g(r,19), g(r,20), g(r,21), g(r,22), g(r,23),
       g(r,24) || 'agent', g(r,25) || null, g(r,26)]);
    n++;
  }
  return n;
}

(async () => {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
  const sheets = sheetsClient();
  console.log('Starting import from Google Sheets → Postgres...\n');
  console.log('Leads:            ', await importLeads(sheets));
  console.log('Inventory:        ', await importInventory(sheets));
  console.log('Test drives:      ', await importTestDrives(sheets));
  console.log('Bills of sale:    ', await importBillsOfSale(sheets));
  console.log('Closing packages: ', await importClosing(sheets));

  // Print verification counts straight from Postgres
  console.log('\nPostgres row counts now:');
  for (const t of ['leads','inventory','test_drives','bills_of_sale','bos_units','closing_packages']) {
    const r = await query(`SELECT count(*)::int AS c FROM ${t}`);
    console.log(`  ${t.padEnd(18)} ${r.rows[0].c}`);
  }
  console.log('\nDone. Compare these against your Sheet row counts.');
  await pool.end();
})().catch(e => { console.error('IMPORT FAILED:', e.message); process.exit(1); });
