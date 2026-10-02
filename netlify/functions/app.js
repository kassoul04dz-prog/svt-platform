/* تسليم المنصة: لا تُرسَل إلا لحساب مسجّل وله اشتراك ساري (أو للمسؤول). */
import * as C from '../lib/common.js';
import HTML from '../lib/platform.js';

const STRIP = ['e', 'hyp', 'res', 'comp'];            // حقول خاصة بالأستاذ لا تصل إلى التلاميذ
const lvOfKey = (k) => { const m = String(k).match(/^(?:[dm]\|)?([1-4])\|/); return m ? +m[1] : 0; };
function filterPath(path, levels, student) {
  const out = {};
  Object.keys(path || {}).forEach((k) => {
    const lv = lvOfKey(k);
    if (lv && !levels.includes(lv)) return;           // لا يصل التلميذ/الأستاذ إلا محتوى مستوياته
    const o = JSON.parse(JSON.stringify(path[k]));
    if (student) {
      STRIP.forEach((f) => { delete o[f]; });
      (o.acts || []).forEach((a) => { delete a.e; });
    }
    out[k] = o;
  });
  return out;
}

export default C.wrap(async (req) => {
  const u = await C.authUser(req);
  if (!u) return C.J(401, { error: 'login_required' });
  const ent = await C.entitlement(u);
  const s = await C.settings();
  if (!ent || ent.expired) return C.J(402, { error: 'subscription_required', reason: ent && ent.expired ? 'expired' : 'none', pay: C.pub(s) });

  let p = { path: {}, lib: [] };
  try { p = (await C.store('config').get('pub', { type: 'json' })) || p; } catch (e) { console.error('[svt] pub read failed:', e && e.message); }
  const staff = ent.role === 'admin' || ent.role === 'teacher';
  const levels = ent.levels || C.ALL_LEVELS;
  const svt = {
    role: ent.role, email: u.email, expires: ent.expires, pay: C.pub(s), links: s.links,
    levels, profile: ent.profile ? { name: ent.profile.name, school: ent.profile.school, wilaya: ent.profile.wilaya } : null,
    path: filterPath(p.path, levels, !staff),
    lib: (p.lib || []).filter((x) => (staff || x.aud === 's' || x.aud === 'all') && (!x.lv || levels.includes(+x.lv))),
  };
  const inject = '<script>window.__SVT=' + JSON.stringify(svt).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + ';</script>';
  return new Response(HTML.replace('<head>', () => '<head>' + inject), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' },
  });
});
