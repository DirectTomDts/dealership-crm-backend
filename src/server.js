const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '5mb' }));

// ── CONFIG ─────────────────────────────────────────────────────────────────────
const JWT_SECRET   = process.env.JWT_SECRET || 'change-this-secret';
const SHEET_ID     = process.env.SHEET_ID;
const SHEET_NAME   = process.env.SHEET_NAME || 'Sheet1';
const INV_SHEET_ID = '1_R2mmi6O_KQW1mSd1Nu26fJDwrXKtRwH9vTwGnA2fN4';

const USERS = [
  { username:'don',     password: process.env.PASS_DON     || 'Don2024!',     name:'Don',     role:'sales' },
  { username:'vitalie', password: process.env.PASS_VITALIE || 'Vitalie2024!', name:'Vitalie', role:'sales' },
  { username:'tom',     password: process.env.PASS_TOM     || 'Tom2024!',     name:'Tom',     role:'admin' },
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

// ── GOOGLE SHEETS AUTH ─────────────────────────────────────────────────────────
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

// ── HEALTH ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status:'Dealer CRM API running' }));

// ── LOGIN ──────────────────────────────────────────────────────────────────────
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = USERS.find(u => u.username === username.toLowerCase() && u.password === password);
  if (!user) return res.status(401).json({ error:'Invalid username or password' });
  const token = jwt.sign({ username:user.username, name:user.name, role:user.role }, JWT_SECRET, { expiresIn:'12h' });
  res.json({ token, name:user.name, role:user.role });
});

// ── DOWC LEVELS ────────────────────────────────────────────────────────────────
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
    const l = req.body;
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
    const l = req.body;
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
    const margin = 48;
    let y = height - 48;

    const dt = (text, x, yPos, opts={}) => {
      try { page.drawText(String(text||''), { x, y:yPos, size:opts.size||10, font:opts.bold?fontBold:(opts.italic?fontItalic:font), color:rgb(0,0,0), maxWidth:opts.maxWidth||500 }); } catch(e){}
    };
    const ln = (yPos, x1=margin, x2=width-margin) => {
      page.drawLine({ start:{x:x1,y:yPos}, end:{x:x2,y:yPos}, thickness:0.5, color:rgb(0.5,0.5,0.5) });
    };

    dt('TEST DRIVE AGREEMENT', margin, y, {bold:true, size:15});
    y -= 6;
    dt('Direct Truck Sales Inc.  |  15w740 N. Frontage Rd, Burr Ridge, Illinois', margin, y-8, {size:8, italic:true});
    y -= 22; ln(y); y -= 14;
    dt('The undersigned acknowledges receiving the following vehicle for test drive purposes:', margin, y, {size:9, italic:true});
    y -= 18;

    page.drawRectangle({x:margin, y:y-6, width:width-margin*2, height:50, color:rgb(0.94,0.94,0.94), borderColor:rgb(0.75,0.75,0.75), borderWidth:0.5});
    dt('Make:',  margin+8,   y+28, {bold:true,size:9}); dt(d.make||'',  margin+44,  y+28, {size:9});
    dt('Year:',  margin+140, y+28, {bold:true,size:9}); dt(d.year||'',  margin+168, y+28, {size:9});
    dt('Model:', margin+218, y+28, {bold:true,size:9}); dt(d.model||'', margin+252, y+28, {size:9});
    dt('VIN / Serial #:', margin+8,   y+10, {bold:true,size:9}); dt(d.vin||'',  margin+86,  y+10, {size:9, maxWidth:160});
    dt('Stock #:',        margin+270, y+10, {bold:true,size:9}); dt(d.unit||'', margin+314, y+10, {size:9});
    dt('Plate #:',        margin+380, y+10, {bold:true,size:9}); dt(d.plate||'',margin+422, y+10, {size:9});
    y -= 62;

    dt('Date:', margin, y, {bold:true,size:9}); dt(d.date||'', margin+36, y, {size:9});
    dt('Return by:', margin+180, y, {bold:true,size:9}); dt(d.returnTime||'', margin+240, y, {size:9});
    y -= 18; ln(y); y -= 12;

    dt('CONDITIONS & REPRESENTATIONS:', margin, y, {bold:true, size:9}); y -= 13;
    const conditions = [
      "Vehicle shall be returned within 3 hours or on dealer's demand, free of liens, in the same condition as received, or undersigned shall pay for all repairs necessary.",
      'Undersigned shall pay dealer immediately the full present retail value of the vehicle if it is not returned for any reason whatsoever.',
      'Vehicle is to be driven exclusively by the undersigned for test drive purposes only and shall not be used for transportation of persons or property for hire.',
      "Vehicle shall not be operated in violation of any law (Federal, State, or local), nor driven beyond a radius of 25 miles from dealer's place of business.",
      'Vehicle will be preserved and protected from all loss, damage, or injury. Unit is GPS monitored and shall not be modified or altered in any way.',
    ];
    conditions.forEach(c => {
      page.drawText('\u2022  '+c, {x:margin+8, y, size:8.2, font, color:rgb(0,0,0), maxWidth:width-margin*2-16, lineHeight:12});
      y -= (Math.ceil(c.length/100)*12)+7;
    });

    y -= 4; ln(y); y -= 12;
    dt('DYNO Testing NOT allowed', margin, y, {bold:true,size:9}); dt('Initials: ____________', width-margin-130, y, {size:9});
    y -= 13;
    dt('Calibration, programming, and Parked Forced Regeneration NOT allowed', margin, y, {italic:true,size:9}); dt('Initials: ____________', width-margin-130, y, {size:9});
    y -= 16; ln(y); y -= 12;

    const dlTxt = `The undersigned represents that he/she is duly and legally licensed to operate a vehicle under license number [${d.dlNumber||'________________'}] State [${d.dlState||'IL'}] and has no physical conditions that could cause him/her to be unfit to drive said vehicle.`;
    page.drawText(dlTxt, {x:margin, y, size:8, font, color:rgb(0,0,0), maxWidth:width-margin*2, lineHeight:12});
    y -= 36; ln(y); y -= 14;

    const half = (width-margin*2)/2;
    dt('SALESPERSON:',    margin,      y,    {bold:true,size:9}); dt(d.salesperson||'', margin+78,   y,    {size:9});
    dt('DATE:',           margin,      y-16, {bold:true,size:9}); dt(d.date||'',        margin+38,   y-16, {size:9});
    dt('DRIVER LICENSE:', margin,      y-32, {bold:true,size:9}); dt(`${d.dlNumber||''} (${d.dlState||'IL'})`, margin+98, y-32, {size:9});
    dt('CUSTOMER SIGNATURE:', margin+half+8, y,    {bold:true,size:9}); ln(y-2, margin+half+140, width-margin);
    dt('ADDRESS:',            margin+half+8, y-16, {bold:true,size:9}); dt(`${d.address||''}, ${d.city||''}, ${d.state||''} ${d.zip||''}`, margin+half+66, y-16, {size:9, maxWidth:half-70});
    dt('CUSTOMER NAME:',      margin+half+8, y-32, {bold:true,size:9}); dt(d.customerName||'', margin+half+104, y-32, {size:9});
    y -= 50; ln(y); y -= 10;
    dt('Direct Truck Sales Inc. — Test Drive Agreement', margin, y, {size:7, italic:true});

    const pdfBytes = await pdfDoc.save();
    const safeName = (d.customerName||'Agreement').replace(/[^a-zA-Z0-9]/g,'_');
    res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="TestDrive_${safeName}_${d.date||'nodate'}.pdf"`});
    res.send(Buffer.from(pdfBytes));
  } catch(e) {
    console.error('Test drive PDF error:', e);
    res.status(500).json({ error:'PDF generation failed: '+e.message });
  }
});

// ── TEST DRIVE — SAVE ──────────────────────────────────────────────────────────
app.post('/testdrive/save', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const d = req.body;
    const TD_SHEET = 'TestDrives';
    let hasHeader = false;
    try { const c = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:`${TD_SHEET}!A1` }); hasHeader = c.data.values && c.data.values.length > 0; } catch(e) {}
    if (!hasHeader) {
      await sheets.spreadsheets.values.update({
        spreadsheetId:SHEET_ID, range:`${TD_SHEET}!A1`, valueInputOption:'RAW',
        requestBody:{ values:[['Date','Customer Name','Phone','Address','City','State','Zip','DL #','DL State','Unit','Make','Model','VIN','Plate','Return Time','Salesperson','Lead ID']] }
      });
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId:SHEET_ID, range:TD_SHEET, valueInputOption:'RAW', insertDataOption:'INSERT_ROWS',
      requestBody:{ values:[[d.date,d.customerName,d.phone,d.address,d.city,d.state,d.zip,d.dlNumber,d.dlState,d.unit,d.make,d.model,d.vin,d.plate,d.returnTime,d.salesperson,d.leadId||'']] }
    });
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to save record' }); }
});

// ── TEST DRIVE — HISTORY ───────────────────────────────────────────────────────
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
    const W=612, H=792, M=44;

    const dt = (pg,text,x,yPos,opts={}) => {
      try{ pg.drawText(String(text||''),{x,y:yPos,size:opts.size||9,font:opts.bold?fontBold:font,color:rgb(...(opts.color||[0,0,0])),maxWidth:opts.maxWidth||(W-M-x)}); }catch(e){}
    };
    const ln = (pg,yPos,x1=M,x2=W-M,t=0.5) => pg.drawLine({start:{x:x1,y:yPos},end:{x:x2,y:yPos},thickness:t,color:rgb(0.75,0.75,0.75)});
    const box = (pg,x,y,w,h,fill=[0.95,0.95,0.95]) => pg.drawRectangle({x,y,width:w,height:h,color:rgb(...fill),borderColor:rgb(0.82,0.82,0.82),borderWidth:0.5});
    const fmtM = v => { const n=parseFloat(String(v||'0').replace(/[$,]/g,'')); return (!v||isNaN(n)||n===0)?null:'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); };

    // Header block — same layout on every page
    const addHeader = async (pg, title) => {
      let y = H-36;
      // Logo left
      try{
        const img = await pdfDoc.embedJpg(Buffer.from(LOGO_B64,'base64'));
        const dims = img.scaleToFit(130,46);
        pg.drawImage(img,{x:M,y:y-dims.height+8,width:dims.width,height:dims.height});
      }catch(e){}
      // Company info RIGHT-ALIGNED block
      const infoX = W-M-165;
      dt(pg,'Direct Truck Sales Inc.',infoX,y,{bold:true,size:9});
      dt(pg,'15w740 N. Frontage Rd, Ste 2',infoX,y-12,{size:8});
      dt(pg,'Burr Ridge, IL 60527',infoX,y-23,{size:8});
      dt(pg,'630-701-1000',infoX,y-34,{size:8});
      dt(pg,'Sales@Direct-Truck.com',infoX,y-45,{size:8,color:[0,0.3,0.7]});
      dt(pg,'Finance@Direct-Truck.com',infoX,y-56,{size:8,color:[0,0.3,0.7]});
      y -= 68;
      // Title bar
      pg.drawRectangle({x:M,y:y-14,width:W-M*2,height:20,color:rgb(0.12,0.12,0.12)});
      dt(pg,title,W/2-40,y-8,{bold:true,size:12,color:[1,1,1]});
      dt(pg,'Date: '+(d.date||''),W-M-104,y-8,{size:8.5,color:[0.9,0.9,0.9]});
      return y-28;
    };

    // ── PAGE 1: PURCHASER + UNIT 1 ────────────────────────────────────────────
    const p1 = pdfDoc.addPage([W,H]);
    let y = await addHeader(p1,'BILL OF SALE');

    // Purchaser box
    const LBL=86, VAL=W/2-M-LBL-8;
    box(p1,M,y-96,W-M*2,108);
    dt(p1,'PURCHASER',M+6,y-5,{bold:true,size:7.5,color:[0.4,0.4,0.4]});
    dt(p1,'Sales Rep: '+(d.salesperson||''),W-M-150,y-5,{size:8});
    y-=18;
    // 2-column info table
    const col1=M+6, col2=W/2+6;
    const row=(pg,yp,l1,v1,l2,v2)=>{
      dt(pg,l1,col1,yp,{bold:true,size:8.5}); dt(pg,v1||'',col1+LBL,yp,{size:8.5,maxWidth:VAL});
      if(l2){dt(pg,l2,col2,yp,{bold:true,size:8.5}); dt(pg,v2||'',col2+LBL,yp,{size:8.5,maxWidth:VAL});}
    };
    row(p1,y,'Name:',d.personalName,'Business:',d.businessName); y-=13;
    row(p1,y,'Address:',d.address,'Address:',(d.bizAddress||d.address)); y-=13;
    const csz=`${d.city||''}, ${d.state||''} ${d.zip||''}`;
    const bcsz=d.bizCity?`${d.bizCity}, ${d.bizState||''} ${d.bizZip||''}`:csz;
    row(p1,y,'City/St/ZIP:',csz,'City/St/ZIP:',bcsz); y-=13;
    row(p1,y,'Phone:',d.phone,'Phone:',(d.bizPhone||d.phone)); y-=13;
    row(p1,y,'Email:',d.email,'DL # / State:',`${d.dlNumber||''} ${d.dlState?'('+d.dlState+')':''}`); y-=18;

    // Units loop — each unit gets its own section box
    for(let ui=0;ui<units.length;ui++){
      const u=units[ui];
      const hasItems=[u.item1,u.item2,u.item3,u.item4].filter(Boolean).length>0;
      // Check if we need a new page
      if(y < 280){ const np=pdfDoc.addPage([W,H]); y=await addHeader(np,`BILL OF SALE — Unit ${ui+1} (cont.)`); }

      // Vehicle box
      const vBoxH = 70;
      box(p1,M,y-vBoxH,W-M*2,vBoxH+12);
      dt(p1,units.length>1?`VEHICLE — UNIT ${ui+1}`:' VEHICLE',M+6,y-5,{bold:true,size:7.5,color:[0.4,0.4,0.4]});
      y-=16;
      // Row 1: Year Make Model VIN Unit#
      const vc=[{l:'Year:',v:u.year||''},{l:'Make:',v:u.make||''},{l:'Model:',v:u.model||''},{l:'VIN:',v:u.vin||''},{l:'Unit #:',v:u.unit||''}];
      const vcX=[M+6,M+76,M+168,M+272,M+440]; const vcW=[32,34,32,28,36];
      vc.forEach((f,i)=>{ dt(p1,f.l,vcX[i],y,{bold:true,size:7.5}); dt(p1,f.v,vcX[i]+vcW[i],y,{size:8.5,maxWidth:i===3?155:85}); });
      y-=14;
      // Row 2: options
      let ox=M+6;
      [['Miles',u.miles],['APU',u.apu],['Color',u.color],['Ratio',u.ratio],['HP',u.hp]].forEach(([k,v])=>{
        if(v){dt(p1,k+':',ox,y,{bold:true,size:7.5}); dt(p1,String(v),ox+34,y,{size:8,maxWidth:65}); ox+=100;}
      });
      y-=14;
      // Warranty + SC
      dt(p1,'Warranty:',M+6,y,{bold:true,size:8.5}); dt(p1,u.warrantyCoverage||'AS-IS',M+58,y,{size:8.5,maxWidth:150});
      if(u.serviceContractLevel){
        dt(p1,'Service Contract:',W/2+6,y,{bold:true,size:8.5});
        dt(p1,`${u.serviceContractLevel} — ${u.serviceContractCoverage||''}`,W/2+106,y,{size:8.5,maxWidth:155});
      }
      y-=20;

      // Financial summary for this unit — right-side box
      const finX=W/2+10, finW=W-M-finX;
      const finItems=[
        ['Sale Price:',    fmtM(u.salePrice)],
        ['Service Contr.:',u.serviceContractPrice&&parseFloat(u.serviceContractPrice)>0?fmtM(u.serviceContractPrice):null],
        ['Sales Tax:',     u.salesTax&&parseFloat(u.salesTax)>0?fmtM(u.salesTax):null],
        ['IL Title Fee:',  u.titleFee&&parseFloat(u.titleFee)>0?fmtM(u.titleFee):null],
        ['Doc Fee:',       fmtM(u.docFee||350)],
      ].filter(r=>r[1]);
      const finH = finItems.length*15+30;
      box(p1,finX-6,y-finH,finW+10,finH+12);
      dt(p1,units.length>1?`FINANCIALS — UNIT ${ui+1}`:'FINANCIAL SUMMARY',finX,y-5,{bold:true,size:7.5,color:[0.4,0.4,0.4]});
      let fy=y-18;
      finItems.forEach(([lbl,val])=>{
        dt(p1,lbl,finX+2,fy,{bold:true,size:8.5,maxWidth:90});
        const vw=(val||'').length*5.4; dt(p1,val||'',W-M-4-vw,fy,{size:8.5,maxWidth:90});
        p1.drawLine({start:{x:finX,y:fy-3},end:{x:W-M,y:fy-3},thickness:0.3,color:rgb(0.88,0.88,0.88)});
        fy-=15;
      });
      y-=finH+16;
    }

    // Deposit + Grand total
    if(d.depositAmount && parseFloat(d.depositAmount)>0){
      ln(p1,y+8,W/2+4,W-M); y-=12;
      dt(p1,'Deposit:',W/2+10,y,{bold:true,size:9}); dt(p1,`- ${fmtM(d.depositAmount)||''} (${d.depositType||''})`,W/2+70,y,{size:9,maxWidth:155});
      y-=14;
    }
    ln(p1,y+8,W/2+4,W-M,1.5);
    y-=16;
    dt(p1,'GRAND TOTAL:',W/2+10,y,{bold:true,size:12});
    const tvw=(fmtM(d.total)||'').length*6.5;
    dt(p1,fmtM(d.total)||'',W-M-4-tvw,y,{bold:true,size:13,color:[0.05,0.42,0.1]});
    y-=24;

    // Terms
    y=Math.min(y,200);
    ln(p1,y+14); dt(p1,'Accepted Terms and Conditions',M,y+4,{bold:true,size:8.5});
    p1.drawText('Purchaser agrees this Purchase Order includes all terms as of the Date Accepted. This Invoice cancels and supersedes any prior agreement and is binding when accepted by both parties.',
      {x:M,y:y-12,size:7.5,font,color:rgb(0.2,0.2,0.2),maxWidth:W-M*2,lineHeight:11});
    y-=38;
    dt(p1,'Purchaser declines additional warranty',M,y,{bold:true,size:8}); dt(p1,'Initials: _________',W-M-105,y,{size:8});
    y-=22; ln(p1,y+8);
    dt(p1,'Purchaser Signature:',M,y-7,{bold:true,size:9}); dt(p1,'_________________________________',M+120,y-7,{size:9});
    dt(p1,'Date:',M+372,y-7,{bold:true,size:9}); dt(p1,'__________',M+398,y-7,{size:9});
    y-=20;
    dt(p1,'Direct Truck Sales:',M,y-7,{bold:true,size:9}); dt(p1,'_________________________________',M+120,y-7,{size:9});
    dt(p1,'Date:',M+372,y-7,{bold:true,size:9}); dt(p1,'__________',M+398,y-7,{size:9});

    // ── PAGE 2: T&C ───────────────────────────────────────────────────────────
    const p2=pdfDoc.addPage([W,H]);
    let y2=await addHeader(p2,'TERMS & CONDITIONS');
    // Vehicle summary
    box(p2,M,y2-32,W-M*2,44);
    units.forEach((u,i)=>{
      dt(p2,`${u.year||''} ${u.make||''} ${u.model||''}`,M+8,y2-10-(i*14),{bold:true,size:9,maxWidth:200});
      dt(p2,'VIN: '+(u.vin||''),M+216,y2-10-(i*14),{size:8.5,maxWidth:165});
      dt(p2,'Unit: '+(u.unit||''),M+400,y2-10-(i*14),{size:8.5});
    });
    y2-=46;
    dt(p2,"Terms — Used Vehicle Dealer's Warranty Disclaimer",M,y2,{bold:true,size:9.5}); y2-=16;
    p2.drawText(`The above-described motor vehicle(s) are sold "as is" with all faults. No warranty of merchantability or fitness is made. Buyer bears all repair costs. Direct Truck Sales Inc shall not be liable for consequential or incidental damages. Buyer is responsible for all registration and title fees, confirms inspection and purchase decision based thereon. All manufacturer warranties are the manufacturer's alone. Buyer releases Direct Truck Sales Inc from any current or future liabilities. Upon completion buyer is solely responsible for the vehicle.`,
      {x:M,y:y2,size:7.8,font,color:rgb(0.1,0.1,0.1),maxWidth:W-M*2,lineHeight:12});
    y2-=100;
    dt(p2,'Release from Liability',M,y2,{bold:true,size:9}); y2-=14;
    p2.drawText('I fully and forever release and discharge Direct Truck Sales Inc from all injuries, losses, damages, claims and liabilities arising from my use of the motor vehicle(s), even if due to their negligence, to the fullest extent permitted by law.',
      {x:M,y:y2,size:7.8,font,color:rgb(0.1,0.1,0.1),maxWidth:W-M*2,lineHeight:12});
    y2-=50; ln(p2,y2+8);
    dt(p2,'Purchaser Signature:',M,y2-7,{bold:true,size:9}); dt(p2,'_________________________________',M+120,y2-7,{size:9});
    dt(p2,'Date:',M+372,y2-7,{bold:true,size:9}); dt(p2,'__________',M+398,y2-7,{size:9});
    y2-=20;
    dt(p2,'Direct Truck Sales:',M,y2-7,{bold:true,size:9}); dt(p2,'_________________________________',M+120,y2-7,{size:9});
    dt(p2,'Date:',M+372,y2-7,{bold:true,size:9}); dt(p2,'__________',M+398,y2-7,{size:9});

    // ── PAGE(S) 3+: WORKORDER per unit ───────────────────────────────────────
    for(let ui=0;ui<units.length;ui++){
      const u=units[ui];
      const items=[u.item1,u.item2,u.item3,u.item4].filter(Boolean);
      if(!items.length) continue;
      const pw=pdfDoc.addPage([W,H]);
      let yw=await addHeader(pw,`WORKORDER — Unit ${ui+1}`);
      box(pw,M,yw-58,W-M*2,70);
      dt(pw,`Stock #: ${u.unit||''}`,M+8,yw-8,{bold:true,size:9.5});
      dt(pw,`Make: ${u.make||''}`,M+160,yw-8,{size:9.5});
      dt(pw,`Model: ${u.model||''}`,M+290,yw-8,{size:9.5});
      dt(pw,`VIN: ${u.vin||''}`,M+8,yw-24,{size:9});
      dt(pw,`Purchaser: ${d.personalName||''}${d.businessName?' / '+d.businessName:''}`,M+8,yw-40,{size:9});
      yw-=76;
      dt(pw,'Items to be completed:',M,yw,{bold:true,size:10}); yw-=18;
      items.forEach((item,i)=>{
        pw.drawRectangle({x:M,y:yw-26,width:W-M*2,height:30,color:rgb(0.97,0.97,0.97),borderColor:rgb(0.85,0.85,0.85),borderWidth:0.5});
        dt(pw,`${i+1}.`,M+8,yw-10,{bold:true,size:10});
        dt(pw,item,M+24,yw-10,{size:10,maxWidth:W-M*2-32});
        yw-=38;
      });
      yw-=20;
      pw.drawText('The purchaser will be responsible for work performed if the sale is terminated. Work completed once fully funded. Once started, deposits are non-refundable.',
        {x:M,y:yw,size:8,font,color:rgb(0.2,0.2,0.2),maxWidth:W-M*2,lineHeight:12});
      yw-=40; ln(pw,yw+8);
      dt(pw,'Purchaser:',M,yw-7,{bold:true,size:9}); dt(pw,'_________________________________',M+70,yw-7,{size:9});
      dt(pw,'Date:',M+322,yw-7,{bold:true,size:9}); dt(pw,'__________',M+348,yw-7,{size:9});
      yw-=20;
      dt(pw,'Direct Truck Sales:',M,yw-7,{bold:true,size:9}); dt(pw,'_________________________________',M+122,yw-7,{size:9});
      dt(pw,'Date:',M+374,yw-7,{bold:true,size:9}); dt(pw,'__________',M+400,yw-7,{size:9});
    }

    const pdfBytes=await pdfDoc.save();
    const safeName=(d.personalName||d.businessName||'BillOfSale').replace(/[^a-zA-Z0-9]/g,'_');
    res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="BillOfSale_${safeName}.pdf"`});
    res.send(Buffer.from(pdfBytes));
  } catch(e){
    console.error('BOS PDF error:',e);
    res.status(500).json({error:'PDF generation failed: '+e.message});
  }
});


// ── BILL OF SALE — SAVE ────────────────────────────────────────────────────────
app.post('/billsofsale/save', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const d = req.body;
    const BOS_SHEET = 'BillsOfSale';
    let hasHeader = false;
    try { const c = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:`${BOS_SHEET}!A1` }); hasHeader = c.data.values && c.data.values.length > 0; } catch(e) {}
    if (!hasHeader) {
      await sheets.spreadsheets.values.update({
        spreadsheetId:SHEET_ID, range:`${BOS_SHEET}!A1`, valueInputOption:'RAW',
        requestBody:{ values:[['ID','Date','Personal Name','Business Name','Address','City','State','Zip','Phone','Email','DL#','DL State','Unit','Year','Make','Model','VIN','Miles','APU','Color','Ratio','HP','Warranty','Sale Price','SC Level','SC Coverage','SC Price','Sales Tax','Title Fee','Doc Fee','Deposit Amount','Deposit Type','Total','Salesperson','Item1','Item2','Item3','Item4','Lead ID']] }
      });
    }
    const id = d.id || 'BOS'+Date.now();
    await sheets.spreadsheets.values.append({
      spreadsheetId:SHEET_ID, range:BOS_SHEET, valueInputOption:'RAW', insertDataOption:'INSERT_ROWS',
      requestBody:{ values:[[id,d.date||new Date().toISOString().split('T')[0],d.personalName,d.businessName,d.address,d.city,d.state,d.zip,d.phone,d.email,d.dlNumber,d.dlState,d.unit,d.year,d.make,d.model,d.vin,d.miles,d.apu,d.color,d.ratio,d.hp,d.warrantyCoverage,d.salePrice,d.serviceContractLevel,d.serviceContractCoverage,d.serviceContractPrice,d.salesTax,d.titleFee,d.docFee,d.depositAmount,d.depositType,d.total,d.salesperson,d.item1||'',d.item2||'',d.item3||'',d.item4||'',d.leadId||'']] }
    });
    res.json({ success:true, id });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to save bill of sale' }); }
});

// ── BILL OF SALE — LIST ────────────────────────────────────────────────────────
app.get('/billsofsale', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:'BillsOfSale' });
    const rows = response.data.values || [];
    if (rows.length <= 1) return res.json([]);
    const records = rows.slice(1).map(r => ({
      id:r[0]||'',date:r[1]||'',personalName:r[2]||'',businessName:r[3]||'',
      address:r[4]||'',city:r[5]||'',state:r[6]||'',zip:r[7]||'',
      phone:r[8]||'',email:r[9]||'',dlNumber:r[10]||'',dlState:r[11]||'',
      unit:r[12]||'',year:r[13]||'',make:r[14]||'',model:r[15]||'',vin:r[16]||'',
      miles:r[17]||'',apu:r[18]||'',color:r[19]||'',ratio:r[20]||'',hp:r[21]||'',
      warrantyCoverage:r[22]||'',salePrice:r[23]||'',
      serviceContractLevel:r[24]||'',serviceContractCoverage:r[25]||'',serviceContractPrice:r[26]||'',
      salesTax:r[27]||'',titleFee:r[28]||'',docFee:r[29]||'',
      depositAmount:r[30]||'',depositType:r[31]||'',total:r[32]||'',salesperson:r[33]||'',
      item1:r[34]||'',item2:r[35]||'',item3:r[36]||'',item4:r[37]||'',leadId:r[38]||''
    })).reverse();
    res.json(records);
  } catch(e) { res.status(500).json({ error:'Failed to load bills of sale' }); }
});

// ── START ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Dealer CRM server running on port ${PORT}`));
