// ════════════════════════════════════════════════════════════════════════════
// seed-users.js — One-time: create bcrypt-hashed users in the database.
// Run once after deploying Phase 5. Idempotent (upserts by username).
//
//   node src/seed-users.js
//
// Reads the same env-var passwords you already use, hashes them, stores them.
// After this runs, login uses the database; env-var passwords become irrelevant.
// Requires: npm install bcryptjs   (pure-JS, no native build needed on Railway)
// ════════════════════════════════════════════════════════════════════════════
const bcrypt = require('bcryptjs');
const { query, pool } = require('./db');

const SEED = [
  { username:'don',     password: process.env.PASS_DON     || 'Don2024!',     name:'Don',     role:'sales' },
  { username:'vitalie', password: process.env.PASS_VITALIE || 'Vitalie2024!', name:'Vitalie', role:'sales' },
  { username:'tom',     password: process.env.PASS_TOM     || 'Tom2024!',     name:'Tom',     role:'admin' },
  { username:'olia',    password: process.env.PASS_OLIA    || 'Olia2024!',    name:'Olia',    role:'sales' },
];

(async () => {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
  for (const u of SEED) {
    const hash = await bcrypt.hash(u.password, 10);
    await query(`
      INSERT INTO users (username, password_hash, name, role, active)
      VALUES ($1,$2,$3,$4,TRUE)
      ON CONFLICT (username) DO UPDATE SET
        password_hash=EXCLUDED.password_hash, name=EXCLUDED.name, role=EXCLUDED.role`,
      [u.username, hash, u.name, u.role]);
    console.log(`Seeded user: ${u.username} (${u.role})`);
  }
  const { rows } = await query('SELECT username, name, role, active FROM users ORDER BY username');
  console.log('\nUsers in database:');
  rows.forEach(r => console.log(`  ${r.username.padEnd(10)} ${r.role.padEnd(6)} ${r.active ? 'active':'inactive'}`));
  console.log('\nDone. Login now authenticates against the database.');
  await pool.end();
})().catch(e => { console.error('SEED FAILED:', e.message); process.exit(1); });
