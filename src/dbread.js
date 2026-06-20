// ════════════════════════════════════════════════════════════════════════════
// dbread.js — Phase 4 read layer
//
// Returns data in the EXACT shape the frontend already expects, so the UI can't
// tell whether it came from Sheets or Postgres. Each function mirrors the
// corresponding GET route's output object keys.
//
// Goes in src/ next to server.js, db.js, dbwrite.js.
// ════════════════════════════════════════════════════════════════════════════
const { query } = require('./db');

// ── LEADS ────────────────────────────────────────────────────────────────────
// rowIndex is synthesized from ordinal position for backward-compat, but lead
// updates now resolve by id server-side, so its exact value no longer matters.
async function readLeads() {
  const { rows } = await query(`SELECT * FROM leads WHERE deleted_at IS NULL ORDER BY created_at ASC`);
  // Pull all deal-type records once, group by lead_id, to rebuild the "deals" array
  const deals = await buildDealsByLead();
  return rows.map((r, i) => ({
    rowIndex: i + 1,
    id: r.id, first: r.first_name||'', last: r.last_name||'', company: r.company||'',
    phone: r.phone||'', email: r.email||'', unit: r.unit||'', source: r.source||'',
    status: r.status||'Prospect', sales: r.salesperson||'', followup: r.followup||'',
    notes: r.notes||'', archived: r.archived ? 'true' : 'false',
    address: r.address||'', city: r.city||'', state: r.state||'', zip: r.zip||'',
    bizAddress: r.biz_address||'', bizCity: r.biz_city||'', bizState: r.biz_state||'',
    bizZip: r.biz_zip||'', bizPhone: r.biz_phone||'', dlNumber: r.dl_number||'', dlState: r.dl_state||'',
    deals: deals[r.id] || [],
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : '',
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
  }));
}

// Rebuild the per-lead deal history from the relational tables (replaces the
// old deals-JSON column). Newest first.
async function buildDealsByLead() {
  const out = {};
  const push = (leadId, d) => { if (!leadId) return; (out[leadId] = out[leadId] || []).push(d); };

  const bos = await query(`
    SELECT b.id, b.lead_id, b.bos_date, b.total, b.drive_link,
           string_agg(u.unit, ', ') FILTER (WHERE u.unit <> '') AS units,
           string_agg(trim(concat_ws(' ', u.year, u.make, u.model)), ' | ') AS descs,
           string_agg(u.vin, ', ') FILTER (WHERE u.vin <> '') AS vins
    FROM bills_of_sale b LEFT JOIN bos_units u ON u.bos_id = b.id
    WHERE b.lead_id IS NOT NULL AND b.deleted_at IS NULL
    GROUP BY b.id ORDER BY b.created_at DESC`);
  for (const r of bos.rows) push(r.lead_id, { t:'Bill of Sale', d:r.bos_date||'', u:r.units||'', desc:(r.descs||'').trim(), vin:r.vins||'', amt:r.total||'', link:r.drive_link||'' });

  const td = await query(`SELECT * FROM test_drives WHERE lead_id IS NOT NULL AND deleted_at IS NULL ORDER BY created_at DESC`);
  for (const r of td.rows) push(r.lead_id, { t:'Test Drive', d:r.drive_date||'', u:r.unit||'', desc:`${r.make||''} ${r.model||''}`.trim(), vin:r.vin||'', amt:'', link:r.drive_link||'' });

  const cp = await query(`SELECT * FROM closing_packages WHERE lead_id IS NOT NULL AND deleted_at IS NULL ORDER BY created_at DESC`);
  for (const r of cp.rows) push(r.lead_id, { t:'Closing Package', d:r.cp_date||'', u:r.unit||'', desc:`${r.make||''} ${r.model||''}`.trim(), vin:r.vin||'', amt:'', link:r.drive_link||'' });

  return out;
}

// ── INVENTORY ────────────────────────────────────────────────────────────────
async function readInventory() {
  const { rows } = await query(`SELECT * FROM inventory ORDER BY unit ASC`);
  return rows.map(r => ({
    unit:r.unit||'', year:r.year||'', make:r.make||'', model:r.model||'', hours:r.hours||'',
    miles:r.miles||'', apu:r.apu||'', color:r.color||'', ratio:r.ratio||'', hp:r.hp||'',
    listPrice:r.list_price||'', salePrice:r.sale_price||'', status:r.status||'', vin:r.vin||'',
    cost:r.cost||'', profit:r.profit||'',
  }));
}

// ── TEST DRIVE HISTORY ───────────────────────────────────────────────────────
async function readTestDrives() {
  const { rows } = await query(`SELECT * FROM test_drives WHERE deleted_at IS NULL ORDER BY created_at DESC`);
  return rows.map(r => ({
    date:r.drive_date||'', customerName:r.customer_name||'', phone:r.phone||'', address:r.address||'',
    city:r.city||'', state:r.state||'', zip:r.zip||'', dlNumber:r.dl_number||'', dlState:r.dl_state||'',
    unit:r.unit||'', make:r.make||'', model:r.model||'', vin:r.vin||'', plate:r.plate||'',
    returnTime:r.return_time||'', salesperson:r.salesperson||'', leadId:r.lead_id||'', driveLink:r.drive_link||'',
  }));
}

// ── BILLS OF SALE ────────────────────────────────────────────────────────────
async function readBillsOfSale() {
  const { rows } = await query(`SELECT * FROM bills_of_sale WHERE deleted_at IS NULL ORDER BY created_at DESC`);
  const out = [];
  for (const b of rows) {
    const u = await query(`SELECT * FROM bos_units WHERE bos_id=$1 ORDER BY unit_number ASC`, [b.id]);
    const units = u.rows.map(x => ({
      num:x.unit_number, unit:x.unit||'', year:x.year||'', make:x.make||'', model:x.model||'', vin:x.vin||'',
      miles:x.miles||'', apu:x.apu||'', color:x.color||'', ratio:x.ratio||'', hp:x.hp||'',
      warrantyCoverage:x.warranty_coverage||'', serviceContractLevel:x.sc_level||'',
      serviceContractCoverage:x.sc_coverage||'', serviceContractPrice:x.sc_price||'',
      salePrice:x.sale_price||'', salesTax:x.sales_tax||'', titleFee:x.title_fee||'', docFee:x.doc_fee||'',
      item1:x.item1||'', item2:x.item2||'', item3:x.item3||'', item4:x.item4||'',
    }));
    const first = units[0] || {};
    out.push({
      id:b.id, date:b.bos_date||'', personalName:b.personal_name||'', businessName:b.business_name||'',
      address:b.address||'', city:b.city||'', state:b.state||'', zip:b.zip||'',
      bizAddress:b.biz_address||'', bizCity:b.biz_city||'', bizState:b.biz_state||'', bizZip:b.biz_zip||'',
      phone:b.phone||'', bizPhone:b.biz_phone||'', email:b.email||'', dlNumber:b.dl_number||'', dlState:b.dl_state||'',
      // flat single-unit fields for backward compat (frontend reads units[] first anyway)
      unit:first.unit||'', year:first.year||'', make:first.make||'', model:first.model||'', vin:first.vin||'',
      miles:first.miles||'', apu:first.apu||'', color:first.color||'', ratio:first.ratio||'', hp:first.hp||'',
      warrantyCoverage:first.warrantyCoverage||'', salePrice:first.salePrice||'',
      serviceContractLevel:first.serviceContractLevel||'', serviceContractCoverage:first.serviceContractCoverage||'',
      serviceContractPrice:first.serviceContractPrice||'', salesTax:first.salesTax||'',
      titleFee:first.titleFee||'', docFee:first.docFee||'',
      depositAmount:b.deposit_amount||'', depositType:b.deposit_type||'', total:b.total||'',
      salesperson:b.salesperson||'', item1:first.item1||'', item2:first.item2||'', item3:first.item3||'',
      item4:first.item4||'', leadId:b.lead_id||'', driveLink:b.drive_link||'', units,
    });
  }
  return out;
}

// ── CLOSING PACKAGES ─────────────────────────────────────────────────────────
async function readClosing() {
  const { rows } = await query(`SELECT * FROM closing_packages WHERE deleted_at IS NULL ORDER BY created_at DESC`);
  return rows.map(r => ({
    id:r.id, date:r.cp_date||'', personalName:r.personal_name||'', businessName:r.business_name||'',
    address:r.address||'', city:r.city||'', state:r.state||'', zip:r.zip||'', phone:r.phone||'',
    unit:r.unit||'', year:r.year||'', make:r.make||'', model:r.model||'', vin:r.vin||'',
    salesperson:r.salesperson||'', usdot:r.usdot||'', mcNumber:r.mc_number||'',
    reportNumber:r.report_number||'', isLeased:r.is_leased,
    carrierName:r.carrier_name||'', carrierAddress:r.carrier_address||'', carrierCity:r.carrier_city||'',
    carrierState:r.carrier_state||'', carrierZip:r.carrier_zip||'', carrierPhone:r.carrier_phone||'',
    role:r.role||'agent', bosId:r.bos_id||'', notes:r.notes||'', driveLink:r.drive_link||'',
  }));
}

// Resolve a lead's Google-Sheet row number by its id (so PUT-by-rowIndex keeps
// working even when the frontend got its data from Postgres).
async function leadIdExists(id) {
  const { rows } = await query(`SELECT 1 FROM leads WHERE id=$1`, [id]);
  return rows.length > 0;
}

module.exports = {
  readLeads, readInventory, readTestDrives, readBillsOfSale, readClosing, leadIdExists,
};
