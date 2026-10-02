/* فحص الصحة: افتحي  /.netlify/functions/health  لمعرفة سبب أي عطل (لا يكشف أسراراً: قيم منطقية فقط). */
import { getStore } from '@netlify/blobs';
import * as C from '../lib/common.js';

export default C.wrap(async (req) => {
  const url = new URL(req.url);
  const out = {
    ok: true, node: process.version, time: new Date().toISOString(),
    env: { ADMIN_EMAILS: C.adminEmails().length > 0, SITE_URL: process.env.URL || null },
    checks: {},
  };
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
