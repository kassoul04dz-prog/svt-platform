/* تفعيل الاشتراك السنوي بكود يصدره المسؤول. GET (دون حساب): بيانات الدفع. POST: تفعيل كود. */
import * as C from '../lib/common.js';

export default C.wrap(async (req) => {
  if (req.method === 'GET') {
    const s = await C.settings();
    return C.J(200, { pay: C.pub(s) });
  }
  if (req.method !== 'POST') return C.J(405, { error: 'method' });

  const u = await C.authUser(req);
  if (!u) return C.J(401, { error: 'login_required' });
  const b = await C.readJson(req);
  if (!b) return C.J(400, { error: 'bad_json' });

  const code = C.normCode(b.code);
  if (code.length < 12 || !code.startsWith('SVT')) return C.J(400, { error: 'invalid_code' });
  if (!(await C.hit('act:' + u.email, 10, 3600e3))) return C.J(429, { error: 'too_many' });

  const ent = await C.entitlement(u);
  if (ent && !ent.expired) return C.J(409, { error: 'already_active', role: ent.role });

  const codes = C.store('codes');
  const rec = await codes.get('c/' + code, { type: 'json' });
  if (!rec || rec.revoked) return C.J(404, { error: 'invalid_code' });
  if (rec.used_by) return C.J(409, { error: 'code_used' });

  // حجز الكود بشكل ذري (مرة واحدة فقط)
  let won = true;
  try {
    const r = await C.store('claims').set('x/' + code, JSON.stringify({ by: u.email, at: new Date().toISOString() }), { onlyIfNew: true });
    if (r && r.modified === false) won = false;
  } catch (e) { console.error('[svt] claim failed:', e && e.message); }
  if (!won) return C.J(409, { error: 'code_used' });

  const s = await C.settings();
  const expires = C.expiry(s);
  rec.used_by = u.email; rec.used_at = new Date().toISOString();
  await codes.setJSON('c/' + code, rec);
  await C.store('subs').setJSON('u/' + u.email, { email: u.email, role: rec.role, expires, code, at: rec.used_at });
  return C.J(200, { ok: true, role: rec.role, expires });
});
