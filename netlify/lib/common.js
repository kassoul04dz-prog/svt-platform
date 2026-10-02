/* أدوات مشتركة لدوال المنصة (Netlify Functions الحديثة: export default + Request/Response).
   - wrap(): يمنع أي انهيار صامت (502) ويُرجع JSON واضح بسبب الخطأ.
   - authUser(): يتحقق من رمز Identity (JWT) عبر خدمة Identity نفسها.
   - store(): تخزين Netlify Blobs (يُهيّأ تلقائياً في الدوال الحديثة). */
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const HDR = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
export const J = (status, obj) => new Response(JSON.stringify(obj), { status, headers: HDR });

/* يلفّ الدالة: أي استثناء يصبح 500 مع سبب مقروء بدل 502 غامض، ويُسجَّل في Function logs */
export const wrap = (fn) => async (req, context) => {
  try {
    return await fn(req, context);
  } catch (e) {
    console.error('[svt] unhandled error:', e && e.stack ? e.stack : e);
    return J(500, { error: 'server_error', type: e && e.name, detail: String((e && e.message) || e).slice(0, 240) });
  }
};

export const readJson = async (req) => { try { return await req.json(); } catch (e) { return null; } };
export const store = (name) => getStore({ name, consistency: 'strong' });

/* تنفيذ مهام بالتوازي مع حد أقصى للتزامن (لتفادي تجاوز مهلة 10 ثوانٍ) */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  });
  await Promise.all(workers);
  return out;
}

/* ---------- الحساب ---------- */
export const adminEmails = () => (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export const isAdmin = (u) => !!u && adminEmails().includes(u.email);

const cache = new Map();
const b64json = (s) => { try { return JSON.parse(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (e) { return null; } };

/* يقرأ Authorization: Bearer <JWT> ويتحقق منه لدى Identity. يرجع {email,id} أو null */
export async function authUser(req) {
  const m = (req.headers.get('authorization') || '').match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const token = m[1];
  const key = crypto.createHash('sha256').update(token).digest('hex');
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.user;
  const payload = b64json(token.split('.')[1] || '');
  if (payload && payload.exp && payload.exp * 1000 < Date.now()) return null;

  const origins = [...new Set([new URL(req.url).origin, process.env.URL].filter(Boolean))];
  for (const origin of origins) {
    let r;
    try {
      r = await fetch(origin + '/.netlify/identity/user', { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000) });
    } catch (e) { continue; }
    if (!r.ok) return null;
    let u = null;
    try { u = await r.json(); } catch (e) { u = null; }
    if (!u || !u.email) return null;
    const user = { email: String(u.email).toLowerCase(), id: u.id || '' };
    cache.set(key, { user, until: Math.min(Date.now() + 60000, payload && payload.exp ? payload.exp * 1000 : Date.now() + 60000) });
    if (cache.size > 500) cache.clear();
    return user;
  }
  return null;
}

/* ---------- الإعدادات ---------- */
export const DEFAULTS = { ccpName: '', ccp: '', contact: '', note: '', prices: { student: 2500, teacher: 4000 }, seasonEnd: '2027-05-31', links: [] };
export async function settings() {
  let s = null;
  try { s = await store('config').get('settings', { type: 'json' }); } catch (e) { console.error('[svt] settings read failed:', e && e.message); }
  const m = Object.assign({}, DEFAULTS, s || {});
  m.prices = Object.assign({}, DEFAULTS.prices, (s && s.prices) || {});
  if (!Array.isArray(m.links)) m.links = [];
  if (process.env.SEASON_END && !(s && s.seasonEnd)) m.seasonEnd = process.env.SEASON_END;
  return m;
}
export const pub = (s) => ({ ccpName: s.ccpName, ccp: s.ccp, contact: s.contact, note: s.note, prices: s.prices, seasonEnd: s.seasonEnd });
export const expiry = (s) => new Date((s.seasonEnd || DEFAULTS.seasonEnd) + 'T23:59:59Z').toISOString();

/* ---------- الاشتراك ---------- */
export async function entitlement(u) {
  if (!u) return null;
  if (isAdmin(u)) return { role: 'admin', expires: null };
  const s = await store('subs').get('u/' + u.email, { type: 'json' });
  if (!s) return null;
  if (Date.parse(s.expires) < Date.now()) return { expired: true, role: s.role, expires: s.expires };
  return { role: s.role, expires: s.expires };
}

/* ---------- الأكواد وحدود الاستعمال ---------- */
export const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const fmtCode = (n) => n.replace(/^(SVT)(.{4})(.{4})(.{4})$/, '$1-$2-$3-$4');
const AL = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function genCode() {
  const b = crypto.randomBytes(12); let s = '';
  for (const x of b) s += AL[x % AL.length];
  return 'SVT' + s;
}
export async function hit(key, limit, ttlMs) {
  try {
    const st = store('rl'), now = Date.now();
    let r = await st.get(key, { type: 'json' });
    if (!r || r.reset < now) r = { n: 0, reset: now + ttlMs };
    r.n++;
    await st.setJSON(key, r);
    return r.n <= limit;
  } catch (e) { return true; }   // عطل في عدّاد الحدود لا يوقف الخدمة
}

/* ---------- حراس الصلاحيات ---------- */
export async function requireSub(req) {
  const u = await authUser(req);
  if (!u) return { err: J(401, { error: 'login_required' }) };
  const ent = await entitlement(u);
  if (!ent || ent.expired) return { err: J(402, { error: 'subscription_required', reason: ent && ent.expired ? 'expired' : 'none' }) };
  return { u, ent };
}
export async function requireAdmin(req) {
  const u = await authUser(req);
  if (!u) return { err: J(401, { error: 'login_required' }) };
  if (!isAdmin(u)) return { err: J(403, { error: 'admin_only' }) };
  return { u };
}
