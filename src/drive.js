// ════════════════════════════════════════════════════════════════════════════
// drive.js — Upload generated PDFs to a Google Shared Drive, organized by type.
//
// Uses the same service-account GOOGLE_CREDENTIALS already configured. The
// service account must be a MEMBER (Content Manager) of the Shared Drive.
//
// Env:
//   GOOGLE_CREDENTIALS  — service account JSON (already set)
//   SHARED_DRIVE_ID     — the Shared Drive ID (NOT a folder id). See setup guide.
//   DRIVE_ROOT_FOLDER   — optional: name of the top folder inside the Shared
//                         Drive (default "DTS CRM Documents")
//
// Uploads never block or break PDF generation: every call is best-effort and
// returns null on failure (the user still gets their PDF download).
// ════════════════════════════════════════════════════════════════════════════
const { google } = require('googleapis');
const { Readable } = require('stream');

const SHARED_DRIVE_ID = process.env.SHARED_DRIVE_ID || '';
const ROOT_NAME = process.env.DRIVE_ROOT_FOLDER || 'DTS CRM Documents';

// type key -> subfolder name
const TYPE_FOLDERS = {
  bos:        'Bills of Sale',
  closing:    'Closing Packages',
  testdrive:  'Test Drives',
};

let _driveClient = null;
function driveClient() {
  if (_driveClient) return _driveClient;
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/drive'] });
  _driveClient = google.drive({ version: 'v3', auth });
  return _driveClient;
}

function isConfigured() { return !!SHARED_DRIVE_ID && !!process.env.GOOGLE_CREDENTIALS; }

// Cache folder ids so we don't re-query every upload
const _folderCache = {}; // name|parent -> id

async function findOrCreateFolder(drive, name, parentId) {
  const cacheKey = name + '|' + (parentId || SHARED_DRIVE_ID);
  if (_folderCache[cacheKey]) return _folderCache[cacheKey];

  const parent = parentId || SHARED_DRIVE_ID;
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`;
  const list = await drive.files.list({
    q, fields: 'files(id,name)', corpora: 'drive', driveId: SHARED_DRIVE_ID,
    includeItemsFromAllDrives: true, supportsAllDrives: true,
  });
  if (list.data.files && list.data.files.length) {
    _folderCache[cacheKey] = list.data.files[0].id;
    return list.data.files[0].id;
  }
  const created = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] },
    fields: 'id', supportsAllDrives: true,
  });
  _folderCache[cacheKey] = created.data.id;
  return created.data.id;
}

// Upload a PDF. typeKey is one of: 'bos' | 'closing' | 'testdrive'
// Returns { id, link } on success, or null on any failure (never throws).
async function uploadPdf(typeKey, filename, pdfBuffer) {
  try {
    if (!isConfigured()) return null;
    const drive = driveClient();
    const rootId = await findOrCreateFolder(drive, ROOT_NAME, SHARED_DRIVE_ID);
    const typeFolderName = TYPE_FOLDERS[typeKey] || 'Other';
    const typeFolderId = await findOrCreateFolder(drive, typeFolderName, rootId);

    const safe = String(filename).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    const finalName = safe.toLowerCase().endsWith('.pdf') ? safe : safe + '.pdf';

    const res = await drive.files.create({
      requestBody: { name: finalName, parents: [typeFolderId] },
      media: { mimeType: 'application/pdf', body: Readable.from(pdfBuffer) },
      fields: 'id, webViewLink', supportsAllDrives: true,
    });
    console.log(`[drive] uploaded ${typeFolderName}/${finalName}`);
    return { id: res.data.id, link: res.data.webViewLink };
  } catch (e) {
    console.warn('[drive] upload failed (PDF still delivered to user):', e.message);
    return null;
  }
}

// Upload, then store the resulting link on a DB record (best-effort, never throws).
// table: 'bills_of_sale' | 'closing_packages' ; idColumn defaults to 'id'.
async function uploadAndLink(typeKey, filename, pdfBuffer, table, recordId) {
  const result = await uploadPdf(typeKey, filename, pdfBuffer);
  if (!result || !recordId) return result;
  try {
    const { query } = require('./db');
    await query(`UPDATE ${table} SET drive_link=$1 WHERE id=$2`, [result.link, recordId]);
  } catch (e) { console.warn('[drive] link store failed:', e.message); }
  return result;
}

module.exports = { uploadPdf, uploadAndLink, isConfigured };
