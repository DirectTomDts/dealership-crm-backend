// ════════════════════════════════════════════════════════════════════════════
// backfill-link-deals.js — Link existing bills of sale / closings / test drives
// to leads that have no lead_id yet, by matching phone first, then name.
//
//   node src/backfill-link-deals.js          (DRY RUN — shows what it would do)
//   node src/backfill-link-deals.js --commit  (actually writes the links)
//
// Safe: only fills lead_id where it is currently NULL/empty. Never overwrites an
// existing link, never deletes anything. Idempotent.
// ════════════════════════════════════════════════════════════════════════════
const { query, pool } = require('./db');

const COMMIT = process.argv.includes('--commit');

const digits = (s) => String(s || '').replace(/\D/g, '');
const norm   = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

async function loadLeads() {
  const { rows } = await query('SELECT id, first_name, last_name, company, phone FROM leads');
  // index by phone digits and by normalized name/company for quick matching
  const byPhone = {}, byName = {}, byCompany = {};
  for (const l of rows) {
    const p = digits(l.phone);
    if (p.length >= 7) byPhone[p] = byPhone[p] || l.id;
    const fullName = norm(`${l.first_name} ${l.last_name}`);
    if (fullName) byName[fullName] = byName[fullName] || l.id;
    const co = norm(l.company);
    if (co) byCompany[co] = byCompany[co] || l.id;
  }
  return { rows, byPhone, byName, byCompany };
}

function matchLead(idx, { phone, name, company }) {
  const p = digits(phone);
  if (p.length >= 7 && idx.byPhone[p]) return { id: idx.byPhone[p], how: 'phone' };
  const n = norm(name);
  if (n && idx.byName[n]) return { id: idx.byName[n], how: 'name' };
  const c = norm(company);
  if (c && idx.byCompany[c]) return { id: idx.byCompany[c], how: 'company' };
  return null;
}

async function backfillTable(table, idx, opts) {
  // opts: { idCol, phoneCol, nameExpr, companyCol }
  const { rows } = await query(
    `SELECT * FROM ${table} WHERE lead_id IS NULL OR lead_id = ''`);
  let linked = 0, unmatched = 0;
  for (const r of rows) {
    const name = opts.nameExpr(r);
    const m = matchLead(idx, { phone: r[opts.phoneCol], name, company: r[opts.companyCol] });
    if (m) {
      linked++;
      console.log(`  [${table}] ${r[opts.idCol]}  →  lead ${m.id}  (by ${m.how})  "${name}"`);
      if (COMMIT) {
        await query(`UPDATE ${table} SET lead_id=$1 WHERE ${opts.idCol}=$2`, [m.id, r[opts.idCol]]);
      }
    } else {
      unmatched++;
    }
  }
  console.log(`  ${table}: ${linked} linked, ${unmatched} unmatched (no lead found)\n`);
  return { linked, unmatched };
}

(async () => {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
  console.log(COMMIT ? '*** COMMIT MODE — writing links ***\n' : '*** DRY RUN — no changes (use --commit to apply) ***\n');

  const idx = await loadLeads();
  console.log(`Loaded ${idx.rows.length} leads for matching.\n`);

  const bos = await backfillTable('bills_of_sale', idx, {
    idCol: 'id', phoneCol: 'phone', companyCol: 'business_name',
    nameExpr: (r) => r.personal_name || r.business_name || '',
  });
  const cp = await backfillTable('closing_packages', idx, {
    idCol: 'id', phoneCol: 'phone', companyCol: 'business_name',
    nameExpr: (r) => r.personal_name || r.business_name || '',
  });
  const td = await backfillTable('test_drives', idx, {
    idCol: 'id', phoneCol: 'phone', companyCol: 'customer_name',
    nameExpr: (r) => r.customer_name || '',
  });

  const totalLinked = bos.linked + cp.linked + td.linked;
  console.log('────────────────────────────────────────');
  console.log(`TOTAL: ${totalLinked} records ${COMMIT ? 'linked' : 'would be linked'}.`);
  if (!COMMIT && totalLinked > 0) console.log('Re-run with --commit to apply these links.');
  await pool.end();
})().catch(e => { console.error('BACKFILL FAILED:', e.message); process.exit(1); });
