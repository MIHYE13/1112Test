import { $, $$, h, isClassServer, fmtTime, syncClock, serverTime, listen, materialBox, kwHits, STATUS, toast } from './common.js';

const app = $('#app');
const T = { token: sessionStorage.getItem('sp_teacher'), info: null, classes: [], classId: localStorage.getItem('sp_tclass'),
  qid: null, seconds: 180, tab: 'q', data: null, pending: false, subView: 0 };

async function call(path, opts = {}) {
  const r = await fetch('api/teacher/' + path, { ...opts, cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'x-teacher': T.token || '' } });
  if (r.status === 401) { sessionStorage.removeItem('sp_teacher'); T.token = null; renderLogin(); throw new Error('로그인이 필요합니다.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || '오류');
  return j;
}
const Q = () => T.info.questions.questions;
const qById = id => Q().find(q => q.id === id);
const cls = () => T.classes.find(c => c.id === T.classId);
const masked = () => $('#mask').checked;
const nameOf = s => masked() ? `${s.number}번` : `${s.number}번 ${s.name}`;

// ---------------- 로그인 ----------------
function renderLogin(msg) {
  const pin = h('input', { type: 'password', inputmode: 'numeric', placeholder: '교사 PIN', autocomplete: 'current-password' });
  const err = h('p', { style: 'color:var(--bad)' }, msg || '');
  app.replaceChildren(h('form', { class: 'card', style: 'max-width:420px;margin:40px auto', onsubmit: async e => {
    e.preventDefault();
    try {
      const r = await fetch('api/teacher/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pin.value }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      T.token = j.token; sessionStorage.setItem('sp_teacher', j.token); start();
    } catch (x) { err.textContent = x.message; }
  } }, h('h1', {}, '교사 로그인'), h('p', { class: 'muted' }, 'PIN은 교사 PC의 local/config.json 에 있습니다.'), pin, err,
    h('button', { class: 'primary', type: 'submit', style: 'margin-top:10px' }, '들어가기')));
}

// ---------------- 데이터 ----------------
async function loadClasses() {
  T.classes = await call('classes');
  if (!cls() && T.classes[0]) T.classId = T.classes[0].id;
  localStorage.setItem('sp_tclass', T.classId || '');
  const sel = $('#classSel');
  sel.replaceChildren(T.classes.length ? '' : h('option', { value: '' }, '반 없음'),
    ...T.classes.map(c => h('option', { value: c.id, selected: c.id === T.classId }, `${c.name} (${c.students}명)`)));
}
async function loadAnswers() {
  if (!T.classId) { T.data = null; return; }
  T.data = await call(`answers?classId=${T.classId}`);
  const c = cls(); if (c) Object.assign(c, T.data.cls);
  syncClock(T.data.cls.serverNow);
  if (!T.qid) T.qid = T.data.cls.live?.qid || Q()[0].id;
}
const ansOf = (token, qid) => T.data?.answers.find(a => a.token === token && a.qid === qid);
function statusOf(a) {
  if (!a) return 'none';
  if (a.status === 'draft' && a.endsAt && serverTime() > a.endsAt + 5000) return 'timeout';
  return a.status;
}

// ---------------- 진행 패널 ----------------
function controlCard() {
  const c = cls();
  if (!c) return h('div', { class: 'card' }, h('h2', {}, '먼저 반을 만드세요'), h('p', { class: 'muted' }, '위쪽의 [+ 반 만들기]를 누르세요. 예: 5-1, 5-2'));
  const act = (action, extra = {}) => call('control', { method: 'POST', body: JSON.stringify({ classId: c.id, action, ...extra }) })
    .then(r => { Object.assign(c, r); syncClock(r.serverNow); renderAll(); }).catch(e => toast(e.message));
  const live = c.live;
  const q = qById(T.qid);
  return h('div', { class: 'card ctrl no-board' },
    h('div', { class: 'row' },
      h('b', {}, '진행 방식'),
      h('button', { class: c.mode === 'live' ? 'sel' : '', onclick: () => act('mode', { mode: 'live' }) }, '실시간 진행'),
      h('button', { class: c.mode === 'free' ? 'sel' : '', onclick: () => act('mode', { mode: 'free' }) }, '자유 연습'),
      h('span', { class: 'grow' }),
      h('b', {}, '정답 공개'),
      h('button', { class: c.revealPolicy === 'submit' ? 'sel' : '', onclick: () => act('revealPolicy', { policy: 'submit' }) }, '제출 즉시'),
      h('button', { class: c.revealPolicy === 'teacher' ? 'sel' : '', onclick: () => act('revealPolicy', { policy: 'teacher' }) }, '교사가 공개할 때')),
    h('div', { class: 'row' }, h('b', {}, '문항'), h('div', { class: 'qbtns' }, Q().map(x => h('button', {
      class: x.id === T.qid ? 'sel' : '', title: x.title, onclick: () => { T.qid = x.id; renderAll(); } }, `${x.no}. ${x.title}`)))),
    c.mode === 'live' ? h('div', { class: 'row' },
      h('b', {}, '제한 시간'), h('div', { class: 'tbtns' }, [60, 120, 180, 240, 300].map(s => h('button', {
        class: s === T.seconds ? 'sel' : '', onclick: () => { T.seconds = s; renderAll(); } }, `${s / 60}분`))),
      h('span', { class: 'grow' }),
      h('button', { class: 'primary', onclick: () => {
        const again = T.data.answers.some(a => a.qid === T.qid);
        if (again && !confirm(`연습 ${q.no}번에 이미 답이 있습니다. 기존 답을 지우고 다시 시작할까요?\n(취소하면 시작하지 않습니다)`)) return;
        act('start', { qid: T.qid, seconds: T.seconds, restart: again });
      } }, `▶ ${q.no}번 ${T.seconds / 60}분 시작`),
      h('button', { disabled: !live || live.closed, onclick: () => act('extend', { seconds: 30 }) }, '+30초'),
      h('button', { disabled: !live || live.closed, onclick: () => act('close') }, '지금 마감'),
      h('button', { onclick: () => act('reveal', { qid: T.qid }) }, '정답 공개'),
      h('button', { disabled: !c.revealed.includes(T.qid), onclick: () => act('hide', { qid: T.qid }) }, '정답 숨기기'),
      h('button', { onclick: () => act('idle') }, '대기 화면'))
      : h('div', { class: 'row' }, h('b', {}, '문항당 제한 시간'), h('div', { class: 'tbtns' }, [0, 60, 120, 180, 240, 300].map(s => h('button', {
        class: s === c.freeSeconds ? 'sel' : '', onclick: () => act('freeSeconds', { seconds: s }) }, s ? `${s / 60}분` : '없음'))),
        h('span', { class: 'grow' }),
        h('button', { onclick: () => act('reveal', { qid: T.qid }) }, `${q.no}번 정답 공개`),
        h('button', { disabled: !c.revealed.includes(T.qid), onclick: () => act('hide', { qid: T.qid }) }, '정답 숨기기')),
    h('div', { class: 'status-line', id: 'statusLine' }));
}

function counts(qid) {
  const sts = T.data?.students || [];
  let sub = 0, draft = 0;
  for (const s of sts) { const st = statusOf(ansOf(s.token, qid)); if (st === 'submitted' || st === 'timeout') sub++; else if (st === 'draft') draft++; }
  return { total: sts.length, sub, draft };
}
function tickStatus() {
  const c = cls(); const el = $('#statusLine'); const b = $('#boardTime');
  if (!c || !T.data) return;
  const live = c.live;
  let txt = '대기 중';
  let rem = null;
  if (c.mode === 'free') txt = `자유 연습 중 · 문항당 ${c.freeSeconds ? fmtTime(c.freeSeconds) : '시간 제한 없음'}`;
  else if (live) {
    const q = qById(live.qid);
    rem = live.closed ? 0 : (live.endsAt - serverTime()) / 1000;
    txt = `진행: 연습 ${q.no}. ${q.title} · ${live.closed || rem <= 0 ? '마감' : '남은 시간 ' + fmtTime(rem)}${live.revealed ? ' · 정답 공개됨' : ''}`;
  }
  const k = counts(live?.qid || T.qid);
  if (el) el.textContent = `${txt} · 제출 ${k.sub} / 참여 ${k.total}명 (작성 중 ${k.draft})`;
  if (b) {
    b.textContent = rem === null ? '—' : fmtTime(rem);
    $('#boardCnt').textContent = `제출 ${k.sub} / ${k.total}명`;
    const q = qById(live?.qid || T.qid); $('#boardQ').textContent = `연습 ${q.no}. ${q.title}`;
  }
}

// ---------------- 문항별 보기 ----------------
function gradeBox(s, a, i, sub) {
  if (!a) return null;
  const g = a.grades?.[i] || {};
  const post = body => call('grade', { method: 'POST', body: JSON.stringify({ classId: T.classId, token: a.token, qid: a.qid, sub: i, ...body }) })
    .then(r => { a.grades[i] = r.grade; updateSum(a); }).catch(e => toast(e.message));
  const sel = h('select', { 'aria-label': '점수', onchange: e => post({ score: e.target.value }) },
    h('option', { value: '' }, '점수'), Array.from({ length: sub.points + 1 }, (_, n) => h('option', { value: n, selected: g.score === n }, `${n}점`)));
  let tmo;
  const fb = h('input', { placeholder: '피드백', value: g.feedback || '', oninput: e => { clearTimeout(tmo); tmo = setTimeout(() => post({ feedback: e.target.value }), 600); } });
  return h('div', { class: 'grade' }, sel, fb);
}
function sumOf(a) { if (!a?.grades) return ''; const v = a.grades.map(g => g?.score).filter(x => x !== null && x !== undefined); return v.length ? v.reduce((x, y) => x + Number(y), 0) : ''; }
function updateSum(a) { const el = $(`#sum-${a.token}`); if (el) el.textContent = sumOf(a); }

function questionView() {
  const q = qById(T.qid); const c = cls();
  const head = h('div', { class: 'row' }, h('h2', { class: 'grow' }, `연습 ${q.no}. ${q.title}`),
    h('span', { class: 'tag concept' }, q.concept),
    h('button', { onclick: () => publish(q) }, '점수·피드백 학생에게 공개'),
    h('button', { onclick: async () => {
      if (!confirm(`${c.name} 연습 ${q.no}번 답을 모두 지울까요? 되돌릴 수 없습니다.`)) return;
      await call('reset', { method: 'POST', body: JSON.stringify({ classId: T.classId, qid: q.id }) }); await refresh();
    } }, '이 문항 답 지우기'));
  const det = h('details', {}, h('summary', {}, '자료·예시 답안 보기'), materialBox(q),
    q.subs.map(s => h('p', {}, h('b', {}, `(${s.no}) ${s.prompt} [${s.points}점]`), h('br'), s.answer)),
    h('p', { class: 'muted' }, '인정 범위: ' + q.accept));
  const viewBtns = h('div', { class: 'row' }, h('b', {}, '보기'),
    h('button', { class: T.subView === 0 ? 'sel' : '', onclick: () => { T.subView = 0; renderBody(); } }, '표'),
    q.subs.map(s => h('button', { class: T.subView === s.no ? 'sel' : '', onclick: () => { T.subView = s.no; renderBody(); } }, `(${s.no}) 답 모아 보기`)));
  const sts = T.data.students;
  if (!sts.length) return h('div', {}, head, det, h('p', { class: 'muted' }, '아직 참여한 학생이 없습니다.'));

  if (T.subView) {
    const i = T.subView - 1; const sub = q.subs[i];
    return h('div', {}, head, det, viewBtns, h('p', {}, h('b', {}, `(${sub.no}) ${sub.prompt}`)),
      h('div', { class: 'cardgrid' }, sts.map(s => { const a = ansOf(s.token, q.id); const t = a?.texts?.[i];
        return h('div', { class: 'acard' }, h('div', { class: 'nm' }, nameOf(s), ' ', h('span', { class: 'tag ' + statusOf(a) }, STATUS[statusOf(a)])),
          t ? t : h('span', { class: 'muted' }, '(빈칸)'), a ? kwChips(t, sub) : null); })));
  }
  return h('div', {}, head, det, viewBtns, h('div', { class: 'tablewrap' }, h('table', { class: 'ans' },
    h('thead', {}, h('tr', {}, h('th', {}, '학생'), h('th', {}, '상태'), q.subs.map(s => h('th', {}, `(${s.no}) ${s.points}점`)), h('th', {}, `합계/${q.total}`))),
    h('tbody', {}, sts.map(s => {
      const a = ansOf(s.token, q.id); const st = statusOf(a);
      return h('tr', {},
        h('td', {}, nameOf(s)),
        h('td', { class: 'center' }, h('span', { class: 'tag ' + (st === 'submitted' ? 'ok' : st) }, STATUS[st]), a?.elapsed != null ? h('div', { class: 'muted' }, fmtTime(a.elapsed)) : null,
          a?.self?.length ? h('div', { class: 'muted', title: '학생 스스로 점검' }, '자기점검 ' + selfScore(q, a)) : null),
        q.subs.map((sub, i) => h('td', { class: 'txt' }, a?.texts?.[i] || h('span', { class: 'muted' }, a ? '(빈칸)' : ''), a ? kwChips(a.texts[i], sub) : null, gradeBox(s, a, i, sub))),
        h('td', { class: 'center', id: `sum-${s.token}` }, sumOf(a)));
    })))));
}
function selfScore(q, a) { const rub = q.subs.flatMap(s => s.rubric); return rub.reduce((n, r, k) => n + (a.self[k] ? r.points : 0), 0); }
function kwChips(text, sub) {
  return h('div', { class: 'kw', title: '핵심 낱말 일치(참고용)' }, sub.rubric.flatMap(r => {
    const hits = kwHits(text, r.keywords);
    return r.keywords.map((k, i) => h('span', { class: hits[i] ? 'hit' : '' }, k.split('|')[0]));
  }));
}
async function publish(q) {
  const list = T.data.answers.filter(a => a.qid === q.id);
  if (!list.length) return toast('공개할 답이 없습니다.');
  for (const a of list) await call('grade', { method: 'POST', body: JSON.stringify({ classId: T.classId, token: a.token, qid: a.qid, sub: 0, publish: true }) });
  toast(`${list.length}명에게 점수·피드백을 공개했습니다.`);
}

// ---------------- 반 전체 보기 ----------------
function allView() {
  const sts = T.data.students;
  if (!sts.length) return h('p', { class: 'muted' }, '아직 참여한 학생이 없습니다.');
  return h('div', { class: 'tablewrap' }, h('table', { class: 'ans matrix' },
    h('thead', {}, h('tr', {}, h('th', {}, '학생'), Q().map(q => h('th', { title: q.title }, `${q.no}번`)), h('th', {}, '제출'), h('th', {}, '점수 합'))),
    h('tbody', {}, sts.map(s => {
      let n = 0, tot = 0;
      return h('tr', {}, h('td', { style: 'text-align:left' }, nameOf(s)), Q().map(q => {
        const a = ansOf(s.token, q.id); const st = statusOf(a); const sc = sumOf(a);
        if (st === 'submitted' || st === 'timeout') n++; if (sc !== '') tot += sc;
        return h('td', { style: 'cursor:pointer', onclick: () => { T.qid = q.id; T.tab = 'q'; renderAll(); } },
          a ? h('span', { class: 'tag ' + (st === 'submitted' ? 'ok' : st) }, STATUS[st]) : '·', sc !== '' ? h('div', {}, `${sc}점`) : null);
      }), h('td', {}, `${n}/${Q().length}`), h('td', {}, tot));
    }))),
    h('p', { class: 'muted' }, '칸을 누르면 그 문항의 답을 볼 수 있습니다.'));
}

// ---------------- 학생 관리 ----------------
function studentsView() {
  const sts = T.data.students;
  return h('div', {}, h('p', { class: 'muted' }, '학생은 반·번호·이름으로 참여합니다. 같은 번호로 다시 참여하면 이어서 씁니다. 잘못 참여한 학생은 삭제하세요.'),
    h('table', { class: 'ans' }, h('thead', {}, h('tr', {}, h('th', {}, '번호'), h('th', {}, '이름'), h('th', {}, '마지막 접속'), h('th', {}, ''))),
      h('tbody', {}, sts.map(s => h('tr', {}, h('td', {}, s.number), h('td', {}, masked() ? '' : s.name),
        h('td', {}, s.lastSeen ? new Date(s.lastSeen).toLocaleTimeString('ko-KR') : '-'),
        h('td', {}, h('button', { onclick: async () => {
          if (!confirm(`${s.number}번 ${s.name} 학생과 답을 삭제할까요?`)) return;
          await call('student?token=' + s.token, { method: 'DELETE' }); await refresh();
        } }, '삭제')))))),
    h('p', {}, h('button', { onclick: async () => {
      const c = cls(); if (!confirm(`${c.name} 반과 모든 학생·답안을 삭제할까요? 되돌릴 수 없습니다.`)) return;
      await call('classes?id=' + c.id, { method: 'DELETE' }); T.classId = null; await loadClasses(); await refresh();
    } }, '이 반 삭제')));
}

// ---------------- 그리기 ----------------
function renderBody() {
  const body = $('#body'); if (!body) return;
  if (!T.data) { body.replaceChildren(); return; }
  if (body.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { T.pending = true; return; }
  T.pending = false;
  body.replaceChildren(T.tab === 'q' ? questionView() : T.tab === 'all' ? allView() : studentsView());
}
function renderAll() {
  if (!T.info) return;
  const c = cls();
  app.replaceChildren(
    h('div', { class: 'board-only board-panel' },
      h('div', { class: 'q', id: 'boardQ' }), h('div', { class: 'time', id: 'boardTime' }), h('div', { class: 'cnt', id: 'boardCnt' }),
      h('p', {}, h('button', { onclick: () => document.body.classList.remove('board') }, '큰 화면 끄기'))),
    h('div', { id: 'urlCard' }),
    controlCard(),
    c ? h('div', { class: 'tabs no-board' }, [['q', '문항별 보기'], ['all', '반 전체 보기'], ['students', '학생 관리']].map(([k, t]) =>
      h('button', { class: T.tab === k ? 'on' : '', onclick: () => { T.tab = k; renderAll(); } }, t))) : null,
    h('div', { id: 'body', class: 'no-board', onfocusout: () => setTimeout(() => T.pending && renderBody(), 50) }));
  renderBody(); tickStatus();
}
function toggleUrl() {
  const box = $('#urlCard');
  if (box.firstChild) return box.replaceChildren();
  const urls = T.info.urls;
  const qr = h('div', { id: 'qr' });
  box.replaceChildren(h('div', { class: 'card' }, h('h2', {}, '학생 접속 주소 (같은 학교 와이파이)'),
    urls.length ? urls.map(u => h('p', {}, h('span', { class: 'urlbox' }, u))) : h('p', {}, '네트워크 주소를 찾지 못했습니다.'),
    qr, h('p', { class: 'muted' }, '접속이 안 되면: Windows 방화벽에서 Node.js의 개인 네트워크 허용을 확인하고, 학생 기기가 같은 와이파이에 있는지 확인하세요.')));
  if (window.QRCode && urls[0]) new window.QRCode(qr, { text: urls[0], width: 180, height: 180 });
}

let refreshTmo;
async function refresh() { await loadAnswers(); renderAll(); }
function softRefresh() { clearTimeout(refreshTmo); refreshTmo = setTimeout(async () => { await loadAnswers(); renderBody(); tickStatus(); }, 400); }

async function start() {
  try { T.info = await call('info'); await loadClasses(); await refresh(); } catch (e) { return; }
  listen('api/events?role=teacher&t=' + T.token, async m => {
    if (m.type === 'hello') return syncClock(m.serverNow);
    if (m.type === 'state') { const c = T.classes.find(x => x.id === m.classId); if (c) Object.assign(c, m.cls); if (m.classId === T.classId) { syncClock(m.cls.serverNow); softRefresh(); } }
    if ((m.type === 'answer' || m.type === 'join') && m.classId === T.classId) softRefresh();
    if (m.type === 'join') loadClasses();
  }, softRefresh);
}

// ---------------- 상단 버튼 ----------------
$('#classSel').onchange = e => { T.classId = e.target.value; localStorage.setItem('sp_tclass', T.classId); T.qid = null; refresh(); };
$('#newClass').onclick = async () => {
  const name = prompt('반 이름 (예: 5-1)'); if (!name) return;
  try { const c = await call('classes', { method: 'POST', body: JSON.stringify({ name }) }); T.classId = c.id; await loadClasses(); await refresh(); } catch (e) { toast(e.message); }
};
$('#showUrl').onclick = () => T.info && toggleUrl();
$('#csv').onclick = () => { if (T.classId) location.href = `api/teacher/export.csv?classId=${T.classId}&t=${T.token}`; };
$('#boardBtn').onclick = () => { document.body.classList.add('board'); tickStatus(); };
$('#mask').onchange = () => renderBody();
setInterval(tickStatus, 500);

(async () => {
  if (!(await isClassServer())) {
    app.replaceChildren(h('div', { class: 'card' }, h('h1', {}, '교사 화면은 교사 PC에서만 열립니다'),
      h('p', {}, '이 주소(GitHub Pages)는 학생 혼자 연습용입니다. 학생 답을 모아 보려면 교사 PC에서 서버를 켠 뒤 http://localhost:8080/teacher.html 로 접속하세요.')));
    return;
  }
  if (T.token) start(); else renderLogin();
})();
