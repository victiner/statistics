// Upload a pasted screenshot to Vercel Blob storage and return its public URL.
// The note text stores only the URL afterwards, which keeps the synced JSON
// payload small AND makes screenshots durable across devices and storage clears.
//
// POST body: { dataUrl: "data:image/jpeg;base64,...", filename?: "..." }
// Response:  { url: "https://...public.blob.vercel-storage.com/..." }

import { put } from '@vercel/blob';

export const config = {
  api: {
    bodyParser: { sizeLimit: '6mb' },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({
      error:
        'Vercel Blob is not configured. Add a Blob store to this project in the Vercel dashboard — that creates the BLOB_READ_WRITE_TOKEN env var automatically.',
    });
  }

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { dataUrl, filename } = body;
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'Missing dataUrl' });
    }

    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'Invalid dataUrl' });

    const mediaType = m[1];
    const buffer = Buffer.from(m[2], 'base64');

    const ext = (mediaType.split('/')[1] || 'jpg').replace(/\+.*/, '');
    const safeName = (filename || `screenshot-${Date.now()}.${ext}`).replace(
      /[^A-Za-z0-9._-]+/g,
      '-'
    );

    const blob = await put(`screenshots/${safeName}`, buffer, {
      contentType: mediaType,
      access: 'public',
      addRandomSuffix: true,
    });

    return res.status(200).json({ url: blob.url });
  } catch (err) {
    console.error('upload-image failed:', err);
    return res.status(500).json({ error: err.message || 'Upload failed' });
  }
}
