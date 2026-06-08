const express    = require('express');
const cors       = require('cors');
const jwt        = require('jsonwebtoken');
const path       = require('path');
const fs         = require('fs');
const { google } = require('googleapis');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const app = express();
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(o=>o.trim()).filter(Boolean);
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// ── CONFIG ─────────────────────────────────────────────────────────────────────
const JWT_SECRET   = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('FATAL: JWT_SECRET env var not set'); process.exit(1); }
const SHEET_ID     = process.env.SHEET_ID;
const SHEET_NAME   = process.env.SHEET_NAME || 'Sheet1';
const INV_SHEET_ID = '1_R2mmi6O_KQW1mSd1Nu26fJDwrXKtRwH9vTwGnA2fN4';
const FORMS_DIR    = path.join(__dirname, '..', 'forms');

const USERS = [
  { username:'don',     password: process.env.PASS_DON,     name:'Don',     role:'sales' },
  { username:'vitalie', password: process.env.PASS_VITALIE, name:'Vitalie', role:'sales' },
  { username:'tom',     password: process.env.PASS_TOM,     name:'Tom',     role:'admin' },
];

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

// ── AUTH MIDDLEWARE ────────────────────────────────────────────────────────────
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
app.post('/auth/login', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
  }
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = USERS.find(u => u.username === (username||'').toLowerCase() && u.password === password);
  if (!user) return res.status(401).json({ error:'Invalid username or password' });
  const token = jwt.sign({ username:user.username, name:user.name, role:user.role }, JWT_SECRET, { expiresIn:'12h' });
  res.json({ token, name:user.name, role:user.role });
});

// ── DOWC ───────────────────────────────────────────────────────────────────────
app.get('/dowc-levels', requireAuth, (req, res) => res.json(DOWC_LEVELS));

// ── LEADS ──────────────────────────────────────────────────────────────────────
app.get('/leads', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:SHEET_NAME });
    const rows = response.data.values || [];
    if (rows.length <= 1) return res.json([]);
    const leads = rows.slice(1).map((r,i) => ({
      rowIndex:i+1, id:r[0]||'', first:r[1]||'', last:r[2]||'', company:r[3]||'',
      phone:r[4]||'', email:r[5]||'', unit:r[6]||'', source:r[7]||'',
      status:r[8]||'Prospect', sales:r[9]||'', followup:r[10]||'', notes:r[11]||'', archived:r[12]||'false',
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
    await sheets.spreadsheets.values.append({
      spreadsheetId:SHEET_ID, range:SHEET_NAME, valueInputOption:'RAW', insertDataOption:'INSERT_ROWS',
      requestBody:{ values:[[id,l.first,l.last,l.company,l.phone,l.email,l.unit,l.source,l.status,l.sales,l.followup,l.notes,archived]] }
    });
    res.json({ success:true, id });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to save lead' }); }
});

app.put('/leads/:rowIndex', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const l = sanitizeObj(req.body);
    const sheetRow = parseInt(req.params.rowIndex)+1;
    const archived = ['Sold','Dead'].includes(l.status) ? 'true' : 'false';
    await sheets.spreadsheets.values.update({
      spreadsheetId:SHEET_ID, range:`${SHEET_NAME}!A${sheetRow}:M${sheetRow}`, valueInputOption:'RAW',
      requestBody:{ values:[[l.id,l.first,l.last,l.company,l.phone,l.email,l.unit,l.source,l.status,l.sales,l.followup,l.notes,archived]] }
    });
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to update lead' }); }
});

// ── INVENTORY ──────────────────────────────────────────────────────────────────
app.get('/inventory', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({ spreadsheetId:INV_SHEET_ID, range:'Sheet1' });
    const rows = response.data.values || [];
    if (rows.length <= 1) return res.json([]);
    const inventory = rows.slice(1).map(r => ({
      unit:r[0]||'', year:r[1]||'', make:r[2]||'', model:r[3]||'',
      hours:r[4]||'', miles:r[5]||'', apu:r[6]||'', color:r[7]||'',
      ratio:r[8]||'', hp:r[9]||'', listPrice:r[10]||'', salePrice:r[11]||'',
      status:r[12]||'', vin:r[13]||'',
    }));
    res.json(inventory);
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

    dt('TEST DRIVE AGREEMENT', M, y, {bold:true, size:15});
    y-=6; dt('Direct Truck Sales Inc.  |  15w740 N. Frontage Rd, Burr Ridge, Illinois', M, y-8, {size:8, italic:true});
    y-=22; ln(y); y-=14;
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
      "Vehicle shall not be operated in violation of any law, nor driven beyond a radius of 25 miles from dealer's place of business.",
      'Vehicle will be preserved and protected from all loss, damage, or injury. Unit is GPS monitored and shall not be modified or altered in any way.',
    ];
    conditions.forEach(c => {
      page.drawText('\u2022  '+c, {x:M+8,y,size:8.2,font,color:rgb(0,0,0),maxWidth:width-M*2-16,lineHeight:12});
      y -= (Math.ceil(c.length/100)*12)+7;
    });

    y-=4; ln(y); y-=12;
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
    res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="TestDrive_${safeName}_${d.date||'nodate'}.pdf"`});
    res.send(Buffer.from(pdfBytes));
  } catch(e) { console.error('Test drive PDF error:',e); res.status(500).json({ error:'PDF generation failed: '+e.message }); }
});

app.post('/testdrive/save', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient(); const d = req.body; const TD_SHEET = 'TestDrives';
    let hasHeader = false;
    try { const c = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:`${TD_SHEET}!A1` }); hasHeader = !!(c.data.values?.length); } catch(e){}
    if (!hasHeader) {
      await sheets.spreadsheets.values.update({ spreadsheetId:SHEET_ID, range:`${TD_SHEET}!A1`, valueInputOption:'RAW',
        requestBody:{ values:[['Date','Customer Name','Phone','Address','City','State','Zip','DL #','DL State','Unit','Make','Model','VIN','Plate','Return Time','Salesperson','Lead ID']] } });
    }
    await sheets.spreadsheets.values.append({ spreadsheetId:SHEET_ID, range:TD_SHEET, valueInputOption:'RAW', insertDataOption:'INSERT_ROWS',
      requestBody:{ values:[[d.date,d.customerName,d.phone,d.address,d.city,d.state,d.zip,d.dlNumber,d.dlState,d.unit,d.make,d.model,d.vin,d.plate,d.returnTime,d.salesperson,d.leadId||'']] } });
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to save record' }); }
});

app.get('/testdrive/history', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:'TestDrives' });
    const rows = response.data.values || [];
    if (rows.length <= 1) return res.json([]);
    const records = rows.slice(1).map(r => ({
      date:r[0]||'', customerName:r[1]||'', phone:r[2]||'', address:r[3]||'',
      city:r[4]||'', state:r[5]||'', zip:r[6]||'', dlNumber:r[7]||'', dlState:r[8]||'',
      unit:r[9]||'', make:r[10]||'', model:r[11]||'', vin:r[12]||'',
      plate:r[13]||'', returnTime:r[14]||'', salesperson:r[15]||'', leadId:r[16]||''
    })).reverse();
    res.json(records);
  } catch(e) { res.status(500).json({ error:'Failed to load history' }); }
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

    const p2=pdfDoc.addPage([W,H]);let y2=await addHeader(p2,'TERMS & CONDITIONS');
    box(p2,M,y2-32,W-M*2,44);
    units.forEach((u,i)=>{
      dt(p2,`${u.year||''} ${u.make||''} ${u.model||''}`,M+8,y2-10-(i*14),{bold:true,size:9,maxWidth:200});
      dt(p2,'VIN: '+(u.vin||''),M+216,y2-10-(i*14),{size:8.5,maxWidth:165});
      dt(p2,'Unit: '+(u.unit||''),M+400,y2-10-(i*14),{size:8.5});
    });
    y2-=46;
    dt(p2,"Terms — Used Vehicle Dealer's Warranty Disclaimer",M,y2,{bold:true,size:9.5});y2-=16;
    p2.drawText("The above-described motor vehicle(s) are sold \"as is\" with all faults. No warranty of merchantability or fitness is made. Buyer bears all repair costs. Direct Truck Sales Inc shall not be liable for consequential or incidental damages. Buyer is responsible for all registration and title fees, confirms inspection and purchase decision based thereon. All manufacturer warranties are the manufacturer's alone. Buyer releases Direct Truck Sales Inc from any current or future liabilities. Upon completion buyer is solely responsible for the vehicle.",
      {x:M,y:y2,size:7.8,font,color:rgb(0.1,0.1,0.1),maxWidth:W-M*2,lineHeight:12});
    y2-=100;
    dt(p2,'Release from Liability',M,y2,{bold:true,size:9});y2-=14;
    p2.drawText('I fully and forever release and discharge Direct Truck Sales Inc from all injuries, losses, damages, claims and liabilities arising from my use of the motor vehicle(s), even if due to their negligence, to the fullest extent permitted by law.',
      {x:M,y:y2,size:7.8,font,color:rgb(0.1,0.1,0.1),maxWidth:W-M*2,lineHeight:12});
    y2-=50;ln(p2,y2+8);
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
    res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="BillOfSale_${safeName}.pdf"`});
    res.send(Buffer.from(pdfBytes));
  } catch(e){ console.error('BOS PDF error:',e); res.status(500).json({error:'PDF generation failed: '+e.message}); }
});

app.post('/billsofsale/save', requireAuth, async (req, res) => {
  try {
    const sheets=getSheetsClient(); const d=sanitizeObj(req.body); const BOS_SHEET='BillsOfSale';
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
    await sheets.spreadsheets.values.append({spreadsheetId:SHEET_ID,range:BOS_SHEET,valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',
      requestBody:{values:[[id,d.date||new Date().toISOString().split('T')[0],
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
        d.units?JSON.stringify(d.units):'']]}});
    res.json({success:true,id});
  } catch(e){console.error(e);res.status(500).json({error:'Failed to save bill of sale'});}
});

app.get('/billsofsale', requireAuth, async (req, res) => {
  try {
    const sheets=getSheetsClient();
    const response=await sheets.spreadsheets.values.get({spreadsheetId:SHEET_ID,range:'BillsOfSale'});
    const rows=response.data.values||[];
    if(rows.length<=1) return res.json([]);
    const records=rows.slice(1).map(r=>({
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
  } catch(e){res.status(500).json({error:'Failed to load bills of sale'});}
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

app.post('/closing/generate', requireAuth, async (req, res) => {
  try {
    const {formId, data:d} = req.body;
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

app.post('/closing/generate-all', requireAuth, async (req, res) => {
  try {
    const {data:d}=req.body;
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
    res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="ClosingPackage_${safeName}.pdf"`});
    res.send(Buffer.from(mergedBytes));
  }catch(e){console.error('Generate all error:',e);res.status(500).json({error:'Failed to generate package: '+e.message});}
});

app.post('/closing/save', requireAuth, async (req, res) => {
  try {
    const sheets=getSheetsClient(); const d=sanitizeObj(req.body); const SHEET='ClosingPackages';
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
    await sheets.spreadsheets.values.append({spreadsheetId:SHEET_ID,range:SHEET,valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',
      requestBody:{values:[[id,d.date||new Date().toISOString().split('T')[0],
        d.personalName||'',d.businessName||'',d.address||'',d.city||'',d.state||'',d.zip||'',d.phone||'',
        d.unit||'',d.year||'',d.make||'',d.model||'',d.vin||'',d.salesperson||'',
        d.usdot||'',d.mcNumber||'',d.isLeased?'Yes':'No',
        d.carrierName||'',d.carrierAddress||'',d.carrierCity||'',d.carrierState||'',d.carrierZip||'',d.carrierPhone||'',
        d.role||'agent',d.bosId||'',d.notes||'']]}});
    res.json({success:true,id});
  }catch(e){console.error(e);res.status(500).json({error:'Failed to save closing package'});}
});

app.get('/closing', requireAuth, async (req, res) => {
  try {
    const sheets=getSheetsClient();
    const response=await sheets.spreadsheets.values.get({spreadsheetId:SHEET_ID,range:'ClosingPackages'});
    const rows=response.data.values||[];
    if(rows.length<=1) return res.json([]);
    const records=rows.slice(1).map(r=>({
      id:r[0]||'',date:r[1]||'',personalName:r[2]||'',businessName:r[3]||'',
      address:r[4]||'',city:r[5]||'',state:r[6]||'',zip:r[7]||'',phone:r[8]||'',
      unit:r[9]||'',year:r[10]||'',make:r[11]||'',model:r[12]||'',vin:r[13]||'',
      salesperson:r[14]||'',usdot:r[15]||'',mcNumber:r[16]||'',isLeased:r[17]==='Yes',
      carrierName:r[18]||'',carrierAddress:r[19]||'',carrierCity:r[20]||'',
      carrierState:r[21]||'',carrierZip:r[22]||'',carrierPhone:r[23]||'',
      role:r[24]||'agent',bosId:r[25]||'',notes:r[26]||''
    })).reverse();
    res.json(records);
  }catch(e){res.status(500).json({error:'Failed to load closing packages'});}
});

// ── START ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Dealer CRM server running on port ${PORT}`));
