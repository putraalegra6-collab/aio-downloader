const webpush = require('web-push');
const { sql } = require('./db');

let keys = null;

// Kunci VAPID dibuat otomatis sekali dan disimpan di database (tidak perlu diatur manual)
async function getKeys() {
  if (keys) return keys;
  let rows = await sql`SELECT v FROM app_settings WHERE k = 'vapid'`;
  if (!rows[0]) {
    const g = webpush.generateVAPIDKeys();
    await sql`INSERT INTO app_settings (k, v) VALUES ('vapid', ${JSON.stringify({ publicKey: g.publicKey, privateKey: g.privateKey })}) ON CONFLICT (k) DO NOTHING`;
    rows = await sql`SELECT v FROM app_settings WHERE k = 'vapid'`;
  }
  keys = JSON.parse(rows[0].v);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@aio-downloader.app', keys.publicKey, keys.privateKey);
  return keys;
}

// opts.to = id penerima (pesan pribadi), atau null untuk semua pengguna (kecuali exceptId)
async function sendPush(payload, opts) {
  await getKeys();
  const rows = opts.to
    ? await sql`SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ${opts.to}`
    : await sql`SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id <> ${opts.exceptId}`;
  const body = JSON.stringify(payload);
  await Promise.all(rows.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600 });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await sql`DELETE FROM push_subs WHERE endpoint = ${s.endpoint}`;
      }
    }
  }));
}

module.exports = { getKeys, sendPush };
