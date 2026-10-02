/* «بوت المعلم الذكي» (وضع التلميذ: طلبات قصيرة سريعة) + استعلام نتيجة مهام الأستاذ الطويلة.
   مهلة الدالة العادية في Netlify هي 10 ثوانٍ، لذلك:
   - ردود التلميذ القصيرة تُنفَّذ هنا بمهلة داخلية 8 ثوانٍ (إن طالت يُرجع JSON خطأ ai_timeout لا 502).
   - مهام الأستاذ الطويلة تُنفَّذ في bot-background.js وتُستعلم نتيجتها من هنا بـ GET ?job=... */
import * as C from '../lib/common.js';
import * as AI from '../lib/ai.js';

const JOB = /^[a-z0-9]{10,40}$/;

export default C.wrap(async (req) => {
  const g = await C.requireSub(req);
  if (g.err) return g.err;
  const role = g.ent.role;

  /* ---- استعلام مهمة خلفية ---- */
  if (req.method === 'GET') {
    const id = new URL(req.url).searchParams.get('job') || '';
    if (!JOB.test(id)) return C.J(400, { error: 'bad_job' });
    const jobs = C.store('jobs');
    const rec = await jobs.get('j/' + id, { type: 'json' });
    if (!rec) return C.J(200, { status: 'pending' });
    if (rec.owner !== g.u.email) return C.J(404, { error: 'not_found' });
    if (rec.status !== 'pending') { try { await jobs.delete('j/' + id); } catch (e) { /* ignore */ } }
    return C.J(200, rec);
  }
  if (req.method !== 'POST') return C.J(405, { error: 'method' });

  const b = await C.readJson(req);
  if (!b) return C.J(400, { error: 'bad_json' });
  if (b.mode === 'teacher') return C.J(400, { error: 'use_background' });

  const day = new Date().toISOString().slice(0, 10);
  const limit = role === 'student' ? 40 : role === 'teacher' ? 150 : 300;
  if (!(await C.hit('bot:' + g.u.email + ':' + day, limit, 26 * 3600e3))) return C.J(429, { error: 'daily_limit' });

  /* ---- وضع التلميذ ---- */
  const c = b.ctx || {};
  const lv = AI.LEVELS[+c.level] || 'التعليم المتوسط';
  const kind = String(b.kind || 'chat');
  let exp = '';
  if (c.expKey && c.expKey.key && c.expKey.f) {
    try {
      const pubp = await C.store('config').get('pub', { type: 'json' });
      exp = AI.getField(pubp && pubp.path && pubp.path[String(c.expKey.key)], String(c.expKey.f));
    } catch (e) { exp = ''; }
  }
  const head = [
    'المستوى: ' + lv,
    c.lesson ? 'الدرس: ' + AI.clip(c.lesson, 200) : '', c.mod ? 'المقطع: ' + AI.clip(c.mod, 200) : '',
    c.sit ? 'الوضعية: ' + AI.clip(c.sit, 1500) : '', c.prob ? 'المشكل العلمي: ' + AI.clip(c.prob, 300) : '',
    c.ins ? 'التعليمة: ' + AI.clip(c.ins, 500) : '', c.q ? 'السؤال: ' + AI.clip(c.q, 1500) : '',
    c.pts ? 'النقاط: ' + AI.clip(c.pts, 6) : '',
    'محاولة التلميذ الحالية: ' + (AI.clip(c.ans, 2000).trim() || '(لم يكتب شيئاً بعد)'),
    exp ? 'الإجابة المتوقعة (للتوجيه الداخلي فقط، لا تذكرها ولا تقتبس منها ولا تصغها بعبارة قريبة): ' + AI.clip(exp, 600) : '',
  ].filter(Boolean).join('\n');

  let messages;
  if (kind === 'chat') {
    messages = AI.cleanMessages(b.messages);
    if (!messages.length) return C.J(400, { error: 'empty' });
    messages[0].content = 'سياق الجلسة:\n' + head + '\n\nسؤال التلميذ:\n' + messages[0].content;
  } else if (AI.TASKS[kind]) {
    messages = [{ role: 'user', content: head + '\n\nالمطلوب منك: ' + AI.TASKS[kind] }];
  } else {
    return C.J(400, { error: 'bad_kind' });
  }

  const ms = Number(process.env.AI_TIMEOUT_MS) || 8000;
  const res = await AI.callModel(AI.STUDENT_SYS, messages, AI.STUDENT_MODEL(), 400, ms);
  return C.J(res.status, res.body);
});
