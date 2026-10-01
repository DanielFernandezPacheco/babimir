import { get, put, BlobPreconditionFailedError, BlobError } from '@vercel/blob';
import { timingSafeEqual } from 'node:crypto';

const PATH = 'babimir/data.json';
// con respuestas comprimidas la CDN devuelve el etag como débil (W/"…"); ifMatch exige el fuerte
const strong = (e) => (e ? String(e).replace(/^W\//, '') : null);

const authorized = (req) => {
  const given = Buffer.from(String(req.headers['x-pw'] || '').trim().toLowerCase());
  const want = Buffer.from(String(process.env.BABI_PW || '').trim().toLowerCase());
  return want.length > 0 && given.length === want.length && timingSafeEqual(given, want);
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });

  if (req.method === 'GET') {
    const r = await get(PATH, { access: 'private', useCache: false });
    if (!r) return res.status(200).json({ doc: null, etag: null });
    const doc = JSON.parse(await new Response(r.stream).text());
    return res.status(200).json({ doc, etag: strong(r.blob.etag) });
  }

  if (req.method === 'PUT') {
    const { doc, etag } = req.body || {};
    if (!doc || !Array.isArray(doc.sims)) return res.status(400).json({ error: 'bad body' });
    try {
      const r = await put(PATH, JSON.stringify(doc), {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: !!etag,
        ...(etag ? { ifMatch: strong(etag) } : {}),
      });
      const fresh = await get(PATH, { access: 'private', useCache: false });
      return res.status(200).json({ etag: strong(fresh?.blob.etag) });
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError || /already exists/i.test(String(e?.message))) {
        return res.status(409).json({ error: 'conflict' });
      }
      throw e;
    }
  }

  res.setHeader('Allow', 'GET, PUT');
  res.status(405).end();
}
