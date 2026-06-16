// ════════════════════════════════════════════════════════════════════════════
// dbwrite.js — Phase 3 dual-write layer
//
// Each function mirrors a Sheets write into Postgres. They are called AFTER the
// Sheets write succeeds. Every function is wrapped so a Postgres failure logs a
// warning but NEVER throws into the request — Google Sheets stays the source of
// truth during Phase 3. Reads still come from Sheets until Phase 4.
//
// Goes in src/ next to server.js and db.js. Requires db.js.
// ════════════════════════════════════════════════════════════════════════════
const { query, withTransaction, isAvailable, audit } = require('./db');

// Wrap any mirror so it can never break the main request
// When PRIMARY is true (Sheets writes disabled), a Postgres failure MUST surface
// so the save isn't silently lost. When false (dual-write era), failures are
// swallowed because Sheets is still the source of truth.
const PRIMARY = (process.env.WRITE_TO_SHEETS || 'false').toLowerCase() !== 'true';
function safe(label, fn) {
  return async (...args) => {
    try {
      if (!(await isAvailable())) {
        if (PRIMARY) throw new Error('Database unavailable and Sheets writes are disabled');
        return; // dual-write era: Postgres optional
      }
      await fn(...args);
    } catch (e) {
      if (PRIMARY) { console.error(`[primary-write] ${label} FAILED:`, e.message); throw e; }
      console.warn(`[dual-write] ${label} failed (Sheets unaffected):`, e.message);
    }
  };
}

const b = (v) => v === true || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'yes';

// ── LEAD (insert) ────────────────────────────────────────────────────────────
const mirrorLeadInsert = safe('lead insert', async (id, l, username) => {
  await query(`
    INSERT INTO leads (id, first_name, last_name, company, phone, email, unit, source, status,
      salesperson, followup, notes, archived, address, city, state, zip,
      biz_address, biz_city, biz_state, biz_zip, biz_phone, dl_number, dl_state, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24, now())
    ON CONFLICT (id) DO UPDATE SET
      first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name, company=EXCLUDED.company,
      phone=EXCLUDED.phone, email=EXCLUDED.email, unit=EXCLUDED.unit, source=EXCLUDED.source,
      status=EXCLUDED.status, salesperson=EXCLUDED.salesperson, followup=EXCLUDED.followup,
      notes=EXCLUDED.notes, archived=EXCLUDED.archived, updated_at=now()`,
    [id, l.first||'', l.last||'', l.company||'', l.phone||'', l.email||'', l.unit||'', l.source||'',
     l.status||'Prospect', l.sales||'', l.followup||'', l.notes||'', b(l.status==='Sold'||l.status==='Dead'),
     l.address||'', l.city||'', l.state||'', l.zip||'', l.bizAddress||'', l.bizCity||'', l.bizState||'',
     l.bizZip||'', l.bizPhone||'', l.dlNumber||'', l.dlState||'']);
  await audit(username, 'create', 'lead', id, { name: `${l.first||''} ${l.last||''}`.trim() });
});

// ── LEAD (update) ────────────────────────────────────────────────────────────
const mirrorLeadUpdate = safe('lead update', async (l, username) => {
  if (!l.id) return;
  await query(`
    UPDATE leads SET first_name=$2, last_name=$3, company=$4, phone=$5, email=$6, unit=$7,
      source=$8, status=$9, salesperson=$10, followup=$11, notes=$12, archived=$13,
      address=$14, city=$15, state=$16, zip=$17, biz_address=$18, biz_city=$19, biz_state=$20,
      biz_zip=$21, biz_phone=$22, dl_number=$23, dl_state=$24, updated_at=now()
    WHERE id=$1`,
    [l.id, l.first||'', l.last||'', l.company||'', l.phone||'', l.email||'', l.unit||'', l.source||'',
     l.status||'Prospect', l.sales||'', l.followup||'', l.notes||'', b(l.status==='Sold'||l.status==='Dead'),
     l.address||'', l.city||'', l.state||'', l.zip||'', l.bizAddress||'', l.bizCity||'', l.bizState||'',
     l.bizZip||'', l.bizPhone||'', l.dlNumber||'', l.dlState||'']);
  await audit(username, 'update', 'lead', l.id, null);
});

// ── LEAD ENRICH (client fields merge) ────────────────────────────────────────
const mirrorLeadEnrich = safe('lead enrich', async (leadId, client) => {
  if (!leadId || !client) return;
  const c = client;
  // Only overwrite columns where an incoming value is present (COALESCE NULLIF pattern)
  await query(`
    UPDATE leads SET
      address   = CASE WHEN $2<>'' THEN $2 ELSE address END,
      city      = CASE WHEN $3<>'' THEN $3 ELSE city END,
      state     = CASE WHEN $4<>'' THEN $4 ELSE state END,
      zip       = CASE WHEN $5<>'' THEN $5 ELSE zip END,
      biz_address = CASE WHEN $6<>'' THEN $6 ELSE biz_address END,
      biz_city  = CASE WHEN $7<>'' THEN $7 ELSE biz_city END,
      biz_state = CASE WHEN $8<>'' THEN $8 ELSE biz_state END,
      biz_zip   = CASE WHEN $9<>'' THEN $9 ELSE biz_zip END,
      biz_phone = CASE WHEN $10<>'' THEN $10 ELSE biz_phone END,
      dl_number = CASE WHEN $11<>'' THEN $11 ELSE dl_number END,
      dl_state  = CASE WHEN $12<>'' THEN $12 ELSE dl_state END,
      phone     = CASE WHEN $13<>'' AND (phone='' OR phone IS NULL) THEN $13 ELSE phone END,
      email     = CASE WHEN $14<>'' AND (email='' OR email IS NULL) THEN $14 ELSE email END,
      company   = CASE WHEN $15<>'' AND (company='' OR company IS NULL) THEN $15 ELSE company END,
      updated_at = now()
    WHERE id=$1`,
    [leadId, c.address||'', c.city||'', c.state||'', c.zip||'', c.bizAddress||'', c.bizCity||'',
     c.bizState||'', c.bizZip||'', c.bizPhone||'', c.dlNumber||'', c.dlState||'',
     c.phone||'', c.email||'', c.company||'']);
});

// ── TEST DRIVE ───────────────────────────────────────────────────────────────
const mirrorTestDrive = safe('test drive', async (d, username) => {
  await query(`
    INSERT INTO test_drives (lead_id, drive_date, customer_name, phone, address, city, state, zip,
      dl_number, dl_state, unit, make, model, vin, plate, return_time, salesperson, drive_link)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [d.leadId||null, d.date||'', d.customerName||'', d.phone||'', d.address||'', d.city||'', d.state||'',
     d.zip||'', d.dlNumber||'', d.dlState||'', d.unit||'', d.make||'', d.model||'', d.vin||'',
     d.plate||'', d.returnTime||'', d.salesperson||'', d.driveLink||'']);
  await audit(username, 'create', 'test_drive', '', { customer: d.customerName, unit: d.unit });
});

// ── BILL OF SALE (+ units) ───────────────────────────────────────────────────
const mirrorBillOfSale = safe('bill of sale', async (id, d, username) => {
  await withTransaction(async (c) => {
    await c.query(`
      INSERT INTO bills_of_sale (id, lead_id, bos_date, personal_name, business_name,
        address, city, state, zip, biz_address, biz_city, biz_state, biz_zip,
        phone, biz_phone, email, dl_number, dl_state, deposit_amount, deposit_type, total, salesperson, drive_link)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      ON CONFLICT (id) DO UPDATE SET
        personal_name=EXCLUDED.personal_name, business_name=EXCLUDED.business_name,
        total=EXCLUDED.total, salesperson=EXCLUDED.salesperson,
        drive_link=CASE WHEN EXCLUDED.drive_link<>'' THEN EXCLUDED.drive_link ELSE bills_of_sale.drive_link END`,
      [id, d.leadId||null, d.date||'', d.personalName||'', d.businessName||'',
       d.address||'', d.city||'', d.state||'', d.zip||'', d.bizAddress||'', d.bizCity||'',
       d.bizState||'', d.bizZip||'', d.phone||'', d.bizPhone||'', d.email||'', d.dlNumber||'',
       d.dlState||'', d.depositAmount||'', d.depositType||'', d.total||'', d.salesperson||'', d.driveLink||'']);

    let units = (d.units && d.units.length) ? d.units : [{
      unit:d.unit, year:d.year, make:d.make, model:d.model, vin:d.vin, miles:d.miles, apu:d.apu,
      color:d.color, ratio:d.ratio, hp:d.hp, warrantyCoverage:d.warrantyCoverage,
      serviceContractLevel:d.serviceContractLevel, serviceContractCoverage:d.serviceContractCoverage,
      serviceContractPrice:d.serviceContractPrice, salePrice:d.salePrice, salesTax:d.salesTax,
      titleFee:d.titleFee, docFee:d.docFee, item1:d.item1, item2:d.item2, item3:d.item3, item4:d.item4 }];

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
  await audit(username, 'create', 'bill_of_sale', id, { total: d.total, customer: d.personalName||d.businessName });
});

// ── CLOSING PACKAGE ──────────────────────────────────────────────────────────
const mirrorClosing = safe('closing package', async (id, d, username) => {
  await query(`
    INSERT INTO closing_packages (id, lead_id, bos_id, cp_date, personal_name, business_name,
      address, city, state, zip, phone, unit, year, make, model, vin, salesperson,
      usdot, mc_number, report_number, role, is_leased,
      carrier_name, carrier_address, carrier_city, carrier_state, carrier_zip, carrier_phone, notes, drive_link)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
    ON CONFLICT (id) DO UPDATE SET
      personal_name=EXCLUDED.personal_name, business_name=EXCLUDED.business_name, notes=EXCLUDED.notes,
      drive_link=CASE WHEN EXCLUDED.drive_link<>'' THEN EXCLUDED.drive_link ELSE closing_packages.drive_link END`,
    [id, d.leadId||null, d.bosId||null, d.date||'', d.personalName||'', d.businessName||'',
     d.address||'', d.city||'', d.state||'', d.zip||'', d.phone||'', d.unit||'', d.year||'',
     d.make||'', d.model||'', d.vin||'', d.salesperson||'', d.usdot||'', d.mcNumber||'',
     d.reportNumber||'', d.role||'agent', b(d.isLeased),
     d.carrierName||'', d.carrierAddress||'', d.carrierCity||'', d.carrierState||'',
     d.carrierZip||'', d.carrierPhone||'', d.notes||'', d.driveLink||'']);
  await audit(username, 'create', 'closing_package', id, { customer: d.personalName||d.businessName });
});

// ── INVENTORY SYNC (mirror the read-only inventory sheet) ────────────────────
const mirrorInventory = safe('inventory sync', async (items) => {
  for (const r of items) {
    if (!r.unit) continue;
    await query(`
      INSERT INTO inventory (unit, year, make, model, hours, miles, apu, color, ratio, hp,
        list_price, sale_price, status, vin, synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
      ON CONFLICT (unit) DO UPDATE SET year=EXCLUDED.year, make=EXCLUDED.make, model=EXCLUDED.model,
        hours=EXCLUDED.hours, miles=EXCLUDED.miles, apu=EXCLUDED.apu, color=EXCLUDED.color,
        ratio=EXCLUDED.ratio, hp=EXCLUDED.hp, list_price=EXCLUDED.list_price, sale_price=EXCLUDED.sale_price,
        status=EXCLUDED.status, vin=EXCLUDED.vin, synced_at=now()`,
      [r.unit, r.year||'', r.make||'', r.model||'', r.hours||'', r.miles||'', r.apu||'', r.color||'',
       r.ratio||'', r.hp||'', r.listPrice||'', r.salePrice||'', r.status||'', r.vin||'']);
  }
});

module.exports = {
  mirrorLeadInsert, mirrorLeadUpdate, mirrorLeadEnrich,
  mirrorTestDrive, mirrorBillOfSale, mirrorClosing, mirrorInventory,
};
