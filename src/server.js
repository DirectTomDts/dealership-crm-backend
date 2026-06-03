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
const LOGO_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAH0AfQDASIAAhEBAxEB/8QAHAABAAMBAQEBAQAAAAAAAAAAAAYHCAUEAwIB/8QAURAAAQMEAQICBQYICwUFCQAAAAECAwQFBhEHEiETMQgiQVFhFBU3cXazMjZSV4GRlbQYIzM4QnN0daGy0xZyd7HSF0NiosIkNDWCk6TB0eL/xAAaAQEAAwEBAQAAAAAAAAAAAAAAAwQFAQIG/8QAOBEBAAEDAgMFBAYLAQAAAAAAAAECAwQFERIhMRMUQVFhBnGx8DKBkaHR4RUWIiMzNDVCcsHxUv/aAAwDAQACEQMRAD8AxkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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';

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
    const pdfDoc = await PDFDocument.create();
    const fontBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const font       = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    const W = 612, H = 792, M = 44;

    const makePage = () => pdfDoc.addPage([W, H]);

    const dt = (pg, text, x, yPos, opts={}) => {
      try { pg.drawText(String(text||''), { x, y:yPos, size:opts.size||9, font:opts.bold?fontBold:(opts.italic?fontItalic:font), color:rgb(...(opts.color||[0,0,0])), maxWidth:opts.maxWidth||W-M*2 }); } catch(e){}
    };
    const ln = (pg, yPos, x1=M, x2=W-M, thickness=0.5) => {
      pg.drawLine({ start:{x:x1,y:yPos}, end:{x:x2,y:yPos}, thickness, color:rgb(0.7,0.7,0.7) });
    };
    const box = (pg, x, y, w, h, fill=[0.95,0.95,0.95]) => {
      pg.drawRectangle({ x, y, width:w, height:h, color:rgb(...fill), borderColor:rgb(0.8,0.8,0.8), borderWidth:0.5 });
    };
    const fmtMoney = v => {
      const n = parseFloat(String(v||'0').replace(/[$,]/g,''));
      return isNaN(n)||n===0 ? '—' : '$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    };

    const addLogo = async (pg, x, y) => {
      try {
        const img = await pdfDoc.embedJpg(Buffer.from(LOGO_B64,'base64'));
        const dims = img.scaleToFit(130,50);
        pg.drawImage(img,{x, y:y-dims.height+10, width:dims.width, height:dims.height});
      } catch(e){}
    };

    // ── PAGE 1 — BILL OF SALE ────────────────────────────────────────────────
    const p1 = makePage();
    let y = H - 36;

    await addLogo(p1, M, y);
    dt(p1,'Direct Truck Sales Inc.',     W-M-165, y,    {bold:true, size:9});
    dt(p1,'15w740 N. Frontage Rd, Ste 2',W-M-165, y-12, {size:8});
    dt(p1,'Burr Ridge, IL 60527',         W-M-165, y-23, {size:8});
    dt(p1,'630-701-1000',                 W-M-165, y-34, {size:8});
    dt(p1,'Sales@Direct-Truck.com',       W-M-165, y-45, {size:8, color:[0,0.3,0.7]});
    y -= 60;

    dt(p1,'BILL OF SALE', W/2-36, y, {bold:true, size:15});
    y -= 10; p1.drawLine({start:{x:M,y}, end:{x:W-M,y}, thickness:2, color:rgb(0.85,0.45,0.1)}); y -= 16;

    // Purchaser box
    box(p1, M, y-96, W-M*2, 108);
    dt(p1,'PURCHASER INFORMATION', M+6, y-5, {bold:true, size:7.5, color:[0.4,0.4,0.4]});
    y -= 16;
    dt(p1,'Personal Name:',  M+6,    y, {bold:true,size:8.5}); dt(p1,d.personalName||'',    M+90,    y, {size:8.5, maxWidth:160});
    dt(p1,'Business Name:',  W/2+4,  y, {bold:true,size:8.5}); dt(p1,d.businessName||'',    W/2+90,  y, {size:8.5, maxWidth:160});
    y -= 14;
    dt(p1,'Address:',        M+6,    y, {bold:true,size:8.5}); dt(p1,d.address||'',          M+56,    y, {size:8.5, maxWidth:190});
    dt(p1,'Biz Address:',    W/2+4,  y, {bold:true,size:8.5}); dt(p1,d.bizAddress||'',       W/2+72,  y, {size:8.5, maxWidth:180});
    y -= 14;
    dt(p1,'City/State/ZIP:', M+6,    y, {bold:true,size:8.5}); dt(p1,`${d.city||''},${d.state||''} ${d.zip||''}`,M+90,y,{size:8.5,maxWidth:150});
    dt(p1,'Biz City/St/ZIP:',W/2+4,  y, {bold:true,size:8.5}); dt(p1,`${d.bizCity||''},${d.bizState||''} ${d.bizZip||''}`,W/2+90,y,{size:8.5,maxWidth:150});
    y -= 14;
    dt(p1,'Phone:',          M+6,    y, {bold:true,size:8.5}); dt(p1,d.phone||'',            M+46,    y, {size:8.5, maxWidth:140});
    dt(p1,'Biz Phone:',      W/2+4,  y, {bold:true,size:8.5}); dt(p1,d.bizPhone||'',         W/2+62,  y, {size:8.5, maxWidth:140});
    y -= 14;
    dt(p1,'Email:',          M+6,    y, {bold:true,size:8.5}); dt(p1,d.email||'',            M+42,    y, {size:8.5, maxWidth:160});
    dt(p1,'DL # / State:',   W/2+4,  y, {bold:true,size:8.5}); dt(p1,`${d.dlNumber||''} / ${d.dlState||''}`, W/2+72, y, {size:8.5});
    y -= 14;
    dt(p1,'Sales Rep:',      M+6,    y, {bold:true,size:8.5}); dt(p1,d.salesperson||'',      M+62,    y, {size:8.5});
    y -= 20;

    // Vehicle box
    box(p1, M, y-62, W-M*2, 74);
    dt(p1,'VEHICLE', M+6, y-5, {bold:true, size:7.5, color:[0.4,0.4,0.4]});
    y -= 16;
    const vcols=[M+6,M+80,M+190,M+310,M+430];
    ['YEAR','MAKE','MODEL','VIN','UNIT #'].forEach((h,i)=>dt(p1,h,vcols[i],y,{bold:true,size:7.5,color:[0.4,0.4,0.4]}));
    y -= 13;
    [d.year||'',d.make||'',d.model||'',d.vin||'',d.unit||''].forEach((v,i)=>dt(p1,v,vcols[i],y,{size:9,maxWidth:100}));
    y -= 16;
    dt(p1,'OPTIONS:',  M+6,  y, {bold:true,size:8});
    dt(p1,`Miles: ${d.miles||'—'}  APU: ${d.apu||'—'}  Color: ${d.color||'—'}  Ratio: ${d.ratio||'—'}  HP: ${d.hp||'—'}`, M+54, y, {size:8.5, maxWidth:W-M*2-60});
    y -= 14;
    dt(p1,'WARRANTY:', M+6,  y, {bold:true,size:8}); dt(p1,d.warrantyCoverage||'AS-IS', M+60, y, {size:8.5});
    y -= 20;

    // Financials (right column)
    const finX = W/2+8, finW = W-M-finX;
    box(p1, finX-6, y-168, finW+10, 180);
    dt(p1,'FINANCIAL SUMMARY', finX, y-5, {bold:true,size:7.5,color:[0.4,0.4,0.4]});
    y -= 18;
    const finRows = [
      ['Sales Price:',      fmtMoney(d.salePrice)],
      ['Service Contract:', d.serviceContractLevel ? `${d.serviceContractLevel} ${d.serviceContractCoverage} — ${fmtMoney(d.serviceContractPrice)}` : '—'],
      ['Sales Tax:',        fmtMoney(d.salesTax)],
      ['IL Title Fee:',     fmtMoney(d.titleFee)],
      ['Doc Fee:',          fmtMoney(d.docFee||350)],
      ['Deposit:',          `${fmtMoney(d.depositAmount)} (${d.depositType||''})`],
    ];
    finRows.forEach(([label,val])=>{
      dt(p1,label,finX,y,{bold:true,size:8.5}); dt(p1,val,finX+finW-90,y,{size:8.5,maxWidth:90});
      p1.drawLine({start:{x:finX,y:y-3},end:{x:W-M,y:y-3},thickness:0.3,color:rgb(0.88,0.88,0.88)});
      y-=15;
    });
    y-=4; p1.drawLine({start:{x:finX,y},end:{x:W-M,y},thickness:1,color:rgb(0.3,0.3,0.3)}); y-=14;
    dt(p1,'TOTAL:', finX, y, {bold:true,size:12}); dt(p1,fmtMoney(d.total), finX+finW-90, y, {bold:true,size:12,color:[0.1,0.45,0.1]});

    // Terms
    y = 195;
    ln(p1, y+14);
    dt(p1,'Accepted Terms and Conditions', M, y+4, {bold:true,size:8.5});
    p1.drawText('Purchaser agrees that this Purchase Order with any attachments includes all terms and conditions as of the Date Accepted, thereby comprising the complete and exclusive terms. This Invoice cancels and supersedes any prior agreement between Direct Truck Sales and Purchaser. Binding only when accepted below by both parties.',
      {x:M,y:y-14,size:7.5,font,color:rgb(0.2,0.2,0.2),maxWidth:W-M*2,lineHeight:11});
    y -= 44;
    dt(p1,'PURCHASER Declines additional warranty on the listed unit above',M,y,{bold:true,size:8});
    dt(p1,'Initials: _________',W-M-105,y,{size:8});
    y -= 24; ln(p1,y+8);
    dt(p1,'PURCHASER SIGNATURE:',M,y-6,{bold:true,size:9}); dt(p1,'______________________________',M+130,y-6,{size:9});
    dt(p1,'DATE:',M+365,y-6,{bold:true,size:9}); dt(p1,'_______________',M+398,y-6,{size:9});
    y -= 20;
    dt(p1,'Direct Truck Sales:',M,y-6,{bold:true,size:9}); dt(p1,'______________________________',M+130,y-6,{size:9});
    dt(p1,'DATE:',M+365,y-6,{bold:true,size:9}); dt(p1,'_______________',M+398,y-6,{size:9});

    // ── PAGE 2 — TERMS ───────────────────────────────────────────────────────
    const p2 = makePage();
    let y2 = H-36;
    await addLogo(p2, M, y2);
    dt(p2,'15w740 N. Frontage Rd, Ste 2  |  Burr Ridge, IL 60527  |  630-701-1000',W/2-130,y2,{size:8});
    dt(p2,'Sales@Direct-Truck.com  |  Finance@Direct-Truck.com',W/2-90,y2-12,{size:8,color:[0,0.3,0.7]});
    y2-=44; p2.drawLine({start:{x:M,y:y2},end:{x:W-M,y:y2},thickness:2,color:rgb(0.85,0.45,0.1)}); y2-=16;

    box(p2,M,y2-30,W-M*2,40);
    dt(p2,`${d.year||''} ${d.make||''} ${d.model||''}`,M+8,y2-8,{size:9});
    dt(p2,'VIN:',M+220,y2-8,{bold:true,size:8.5}); dt(p2,d.vin||'',M+244,y2-8,{size:8.5,maxWidth:155});
    dt(p2,'UNIT:',M+418,y2-8,{bold:true,size:8.5}); dt(p2,d.unit||'',M+448,y2-8,{size:8.5});
    y2-=44;

    dt(p2,"Terms and Conditions — Used Vehicle Dealer's Warranty Disclaimer",M,y2,{bold:true,size:9.5}); y2-=16;
    p2.drawText("The above-described motor vehicle is being sold in its present \"as is\" condition and \"with all faults\". The purchaser acknowledges the seller has made no warranty that the vehicle is merchantable or fit for any particular purpose, and there are no warranties, either expressed or implied. The purchaser will bear the entire expense of repairing or correcting any defects. Direct Truck Sales Inc shall not have any responsibility for consequential damages, damages for loss of use, loss of time, loss of profits, or loss of income. The purchaser is responsible for all local, state and federal fees and registration costs. Purchaser warrants it has inspected and/or test-driven said vehicle(s) and the decision to purchase is based totally on this inspection and/or test drive. Unless dealer furnishes purchaser with a separate written warranty or service contract, dealer hereby disclaims all warranties, express, or implied, including any implied warranties of merchantability, suitability, and fitness for any particular purpose. Any warranty on any vehicle still subject to manufacturer's warranty is that made by the manufacturer only. The purchaser and/or any interested, affiliated parties release Direct Truck Sales Inc. from any current and future liabilities associated with the purchase of this equipment. Upon completion of this agreement the purchaser is the sole responsible party of the motor vehicle.",
      {x:M,y:y2,size:7.8,font,color:rgb(0.1,0.1,0.1),maxWidth:W-M*2,lineHeight:12});
    y2-=220;

    dt(p2,'Release from Liability',M,y2,{bold:true,size:9}); y2-=14;
    p2.drawText('I fully and forever release and discharge the released parties from any and all injuries (including death), losses, damages, claims, demands, lawsuits, expenses, and any other liability of any kind arising out of, concerning, or relating to my participation while using the motor vehicle, even if due to the negligence of the released parties. This agreement releases and waives all claims based on ordinary negligence to the fullest extent permitted by law.',
      {x:M,y:y2,size:7.8,font,color:rgb(0.1,0.1,0.1),maxWidth:W-M*2,lineHeight:12});
    y2-=68; ln(p2,y2+8);
    dt(p2,'PURCHASER SIGNATURE:',M,y2-6,{bold:true,size:9}); dt(p2,'______________________________',M+130,y2-6,{size:9});
    dt(p2,'DATE:',M+365,y2-6,{bold:true,size:9}); dt(p2,'_______________',M+398,y2-6,{size:9});
    y2-=20;
    dt(p2,'Direct Truck Sales:',M,y2-6,{bold:true,size:9}); dt(p2,'______________________________',M+130,y2-6,{size:9});
    dt(p2,'DATE:',M+365,y2-6,{bold:true,size:9}); dt(p2,'_______________',M+398,y2-6,{size:9});

    // ── PAGE 3 — WORKORDER (only if items entered) ───────────────────────────
    const items = [d.item1,d.item2,d.item3,d.item4].filter(Boolean);
    if (items.length > 0) {
      const p3 = makePage();
      let y3 = H-36;
      await addLogo(p3, M, y3);
      dt(p3,'15w740 N. Frontage Rd, Ste 2  |  Burr Ridge, IL 60527  |  630-701-1000',W/2-130,y3,{size:8});
      y3-=44; p3.drawLine({start:{x:M,y:y3},end:{x:W-M,y:y3},thickness:2,color:rgb(0.85,0.45,0.1)}); y3-=16;
      dt(p3,'WORKORDER — Additional Items',M,y3,{bold:true,size:13}); y3-=20;
      box(p3,M,y3-58,W-M*2,70);
      dt(p3,`Stock #: ${d.unit||''}`,M+8,y3-8,{bold:true,size:9.5});
      dt(p3,`Make: ${d.make||''}`,M+160,y3-8,{size:9.5});
      dt(p3,`Model: ${d.model||''}`,M+290,y3-8,{size:9.5});
      dt(p3,`VIN: ${d.vin||''}`,M+8,y3-24,{size:9});
      dt(p3,`Purchaser: ${d.personalName||''}${d.businessName?' / '+d.businessName:''}`,M+8,y3-40,{size:9});
      y3-=76;
      dt(p3,'Items to be completed:',M,y3,{bold:true,size:10}); y3-=18;
      items.forEach((item,i)=>{
        box(p3,M,y3-26,W-M*2,30,[0.97,0.97,0.97]);
        dt(p3,`${i+1}.`,M+8,y3-10,{bold:true,size:10});
        dt(p3,item,M+24,y3-10,{size:10,maxWidth:W-M*2-32});
        y3-=38;
      });
      y3-=20;
      p3.drawText('The purchaser will be responsible for the work to be performed if the sale of the unit is terminated by the purchaser. Work to be completed once the unit is fully funded. Once the work has been started, any deposits are non-refundable.',
        {x:M,y:y3,size:8,font,color:rgb(0.2,0.2,0.2),maxWidth:W-M*2,lineHeight:12});
      y3-=46; ln(p3,y3+8);
      dt(p3,'Purchaser:',M,y3-6,{bold:true,size:9}); dt(p3,'______________________________',M+70,y3-6,{size:9});
      dt(p3,'Date:',M+315,y3-6,{bold:true,size:9}); dt(p3,'_________',M+344,y3-6,{size:9});
      y3-=20;
      dt(p3,'Direct Truck Sales:',M,y3-6,{bold:true,size:9}); dt(p3,'______________________________',M+122,y3-6,{size:9});
      dt(p3,'Date:',M+365,y3-6,{bold:true,size:9}); dt(p3,'_________',M+394,y3-6,{size:9});
    }

    const pdfBytes = await pdfDoc.save();
    const safeName = (d.personalName||d.businessName||'BillOfSale').replace(/[^a-zA-Z0-9]/g,'_');
    res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="BillOfSale_${safeName}_${d.unit||''}.pdf"`});
    res.send(Buffer.from(pdfBytes));
  } catch(e) {
    console.error('Bill of sale PDF error:', e);
    res.status(500).json({ error:'PDF generation failed: '+e.message });
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
