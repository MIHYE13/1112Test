// 교사 화면
// 1단계: Google 로그인, 반 만들기(반 코드), 참여 학생, 모둠 수·모둠 고치기, 명렬표(이 브라우저에만)
// 2단계: 진행(실시간·자유 연습, 1~5분, 연장·마감·정답 공개), 문항별 보기, 반 전체 보기, CSV, 큰 화면, 정답 키
import { $, h, store, toast, fmtTime, syncFromServerTime, serverNow, deadlineOf, liveOpen, loadQuestions, QIDS, materialBox, STATUS, statusClass } from './common.js';
import { kwHits, kwSubScore, kwScore } from './keyword-grade.js';
import {
  auth, db, usingEmulator, currentUser, teacherSignIn, isAllowedTeacher, logout,
  doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, onSnapshot, writeBatch, runTransaction, serverTimestamp, arrayUnion, arrayRemove,
} from './firebase.js';

const app = $('#app');
const T = {
  user: null, classes: [], classId: store.get('sp2_tclass'), cls: null, students: [], answers: [], qs: [], keys: {},
  tab: 'run', qid: 'p1', seconds: 180, view: 0, unsub: [], pending: false,
};
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0·O·1·I 제외
const GRACE = 6000;

// ================= 로그인 =================
function renderLogin(msg) {
  app.replaceChildren(h('div', { class: 'card', style: 'max-width:440px;margin:40px auto' },
    h('h1', {}, '교사 로그인'),
    h('p', { class: 'muted' }, '학교에서 쓰는 Google 계정으로 로그인하세요. 허용된 교사 계정만 들어갈 수 있어요.'),
    usingEmulator ? h('p', { class: 'tag' }, '개발용 에뮬레이터 모드') : null,
    msg ? h('p', { style: 'color:var(--bad)' }, msg) : null,
    h('button', { class: 'primary big', onclick: async () => {
      try { await teacherSignIn(); await afterLogin(); } catch (e) { renderLogin('로그인하지 못했어요: ' + (e.code || e.message)); }
    } }, 'Google로 로그인')));
}

async function afterLogin() {
  T.user = auth.currentUser;
  if (!T.user || T.user.isAnonymous) return renderLogin();
  $('#who').textContent = T.user.email;
  $('#logout').hidden = false;
  if (!(await isAllowedTeacher())) {
    return app.replaceChildren(h('div', { class: 'card' }, h('h1', {}, '허용되지 않은 계정이에요'),
      h('p', {}, `${T.user.email} 계정은 교사 목록에 없습니다.`),
      h('p', { class: 'muted' }, 'Firestore의 config/access 문서 teacherEmails 에 이 이메일을 추가한 뒤 다시 로그인하세요.')));
  }
  for (const id of ['classSel', 'newClass', 'csv', 'boardBtn', 'maskWrap']) $('#' + id).hidden = false;
  T.qs = await loadQuestions();
  await loadKeys();
  await loadClasses();
}

// ================= 정답 키 =================
async function loadKeys() {
  const snap = await getDocs(collection(db, 'answerKeys'));
  T.keys = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
}
const keysReady = () => QIDS.every(q => T.keys[q]);

function keysUploadCard() {
  const file = h('input', { type: 'file', accept: '.json,application/json' });
  return h('div', { class: 'card' }, h('h2', {}, '정답 키를 올려 주세요 (처음 한 번)'),
    h('p', { class: 'muted' }, '저장소의 data/answer-keys.json 파일을 고르세요. 교사만 읽을 수 있는 곳에 저장되고, 정답을 공개한 문항만 학생에게 보입니다.'),
    file, h('button', { class: 'primary', onclick: async () => {
      try {
        const data = JSON.parse(await file.files[0].text());
        const batch = writeBatch(db);
        for (const q of data.questions) if (QIDS.includes(q.id)) batch.set(doc(db, 'answerKeys', q.id), { accept: q.accept, subs: q.subs });
        await batch.commit(); await loadKeys(); toast('정답 키를 올렸어요.'); if (T.cls) await ensureClassKeys(); render();
      } catch (e) { toast('파일을 읽지 못했어요: ' + e.message); }
    } }, '올리기'));
}

/** 반별 정답 키(keys/{qid}) 준비: 학생 읽기는 규칙이 공개 조건으로 막음 */
async function ensureClassKeys() {
  if (!keysReady() || !T.cls) return;
  const have = await getDocs(collection(db, 'classes', T.cls.id, 'keys'));
  const ids = new Set(have.docs.map(d => d.id));
  const missing = QIDS.filter(q => !ids.has(q));
  if (!missing.length) return;
  const batch = writeBatch(db);
  for (const q of missing) batch.set(doc(db, 'classes', T.cls.id, 'keys', q), T.keys[q]);
  await batch.commit();
}

// ================= 반 =================
async function loadClasses() {
  const snap = await getDocs(query(collection(db, 'classes'), where('ownerUid', '==', T.user.uid)));
  T.classes = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  if (!T.classes.find(c => c.id === T.classId)) T.classId = T.classes[0]?.id || null;
  $('#classSel').replaceChildren(...(T.classes.length ? T.classes.map(c => h('option', { value: c.id, selected: c.id === T.classId }, c.name)) : [h('option', { value: '' }, '반 없음')]));
  openClass(T.classId);
}

function openClass(id) {
  T.unsub.forEach(f => f()); T.unsub = []; T.cls = null; T.students = []; T.answers = [];
  T.classId = id; store.set('sp2_tclass', id);
  if (!id) return renderNoClass();
  let first = true;
  T.unsub.push(onSnapshot(doc(db, 'classes', id), s => {
    T.cls = s.exists() ? { id, ...s.data() } : null;
    const L = T.cls?.live;
    if (L?.startedAt?.toMillis && !s.metadata.hasPendingWrites && T.lastStart !== L.startedAt.toMillis()) { T.lastStart = L.startedAt.toMillis(); syncFromServerTime(L.startedAt); }
    if (first && T.cls) { first = false; if (T.cls.live?.qid) T.qid = T.cls.live.qid; ensureClassKeys().catch(() => {}); }
    render();
  }));
  T.unsub.push(onSnapshot(collection(db, 'classes', id, 'students'), s => {
    T.students = s.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => a.number - b.number); render();
  }));
  T.unsub.push(onSnapshot(collection(db, 'classes', id, 'answers'), s => {
    T.answers = s.docs.map(d => ({ id: d.id, ...d.data() })); render();
  }));
}

function renderNoClass() {
  app.replaceChildren(h('div', { class: 'card' }, h('h1', {}, '반을 만들어 주세요'),
    h('p', { class: 'muted' }, '위쪽의 [+ 반 만들기]를 누르세요. 학생은 첫 화면에서 반 이름을 눌러 참여합니다.')),
    ...(keysReady() ? [] : [keysUploadCard()]));
}

function newCode() { let s = ''; for (let i = 0; i < 6; i++) s += CODE_CHARS[crypto.getRandomValues(new Uint32Array(1))[0] % CODE_CHARS.length]; return s; }

function createClassForm() {
  const name = h('input', { maxlength: 20, placeholder: '예: 5-2', required: true });
  const cnt = h('input', { type: 'number', min: 1, max: 40, value: 25, required: true });
  const grp = h('select', {}, [1, 2, 3, 4, 5, 6].map(n => h('option', { value: n, selected: n === 6 }, `${n}모둠`)));
  const err = h('p', { style: 'color:var(--bad)' });
  app.replaceChildren(h('form', { class: 'card', style: 'max-width:480px', onsubmit: async e => {
    e.preventDefault();
    const studentCount = Math.min(40, Math.max(1, parseInt(cnt.value, 10)));
    const groupCount = parseInt(grp.value, 10);
    try {
      const ref = doc(collection(db, 'classes'));
      let code;
      await runTransaction(db, async tx => {
        for (let i = 0; i < 5; i++) { code = newCode(); if (!(await tx.get(doc(db, 'classCodes', code))).exists()) break; code = null; }
        if (!code) throw new Error('반 코드를 만들지 못했어요. 다시 눌러 주세요.');
        tx.set(ref, { ownerUid: T.user.uid, name: name.value.trim(), code, studentCount, groupCount, createdAt: serverTimestamp(),
          mode: 'live', freeSeconds: 180, revealPolicy: 'teacher', live: null, revealed: [], feedbackPublish: 'auto' });
        tx.set(doc(db, 'classCodes', code), { classId: ref.id });
      });
      T.classId = ref.id; T.tab = 'join'; toast('반을 만들었어요.'); await loadClasses();
    } catch (x) { err.textContent = x.message; }
  } },
    h('h1', {}, '반 만들기'),
    h('label', { class: 'field' }, '반 이름', name),
    h('label', { class: 'field' }, '학생 수(번호 끝)', cnt),
    h('label', { class: 'field' }, '모둠 수 (반마다 다르게 정할 수 있어요. 학생이 참여할 때 자기 모둠을 고릅니다)', grp),
    err,
    h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, '만들기'),
      T.classId ? h('button', { type: 'button', onclick: () => openClass(T.classId) }, '취소') : null)));
}

// ================= 진행 조작 =================
const classRef = () => doc(db, 'classes', T.cls.id);
const ansOf = (uid, qid) => T.answers.find(a => a.uid === uid && a.qid === qid);
function statusOf(a) {
  if (!a) return 'none';
  if (a.status === 'draft') { const d = deadlineOf(T.cls, a); if (d !== null && serverNow() > d + GRACE) return 'timeout'; }
  return a.status;
}
async function act(fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg); } catch (e) { console.error(e); toast('실패했어요: ' + e.message); } }

async function startLive(qid, seconds) {
  const q = T.qs.find(x => x.id === qid);
  const old = T.answers.filter(a => a.qid === qid);
  if (old.length && !confirm(`연습 ${q.no}번에 이미 답이 ${old.length}개 있어요. 지우고 다시 시작할까요?`)) return;
  await act(async () => {
    const batch = writeBatch(db);
    for (const a of old) batch.delete(doc(db, 'classes', T.cls.id, 'answers', a.id));
    batch.update(classRef(), { mode: 'live', live: { qid, seconds, startedAt: serverTimestamp(), closed: false, closedAt: null, revealed: false },
      revealed: arrayRemove(qid) });
    await batch.commit();
  }, `연습 ${q.no}번 ${seconds / 60}분 시작!`);
}
const extend = () => act(() => updateDoc(classRef(), { 'live.seconds': T.cls.live.seconds + 30 }), '30초 늘렸어요.');
async function closeLive() {
  if (!T.cls.live || T.cls.live.closed) return;
  await act(() => updateDoc(classRef(), { 'live.closed': true, 'live.closedAt': serverTimestamp() }));
  setTimeout(finalizeDrafts, GRACE);
}
async function finalizeDrafts() {
  if (!T.cls) return;
  const late = T.answers.filter(a => a.status === 'draft' && (() => { const d = deadlineOf(T.cls, a); return d !== null && serverNow() > d + 5000; })());
  if (!late.length) return;
  const batch = writeBatch(db);
  for (const a of late) batch.update(doc(db, 'classes', T.cls.id, 'answers', a.id), { status: 'timeout', submittedAt: serverTimestamp() });
  await batch.commit().catch(e => console.warn('마감 정리 실패', e));
}
async function reveal(qid) {
  await ensureClassKeys();
  const L = T.cls.live;
  const upd = { revealed: arrayUnion(qid) };
  if (L?.qid === qid) { upd['live.revealed'] = true; if (!L.closed) { upd['live.closed'] = true; upd['live.closedAt'] = serverTimestamp(); setTimeout(finalizeDrafts, GRACE); } }
  await act(() => updateDoc(classRef(), upd), '정답을 공개했어요.');
}
const hide = qid => act(() => updateDoc(classRef(), { revealed: arrayRemove(qid), ...(T.cls.live?.qid === qid ? { 'live.revealed': false } : {}) }), '정답을 숨겼어요.');
async function idle() { if (liveOpen(T.cls)) await closeLive(); await act(() => updateDoc(classRef(), { live: null }), '대기 화면으로 바꿨어요.'); }
async function setMode(mode) { if (mode === 'free' && liveOpen(T.cls)) await closeLive(); await act(() => updateDoc(classRef(), { mode })); }
const setFreeSeconds = s => act(() => updateDoc(classRef(), { freeSeconds: s }));
const setPolicy = p => act(async () => { if (p === 'submit') await ensureClassKeys(); await updateDoc(classRef(), { revealPolicy: p }); });

// 시간이 지나면 자동으로 마감 처리
setInterval(() => {
  const c = T.cls; if (!c?.live || c.live.closed || !c.live.startedAt?.toMillis) return;
  if (serverNow() > c.live.startedAt.toMillis() + c.live.seconds * 1000 + GRACE) closeLive();
}, 1000);

// ================= 화면 =================
function render() {
  const c = T.cls; if (!c) return;
  if (app.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && T.lastTab === T.tab) { T.pending = true; return; }
  T.pending = false; T.lastTab = T.tab;
  const tabs = [['run', '진행·문항별 보기'], ['all', '반 전체 보기'], ['join', '참여 안내'], ['groups', `모둠 관리 (${c.groupCount}모둠)`],
    ['students', `참여 학생 (${T.students.length}/${c.studentCount})`], ['roster', '명렬표']];
  const body = { run: runView, all: allView, join: joinView, groups: groupsView, students: studentsView, roster: rosterView }[T.tab](c);
  app.replaceChildren(...[
    h('div', { class: 'board-only board-panel' },
      h('div', { class: 'q', id: 'boardQ' }), h('div', { class: 'time', id: 'boardTime' }), h('div', { class: 'cnt', id: 'boardCnt' }),
      h('p', {}, h('button', { onclick: () => document.body.classList.remove('board') }, '큰 화면 끄기'))),
    keysReady() ? null : keysUploadCard(),
    h('div', { class: 'tabs no-board' }, tabs.map(([k, t]) => h('button', { class: T.tab === k ? 'on' : '', onclick: () => { T.tab = k; render(); } }, t))),
    h('div', { class: 'no-board', onfocusout: () => setTimeout(() => T.pending && render(), 50) }, body)].filter(Boolean));
  tick();
}

function controlCard(c) {
  const L = c.live; const q = T.qs.find(x => x.id === T.qid); const open = liveOpen(c);
  return h('div', { class: 'card ctrl' },
    h('div', { class: 'row' },
      h('b', {}, '진행 방식'),
      h('button', { class: c.mode === 'live' ? 'sel' : '', onclick: () => setMode('live') }, '실시간 진행'),
      h('button', { class: c.mode === 'free' ? 'sel' : '', onclick: () => setMode('free') }, '자유 연습'),
      h('span', { class: 'grow' }),
      h('b', {}, '정답 공개'),
      h('button', { class: c.revealPolicy === 'submit' ? 'sel' : '', onclick: () => setPolicy('submit') }, '제출 즉시'),
      h('button', { class: c.revealPolicy === 'teacher' ? 'sel' : '', onclick: () => setPolicy('teacher') }, '교사가 공개할 때')),
    h('div', { class: 'row' }, h('b', {}, '문항'), h('div', { class: 'qbtns' }, T.qs.map(x => h('button', {
      class: x.id === T.qid ? 'sel' : '', title: x.title, onclick: () => { T.qid = x.id; T.view = 0; render(); } },
      `${x.no}. ${x.title}`, (c.revealed || []).includes(x.id) ? ' ✓' : '')))),
    c.mode === 'live'
      ? h('div', { class: 'row' },
          h('b', {}, '제한 시간'), h('div', { class: 'tbtns' }, [60, 120, 180, 240, 300].map(s => h('button', {
            class: s === T.seconds ? 'sel' : '', onclick: () => { T.seconds = s; render(); } }, `${s / 60}분`))),
          h('span', { class: 'grow' }),
          h('button', { class: 'primary', onclick: () => startLive(T.qid, T.seconds) }, `▶ ${q.no}번 ${T.seconds / 60}분 시작`),
          h('button', { disabled: !open, onclick: extend }, '+30초'),
          h('button', { disabled: !open, onclick: closeLive }, '지금 마감'),
          h('button', { onclick: () => reveal(T.qid) }, '정답 공개'),
          h('button', { disabled: !(c.revealed || []).includes(T.qid), onclick: () => hide(T.qid) }, '정답 숨기기'),
          h('button', { disabled: !L, onclick: idle }, '대기 화면'))
      : h('div', { class: 'row' },
          h('b', {}, '문항당 제한 시간'), h('div', { class: 'tbtns' }, [0, 60, 120, 180, 240, 300].map(s => h('button', {
            class: s === c.freeSeconds ? 'sel' : '', onclick: () => setFreeSeconds(s) }, s ? `${s / 60}분` : '없음'))),
          h('span', { class: 'grow' }),
          h('button', { onclick: () => reveal(T.qid) }, `${q.no}번 정답 공개`),
          h('button', { disabled: !(c.revealed || []).includes(T.qid), onclick: () => hide(T.qid) }, '정답 숨기기')),
    h('div', { class: 'status-line', id: 'statusLine' }));
}

function counts(qid) {
  let sub = 0, draft = 0;
  for (const s of T.students) { const st = statusOf(ansOf(s.uid, qid)); if (st === 'submitted' || st === 'timeout') sub++; else if (st === 'draft') draft++; }
  return { total: T.students.length, sub, draft };
}
function tick() {
  const c = T.cls; if (!c) return;
  const L = c.live; let txt = '대기 중'; let rem = null;
  if (c.mode === 'free') txt = `자유 연습 중 · 문항당 ${c.freeSeconds ? fmtTime(c.freeSeconds) : '제한 시간 없음'}`;
  else if (L) {
    const q = T.qs.find(x => x.id === L.qid);
    const d = deadlineOf(c, null); rem = L.closed || d === null ? 0 : (d - serverNow()) / 1000;
    txt = `진행: 연습 ${q?.no}. ${q?.title} · ${L.closed || rem <= 0 ? '마감' : '남은 시간 ' + fmtTime(rem)}${(c.revealed || []).includes(L.qid) ? ' · 정답 공개됨' : ''}`;
  }
  const k = counts(L?.qid || T.qid);
  const el = $('#statusLine'); if (el) el.textContent = `${txt} · 제출 ${k.sub} / 참여 ${k.total}명 (작성 중 ${k.draft})`;
  const b = $('#boardTime');
  if (b) {
    b.textContent = rem === null ? '—' : fmtTime(Math.max(0, rem));
    $('#boardCnt').textContent = `제출 ${k.sub} / ${k.total}명`;
    const q = T.qs.find(x => x.id === (L?.qid || T.qid)); $('#boardQ').textContent = `연습 ${q.no}. ${q.title}`;
  }
}
setInterval(tick, 500);

const rosterKey = id => 'sp2_roster_' + id;
const roster = () => store.get(rosterKey(T.classId), {});
const masked = () => $('#mask').checked;
const nameOf = n => (!masked() && roster()[n]) ? `${n}번 ${roster()[n]}` : `${n}번`;

function kwChips(text, keySub) {
  if (!keySub) return null;
  return h('div', { class: 'kw', title: '핵심 낱말 일치(참고용)' }, keySub.rubric.flatMap(r => {
    const hits = kwHits(text, r.keywords);
    return r.keywords.map((k, i) => h('span', { class: hits[i] ? 'hit' : '' }, k.split('|')[0]));
  }));
}

// 진행·문항별 보기
function runView(c) {
  const q = T.qs.find(x => x.id === T.qid); const key = T.keys[T.qid];
  const sts = [...T.students].sort((a, b) => (a.group || 9) - (b.group || 9) || a.number - b.number);
  const head = h('div', { class: 'row' }, h('h2', { class: 'grow' }, `연습 ${q.no}. ${q.title}`), h('span', { class: 'tag concept' }, q.concept),
    h('button', { onclick: async () => {
      const list = T.answers.filter(a => a.qid === q.id);
      if (!list.length || !confirm(`${c.name} 연습 ${q.no}번 답 ${list.length}개를 모두 지울까요? 되돌릴 수 없어요.`)) return;
      const batch = writeBatch(db); for (const a of list) batch.delete(doc(db, 'classes', c.id, 'answers', a.id));
      await act(() => batch.commit(), '지웠어요.');
    } }, '이 문항 답 지우기'));
  const det = h('details', {}, h('summary', {}, '자료·예시 답안 보기'), materialBox(q),
    q.subs.map((s, i) => h('p', {}, h('b', {}, `(${s.no}) ${s.prompt} [${s.points}점]`), h('br'), key?.subs[i]?.answer || '')),
    key ? h('p', { class: 'muted' }, '인정 범위: ' + key.accept) : null);
  const views = h('div', { class: 'row' }, h('b', {}, '보기'),
    h('button', { class: T.view === 0 ? 'sel' : '', onclick: () => { T.view = 0; render(); } }, '표'),
    q.subs.map(s => h('button', { class: T.view === s.no ? 'sel' : '', onclick: () => { T.view = s.no; render(); } }, `(${s.no}) 답 모아 보기`)));
  let content;
  if (!sts.length) content = h('p', { class: 'muted' }, '아직 참여한 학생이 없어요.');
  else if (T.view) {
    const i = T.view - 1;
    content = h('div', {}, h('p', {}, h('b', {}, `(${q.subs[i].no}) ${q.subs[i].prompt}`)),
      h('div', { class: 'cardgrid' }, sts.map(s => { const a = ansOf(s.uid, q.id); const t = a?.texts?.[i]; const st = statusOf(a);
        return h('div', { class: 'acard' }, h('div', { class: 'nm' }, `${s.group || '-'}모둠 · ${nameOf(s.number)} `, h('span', { class: 'tag ' + statusClass(st) }, STATUS[st])),
          t || h('span', { class: 'muted' }, a ? '(빈칸)' : ''), a ? kwChips(t, key?.subs[i]) : null); })));
  } else {
    content = h('div', { class: 'tablewrap' }, h('table', { class: 'ans' },
      h('thead', {}, h('tr', {}, h('th', {}, '학생'), h('th', {}, '상태'), q.subs.map(s => h('th', {}, `(${s.no}) ${s.points}점`)), h('th', { title: '핵심 낱말 일치로 계산한 참고 점수' }, `낱말 예상/${q.total}`))),
      h('tbody', {}, sts.map(s => {
        const a = ansOf(s.uid, q.id); const st = statusOf(a);
        const el = a?.submittedAt?.toMillis && a.startedAt?.toMillis ? fmtTime((a.submittedAt.toMillis() - a.startedAt.toMillis()) / 1000) : '';
        return h('tr', {},
          h('td', {}, `${s.group || '-'}모둠`, h('br'), nameOf(s.number)),
          h('td', { class: 'center' }, h('span', { class: 'tag ' + statusClass(st) }, STATUS[st]), el ? h('div', { class: 'muted' }, el) : null,
            a?.self?.length && key ? h('div', { class: 'muted', title: '학생 스스로 점검' }, '자기점검 ' + key.subs.flatMap(x => x.rubric).reduce((n, r, k) => n + (a.self[k] ? r.points : 0), 0)) : null),
          q.subs.map((sub, i) => h('td', { class: 'txt' }, a?.texts?.[i] || h('span', { class: 'muted' }, a ? '(빈칸)' : ''), a ? kwChips(a.texts[i], key?.subs[i]) : null)),
          h('td', { class: 'center' }, a && key ? kwScore(a.texts, key) : ''));
      }))));
  }
  return h('div', {}, controlCard(c), head, det, views, content);
}

// 반 전체 보기
function allView(c) {
  if (!T.students.length) return h('p', { class: 'muted' }, '아직 참여한 학생이 없어요.');
  return h('div', { class: 'tablewrap' }, h('table', { class: 'ans matrix' },
    h('thead', {}, h('tr', {}, h('th', {}, '학생'), T.qs.map(q => h('th', { title: q.title }, `${q.no}번`)), h('th', {}, '제출'), h('th', { title: '핵심 낱말 일치 참고 점수 합' }, '낱말 예상 합'))),
    h('tbody', {}, T.students.map(s => {
      let n = 0, tot = 0;
      return h('tr', {}, h('td', { style: 'text-align:left' }, `${s.group || '-'}모둠 · ${nameOf(s.number)}`), T.qs.map(q => {
        const a = ansOf(s.uid, q.id); const st = statusOf(a); const sc = a && T.keys[q.id] ? kwScore(a.texts, T.keys[q.id]) : null;
        if (st === 'submitted' || st === 'timeout') n++; if (sc !== null) tot += sc;
        return h('td', { style: 'cursor:pointer', onclick: () => { T.qid = q.id; T.tab = 'run'; render(); } },
          a ? h('span', { class: 'tag ' + statusClass(st) }, STATUS[st]) : '·', sc !== null ? h('div', { class: 'muted' }, `${sc}점`) : null);
      }), h('td', {}, `${n}/${T.qs.length}`), h('td', {}, tot));
    }))),
    h('p', { class: 'muted' }, '칸을 누르면 그 문항의 답을 볼 수 있어요. 점수는 핵심 낱말 일치로 계산한 참고값이에요(정식 채점은 4단계 [피드백]).'));
}

// CSV (교사 브라우저에서 만들어 내려받음 — 이름은 이 브라우저의 명렬표에서)
function exportCsv() {
  const c = T.cls; if (!c) return;
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['반', '번호', '이름', '모둠', '문항', '문항 제목', '소문항', '배점', '답', '낱말 예상 점수', '상태', '걸린 시간(초)', '제출 시각']];
  for (const s of T.students) for (const q of T.qs) {
    const a = ansOf(s.uid, q.id); if (!a) continue;
    const el = a.submittedAt?.toMillis && a.startedAt?.toMillis ? Math.round((a.submittedAt.toMillis() - a.startedAt.toMillis()) / 1000) : '';
    q.subs.forEach((sb, i) => rows.push([c.name, s.number, roster()[s.number] || '', s.group || '', q.no, q.title, `(${sb.no})`, sb.points, a.texts?.[i],
      T.keys[q.id] ? kwSubScore(a.texts?.[i], T.keys[q.id].subs[i]) : '', STATUS[statusOf(a)], el, a.submittedAt?.toDate ? a.submittedAt.toDate().toLocaleString('ko-KR') : '']));
  }
  const blob = new Blob(['﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: `${c.name}_서술형연습.csv` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const studentUrl = () => new URL('./', location.href).href;
const classLink = c => `${studentUrl()}?c=${c.id}`;
function joinView(c) {
  const qr = h('div', { id: 'qr' });
  setTimeout(() => { if (window.QRCode) new window.QRCode(qr, { text: classLink(c), width: 200, height: 200 }); });
  return h('div', { class: 'card board-panel' },
    h('p', { class: 'muted' }, `${c.name} 학생 참여 방법`),
    h('p', {}, '① 접속 주소에서 ', h('b', {}, c.name), ' 버튼 누르기'), h('p', {}, h('span', { class: 'urlbox' }, studentUrl())),
    h('p', {}, '또는 이 반 바로가기 링크·QR (반 고르기 없이 바로 번호 입력)'), h('p', {}, h('span', { class: 'urlbox' }, classLink(c)),
      ' ', h('button', { onclick: () => navigator.clipboard?.writeText(classLink(c)).then(() => toast('링크를 복사했어요.')) }, '복사')),
    qr,
    h('p', {}, '② 자기 번호와 모둠 입력 → 시작하기'),
    h('p', { class: 'muted' }, `지금 ${T.students.length}명 참여 / ${c.studentCount}명`));
}

// 모둠 관리: 학생이 참여할 때 자기 모둠을 고름. 교사는 모둠 수를 정하고, 잘못 고른 학생만 옮김
function groupsView(c) {
  const countSel = h('select', { 'aria-label': '모둠 수' }, [1, 2, 3, 4, 5, 6].map(n => h('option', { value: n, selected: n === c.groupCount }, `${n}모둠`)));
  const groupsOf = g => T.students.filter(s => (s.group || 0) === g);
  const moveSel = s => h('select', { 'aria-label': `${s.number}번 모둠`, onchange: e => moveStudent(c, s, parseInt(e.target.value, 10)) },
    Array.from({ length: c.groupCount }, (_, i) => h('option', { value: i + 1, selected: s.group === i + 1 }, `${i + 1}모둠`)),
    s.group ? null : h('option', { value: 0, selected: true }, '모둠 없음'));
  const card = (g, title) => h('div', { class: 'card', style: 'margin:0' }, h('b', {}, title), h('span', { class: 'muted' }, ` ${groupsOf(g).length}명`),
    h('div', {}, groupsOf(g).map(s => h('div', { class: 'row', style: 'gap:6px;margin:4px 0' }, h('span', { style: 'min-width:6em' }, nameOf(s.number)), moveSel(s)))));
  return h('div', {},
    h('div', { class: 'card' }, h('div', { class: 'row' },
      h('b', {}, '이 반의 모둠 수'), countSel,
      h('button', { class: 'primary', onclick: () => saveGroupCount(c, parseInt(countSel.value, 10)) }, '저장')),
      h('p', { class: 'muted' }, '학생은 참여할 때 자기 번호와 모둠을 직접 고릅니다. 잘못 고른 학생은 아래에서 옮겨 주세요. 모둠 수를 줄이면 없어진 모둠의 학생은 ‘모둠 없음’이 됩니다.')),
    h('div', { class: 'qlist' }, Array.from({ length: c.groupCount }, (_, i) => card(i + 1, `${i + 1}모둠`)),
      groupsOf(0).length ? card(0, '모둠 없음') : null));
}
const moveStudent = (c, s, g) => act(() => updateDoc(doc(db, 'classes', c.id, 'students', s.uid), { group: g }), `${s.number}번 → ${g}모둠`);
async function saveGroupCount(c, groupCount) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'classes', c.id), { groupCount });
  for (const s of T.students) if (s.group > groupCount) batch.update(doc(db, 'classes', c.id, 'students', s.uid), { group: 0 });
  await act(() => batch.commit(), `모둠 수를 ${groupCount}개로 저장했어요.`);
}

function studentsView(c) {
  return h('div', { class: 'card' },
    h('p', { class: 'muted' }, '학생은 반을 고르고 번호·모둠을 입력해 참여해요. 다른 기기로 다시 참여해야 하는 학생은 [번호 풀기]를 누른 뒤 다시 참여하게 하세요.'),
    T.students.length ? h('table', { class: 'ans' },
      h('thead', {}, h('tr', {}, h('th', {}, '학생'), h('th', {}, '모둠'), h('th', {}, '마지막 접속'), h('th', {}, ''))),
      h('tbody', {}, T.students.map(s => h('tr', {},
        h('td', {}, nameOf(s.number)), h('td', {}, s.group ? `${s.group}모둠` : '모둠 없음'),
        h('td', {}, s.lastSeen?.toDate ? s.lastSeen.toDate().toLocaleTimeString('ko-KR') : '-'),
        h('td', {}, h('button', { onclick: () => release(c, s) }, '번호 풀기'))))))
      : h('p', {}, '아직 참여한 학생이 없어요.'));
}
async function release(c, s) {
  if (!confirm(`${s.number}번의 참여 기록을 지우고 번호를 풀까요? 이 학생의 답은 남아 있어요.`)) return;
  const batch = writeBatch(db);
  batch.delete(doc(db, 'classes', c.id, 'numbers', String(s.number)));
  batch.delete(doc(db, 'classes', c.id, 'students', s.uid));
  await act(() => batch.commit(), `${s.number}번을 풀었어요.`);
}

function rosterView() {
  const r = roster();
  const ta = h('textarea', { rows: 12, placeholder: '한 줄에 "번호 이름"\n예)\n1 김하늘\n2 이준서' });
  ta.value = Object.entries(r).sort((a, b) => a[0] - b[0]).map(([n, v]) => `${n} ${v}`).join('\n');
  return h('div', { class: 'card' },
    h('h2', {}, '명렬표 (이 브라우저에만 저장)'),
    h('p', { class: 'muted' }, '학생 이름은 Firebase에 저장하지 않아요. 여기 적은 이름은 이 컴퓨터의 브라우저에만 남고, 교사 화면에서 번호 옆에 보여 줍니다.'),
    ta,
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'primary', onclick: () => {
        const out = {};
        for (const line of ta.value.split(/\r?\n/)) { const m = line.trim().match(/^(\d{1,2})[\s,.\t]+(.+)$/); if (m) out[parseInt(m[1], 10)] = m[2].trim().slice(0, 20); }
        store.set(rosterKey(T.classId), out); toast(`${Object.keys(out).length}명 저장했어요.`); ta.blur(); render();
      } }, '저장'),
      h('button', { onclick: () => { if (confirm('이 반의 명렬표를 이 브라우저에서 지울까요?')) { store.del(rosterKey(T.classId)); render(); } } }, '지우기')));
}

// ================= 시작 =================
$('#classSel').onchange = e => openClass(e.target.value);
$('#newClass').onclick = () => createClassForm();
$('#logout').onclick = async () => { T.unsub.forEach(f => f()); await logout(); location.reload(); };
$('#csv').onclick = exportCsv;
$('#boardBtn').onclick = () => { document.body.classList.add('board'); tick(); };
$('#mask').onchange = () => render();

(async () => {
  const u = await currentUser();
  if (u && !u.isAnonymous) afterLogin(); else renderLogin();
})();
