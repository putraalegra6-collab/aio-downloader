const crypto = require('crypto');
const { sql } = require('./db');

const THIRTY_DAYS = 60 * 60 * 24 * 30;

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function currentToken(req) {
  return parseCookies(req).sid || '';
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(String(pw), salt, 64).toString('hex');
}

function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  const test = crypto.scryptSync(String(pw), salt, 64);
  const want = Buffer.from(hash, 'hex');
  return want.length === test.length && crypto.timingSafeEqual(want, test);
}

async function startSession(res, userId, remember) {
  const token = crypto.randomBytes(32).toString('hex');
  await sql`INSERT INTO sessions (token, user_id) VALUES (${token}, ${userId})`;
  const parts = [`sid=${token}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'];
  if (remember) parts.push(`Max-Age=${THIRTY_DAYS}`);
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function clearSession(req, res) {
  const token = currentToken(req);
  if (token) await sql`DELETE FROM sessions WHERE token = ${token}`;
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}

async function currentUser(req) {
  const token = currentToken(req);
  if (!token) return null;
  const rows = await sql`SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ${token}`;
  if (!rows[0]) return null;
  await sql`UPDATE users SET last_seen = now() WHERE id = ${rows[0].id} AND (last_seen IS NULL OR last_seen < now() - interval '30 seconds')`;
  const admins = (process.env.ADMIN_USERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const owner = (process.env.OWNER_USERNAME || '').trim().toLowerCase();
  const isOwner = !!owner && rows[0].username.toLowerCase() === owner;
  return {
    id: rows[0].id,
    username: rows[0].username,
    is_owner: isOwner,
    is_admin: isOwner || admins.includes(rows[0].username.toLowerCase())
  };
}

module.exports = { currentUser, currentToken, startSession, clearSession, hashPassword, checkPassword };
