const { init } = require('../lib/db');
const { sql } = require('../lib/db');
const { currentUser, startSession, clearSession, hashPassword, checkPassword } = require('../lib/auth');

module.exports = async (req, res) => {
  try {
    await init();
    const action = req.query?.action;

    if (action === 'me') {
      const u = await currentUser(req);
      if (!u) return res.status(401).json({ error: 'Belum login' });
      return res.status(200).json(u);
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (action === 'logout') {
      await clearSession(req, res);
      return res.status(200).json({ ok: true });
    }

    const { username = '', password = '', remember = false } = req.body || {};

    if (action === 'register') {
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        return res.status(400).json({ error: 'Username 3-20 karakter: huruf, angka, atau _' });
      }
      if (String(password).length < 4) {
        return res.status(400).json({ error: 'Password minimal 4 karakter' });
      }
      try {
        const rows = await sql`INSERT INTO users (username, pass_hash) VALUES (${username}, ${hashPassword(password)}) RETURNING id`;
        await startSession(res, rows[0].id, remember);
        return res.status(201).json({ ok: true });
      } catch (e) {
        if (String(e.code) === '23505') return res.status(409).json({ error: 'Username sudah dipakai' });
        throw e;
      }
    }

    if (action === 'login') {
      const rows = await sql`SELECT id, pass_hash FROM users WHERE LOWER(username) = LOWER(${username})`;
      if (!rows[0] || !checkPassword(password, rows[0].pass_hash)) {
        return res.status(401).json({ error: 'Username atau password salah' });
      }
      await startSession(res, rows[0].id, remember);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action invalid' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
