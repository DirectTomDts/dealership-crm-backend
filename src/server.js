const express    = require('express');
const cors       = require('cors');
const jwt        = require('jsonwebtoken');
const path       = require('path');
const fs         = require('fs');
const { google } = require('googleapis');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const DBW = require('./dbwrite'); // Phase 3 dual-write (safe: never breaks requests)
const DBR = require('./dbread');   // Phase 4 read layer
const { isAvailable: pgAvailable } = require('./db');
const { query: pgQuery } = require('./db');
const bcrypt = require('bcryptjs'); // Phase 5: hashed passwords
const DRIVE = require('./drive');
const MAIL = require('./mailer'); // Tier 3: archive PDFs to Shared Drive
// READ_FROM controls where GET routes read. 'postgres' = read from DB, anything
// else (or unset) = read from Google Sheets. Flip in Railway vars; no code change.
const READ_FROM = (process.env.READ_FROM || 'sheets').toLowerCase();
async function usePg() { return READ_FROM === 'postgres' && await pgAvailable(); }
// Phase 5: per-save Sheets writes are off by default (nightly backup handles Sheets).
// Set WRITE_TO_SHEETS=true to re-enable live dual-write to Sheets.
const WRITE_TO_SHEETS = (process.env.WRITE_TO_SHEETS || 'false').toLowerCase() === 'true';

const app = express();
// CORS: if ALLOWED_ORIGINS env var is set, restrict to those domains only.
// If not set, allow all (safe fallback while you configure env vars in Railway).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(o=>o.trim()).filter(Boolean);
app.use(cors({
  origin: function(origin, callback) {
    // Always allow requests with no origin (mobile, Postman, server-to-server)
    if (!origin) return callback(null, true);
    // If no allowlist configured, permit everything (open mode)
    if (ALLOWED_ORIGINS.length === 0) return callback(null, true);
    // Otherwise enforce allowlist
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    console.warn('CORS blocked origin:', origin);
    callback(new Error('Origin not permitted'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// ── CONFIG ─────────────────────────────────────────────────────────────────────
const JWT_SECRET   = process.env.JWT_SECRET || 'dts-crm-default-secret-change-in-railway';
if (!process.env.JWT_SECRET) { console.warn('WARNING: JWT_SECRET env var not set — using default. Set this in Railway for security.'); }
const SHEET_ID     = process.env.SHEET_ID;
const SHEET_NAME   = process.env.SHEET_NAME || 'Sheet1';
const INV_SHEET_ID = process.env.INV_SHEET_ID || '1_R2mmi6O_KQW1mSd1Nu26fJDwrXKtRwH9vTwGnA2fN4';
const INV_SHEET_TAB = process.env.INV_SHEET_TAB || 'Sheet1';
const PURCHASE_HISTORY_SHEET_ID = process.env.PURCHASE_HISTORY_SHEET_ID || '';
const PURCHASE_HISTORY_TAB = process.env.PURCHASE_HISTORY_TAB || 'Sheet1';
const FORMS_DIR    = path.join(__dirname, '..', 'forms');

const USERS = [
  { username:'don',     password: process.env.PASS_DON     || 'Don2024!',     name:'Don',     role:'sales' },
  { username:'vitalie', password: process.env.PASS_VITALIE || 'Vitalie2024!', name:'Vitalie', role:'sales' },
  { username:'tom',     password: process.env.PASS_TOM     || 'Tom2024!',     name:'Tom',     role:'admin' },
  { username:'olia',    password: process.env.PASS_OLIA    || 'Olia2024!',    name:'Olia',    role:'sales' },
];
if (!process.env.PASS_DON) console.warn('WARNING: PASS_DON not set in env — using default password. Update in Railway.');
if (!process.env.PASS_TOM) console.warn('WARNING: PASS_TOM not set in env — using default password. Update in Railway.');

// ── LOGO (embedded) ────────────────────────────────────────────────────────────
const LOGO_B64 = '/9j/4QC8RXhpZgAASUkqAAgAAAAGABIBAwABAAAAAQAAABoBBQABAAAAVgAAABsBBQABAAAAXgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAZgAAAAAAAAAwAAAAAQAAADAAAAABAAAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAANQAAAADoAQAAQAAAFkAAAAAAAAA/+EM7Gh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8APD94cGFja2V0IGJlZ2luPSfvu78nIGlkPSdXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQnPz4KPHg6eG1wbWV0YSB4bWxuczp4PSdhZG9iZTpuczptZXRhLyc+CjxyZGY6UkRGIHhtbG5zOnJkZj0naHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyc+CgogPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9JycKICB4bWxuczpBdHRyaWI9J2h0dHA6Ly9ucy5hdHRyaWJ1dGlvbi5jb20vYWRzLzEuMC8nPgogIDxBdHRyaWI6QWRzPgogICA8cmRmOlNlcT4KICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0nUmVzb3VyY2UnPgogICAgIDxBdHRyaWI6Q3JlYXRlZD4yMDI0LTEyLTE2PC9BdHRyaWI6Q3JlYXRlZD4KICAgICA8QXR0cmliOkV4dElkPjI5ZjUzZDhmLWIwOTEtNDU0MS1hNzZkLWIxODNjODNmNGVmYzwvQXR0cmliOkV4dElkPgogICAgIDxBdHRyaWI6RmJJZD41MjUyNjU5MTQxNzk1ODA8L0F0dHJpYjpGYklkPgogICAgIDxBdHRyaWI6VG91Y2hUeXBlPjI8L0F0dHJpYjpUb3VjaFR5cGU+CiAgICA8L3JkZjpsaT4KICAgPC9yZGY6U2VxPgogIDwvQXR0cmliOkFkcz4KIDwvcmRmOkRlc2NyaXB0aW9uPgoKIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PScnCiAgeG1sbnM6ZGM9J2h0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvJz4KICA8ZGM6dGl0bGU+CiAgIDxyZGY6QWx0PgogICAgPHJkZjpsaSB4bWw6bGFuZz0neC1kZWZhdWx0Jz5Db3B5IG9mIERJcmVjdCBUcnVjayBTYWxlcyAtIDE8L3JkZjpsaT4KICAgPC9yZGY6QWx0PgogIDwvZGM6dGl0bGU+CiA8L3JkZjpEZXNjcmlwdGlvbj4KPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKPD94cGFja2V0IGVuZD0ndyc/Pv/bAEMABgQFBgUEBgYFBgcHBggKEAoKCQkKFA4PDBAXFBgYFxQWFhodJR8aGyMcFhYgLCAjJicpKikZHy0wLSgwJSgpKP/bAEMBBwcHCggKEwoKEygaFhooKCgoKCgoKCgo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';

// ── DOWC WARRANTY LEVELS ───────────────────────────────────────────────────────
const DOWC_LEVELS = {
  'Level 4': [
    { coverage:'12 / 75,000',           price:6022  },
    { coverage:'12 / 125,000',          price:6619  },
    { coverage:'24 / 125,000',          price:7378  },
    { coverage:'24 / 250,000',          price:7996  },
    { coverage:'36 / 250,000',          price:8634  },
    { coverage:'36 / 250,000 Enhanced', price:9160  },
    { coverage:'48 / 250,000',          price:10193 },
    { coverage:'48 / 500,000',          price:11033 },
  ],
  'Level 3': [
    { coverage:'12 / 75,000',           price:5222  },
    { coverage:'12 / 125,000',          price:5758  },
    { coverage:'24 / 125,000',          price:6518  },
    { coverage:'24 / 250,000',          price:7135  },
    { coverage:'36 / 250,000',          price:7773  },
    { coverage:'36 / 250,000 Enhanced', price:8300  },
    { coverage:'48 / 250,000',          price:9332  },
    { coverage:'48 / 500,000',          price:10173 },
  ],
  'Level 2': [
    { coverage:'12 / 75,000',           price:4624  },
    { coverage:'12 / 125,000',          price:5049  },
    { coverage:'24 / 125,000',          price:5657  },
    { coverage:'24 / 250,000',          price:6143  },
    { coverage:'36 / 250,000',          price:6659  },
    { coverage:'36 / 250,000 Enhanced', price:7085  },
    { coverage:'48 / 250,000',          price:7905  },
    { coverage:'48 / 500,000',          price:8573  },
  ],
  'Level 1': [
    { coverage:'12 / 75,000',           price:4169  },
    { coverage:'12 / 125,000',          price:4513  },
    { coverage:'24 / 125,000',          price:5009  },
    { coverage:'24 / 250,000',          price:5414  },
    { coverage:'36 / 250,000',          price:5829  },
    { coverage:'36 / 250,000 Enhanced', price:6173  },
    { coverage:'48 / 250,000',          price:6842  },
    { coverage:'48 / 500,000',          price:7388  },
  ],
};

// ── GOOGLE AUTH ────────────────────────────────────────────────────────────────
function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ credentials, scopes:['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version:'v4', auth });
}
function getDriveClient() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ credentials, scopes:['https://www.googleapis.com/auth/drive'] });
  return google.drive({ version:'v3', auth });
}

// ── AUTH MIDDLEWARE ────────────────────────────────────────────────────────────
// ── ROLE PERMISSIONS ──────────────────────────────────────────────────────────
// Add roles or features here. A role listed for a feature is allowed.
// admin implicitly has every feature.
const FEATURE_ACCESS = {
  closing: ['office', 'admin'],   // Sales cannot access closing package
  users:   ['admin'],
  audit:   ['admin'],
  dashboard: ['admin'],
  trash: ['admin'],
  inventory_profit: ['sales_lead','office','admin'],  // Don + up can reveal profit
  inventory_cost:   ['office','admin'],               // only office/admin see cost
  financing:        ['office','admin'],               // financing module: office + admin
  // leads, testdrive, billsofsale, inventory: open to all logged-in roles
};
function roleCan(role, feature) {
  if (role === 'admin') return true;
  const allowed = FEATURE_ACCESS[feature];
  if (!allowed) return true;            // unrestricted feature
  return allowed.includes(role);
}
// Build a permission object the frontend can use to show/hide UI.
function permissionsFor(role) {
  return {
    closing: roleCan(role, 'closing'),
    users:   roleCan(role, 'users'),
    audit:   roleCan(role, 'audit'),
    dashboard: roleCan(role, 'dashboard'),
    inventoryProfit: roleCan(role, 'inventory_profit'),
    inventoryCost: roleCan(role, 'inventory_cost'),
    financing: roleCan(role, 'financing'),
  };
}
function requireFeature(feature) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error:'Not authenticated' });
    if (!roleCan(req.user.role, feature)) {
      return res.status(403).json({ error:'Your role does not have access to this feature' });
    }
    next();
  };
}

async function requireSourcing(req, res, next) {
  if (!req.user) return res.status(401).json({ error:'Not authenticated' });
  try {
    const { rows } = await pgQuery('SELECT sourcing_access FROM users WHERE username=$1', [req.user.username]);
    const ok = (req.user.username === 'tom') || (rows.length ? !!rows[0].sourcing_access : false);
    if (!ok) return res.status(403).json({ error:'You do not have access to sourcing' });
    next();
  } catch(e) { return res.status(500).json({ error:'Access check failed' }); }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error:'No token' });
  try { req.user = jwt.verify(header.replace('Bearer ',''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error:'Invalid token' }); }
}

// ── HELPERS ────────────────────────────────────────────────────────────────────
const fmtPhone = (p) => {
  if (!p) return ['','',''];
  const d = p.replace(/\D/g,'');
  return [d.slice(0,3), d.slice(3,6), d.slice(6,10)];
};

// Normalize closing data to the chosen identity (personal vs business).
// When 'business', the form address fields are sourced from the business address
// and the business name leads. Mutates and returns d.
function applyClosingIdentity(d) {
  if (!d) return d;
  const identity = (d.identity || 'personal').toLowerCase();
  if (identity === 'business') {
    // Use business address for the address fields the forms read
    if (d.bizAddress) d.address = d.bizAddress;
    if (d.bizCity)    d.city    = d.bizCity;
    if (d.bizState)   d.state   = d.bizState;
    if (d.bizZip)     d.zip     = d.bizZip;
    // Ensure businessName is present so name lines lead with the business
    d._useBusiness = true;
  } else {
    d._useBusiness = false;
  }
  return d;
}

// ── INVENTORY COLUMN MAPPING (header-based, role-filtered) ────────────────────
// Maps a sheet's header row to canonical field names by fuzzy keyword match, so
// the real inventory sheet works regardless of column order or extra columns.
function buildInvHeaderMap(headerRow) {
  const map = {}; // canonical field -> column index
  // exact-match keys first (prevents 'price'/'trans' cross-matches), then contains.
  const want = {
    unit:        { exact:['unit','stock','stk'],            has:['unit','stock'] },
    year:        { exact:['year','yr'],                     has:['year'] },
    make:        { exact:['make'],                          has:['make'] },
    model:       { exact:['model'],                         has:['model'] },
    hours:       { exact:['hours','hrs'],                   has:['hour'] },
    miles:       { exact:['miles','mileage'],               has:['mile','odometer'] },
    trans:       { exact:['trans','transmission'],          has:['transmission'] },
    apu:         { exact:['apu'],                           has:['apu'] },
    vin:         { exact:['vin'],                           has:['vin'] },
    color:       { exact:['color','colour'],                has:['color','colour'] },
    ratio:       { exact:['ratio'],                         has:['ratio','rear'] },
    hp:          { exact:['hp','horsepower'],               has:['horsepower'] },
    purchaseP:   { exact:['purchase p','purchase price','purchase'], has:['purchase'] },
    transport:   { exact:['transport','freight','shipping'],has:['transport','freight'] },
    repairDot:   { exact:['repair/dot','repair','dot'],     has:['repair','dot'] },
    cleaningWarr:{ exact:['cleaning& warr','cleaning&warr','cleaning'], has:['cleaning','warr'] },
    docsFee:     { exact:['docs fee','doc fee','docs'],     has:['docs fee','doc fee'] },
    sellPrice:   { exact:['sell price','sale price','selling'], has:['sell'] },
    profit:      { exact:['profit','margin','gross'],       has:['profit','margin'] },
    listPrice:   { exact:['list price','list','asking','retail'], has:['list'] },
    status:      { exact:['status'],                        has:['status'] },
  };
  const headers = (headerRow||[]).map(h => String(h||'').trim().toLowerCase());
  // Pass 1: exact header matches
  for (const [field, cfg] of Object.entries(want)) {
    for (let i=0;i<headers.length;i++) {
      if (map[field]!=null) break;
      if (Object.values(map).includes(i)) continue;
      if (cfg.exact.includes(headers[i])) { map[field]=i; break; }
    }
  }
  // Pass 2: contains matches for anything still unmapped
  for (const [field, cfg] of Object.entries(want)) {
    if (map[field]!=null) continue;
    for (let i=0;i<headers.length;i++) {
      if (Object.values(map).includes(i)) continue;
      if (cfg.has.some(k => headers[i].includes(k))) { map[field]=i; break; }
    }
  }
  return map;
}

// Safe field set every role may see
const INV_SAFE_FIELDS = ['unit','year','make','model','hours','miles','trans','apu','color','ratio','hp','vin','status','listPrice','salePrice'];

// Build a row object filtered to what this role is allowed to see.
function invRowForRole(rowObj, role) {
  const out = {};
  for (const f of INV_SAFE_FIELDS) out[f] = rowObj[f] || '';
  if (roleCan(role, 'inventory_profit')) out.profit = rowObj.profit || '';
  if (roleCan(role, 'inventory_cost')) {
    out.purchaseP = rowObj.purchaseP || '';
    out.reconditioning = rowObj.reconditioning || '';  // combined recon total
  }
  return out;
}

const agentLine = (name, company) => {
  if (name && company) return `${name}, agent for ${company}`;
  return name || company || '';
};

async function fillPdfFields(formBytes, fieldMap) {
  const pdfDoc = await PDFDocument.load(formBytes, { ignoreEncryption:true });
  const form = pdfDoc.getForm();
  for (const [name, value] of Object.entries(fieldMap)) {
    try {
      const field = form.getField(name);
      const type  = field.constructor.name;
      if      (type === 'PDFTextField')  field.setText(String(value||''));
      else if (type === 'PDFCheckBox')   { if (value) field.check(); else field.uncheck(); }
      else if (type === 'PDFRadioGroup') field.select(String(value));
    } catch(e) {}
  }
  form.flatten();
  return await pdfDoc.save();
}


// ── RATE LIMITER (login brute-force protection) ────────────────────────────────
const loginAttempts = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > record.resetAt) { record.count = 0; record.resetAt = now + 15 * 60 * 1000; }
  record.count++;
  loginAttempts.set(ip, record);
  return record.count > 10; // block after 10 attempts per 15 min
}
// Clean up old entries every hour
setInterval(() => { const now = Date.now(); loginAttempts.forEach((v,k) => { if (now > v.resetAt) loginAttempts.delete(k); }); }, 3600000);


// ── INPUT SANITIZER (prevent spreadsheet formula injection) ───────────────────
function sanitize(val) {
  if (typeof val !== 'string') return val;
  // Strip leading characters that trigger spreadsheet formulas
  const trimmed = val.trim();
  if (['=','@','+','-','|','%'].includes(trimmed[0])) return "'" + trimmed;
  return trimmed;
}
function sanitizeObj(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    clean[k] = typeof v === 'string' ? sanitize(v) : (Array.isArray(v) ? v : sanitizeObj(v));
  }
  return clean;
}

// ── HEALTH ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status:'Dealer CRM API running' }));

// ── AUTH ───────────────────────────────────────────────────────────────────────
app.post('/auth/login', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
  }
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const uname = (username||'').toLowerCase();

  // Try the database first (bcrypt-hashed users)
  let authed = null;
  try {
    if (await pgAvailable()) {
      const { rows } = await pgQuery('SELECT username, password_hash, name, role, active, sourcing_access FROM users WHERE username=$1', [uname]);
      if (rows.length) {
        const u = rows[0];
        if (u.active === false) return res.status(403).json({ error:'Account disabled' });
        const ok = await bcrypt.compare(password, u.password_hash);
        if (ok) authed = { username:u.username, name:u.name, role:u.role, sourcing: (!!u.sourcing_access || u.username==='tom') };
        else return res.status(401).json({ error:'Invalid username or password' });
      }
    }
  } catch(e) { console.warn('DB auth failed, falling back to env users:', e.message); }

  // Fall back to env-var users only if the DB had no such user (transition safety)
  if (!authed) {
    const u = USERS.find(x => x.username === uname && x.password === password);
    if (!u) return res.status(401).json({ error:'Invalid username or password' });
    authed = { username:u.username, name:u.name, role:u.role, sourcing: (u.username==='tom') };
  }

  const token = jwt.sign(authed, JWT_SECRET, { expiresIn:'12h' });
  res.json({ token, name:authed.name, role:authed.role, permissions: permissionsFor(authed.role) });
});

// ── CURRENT USER (fresh permissions; lets the client self-heal stale sessions) ─
app.get('/me', requireAuth, async (req, res) => {
  let sourcing = (req.user.username === 'tom');
  try {
    const { rows } = await pgQuery('SELECT sourcing_access FROM users WHERE username=$1', [req.user.username]);
    if (rows.length && rows[0].sourcing_access) sourcing = true;
  } catch(e) { /* column may not exist yet; tom still true */ }
  res.json({
    name: req.user.name, role: req.user.role, username: req.user.username,
    permissions: Object.assign(permissionsFor(req.user.role), { sourcing }),
  });
});

// ── DOWC ───────────────────────────────────────────────────────────────────────
app.get('/dowc-levels', requireAuth, (req, res) => res.json(DOWC_LEVELS));

// ── LEADS ──────────────────────────────────────────────────────────────────────
app.get('/leads', requireAuth, async (req, res) => {
  try {
    if (await usePg()) { return res.json(await DBR.readLeads()); }
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:SHEET_NAME });
    const rows = response.data.values || [];
    if (rows.length <= 1) return res.json([]);
    const leads = rows.slice(1).map((r,i) => ({
      rowIndex:i+1, id:r[0]||'', first:r[1]||'', last:r[2]||'', company:r[3]||'',
      phone:r[4]||'', email:r[5]||'', unit:r[6]||'', source:r[7]||'',
      status:r[8]||'Prospect', sales:r[9]||'', followup:r[10]||'', notes:r[11]||'', archived:r[12]||'false',
      address:r[13]||'', city:r[14]||'', state:r[15]||'', zip:r[16]||'',
      bizAddress:r[17]||'', bizCity:r[18]||'', bizState:r[19]||'', bizZip:r[20]||'', bizPhone:r[21]||'',
      dlNumber:r[22]||'', dlState:r[23]||'',
      deals:(()=>{ try{ return r[24]?JSON.parse(r[24]):[]; }catch(e){ return []; } })(),
    }));
    res.json(leads);
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to load leads' }); }
});

app.post('/leads', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const l = sanitizeObj(req.body);
    const id = 'L'+Date.now();
    const archived = ['Sold','Dead'].includes(l.status) ? 'true' : 'false';
    if (WRITE_TO_SHEETS) await sheets.spreadsheets.values.append({
      spreadsheetId:SHEET_ID, range:SHEET_NAME, valueInputOption:'RAW', insertDataOption:'INSERT_ROWS',
      requestBody:{ values:[[id,l.first,l.last,l.company,l.phone,l.email,l.unit,l.source,l.status,l.sales,l.followup,l.notes,archived,
        l.address||'',l.city||'',l.state||'',l.zip||'',
        l.bizAddress||'',l.bizCity||'',l.bizState||'',l.bizZip||'',l.bizPhone||'',
        l.dlNumber||'',l.dlState||'',l.deals?JSON.stringify(l.deals):'']] }
    });
    await DBW.mirrorLeadInsert(id, l, req.user && req.user.username);
    res.json({ success:true, id });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to save lead' }); }
});

app.put('/leads/:rowIndex', requireAuth, async (req, res) => {
  try {
    const l = sanitizeObj(req.body);

    // Postgres is the source of truth — write it FIRST so the save can't be
    // lost by a Sheets hiccup. mirrorLeadUpdate throws if PG fails (primary mode).
    await DBW.mirrorLeadUpdate(l, req.user && req.user.username);

    // Best-effort Sheets mirror (only when enabled). Never blocks the save.
    if (WRITE_TO_SHEETS) {
      try {
        const sheets = getSheetsClient();
        const archived = ['Sold','Dead'].includes(l.status) ? 'true' : 'false';
        const rowValues = [l.id,l.first,l.last,l.company,l.phone,l.email,l.unit,l.source,l.status,l.sales,l.followup,l.notes,archived,
            l.address||'',l.city||'',l.state||'',l.zip||'',
            l.bizAddress||'',l.bizCity||'',l.bizState||'',l.bizZip||'',l.bizPhone||'',
            l.dlNumber||'',l.dlState||'',l.deals?JSON.stringify(l.deals):''];
        let sheetRow = parseInt(req.params.rowIndex)+1;
        if (l.id) {
          const resp = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:`${SHEET_NAME}!A:A` });
          const ids = (resp.data.values||[]).map(r => r[0]);
          const idx = ids.findIndex(x => x === l.id);
          if (idx >= 0) sheetRow = idx + 1;
        }
        await sheets.spreadsheets.values.update({
          spreadsheetId:SHEET_ID, range:`${SHEET_NAME}!A${sheetRow}:Y${sheetRow}`, valueInputOption:'RAW',
          requestBody:{ values:[rowValues] }
        });
      } catch(sheetErr) { console.warn('Lead Sheets mirror failed (PG saved):', sheetErr.message); }
    }
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to update lead' }); }
});



// ── SHEET TAB AUTO-CREATE ──────────────────────────────────────────────────────
async function ensureSheetTab(sheets, tabName) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const exists = (meta.data.sheets||[]).some(s => s.properties.title === tabName);
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] }
      });
      console.log('Created missing sheet tab:', tabName);
    }
  } catch(e) { console.warn('ensureSheetTab', tabName, e.message); }
}


// ── SAFE ROW APPEND: writes at explicit A-column position, immune to
//    Google Sheets append() table-detection quirks that shift columns ─────────
async function appendRowSafe(sheets, tab, rowValues) {
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: tab })
    .catch(() => ({ data: {} }));
  const nextRow = ((resp.data && resp.data.values) || []).length + 1;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `${tab}!A${nextRow}`, valueInputOption: 'RAW',
    requestBody: { values: [rowValues] }
  });
}

// ── LEAD ENRICHMENT: store client + deal info on the lead ─────────────────────
app.post('/leads/enrich', requireAuth, async (req, res) => {
  try {
    const { leadId, client } = sanitizeObj(req.body);
    if (!leadId) return res.status(400).json({ error:'leadId required' });

    // Postgres primary: merge the client info onto the lead. The deal itself is
    // captured relationally when the BOS/closing/test-drive row is saved with
    // this lead_id, so we no longer stuff a deals JSON blob anywhere.
    await DBW.mirrorLeadEnrich(leadId, client || {});

    // Best-effort Sheets mirror of the client fields (only when enabled)
    if (WRITE_TO_SHEETS) {
      try {
        const sheets = getSheetsClient();
        const response = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:SHEET_NAME });
        const rows = response.data.values || [];
        let rowNum = -1, row = null;
        for (let i = 1; i < rows.length; i++) {
          if ((rows[i][0]||'') === leadId) { rowNum = i + 1; row = rows[i]; break; }
        }
        if (rowNum > 0) {
          while (row.length < 25) row.push('');
          const c = client || {};
          const colMap = { address:13, city:14, state:15, zip:16, bizAddress:17, bizCity:18,
                           bizState:19, bizZip:20, bizPhone:21, dlNumber:22, dlState:23 };
          for (const [field, col] of Object.entries(colMap)) {
            if (c[field] && String(c[field]).trim()) row[col] = String(c[field]).trim();
          }
          if (c.phone   && !(row[4]||'').trim()) row[4] = String(c.phone).trim();
          if (c.email   && !(row[5]||'').trim()) row[5] = String(c.email).trim();
          if (c.company && !(row[3]||'').trim()) row[3] = String(c.company).trim();
          await sheets.spreadsheets.values.update({
            spreadsheetId:SHEET_ID, range:`${SHEET_NAME}!A${rowNum}:Y${rowNum}`, valueInputOption:'RAW',
            requestBody:{ values:[row.slice(0,25)] }
          });
        }
      } catch(sheetErr) { console.warn('Enrich Sheets mirror failed (PG saved):', sheetErr.message); }
    }
    res.json({ success:true });
  } catch(e) { console.error('enrich error', e); res.status(500).json({ error:'Failed to enrich lead' }); }
});


// ── USER MANAGEMENT (admin only) ──────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error:'Admin access required' });
  next();
}

app.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pgQuery('SELECT id, username, name, role, active, created_at FROM users ORDER BY username');
    res.json(rows);
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to load users' }); }
});

app.post('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, name, role } = sanitizeObj(req.body);
    if (!username || !password || !name) return res.status(400).json({ error:'Username, password, and name required' });
    if (String(password).length < 6) return res.status(400).json({ error:'Password must be at least 6 characters' });
    const uname = String(username).toLowerCase().trim();
    const hash = await bcrypt.hash(password, 10);
    await pgQuery(`INSERT INTO users (username, password_hash, name, role, active)
                  VALUES ($1,$2,$3,$4,TRUE)
                  ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, name=EXCLUDED.name, role=EXCLUDED.role`,
      [uname, hash, name, ['admin','office','sales','sales_lead'].includes(role)?role:'sales']);
    await audit2(req.user.username, 'create', 'user', uname, { name, role });
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to save user' }); }
});

app.put('/users/:username', requireAuth, requireAdmin, async (req, res) => {
  try {
    const target = (req.params.username||'').toLowerCase();
    const { password, name, role, active } = sanitizeObj(req.body);
    // Build dynamic update
    const sets = [], vals = []; let i = 1;
    if (name)            { sets.push(`name=$${i++}`); vals.push(name); }
    if (role)            { sets.push(`role=$${i++}`); vals.push(['admin','office','sales','sales_lead'].includes(role)?role:'sales'); }
    if (active !== undefined) { sets.push(`active=$${i++}`); vals.push(!!active); }
    if (password)        {
      if (String(password).length < 6) return res.status(400).json({ error:'Password must be at least 6 characters' });
      sets.push(`password_hash=$${i++}`); vals.push(await bcrypt.hash(password, 10));
    }
    if (!sets.length) return res.status(400).json({ error:'Nothing to update' });
    vals.push(target);
    await pgQuery(`UPDATE users SET ${sets.join(', ')} WHERE username=$${i}`, vals);
    await audit2(req.user.username, 'update', 'user', target, { fields: sets.map(s=>s.split('=')[0]) });
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to update user' }); }
});

app.delete('/users/:username', requireAuth, requireAdmin, async (req, res) => {
  try {
    const target = (req.params.username||'').toLowerCase();
    if (target === req.user.username) return res.status(400).json({ error:'You cannot delete your own account' });
    // Soft-delete: deactivate rather than remove, to preserve audit references
    await pgQuery('UPDATE users SET active=FALSE WHERE username=$1', [target]);
    await audit2(req.user.username, 'delete', 'user', target, null);
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to deactivate user' }); }
});

// ── PURCHASE EVALUATION / COMPS (office + admin only) ─────────────────────────
// Reads a historical purchases Google sheet and returns comparable past buys so
// you can judge whether a prospective purchase is a good deal.
function buildPurchaseHeaderMap(headerRow) {
  const want = {
    year:['year','yr'], make:['make'], model:['model'],
    miles:['mile','mileage','odometer'], hours:['hour','hrs'], apu:['apu'],
    price:['price','paid','cost','purchase','amount'], date:['date','purchased','bought'],
  };
  const headers = (headerRow||[]).map(h => String(h||'').trim().toLowerCase());
  const map = {};
  for (const [field, keys] of Object.entries(want)) {
    for (let i=0;i<headers.length;i++){ if(map[field]!=null)break; if(Object.values(map).includes(i))continue; if(keys.some(k=>headers[i]===k)){map[field]=i;break;} }
    if (map[field]==null) for (let i=0;i<headers.length;i++){ if(Object.values(map).includes(i))continue; if(keys.some(k=>headers[i].includes(k))){map[field]=i;break;} }
  }
  return map;
}

app.post('/evaluate-purchase', requireAuth, async (req, res) => {
  try {
    if (!(req.user.role === 'office' || req.user.role === 'admin'))
      return res.status(403).json({ error:'Not allowed' });

    const q = sanitizeObj(req.body);
    const num = (v) => { const n = parseFloat(String(v||'').replace(/[^0-9.]/g,'')); return isNaN(n)?null:n; };

    // Comps come from the SAME inventory sheet — every row with a Purchase P.
    const sheetId = PURCHASE_HISTORY_SHEET_ID || INV_SHEET_ID;
    const sheetTab = PURCHASE_HISTORY_SHEET_ID ? PURCHASE_HISTORY_TAB : INV_SHEET_TAB;
    const sheets = getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId:sheetId, range:sheetTab });
    const rows = resp.data.values || [];
    if (rows.length <= 1) return res.json({ comps:[], stats:null, message:'No inventory history found.' });
    const hmap = buildInvHeaderMap(rows[0]);
    const cell = (r, f) => hmap[f]!=null ? (r[hmap[f]]||'') : '';

    const qYear = num(q.year), qMiles = num(q.miles);
    const makeL = (q.make||'').trim().toLowerCase();
    const modelL = (q.model||'').trim().toLowerCase();
    const apuL = (q.apu||'').trim().toLowerCase();

    // Every row with a Purchase P counts as a past purchase.
    const all = rows.slice(1).map(r => {
      const recon = (num(cell(r,'transport'))||0) + (num(cell(r,'repairDot'))||0) + (num(cell(r,'cleaningWarr'))||0) + (num(cell(r,'docsFee'))||0);
      return {
        unit:cell(r,'unit'), year:cell(r,'year'), make:cell(r,'make'), model:cell(r,'model'),
        miles:cell(r,'miles'), hours:cell(r,'hours'), apu:cell(r,'apu'),
        purchaseP:num(cell(r,'purchaseP')),
        reconditioning: recon || null,
        sellPrice:num(cell(r,'sellPrice')), profit:num(cell(r,'profit')),
      };
    }).filter(x => x.purchaseP != null);

    const comps = all.filter(x => {
      const sameMake = makeL ? (x.make||'').toLowerCase().includes(makeL) || makeL.includes((x.make||'').toLowerCase()) : true;
      const sameModel = modelL ? (x.model||'').toLowerCase().includes(modelL) || modelL.includes((x.model||'').toLowerCase()) : true;
      return sameMake && sameModel;
    }).map(x => {
      let score = 0;
      if (qYear && num(x.year)) score += Math.abs(qYear - num(x.year)) * 2;
      if (qMiles && num(x.miles)) score += Math.abs(qMiles - num(x.miles)) / 50000;
      if (apuL && (x.apu||'').toLowerCase() !== apuL) score += 1;
      return { ...x, score };
    }).sort((a,b) => a.score - b.score).slice(0, 15);

    let stats = null;
    if (comps.length) {
      const prices = comps.map(c => c.purchaseP).sort((a,b)=>a-b);
      const sum = prices.reduce((a,b)=>a+b,0);
      const profits = comps.map(c=>c.profit).filter(p=>p!=null);
      stats = {
        count: prices.length,
        min: prices[0], max: prices[prices.length-1],
        avg: Math.round(sum / prices.length),
        median: prices[Math.floor(prices.length/2)],
        avgProfit: profits.length ? Math.round(profits.reduce((a,b)=>a+b,0)/profits.length) : null,
      };
    }
    res.json({ comps, stats, message: comps.length ? null : 'No comparable past purchases found for that make/model.' });
  } catch(e) { console.error('evaluate error', e); res.status(500).json({ error:'Evaluation failed' }); }
});

// ── IN-APP NOTIFICATIONS ──────────────────────────────────────────────────────
// List notifications visible to this user's role, with read/unread state.
app.get('/notifications', requireAuth, async (req, res) => {
  try {
    const role = (req.user && req.user.role) || '';
    const uname = req.user.username;
    const { rows } = await pgQuery(`
      SELECT n.*, (r.username IS NOT NULL) AS is_read
      FROM notifications n
      LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.username = $1
      ORDER BY n.created_at DESC LIMIT 100`, [uname]);
    const visible = rows.filter(n => {
      const roles = String(n.for_roles||'').split(',').map(s=>s.trim()).filter(Boolean);
      return roles.length === 0 || roles.includes(role);
    }).map(n => ({
      id: n.id, kind: n.kind, title: n.title, body: n.body,
      linkType: n.link_type||'', linkId: n.link_id||'',
      createdAt: n.created_at, read: !!n.is_read,
    }));
    res.json({ notifications: visible, unread: visible.filter(n => !n.read).length });
  } catch(e) { console.error('notifications error', e); res.status(500).json({ error:'Failed to load notifications' }); }
});

// Mark one (or all) notifications read for the current user.
app.post('/notifications/read', requireAuth, async (req, res) => {
  try {
    const uname = req.user.username;
    const id = req.body && req.body.id;
    if (id === 'all' || id == null) {
      // mark all currently-visible as read
      const role = (req.user && req.user.role) || '';
      const { rows } = await pgQuery('SELECT id, for_roles FROM notifications');
      for (const n of rows) {
        const roles = String(n.for_roles||'').split(',').map(s=>s.trim()).filter(Boolean);
        if (roles.length === 0 || roles.includes(role)) {
          await pgQuery(`INSERT INTO notification_reads (notification_id, username) VALUES ($1,$2)
            ON CONFLICT (notification_id, username) DO NOTHING`, [n.id, uname]);
        }
      }
    } else {
      await pgQuery(`INSERT INTO notification_reads (notification_id, username) VALUES ($1,$2)
        ON CONFLICT (notification_id, username) DO NOTHING`, [id, uname]);
    }
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to mark read' }); }
});

// ── UPCOMING UNITS (arriving inventory) ───────────────────────────────────────
// View: any logged-in user. Manage: office + admin (reuses 'closing' tier-ish;
// we gate writes to office/admin explicitly).
function canManageUpcoming(role) { return role === 'office' || role === 'admin'; }

app.get('/upcoming', requireAuth, async (req, res) => {
  try {
    const { rows } = await pgQuery('SELECT * FROM upcoming_units ORDER BY expected_date ASC NULLS LAST, created_at DESC');
    res.json(rows.map(r => ({
      id:r.id, year:r.year||'', make:r.make||'', model:r.model||'', miles:r.miles||'', hours:r.hours||'',
      apu:r.apu||'', color:r.color||'', hp:r.hp||'', ratio:r.ratio||'', vin:r.vin||'',
      expectedDate:r.expected_date||'', expectedPrice:r.expected_price||'', notes:r.notes||'',
      createdBy:r.created_by||'',
    })));
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to load upcoming units' }); }
});

app.post('/upcoming', requireAuth, async (req, res) => {
  try {
    if (!canManageUpcoming(req.user.role)) return res.status(403).json({ error:'Not allowed' });
    const d = sanitizeObj(req.body);
    if (d.id) {
      await pgQuery(`UPDATE upcoming_units SET year=$2,make=$3,model=$4,miles=$5,hours=$6,apu=$7,color=$8,
        hp=$9,ratio=$10,vin=$11,expected_date=$12,expected_price=$13,notes=$14 WHERE id=$1`,
        [d.id, d.year||'', d.make||'', d.model||'', d.miles||'', d.hours||'', d.apu||'', d.color||'',
         d.hp||'', d.ratio||'', d.vin||'', d.expectedDate||'', d.expectedPrice||'', d.notes||'']);
      await audit2(req.user.username, 'update', 'upcoming_unit', String(d.id), null);
    } else {
      const r = await pgQuery(`INSERT INTO upcoming_units (year,make,model,miles,hours,apu,color,hp,ratio,vin,
        expected_date,expected_price,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [d.year||'', d.make||'', d.model||'', d.miles||'', d.hours||'', d.apu||'', d.color||'', d.hp||'',
         d.ratio||'', d.vin||'', d.expectedDate||'', d.expectedPrice||'', d.notes||'', req.user.username]);
      await audit2(req.user.username, 'create', 'upcoming_unit', String(r.rows[0].id), { make:d.make, model:d.model });
    }
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to save upcoming unit' }); }
});

app.delete('/upcoming/:id', requireAuth, async (req, res) => {
  try {
    if (!canManageUpcoming(req.user.role)) return res.status(403).json({ error:'Not allowed' });
    await pgQuery('DELETE FROM upcoming_units WHERE id=$1', [req.params.id]);
    await audit2(req.user.username, 'delete', 'upcoming_unit', req.params.id, null);
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to delete' }); }
});

// ── INVENTORY DIAGNOSTIC (admin) — confirms which sheet + columns are connected ─
app.get('/debug/inventory', requireAuth, requireAdmin, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({ spreadsheetId:INV_SHEET_ID, range:INV_SHEET_TAB });
    const rows = response.data.values || [];
    const header = rows[0] || [];
    const hmap = buildInvHeaderMap(header);
    const mapped = {};
    for (const [field, idx] of Object.entries(hmap)) mapped[field] = { col: idx, header: header[idx] };
    res.json({
      sheetIdTail: '...' + String(INV_SHEET_ID).slice(-6),
      tab: INV_SHEET_TAB,
      usingRealSheet: !!process.env.INV_SHEET_ID,
      totalRows: rows.length,
      header,
      mappedColumns: mapped,
      costMapped: hmap.purchaseP != null,
      profitMapped: hmap.profit != null,
      firstRowSample: rows[1] || null,
    });
  } catch(e) { res.json({ error: e.message, hint: 'If this errors, the service account likely cannot read the sheet — share it with the service account email.' }); }
});

// ── CLIENT INVENTORY LIST PDF (any authenticated user) ────────────────────────
app.post('/inventory/client-pdf', requireAuth, async (req, res) => {
  try {
    const units = Array.isArray(req.body.units) ? req.body.units : [];
    if (!units.length) return res.status(400).json({ error:'No units provided' });

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const logo = await pdfDoc.embedJpg(Buffer.from(LOGO_B64,'base64'));
    const M = 40;
    const cols = [M, M+30, M+62, M+126, M+200, M+248, M+292, M+344, M+378, M+422, M+490];
    // right edge of each column's text area (next col start - small pad); last = page edge
    const colEnd = (i) => (i < cols.length-1 ? cols[i+1] - 4 : 612 - M);
    const colHeaders = ['Unit','Year','Make','Model','Miles','Hours','HP','Ratio','Color','APU','List price'];

    let page, width, height, y;
    const dt = (t,x,yy,o={}) => { try { page.drawText(String(t==null?'':t),{x,y:yy,size:o.size||9,font:o.bold?fontBold:font,color:o.color||rgb(0,0,0)}); } catch(e){} };
    // Trim text with an ellipsis so it never exceeds maxW points at the given size
    const fit = (t, maxW, size, useBold) => {
      let s = String(t==null?'':t);
      const f = useBold ? fontBold : font;
      if (f.widthOfTextAtSize(s, size) <= maxW) return s;
      while (s.length > 1 && f.widthOfTextAtSize(s + '…', size) > maxW) s = s.slice(0, -1);
      return s + '…';
    };
    function tableHeaderRow() {
      for (let i=0;i<colHeaders.length;i++) dt(fit(colHeaders[i], colEnd(i)-cols[i], 8.5, true), cols[i], y, { size:8.5, bold:true });
      y -= 5;
      page.drawLine({ start:{x:M,y}, end:{x:width-M,y}, thickness:0.6, color:rgb(0.3,0.3,0.3) });
      y -= 13;
    }
    function newPage(first) {
      page = pdfDoc.addPage([612, 792]);
      const s = page.getSize(); width = s.width; height = s.height; y = height - 44;
      // branded header
      try { const d = logo.scaleToFit(120,42); page.drawImage(logo, { x:M, y:y-d.height+8, width:d.width, height:d.height }); } catch(e){}
      const ax = width - M - 175;
      dt('Direct Truck Sales Inc.', ax, y, {bold:true});
      dt('15w740 N. Frontage Rd, Ste 2', ax, y-11, {size:8});
      dt('Burr Ridge, IL 60527', ax, y-21, {size:8});
      dt('630-701-1000', ax, y-31, {size:8});
      page.drawText('Sales@Direct-Truck.com', { x:ax, y:y-41, size:8, font, color:rgb(0,0.3,0.7) });
      y -= 60;
      page.drawRectangle({ x:M, y:y-16, width:width-M*2, height:22, color:rgb(0.12,0.12,0.12) });
      page.drawText('AVAILABLE UNITS', { x:width/2-48, y:y-9, size:12, font:fontBold, color:rgb(1,1,1) });
      y -= 34;
      tableHeaderRow();
    }

    newPage(true);
    for (const u of units) {
      if (y < 70) newPage(false);
      const vals = [u.unit,u.year,u.make,u.model,u.miles,u.hours,u.hp,u.ratio,u.color,u.apu,u.listPrice];
      for (let i=0;i<vals.length;i++) dt(fit(vals[i], colEnd(i)-cols[i], 8.5, false), cols[i], y, { size:8.5 });
      y -= 4;
      page.drawLine({ start:{x:M,y}, end:{x:width-M,y}, thickness:0.4, color:rgb(0.85,0.85,0.85) });
      y -= 13;
    }
    y -= 8;
    dt('Prices and availability subject to change. Contact us for current details.', M, y, { size:7.5, color:rgb(0.5,0.5,0.5) });

    const bytes = await pdfDoc.save();
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename="DirectTruckSales-Units.pdf"');
    res.send(Buffer.from(bytes));
  } catch(e) { console.error('client pdf error', e); res.status(500).json({ error:'PDF generation failed' }); }
});

// ── ADD INVENTORY UNIT (office + admin) — appends a row to the inventory sheet ─
app.post('/inventory/add', requireAuth, async (req, res) => {
  try {
    if (!(req.user.role === 'office' || req.user.role === 'admin'))
      return res.status(403).json({ error:'Only office or admin can add inventory' });

    const d = sanitizeObj(req.body);
    if (!d.unit && !d.make && !d.model)
      return res.status(400).json({ error:'At least a unit number, make, or model is required' });

    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({ spreadsheetId:INV_SHEET_ID, range:INV_SHEET_TAB });
    const rows = response.data.values || [];
    if (!rows.length) return res.status(400).json({ error:'Inventory sheet has no header row to map columns' });
    const header = rows[0];
    const hmap = buildInvHeaderMap(header);

    // Guard against duplicate unit numbers
    if (d.unit && hmap.unit != null) {
      const exists = rows.slice(1).some(r => String((r[hmap.unit]||'')).trim().toLowerCase() === String(d.unit).trim().toLowerCase());
      if (exists) return res.status(409).json({ error:`Unit "${d.unit}" already exists in the sheet` });
    }

    // Map the incoming fields to canonical header keys, then place each value in
    // the exact column the sheet uses (works regardless of column order).
    const fieldValues = {
      unit:d.unit, year:d.year, make:d.make, model:d.model, hours:d.hours, miles:d.miles,
      trans:d.trans, apu:d.apu, vin:d.vin, color:d.color, ratio:d.ratio, hp:d.hp,
      purchaseP:d.purchaseP, transport:d.transport, repairDot:d.repairDot,
      cleaningWarr:d.cleaningWarr, docsFee:d.docsFee, sellPrice:d.sellPrice,
      profit:d.profit, listPrice:d.listPrice, status:d.status || 'Available',
    };
    // Build a row sized to the header, placing each mapped field at its column index
    const rowValues = new Array(header.length).fill('');
    for (const [field, idx] of Object.entries(hmap)) {
      if (idx != null && idx < rowValues.length && fieldValues[field] != null && fieldValues[field] !== '') {
        rowValues[idx] = String(fieldValues[field]);
      }
    }

    // Append at the next empty row of the INVENTORY sheet (A column anchored)
    const nextRow = rows.length + 1;
    const lastColLetter = (n) => { let s=''; n=n+1; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26);} return s; };
    const endCol = lastColLetter(Math.max(header.length, rowValues.length) - 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId: INV_SHEET_ID,
      range: `${INV_SHEET_TAB}!A${nextRow}:${endCol}${nextRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [rowValues] },
    });

    // Mirror to Postgres copy so the fallback + dashboard stay current
    const num = (v) => { const n = parseFloat(String(v||'').replace(/[^0-9.]/g,'')); return isNaN(n)?0:n; };
    const recon = num(d.transport) + num(d.repairDot) + num(d.cleaningWarr) + num(d.docsFee);
    try {
      await DBW.mirrorInventory([{
        unit:d.unit||'', year:d.year||'', make:d.make||'', model:d.model||'', hours:d.hours||'',
        miles:d.miles||'', trans:d.trans||'', apu:d.apu||'', color:d.color||'', ratio:d.ratio||'',
        hp:d.hp||'', listPrice:d.listPrice||'', salePrice:d.sellPrice||'', status:d.status||'Available',
        vin:d.vin||'', cost:d.purchaseP||'', profit:d.profit||'',
      }]);
    } catch(e) { /* sheet is source of truth; mirror is best-effort */ }

    await audit2(req.user.username, 'create', 'inventory_unit', String(d.unit||d.vin||''), { make:d.make, model:d.model });
    res.json({ success:true });
  } catch(e) {
    console.error('inventory add error', e);
    res.status(500).json({ error:'Failed to add unit. The service account may need EDIT access to the sheet.' });
  }
});

// ── INVENTORY STATUS UPDATE — writes the Status cell back to the sheet ─────────
// Any authenticated user (incl. sales) may set a unit's status.
app.post('/inventory/status', requireAuth, async (req, res) => {
  try {
    const { unit, status } = sanitizeObj(req.body);
    if (!unit || !status) return res.status(400).json({ error:'unit and status required' });
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({ spreadsheetId:INV_SHEET_ID, range:INV_SHEET_TAB });
    const rows = response.data.values || [];
    if (rows.length <= 1) return res.status(404).json({ error:'Inventory sheet empty' });
    const hmap = buildInvHeaderMap(rows[0]);
    if (hmap.unit == null || hmap.status == null)
      return res.status(400).json({ error:'Could not locate Unit or Status column in the sheet' });
    // Find the row whose unit cell matches
    let rowNum = -1;
    for (let i=1;i<rows.length;i++) {
      if (String((rows[i][hmap.unit]||'')).trim() === String(unit).trim()) { rowNum = i+1; break; }
    }
    if (rowNum < 0) return res.status(404).json({ error:'Unit not found in sheet' });
    // Convert status column index to an A1 column letter
    const colLetter = (n) => { let s=''; n=n+1; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26);} return s; };
    const cell = `${INV_SHEET_TAB}!${colLetter(hmap.status)}${rowNum}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId:INV_SHEET_ID, range:cell, valueInputOption:'RAW',
      requestBody:{ values:[[status]] }
    });
    // Mirror to Postgres copy
    try { await pgQuery('UPDATE inventory SET status=$2 WHERE unit=$1', [String(unit), status]); } catch(e) {}
    await audit2(req.user.username, 'update', 'inventory_status', String(unit), { status });
    res.json({ success:true });
  } catch(e) {
    console.error('status update error', e);
    res.status(500).json({ error: 'Failed to update status. The service account may need EDIT access to the sheet.' });
  }
});

// ── FINANCING APPLICATIONS (office + admin) ───────────────────────────────────
const FIN_FIELDS = ['lead_id','app_type','status','first_name','last_name','email','phone','dob',
  'ssn_last4','home_address','home_city','home_state','home_zip','years_address','housing_status',
  'monthly_housing','employer','job_title','years_employed','annual_income','drivers_license','dl_state',
  'business_name','ein','business_type','years_in_business','business_address','business_city',
  'business_state','business_zip','business_phone','dot_number','mc_number','num_trucks','annual_revenue',
  'unit','vehicle_desc','purchase_price','down_payment','amount_financed','term_months',
  'consent_signed','consent_date','credit_score','paynet_score','credit_notes',
  'open_trades','first_time_buyer','avg_deposits','avg_daily_balance','nsf_count',
  'lender_id','lender_name','notes'];
// camelCase (frontend) <-> snake_case (db)
const toSnake = (s) => s.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
const toCamel = (s) => s.replace(/_([a-z0-9])/g, (_,c) => c.toUpperCase());

app.get('/financing', requireAuth, requireFeature('financing'), async (req, res) => {
  try {
    const { rows } = await pgQuery(`SELECT * FROM financing_applications WHERE deleted_at IS NULL ORDER BY updated_at DESC`);
    res.json(rows.map(r => {
      const o = {};
      for (const k of Object.keys(r)) o[toCamel(k)] = r[k];
      return o;
    }));
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to load financing applications' }); }
});

app.get('/financing/:id', requireAuth, requireFeature('financing'), async (req, res) => {
  try {
    const { rows } = await pgQuery(`SELECT * FROM financing_applications WHERE id=$1 AND deleted_at IS NULL`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error:'Not found' });
    const r = rows[0], o = {};
    for (const k of Object.keys(r)) o[toCamel(k)] = r[k];
    res.json(o);
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to load application' }); }
});

app.post('/financing', requireAuth, requireFeature('financing'), async (req, res) => {
  try {
    const d = sanitizeObj(req.body);
    // Never store more than last 4 of SSN, even if more is sent
    if (d.ssnLast4) d.ssnLast4 = String(d.ssnLast4).replace(/\D/g,'').slice(-4);
    const id = d.id || 'FIN' + Date.now();
    const cols = ['id'], vals = [id], ph = ['$1']; let i = 2;
    for (const snake of FIN_FIELDS) {
      const camel = toCamel(snake);
      let v = d[camel];
      if (snake === 'consent_signed' || snake === 'first_time_buyer') v = (v === true || v === 'true') ? true : false;
      if (v === undefined) v = (snake === 'consent_signed') ? false : (snake === 'first_time_buyer' ? true : '');
      cols.push(snake); vals.push(v); ph.push('$'+i); i++;
    }
    const existing = await pgQuery('SELECT id FROM financing_applications WHERE id=$1', [id]);
    if (existing.rows.length) {
      // update
      const sets = FIN_FIELDS.map((s, idx) => `${s}=$${idx+2}`).join(', ');
      await pgQuery(`UPDATE financing_applications SET ${sets}, updated_at=now() WHERE id=$1`,
        [id, ...FIN_FIELDS.map(s => { const c=toCamel(s); let v=d[c]; if(s==='consent_signed'||s==='first_time_buyer') v=(v===true||v==='true'); if(v===undefined) v=(s==='consent_signed'?false:(s==='first_time_buyer'?true:'')); return v; })]);
      await audit2(req.user.username, 'update', 'financing', id, null);
    } else {
      await pgQuery(`INSERT INTO financing_applications (${cols.join(',')}, created_by) VALUES (${ph.join(',')}, $${i})`,
        [...vals, req.user.username]);
      await audit2(req.user.username, 'create', 'financing', id, { type:d.appType });
    }
    res.json({ success:true, id });
  } catch(e) { console.error('financing save error', e); res.status(500).json({ error:'Failed to save application' }); }
});

app.post('/financing/:id/submit', requireAuth, requireFeature('financing'), async (req, res) => {
  try {
    const { lenderId, lenderName } = sanitizeObj(req.body);
    await pgQuery(`UPDATE financing_applications SET lender_id=$2, lender_name=$3,
      status='Submitted to Lender', submitted_at=now(), updated_at=now() WHERE id=$1`,
      [req.params.id, lenderId||'', lenderName||'']);
    await audit2(req.user.username, 'submit', 'financing', req.params.id, { lender: lenderName });
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to submit' }); }
});

app.post('/financing/:id/delete', requireAuth, requireFeature('financing'), async (req, res) => {
  try {
    await pgQuery(`UPDATE financing_applications SET deleted_at=now(), deleted_by=$2 WHERE id=$1`,
      [req.params.id, req.user.username]);
    await audit2(req.user.username, 'delete', 'financing', req.params.id, null);
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to delete' }); }
});

// ── LENDERS ───────────────────────────────────────────────────────────────────
app.get('/lenders', requireAuth, requireFeature('financing'), async (req, res) => {
  try {
    const { rows } = await pgQuery('SELECT * FROM lenders WHERE active=TRUE ORDER BY name');
    res.json(rows);
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to load lenders' }); }
});
app.post('/lenders', requireAuth, requireFeature('financing'), async (req, res) => {
  try {
    const d = sanitizeObj(req.body);
    const ftOk = (d.firstTimeOk === false || d.firstTimeOk === 'false') ? false : true;
    const crit = [d.minCredit||'', d.minPaynet||'', ftOk, d.minYearsBiz||'', d.maxTruckAge||'',
      d.maxTruckMiles||'', d.minAmount||'', d.maxAmount||'', d.minDownPct||'', d.termsOffered||''];
    if (d.id) {
      await pgQuery(`UPDATE lenders SET name=$2,contact=$3,email=$4,phone=$5,notes=$6,specialties=$7,
        min_credit=$8,min_paynet=$9,first_time_ok=$10,min_years_biz=$11,max_truck_age=$12,
        max_truck_miles=$13,min_amount=$14,max_amount=$15,min_down_pct=$16,terms_offered=$17 WHERE id=$1`,
        [d.id, d.name||'', d.contact||'', d.email||'', d.phone||'', d.notes||'', d.specialties||'', ...crit]);
    } else {
      await pgQuery(`INSERT INTO lenders (name,contact,email,phone,notes,specialties,
        min_credit,min_paynet,first_time_ok,min_years_biz,max_truck_age,max_truck_miles,
        min_amount,max_amount,min_down_pct,terms_offered)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [d.name||'', d.contact||'', d.email||'', d.phone||'', d.notes||'', d.specialties||'', ...crit]);
    }
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to save lender' }); }
});
app.delete('/lenders/:id', requireAuth, requireFeature('financing'), async (req, res) => {
  try { await pgQuery('UPDATE lenders SET active=FALSE WHERE id=$1', [req.params.id]); res.json({ success:true }); }
  catch(e) { res.status(500).json({ error:'Failed to remove lender' }); }
});

// ── REPAIR / TO-FIX ITEMS (visible to all; anyone may clear) ──────────────────
app.get('/repair-items', requireAuth, async (req, res) => {
  try {
    const { rows } = await pgQuery(`SELECT * FROM repair_items ORDER BY status ASC, created_at DESC`);
    const pending = [], done = [];
    for (const r of rows) {
      const o = { id:r.id, bosId:r.bos_id, unit:r.unit, vehicleDesc:r.vehicle_desc,
        slot:r.item_slot, description:r.description, status:r.status,
        source:r.source||'bos', docLink:r.doc_link||'', priority:r.priority||'', createdBy:r.created_by||'',
        completedBy:r.completed_by||'', completedAt:r.completed_at, createdAt:r.created_at };
      (r.status === 'done' ? done : pending).push(o);
    }
    // group pending by unit for the panel
    const byUnit = {};
    for (const p of pending) {
      const key = p.unit || '(no unit)';
      byUnit[key] = byUnit[key] || { unit:p.unit, vehicleDesc:p.vehicleDesc, items:[] };
      byUnit[key].items.push(p);  // p already carries source/docLink/priority
    }
    res.json({ pendingByUnit: Object.values(byUnit), done, pendingCount: pending.length });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to load repair items' }); }
});

app.post('/repair-items/:id/done', requireAuth, async (req, res) => {
  try {
    await pgQuery(`UPDATE repair_items SET status='done', completed_by=$2, completed_at=now() WHERE id=$1`,
      [req.params.id, req.user.username]);
    await audit2(req.user.username, 'complete', 'repair_item', req.params.id, null);
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to mark done' }); }
});

// Re-open a completed item (undo)
app.post('/repair-items/:id/reopen', requireAuth, async (req, res) => {
  try {
    await pgQuery(`UPDATE repair_items SET status='pending', completed_by='', completed_at=NULL WHERE id=$1`, [req.params.id]);
    await audit2(req.user.username, 'reopen', 'repair_item', req.params.id, null);
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to reopen' }); }
});

// ── LENDER OUTCOMES (approval/decline history) ────────────────────────────────
app.post('/lender-outcomes', requireAuth, requireFeature('financing'), async (req, res) => {
  try {
    const d = sanitizeObj(req.body);
    if (!d.lenderName && !d.lenderId) return res.status(400).json({ error:'Lender required' });
    if (!['approved','declined'].includes(d.outcome)) return res.status(400).json({ error:"Outcome must be 'approved' or 'declined'" });
    await pgQuery(`INSERT INTO lender_outcomes (lender_id, lender_name, financing_id, outcome,
      credit_score, paynet_score, first_time, years_in_business, open_trades,
      avg_deposits, avg_daily_balance, nsf_count, truck_year, truck_miles, amount, down_pct,
      approved_term, approved_rate, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [d.lenderId||null, d.lenderName||'', d.financingId||'', d.outcome,
       d.creditScore||'', d.paynetScore||'', (d.firstTime===true||d.firstTime==='true'),
       d.yearsInBusiness||'', d.openTrades||'', d.avgDeposits||'', d.avgDailyBalance||'',
       d.nsfCount||'', d.truckYear||'', d.truckMiles||'', d.amount||'', d.downPct||'',
       d.approvedTerm||'', d.approvedRate||'', d.notes||'', req.user.username]);
    await audit2(req.user.username, 'create', 'lender_outcome', d.lenderName||String(d.lenderId), { outcome:d.outcome });
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to log outcome' }); }
});

app.get('/lender-outcomes', requireAuth, requireFeature('financing'), async (req, res) => {
  try {
    const { rows } = await pgQuery('SELECT * FROM lender_outcomes ORDER BY created_at DESC LIMIT 200');
    res.json(rows);
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to load outcomes' }); }
});

// ── LENDER MATCHING ENGINE ────────────────────────────────────────────────────
// Input: client factors. Output: lenders that qualify by stated criteria, ranked
// by REAL historical approval rate for similar client profiles, plus the lenders
// that don't qualify and exactly why.
app.post('/lender-match', requireAuth, requireFeature('financing'), async (req, res) => {
  try {
    const q = sanitizeObj(req.body);
    const num = (v) => { const n = parseFloat(String(v??'').replace(/[^0-9.\-]/g,'')); return isNaN(n)?null:n; };
    const c = {
      credit: num(q.creditScore), paynet: num(q.paynetScore),
      firstTime: (q.firstTime===true||q.firstTime==='true'),
      yearsBiz: num(q.yearsInBusiness), openTrades: num(q.openTrades),
      avgDeposits: num(q.avgDeposits), avgDailyBalance: num(q.avgDailyBalance), nsf: num(q.nsfCount),
      truckYear: num(q.truckYear), truckMiles: num(q.truckMiles),
      amount: num(q.amount), downPct: num(q.downPct),
    };
    const nowYear = new Date().getFullYear();
    const truckAge = c.truckYear != null ? (nowYear - c.truckYear) : null;

    const lenders = (await pgQuery('SELECT * FROM lenders WHERE active=TRUE ORDER BY name')).rows;
    const outcomes = (await pgQuery('SELECT * FROM lender_outcomes')).rows;

    // similarity: same first-time status, credit within ±50, amount within ±40%
    const similarTo = (o) => {
      if ((o.first_time===true) !== c.firstTime) return false;
      const oc = num(o.credit_score);
      if (c.credit != null && oc != null && Math.abs(oc - c.credit) > 50) return false;
      const oa = num(o.amount);
      if (c.amount != null && oa != null && (oa < c.amount*0.6 || oa > c.amount*1.4)) return false;
      return true;
    };

    const qualified = [], notQualified = [];
    for (const L of lenders) {
      const fails = [];
      const chk = (cond, msg) => { if (cond) fails.push(msg); };
      const mn = (v) => num(v);
      if (mn(L.min_credit) != null && c.credit != null && c.credit < mn(L.min_credit)) chk(true, `Credit ${c.credit} below minimum ${mn(L.min_credit)}`);
      if (mn(L.min_paynet) != null && c.paynet != null && c.paynet < mn(L.min_paynet)) chk(true, `PayNet ${c.paynet} below minimum ${mn(L.min_paynet)}`);
      if (L.first_time_ok === false && c.firstTime) chk(true, 'Does not accept first-time buyers');
      if (mn(L.min_years_biz) != null && c.yearsBiz != null && c.yearsBiz < mn(L.min_years_biz)) chk(true, `${c.yearsBiz} yrs in business below minimum ${mn(L.min_years_biz)}`);
      if (mn(L.max_truck_age) != null && truckAge != null && truckAge > mn(L.max_truck_age)) chk(true, `Truck age ${truckAge}yr over limit ${mn(L.max_truck_age)}`);
      if (mn(L.max_truck_miles) != null && c.truckMiles != null && c.truckMiles > mn(L.max_truck_miles)) chk(true, `Miles ${c.truckMiles.toLocaleString()} over limit ${mn(L.max_truck_miles).toLocaleString()}`);
      if (mn(L.min_amount) != null && c.amount != null && c.amount < mn(L.min_amount)) chk(true, `Amount below lender minimum $${mn(L.min_amount).toLocaleString()}`);
      if (mn(L.max_amount) != null && c.amount != null && c.amount > mn(L.max_amount)) chk(true, `Amount above lender maximum $${mn(L.max_amount).toLocaleString()}`);
      if (mn(L.min_down_pct) != null && c.downPct != null && c.downPct < mn(L.min_down_pct)) chk(true, `Down ${c.downPct}% below required ${mn(L.min_down_pct)}%`);

      // history for this lender
      const lo = outcomes.filter(o => (o.lender_id===L.id) || (o.lender_name && o.lender_name===L.name));
      const sim = lo.filter(similarTo);
      const simA = sim.filter(o=>o.outcome==='approved').length;
      const simD = sim.filter(o=>o.outcome==='declined').length;
      const allA = lo.filter(o=>o.outcome==='approved').length;
      const allD = lo.filter(o=>o.outcome==='declined').length;
      // Laplace-smoothed approval rate so 1-for-1 doesn't beat 8-for-10
      const score = (simA + 1) / (simA + simD + 2);
      const lastApproved = sim.filter(o=>o.outcome==='approved')
        .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0] || null;

      const entry = {
        id: L.id, name: L.name, email: L.email||'', specialties: L.specialties||'',
        termsOffered: L.terms_offered||'',
        history: {
          similarApprovals: simA, similarDeclines: simD,
          totalApprovals: allA, totalDeclines: allD,
          similarRate: (simA+simD) ? Math.round(simA/(simA+simD)*100) : null,
          lastApprovedTerms: lastApproved ? { term:lastApproved.approved_term, rate:lastApproved.approved_rate, when:lastApproved.created_at } : null,
        },
        score,
      };
      if (fails.length) { entry.reasons = fails; notQualified.push(entry); }
      else qualified.push(entry);
    }
    qualified.sort((a,b) => b.score - a.score || (b.history.similarApprovals - a.history.similarApprovals));
    res.json({ qualified, notQualified, clientSummary: c });
  } catch(e) { console.error('lender match error', e); res.status(500).json({ error:'Match failed' }); }
});

// ── WORK ORDERS → Google Doc in shared shop folder (all roles) ────────────────
app.get('/debug/work-orders', requireAuth, requireAdmin, async (req, res) => {
  const out = { folderIdSet: !!process.env.WORK_ORDER_FOLDER_ID, credsSet: !!process.env.GOOGLE_CREDENTIALS };
  try {
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
    out.serviceAccountEmail = creds.client_email || '(missing client_email in GOOGLE_CREDENTIALS)';
    out.projectId = creds.project_id || '';
  } catch(e) { out.serviceAccountEmail = '(GOOGLE_CREDENTIALS is not valid JSON)'; }

  const folderId = (process.env.WORK_ORDER_FOLDER_ID || '').trim().replace(/[.\/\s]+$/,'');
  out.folderIdFull = folderId || '(not set)';
  if (!folderId) { out.result = 'WORK_ORDER_FOLDER_ID env var is not set.'; return res.json(out); }

  let drive;
  try { drive = getDriveClient(); }
  catch(e) { out.result = 'Could not build Drive client: ' + e.message; return res.json(out); }

  // 1) Try the exact folder, and capture the HTTP status (404 = cannot see, 403 = seen but forbidden)
  try {
    const meta = await drive.files.get({ fileId: folderId, fields:'id,name,mimeType,driveId,owners(emailAddress)', supportsAllDrives:true });
    out.folderFound = true;
    out.folderName = meta.data.name;
    out.mimeType = meta.data.mimeType;
    out.isInSharedDrive = !!meta.data.driveId;
    out.owner = (meta.data.owners && meta.data.owners[0]) ? meta.data.owners[0].emailAddress : '(hidden / shared drive)';
  } catch(e) {
    out.folderFound = false;
    out.httpStatus = (e && e.code) ? e.code : (e.response && e.response.status) || '';
    out.driveError = (e && e.message) ? e.message : String(e);
  }

  // 2) What Shared Drives is this service account a member of?
  try {
    const dl = await drive.drives.list({ pageSize: 20, fields: 'drives(id,name)' });
    out.sharedDrivesVisible = (dl.data.drives || []).map(x => ({ id:x.id, name:x.name }));
  } catch(e) { out.sharedDrivesVisible = 'error: ' + e.message; }

  // 3) What folders can the service account see at all? (this proves whether the share landed)
  try {
    const fl = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: 'files(id,name,driveId)', pageSize: 25,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    out.foldersVisibleToServiceAccount = (fl.data.files || []).map(f => ({ id:f.id, name:f.name, inSharedDrive: !!f.driveId }));
    out.folderIsInVisibleList = (fl.data.files || []).some(f => f.id === folderId);
  } catch(e) { out.foldersVisibleToServiceAccount = 'error: ' + e.message; }

  // 4) Plain-language conclusion
  if (out.folderFound) {
    try {
      const test = await drive.files.create({
        requestBody: { name:'__wo_permission_test__', mimeType:'application/vnd.google-apps.document', parents:[folderId] },
        fields:'id', supportsAllDrives:true,
      });
      await drive.files.delete({ fileId: test.data.id, supportsAllDrives: true });
      out.canWrite = true;
      out.result = 'SUCCESS — the service account can read AND write this folder. Work orders should work now.';
    } catch(werr) {
      out.canWrite = false;
      out.writeError = werr.message || String(werr);
      if (/storage quota/i.test(out.writeError)) {
        out.result = 'The folder is visible but writing failed because SERVICE ACCOUNTS HAVE NO STORAGE QUOTA in a personal My Drive. Fix: move the work-order folder into a SHARED DRIVE and add the service account as a member (Content Manager). Files in a Shared Drive are owned by the drive, not the service account, so this restriction goes away.';
      } else {
        out.result = 'Folder is visible but not writable — give the service account EDITOR (not Viewer).';
      }
    }
  } else {
    const visible = Array.isArray(out.foldersVisibleToServiceAccount) ? out.foldersVisibleToServiceAccount.length : 0;
    out.result = 'Google returned "not found" for this ID. Google reports BOTH "missing" and "no access" as not-found. ' +
      'The service account can currently see ' + visible + ' folder(s). ' +
      (visible ? 'Compare the list above: if your work-order folder is NOT in it, the share never reached this service account. ' : 'It can see NOTHING, so no share has reached this service account yet. ') +
      'Most common causes when a folder is owned by someone else: (a) the share was added to a different email/typo; (b) your Google Workspace admin blocks sharing outside the organization, so adding a service account silently fails; (c) the folder lives in a Shared Drive and the service account must be added as a MEMBER of that Shared Drive, not just the folder. ' +
      'The period at the end of Google\'s message is only sentence punctuation, not part of the ID.';
  }
  res.json(out);
});

app.post('/work-orders', requireAuth, async (req, res) => {
  try {
    const d = sanitizeObj(req.body);
    const items = Array.isArray(d.items) ? d.items.filter(x => x && String(x).trim()) : [];
    if (!d.unit && !items.length)
      return res.status(400).json({ error:'A unit number and at least one issue are required' });

    const folderId = (process.env.WORK_ORDER_FOLDER_ID || '').trim().replace(/[.\/\s]+$/,'');
    if (!folderId)
      return res.status(400).json({ error:'Work-order folder not configured (set WORK_ORDER_FOLDER_ID to the shared Drive folder).' });

    const inspectedBy = d.inspectedBy || (req.user && req.user.name) || (req.user && req.user.username) || '';
    const date = d.date || new Date().toISOString().split('T')[0];
    const priority = d.priority || 'Normal';
    const esc = (s) => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // Build an HTML body; Drive converts text/html → a native Google Doc.
    const rowsHtml = items.map((it,i) =>
      `<tr><td style="padding:6px 10px;border:1px solid #ccc;">${i+1}</td>` +
      `<td style="padding:6px 10px;border:1px solid #ccc;">${esc(it)}</td>` +
      `<td style="padding:6px 10px;border:1px solid #ccc;">&#9744;</td></tr>`).join('');
    const html = `<html><body style="font-family:Arial,sans-serif;">
      <h1 style="margin-bottom:2px;">Work Order</h1>
      <div style="color:#666;font-size:13px;margin-bottom:14px;">Direct Truck Sales Inc. — Shop</div>
      <table style="font-size:14px;margin-bottom:16px;">
        <tr><td style="padding:3px 12px 3px 0;color:#888;">Unit #</td><td style="font-weight:bold;">${esc(d.unit)}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#888;">Vehicle</td><td>${esc(d.vehicleDesc||'')}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#888;">Priority</td><td style="font-weight:bold;">${esc(priority)}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#888;">Inspected by</td><td>${esc(inspectedBy)}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#888;">Date</td><td>${esc(date)}</td></tr>
      </table>
      <h3 style="margin-bottom:4px;">Issues found</h3>
      <table style="border-collapse:collapse;font-size:14px;width:100%;">
        <tr style="background:#f0f0f0;"><th style="padding:6px 10px;border:1px solid #ccc;text-align:left;">#</th>
        <th style="padding:6px 10px;border:1px solid #ccc;text-align:left;">Issue</th>
        <th style="padding:6px 10px;border:1px solid #ccc;text-align:left;">Done</th></tr>
        ${rowsHtml}
      </table>
      ${d.notes ? `<h3 style="margin-bottom:4px;margin-top:16px;">Notes</h3><div style="font-size:14px;white-space:pre-wrap;">${esc(d.notes)}</div>` : ''}
      </body></html>`;

    const drive = getDriveClient();
    const title = `Work Order — Unit ${d.unit||'?'} — ${date}`;
    const created = await drive.files.create({
      requestBody: { name: title, mimeType: 'application/vnd.google-apps.document', parents: [folderId] },
      media: { mimeType: 'text/html', body: html },
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    });
    const link = created.data.webViewLink || ('https://docs.google.com/document/d/' + created.data.id);

    // Record each issue in repair_items so it appears in the Repairs panel for sales to verify.
    const woKey = 'WO' + Date.now();
    try {
      for (let s = 0; s < items.length; s++) {
        await pgQuery(`
          INSERT INTO repair_items (bos_id, unit, vehicle_desc, item_slot, description, status, source, doc_link, priority, created_by)
          VALUES ($1,$2,$3,$4,$5,'pending','work_order',$6,$7,$8)
          ON CONFLICT (bos_id, unit, item_slot) DO NOTHING`,
          [woKey, d.unit||'', d.vehicleDesc||'', s+1, items[s], link, priority, inspectedBy]);
      }
    } catch(recErr) { console.warn('[work-order] repair_items record failed:', recErr.message); }

    await audit2(req.user.username, 'create', 'work_order', String(d.unit||''), { items: items.length, priority });
    res.json({ success:true, docId: created.data.id, link, tracked: items.length });
  } catch(e) {
    console.error('work order error', e);
    const msg = (e && e.message) ? e.message : 'unknown error';
    res.status(500).json({ error:'Failed to create work order: ' + msg + ' — Admins: open the Work order screen and run the diagnostic for details.' });
  }
});

// ── SOURCING (private acquisition pipeline; Tom + allowlisted users) ───────────
const toCamelS = (s) => s.replace(/_([a-z0-9])/g, (_,c)=>c.toUpperCase());
const SOURCING_FIELDS = ['name','dot_number','mc_number','contact_name','contact_phone','contact_email',
  'city','state','fleet_size','cycle_years','last_purchase_year','next_contact_date','status','notes'];

app.get('/sourcing/companies', requireAuth, requireSourcing, async (req, res) => {
  try {
    const { rows } = await pgQuery('SELECT * FROM sourcing_companies WHERE deleted_at IS NULL ORDER BY updated_at DESC');
    const units = (await pgQuery('SELECT * FROM sourcing_units ORDER BY found_date DESC')).rows;
    const byCo = {};
    for (const u of units) { (byCo[u.company_id] = byCo[u.company_id] || []).push({
      id:u.id, year:u.year, make:u.make, model:u.model, qty:u.qty, vin:u.vin,
      foundWhere:u.found_where, foundDate:u.found_date, notes:u.notes }); }
    res.json(rows.map(r => {
      const o = {}; for (const k of Object.keys(r)) o[toCamelS(k)] = r[k];
      o.units = byCo[r.id] || [];
      return o;
    }));
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to load companies' }); }
});

app.post('/sourcing/companies', requireAuth, requireSourcing, async (req, res) => {
  try {
    const d = sanitizeObj(req.body);
    const id = d.id || 'SRC' + Date.now();
    const vals = SOURCING_FIELDS.map(f => {
      const camel = toCamelS(f);
      let v = d[camel];
      if (f === 'cycle_years') { v = parseFloat(v); if (isNaN(v)) v = 4; }
      return (v === undefined || v === null) ? '' : v;
    });
    const exists = await pgQuery('SELECT id FROM sourcing_companies WHERE id=$1', [id]);
    if (exists.rows.length) {
      const sets = SOURCING_FIELDS.map((f,i) => `${f}=$${i+2}`).join(', ');
      await pgQuery(`UPDATE sourcing_companies SET ${sets}, updated_at=now() WHERE id=$1`, [id, ...vals]);
    } else {
      const cols = SOURCING_FIELDS.join(','), ph = SOURCING_FIELDS.map((_,i)=>'$'+(i+2)).join(',');
      await pgQuery(`INSERT INTO sourcing_companies (id,${cols},created_by) VALUES ($1,${ph},$${SOURCING_FIELDS.length+2})`,
        [id, ...vals, req.user.username]);
    }
    res.json({ success:true, id });
  } catch(e) { console.error('sourcing save', e); res.status(500).json({ error:'Failed to save company' }); }
});

app.post('/sourcing/companies/:id/delete', requireAuth, requireSourcing, async (req, res) => {
  try {
    await pgQuery('UPDATE sourcing_companies SET deleted_at=now(), deleted_by=$2 WHERE id=$1', [req.params.id, req.user.username]);
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error:'Failed to delete' }); }
});

// Units / sightings for a company
app.post('/sourcing/units', requireAuth, requireSourcing, async (req, res) => {
  try {
    const d = sanitizeObj(req.body);
    if (!d.companyId) return res.status(400).json({ error:'companyId required' });
    if (d.id) {
      await pgQuery(`UPDATE sourcing_units SET year=$2,make=$3,model=$4,qty=$5,vin=$6,found_where=$7,found_date=$8,notes=$9 WHERE id=$1`,
        [d.id, d.year||'', d.make||'', d.model||'', d.qty||'', d.vin||'', d.foundWhere||'', d.foundDate||'', d.notes||'']);
    } else {
      await pgQuery(`INSERT INTO sourcing_units (company_id,year,make,model,qty,vin,found_where,found_date,notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [d.companyId, d.year||'', d.make||'', d.model||'', d.qty||'', d.vin||'', d.foundWhere||'', d.foundDate||'', d.notes||'']);
    }
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to save unit' }); }
});
app.delete('/sourcing/units/:id', requireAuth, requireSourcing, async (req, res) => {
  try { await pgQuery('DELETE FROM sourcing_units WHERE id=$1', [req.params.id]); res.json({ success:true }); }
  catch(e) { res.status(500).json({ error:'Failed to delete unit' }); }
});

// FMCSA carrier lookup by USDOT number (free public API; needs FMCSA_API_KEY / webKey)
app.get('/sourcing/fmcsa/:dot', requireAuth, requireSourcing, async (req, res) => {
  try {
    const key = process.env.FMCSA_API_KEY;
    if (!key) return res.status(400).json({ error:'FMCSA lookup not configured. Set FMCSA_API_KEY (free webKey from FMCSA) in Railway.' });
    const dot = String(req.params.dot).replace(/\D/g,'');
    if (!dot) return res.status(400).json({ error:'Enter a numeric USDOT number' });
    const url = `https://mobile.fmcsa.dot.gov/qc/services/carriers/${dot}?webKey=${encodeURIComponent(key)}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(502).json({ error:'FMCSA request failed ('+r.status+')' });
    const j = await r.json();
    const c = (j && j.content && j.content.carrier) ? j.content.carrier : null;
    if (!c) return res.status(404).json({ error:'No carrier found for USDOT '+dot });
    res.json({
      name: c.legalName || c.dbaName || '',
      dba: c.dbaName || '',
      phone: c.telephone || '',
      city: c.phyCity || '',
      state: c.phyState || '',
      fleetSize: (c.totalPowerUnits != null ? String(c.totalPowerUnits) : ''),
      drivers: (c.totalDrivers != null ? String(c.totalDrivers) : ''),
      dot: dot,
    });
  } catch(e) { console.error('fmcsa', e); res.status(500).json({ error:'FMCSA lookup failed: '+e.message }); }
});

// Access management (admins with sourcing can grant/revoke others)
app.get('/sourcing/access', requireAuth, requireSourcing, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error:'Only admins manage access' });
    const { rows } = await pgQuery('SELECT username, name, role, sourcing_access FROM users WHERE active IS NOT FALSE ORDER BY username');
    res.json(rows.map(u => ({ username:u.username, name:u.name, role:u.role, access: !!u.sourcing_access })));
  } catch(e) { res.status(500).json({ error:'Failed to load access list' }); }
});
app.post('/sourcing/access', requireAuth, requireSourcing, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error:'Only admins manage access' });
    const { username, access } = sanitizeObj(req.body);
    await pgQuery('UPDATE users SET sourcing_access=$2 WHERE username=$1', [username, access === true || access === 'true']);
    await audit2(req.user.username, 'update', 'sourcing_access', username, { access });
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error:'Failed to update access' }); }
});

// ── GLOBAL SEARCH (all record types) ──────────────────────────────────────────
app.get('/search', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const term = '%' + q.toLowerCase() + '%';
    const digits = q.replace(/\D/g, '');
    const phoneTerm = digits.length >= 3 ? '%' + digits + '%' : '%__nomatch__%';
    const results = [];

    // Leads
    const leads = (await pgQuery(`
      SELECT id, first_name, last_name, company, phone, unit, status FROM leads
      WHERE archived = FALSE AND (
        lower(first_name) LIKE $1 OR lower(last_name) LIKE $1 OR lower(company) LIKE $1
        OR regexp_replace(phone,'[^0-9]','','g') LIKE $2 OR lower(unit) LIKE $1
        OR lower(first_name || ' ' || last_name) LIKE $1)
      LIMIT 12`, [term, phoneTerm])).rows;
    for (const l of leads) results.push({
      type: 'lead', id: l.id,
      title: `${l.first_name||''} ${l.last_name||''}`.trim() || l.company || '(no name)',
      sub: [l.company, l.phone, l.unit].filter(Boolean).join(' · '),
      tag: l.status || 'Lead',
    });

    // Inventory (unit / make / model / VIN)
    const inv = (await pgQuery(`
      SELECT unit, year, make, model, vin, status FROM inventory
      WHERE lower(unit) LIKE $1 OR lower(make) LIKE $1 OR lower(model) LIKE $1
        OR lower(vin) LIKE $1 OR lower(year) LIKE $1
      LIMIT 12`, [term])).rows;
    for (const u of inv) results.push({
      type: 'inventory', id: u.unit,
      title: `${u.year||''} ${u.make||''} ${u.model||''}`.trim() || u.unit,
      sub: [`Unit ${u.unit}`, u.vin ? 'VIN '+u.vin : ''].filter(Boolean).join(' · '),
      tag: u.status || 'Inventory',
    });

    // Bills of sale
    const bos = (await pgQuery(`
      SELECT b.id, b.personal_name, b.business_name, b.total, b.lead_id,
        string_agg(u.vin,', ') FILTER (WHERE u.vin<>'') AS vins,
        string_agg(u.unit,', ') FILTER (WHERE u.unit<>'') AS units
      FROM bills_of_sale b LEFT JOIN bos_units u ON u.bos_id=b.id
      WHERE lower(b.personal_name) LIKE $1 OR lower(b.business_name) LIKE $1
        OR lower(u.vin) LIKE $1 OR lower(u.unit) LIKE $1
      GROUP BY b.id LIMIT 12`, [term])).rows;
    for (const b of bos) results.push({
      type: 'bill_of_sale', id: b.id, leadId: b.lead_id || '',
      title: b.personal_name || b.business_name || b.id,
      sub: [b.units ? 'Unit '+b.units : '', b.total ? '$'+Number(b.total).toLocaleString() : ''].filter(Boolean).join(' · '),
      tag: 'Bill of Sale',
    });

    // Closing packages
    const cp = (await pgQuery(`
      SELECT id, personal_name, business_name, unit, vin, lead_id FROM closing_packages
      WHERE lower(personal_name) LIKE $1 OR lower(business_name) LIKE $1
        OR lower(unit) LIKE $1 OR lower(vin) LIKE $1
      LIMIT 12`, [term])).rows;
    for (const c of cp) results.push({
      type: 'closing_package', id: c.id, leadId: c.lead_id || '',
      title: c.personal_name || c.business_name || c.id,
      sub: [c.unit ? 'Unit '+c.unit : '', c.vin ? 'VIN '+c.vin : ''].filter(Boolean).join(' · '),
      tag: 'Closing',
    });

    // Test drives
    const td = (await pgQuery(`
      SELECT id, customer_name, unit, vin, lead_id, drive_date FROM test_drives
      WHERE lower(customer_name) LIKE $1 OR lower(unit) LIKE $1 OR lower(vin) LIKE $1
      LIMIT 12`, [term])).rows;
    for (const t of td) results.push({
      type: 'test_drive', id: String(t.id), leadId: t.lead_id || '',
      title: t.customer_name || '(test drive)',
      sub: [t.unit ? 'Unit '+t.unit : '', t.drive_date || ''].filter(Boolean).join(' · '),
      tag: 'Test Drive',
    });

    res.json(results);
  } catch(e) { console.error('search error', e); res.status(500).json({ error:'Search failed' }); }
});

// ── SOFT DELETE / RESTORE / TRASH ─────────────────────────────────────────────
const DELETABLE = {
  lead: 'leads', bill_of_sale: 'bills_of_sale',
  closing_package: 'closing_packages', test_drive: 'test_drives',
};

app.post('/trash/:entity/:id', requireAuth, async (req, res) => {
  try {
    const table = DELETABLE[req.params.entity];
    if (!table) return res.status(400).json({ error:'Unknown record type' });
    await pgQuery(`UPDATE ${table} SET deleted_at=now(), deleted_by=$2 WHERE id=$1`,
      [req.params.id, req.user.username]);
    await audit2(req.user.username, 'delete', req.params.entity, req.params.id, { soft:true });
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to delete' }); }
});

app.post('/restore/:entity/:id', requireAuth, async (req, res) => {
  try {
    const table = DELETABLE[req.params.entity];
    if (!table) return res.status(400).json({ error:'Unknown record type' });
    await pgQuery(`UPDATE ${table} SET deleted_at=NULL, deleted_by=NULL WHERE id=$1`, [req.params.id]);
    await audit2(req.user.username, 'restore', req.params.entity, req.params.id, null);
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to restore' }); }
});

// List everything in the trash (admin only)
app.get('/trash', requireAuth, requireAdmin, async (req, res) => {
  try {
    const out = [];
    const leads = (await pgQuery(`SELECT id, first_name, last_name, company, deleted_at, deleted_by FROM leads WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)).rows;
    for (const l of leads) out.push({ type:'lead', id:l.id, title:`${l.first_name||''} ${l.last_name||''}`.trim()||l.company||l.id, deletedAt:l.deleted_at, deletedBy:l.deleted_by });
    const bos = (await pgQuery(`SELECT id, personal_name, business_name, total, deleted_at, deleted_by FROM bills_of_sale WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)).rows;
    for (const b of bos) out.push({ type:'bill_of_sale', id:b.id, title:(b.personal_name||b.business_name||b.id)+(b.total?' · $'+Number(b.total).toLocaleString():''), deletedAt:b.deleted_at, deletedBy:b.deleted_by });
    const cp = (await pgQuery(`SELECT id, personal_name, business_name, deleted_at, deleted_by FROM closing_packages WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)).rows;
    for (const c of cp) out.push({ type:'closing_package', id:c.id, title:c.personal_name||c.business_name||c.id, deletedAt:c.deleted_at, deletedBy:c.deleted_by });
    const td = (await pgQuery(`SELECT id, customer_name, unit, deleted_at, deleted_by FROM test_drives WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)).rows;
    for (const t of td) out.push({ type:'test_drive', id:String(t.id), title:(t.customer_name||'Test drive')+(t.unit?' · '+t.unit:''), deletedAt:t.deleted_at, deletedBy:t.deleted_by });
    out.sort((a,b)=> new Date(b.deletedAt) - new Date(a.deletedAt));
    res.json(out);
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to load trash' }); }
});

// Field-level edit history for a record
app.get('/history/:entity/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pgQuery(
      `SELECT field, old_value, new_value, username, at FROM field_history
       WHERE entity=$1 AND entity_id=$2 ORDER BY at DESC LIMIT 100`,
      [req.params.entity, req.params.id]);
    res.json(rows);
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to load history' }); }
});

// ── DASHBOARD STATS (admin only) ──────────────────────────────────────────────
app.get('/dashboard', requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const num = (v) => { const n = parseFloat(String(v||'').replace(/[^0-9.]/g,'')); return isNaN(n)?0:n; };

    // Optional date range: ?from=YYYY-MM&to=YYYY-MM (inclusive of whole months).
    // Defaults to the current month if not provided.
    const ym = (s) => /^\d{4}-\d{2}$/.test(String(s||'')) ? String(s) : null;
    const curYM = now.toISOString().slice(0,7);
    const fromYM = ym(req.query.from) || ym(req.query.to) || curYM;
    const toYM   = ym(req.query.to)   || ym(req.query.from) || curYM;
    // normalize so from <= to
    const lo = fromYM <= toYM ? fromYM : toYM;
    const hi = fromYM <= toYM ? toYM : fromYM;
    const rangeStart = lo + '-01';
    // end = last day of hi month → compare with < firstDayOfNextMonth
    const hiParts = hi.split('-').map(Number);
    const nextMonth = new Date(hiParts[0], hiParts[1], 1).toISOString().split('T')[0]; // first day after hi

    // Pull the raw data we need
    const bos = (await pgQuery('SELECT id, lead_id, bos_date, total, salesperson, created_at FROM bills_of_sale')).rows;
    const leads = (await pgQuery('SELECT id, status, salesperson, source, created_at FROM leads')).rows;
    const inv = (await pgQuery('SELECT unit, status, date_added FROM inventory')).rows;

    // A BOS falls in range if its effective date is within [rangeStart, nextMonth)
    const effDate = (r) => (r.bos_date && r.bos_date.length>=7) ? r.bos_date : (r.created_at ? new Date(r.created_at).toISOString().split('T')[0] : '');
    const inMonth = (r) => { const d = effDate(r); return d >= rangeStart && d < nextMonth; };
    const monthBos = bos.filter(inMonth);
    const unitsSoldMonth = monthBos.length;
    const grossMonth = monthBos.reduce((s,r)=>s+num(r.total),0);
    const grossAll = bos.reduce((s,r)=>s+num(r.total),0);

    // Sales per person (this month, by count + revenue)
    const byPerson = {};
    for (const r of monthBos) {
      const p = r.salesperson || '—';
      byPerson[p] = byPerson[p] || { name:p, count:0, revenue:0 };
      byPerson[p].count++; byPerson[p].revenue += num(r.total);
    }

    // Average days-to-sale: lead.created_at → first BOS created_at for that lead
    const firstBosByLead = {};
    for (const r of bos) {
      if (!r.lead_id) continue;
      const t = r.created_at ? new Date(r.created_at).getTime() : 0;
      if (!firstBosByLead[r.lead_id] || t < firstBosByLead[r.lead_id]) firstBosByLead[r.lead_id] = t;
    }
    let daysList = [];
    for (const l of leads) {
      const sold = firstBosByLead[l.id];
      if (sold && l.created_at) {
        const days = (sold - new Date(l.created_at).getTime()) / 86400000;
        if (days >= 0 && days < 3650) daysList.push(days);
      }
    }
    const avgDaysToSale = daysList.length ? (daysList.reduce((a,b)=>a+b,0)/daysList.length) : null;

    // Conversion rate: leads with a linked BOS / total leads
    const soldLeadIds = new Set(bos.map(r=>r.lead_id).filter(Boolean));
    const conversionRate = leads.length ? (soldLeadIds.size / leads.length * 100) : 0;

    // Lead-source conversion: per source, count leads, conversions, and revenue
    const revenueByLead = {};
    for (const r of bos) { if (r.lead_id) revenueByLead[r.lead_id] = (revenueByLead[r.lead_id]||0) + num(r.total); }
    const bySource = {};
    for (const l of leads) {
      const s = (l.source && l.source.trim()) ? l.source.trim() : 'Unknown';
      bySource[s] = bySource[s] || { source:s, leads:0, converted:0, revenue:0 };
      bySource[s].leads++;
      if (soldLeadIds.has(l.id)) { bySource[s].converted++; bySource[s].revenue += (revenueByLead[l.id]||0); }
    }
    const leadSources = Object.values(bySource).map(s => ({
      ...s, rate: s.leads ? (s.converted / s.leads * 100) : 0
    })).sort((a,b) => b.leads - a.leads);

    // Aging inventory: available units bucketed by true days-on-lot (date_added)
    const available = inv.filter(u => !/sold|pending/i.test(u.status||''));
    const agingBuckets = { '0-30':0, '31-60':0, '61-90':0, '90+':0 };
    let oldestDays = 0;
    for (const u of available) {
      const days = u.date_added ? Math.floor((Date.now()-new Date(u.date_added).getTime())/86400000) : 0;
      if (days > oldestDays) oldestDays = days;
      if (days <= 30) agingBuckets['0-30']++;
      else if (days <= 60) agingBuckets['31-60']++;
      else if (days <= 90) agingBuckets['61-90']++;
      else agingBuckets['90+']++;
    }
    const availableCount = available.length;

    res.json({
      month: (lo === hi) ? lo : (lo + ' to ' + hi),
      rangeFrom: lo, rangeTo: hi,
      unitsSoldMonth, grossMonth, grossAll,
      salesByPerson: Object.values(byPerson).sort((a,b)=>b.revenue-a.revenue),
      avgDaysToSale,
      conversionRate,
      totalLeads: leads.length,
      soldLeads: soldLeadIds.size,
      availableInventory: availableCount,
      agingBuckets,
      oldestDays,
      leadSources,
      totalBos: bos.length,
    });
  } catch(e) { console.error('dashboard error', e); res.status(500).json({ error:'Failed to load dashboard' }); }
});

// ── AUDIT LOG (admin only, with filters) ──────────────────────────────────────
app.get('/audit', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { user, entity, entity_id, from, to, limit } = req.query;
    const where = [], vals = []; let i = 1;
    if (user)      { where.push(`username=$${i++}`);  vals.push(String(user).toLowerCase()); }
    if (entity)    { where.push(`entity=$${i++}`);    vals.push(entity); }
    if (entity_id) { where.push(`entity_id=$${i++}`); vals.push(entity_id); }
    if (from)      { where.push(`at >= $${i++}`);     vals.push(from); }
    if (to)        { where.push(`at <= $${i++}`);     vals.push(to + ' 23:59:59'); }
    const lim = Math.min(parseInt(limit) || 200, 1000);
    const sql = `SELECT id, username, action, entity, entity_id, detail, at FROM audit_log
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY at DESC LIMIT ${lim}`;
    const { rows } = await pgQuery(sql, vals);
    res.json(rows);
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to load audit log' }); }
});

// Small audit helper that uses the server's own pg connection (separate from dbwrite's)
async function audit2(username, action, entity, entityId, detail) {
  try {
    await pgQuery('INSERT INTO audit_log (username, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5)',
      [username||'system', action, entity, String(entityId||''), detail?JSON.stringify(detail):null]);
  } catch(e) { console.warn('audit2 failed:', e.message); }
}

// ── INVENTORY ──────────────────────────────────────────────────────────────────
app.get('/inventory', requireAuth, async (req, res) => {
  try {
    // Inventory is maintained by hand in the Google Sheet, so ALWAYS read the
    // sheet as the source of truth and sync it into Postgres. (Reading only from
    // Postgres would mean Sheet edits never show up.)
    const role = (req.user && req.user.role) || 'sales';
    let fullInventory = null;
    try {
      const sheets = getSheetsClient();
      const response = await sheets.spreadsheets.values.get({ spreadsheetId:INV_SHEET_ID, range:INV_SHEET_TAB });
      const rows = response.data.values || [];
      if (rows.length <= 1) { fullInventory = []; }
      else {
        const hmap = buildInvHeaderMap(rows[0]);
        const cell = (r, field) => (hmap[field]!=null ? (r[hmap[field]]||'') : '');
        const num = (v) => { const n = parseFloat(String(v||'').replace(/[^0-9.]/g,'')); return isNaN(n)?0:n; };
        // Skip blank rows and obvious placeholder/template rows (e.g. "Column1").
        const isPlaceholder = (r) => {
          const u = String(cell(r,'unit')||'').trim();
          const mk = String(cell(r,'make')||'').trim();
          return /^column\s*\d+$/i.test(u) || /^column\s*\d+$/i.test(mk);
        };
        fullInventory = rows.slice(1)
          .filter(r => r && (cell(r,'unit')||cell(r,'make')||cell(r,'model')) && !isPlaceholder(r))
          .map(r => {
            const recon = num(cell(r,'transport')) + num(cell(r,'repairDot')) + num(cell(r,'cleaningWarr')) + num(cell(r,'docsFee'));
            return {
              unit:cell(r,'unit'), year:cell(r,'year'), make:cell(r,'make'), model:cell(r,'model'),
              hours:cell(r,'hours'), miles:cell(r,'miles'), trans:cell(r,'trans'), apu:cell(r,'apu'),
              color:cell(r,'color'), ratio:cell(r,'ratio'), hp:cell(r,'hp'),
              listPrice:cell(r,'listPrice'), salePrice:cell(r,'sellPrice'), status:cell(r,'status'), vin:cell(r,'vin'),
              purchaseP:cell(r,'purchaseP'), reconditioning: recon ? String(recon) : '', profit:cell(r,'profit'),
            };
          });
      }
    } catch(sheetErr) {
      console.warn('Inventory sheet read failed, falling back to Postgres:', sheetErr.message);
    }
    if (fullInventory) {
      DBW.mirrorInventory(fullInventory);   // keep PG copy current (full data)
      // Filter columns to what this role may see BEFORE sending to the browser
      return res.json(fullInventory.map(row => invRowForRole(row, role)));
    }
    // Sheet unreachable — serve last-known from Postgres (also role-filtered)
    if (await usePg()) {
      const pg = await DBR.readInventory();
      return res.json(pg.map(row => invRowForRole(row, role)));
    }
    res.json([]);
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to load inventory' }); }
});

// ── TEST DRIVE — GENERATE PDF ──────────────────────────────────────────────────
app.post('/testdrive/generate', requireAuth, async (req, res) => {
  try {
    const d = req.body;
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    const { width, height } = page.getSize();
    const fontBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const font       = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    const M = 48; let y = height - 48;

    const dt = (text, x, yPos, opts={}) => {
      try { page.drawText(String(text||''), { x, y:yPos, size:opts.size||10, font:opts.bold?fontBold:(opts.italic?fontItalic:font), color:rgb(0,0,0), maxWidth:opts.maxWidth||500 }); } catch(e){}
    };
    const ln = (yPos, x1=M, x2=width-M) => page.drawLine({ start:{x:x1,y:yPos}, end:{x:x2,y:yPos}, thickness:0.5, color:rgb(0.5,0.5,0.5) });

    // ── Branded header: logo + contact block, matching the Bill of Sale ──────
    try {
      const img = await pdfDoc.embedJpg(Buffer.from(LOGO_B64,'base64'));
      const dims = img.scaleToFit(130,46);
      page.drawImage(img,{ x:M, y:y-dims.height+8, width:dims.width, height:dims.height });
    } catch(e){}
    const ax = width - M - 165;
    dt('Direct Truck Sales Inc.', ax, y, {bold:true, size:9});
    dt('15w740 N. Frontage Rd, Ste 2', ax, y-12, {size:8});
    dt('Burr Ridge, IL 60527', ax, y-23, {size:8});
    dt('630-701-1000', ax, y-34, {size:8});
    page.drawText('Sales@Direct-Truck.com', { x:ax, y:y-45, size:8, font, color:rgb(0,0.3,0.7) });
    page.drawText('Finance@Direct-Truck.com', { x:ax, y:y-56, size:8, font, color:rgb(0,0.3,0.7) });
    y -= 68;
    page.drawRectangle({ x:M, y:y-14, width:width-M*2, height:20, color:rgb(0.12,0.12,0.12) });
    page.drawText('TEST DRIVE AGREEMENT', { x:width/2-72, y:y-8, size:12, font:fontBold, color:rgb(1,1,1) });
    dt('Date: '+(d.date||''), width-M-104, y-8, {size:8.5});
    y -= 28;
    ln(y); y-=14;
    dt('The undersigned acknowledges receiving the following vehicle for test drive purposes:', M, y, {size:9, italic:true});
    y-=18;

    page.drawRectangle({x:M,y:y-6,width:width-M*2,height:50,color:rgb(0.94,0.94,0.94),borderColor:rgb(0.75,0.75,0.75),borderWidth:0.5});
    dt('Make:',M+8,y+28,{bold:true,size:9}); dt(d.make||'',M+44,y+28,{size:9});
    dt('Year:',M+140,y+28,{bold:true,size:9}); dt(d.year||'',M+168,y+28,{size:9});
    dt('Model:',M+218,y+28,{bold:true,size:9}); dt(d.model||'',M+252,y+28,{size:9});
    dt('VIN / Serial #:',M+8,y+10,{bold:true,size:9}); dt(d.vin||'',M+86,y+10,{size:9,maxWidth:160});
    dt('Stock #:',M+270,y+10,{bold:true,size:9}); dt(d.unit||'',M+314,y+10,{size:9});
    dt('Plate #:',M+380,y+10,{bold:true,size:9}); dt(d.plate||'',M+422,y+10,{size:9});
    y-=62;

    dt('Date:',M,y,{bold:true,size:9}); dt(d.date||'',M+36,y,{size:9});
    dt('Return by:',M+180,y,{bold:true,size:9}); dt(d.returnTime||'',M+240,y,{size:9});
    y-=18; ln(y); y-=12;

    dt('CONDITIONS & REPRESENTATIONS:', M, y, {bold:true,size:9}); y-=13;
    const conditions = [
      "Vehicle shall be returned within 3 hours or on dealer's demand, free of liens, in the same condition as received, or undersigned shall pay for all repairs necessary.",
      'Undersigned shall pay dealer immediately the full present retail value of the vehicle if it is not returned for any reason whatsoever.',
      'Vehicle is to be driven exclusively by the undersigned for test drive purposes only and shall not be used for transportation of persons or property for hire.',
      "Vehicle shall not be operated in violation of any law, nor driven beyond a radius of 20 miles from dealer's place of business.",
      'Vehicle will be preserved and protected from all loss, damage, or injury. Unit is GPS monitored and shall not be modified or altered in any way.',
      'The undersigned self-certifies that he/she is fully qualified and competent to operate this class of equipment and holds a valid Commercial Driver\u2019s License (CDL) appropriate for this vehicle.',
      'The undersigned accepts full and sole responsibility for the unit during the test drive, including any and all damage, loss, theft, mechanical failure, traffic citations or tickets, and any accident or injury claims of any kind, and agrees to indemnify and hold the dealer harmless from all such liabilities.',
    ];
    conditions.forEach(c => {
      page.drawText('\u2022  '+c, {x:M+8,y,size:8.2,font,color:rgb(0,0,0),maxWidth:width-M*2-16,lineHeight:12});
      y -= (Math.ceil(c.length/100)*12)+7;
    });

    y-=4; ln(y); y-=12;
    // Deposit-collected acknowledgment (checkbox + $1,000) — two lines, properly spaced
    page.drawRectangle({ x:M, y:y-9, width:12, height:12, borderColor:rgb(0,0,0), borderWidth:1, color:(d.depositCollected ? rgb(0.12,0.12,0.12) : rgb(1,1,1)) });
    if (d.depositCollected) { try { page.drawText('X', { x:M+2.5, y:y-7.5, size:10, font:fontBold, color:rgb(1,1,1) }); } catch(e){} }
    page.drawText('A refundable test-drive deposit of $1,000.00 has been collected and will be returned',
      { x:M+20, y, size:8.5, font:fontBold, color:rgb(0,0,0), maxWidth:width-M*2-20 });
    dt('upon the unit being returned in its original condition.', M+20, y-11, {bold:true, size:8.5});
    y-=24; ln(y); y-=12;
    dt('DYNO Testing NOT allowed',M,y,{bold:true,size:9}); dt('Initials: ____________',width-M-130,y,{size:9});
    y-=13;
    dt('Calibration, programming, and Parked Forced Regeneration NOT allowed',M,y,{italic:true,size:9}); dt('Initials: ____________',width-M-130,y,{size:9});
    y-=16; ln(y); y-=12;

    const dlTxt = `The undersigned represents that he/she is duly and legally licensed to operate a vehicle under license number [${d.dlNumber||'________________'}] State [${d.dlState||'IL'}] and has no physical conditions that could cause him/her to be unfit to drive said vehicle.`;
    page.drawText(dlTxt,{x:M,y,size:8,font,color:rgb(0,0,0),maxWidth:width-M*2,lineHeight:12});
    y-=36; ln(y); y-=14;

    const half=(width-M*2)/2;
    dt('SALESPERSON:',M,y,{bold:true,size:9}); dt(d.salesperson||'',M+78,y,{size:9});
    dt('DATE:',M,y-16,{bold:true,size:9}); dt(d.date||'',M+38,y-16,{size:9});
    dt('DRIVER LICENSE:',M,y-32,{bold:true,size:9}); dt(`${d.dlNumber||''} (${d.dlState||'IL'})`,M+98,y-32,{size:9});
    dt('CUSTOMER SIGNATURE:',M+half+8,y,{bold:true,size:9}); ln(y-2,M+half+140,width-M);
    dt('ADDRESS:',M+half+8,y-16,{bold:true,size:9}); dt(`${d.address||''}, ${d.city||''}, ${d.state||''} ${d.zip||''}`,M+half+66,y-16,{size:9,maxWidth:half-70});
    dt('CUSTOMER NAME:',M+half+8,y-32,{bold:true,size:9}); dt(d.customerName||'',M+half+104,y-32,{size:9});
    y-=50; ln(y); y-=10;
    dt('Direct Truck Sales Inc. — Test Drive Agreement',M,y,{size:7,italic:true});

    const pdfBytes = await pdfDoc.save();
    const safeName = (d.customerName||'Agreement').replace(/[^a-zA-Z0-9]/g,'_');
    const tdBuf = Buffer.from(pdfBytes);
    const tdUp = await DRIVE.uploadPdf('testdrive', `TestDrive_${safeName}_${d.date||'nodate'}`, tdBuf);
    res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="TestDrive_${safeName}_${d.date||'nodate'}.pdf"`,
      'X-Drive-Link': tdUp ? tdUp.link : '', 'Access-Control-Expose-Headers':'X-Drive-Link'});
    res.send(tdBuf);
  } catch(e) { console.error('Test drive PDF error:',e); res.status(500).json({ error:'PDF generation failed: '+e.message }); }
});

app.post('/testdrive/save', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient(); const d = req.body; const TD_SHEET = 'TestDrives';
    if (WRITE_TO_SHEETS) await ensureSheetTab(sheets, 'TestDrives');
    let hasHeader = false;
    try { const c = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:`${TD_SHEET}!A1` }); hasHeader = !!(c.data.values?.length); } catch(e){}
    if (!hasHeader) {
      await sheets.spreadsheets.values.update({ spreadsheetId:SHEET_ID, range:`${TD_SHEET}!A1`, valueInputOption:'RAW',
        requestBody:{ values:[['Date','Customer Name','Phone','Address','City','State','Zip','DL #','DL State','Unit','Make','Model','VIN','Plate','Return Time','Salesperson','Lead ID']] } });
    }
    if (WRITE_TO_SHEETS) await appendRowSafe(sheets, TD_SHEET, [d.date,d.customerName,d.phone,d.address,d.city,d.state,d.zip,d.dlNumber,d.dlState,d.unit,d.make,d.model,d.vin,d.plate,d.returnTime,d.salesperson,d.leadId||'']);
    await DBW.mirrorTestDrive(d, req.user && req.user.username);
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to save record' }); }
});

app.get('/testdrive/history', requireAuth, async (req, res) => {
  try {
    if (await usePg()) { return res.json(await DBR.readTestDrives()); }
    const sheets = getSheetsClient();
    if (WRITE_TO_SHEETS) await ensureSheetTab(sheets, 'TestDrives');
    const response = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:'TestDrives' });
    const rows = response.data.values || [];
    if (rows.length <= 1) return res.json([]);
    const records = rows.slice(1).filter(r=>r && r.length>1 && ((r[1]||'').trim())).map(r => ({
      date:r[0]||'', customerName:r[1]||'', phone:r[2]||'', address:r[3]||'',
      city:r[4]||'', state:r[5]||'', zip:r[6]||'', dlNumber:r[7]||'', dlState:r[8]||'',
      unit:r[9]||'', make:r[10]||'', model:r[11]||'', vin:r[12]||'',
      plate:r[13]||'', returnTime:r[14]||'', salesperson:r[15]||'', leadId:r[16]||''
    })).reverse();
    res.json(records);
  } catch(e) { console.error('TD list', e.message); res.json([]); }
});

// ── BILL OF SALE — GENERATE PDF ────────────────────────────────────────────────
app.post('/billsofsale/generate', requireAuth, async (req, res) => {
  try {
    const d = req.body;
    const units = d.units && d.units.length > 0 ? d.units
      : [{num:1,unit:d.unit,year:d.year,make:d.make,model:d.model,vin:d.vin,miles:d.miles,
          apu:d.apu,color:d.color,ratio:d.ratio,hp:d.hp,warrantyCoverage:d.warrantyCoverage,
          serviceContractLevel:d.serviceContractLevel,serviceContractCoverage:d.serviceContractCoverage,
          serviceContractPrice:d.serviceContractPrice,salePrice:d.salePrice,salesTax:d.salesTax,
          titleFee:d.titleFee,docFee:d.docFee,item1:d.item1,item2:d.item2,item3:d.item3,item4:d.item4}];

    const pdfDoc = await PDFDocument.create();
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const W=612,H=792,M=44;

    const dt = (pg,text,x,yPos,opts={}) => {
      try{ pg.drawText(String(text||''),{x,y:yPos,size:opts.size||9,font:opts.bold?fontBold:font,color:rgb(...(opts.color||[0,0,0])),maxWidth:opts.maxWidth||(W-M-x)}); }catch(e){}
    };
    const ln=(pg,yPos,x1=M,x2=W-M,t=0.5)=>pg.drawLine({start:{x:x1,y:yPos},end:{x:x2,y:yPos},thickness:t,color:rgb(0.75,0.75,0.75)});
    const box=(pg,x,y,w,h,fill=[0.95,0.95,0.95])=>pg.drawRectangle({x,y,width:w,height:h,color:rgb(...fill),borderColor:rgb(0.82,0.82,0.82),borderWidth:0.5});
    const fmtM=v=>{const n=parseFloat(String(v||'0').replace(/[$,]/g,''));return(!v||isNaN(n)||n===0)?null:'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});};

    const addHeader = async(pg,title) => {
      let y=H-36;
      try{const img=await pdfDoc.embedJpg(Buffer.from(LOGO_B64,'base64'));const dims=img.scaleToFit(130,46);pg.drawImage(img,{x:M,y:y-dims.height+8,width:dims.width,height:dims.height});}catch(e){}
      const ax=W-M-165;
      dt(pg,'Direct Truck Sales Inc.',ax,y,{bold:true,size:9});
      dt(pg,'15w740 N. Frontage Rd, Ste 2',ax,y-12,{size:8});
      dt(pg,'Burr Ridge, IL 60527',ax,y-23,{size:8});
      dt(pg,'630-701-1000',ax,y-34,{size:8});
      dt(pg,'Sales@Direct-Truck.com',ax,y-45,{size:8,color:[0,0.3,0.7]});
      dt(pg,'Finance@Direct-Truck.com',ax,y-56,{size:8,color:[0,0.3,0.7]});
      y-=68;
      pg.drawRectangle({x:M,y:y-14,width:W-M*2,height:20,color:rgb(0.12,0.12,0.12)});
      dt(pg,title,W/2-40,y-8,{bold:true,size:12,color:[1,1,1]});
      dt(pg,'Date: '+(d.date||''),W-M-104,y-8,{size:8.5,color:[0.9,0.9,0.9]});
      return y-28;
    };

    const p1=pdfDoc.addPage([W,H]);
    let y=await addHeader(p1,'BILL OF SALE');
    const LBL=86,VAL=W/2-M-LBL-8,col1=M+6,col2=W/2+6;
    const row=(pg,yp,l1,v1,l2,v2)=>{
      dt(pg,l1,col1,yp,{bold:true,size:8.5});dt(pg,v1||'',col1+LBL,yp,{size:8.5,maxWidth:VAL});
      if(l2){dt(pg,l2,col2,yp,{bold:true,size:8.5});dt(pg,v2||'',col2+LBL,yp,{size:8.5,maxWidth:VAL});}
    };
    box(p1,M,y-96,W-M*2,108);
    dt(p1,'PURCHASER',M+6,y-5,{bold:true,size:7.5,color:[0.4,0.4,0.4]});
    dt(p1,'Sales Rep: '+(d.salesperson||''),W-M-150,y-5,{size:8});
    y-=18;
    row(p1,y,'Name:',d.personalName,'Business:',d.businessName);y-=13;
    row(p1,y,'Address:',d.address,'Address:',(d.bizAddress||d.address));y-=13;
    const csz=`${d.city||''}, ${d.state||''} ${d.zip||''}`;
    const bcsz=d.bizCity?`${d.bizCity}, ${d.bizState||''} ${d.bizZip||''}`:csz;
    row(p1,y,'City/St/ZIP:',csz,'City/St/ZIP:',bcsz);y-=13;
    row(p1,y,'Phone:',d.phone,'Phone:',(d.bizPhone||d.phone));y-=13;
    row(p1,y,'Email:',d.email,'DL # / State:',`${d.dlNumber||''} ${d.dlState?'('+d.dlState+')':''}`);y-=18;

    for(let ui=0;ui<units.length;ui++){
      const u=units[ui];
      const finItems=[
        ['Sale Price:',fmtM(u.salePrice)],
        ['Service Contract:',u.serviceContractPrice&&parseFloat(u.serviceContractPrice)>0?fmtM(u.serviceContractPrice):null],
        ['Sales Tax:',u.salesTax&&parseFloat(u.salesTax)>0?fmtM(u.salesTax):null],
        ['IL Title Fee:',u.titleFee&&parseFloat(u.titleFee)>0?fmtM(u.titleFee):null],
        ['Doc Fee:',fmtM(u.docFee||350)],
      ].filter(r=>r[1]);
      const vBoxH=16+14+14+14+10;
      const fBoxH=finItems.length*16+22;
      const totalH=vBoxH+fBoxH+8;
      if(y<totalH+60){const np=pdfDoc.addPage([W,H]);y=await addHeader(np,units.length>1?`BILL OF SALE — Unit ${ui+1}`:'BILL OF SALE (cont.)');}
      const vLabel=units.length>1?`VEHICLE — UNIT ${ui+1}`:'VEHICLE';
      box(p1,M,y-vBoxH,W-M*2,vBoxH+12,[0.96,0.96,0.96]);
      dt(p1,vLabel,M+6,y-5,{bold:true,size:7.5,color:[0.4,0.4,0.4]});
      let vy=y-18;
      dt(p1,'Year:',M+6,vy,{bold:true,size:7.5});dt(p1,u.year||'',M+36,vy,{size:8.5,maxWidth:60});
      dt(p1,'Make:',M+98,vy,{bold:true,size:7.5});dt(p1,u.make||'',M+128,vy,{size:8.5,maxWidth:80});
      dt(p1,'Model:',M+210,vy,{bold:true,size:7.5});dt(p1,u.model||'',M+242,vy,{size:8.5,maxWidth:90});
      dt(p1,'VIN:',M+338,vy,{bold:true,size:7.5});dt(p1,u.vin||'',M+362,vy,{size:8.5,maxWidth:130});
      dt(p1,'Unit#:',W-M-70,vy,{bold:true,size:7.5});dt(p1,u.unit||'',W-M-38,vy,{size:8.5,maxWidth:36});
      vy-=14;
      let ox=M+6;
      [['Miles',u.miles,50],['APU',u.apu,44],['Color',u.color,52],['Ratio',u.ratio,46],['HP',u.hp,26]].forEach(([k,v,vw])=>{
        if(v){dt(p1,k+':',ox,vy,{bold:true,size:7.5});dt(p1,String(v),ox+30,vy,{size:8,maxWidth:vw});ox+=30+vw+12;}
      });
      vy-=14;
      dt(p1,'Warranty:',M+6,vy,{bold:true,size:8.5});dt(p1,u.warrantyCoverage||'AS-IS',M+62,vy,{size:8.5,maxWidth:200});
      if(u.serviceContractLevel){
        dt(p1,'Service Contract:',M+280,vy,{bold:true,size:8.5});
        dt(p1,`${u.serviceContractLevel} — ${u.serviceContractCoverage||''}`,M+380,vy,{size:8,maxWidth:130});
      }
      y-=vBoxH+6;
      box(p1,M,y-fBoxH,W-M*2,fBoxH+10,[0.99,0.99,0.99]);
      dt(p1,units.length>1?`FINANCIALS — UNIT ${ui+1}`:'FINANCIAL SUMMARY',M+6,y-5,{bold:true,size:7.5,color:[0.4,0.4,0.4]});
      let fy=y-18;
      finItems.forEach(([lbl,val])=>{
        dt(p1,lbl,M+6,fy,{bold:true,size:8.5,maxWidth:200});
        if(val){const vw=val.length*5.6;dt(p1,val,W-M-4-vw,fy,{size:9,maxWidth:100});}
        p1.drawLine({start:{x:M,y:fy-3},end:{x:W-M,y:fy-3},thickness:0.3,color:rgb(0.88,0.88,0.88)});
        fy-=16;
      });
      y-=fBoxH+10;
    }

    if(d.depositAmount&&parseFloat(d.depositAmount)>0){
      ln(p1,y+8,W/2+4,W-M);y-=12;
      dt(p1,'Deposit:',W/2+10,y,{bold:true,size:9});dt(p1,`- ${fmtM(d.depositAmount)||''} (${d.depositType||''})`,W/2+70,y,{size:9,maxWidth:155});
      y-=14;
    }
    ln(p1,y+8,W/2+4,W-M,1.5);y-=16;
    dt(p1,'GRAND TOTAL:',W/2+10,y,{bold:true,size:12});
    const tvw=(fmtM(d.total)||'').length*6.5;
    dt(p1,fmtM(d.total)||'',W-M-4-tvw,y,{bold:true,size:13,color:[0.05,0.42,0.1]});
    y-=24;
    y=Math.min(y,200);
    ln(p1,y+14);dt(p1,'Accepted Terms and Conditions',M,y+4,{bold:true,size:8.5});
    p1.drawText('Purchaser agrees this Purchase Order includes all terms as of the Date Accepted. This Invoice cancels and supersedes any prior agreement and is binding when accepted by both parties.',
      {x:M,y:y-12,size:7.5,font,color:rgb(0.2,0.2,0.2),maxWidth:W-M*2,lineHeight:11});
    y-=38;
    dt(p1,'Purchaser declines additional warranty',M,y,{bold:true,size:8});dt(p1,'Initials: _________',W-M-105,y,{size:8});
    y-=22;ln(p1,y+8);
    dt(p1,'Purchaser Signature:',M,y-7,{bold:true,size:9});dt(p1,'_________________________________',M+120,y-7,{size:9});
    dt(p1,'Date:',M+372,y-7,{bold:true,size:9});dt(p1,'__________',M+398,y-7,{size:9});
    y-=20;
    dt(p1,'Direct Truck Sales:',M,y-7,{bold:true,size:9});dt(p1,'_________________________________',M+120,y-7,{size:9});
    dt(p1,'Date:',M+372,y-7,{bold:true,size:9});dt(p1,'__________',M+398,y-7,{size:9});

    // ── TERMS & CONDITIONS (robust) ───────────────────────────────────────────
    const TERMS = [
      ['1. AS-IS SALE; DISCLAIMER OF ALL WARRANTIES',
       'THE VEHICLE(S) DESCRIBED ABOVE ARE SOLD "AS IS", "WHERE IS", AND "WITH ALL FAULTS". DEALER EXPRESSLY DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED WARRANTY OF MERCHANTABILITY AND ANY IMPLIED WARRANTY OF FITNESS FOR A PARTICULAR PURPOSE, AND ANY WARRANTY OF QUALITY, WORKMANSHIP, DESIGN, CONDITION, OR PERFORMANCE. NO WARRANTY EXTENDS BEYOND THE DESCRIPTION OF THE VEHICLE(S) ON THE FACE OF THIS AGREEMENT. PURCHASER WILL BEAR THE ENTIRE EXPENSE OF REPAIRING OR CORRECTING ANY DEFECT THAT NOW EXISTS OR THAT MAY HEREAFTER ARISE.', true],
      ['2. PURCHASER INSPECTION; NO RELIANCE',
       'Purchaser acknowledges having had a full opportunity to inspect, and/or to have an independent mechanic of Purchaser\'s choosing inspect, and/or to test-drive the vehicle(s) prior to purchase, and that the decision to purchase is based solely on that inspection and Purchaser\'s own judgment. Purchaser has not relied on any oral statement, description, advertisement, or representation of Dealer or any salesperson concerning the condition, performance, prior use, service history, hours, or mileage of the vehicle(s) that is not expressly written in this Agreement.'],
      ['3. MANUFACTURER WARRANTIES ONLY',
       'Unless Dealer furnishes Purchaser with a separate written warranty or service contract issued by Dealer on its own behalf, any warranty that may still apply to the vehicle(s) is solely that of the manufacturer or other third-party supplier. All such warranties, if any, are those of the manufacturer or supplier alone, not Dealer, and only the manufacturer or supplier shall be liable for performance under them. Any service contract sold with this purchase is administered by the issuing provider identified in the service contract, not Dealer.'],
      ['4. LIMITATION OF LIABILITY',
       'TO THE FULLEST EXTENT PERMITTED BY LAW, DEALER SHALL NOT BE LIABLE FOR ANY CONSEQUENTIAL, INCIDENTAL, SPECIAL, EXEMPLARY, OR PUNITIVE DAMAGES OF ANY KIND, including without limitation damage to property, loss of use, loss of time, towing or storage charges, lost profits, lost income, lost loads or contracts, downtime, or substitute equipment costs, arising from or relating to any defect, unfitness, failure, or deficiency of the vehicle(s). In no event shall Dealer\'s total aggregate liability arising out of or related to this Agreement exceed the purchase price actually paid by Purchaser for the vehicle giving rise to the claim.'],
      ['5. COMMERCIAL TRANSACTION',
       'Purchaser represents that the vehicle(s) are purchased for commercial, business, or resale purposes and not primarily for personal, family, or household use, and that Purchaser is experienced in the purchase and operation of commercial motor vehicles. To the extent permitted by law, consumer-protection statutes applicable to household goods do not apply to this transaction.'],
      ['6. TAXES, FEES & REGISTRATION',
       'Purchaser is solely responsible for all applicable local, state, and federal taxes, title fees, registration fees, permit fees, and any other governmental charges arising from this purchase, whether or not collected by Dealer at closing. Any tax, fee, or charge later assessed with respect to this sale shall be paid by Purchaser, and Purchaser shall reimburse Dealer on demand for any such amount Dealer is required to pay.'],
      ['7. TITLE, RISK OF LOSS & STORAGE',
       'Title to the vehicle(s) shall not pass to Purchaser until the full purchase price has been received by Dealer in cleared funds. Risk of loss or damage passes to Purchaser upon delivery or upon Purchaser taking possession, whichever occurs first. Vehicles not picked up within fourteen (14) days after notice of availability may be subject to reasonable storage charges. Until full payment, Dealer retains, and Purchaser grants Dealer, a security interest in the vehicle(s) and all proceeds thereof.'],
      ['8. DEPOSITS & PAYMENT',
       'All deposits are non-refundable once Dealer has removed the vehicle from sale, commenced any requested work, or incurred costs in reliance on this Agreement, except as otherwise required by law. Payment by check or electronic transfer is not complete until finally settled in Dealer\'s account. Any payment dishonored for any reason shall entitle Dealer to cancel this Agreement, retake possession where permitted by law, and recover all resulting costs.'],
      ['9. POST-SALE COMPLIANCE & OPERATION',
       'Upon delivery, Purchaser is solely responsible for the vehicle(s), including registration, insurance, inspection, maintenance, mechanical operation, load securement, and safety, and for compliance with all applicable laws and regulations, including U.S. DOT and FMCSA requirements. Any annual inspection report furnished at sale reflects condition only as of its date and is not a warranty of future condition or compliance.'],
      ['10. RELEASE & INDEMNIFICATION',
       'Purchaser, for itself and its owners, officers, employees, agents, family members, dependents, guests, and any affiliated or interested parties, fully and forever releases and discharges Dealer and its owners, officers, employees, and agents (the "Released Parties") from any and all injuries (including death), losses, damages, claims (including ordinary negligence claims), demands, lawsuits, expenses, and liabilities of any kind, directly or indirectly arising out of, concerning, or relating to the purchase, ownership, possession, operation, or use of the vehicle(s), even if caused by the negligence, omission, or other fault of the Released Parties, to the fullest extent permitted by law. Purchaser shall defend, indemnify, and hold the Released Parties harmless from any third-party claim arising out of the ownership, operation, or use of the vehicle(s) after delivery.'],
      ['11. ENTIRE AGREEMENT; FTC BUYERS GUIDE',
       'This Agreement, together with any written warranty or service contract expressly issued with it, constitutes the entire agreement between the parties and supersedes all prior or contemporaneous oral or written communications. No salesperson or representative has authority to modify these terms except in a writing signed by an authorized officer of Dealer. For any used vehicle, the information on the window-form FTC Buyers Guide provided with the vehicle is incorporated into this Agreement and, in the event of any conflict, the Buyers Guide controls.'],
      ['12. ODOMETER & HOUR METER; CERTIFICATION; FEDERAL EXEMPTION',
       'Dealer certifies that, while the vehicle(s) were in Dealer\'s possession, Dealer has not altered, disconnected, reset, or tampered with any odometer or hour meter. The odometer and hour-meter readings stated, if any, are accurate to the best of Dealer\'s knowledge; however, Dealer did not operate the vehicle(s) during their prior service life, has no personal knowledge of their prior use, and cannot and does not verify any reading accrued before Dealer\'s possession. Service and accident history, if any, is provided only as received from prior owners or third-party sources and is not verified or guaranteed by Dealer. PURCHASER ACKNOWLEDGES THAT EACH VEHICLE HAS A GROSS VEHICLE WEIGHT RATING IN EXCESS OF 16,000 POUNDS AND IS THEREFORE EXEMPT FROM FEDERAL ODOMETER MILEAGE DISCLOSURE REQUIREMENTS UNDER 49 C.F.R. \u00a7 580.17; ANY MILEAGE OR HOURS STATED ARE PROVIDED FOR REFERENCE ONLY, DO NOT CONSTITUTE AN ODOMETER DISCLOSURE, AND ARE NOT A REPRESENTATION OR WARRANTY OF ACTUAL MILEAGE, HOURS, OR USE. The purchase price was not determined in reliance on any particular mileage or hours. To the fullest extent permitted by law, Purchaser releases and waives any claim arising from any inaccuracy or discrepancy in odometer or hour-meter readings or vehicle history, except to the extent such claim arises from Dealer\'s own intentional alteration of a reading or knowing misrepresentation while the vehicle(s) were in Dealer\'s possession.', true],
      ['13. GOVERNING LAW; VENUE; ATTORNEY FEES',
       'This Agreement is governed by the laws of the State of Illinois, without regard to conflict-of-law rules. Exclusive venue for any dispute arising out of or relating to this Agreement shall lie in the state courts located in DuPage County, Illinois, and the parties consent to personal jurisdiction there. The prevailing party in any action to enforce this Agreement shall be entitled to recover its reasonable attorney fees and costs.'],
      ['14. SEVERABILITY; WAIVER',
       'If any provision of this Agreement is held invalid or unenforceable, the remaining provisions shall continue in full force and effect, and the invalid provision shall be enforced to the maximum extent permitted. No waiver of any provision shall be effective unless in writing, and no waiver shall constitute a continuing waiver.'],
    ];

    let p2 = pdfDoc.addPage([W,H]);
    let y2 = await addHeader(p2,'TERMS & CONDITIONS OF SALE');
    // vehicle reference box
    const vboxH = 16 + units.length*14;
    box(p2,M,y2-vboxH+8,W-M*2,vboxH);
    units.forEach((u,i)=>{
      dt(p2,`${u.year||''} ${u.make||''} ${u.model||''}`,M+8,y2-10-(i*14),{bold:true,size:9,maxWidth:200});
      dt(p2,'VIN: '+(u.vin||''),M+216,y2-10-(i*14),{size:8.5,maxWidth:165});
      dt(p2,'Unit: '+(u.unit||''),M+400,y2-10-(i*14),{size:8.5});
    });
    y2 -= vboxH + 10;

    const termWidth = W - M*2;
    for (const [heading, body, isCaps] of TERMS) {
      const charsPerLine = isCaps ? 104 : 138;
      const estLines = Math.ceil(body.length / charsPerLine);
      const blockH = 11 + estLines*9.5 + 7;
      if (y2 - blockH < 130) { p2 = pdfDoc.addPage([W,H]); y2 = await addHeader(p2,'TERMS & CONDITIONS (cont.)'); }
      dt(p2, heading, M, y2, {bold:true, size:7.8});
      y2 -= 10;
      p2.drawText(body, {x:M, y:y2, size:7, font, color:rgb(0.08,0.08,0.08), maxWidth:termWidth, lineHeight:9.5});
      y2 -= estLines*9.5 + 8;
    }

    // acknowledgment + signatures (new page if tight)
    if (y2 < 130) { p2 = pdfDoc.addPage([W,H]); y2 = await addHeader(p2,'TERMS & CONDITIONS (cont.)'); }
    y2 -= 4;
    dt(p2,'PURCHASER ACKNOWLEDGES HAVING READ, UNDERSTOOD, AND AGREED TO ALL TERMS ABOVE, INCLUDING THE AS-IS',M,y2,{bold:true,size:7.5});
    y2 -= 10;
    dt(p2,'WARRANTY DISCLAIMER (SEC. 1), LIMITATION OF LIABILITY (SEC. 4), RELEASE (SEC. 10), AND ODOMETER /',M,y2,{bold:true,size:7.5});
    y2 -= 10;
    dt(p2,'HOUR-METER CERTIFICATION AND EXEMPTION (SEC. 12).',M,y2,{bold:true,size:7.5});
    y2 -= 22; ln(p2,y2+8);
    dt(p2,'Purchaser Signature:',M,y2-7,{bold:true,size:9});dt(p2,'_________________________________',M+120,y2-7,{size:9});
    dt(p2,'Date:',M+372,y2-7,{bold:true,size:9});dt(p2,'__________',M+398,y2-7,{size:9});
    y2-=20;
    dt(p2,'Direct Truck Sales:',M,y2-7,{bold:true,size:9});dt(p2,'_________________________________',M+120,y2-7,{size:9});
    dt(p2,'Date:',M+372,y2-7,{bold:true,size:9});dt(p2,'__________',M+398,y2-7,{size:9});

    for(let ui=0;ui<units.length;ui++){
      const u=units[ui];
      const items=[u.item1,u.item2,u.item3,u.item4].filter(Boolean);
      if(!items.length) continue;
      const pw=pdfDoc.addPage([W,H]);let yw=await addHeader(pw,`WORKORDER — Unit ${ui+1}`);
      box(pw,M,yw-58,W-M*2,70);
      dt(pw,`Stock #: ${u.unit||''}`,M+8,yw-8,{bold:true,size:9.5});
      dt(pw,`Make: ${u.make||''}`,M+160,yw-8,{size:9.5});
      dt(pw,`Model: ${u.model||''}`,M+290,yw-8,{size:9.5});
      dt(pw,`VIN: ${u.vin||''}`,M+8,yw-24,{size:9});
      dt(pw,`Purchaser: ${d.personalName||''}${d.businessName?' / '+d.businessName:''}`,M+8,yw-40,{size:9});
      yw-=76;
      dt(pw,'Items to be completed:',M,yw,{bold:true,size:10});yw-=18;
      items.forEach((item,i)=>{
        pw.drawRectangle({x:M,y:yw-26,width:W-M*2,height:30,color:rgb(0.97,0.97,0.97),borderColor:rgb(0.85,0.85,0.85),borderWidth:0.5});
        dt(pw,`${i+1}.`,M+8,yw-10,{bold:true,size:10});
        dt(pw,item,M+24,yw-10,{size:10,maxWidth:W-M*2-32});
        yw-=38;
      });
      yw-=20;
      pw.drawText('The purchaser will be responsible for work performed if the sale is terminated. Work completed once fully funded. Once started, deposits are non-refundable.',
        {x:M,y:yw,size:8,font,color:rgb(0.2,0.2,0.2),maxWidth:W-M*2,lineHeight:12});
      yw-=40;
      pw.drawLine({start:{x:M,y:yw+8},end:{x:W-M,y:yw+8},thickness:0.5,color:rgb(0.75,0.75,0.75)});
      dt(pw,'Purchaser Signature:',M,yw-7,{bold:true,size:9});dt(pw,'______________________________',M+128,yw-7,{size:9});
      dt(pw,'Date:',W/2+30,yw-7,{bold:true,size:9});dt(pw,'________________',W/2+58,yw-7,{size:9});
      yw-=24;
      dt(pw,'Direct Truck Sales:',M,yw-7,{bold:true,size:9});dt(pw,'______________________________',M+128,yw-7,{size:9});
      dt(pw,'Date:',W/2+30,yw-7,{bold:true,size:9});dt(pw,'________________',W/2+58,yw-7,{size:9});
    }

    const pdfBytes=await pdfDoc.save();
    const safeName=(d.personalName||d.businessName||'BillOfSale').replace(/[^a-zA-Z0-9]/g,'_');
    const bosBuf = Buffer.from(pdfBytes);
    const bosUp = await DRIVE.uploadPdf('bos', `BillOfSale_${safeName}_${d.date||new Date().toISOString().split('T')[0]}`, bosBuf);
    res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="BillOfSale_${safeName}.pdf"`,
      'X-Drive-Link': bosUp ? bosUp.link : '', 'Access-Control-Expose-Headers':'X-Drive-Link'});
    res.send(bosBuf);
  } catch(e){ console.error('BOS PDF error:',e); res.status(500).json({error:'PDF generation failed: '+e.message}); }
});

app.post('/billsofsale/:id/delete', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pgQuery(`UPDATE bills_of_sale SET deleted_at=now(), deleted_by=$2 WHERE id=$1`,
      [req.params.id, req.user.username]);
    await audit2(req.user.username, 'delete', 'bill_of_sale', req.params.id, null);
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to delete bill of sale' }); }
});

app.get('/billsofsale/:id', requireAuth, async (req, res) => {
  try {
    const all = await DBR.readBillsOfSale();
    const bos = all.find(b => b.id === req.params.id);
    if (!bos) return res.status(404).json({ error:'Bill of sale not found' });
    res.json(bos);
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to load bill of sale' }); }
});

app.post('/billsofsale/save', requireAuth, async (req, res) => {
  try {
    const sheets=getSheetsClient(); const d=sanitizeObj(req.body); const BOS_SHEET='BillsOfSale';
    if (!d || (!d.personalName && !d.businessName && !d.total)) {
      console.error('BOS save: empty payload received. Keys:', Object.keys(req.body||{}).join(','));
      return res.status(400).json({ error:'Empty bill of sale data received — frontend/server version mismatch?' });
    }
    if (WRITE_TO_SHEETS) await ensureSheetTab(sheets, 'BillsOfSale');
    let hasHeader=false;
    try{const c=await sheets.spreadsheets.values.get({spreadsheetId:SHEET_ID,range:`${BOS_SHEET}!A1`});hasHeader=!!(c.data.values?.length);}catch(e){}
    if(!hasHeader){
      await sheets.spreadsheets.values.update({spreadsheetId:SHEET_ID,range:`${BOS_SHEET}!A1`,valueInputOption:'RAW',
        requestBody:{values:[['ID','Date','Personal Name','Business Name','Address','City','State','Zip',
          'Biz Address','Biz City','Biz State','Biz Zip','Phone','Biz Phone','Email','DL#','DL State',
          'Unit','Year','Make','Model','VIN','Miles','APU','Color','Ratio','HP',
          'Warranty','Sale Price','SC Level','SC Coverage','SC Price','Sales Tax','Title Fee','Doc Fee',
          'Deposit Amount','Deposit Type','Total','Salesperson','Item1','Item2','Item3','Item4','Lead ID','Units JSON']]}});
    }
    const id=d.id||'BOS'+Date.now();
    if (WRITE_TO_SHEETS) await appendRowSafe(sheets, BOS_SHEET, [id,d.date||new Date().toISOString().split('T')[0],
        d.personalName||'',d.businessName||'',d.address||'',d.city||'',d.state||'',d.zip||'',
        d.bizAddress||'',d.bizCity||'',d.bizState||'',d.bizZip||'',
        d.phone||'',d.bizPhone||'',d.email||'',d.dlNumber||'',d.dlState||'',
        d.unit||'',d.year||'',d.make||'',d.model||'',d.vin||'',
        d.miles||'',d.apu||'',d.color||'',d.ratio||'',d.hp||'',
        d.warrantyCoverage||'',d.salePrice||'',
        d.serviceContractLevel||'',d.serviceContractCoverage||'',d.serviceContractPrice||'',
        d.salesTax||'',d.titleFee||'',d.docFee||350,
        d.depositAmount||'',d.depositType||'',d.total||'',d.salesperson||'',
        d.item1||'',d.item2||'',d.item3||'',d.item4||'',d.leadId||'',
        d.units?JSON.stringify(d.units):'']);
    // Look up any previous deposit on this id BEFORE the upsert, so edits that don't
    // change the deposit won't re-notify (prevents duplicate deposit alerts on edits).
    let prevDep = null, existedBefore = false;
    try {
      const pr = await pgQuery('SELECT deposit_amount FROM bills_of_sale WHERE id=$1', [id]);
      if (pr.rows.length) { existedBefore = true; prevDep = parseFloat(String(pr.rows[0].deposit_amount||'').replace(/[^0-9.]/g,'')); if (isNaN(prevDep)) prevDep = 0; }
    } catch(e) {}

    await DBW.mirrorBillOfSale(id, d, req.user && req.user.username);
    res.json({success:true,id});
    // Notify finance + owners when a deposit was taken (non-blocking, never throws)
    try {
      const dep = parseFloat(String(d.depositAmount||'').replace(/[^0-9.]/g,''));
      const depositIsNew = !existedBefore || (prevDep != null && dep !== prevDep && dep > (prevDep||0));
      if (!isNaN(dep) && dep > 0 && depositIsNew) {
        const savedBy = req.user && req.user.username;
        // 1) In-app notification for office + admin (you, Olia, finance roles)
        const c = MAIL.depositContent(d, savedBy);
        DBW.createNotification({
          kind:'deposit', title:'Deposit received', body:c.summary,
          linkType: d.leadId ? 'lead' : '', linkId: d.leadId || '',
          forRoles:'office,admin',
        }).catch(e => console.warn('[deposit-notify in-app]', e.message));
        // 2) Email via Google Workspace SMTP (non-blocking)
        MAIL.notifyDeposit(d, savedBy).catch(e => console.warn('[deposit-notify email]', e.message));
      }
    } catch(e) { console.warn('[deposit-notify]', e.message); }
  } catch(e){console.error(e);res.status(500).json({error:'Failed to save bill of sale'});}
});

app.get('/billsofsale', requireAuth, async (req, res) => {
  try {
    if (await usePg()) { return res.json(await DBR.readBillsOfSale()); }
    const sheets=getSheetsClient();
    if (WRITE_TO_SHEETS) await ensureSheetTab(sheets, 'BillsOfSale');
    const response=await sheets.spreadsheets.values.get({spreadsheetId:SHEET_ID,range:'BillsOfSale'});
    const rows=response.data.values||[];
    if(rows.length<=1) return res.json([]);
    const records=rows.slice(1).filter(r=>r && r.length>2 && ((r[2]||'').trim()||(r[3]||'').trim()||(r[37]||'').toString().trim())).map(r=>({
      id:r[0]||'',date:r[1]||'',personalName:r[2]||'',businessName:r[3]||'',
      address:r[4]||'',city:r[5]||'',state:r[6]||'',zip:r[7]||'',
      bizAddress:r[8]||'',bizCity:r[9]||'',bizState:r[10]||'',bizZip:r[11]||'',
      phone:r[12]||'',bizPhone:r[13]||'',email:r[14]||'',dlNumber:r[15]||'',dlState:r[16]||'',
      unit:r[17]||'',year:r[18]||'',make:r[19]||'',model:r[20]||'',vin:r[21]||'',
      miles:r[22]||'',apu:r[23]||'',color:r[24]||'',ratio:r[25]||'',hp:r[26]||'',
      warrantyCoverage:r[27]||'',salePrice:r[28]||'',
      serviceContractLevel:r[29]||'',serviceContractCoverage:r[30]||'',serviceContractPrice:r[31]||'',
      salesTax:r[32]||'',titleFee:r[33]||'',docFee:r[34]||'',
      depositAmount:r[35]||'',depositType:r[36]||'',total:r[37]||'',salesperson:r[38]||'',
      item1:r[39]||'',item2:r[40]||'',item3:r[41]||'',item4:r[42]||'',leadId:r[43]||'',
      units:r[44]?(()=>{try{return JSON.parse(r[44]);}catch(e){return null;}})():null
    })).reverse();
    res.json(records);
  } catch(e){ console.error('BOS list', e.message); res.json([]); }
});

// ── CLOSING PACKAGE ────────────────────────────────────────────────────────────

async function generateDeliveryReceipt(d) {
  const pdfDoc=await PDFDocument.create();
  const fontBold=await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font=await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page=pdfDoc.addPage([612,792]);
  const W=612,H=792,M=54;
  const dt=(text,x,y,opts={})=>{try{page.drawText(String(text||''),{x,y,size:opts.size||9,font:opts.bold?fontBold:font,color:rgb(...(opts.color||[0,0,0])),maxWidth:opts.maxWidth||(W-M-x)});}catch(e){}};
  const ln=(y,x1=M,x2=W-M,t=0.5,clr=[0.75,0.75,0.75])=>page.drawLine({start:{x:x1,y},end:{x:x2,y},thickness:t,color:rgb(...clr)});
  const bx=(x,y,w,h,fill=[0.96,0.96,0.96])=>page.drawRectangle({x,y,width:w,height:h,color:rgb(...fill),borderColor:rgb(0.82,0.82,0.82),borderWidth:0.5});
  try{const img=await pdfDoc.embedJpg(Buffer.from(LOGO_B64,'base64'));const dims=img.scaleToFit(130,48);page.drawImage(img,{x:M,y:H-50-dims.height+8,width:dims.width,height:dims.height});}catch(e){}
  const ax=W-M-175;
  dt('Direct Truck Sales Inc.',ax,H-50,{bold:true,size:9});
  dt('15w740 N. Frontage Rd, Ste 2',ax,H-62,{size:8});
  dt('Burr Ridge, IL 60527',ax,H-73,{size:8});
  dt('630-701-1000',ax,H-84,{size:8});
  dt('Sales@Direct-Truck.com',ax,H-95,{size:8,color:[0,0.3,0.7]});
  let y=H-118;
  page.drawRectangle({x:M,y:y-15,width:W-M*2,height:22,color:rgb(0.12,0.12,0.12)});
  dt('TRUCK DELIVERY RECEIPT',W/2-80,y-7,{bold:true,size:13,color:[1,1,1]});
  y-=30;
  bx(M,y-78,W-M*2,90);
  dt('VEHICLE INFORMATION',M+6,y-6,{bold:true,size:7.5,color:[0.4,0.4,0.4]});
  const half=(W-M*2)/2;
  const vr=(label,val,x,vy,lw=52)=>{dt(label,x,vy,{bold:true,size:8.5});dt(val||'',x+lw,vy,{size:9,maxWidth:half-lw-10});ln(vy-3,x+lw,x+half-8,0.3);};
  vr('Stock #:',d.unit||'',M+8,y-20,52); vr('Year:',d.year||'',M+8+half,y-20,38);
  vr('Make:',d.make||'',M+8,y-36,52);   vr('Model:',d.model||'',M+8+half,y-36,38);
  dt('VIN:',M+8,y-52,{bold:true,size:8.5});dt(d.vin||'',M+38,y-52,{size:9,maxWidth:W-M*2-50});
  ln(y-55,M+38,W-M-8,0.3);
  y-=96;y-=12;
  dt('Received the above-described unit in good condition.',W/2-150,y,{bold:true,size:10});
  y-=16;
  page.drawText("Undersigned assumes all responsibility, risk of loss, damage, repairs and agrees to the terms and conditions outlined in the Bill of Sale and Terms and Conditions of Used Vehicle – Dealer's Warranty Disclaimer. Undersigned acknowledges the receipt of terms and conditions.",
    {x:M,y,size:8.5,font,color:rgb(0.1,0.1,0.1),maxWidth:W-M*2,lineHeight:13});
  y-=40;y-=10;
  bx(M,y-68,W-M*2,80);
  dt('PURCHASER INFORMATION',M+6,y-6,{bold:true,size:7.5,color:[0.4,0.4,0.4]});
  const customerName=[d.personalName,d.businessName].filter(Boolean).join(' / ');
  vr('Date:',d.date||'',M+8,y-22,42); vr('Customer:',customerName,M+8+half,y-22,68);
  vr('Address:',d.address||'',M+8,y-38,52);
  dt('City/St/ZIP:',M+8,y-54,{bold:true,size:8.5});dt(`${d.city||''}, ${d.state||''} ${d.zip||''}`,M+72,y-54,{size:9,maxWidth:W-M*2-80});
  ln(y-57,M+72,W-M-8,0.3);
  y-=90;y-=30;
  ln(y,M,M+220,0.8,[0,0,0]);ln(y,W-M-220,W-M,0.8,[0,0,0]);
  dt('Customer Signature',M,y-13,{size:8,color:[0.4,0.4,0.4]});
  dt('Direct Truck Sales Representative',W-M-220,y-13,{size:8,color:[0.4,0.4,0.4]});
  page.drawLine({start:{x:M,y:36},end:{x:W-M,y:36},thickness:1.5,color:rgb(0.85,0.45,0.1)});
  dt('Direct Truck Sales Inc.  |  15w740 N. Frontage Rd, Ste 2, Burr Ridge, IL 60527  |  630-701-1000',W/2-190,24,{size:7.5,color:[0.4,0.4,0.4]});
  return await pdfDoc.save();
}

app.post('/closing/generate', requireAuth, requireFeature('closing'), async (req, res) => {
  try {
    const {formId, data:d} = req.body;
    applyClosingIdentity(d);
    const isIL = ['IL','il'].includes((d.state||d.bizState||'').trim());
    const dateParts=(d.date||'').split('-');
    const [yr,mo,day]=dateParts.length===3?dateParts:['','',''];
    let pdfBytes;

    switch(formId) {
      case 'rut7': {
        const formBytes=fs.readFileSync(path.join(FORMS_DIR,'rut7.pdf'));
        const [aA,pA,sA]=fmtPhone(d.phone);
        const [aC,pC,sC]=fmtPhone(d.carrierPhone);
        const leased=d.isLeased===true||d.isLeased==='true';
        pdfBytes=await fillPdfFields(formBytes,{
          'Purchaser Name':d.personalName||d.businessName||'',
          'Purchaser Address':d.address||'','Purchaser City':d.city||'',
          'Purchaser State':d.state||'','Purchaser ZIP':d.zip||'',
          'Purchaser Phone Area Code_A':aA,'Purchaser Phone Prefix_B':pA,'Purchaser Phone Suffix_C':sA,
          'Lease Customer name':leased?(d.carrierName||''):'',
          'Lease Customer Address':leased?(d.carrierAddress||''):'',
          'Lease Customer City':leased?(d.carrierCity||''):'',
          'Lease State':leased?(d.carrierState||''):'',
          'Lease customer Zip':leased?(d.carrierZip||''):'',
          'Lease Customer Phone Area Code':leased?aC:'',
          'Lease Customer Phone Prefix Code':leased?pC:'',
          'Lease Customer Phone Suffix Code':leased?sC:'',
          'Date of purchase - Month':mo,'Date of purchase - Day':day,'Date of purchase - Year':yr,
          'Year, make, and model':`${d.year||''} ${d.make||''} ${d.model||''}`.trim(),
          'Vehicle identification number':d.vin||'',
          '6A':'/Purchases of motor vehicles and trailers ',
          '1':true,'2':true,'USDOT No':d.usdot||'','4':true,
          '4A':'/Authorized for hire Authorized for hire',
          '5A':'/I certify that this purchase qualifies for the rolling stock execmption.I certify that this purchase qualifies for the rolling stock exemption.I certify that this purchase qualifies for the rolling#2',
        });
        break;
      }
      case 'dot': {
        const formBytes=fs.readFileSync(path.join(FORMS_DIR,'dot.pdf'));
        pdfBytes=await fillPdfFields(formBytes,{
          'Text_1':d.reportNumber||`${yr}-${String(Date.now()).slice(-4)}`,
          'Text_2':d.unit||'',
          'Date_1':d.date?`${mo}/${day}/${yr}`:'',
          'Text_7':d.vin||'',
          'Checkbox_3':'/Checkbox_3',
        });
        break;
      }
      case 'buyers': {
        const formBytes=fs.readFileSync(path.join(FORMS_DIR,'buyers-guide.pdf'));
        pdfBytes=await fillPdfFields(formBytes,{
          'topmostSubform[0].BG-AsIs[0].VehicleMake[0]':d.make||'',
          'topmostSubform[0].BG-AsIs[0].Model[0]':d.model||'',
          'topmostSubform[0].BG-AsIs[0].Year[0]':d.year||'',
          'topmostSubform[0].BG-AsIs[0].VIN[0]':d.vin||'',
          'topmostSubform[0].BG-Implied[0].VehicleMake[0]':d.make||'',
          'topmostSubform[0].BG-Implied[0].Model[0]':d.model||'',
          'topmostSubform[0].BG-Implied[0].Year[0]':d.year||'',
          'topmostSubform[0].BG-Implied[0].VIN[0]':d.vin||'',
        });
        break;
      }
      case 'rt5': {
        if(!isIL) return res.status(400).json({error:'RT-5 only required for Illinois addresses'});
        // Overlay approach: DA string empty so fillable fields auto-scale huge. Overlay text instead.
        const formBytes=fs.readFileSync(path.join(FORMS_DIR,'rt5.pdf'));
        const role = d.role || 'agent';
        const nameLine = d.businessName
          ? `${d.personalName||d.businessName}, ${role} for ${d.businessName}`
          : (d.personalName||'');
        const addrLine = [d.address,d.city,d.state,d.zip].filter(Boolean).join(', ');
        // Create text overlay at exact field rect positions (extracted from blank RT5)
        const overlayDoc = await PDFDocument.create();
        const overlayPage = overlayDoc.addPage([612, 792]);
        const hvRT5 = await overlayDoc.embedFont(StandardFonts.Helvetica);
        for(const f of [
          {text:nameLine,    x:38,  y:574, size:9.5, maxW:530},
          {text:addrLine,    x:134, y:540, size:9,   maxW:435},
          {text:d.make||'',  x:110, y:426, size:9,   maxW:172},
          {text:d.year||'',  x:354, y:427, size:9,   maxW:210},
          {text:d.model||'', x:116, y:399, size:9,   maxW:200},
          {text:'Truck',     x:387, y:399, size:9,   maxW:180},
          {text:d.vin||'',   x:220, y:373, size:9,   maxW:345},
        ]){
          overlayPage.drawText(String(f.text||''),{x:f.x,y:f.y,size:f.size,font:hvRT5,color:rgb(0,0,0),maxWidth:f.maxW});
        }
        const overlayBytes = await overlayDoc.save();
        // Merge overlay onto original RT5 (keeps B&B pre-filled text intact)
        const baseDocRT5 = await PDFDocument.load(formBytes,{ignoreEncryption:true});
        const [embeddedOverlay] = await baseDocRT5.embedPdf(await PDFDocument.load(overlayBytes),[0]);
        baseDocRT5.getPages()[0].drawPage(embeddedOverlay);
        pdfBytes = await baseDocRT5.save();
        break;
      }
      case 'lpoa': {
        if(!isIL) return res.status(400).json({error:'LPOA only required for Illinois addresses'});
        const formBytes=fs.readFileSync(path.join(FORMS_DIR,'lpoa.pdf'));
        const pdfDoc3=await PDFDocument.load(formBytes,{ignoreEncryption:true});
        const hv=await pdfDoc3.embedFont(StandardFonts.Helvetica);
        const pg3=pdfDoc3.getPages()[0];
        // Name line - smaller font, full width
        // Title row: "President" moved right to clear the "Title" underline label
        // Company name after ", of" gap
        // Address moved up slightly
        for(const f of [
          {text:d.personalName||d.businessName||'', x:182, y:726, size:9,   maxW:380},
          {text:d.role||'President',                 x:58,  y:692, size:8.5, maxW:110},
          {text:d.businessName||'',                  x:240, y:692, size:8.5, maxW:325},
          {text:[d.address,d.city,d.state,d.zip].filter(Boolean).join(', '), x:91, y:662, size:8.5, maxW:490},
        ]){pg3.drawText(String(f.text||''),{x:f.x,y:f.y,size:f.size||9,font:hv,color:rgb(0,0,0),maxWidth:f.maxW||350});}
        pdfBytes=await pdfDoc3.save();
        break;
      }
      case 'receipt': {
        pdfBytes=await generateDeliveryReceipt(d);
        break;
      }
      default: return res.status(400).json({error:'Unknown form: '+formId});
    }

    const safeName=(d.personalName||d.businessName||'closing').replace(/[^a-zA-Z0-9]/g,'_');
    res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${formId}_${safeName}.pdf"`});
    res.send(Buffer.from(pdfBytes));
  } catch(e){ console.error('Closing form error:',e); res.status(500).json({error:'Form generation failed: '+e.message}); }
});

app.post('/closing/generate-all', requireAuth, requireFeature('closing'), async (req, res) => {
  try {
    const {data:d}=req.body;
    applyClosingIdentity(d);
    const isIL=['IL','il'].includes((d.state||d.bizState||'').trim());
    const forms=['rut7','dot','buyers','receipt'];
    if(isIL){forms.push('rt5');forms.push('lpoa');}
    const merged=await PDFDocument.create();
    for(const formId of forms){
      try{
        const genResp=await fetch(`http://localhost:${process.env.PORT||3000}/closing/generate`,{
          method:'POST',headers:{'Content-Type':'application/json','Authorization':req.headers.authorization},
          body:JSON.stringify({formId,data:d})
        });
        if(!genResp.ok){console.warn(`Skipping ${formId}`);continue;}
        const srcBytes=Buffer.from(await genResp.arrayBuffer());
        const srcDoc=await PDFDocument.load(srcBytes,{ignoreEncryption:true});
        const pages=await merged.copyPages(srcDoc,srcDoc.getPageIndices());
        pages.forEach(p=>merged.addPage(p));
      }catch(e){console.warn(`Error generating ${formId}:`,e.message);}
    }
    const mergedBytes=await merged.save();
    const safeName=(d.personalName||d.businessName||'closing').replace(/[^a-zA-Z0-9]/g,'_');
    const cpBuf = Buffer.from(mergedBytes);
    const cpUp = await DRIVE.uploadPdf('closing', `ClosingPackage_${safeName}_${d.date||new Date().toISOString().split('T')[0]}`, cpBuf);
    res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="ClosingPackage_${safeName}.pdf"`,
      'X-Drive-Link': cpUp ? cpUp.link : '', 'Access-Control-Expose-Headers':'X-Drive-Link'});
    res.send(cpBuf);
  }catch(e){console.error('Generate all error:',e);res.status(500).json({error:'Failed to generate package: '+e.message});}
});

app.post('/closing/save', requireAuth, requireFeature('closing'), async (req, res) => {
  try {
    const sheets=getSheetsClient(); const d=sanitizeObj(req.body); const SHEET='ClosingPackages';
    if (WRITE_TO_SHEETS) await ensureSheetTab(sheets, 'ClosingPackages');
    let hasHeader=false;
    try{const c=await sheets.spreadsheets.values.get({spreadsheetId:SHEET_ID,range:`${SHEET}!A1`});hasHeader=!!(c.data.values?.length);}catch(e){}
    if(!hasHeader){
      await sheets.spreadsheets.values.update({spreadsheetId:SHEET_ID,range:`${SHEET}!A1`,valueInputOption:'RAW',
        requestBody:{values:[['ID','Date','Customer Name','Business Name','Address','City','State','Zip','Phone',
          'Unit','Year','Make','Model','VIN','Salesperson','USDOT','MC Number','Is Leased',
          'Carrier Name','Carrier Address','Carrier City','Carrier State','Carrier Zip','Carrier Phone',
          'Role','Role','BOS ID','Notes']]}});
    }
    const id='CP'+Date.now();
    if (WRITE_TO_SHEETS) await appendRowSafe(sheets, SHEET, [id,d.date||new Date().toISOString().split('T')[0],
        d.personalName||'',d.businessName||'',d.address||'',d.city||'',d.state||'',d.zip||'',d.phone||'',
        d.unit||'',d.year||'',d.make||'',d.model||'',d.vin||'',d.salesperson||'',
        d.usdot||'',d.mcNumber||'',d.isLeased?'Yes':'No',
        d.carrierName||'',d.carrierAddress||'',d.carrierCity||'',d.carrierState||'',d.carrierZip||'',d.carrierPhone||'',
        d.role||'agent',d.bosId||'',d.notes||'']);
    await DBW.mirrorClosing(id, d, req.user && req.user.username);
    res.json({success:true,id});
  }catch(e){console.error(e);res.status(500).json({error:'Failed to save closing package'});}
});

app.get('/closing', requireAuth, requireFeature('closing'), async (req, res) => {
  try {
    if (await usePg()) { return res.json(await DBR.readClosing()); }
    const sheets=getSheetsClient();
    if (WRITE_TO_SHEETS) await ensureSheetTab(sheets, 'ClosingPackages');
    const response=await sheets.spreadsheets.values.get({spreadsheetId:SHEET_ID,range:'ClosingPackages'});
    const rows=response.data.values||[];
    if(rows.length<=1) return res.json([]);
    const records=rows.slice(1).filter(r=>r && r.length>2 && ((r[2]||'').trim()||(r[3]||'').trim())).map(r=>({
      id:r[0]||'',date:r[1]||'',personalName:r[2]||'',businessName:r[3]||'',
      address:r[4]||'',city:r[5]||'',state:r[6]||'',zip:r[7]||'',phone:r[8]||'',
      unit:r[9]||'',year:r[10]||'',make:r[11]||'',model:r[12]||'',vin:r[13]||'',
      salesperson:r[14]||'',usdot:r[15]||'',mcNumber:r[16]||'',isLeased:r[17]==='Yes',
      carrierName:r[18]||'',carrierAddress:r[19]||'',carrierCity:r[20]||'',
      carrierState:r[21]||'',carrierZip:r[22]||'',carrierPhone:r[23]||'',
      role:r[24]||'agent',bosId:r[25]||'',notes:r[26]||''
    })).reverse();
    res.json(records);
  }catch(e){ console.error('CP list', e.message); res.json([]); }
});


// ── DIAGNOSTIC: inspect raw sheet rows (admin only) ───────────────────────────
app.get('/debug/sheet/:tab', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error:'Admin only' });
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:req.params.tab });
    const rows = response.data.values || [];
    res.json({
      tab: req.params.tab, totalRows: rows.length,
      headerLength: rows[0] ? rows[0].length : 0,
      header: rows[0] || [],
      firstDataRows: rows.slice(1, 4).map(r => ({ length:r.length, first8: r.slice(0,8) })),
      lastDataRow: rows.length > 1 ? { length: rows[rows.length-1].length, first8: rows[rows.length-1].slice(0,8) } : null,
    });
  } catch(e) { res.json({ error: e.message }); }
});

// ── START ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Dealer CRM server running on port ${PORT}`));
