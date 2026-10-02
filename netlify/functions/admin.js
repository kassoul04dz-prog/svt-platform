/* لوحة التحكم — للمسؤول فقط (البريد المسجّل في ADMIN_EMAILS). */
import * as C from '../lib/common.js';

const MAX_PUB = 1.5 * 1024 * 1024;

export default C.wrap(async (req) => {
  if (req.method !== 'POST') return C.J(405, { error: 'method' });
  const g = await C.requireAdmin(req);
  if (g.err) return g.err;
  const b = await C.readJson(req);
  if (!b || !b.a) return C.J(400, { error: 'bad_request' });

  const codes = C.store('codes'), subs = C.store('subs'), cfg = C.store('config');

  switch (b.a) {
    case 'settings':
      return C.J(200, { settings: await C.settings(), admins: C.adminEmails() });

    case 'saveSettings': {
      const s = b.settings || {};
      const clean = {
        ccpName: String(s.ccpName || '').slice(0, 120),
        ccp: String(s.ccp || '').slice(0, 60),
        contact: String(s.contact || '').slice(0, 120),
        note: String(s.note || '').slice(0, 400),
        prices: { student: Number(s.prices && s.prices.student) || 2500, teacher: Number(s.prices && s.prices.teacher) || 4000 },
        seasonEnd: /^\d{4}-\d{2}-\d{2}$/.test(s.seasonEnd || '') ? s.seasonEnd : C.DEFAULTS.seasonEnd,
        links: (Array.isArray(s.links) ? s.links : []).slice(0, 40)
          .filter((l) => l && /^https?:\/\//i.test(String(l.url || '')))
          .map((l) => ({ label: String(l.label || '').slice(0, 80), url: String(l.url).slice(0, 400), kind: String(l.kind || 'link').slice(0, 20) })),
      };
      await cfg.setJSON('settings', clean);
      return C.J(200, { ok: true, settings: clean });
    }

    case 'gen': {
      const role = b.role === 'teacher' ? 'teacher' : 'student';
      const n = Math.max(1, Math.min(100, parseInt(b.n, 10) || 1));   // حد 100 لكل طلب (مهلة الدالة 10 ثوانٍ)
      const list = Array.from({ length: n }, () => C.genCode());
      const created = new Date().toISOString(), note = String(b.note || '').slice(0, 80);
      await C.mapLimit(list, 20, (code) => codes.setJSON('c/' + code, { code, role, created, note, used_by: null }));
      return C.J(200, { codes: list.map((code) => ({ code: C.fmtCode(code), role })) });
    }

    case 'codes': {
      const l = await codes.list({ prefix: 'c/' });
      const keys = (l.blobs || []).map((x) => x.key).slice(0, 400);
      const items = (await C.mapLimit(keys, 25, (k) => codes.get(k, { type: 'json' }))).filter(Boolean)
        .map((r) => ({ code: C.fmtCode(r.code), role: r.role, used_by: r.used_by, used_at: r.used_at || null, revoked: !!r.revoked, note: r.note || '', created: r.created }));
      items.sort((a, c) => String(c.created).localeCompare(String(a.created)));
      return C.J(200, { codes: items, truncated: (l.blobs || []).length > 400 });
    }

    case 'revokeCode': {
      const code = C.normCode(b.code);
      const r = await codes.get('c/' + code, { type: 'json' });
      if (!r) return C.J(404, { error: 'not_found' });
      r.revoked = true;
      await codes.setJSON('c/' + code, r);
      return C.J(200, { ok: true });
    }

    case 'subs': {
      const l = await subs.list({ prefix: 'u/' });
      const keys = (l.blobs || []).map((x) => x.key).slice(0, 400);
      const items = (await C.mapLimit(keys, 25, (k) => subs.get(k, { type: 'json' }))).filter(Boolean);
      items.sort((a, c) => String(c.at).localeCompare(String(a.at)));
      return C.J(200, { subs: items });
    }

    case 'revokeSub': {
      const em = String(b.email || '').toLowerCase().trim();
      if (!em) return C.J(400, { error: 'email' });
      await subs.delete('u/' + em);
      return C.J(200, { ok: true });
    }

    case 'grant': {
      const em = String(b.email || '').toLowerCase().trim();
      if (!/^\S+@\S+\.\S+$/.test(em)) return C.J(400, { error: 'email' });
      const s = await C.settings();
      const role = b.role === 'teacher' ? 'teacher' : 'student';
      let lv = (Array.isArray(b.levels) ? b.levels : String(b.levels || '').split(/[,\s]+/)).map(Number).filter((n) => C.ALL_LEVELS.includes(n));
      lv = [...new Set(lv)].sort();
      if (!lv.length || (role === 'student' && lv.length !== 1)) return C.J(400, { error: 'levels' });
      const rec = { email: em, role, expires: C.expiry(s), code: 'manual', at: new Date().toISOString(), levels: lv, profile: null };
      await subs.setJSON('u/' + em, rec);
      return C.J(200, { ok: true, sub: rec });
    }

    case 'setLevels': {
      const em = String(b.email || '').toLowerCase().trim();
      const cur = await subs.get('u/' + em, { type: 'json' });
      if (!cur) return C.J(404, { error: 'not_found' });
      let lv = (Array.isArray(b.levels) ? b.levels : String(b.levels || '').split(/[,\s]+/)).map(Number).filter((n) => C.ALL_LEVELS.includes(n));
      lv = [...new Set(lv)].sort();
      if (!lv.length || (cur.role === 'student' && lv.length !== 1)) return C.J(400, { error: 'levels' });
      cur.levels = lv;
      if (cur.profile) cur.profile.levels = lv;
      await subs.setJSON('u/' + em, cur);
      return C.J(200, { ok: true, levels: lv });
    }

    case 'savePub': {
      const payload = { path: b.path && typeof b.path === 'object' ? b.path : {}, lib: Array.isArray(b.lib) ? b.lib : [], at: new Date().toISOString() };
      const txt = JSON.stringify(payload);
      if (txt.length > MAX_PUB) return C.J(413, { error: 'too_large' });
      await cfg.set('pub', txt);
      return C.J(200, { ok: true, at: payload.at, bytes: txt.length });
    }

    case 'getPub': {
      const p = await cfg.get('pub', { type: 'json' });
      return C.J(200, { pub: p || { path: {}, lib: [] } });
    }

    case 'stats': {
      const [c, s] = await Promise.all([codes.list({ prefix: 'c/' }), subs.list({ prefix: 'u/' })]);
      return C.J(200, { codes: (c.blobs || []).length, subs: (s.blobs || []).length });
    }

    default:
      return C.J(400, { error: 'unknown_action' });
  }
});
