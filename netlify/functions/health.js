/* فحص الصحة: افتحي  /.netlify/functions/health  لمعرفة سبب أي عطل (لا يكشف أسراراً: قيم منطقية فقط).
   أضيفي ?ai=1 لاختبار مفتاح Anthropic واسم النموذج (طلب مجاني لا يستهلك رصيداً). */
import { getStore } from '@netlify/blobs';
import * as C from '../lib/common.js';
import * as AI from '../lib/ai.js';

export default C.wrap(async (req) => {
  const url = new URL(req.url);
  const out = {
    ok: true, node: process.version, time: new Date().toISOString(),
    env: {
      ADMIN_EMAILS: C.adminEmails().length > 0,
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      AI_MODEL: AI.STUDENT_MODEL(), AI_MODEL_TEACHER: AI.TEACHER_MODEL(),
      SITE_URL: process.env.URL || null,
    },
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

  if (url.searchParams.get('ai') === '1') {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      out.checks.ai = { ok: false, error: 'ANTHROPIC_API_KEY غير مضبوط' };
    } else {
      out.checks.ai = {};
      for (const [label, model] of [['student', AI.STUDENT_MODEL()], ['teacher', AI.TEACHER_MODEL()]]) {
        try {
          const r = await fetch('https://api.anthropic.com/v1/models/' + encodeURIComponent(model), {
            headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(5000),
          });
          let j = {}; try { j = await r.json(); } catch (e) { j = {}; }
          out.checks.ai[label] = { model, ok: r.ok, status: r.status, error: r.ok ? undefined : String((j.error && j.error.message) || '').slice(0, 160) };
          if (!r.ok) out.ok = false;
        } catch (e) {
          out.ok = false;
          out.checks.ai[label] = { model, ok: false, error: String((e && e.message) || e).slice(0, 160) };
        }
      }
    }
  }
  return C.J(200, out);
});
