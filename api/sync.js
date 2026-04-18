// Cloud persistence for the Statistics Study Platform.
// Stores a single JSON document in Upstash Redis (via the Vercel integration).
// GET  /api/sync  -> returns the stored document, or {} if none
// POST /api/sync  -> body is the full document to store
//
// We intentionally do not sync PDF binaries — they live only in IndexedDB.

const KEY = 'studydata:default';

function getRedisConfig() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_URL;
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.REDIS_TOKEN;
  return { url, token };
}

async function redisGet(url, token, key) {
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Redis GET failed: ${res.status}`);
  const data = await res.json();
  return data.result;
}

async function redisSet(url, token, key, value) {
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: value,
  });
  if (!res.ok) throw new Error(`Redis SET failed: ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  const { url, token } = getRedisConfig();
  if (!url || !token) {
    return res.status(500).json({
      error:
        'Cloud sync not configured. Missing KV_REST_API_URL / KV_REST_API_TOKEN env vars.',
    });
  }

  try {
    if (req.method === 'GET') {
      const raw = await redisGet(url, token, KEY);
      if (!raw) return res.status(200).json({});
      try {
        return res.status(200).json(JSON.parse(raw));
      } catch {
        return res.status(200).json({});
      }
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const body =
        typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
      await redisSet(url, token, KEY, body);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Sync failed' });
  }
}
