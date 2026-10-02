/* الملفات حسب الأسابيع الدراسية: الرفع والحذف للمسؤول فقط، والعرض والتحميل للمشتركين.
   تُرفع الملفات على قطع (≈2.4MB) وتُجمَّع في المتصفح عند التحميل، لتجاوز حد 6MB لحجم الطلب. */
import * as C from '../lib/common.js';

const MAX_CHUNKS = 30;                    // ≈ 70MB كحد أقصى للملف
const MAX_B64 = 4.4 * 1024 * 1024;        // حجم القطعة (base64)
const DENY = /\.(exe|msi|bat|cmd|scr|com|vbs|js|jar|apk|dll|ps1|sh|html?|svg)$/i;
const ID = /^[a-z0-9]{8,32}$/;
const visible = (role, aud) => role === 'admin' || aud === 'all' || (role === 'teacher' && (aud === 't' || aud === 's')) || (role === 'student' && aud === 's');

export default C.wrap(async (req) => {
  const g = await C.requireSub(req);
  if (g.err) return g.err;
  const role = g.ent.role;
  const files = C.store('files');

  if (req.method === 'GET') {
    const q = new URL(req.url).searchParams;
    const idx = (await files.get('index', { type: 'json' })) || [];
    if (q.get('a') === 'list') return C.J(200, { files: idx.filter((m) => visible(role, m.aud)) });
    if (q.get('a') === 'chunk') {
      const m = idx.find((x) => x.id === q.get('id'));
      if (!m || !visible(role, m.aud)) return C.J(404, { error: 'not_found' });
      const n = parseInt(q.get('n'), 10);
      if (!(n >= 0 && n < m.chunks)) return C.J(400, { error: 'bad_chunk' });
      const buf = await files.get('f/' + m.id + '/' + n, { type: 'arrayBuffer' });
      if (!buf) return C.J(404, { error: 'missing_chunk' });
      return C.J(200, { d: Buffer.from(buf).toString('base64') });
    }
    return C.J(400, { error: 'bad_request' });
  }

  if (req.method !== 'POST') return C.J(405, { error: 'method' });
  if (role !== 'admin') return C.J(403, { error: 'admin_only' });
  const b = await C.readJson(req);
  if (!b || !b.a) return C.J(400, { error: 'bad_request' });

  if (b.a === 'put') {
    if (!ID.test(String(b.id || ''))) return C.J(400, { error: 'bad_id' });
    const n = parseInt(b.n, 10);
    if (!(n >= 0 && n < MAX_CHUNKS)) return C.J(400, { error: 'bad_chunk' });
    const d = String(b.d || '');
    if (!d || d.length > MAX_B64) return C.J(413, { error: 'chunk_too_large' });
    const u8 = Buffer.from(d, 'base64');
    // Blobs يقبل string أو ArrayBuffer أو Blob (وليس Buffer مباشرة)
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    await files.set('f/' + b.id + '/' + n, ab);
    return C.J(200, { ok: true });
  }

  if (b.a === 'commit') {
    const id = String(b.id || ''), m = b.meta || {};
    if (!ID.test(id)) return C.J(400, { error: 'bad_id' });
    const total = parseInt(b.total, 10);
    if (!(total >= 1 && total <= MAX_CHUNKS)) return C.J(400, { error: 'bad_total' });
    const name = String(m.name || '').slice(0, 160);
    if (!name || DENY.test(name)) return C.J(400, { error: 'type_not_allowed' });
    const l = await files.list({ prefix: 'f/' + id + '/' });
    if ((l.blobs || []).length !== total) return C.J(409, { error: 'incomplete_upload' });
    const meta = {
      id, name, title: String(m.title || name).slice(0, 160), size: Number(m.size) || 0,
      type: String(m.type || '').slice(0, 100), chunks: total,
      cat: String(m.cat || 'file').slice(0, 20), week: String(m.week || '').slice(0, 12),
      lv: [0, 1, 2, 3, 4].includes(+m.lv) ? +m.lv : 0, aud: ['all', 's', 't'].includes(m.aud) ? m.aud : 'all',
      at: new Date().toISOString(),
    };
    const idx = (await files.get('index', { type: 'json' })) || [];
    idx.push(meta);
    await files.setJSON('index', idx);
    return C.J(200, { ok: true, meta });
  }

  if (b.a === 'del') {
    const id = String(b.id || '');
    if (!ID.test(id)) return C.J(400, { error: 'bad_id' });
    const idx = (await files.get('index', { type: 'json' })) || [];
    const m = idx.find((x) => x.id === id);
    await files.setJSON('index', idx.filter((x) => x.id !== id));
    const l = await files.list({ prefix: 'f/' + id + '/' });
    await C.mapLimit((l.blobs || []).map((x) => x.key), 10, (k) => files.delete(k));
    return C.J(200, { ok: true, removed: !!m });
  }

  return C.J(400, { error: 'unknown_action' });
});
