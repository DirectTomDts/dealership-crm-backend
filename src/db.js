// ════════════════════════════════════════════════════════════════════════════
// db.js — PostgreSQL connection layer
// Drop this in src/ alongside server.js. Requires: npm install pg
// Railway auto-injects DATABASE_URL when you add a Postgres plugin.
// ════════════════════════════════════════════════════════════════════════════
const { Pool } = require('pg');

// DATABASE_URL is provided automatically by Railway's Postgres plugin.
// SSL is required on Railway's managed Postgres.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

pool.on('error', (err) => console.error('Unexpected PG pool error:', err.message));

// Simple query helper
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const ms = Date.now() - start;
  if (ms > 500) console.warn(`Slow query (${ms}ms):`, text.slice(0, 80));
  return res;
}

// Run a function inside a transaction
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Is Postgres configured + reachable?
async function isAvailable() {
  if (!process.env.DATABASE_URL) return false;
  try { await pool.query('SELECT 1'); return true; }
  catch { return false; }
}

// Write an audit entry (never throws — auditing must not break the request)
async function audit(username, action, entity, entityId, detail) {
  try {
    await query(
      'INSERT INTO audit_log (username, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5)',
      [username || 'system', action, entity, String(entityId || ''), detail ? JSON.stringify(detail) : null]
    );
  } catch (e) { console.warn('audit failed:', e.message); }
}

module.exports = { pool, query, withTransaction, isAvailable, audit };
