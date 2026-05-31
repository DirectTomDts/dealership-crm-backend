const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');

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
app.listen(PORT, () => console.log(`Dealer CRM server running on port ${PORT}`));
