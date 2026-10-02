/* مساعد الأستاذ (مهام طويلة: مذكرات، مسعى علمي، أسئلة...). دالة خلفية (اسمها ينتهي بـ -background):
   تعمل حتى 15 دقيقة وتردّ فوراً بـ 202، وتُخزَّن النتيجة في Blobs ليستعلم عنها المتصفح من bot.js */
import * as C from '../lib/common.js';
import * as AI from '../lib/ai.js';

const JOB = /^[a-z0-9]{10,40}$/;

export default async (req) => {
  let owner = null, id = '';
  const jobs = C.store('jobs');
  const finish = (rec) => jobs.setJSON('j/' + id, Object.assign({ owner, at: new Date().toISOString() }, rec));
  try {
    const b = await C.readJson(req);
    id = String((b && b.jobId) || '');
    if (!JOB.test(id)) return;
    const g = await C.requireSub(req);
    if (g.err) return;                       // لا مالك معروف: لا نكتب شيئاً
    owner = g.u.email;
    if (g.ent.role === 'student') return finish({ status: 'error', error: 'teacher_only' });

    const day = new Date().toISOString().slice(0, 10);
    const limit = g.ent.role === 'teacher' ? 150 : 300;
    if (!(await C.hit('bot:' + owner + ':' + day, limit, 26 * 3600e3))) return finish({ status: 'error', error: 'daily_limit' });

    const messages = AI.cleanMessages(b.messages);
    if (!messages.length) return finish({ status: 'error', error: 'empty' });

    await jobs.setJSON('j/' + id, { owner, status: 'pending', at: new Date().toISOString() });
    const res = await AI.callModel(AI.TEACHER_SYS, messages, AI.TEACHER_MODEL(), 2500, 240000);
    if (res.status === 200) return finish({ status: 'done', text: res.body.text });
    return finish({ status: 'error', error: res.body.error, detail: res.body.detail || '' });
  } catch (e) {
    console.error('[svt] background error:', e && e.stack ? e.stack : e);
    if (owner && id) { try { await finish({ status: 'error', error: 'server_error', detail: String((e && e.message) || e).slice(0, 200) }); } catch (x) { /* ignore */ } }
  }
};
