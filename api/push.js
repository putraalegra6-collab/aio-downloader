const { sql, init } = require('../lib/db');
const { currentUser } = require('../lib/auth');
const { getKeys } = require('../lib/push');

module.exports = async (req, res) => {
  try {
    await init();
    const me = await currentUser(req);
    if (!me) return res.status(401).json({ error: 'Belum login' });

    if (req.method === 'GET') {
      const k = await getKeys();
      return res.status(200).json({ key: k.publicKey });
    }

    if (req.method === 'POST') {
      const { endpoint, keys } = req.body || {};
      if (!endpoint || !keys || !keys.p256dh || !keys.auth) return res.status(400).json({ error: 'Langganan tidak valid' });
      await sql`INSERT INTO push_subs (endpoint, user_id, p256dh, auth) VALUES (${String(endpoint)}, ${me.id}, ${String(keys.p256dh)}, ${String(keys.auth)})
        ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const ep = String((req.query || {}).endpoint || '');
      if (ep) await sql`DELETE FROM push_subs WHERE endpoint = ${ep} AND user_id = ${me.id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
