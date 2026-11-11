// 서술형 연습 웹앱 - 교사 PC용 서버 (외부 라이브러리 없음, Node 18+)
// 학생 이름·답안·PIN·API 키는 모두 local/ 폴더에만 저장됩니다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'docs');
const LOCAL = process.env.LOCAL_DIR ? path.resolve(process.env.LOCAL_DIR) : path.join(ROOT, 'local');
const DATA = path.join(LOCAL, 'data');
fs.mkdirSync(DATA, { recursive: true });

// ---------- 설정 ----------
const CONFIG_FILE = path.join(LOCAL, 'config.json');
if (!fs.existsSync(CONFIG_FILE)) {
  const pin = String(crypto.randomInt(100000, 1000000));
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ teacherPin: pin, port: 8080, apiKey: '' }, null, 2));
  console.log('\n[처음 실행] local/config.json 을 만들었습니다. 교사 PIN: ' + pin + ' (이 파일에서 바꿀 수 있습니다)\n');
}
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const PORT = Number(process.env.PORT || config.port || 8080);
const QUESTIONS = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'questions.json'), 'utf8'));
const QMAP = new Map(QUESTIONS.questions.map(q => [q.id, q]));

// ---------- 저장소 ----------
function load(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); } catch { return fallback; }
}
const db = {
  classes: load('classes.json', {}),     // id -> class
  students: load('students.json', {}),   // token -> student
  answers: load('answers.json', {}),     // key -> answer
};
const dirty = new Set();
function save(name) { dirty.add(name); }
setInterval(flush, 1000);
function flush() {
  for (const name of dirty) {
    const file = path.join(DATA, name + '.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(db[name]));
    fs.renameSync(file + '.tmp', file);
  }
  dirty.clear();
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flush(); process.exit(0); });

const akey = (classId, token, qid) => `${classId}|${token}|${qid}`;
const now = () => Date.now();
const GRACE = 5000;

// ---------- 반 상태 ----------
function newClass(name) {
  return { id: crypto.randomBytes(4).toString('hex'), name, mode: 'live', freeSeconds: 180,
    revealPolicy: 'teacher', live: null, revealed: [], createdAt: now() };
}
function publicClass(c) {
  return { id: c.id, name: c.name, mode: c.mode, freeSeconds: c.freeSeconds, revealPolicy: c.revealPolicy,
    live: c.live, revealed: c.revealed, serverNow: now() };
}
function liveOpen(c) { return c.live && !c.live.closed && now() <= c.live.endsAt + GRACE; }

// 마감 시각이 지나면 작성 중인 답을 시간 초과 제출로 처리
const closeTimers = new Map();
function scheduleClose(c) {
  clearTimeout(closeTimers.get(c.id));
  if (!c.live || c.live.closed) return;
  const ms = Math.max(0, c.live.endsAt + GRACE - now());
  closeTimers.set(c.id, setTimeout(() => closeLive(c), ms));
}
function closeLive(c) {
  if (!c.live || c.live.closed) return;
  c.live.closed = true;
  c.live.endsAt = Math.min(c.live.endsAt, now());
  for (const a of Object.values(db.answers)) {
    if (a.classId === c.id && a.qid === c.live.qid && a.status === 'draft' && a.mode === 'live') {
      a.status = 'timeout'; a.submittedAt = now(); a.elapsed = Math.round((a.submittedAt - a.startedAt) / 1000);
      notifyAnswer(a);
    }
  }
  save('answers'); save('classes'); broadcastState(c);
}
for (const c of Object.values(db.classes)) scheduleClose(c);

// ---------- 실시간 알림 (SSE) ----------
const streams = new Set(); // {res, role, classId, token}
function send(res, obj) { res.write(`data: ${JSON.stringify(obj)}\n\n`); }
function broadcastState(c) {
  const msg = { type: 'state', classId: c.id, cls: publicClass(c) };
  for (const s of streams) if (s.role === 'teacher' || s.classId === c.id) send(s.res, msg);
}
function notifyAnswer(a) {
  const msg = { type: 'answer', classId: a.classId, qid: a.qid, token: a.token, status: a.status };
  for (const s of streams) if (s.role === 'teacher') send(s.res, msg);
}
setInterval(() => { for (const s of streams) s.res.write(': ping\n\n'); }, 20000);

// ---------- 도우미 ----------
const teacherTokens = new Set();
function isTeacher(req, url) {
  const t = req.headers['x-teacher'] || url.searchParams.get('t');
  return t && teacherTokens.has(t);
}
function studentOf(req, url) {
  const t = req.headers['x-student'] || url.searchParams.get('s');
  const st = t && db.students[t];
  if (st) st.lastSeen = now();
  return st;
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
async function body(req) {
  let s = '';
  for await (const chunk of req) { s += chunk; if (s.length > 200000) throw new Error('too large'); }
  return s ? JSON.parse(s) : {};
}
function clip(s, n = 2000) { return String(s ?? '').slice(0, n); }
function stripAnswers(q) {
  return { ...q, accept: undefined, subs: q.subs.map(s => ({ no: s.no, prompt: s.prompt, points: s.points, lines: s.lines })) };
}
function canReveal(c, a, qid) {
  if (c.revealed.includes(qid)) return true;
  if (c.live && c.live.qid === qid && c.live.revealed) return true;
  return c.revealPolicy === 'submit' && a && a.status !== 'draft';
}
function myAnswerView(a) {
  if (!a) return null;
  return { qid: a.qid, texts: a.texts, status: a.status, startedAt: a.startedAt, endsAt: a.endsAt,
    submittedAt: a.submittedAt, elapsed: a.elapsed, self: a.self, grades: a.gradesPublic ? a.grades : undefined };
}
function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || [])
    if (n.family === 'IPv4' && !n.internal) out.push(`http://${n.address}:${PORT}/`);
  return out;
}

// ---------- 학생 API ----------
async function studentApi(req, res, url) {
  const p = url.pathname;
  if (p === '/api/classes' && req.method === 'GET')
    return json(res, 200, Object.values(db.classes).sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(c => ({ id: c.id, name: c.name })));

  if (p === '/api/join' && req.method === 'POST') {
    const b = await body(req);
    const c = db.classes[b.classId];
    const number = parseInt(b.number, 10);
    const name = clip(b.name, 20).trim();
    if (!c || !(number >= 1 && number <= 60) || !name) return json(res, 400, { error: '반, 번호, 이름을 확인하세요.' });
    let st = Object.values(db.students).find(s => s.classId === c.id && s.number === number);
    if (st && st.name !== name && !b.replace) return json(res, 409, { error: `${number}번은 이미 '${st.name}' 이름으로 참여했습니다. 번호를 확인하거나 선생님께 말씀하세요.` });
    if (st) st.name = name;
    else { st = { token: crypto.randomBytes(16).toString('hex'), classId: c.id, number, name, joinedAt: now() }; db.students[st.token] = st; }
    save('students');
    for (const s of streams) if (s.role === 'teacher') send(s.res, { type: 'join', classId: c.id });
    return json(res, 200, { token: st.token, classId: c.id, className: c.name, number, name });
  }

  const st = studentOf(req, url);
  if (!st) return json(res, 401, { error: '다시 참여해 주세요.' });
  const c = db.classes[st.classId];
  if (!c) return json(res, 401, { error: '반이 삭제되었습니다. 다시 참여해 주세요.' });

  if (p === '/api/me' && req.method === 'GET') {
    const mine = {};
    for (const q of QUESTIONS.questions) { const a = db.answers[akey(c.id, st.token, q.id)]; if (a) mine[q.id] = { status: a.status, score: a.gradesPublic ? a.grades : undefined }; }
    return json(res, 200, { student: { number: st.number, name: st.name, className: c.name }, cls: publicClass(c), mine,
      list: QUESTIONS.questions.map(q => ({ id: q.id, no: q.no, title: q.title, concept: q.concept })) });
  }

  const mq = p.match(/^\/api\/question\/(\w+)$/);
  if (mq && req.method === 'GET') {
    const q = QMAP.get(mq[1]);
    if (!q) return json(res, 404, { error: '문항이 없습니다.' });
    const key = akey(c.id, st.token, q.id);
    let a = db.answers[key];
    const isLive = c.mode === 'live' && c.live && c.live.qid === q.id;
    if (c.mode === 'live' && !isLive && !a && !c.revealed.includes(q.id)) return json(res, 403, { error: '선생님이 시작한 문항만 풀 수 있어요.' });
    // 시작 기록
    if (url.searchParams.get('start') === '1' && !a) {
      if (isLive && liveOpen(c)) a = { mode: 'live', endsAt: c.live.endsAt };
      else if (c.mode === 'free') a = { mode: 'free', endsAt: c.freeSeconds ? now() + c.freeSeconds * 1000 : null };
      if (a) {
        Object.assign(a, { classId: c.id, token: st.token, qid: q.id, texts: q.subs.map(() => ''), status: 'draft', startedAt: now(), self: [], grades: q.subs.map(() => ({ score: null, feedback: '' })) });
        db.answers[key] = a; save('answers'); notifyAnswer(a);
      }
    }
    if (a && a.mode === 'live' && isLive) a.endsAt = c.live.endsAt; // 교사가 시간을 늘린 경우
    const reveal = canReveal(c, a, q.id);
    return json(res, 200, { question: reveal ? q : stripAnswers(q), reveal, answer: myAnswerView(a), cls: publicClass(c) });
  }

  if ((p === '/api/draft' || p === '/api/submit') && req.method === 'POST') {
    const b = await body(req);
    const q = QMAP.get(b.qid);
    const a = q && db.answers[akey(c.id, st.token, q.id)];
    if (!a) return json(res, 400, { error: '먼저 문항을 열어 주세요.' });
    if (a.status !== 'draft') return json(res, 409, { error: '이미 제출했어요.', answer: myAnswerView(a) });
    const late = a.endsAt && now() > a.endsAt + GRACE;
    const liveClosed = a.mode === 'live' && c.live && c.live.qid === q.id && c.live.closed;
    a.texts = q.subs.map((_, i) => clip(Array.isArray(b.texts) ? b.texts[i] : ''));
    a.updatedAt = now();
    if (p === '/api/submit' || late || liveClosed) {
      a.status = (late || liveClosed || b.timeout) ? 'timeout' : 'submitted';
      a.submittedAt = now(); a.elapsed = Math.round((a.submittedAt - a.startedAt) / 1000);
    }
    save('answers'); notifyAnswer(a);
    const reveal = canReveal(c, a, q.id);
    return json(res, 200, { answer: myAnswerView(a), reveal, question: reveal ? q : undefined });
  }

  if (p === '/api/selfcheck' && req.method === 'POST') {
    const b = await body(req);
    const a = db.answers[akey(c.id, st.token, b.qid)];
    if (!a) return json(res, 400, { error: '답이 없습니다.' });
    a.self = Array.isArray(b.self) ? b.self.slice(0, 50).map(Boolean) : [];
    save('answers'); notifyAnswer(a);
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'not found' });
}

// ---------- 교사 API ----------
async function teacherApi(req, res, url) {
  const p = url.pathname;
  if (p === '/api/teacher/login' && req.method === 'POST') {
    const b = await body(req);
    if (String(b.pin) !== String(config.teacherPin)) return json(res, 403, { error: 'PIN이 맞지 않습니다.' });
    const t = crypto.randomBytes(16).toString('hex'); teacherTokens.add(t);
    return json(res, 200, { token: t });
  }
  if (!isTeacher(req, url)) return json(res, 401, { error: '교사 로그인이 필요합니다.' });

  if (p === '/api/teacher/info') return json(res, 200, { urls: lanUrls(), questions: QUESTIONS });

  if (p === '/api/teacher/classes') {
    if (req.method === 'GET') return json(res, 200, Object.values(db.classes).sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(c => ({
      ...publicClass(c), students: Object.values(db.students).filter(s => s.classId === c.id).length })));
    if (req.method === 'POST') {
      const b = await body(req); const name = clip(b.name, 20).trim();
      if (!name) return json(res, 400, { error: '반 이름을 입력하세요.' });
      if (Object.values(db.classes).some(c => c.name === name)) return json(res, 409, { error: '같은 이름의 반이 있습니다.' });
      const c = newClass(name); db.classes[c.id] = c; save('classes');
      return json(res, 200, publicClass(c));
    }
    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id'); if (!db.classes[id]) return json(res, 404, { error: '반이 없습니다.' });
      delete db.classes[id];
      for (const [k, s] of Object.entries(db.students)) if (s.classId === id) delete db.students[k];
      for (const [k, a] of Object.entries(db.answers)) if (a.classId === id) delete db.answers[k];
      save('classes'); save('students'); save('answers');
      return json(res, 200, { ok: true });
    }
  }

  if (p === '/api/teacher/control' && req.method === 'POST') {
    const b = await body(req); const c = db.classes[b.classId];
    if (!c) return json(res, 404, { error: '반이 없습니다.' });
    switch (b.action) {
      case 'start': {
        if (!QMAP.has(b.qid)) return json(res, 400, { error: '문항이 없습니다.' });
        const sec = Math.min(600, Math.max(30, Number(b.seconds) || 180));
        c.mode = 'live';
        c.live = { qid: b.qid, seconds: sec, startedAt: now(), endsAt: now() + sec * 1000, closed: false, revealed: false };
        if (b.restart) for (const [k, a] of Object.entries(db.answers)) if (a.classId === c.id && a.qid === b.qid) delete db.answers[k];
        save('answers');
        break;
      }
      case 'extend': if (c.live && !c.live.closed) c.live.endsAt += (Number(b.seconds) || 30) * 1000; break;
      case 'close': closeLive(c); break;
      case 'reveal': {
        const qid = b.qid || c.live?.qid;
        if (c.live && c.live.qid === qid) { if (!c.live.closed) closeLive(c); c.live.revealed = true; }
        if (qid && !c.revealed.includes(qid)) c.revealed.push(qid);
        break;
      }
      case 'hide': c.revealed = c.revealed.filter(x => x !== b.qid); if (c.live && c.live.qid === b.qid) c.live.revealed = false; break;
      case 'idle': if (c.live && !c.live.closed) closeLive(c); c.live = null; break;
      case 'mode': c.mode = b.mode === 'free' ? 'free' : 'live'; if (c.mode === 'free' && c.live && !c.live.closed) closeLive(c); break;
      case 'freeSeconds': c.freeSeconds = Math.min(600, Math.max(0, Number(b.seconds) || 0)); break;
      case 'revealPolicy': c.revealPolicy = b.policy === 'submit' ? 'submit' : 'teacher'; break;
      default: return json(res, 400, { error: '알 수 없는 동작' });
    }
    save('classes'); scheduleClose(c); broadcastState(c);
    return json(res, 200, publicClass(c));
  }

  if (p === '/api/teacher/answers' && req.method === 'GET') {
    const c = db.classes[url.searchParams.get('classId')];
    if (!c) return json(res, 404, { error: '반이 없습니다.' });
    const qid = url.searchParams.get('qid');
    const students = Object.values(db.students).filter(s => s.classId === c.id).sort((a, b) => a.number - b.number)
      .map(s => ({ token: s.token, number: s.number, name: s.name, lastSeen: s.lastSeen }));
    const answers = Object.values(db.answers).filter(a => a.classId === c.id && (!qid || a.qid === qid));
    return json(res, 200, { cls: publicClass(c), students, answers });
  }

  if (p === '/api/teacher/grade' && req.method === 'POST') {
    const b = await body(req);
    const a = db.answers[akey(b.classId, b.token, b.qid)]; const q = QMAP.get(b.qid);
    if (!a || !q) return json(res, 404, { error: '답이 없습니다.' });
    const i = Number(b.sub);
    if (!(i >= 0 && i < q.subs.length)) return json(res, 400, { error: '소문항 번호' });
    const g = a.grades[i] || (a.grades[i] = { score: null, feedback: '' });
    if ('score' in b) g.score = b.score === null || b.score === '' ? null : Math.min(q.subs[i].points, Math.max(0, Number(b.score)));
    if ('feedback' in b) g.feedback = clip(b.feedback, 300);
    if ('publish' in b) a.gradesPublic = !!b.publish;
    save('answers');
    return json(res, 200, { ok: true, grade: g });
  }

  if (p === '/api/teacher/reset' && req.method === 'POST') {
    const b = await body(req);
    for (const [k, a] of Object.entries(db.answers))
      if (a.classId === b.classId && a.qid === b.qid && (!b.token || a.token === b.token)) delete db.answers[k];
    save('answers');
    const c = db.classes[b.classId]; if (c) broadcastState(c);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/teacher/student' && req.method === 'DELETE') {
    const t = url.searchParams.get('token');
    if (db.students[t]) { delete db.students[t]; for (const [k, a] of Object.entries(db.answers)) if (a.token === t) delete db.answers[k]; save('students'); save('answers'); }
    return json(res, 200, { ok: true });
  }

  if (p === '/api/teacher/export.csv' && req.method === 'GET') {
    const c = db.classes[url.searchParams.get('classId')];
    if (!c) return json(res, 404, { error: '반이 없습니다.' });
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['반', '번호', '이름', '문항', '문항 제목', '소문항', '배점', '답', '점수', '피드백', '상태', '걸린 시간(초)', '제출 시각']];
    const sts = Object.values(db.students).filter(s => s.classId === c.id).sort((a, b) => a.number - b.number);
    for (const s of sts) for (const q of QUESTIONS.questions) {
      const a = db.answers[akey(c.id, s.token, q.id)]; if (!a) continue;
      q.subs.forEach((sb, i) => rows.push([c.name, s.number, s.name, q.no, q.title, `(${sb.no})`, sb.points, a.texts[i],
        a.grades?.[i]?.score ?? '', a.grades?.[i]?.feedback ?? '', { draft: '작성 중', submitted: '제출', timeout: '시간 종료' }[a.status] || a.status, a.elapsed ?? '', a.submittedAt ? new Date(a.submittedAt).toLocaleString('ko-KR') : '']));
    }
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(c.name + '_서술형연습.csv')}` });
    return res.end('﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n'));
  }
  return json(res, 404, { error: 'not found' });
}

// ---------- 정적 파일 ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('없는 페이지입니다.'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

// ---------- 서버 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/ping') return json(res, 200, { mode: 'class', serverNow: now() });
    if (url.pathname === '/api/events') {
      const role = url.searchParams.get('role');
      let entry;
      if (role === 'teacher') { if (!isTeacher(req, url)) return json(res, 401, { error: 'login' }); entry = { role }; }
      else { const st = studentOf(req, url); if (!st) return json(res, 401, { error: 'join' }); entry = { role: 'student', classId: st.classId, token: st.token }; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      entry.res = res; streams.add(entry);
      send(res, { type: 'hello', serverNow: now() });
      req.on('close', () => streams.delete(entry));
      return;
    }
    if (url.pathname.startsWith('/api/teacher/')) return await teacherApi(req, res, url);
    if (url.pathname.startsWith('/api/')) return await studentApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: '서버 오류: ' + e.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n서술형 연습 웹앱이 켜졌습니다.');
  console.log('  교사 화면: http://localhost:' + PORT + '/teacher.html');
  console.log('  학생 접속 주소(같은 교내망):');
  for (const u of lanUrls()) console.log('    ' + u);
  console.log('  끄려면 이 창에서 Ctrl + C\n');
});
