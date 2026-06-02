const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ── CONFIG ────────────────────────────────────────────────────────────────────
const JWT_SECRET  = process.env.JWT_SECRET || 'change-this-secret';
const SHEET_ID    = process.env.SHEET_ID;
const SHEET_NAME  = process.env.SHEET_NAME || 'Sheet1';
const INV_SHEET_ID = '1_R2mmi6O_KQW1mSd1Nu26fJDwrXKtRwH9vTwGnA2fN4';

const USERS = [
  { username:'don',     password: process.env.PASS_DON     || 'Don2024!',     name:'Don',     role:'sales' },
  { username:'vitalie', password: process.env.PASS_VITALIE || 'Vitalie2024!', name:'Vitalie', role:'sales' },
  { username:'tom',     password: process.env.PASS_TOM     || 'Tom2024!',     name:'Tom',     role:'admin' },
];

// ── GOOGLE SHEETS AUTH ────────────────────────────────────────────────────────
function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ credentials, scopes:['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version:'v4', auth });
}

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error:'No token' });
  try { req.user = jwt.verify(header.replace('Bearer ',''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error:'Invalid token' }); }
}

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status:'Dealer CRM API running' }));

// ── LOGIN ─────────────────────────────────────────────────────────────────────
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = USERS.find(u => u.username === username.toLowerCase() && u.password === password);
  if (!user) return res.status(401).json({ error:'Invalid username or password' });
  const token = jwt.sign({ username:user.username, name:user.name, role:user.role }, JWT_SECRET, { expiresIn:'12h' });
  res.json({ token, name:user.name, role:user.role });
});

// ── LEADS ─────────────────────────────────────────────────────────────────────
app.get('/leads', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:SHEET_NAME });
    const rows = response.data.values || [];
    if (rows.length <= 1) return res.json([]);
    const leads = rows.slice(1).map((r,i) => ({
      rowIndex: i+1, id:r[0]||'', first:r[1]||'', last:r[2]||'', company:r[3]||'',
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

// ── INVENTORY ─────────────────────────────────────────────────────────────────
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

// ── TEST DRIVE — GENERATE PDF ─────────────────────────────────────────────────
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

    // ── HEADER
    dt('TEST DRIVE AGREEMENT', margin, y, {bold:true, size:15});
    y -= 6;
    dt('Direct Truck Sales Inc.  |  15w740 N. Frontage Rd, Burr Ridge, Illinois', margin, y-8, {size:8, italic:true});
    y -= 22; ln(y); y -= 14;

    dt('The undersigned acknowledges receiving the following vehicle for test drive purposes:', margin, y, {size:9, italic:true});
    y -= 18;

    // ── VEHICLE BOX
    page.drawRectangle({x:margin, y:y-6, width:width-margin*2, height:50, color:rgb(0.94,0.94,0.94), borderColor:rgb(0.75,0.75,0.75), borderWidth:0.5});
    dt('Make:',  margin+8, y+28, {bold:true,size:9}); dt(d.make||'',  margin+44,  y+28, {size:9});
    dt('Year:',  margin+140,y+28, {bold:true,size:9}); dt(d.year||'',  margin+168, y+28, {size:9});
    dt('Model:', margin+218,y+28, {bold:true,size:9}); dt(d.model||'', margin+252, y+28, {size:9});
    dt('VIN / Serial #:', margin+8, y+10, {bold:true,size:9}); dt(d.vin||'',    margin+86,  y+10, {size:9, maxWidth:160});
    dt('Stock #:',        margin+270,y+10, {bold:true,size:9}); dt(d.unit||'',   margin+314, y+10, {size:9});
    dt('Plate #:',        margin+380,y+10, {bold:true,size:9}); dt(d.plate||'',  margin+422, y+10, {size:9});
    y -= 62;

    // ── DATE / RETURN
    dt('Date:', margin, y, {bold:true,size:9});       dt(d.date||'',       margin+36,  y, {size:9});
    dt('Return by:', margin+180, y, {bold:true,size:9}); dt(d.returnTime||'', margin+240, y, {size:9});
    y -= 18; ln(y); y -= 12;

    // ── CONDITIONS
    dt('CONDITIONS & REPRESENTATIONS:', margin, y, {bold:true, size:9}); y -= 13;
    const conditions = [
      'Vehicle shall be returned within 3 hours or on dealer\'s demand, free of liens, in the same condition as received, or undersigned shall pay for all repairs necessary to restore said condition.',
      'Undersigned shall pay dealer immediately the full present retail value of the vehicle if it is not returned for any reason whatsoever.',
      'Vehicle is to be driven exclusively by the undersigned for test drive purposes only and shall not be used for transportation of persons or property for hire.',
      'Vehicle shall not be operated in violation of any law (Federal, State, or local), nor driven beyond a radius of 25 miles from dealer\'s place of business.',
      'Vehicle will be preserved and protected from all loss, damage, or injury. Undersigned agrees to indemnify and hold harmless the dealer for any claims. Unit is GPS monitored and shall not be modified or altered in any way.',
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

    // ── DL TEXT
    const dlTxt = `The undersigned represents that he/she is duly and legally licensed to operate a vehicle under license number [${d.dlNumber||'________________'}] State [${d.dlState||'IL'}] and has no physical conditions that could cause him/her to be unfit to drive said vehicle. If the vehicle is operated beyond the time specified for return, the undersigned does so without permission of dealer. In the event the customer fails to fulfill any obligation hereunder, customer agrees to pay all costs and attorney fees incurred by the dealer in enforcing the terms hereof.`;
    page.drawText(dlTxt, {x:margin, y, size:8, font, color:rgb(0,0,0), maxWidth:width-margin*2, lineHeight:12});
    y -= 62; ln(y); y -= 14;

    // ── SIGNATURE BLOCK
    const half = (width-margin*2)/2;
    // Left column
    dt('SALESPERSON:',    margin,     y,    {bold:true,size:9}); dt(d.salesperson||'', margin+78,   y,    {size:9});
    dt('DATE:',           margin,     y-16, {bold:true,size:9}); dt(d.date||'',        margin+38,   y-16, {size:9});
    dt('DRIVER LICENSE:', margin,     y-32, {bold:true,size:9}); dt(`${d.dlNumber||''} (${d.dlState||'IL'})`, margin+98, y-32, {size:9});
    // Right column
    dt('CUSTOMER SIGNATURE:', margin+half+8, y,    {bold:true,size:9}); ln(y-2, margin+half+140, width-margin);
    dt('ADDRESS:',            margin+half+8, y-16, {bold:true,size:9}); dt(`${d.address||''}, ${d.city||''}, ${d.state||''} ${d.zip||''}`, margin+half+66, y-16, {size:9, maxWidth:half-70});
    dt('CUSTOMER NAME:',      margin+half+8, y-32, {bold:true,size:9}); dt(d.customerName||'', margin+half+104, y-32, {size:9});

    y -= 50; ln(y); y -= 10;
    dt('Direct Truck Sales Inc. — Test Drive Agreement — Form generated by Dealer CRM', margin, y, {size:7, italic:true});

    const pdfBytes = await pdfDoc.save();
    const safeName = (d.customerName||'Agreement').replace(/[^a-zA-Z0-9]/g,'_');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="TestDrive_${safeName}_${d.date||'nodate'}.pdf"`
    });
    res.send(Buffer.from(pdfBytes));
  } catch(e) {
    console.error('PDF generation error:', e);
    res.status(500).json({ error: 'PDF generation failed: ' + e.message });
  }
});

// ── TEST DRIVE — SAVE RECORD ──────────────────────────────────────────────────
app.post('/testdrive/save', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const d = req.body;
    const TD_SHEET = 'TestDrives';
    // Check if header row exists, create if not
    let hasHeader = false;
    try {
      const check = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:`${TD_SHEET}!A1` });
      hasHeader = check.data.values && check.data.values.length > 0;
    } catch(e) { hasHeader = false; }
    if (!hasHeader) {
      await sheets.spreadsheets.values.update({
        spreadsheetId:SHEET_ID, range:`${TD_SHEET}!A1`, valueInputOption:'RAW',
        requestBody:{ values:[['Date','Customer Name','Phone','Address','City','State','Zip','DL #','DL State','Unit','Make','Model','VIN','Plate','Return Time','Salesperson','Lead ID']] }
      });
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId:SHEET_ID, range:TD_SHEET,
      valueInputOption:'RAW', insertDataOption:'INSERT_ROWS',
      requestBody:{ values:[[d.date,d.customerName,d.phone,d.address,d.city,d.state,d.zip,d.dlNumber,d.dlState,d.unit,d.make,d.model,d.vin,d.plate,d.returnTime,d.salesperson,d.leadId||'']] }
    });
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to save record' }); }
});

// ── TEST DRIVE — HISTORY ──────────────────────────────────────────────────────
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
  } catch(e) { console.error(e); res.status(500).json({ error:'Failed to load history' }); }
});

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Dealer CRM server running on port ${PORT}`));
