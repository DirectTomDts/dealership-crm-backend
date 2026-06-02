const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');


const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── CONFIG ────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const SHEET_ID   = process.env.SHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || 'Sheet1';

// Users — Tom is admin. Passwords set via environment variables.
const USERS = [
  { username: 'don',     password: process.env.PASS_DON     || 'Don2024!',     name: 'Don',     role: 'sales' },
  { username: 'vitalie', password: process.env.PASS_VITALIE || 'Vitalie2024!', name: 'Vitalie', role: 'sales' },
  { username: 'tom',     password: process.env.PASS_TOM     || 'Tom2024!',     name: 'Tom',     role: 'admin' },
];

// ─── GOOGLE SHEETS AUTH ────────────────────────────────────────────────────
function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// ─── AUTH MIDDLEWARE ───────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ─── ROUTES ────────────────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => res.json({ status: 'Dealer CRM API running' }));

// Login
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = USERS.find(u => u.username === username.toLowerCase() && u.password === password);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  const token = jwt.sign({ username: user.username, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, name: user.name, role: user.role });
});

// Get all leads
app.get('/leads', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: SHEET_NAME,
    });
    const rows = response.data.values || [];
    if (rows.length <= 1) return res.json([]);
    const leads = rows.slice(1).map((r, i) => ({
      rowIndex: i + 1,
      id:       r[0]  || '',
      first:    r[1]  || '',
      last:     r[2]  || '',
      company:  r[3]  || '',
      phone:    r[4]  || '',
      email:    r[5]  || '',
      unit:     r[6]  || '',
      source:   r[7]  || '',
      status:   r[8]  || 'Prospect',
      sales:    r[9]  || '',
      followup: r[10] || '',
      notes:    r[11] || '',
      archived: r[12] || 'false',
    }));
    res.json(leads);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load leads' });
  }
});

// Add new lead
app.post('/leads', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const l = req.body;
    const id = 'L' + Date.now();
    const archived = ['Sold','Dead'].includes(l.status) ? 'true' : 'false';
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: SHEET_NAME,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[id, l.first, l.last, l.company, l.phone, l.email, l.unit, l.source, l.status, l.sales, l.followup, l.notes, archived]] },
    });
    res.json({ success: true, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save lead' });
  }
});

// Update existing lead
app.put('/leads/:rowIndex', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const l = req.body;
    const sheetRow = parseInt(req.params.rowIndex) + 1;
    const archived = ['Sold','Dead'].includes(l.status) ? 'true' : 'false';
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A${sheetRow}:M${sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[l.id, l.first, l.last, l.company, l.phone, l.email, l.unit, l.source, l.status, l.sales, l.followup, l.notes, archived]] },
    });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

// Admin: list users (no passwords)
app.get('/admin/users', requireAuth, requireAdmin, (req, res) => {
  res.json(USERS.map(u => ({ username: u.username, name: u.name, role: u.role })));
});

const PORT = process.env.PORT || 3000;
const INV_SHEET_ID = '1_R2mmi6O_KQW1mSd1Nu26fJDwrXKtRwH9vTwGnA2fN4';

app.get('/inventory', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: INV_SHEET_ID,
      range: 'Sheet1',
    });
    const rows = response.data.values || [];
    if (rows.length <= 1) return res.json([]);
    const inventory = rows.slice(1).map(r => ({
      unit:       r[0]  || '',
      year:       r[1]  || '',
      make:       r[2]  || '',
      model:      r[3]  || '',
      hours:      r[4]  || '',
      miles:      r[5]  || '',
      apu:        r[6]  || '',
      color:      r[7]  || '',
      ratio:      r[8]  || '',
      hp:         r[9]  || '',
      listPrice:  r[10] || '',
      salePrice:  r[11] || '',
      status:     r[12] || '',
      vin:        r[13] || '',   // <-- was origPrice, now VIN
    }));
    res.json(inventory);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load inventory' });
  }
});
// Generate test drive PDF
app.post('/testdrive/generate', requireAuth, async (req, res) => {
  try {
    const d = req.body;
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    const { width, height } = page.getSize();
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    const margin = 50;
    let y = height - 50;

    function drawText(text, x, yPos, opts = {}) {
      page.drawText(String(text || ''), { x, y: yPos, size: opts.size || 10, font: opts.bold ? fontBold : (opts.italic ? fontItalic : font), color: rgb(0,0,0), maxWidth: opts.maxWidth });
    }
    function line(yPos, x1 = margin, x2 = width - margin) {
      page.drawLine({ start:{x:x1,y:yPos}, end:{x:x2,y:yPos}, thickness:0.5, color:rgb(0.4,0.4,0.4) });
    }

    // Header
    drawText('TEST DRIVE AGREEMENT', margin, y, { bold:true, size:16 });
    y -= 24; line(y); y -= 16;
    drawText('The undersigned hereby acknowledges receiving the following described vehicle for test drive purposes:', margin, y, { size:9, italic:true });
    y -= 20;

    // Vehicle box
    page.drawRectangle({ x:margin, y:y-4, width:width-margin*2, height:44, color:rgb(0.95,0.95,0.95), borderColor:rgb(0.8,0.8,0.8), borderWidth:0.5 });
    drawText('Make:', margin+8, y+24, {bold:true,size:9}); drawText(d.make||'', margin+42, y+24, {size:9});
    drawText('Year:', margin+140, y+24, {bold:true,size:9}); drawText(d.year||'', margin+168, y+24, {size:9});
    drawText('Model:', margin+220, y+24, {bold:true,size:9}); drawText(d.model||'', margin+256, y+24, {size:9});
    drawText('VIN / Serial #:', margin+8, y+8, {bold:true,size:9}); drawText(d.vin||'', margin+82, y+8, {size:9});
    drawText('Stock #:', margin+280, y+8, {bold:true,size:9}); drawText(d.unit||'', margin+322, y+8, {size:9});
    drawText('Plate #:', margin+380, y+8, {bold:true,size:9}); drawText(d.plate||'', margin+422, y+8, {size:9});
    y -= 56;

    // Dealership + date
    drawText('From:', margin, y, {bold:true,size:9}); drawText('Direct Truck Sales Inc. — 15w740 N. Frontage Rd, Burr Ridge, Illinois', margin+34, y, {size:9});
    y -= 16;
    drawText('Date:', margin, y, {bold:true,size:9}); drawText(d.date||'', margin+34, y, {size:9});
    drawText('Return by:', margin+180, y, {bold:true,size:9}); drawText(d.returnTime||'', margin+240, y, {size:9});
    y -= 20; line(y); y -= 14;

    // Conditions
    drawText('CONDITIONS & REPRESENTATIONS:', margin, y, {bold:true,size:9}); y -= 14;
    const conditions = [
      'Vehicle shall be returned within 3 hours or on dealer\'s demand, free of liens, in the same mechanical and physical condition as received, or undersigned shall pay for all repairs necessary.',
      'Undersigned shall pay dealer immediately the full present retail value of the vehicle if it is not returned for any reason whatsoever.',
      'Vehicle is to be driven exclusively by the undersigned for test drive purposes only and shall not be used for transportation of persons or property for hire.',
      'Vehicle shall not be operated in violation of any law (Federal, State, or local), nor driven beyond a radius of 25 miles from dealer\'s place of business.',
      'Vehicle will be preserved and protected from all loss, damage, or injury. Undersigned agrees to indemnify and hold harmless the dealer. Unit is GPS monitored and shall not be modified or altered in any way.',
    ];
    conditions.forEach(c => {
      page.drawText('\u2022  ' + c, { x:margin+10, y, size:8.5, font, color:rgb(0,0,0), maxWidth:width-margin*2-20, lineHeight:13 });
      y -= (Math.ceil(c.length/95) * 13) + 6;
    });

    y -= 4; line(y); y -= 14;
    drawText('DYNO Testing NOT allowed', margin, y, {bold:true,size:9}); drawText('Initials: _________', margin+280, y, {size:9});
    y -= 14;
    drawText('Calibration, programming, and Parked Forced Regeneration NOT allowed', margin, y, {italic:true,size:9}); drawText('Initials: _________', margin+280, y, {size:9});
    y -= 16; line(y); y -= 14;

    // DL paragraph
    const dlText = `The undersigned represents that he/she is duly and legally licensed to operate a vehicle in the State of Illinois under license number [${d.dlNumber||'________________'}] State [${d.dlState||'IL'}] and that he/she has no physical conditions that could cause him/her to be unfit to drive said vehicle. If dealer's vehicle is operated beyond the time specified for its return, the undersigned does so without permission of dealer.`;
    page.drawText(dlText, {x:margin, y, size:8.5, font, color:rgb(0,0,0), maxWidth:width-margin*2, lineHeight:13});
    y -= 56; line(y); y -= 14;

    // Signature block
    const colMid = margin + (width-margin*2)/2;
    drawText('SALESPERSON:', margin, y, {bold:true,size:9}); drawText(d.salesperson||'', margin+80, y, {size:9});
    y -= 16;
    drawText('DATE:', margin, y, {bold:true,size:9}); drawText(d.date||'', margin+40, y, {size:9});
    y -= 16;
    drawText('DRIVER LICENSE #:', margin, y, {bold:true,size:9}); drawText((d.dlNumber||'')+'  ('+( d.dlState||'IL')+')', margin+105, y, {size:9});
    y += 32;
    drawText('CUSTOMER SIGNATURE:', colMid+10, y, {bold:true,size:9}); line(y-2, colMid+135, width-margin);
    y -= 16;
    drawText('ADDRESS:', colMid+10, y, {bold:true,size:9}); drawText(`${d.address||''}, ${d.city||''}, ${d.state||''} ${d.zip||''}`, colMid+70, y, {size:9});
    y -= 16;
    drawText('CUSTOMER NAME:', colMid+10, y, {bold:true,size:9}); drawText(d.customerName||'', colMid+105, y, {size:9});
    y -= 20; line(y); y -= 10;
    drawText('Direct Truck Sales Inc. — 15w740 N. Frontage Rd, Burr Ridge, IL — Test Drive Agreement', margin, y, {size:7.5, italic:true});

    const pdfBytes = await pdfDoc.save();
    res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="TestDrive_${(d.customerName||'Agreement').replace(/\s+/g,'_')}_${d.date||''}.pdf"`});
    res.send(Buffer.from(pdfBytes));
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'PDF generation failed: ' + e.message });
  }
});

// Save test drive record
app.post('/testdrive/save', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const d = req.body;
    const TD_SHEET = 'TestDrives';
    // Ensure header exists
    try { await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TD_SHEET}!A1` }); }
    catch {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID, range: `${TD_SHEET}!A1`, valueInputOption: 'RAW',
        requestBody: { values: [['Date','Customer Name','Phone','Address','City','State','Zip','DL #','DL State','Unit','Make','Model','VIN','Plate','Return Time','Salesperson','Lead ID']] }
      });
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: TD_SHEET,
      valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[ d.date, d.customerName, d.phone, d.address, d.city, d.state, d.zip, d.dlNumber, d.dlState, d.unit, d.make, d.model, d.vin, d.plate, d.returnTime, d.salesperson, d.leadId||'' ]] }
    });
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Failed to save record' }); }
});

// Get test drive history
app.get('/testdrive/history', requireAuth, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'TestDrives' });
    const rows = response.data.values || [];
    if (rows.length <= 1) return res.json([]);
    const records = rows.slice(1).map(r => ({
      date: r[0]||'', customerName: r[1]||'', phone: r[2]||'',
      address: r[3]||'', city: r[4]||'', state: r[5]||'', zip: r[6]||'',
      dlNumber: r[7]||'', dlState: r[8]||'', unit: r[9]||'',
      make: r[10]||'', model: r[11]||'', vin: r[12]||'',
      plate: r[13]||'', returnTime: r[14]||'', salesperson: r[15]||'', leadId: r[16]||''
    })).reverse();
    res.json(records);
  } catch(e) { res.status(500).json({ error: 'Failed to load history' }); }
});


app.listen(PORT, () => console.log(`Dealer CRM server running on port ${PORT}`));
