import { $, h, store, isClassServer, fmtTime, syncClock, serverTime, listen, materialBox, STATUS, toast } from './common.js';

const app = $('#app');
const S = { mode: null, me: null, cls: null, cur: null, timers: [] };

// ---------------- 서버(수업 모드) ----------------
const classApi = {
  token: store.get('sp_token'),
  async call(path, opts = {}) {
    const r = await fetch('api/' + path, { ...opts, cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'x-student': this.token || '' } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { store.del('sp_token'); this.token = null; throw Object.assign(new Error(j.error || '다시 참여해 주세요.'), { relogin: true }); }
    if (!r.ok) throw Object.assign(new Error(j.error || '오류가 났어요.'), { data: j, status: r.status });
    return j;
  },
  classes() { return this.call('classes'); },
  async join(classId, number, name) {
    const j = await this.call('join', { method: 'POST', body: JSON.stringify({ classId, number, name }) });
    this.token = j.token; store.set('sp_token', j.token); return j;
  },
  me() { return this.call('me'); },
  question(qid, start) { return this.call(`question/${qid}${start ? '?start=1' : ''}`); },
  draft(qid, texts) { return this.call('draft', { method: 'POST', body: JSON.stringify({ qid, texts }) }); },
  submit(qid, texts, timeout) { return this.call('submit', { method: 'POST', body: JSON.stringify({ qid, texts, timeout }) }); },
  selfcheck(qid, self) { return this.call('selfcheck', { method: 'POST', body: JSON.stringify({ qid, self }) }); },
  listen(cb) { return listen('api/events?s=' + this.token, cb, () => this.me().then(j => cb({ type: 'state', cls: j.cls })).catch(() => {})); },
};

// ---------------- 혼자 연습(GitHub Pages) ----------------
const selfApi = {
  data: null,
  ans() { return store.get('sp_self_answers', {}); },
  put(a) { const all = this.ans(); all[a.qid] = a; store.set('sp_self_answers', all); },
  cls() { return { mode: 'free', freeSeconds: store.get('sp_self_seconds', 0), revealPolicy: 'submit', live: null, revealed: [], serverNow: Date.now() }; },
  async load() { if (!this.data) this.data = await (await fetch('questions.json', { cache: 'no-store' })).json(); return this.data; },
  async me() {
    const d = await this.load(); const all = this.ans(); const mine = {};
    for (const q of d.questions) if (all[q.id]) mine[q.id] = { status: all[q.id].status };
    return { student: null, cls: this.cls(), mine, list: d.questions.map(q => ({ id: q.id, no: q.no, title: q.title, concept: q.concept })) };
  },
  async question(qid, start) {
    const d = await this.load(); const q = d.questions.find(x => x.id === qid);
    let a = this.ans()[qid];
    if (start && !a) {
      const sec = this.cls().freeSeconds;
      a = { qid, texts: q.subs.map(() => ''), status: 'draft', startedAt: Date.now(), endsAt: sec ? Date.now() + sec * 1000 : null, self: [] };
      this.put(a);
    }
    return { question: q, reveal: !!a && a.status !== 'draft', answer: a, cls: this.cls() };
  },
  async draft(qid, texts) { const a = this.ans()[qid]; if (a && a.status === 'draft') { a.texts = texts; this.put(a); } return { answer: a }; },
  async submit(qid, texts, timeout) {
    const a = this.ans()[qid]; a.texts = texts; a.status = timeout ? 'timeout' : 'submitted'; a.submittedAt = Date.now();
    a.elapsed = Math.round((a.submittedAt - a.startedAt) / 1000); this.put(a);
    return { answer: a, reveal: true, question: (await this.load()).questions.find(x => x.id === qid) };
  },
  async selfcheck(qid, self) { const a = this.ans()[qid]; if (a) { a.self = self; this.put(a); } return { ok: true }; },
  reset(qid) { const all = this.ans(); delete all[qid]; store.set('sp_self_answers', all); },
  listen() { return () => {}; },
};

let api;

// ---------------- 화면 ----------------
function clearTimers() { S.timers.forEach(clearInterval); S.timers = []; }
function header() {
  const who = S.mode === 'self' ? '혼자 연습 모드 · 답은 이 기기에만 저장돼요'
    : S.me?.student ? `${S.me.student.className} ${S.me.student.number}번 ${S.me.student.name}` : '';
  $('#who').textContent = who;
}
function showError(e) {
  if (e.relogin) return renderJoin(e.message);
  toast(e.message || '오류가 났어요.');
}

async function renderJoin(msg) {
  clearTimers(); S.cur = null;
  let classes = [];
  try { classes = await api.classes(); } catch {}
  const sel = h('select', { id: 'cls', required: true }, h('option', { value: '' }, '반을 고르세요'), classes.map(c => h('option', { value: c.id }, c.name)));
  const num = h('input', { id: 'num', type: 'number', min: 1, max: 60, inputmode: 'numeric', placeholder: '예: 7', required: true });
  const nm = h('input', { id: 'nm', maxlength: 20, placeholder: '이름', required: true, autocomplete: 'off' });
  const err = h('p', { class: 'muted', style: 'color:var(--bad)' }, msg || '');
  const form = h('form', { class: 'card', onsubmit: async e => {
    e.preventDefault();
    try { await api.join(sel.value, num.value, nm.value.trim()); await boot(); }
    catch (x) { err.textContent = x.message; }
  } },
    h('h1', {}, '서술형 연습에 참여하기'),
    classes.length ? null : h('p', { class: 'muted' }, '아직 반이 없어요. 선생님이 반을 만들 때까지 기다려 주세요.'),
    h('label', { class: 'field' }, '반', sel),
    h('label', { class: 'field' }, '번호', num),
    h('label', { class: 'field' }, '이름', nm),
    err,
    h('button', { class: 'primary big', type: 'submit' }, '참여하기'));
  app.replaceChildren(form);
}

function renderHome() {
  clearTimers(); S.cur = null; header();
  const cls = S.cls;
  const parts = [];
  if (S.mode === 'class' && cls.mode === 'live') {
    if (cls.live && !cls.live.closed) return openQuestion(cls.live.qid);
    parts.push(h('div', { class: 'card notice' }, h('div', { class: 'emoji' }, '⏳'),
      h('h2', {}, '선생님이 문항을 시작하면 자동으로 나타나요'),
      h('p', { class: 'muted' }, '화면을 켜 둔 채로 기다려 주세요.')));
    const review = S.me.list.filter(q => S.me.mine[q.id] || cls.revealed.includes(q.id));
    if (review.length) parts.push(h('h2', {}, '지난 문항 다시 보기'), qlist(review));
  } else {
    if (S.mode === 'self') parts.push(selfSettings());
    else parts.push(h('div', { class: 'card' }, h('b', {}, '자유 연습'), h('span', { class: 'muted' },
      cls.freeSeconds ? ` · 문항마다 제한 시간 ${fmtTime(cls.freeSeconds)}` : ' · 제한 시간 없음')));
    parts.push(h('h2', {}, '문항을 고르세요'), qlist(S.me.list));
  }
  app.replaceChildren(...parts);
}

function selfSettings() {
  const cur = store.get('sp_self_seconds', 0);
  return h('div', { class: 'card' },
    h('b', {}, '문항당 제한 시간'), h('p', { class: 'muted' }, '시작 전에 정해요. 시간이 끝나면 자동으로 제출돼요.'),
    h('div', { class: 'tbtns' }, [0, 60, 120, 180, 240, 300].map(s => h('button', {
      class: s === cur ? 'sel' : '', onclick: () => { store.set('sp_self_seconds', s); renderHome(); } }, s ? `${s / 60}분` : '없음'))));
}

function qlist(list) {
  return h('div', { class: 'qlist' }, list.map(q => {
    const st = S.me.mine[q.id]?.status;
    return h('button', { class: 'qitem', onclick: () => openQuestion(q.id) },
      h('b', {}, `연습 ${q.no}. ${q.title}`),
      h('span', { class: 'tag concept' }, q.concept), ' ',
      st ? h('span', { class: 'tag ' + (st === 'submitted' ? 'ok' : st) }, STATUS[st]) : null);
  }));
}

async function openQuestion(qid) {
  clearTimers();
  let d;
  try { d = await api.question(qid, true); } catch (e) { return showError(e); }
  syncClock(d.cls?.serverNow);
  S.cls = d.cls || S.cls;
  S.cur = { qid, ...d };
  renderQuestion();
}

function remainingOf() {
  const a = S.cur.answer;
  if (!a || a.status !== 'draft' || !a.endsAt) return null;
  const now = S.mode === 'self' ? Date.now() : serverTime();
  return (a.endsAt - now) / 1000;
}

function renderQuestion() {
  clearTimers(); header();
  const { question: q, answer: a, reveal } = S.cur;
  const editable = a && a.status === 'draft' && (remainingOf() === null || remainingOf() > 0);
  const total = a?.endsAt && a.startedAt ? (a.endsAt - a.startedAt) / 1000 : null;

  const timer = h('div', { class: 'timer' });
  const boxes = [];
  const subs = q.subs.map((s, i) => {
    const ta = h('textarea', { rows: Math.max(2, s.lines * 2), 'aria-label': `(${s.no}) 답`, readonly: !editable,
      placeholder: editable ? '문장으로 써 보세요.' : '' });
    ta.value = a?.texts?.[i] || '';
    ta.addEventListener('input', () => { S.cur.dirty = true; });
    boxes.push(ta);
    return h('div', { class: 'sub' },
      h('div', { class: 'prompt' }, `(${s.no}) ${s.prompt}`, h('span', { class: 'pts' }, `[${s.points}점]`)),
      a ? ta : null,
      reveal && s.answer ? revealBox(s, i) : null);
  });

  const back = (S.mode === 'self' || S.cls.mode === 'free' || !(S.cls.live && !S.cls.live.closed))
    ? h('button', { class: 'ghost', onclick: () => { saveDraft(); refreshMe().then(renderHome); } }, '← 문항 목록') : null;
  const submitBtn = editable ? h('button', { class: 'primary big', onclick: () => doSubmit(false) }, '제출하기') : null;
  const stateMsg = !a ? h('p', { class: 'muted' }, '시간이 끝난 문항이에요. 답을 쓸 수 없어요.')
    : a.status !== 'draft' ? h('p', {}, h('span', { class: 'tag ' + (a.status === 'submitted' ? 'ok' : a.status) }, STATUS[a.status]),
      a.elapsed != null ? ` · 걸린 시간 ${fmtTime(a.elapsed)}` : '',
      reveal ? '' : h('span', { class: 'muted' }, ' · 선생님이 정답을 공개하면 아래에 나타나요.')) : null;
  const redo = S.mode === 'self' && a && a.status !== 'draft'
    ? h('button', { onclick: () => { selfApi.reset(q.id); openQuestion(q.id); } }, '다시 풀기') : null;

  app.replaceChildren(
    h('div', { class: 'card' },
      h('div', { class: 'qhead' },
        h('div', {}, h('h1', {}, `연습 ${q.no}. ${q.title}`), h('span', { class: 'tag concept' }, '핵심 개념: ' + q.concept)),
        timer),
      materialBox(q), stateMsg, ...subs,
      reveal && q.subs[0].answer ? selfTotal() : null),
    h('div', { class: 'actions' }, back, redo, submitBtn));

  const tick = () => {
    const r = remainingOf();
    if (r === null) { timer.replaceChildren(a?.status === 'draft' ? h('span', { class: 'muted' }, '제한 시간 없음') : ''); return; }
    timer.className = 'timer' + (r <= 10 ? ' danger' : r <= 30 ? ' warn' : '');
    timer.replaceChildren(h('div', { class: 'num' }, fmtTime(r)), h('div', { class: 'bar' }, h('i', { style: `width:${total ? Math.max(0, r / total * 100) : 0}%` })));
    if (r <= 0 && S.cur.answer.status === 'draft' && !S.cur.submitting) doSubmit(true);
  };
  tick();
  if (a && a.status === 'draft' && a.endsAt) S.timers.push(setInterval(tick, 250));
  if (editable) S.timers.push(setInterval(saveDraft, 3000));
  S.cur.boxes = boxes;
}

function texts() { return (S.cur.boxes || []).map(b => b.value); }
async function saveDraft() {
  if (!S.cur || !S.cur.dirty || S.cur.answer?.status !== 'draft') return;
  S.cur.dirty = false;
  try { await api.draft(S.cur.qid, texts()); } catch (e) { S.cur.dirty = true; if (e.status === 409) await openQuestion(S.cur.qid); }
}
async function doSubmit(timeout) {
  if (!timeout) {
    const empty = texts().filter(t => !t.trim()).length;
    if (empty && !confirm(`비어 있는 칸이 ${empty}개 있어요. 그래도 제출할까요?`)) return;
  }
  S.cur.submitting = true;
  try {
    const r = await api.submit(S.cur.qid, texts(), timeout);
    S.cur.answer = r.answer; S.cur.reveal = r.reveal; if (r.question) S.cur.question = r.question;
    toast(timeout ? '시간이 끝나 자동으로 제출했어요.' : '제출했어요!');
  } catch (e) {
    if (e.data?.answer) S.cur.answer = e.data.answer; else return showError(e);
  } finally { S.cur.submitting = false; }
  if (S.me?.mine) S.me.mine[S.cur.qid] = { status: S.cur.answer.status };
  renderQuestion();
}

function revealBox(s, i) {
  const self = S.cur.answer?.self || [];
  let idx = S.cur.question.subs.slice(0, i).reduce((n, x) => n + x.rubric.length, 0);
  return h('div', { class: 'reveal' },
    h('div', { class: 'label' }, '예시 답안'), h('div', {}, s.answer),
    h('div', { class: 'label', style: 'margin-top:6px' }, '스스로 점검 — 내 답에 들어 있으면 체크하세요'),
    s.rubric.map(r => {
      const k = idx++;
      const cb = h('input', { type: 'checkbox', checked: !!self[k], onchange: e => { const arr = S.cur.answer.self || (S.cur.answer.self = []); arr[k] = e.target.checked; api.selfcheck(S.cur.qid, arr).catch(() => {}); updateSelfTotal(); } });
      return h('label', { class: 'check' }, cb, h('span', {}, `${r.item} (${r.points}점)`));
    }));
}
function selfTotal() { const el = h('p', { id: 'selftotal', class: 'status-line' }); setTimeout(updateSelfTotal); return el; }
function updateSelfTotal() {
  const el = $('#selftotal'); if (!el) return;
  const rub = S.cur.question.subs.flatMap(s => s.rubric);
  const self = S.cur.answer?.self || [];
  const got = rub.reduce((n, r, k) => n + (self[k] ? r.points : 0), 0);
  el.textContent = `스스로 점검 점수: ${got} / ${rub.reduce((n, r) => n + r.points, 0)}점`;
}

async function refreshMe() { S.me = await api.me(); S.cls = S.me.cls; syncClock(S.cls.serverNow); }

// 실시간 상태 변화 처리
async function onEvent(m) {
  if (m.type === 'hello') return syncClock(m.serverNow);
  if (m.type !== 'state') return;
  const prev = S.cls; S.cls = m.cls; syncClock(m.cls.serverNow);
  const live = m.cls.live;
  if (S.cur) {
    const same = live && live.qid === S.cur.qid;
    const newLive = m.cls.mode === 'live' && live && !live.closed && live.qid !== S.cur.qid;
    if (newLive) { await saveDraft(); return openQuestion(live.qid); }
    if (same || m.cls.revealed.includes(S.cur.qid) !== prev?.revealed?.includes(S.cur.qid)) {
      try { const d = await api.question(S.cur.qid, false); Object.assign(S.cur, d); renderQuestion(); } catch {}
    }
    return;
  }
  try { await refreshMe(); } catch {}
  renderHome();
}

async function boot() {
  try {
    if (S.mode === 'class' && !api.token) return renderJoin();
    await refreshMe(); header();
    if (S.mode === 'class') { S.unlisten && S.unlisten(); S.unlisten = api.listen(onEvent); }
    renderHome();
  } catch (e) { showError(e); }
}

(async () => {
  S.mode = (await isClassServer()) ? 'class' : 'self';
  api = S.mode === 'class' ? classApi : selfApi;
  $('#logout').hidden = S.mode !== 'class';
  $('#logout').onclick = () => { if (confirm('참여 정보를 지우고 처음 화면으로 갈까요?')) { store.del('sp_token'); location.reload(); } };
  window.addEventListener('beforeunload', () => { saveDraft(); });
  boot();
})();
