// Cloud persistence for the Statistics Study Platform.
// Stores the whole study dataset as a single object in Vercel Blob storage.
//
//   GET  /api/sync  -> returns the stored bytes as-is, or {} if none
//   POST /api/sync  -> stores the request body bytes as-is
//
// The body is opaque to this handler: the browser gzips the JSON payload before
// uploading (see cloudSaveNow/flushCloudSaveSync in index.html) and ungzips on
// load. We therefore pass raw bytes straight through and never parse them here.
//
// History: storage was Upstash Redis, but the doc outgrew its free-tier ~4 MB
// per-request cap (every save 500'd). Moved to Blob (no per-object cap). The
// remaining limit is Vercel's ~4.5 MB serverless *request* body — which is why
// the client now gzips (~4.5 MB JSON -> ~3.3 MB on the wire). PDFs stay in
// IndexedDB; screenshots live in Blob via api/upload-image.js.

import { put, list } from '@vercel/blob';

const PATHNAME = 'studydata/default.json';

// Read the raw request body ourselves; the payload is gzip, not JSON, so the
// default body parser must be off.
export const config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Find the stored document blob. We write with a stable pathname
// (addRandomSuffix:false), so there's at most one.
async function findBlob() {
  const { blobs } = await list({ prefix: PATHNAME });
  if (!blobs || blobs.length === 0) return null;
  return blobs.find((b) => b.pathname === PATHNAME) || blobs[0];
}

function sendEmpty(res) {
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).end('{}');
}

export default async function handler(req, res) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).end(
      JSON.stringify({
        error:
          'Vercel Blob is not configured. Add a Blob store to this project in the Vercel dashboard — that creates the BLOB_READ_WRITE_TOKEN env var automatically.',
      })
    );
  }

  try {
    if (req.method === 'GET') {
      const blob = await findBlob();
      if (!blob) return sendEmpty(res);
      // Cache-bust: a same-pathname overwrite can otherwise be served stale
      // from the CDN. uploadedAt changes on every write -> unique URL per version.
      const v = blob.uploadedAt ? new Date(blob.uploadedAt).getTime() : Date.now();
      const r = await fetch(`${blob.url}?v=${v}`, { cache: 'no-store' });
      if (!r.ok) return sendEmpty(res);
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader(
        'Content-Type',
        r.headers.get('content-type') || 'application/octet-stream'
      );
      return res.status(200).end(buf);
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const body = await readRawBody(req);
      const contentType = req.headers['content-type'] || 'application/octet-stream';
      await put(PATHNAME, body, {
        access: 'public',
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).end(JSON.stringify({ ok: true }));
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end(JSON.stringify({ error: 'Method not allowed' }));
  } catch (err) {
    console.error('sync failed:', err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).end(JSON.stringify({ error: err.message || 'Sync failed' }));
  }
}
