// Cloud persistence for the Statistics Study Platform.
// Stores a single JSON document in Vercel Blob storage.
//
//   GET  /api/sync  -> returns the stored document, or {} if none
//   POST /api/sync  -> body is the full document to store
//
// Why Blob and not Redis: the document is the whole study dataset (resources,
// notes, answers, progress). It outgrew the Upstash free-tier per-request size
// cap (~4 MB), so every save started failing with a 500 while reads still
// worked. Blob has no such per-object cap. PDF binaries still stay in IndexedDB
// only; pasted screenshots already live in Blob via api/upload-image.js.
//
// NOTE: the POST request body is still bounded by Vercel's ~4.5 MB serverless
// request limit. If the payload approaches that, compress it in the browser
// before POSTing (the app already bundles pako) — that's the next ceiling.

import { put, list } from '@vercel/blob';

const PATHNAME = 'studydata/default.json';

export const config = {
  api: {
    bodyParser: { sizeLimit: '6mb' },
  },
};

// Find the stored document blob. We write with a stable pathname
// (addRandomSuffix:false), so there's at most one.
async function findBlob() {
  const { blobs } = await list({ prefix: PATHNAME });
  if (!blobs || blobs.length === 0) return null;
  return blobs.find((b) => b.pathname === PATHNAME) || blobs[0];
}

export default async function handler(req, res) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({
      error:
        'Vercel Blob is not configured. Add a Blob store to this project in the Vercel dashboard — that creates the BLOB_READ_WRITE_TOKEN env var automatically.',
    });
  }

  try {
    if (req.method === 'GET') {
      const blob = await findBlob();
      if (!blob) return res.status(200).json({});
      // Cache-bust: a same-pathname overwrite can otherwise be served stale
      // from the CDN for a short while. The uploadedAt timestamp changes on
      // every write, so it makes a unique URL per version.
      const v = blob.uploadedAt ? new Date(blob.uploadedAt).getTime() : Date.now();
      const r = await fetch(`${blob.url}?v=${v}`, { cache: 'no-store' });
      if (!r.ok) return res.status(200).json({});
      const text = await r.text();
      try {
        return res.status(200).json(JSON.parse(text));
      } catch {
        return res.status(200).json({});
      }
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const body =
        typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
      await put(PATHNAME, body, {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('sync failed:', err);
    return res.status(500).json({ error: err.message || 'Sync failed' });
  }
}
