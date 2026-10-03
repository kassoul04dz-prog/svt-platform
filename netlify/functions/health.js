/* فحص الصحة: افتحي  /.netlify/functions/health  لمعرفة سبب أي عطل (لا يكشف أسراراً: قيم منطقية فقط). */
import { getStore } from '@netlify/blobs';
import * as C from '../lib/common.js';

/* توحيد البريد للمقارنة (نقاط وعلامة + في Gmail) */
const normEmail = (e) => {
  const [l, d] = String(e).toLowerCase().trim().split('@');
  if (!d) return '';
  const local = l.split('+')[0];
  return d === 'gmail.com' || d === 'googlemail.com' ? local.replace(/\./g, '') + '@gmail.com' : local + '@' + d;
};

export default C.wrap(async (req) => {
  const url = new URL(req.url);
  const out = {
    ok: true, node: process.version, time: new Date().toISOString(),
    env: { ADMIN_EMAILS: C.adminEmails().length > 0, SITE_URL: process.env.URL || null },
    checks: {},
  };
  /* تشخيص الحساب: /.netlify/functions/health?who=1  (مع رمز الدخول). لا يكشف بريد المسؤولين، يذكر عددهم فقط */
  if (url.searchParams.get('who') === '1') {
    const u = await C.authUser(req, true);
    if (!u) {
      out.who = { loggedIn: false, hint: 'لم يتعرّف الخادم على جلسة الدخول (الحساب غير مؤكَّد في Identity، أو الجلسة انتهت). سجّلي الخروج ثم الدخول من جديد.' };
    } else {
      const admins = C.adminEmails(), isA = C.isAdmin(u);
      const similar = !isA && admins.some((a) => normEmail(a) === normEmail(u.email));
      let sub = null;
      try { const ent = await C.entitlement(u); sub = ent ? { role: ent.role, expired: !!ent.expired } : null; } catch (e) { sub = { error: String((e && e.message) || e).slice(0, 120) }; }
      let hint = '';
      if (isA) hint = 'الخادم يتعرّف عليكِ كمسؤولة. إن ظهرت شاشة الكود فحدّثي الصفحة ثم سجّلي الدخول من جديد.';
      else if (!admins.length) hint = 'متغير ADMIN_EMAILS غير مضبوط في الدوال: أضيفيه في Netlify (نطاقه يجب أن يشمل Functions) ثم أعيدي النشر Trigger deploy.';
      else if (similar) hint = 'بريد المسؤول المضبوط يشبه بريد حسابك لكنه غير مطابق. اجعليه مطابقاً تماماً لـ: ' + u.email;
      else hint = 'بريد حسابك (' + u.email + ') غير موجود في ADMIN_EMAILS. إن كنتِ المسؤولة فأضيفيه ثم أعيدي النشر.';
      out.who = { loggedIn: true, email: u.email, isAdmin: isA, adminEmailsConfigured: admins.length, similarAdminEmail: similar, subscription: sub, hint };
    }
  }

  try {
    const s = getStore({ name: 'health', consistency: 'strong' });
    const k = 't/' + Date.now();
    await s.set(k, 'ok');
    const v = await s.get(k);
    await s.delete(k);
    out.checks.blobs = { ok: v === 'ok' };
  } catch (e) {
    out.ok = false;
    out.checks.blobs = { ok: false, error: (e && e.name) + ': ' + String((e && e.message) || e).slice(0, 200) };
  }
  try {
    const r = await fetch(url.origin + '/.netlify/identity/settings', { signal: AbortSignal.timeout(4000) });
    out.checks.identity = { ok: r.ok, status: r.status };
    if (!r.ok) out.ok = false;
  } catch (e) {
    out.ok = false;
    out.checks.identity = { ok: false, error: String((e && e.message) || e).slice(0, 160) };
  }
  return C.J(200, out);
});
