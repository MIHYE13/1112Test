// 학생 화면
// 1단계: 익명 로그인, 반 고르기(목록 또는 링크) → 번호·모둠 직접 입력 후 시작
// 2단계: 실시간 진행·자유 연습, 제한 시간·자동 제출, 정답 공개·자기 점검
// (점수·피드백은 4단계, 친구 답 보기는 5단계에서 이어 붙입니다)
import { $, h, store, toast, fmtTime, syncFromServerTime, serverNow, deadlineOf, liveOpen, loadQuestions, QIDS, materialBox, STATUS, statusClass, timerView } from './common.js';
import { db, studentSignIn, doc, getDoc, setDoc, updateDoc, onSnapshot, writeBatch, serverTimestamp, collection, getDocs } from './firebase.js';

const app = $('#app');
const S = { user: null, classId: store.get('sp2_class'), cls: null, me: null, unsub: [], qs: [], ans: {}, keys: {}, cur: null, timers: [], synced: false };

function cleanup() { S.unsub.forEach(f => f()); S.unsub = []; clearTimers(); S.cur = null; S.ans = {}; S.keys = {}; }
function clearTimers() { S.timers.forEach(clearInterval); S.timers = []; }
const ansRef = qid => doc(db, 'classes', S.classId, 'answers', `${S.user.uid}_${qid}`);

// ================= 참여 =================
// 1) 반 고르기(목록 버튼, 또는 선생님이 준 링크 ?c=반) → 2) 번호와 모둠 입력 → 참여
async function renderJoin(msg) {
  cleanup();
  $('#who').textContent = ''; $('#leave').hidden = true;
  const direct = new URLSearchParams(location.search).get('c');
  if (direct && !msg) {
    const snap = await getDoc(doc(db, 'classes', direct)).catch(() => null);
    if (snap?.exists()) return renderNumberGroup({ classId: direct, cls: snap.data() });
  }
  let classes = [];
  try { classes = (await getDocs(collection(db, 'classes'))).docs.map(d => ({ classId: d.id, cls: d.data() })); } catch {}
  classes.sort((x, y) => x.cls.name.localeCompare(y.cls.name, 'ko', { numeric: true }));
  app.replaceChildren(h('div', { class: 'card' },
    h('h1', {}, '서술형 연습에 참여하기'),
    msg ? h('p', { style: 'color:var(--bad)' }, msg) : null,
    h('p', { class: 'muted' }, '우리 반을 눌러 주세요.'),
    classes.length
      ? h('div', { class: 'tbtns' }, classes.map(c => h('button', { class: 'big', onclick: () => renderNumberGroup(c) }, c.cls.name)))
      : h('p', {}, '아직 열린 반이 없어요. 선생님이 반을 만들 때까지 기다려 주세요.'),
    h('p', {}, h('button', { class: 'ghost', onclick: () => renderJoin() }, '↻ 목록 새로고침'))));
}

function renderNumberGroup({ classId, cls }) {
  let group = 0;
  const num = h('input', { type: 'number', min: 1, max: cls.studentCount, inputmode: 'numeric', placeholder: '예: 7', required: true });
  const groupBtns = h('div', { class: 'tbtns', role: 'radiogroup', 'aria-label': '모둠' },
    Array.from({ length: cls.groupCount }, (_, i) => h('button', { type: 'button', class: 'big', role: 'radio', 'aria-checked': 'false',
      onclick: e => {
        group = i + 1;
        for (const b of groupBtns.children) { b.classList.remove('sel'); b.setAttribute('aria-checked', 'false'); }
        e.currentTarget.classList.add('sel'); e.currentTarget.setAttribute('aria-checked', 'true');
      } }, `${i + 1}모둠`)));
  const err = h('p', { style: 'color:var(--bad)' });
  const btn = h('button', { class: 'primary big', type: 'submit' }, '시작하기');
  app.replaceChildren(h('form', { class: 'card', onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    const number = parseInt(num.value, 10);
    if (!(number >= 1 && number <= cls.studentCount)) return (err.textContent = `번호는 1번부터 ${cls.studentCount}번까지예요.`);
    if (!group) return (err.textContent = '내 모둠을 눌러 주세요.');
    btn.disabled = true;
    try { await join(classId, cls, number, group); }
    catch (x) { err.textContent = x.message; btn.disabled = false; }
  } },
    h('h1', {}, `${cls.name} 참여하기`),
    h('label', { class: 'field' }, '내 번호', num),
    h('div', { class: 'field' }, h('b', {}, '내 모둠'), groupBtns),
    err,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'ghost', onclick: () => { history.replaceState(null, '', location.pathname); renderJoin(); } }, '← 반 다시 고르기'), h('span', { class: 'grow' }), btn)));
  num.focus();
}

async function join(classId, cls, number, group) {
  const meRef = doc(db, 'classes', classId, 'students', S.user.uid);
  const mine = await getDoc(meRef);
  if (mine.exists()) {
    if (mine.data().number !== number) throw new Error(`이 기기는 이미 ${mine.data().number}번으로 참여했어요. 번호가 틀렸다면 선생님께 말씀하세요.`);
  } else {
    const seat = await getDoc(doc(db, 'classes', classId, 'numbers', String(number)));
    if (seat.exists()) throw new Error(`${number}번은 이미 다른 기기로 참여했어요. 선생님께 말씀하세요.`);
    const batch = writeBatch(db);
    batch.set(meRef, { number, group, joinedAt: serverTimestamp(), lastSeen: serverTimestamp() });
    batch.set(doc(db, 'classes', classId, 'numbers', String(number)), { uid: S.user.uid });
    try { await batch.commit(); }
    catch { throw new Error('참여하지 못했어요. 번호와 모둠을 확인하고 다시 눌러 주세요.'); }
  }
  S.classId = classId; store.set('sp2_class', classId);
  toast('참여했어요!');
  enter();
}

// ================= 실시간 구독 =================
function enter() {
  cleanup();
  const meRef = doc(db, 'classes', S.classId, 'students', S.user.uid);
  updateDoc(meRef, { lastSeen: serverTimestamp() }).catch(() => {});
  S.unsub.push(onSnapshot(meRef, snap => {
    if (!snap.exists()) { cleanup(); store.del('sp2_class'); S.classId = null; return renderJoin('선생님이 참여 기록을 정리했어요. 다시 참여해 주세요.'); }
    S.me = snap.data();
    if (!snap.metadata.hasPendingWrites && S.me.lastSeen?.toMillis && !S.synced) { syncFromServerTime(S.me.lastSeen); S.synced = true; }
    route();
  }, () => renderJoin()));
  S.unsub.push(onSnapshot(doc(db, 'classes', S.classId), snap => { const prev = S.cls; S.cls = snap.data(); onClassChange(prev); }, () => {}));
  for (const qid of QIDS) {
    S.unsub.push(onSnapshot(ansRef(qid), snap => {
      const prev = S.ans[qid]; S.ans[qid] = snap.exists() ? snap.data() : null;
      if (S.cur?.qid === qid) onMyAnswerChange(prev); else if (!S.cur) route();
    }, () => {}));
  }
}

function route() {
  if (!S.me || !S.cls) return;
  $('#who').textContent = `${S.cls.name} ${S.me.number}번 · ${S.me.group ? S.me.group + '모둠' : '모둠 없음'}`;
  $('#leave').hidden = false;
  if (S.cls.mode === 'live' && liveOpen(S.cls)) {
    if (S.cur?.qid !== S.cls.live.qid) openQuestion(S.cls.live.qid);
    return;
  }
  if (!S.cur) renderHome();
}

const revealed = (c, q) => !!c && (c.revealed || []).includes(q);
function onClassChange(prev) {
  if (!S.cls || !S.me) return;
  const c = S.cls;
  if (!S.cur) return route();
  const q = S.cur.qid;
  if (c.mode === 'live' && liveOpen(c) && c.live.qid !== q) { saveDraft(); return openQuestion(c.live.qid); }
  const a = S.ans[q];
  if (a?.status === 'draft' && a.mode === 'live' && c.live?.qid === q && c.live.closed) return submit(true);
  if (revealed(prev, q) !== revealed(c, q)) { delete S.keys[q]; return renderQuestion(); }
  if (prev?.live?.seconds !== c.live?.seconds || prev?.live?.closed !== c.live?.closed) renderQuestionKeepText();
}

// ================= 처음 화면 =================
async function renderHome() {
  clearTimers();
  if (!S.qs.length) S.qs = await loadQuestions();
  if (S.cur) return;
  const c = S.cls; const parts = [];
  if (c.mode === 'live') {
    parts.push(h('div', { class: 'card notice' }, h('div', { class: 'emoji' }, '⏳'),
      h('h2', {}, '선생님이 문항을 시작하면 자동으로 나타나요'),
      h('p', { class: 'muted' }, '화면을 켜 둔 채로 기다려 주세요.')));
    const review = S.qs.filter(q => S.ans[q.id] || revealed(c, q.id));
    if (review.length) parts.push(h('h2', {}, '지난 문항 다시 보기'), qlist(review));
  } else {
    parts.push(h('div', { class: 'card' }, h('b', {}, '자유 연습'),
      h('span', { class: 'muted' }, c.freeSeconds ? ` · 문항마다 제한 시간 ${fmtTime(c.freeSeconds)}` : ' · 제한 시간 없음')),
      h('h2', {}, '문항을 고르세요'), qlist(S.qs));
  }
  app.replaceChildren(...parts);
}

function qlist(list) {
  return h('div', { class: 'qlist' }, list.map(q => {
    const st = S.ans[q.id]?.status;
    return h('button', { class: 'qitem', onclick: () => openQuestion(q.id) },
      h('b', {}, `연습 ${q.no}. ${q.title}`), h('span', { class: 'tag concept' }, q.concept), ' ',
      st ? h('span', { class: 'tag ' + statusClass(st) }, STATUS[st]) : null);
  }));
}

// ================= 문항 =================
async function openQuestion(qid) {
  clearTimers();
  if (!S.qs.length) S.qs = await loadQuestions();
  S.cur = { qid, q: S.qs.find(x => x.id === qid), dirty: false, submitting: false };
  const c = S.cls;
  if (!S.ans[qid]) {
    const canLive = c.mode === 'live' && liveOpen(c) && c.live.qid === qid;
    const canFree = c.mode === 'free';
    if (canLive || canFree) {
      try {
        await setDoc(ansRef(qid), {
          uid: S.user.uid, number: S.me.number, group: S.me.group, qid, mode: canLive ? 'live' : 'free',
          seconds: canLive ? 0 : (c.freeSeconds || 0), texts: S.cur.q.subs.map(() => ''), status: 'draft',
          startedAt: serverTimestamp(), updatedAt: serverTimestamp(), submittedAt: null, self: [],
        });
      } catch (e) { console.warn('시작 실패', e); }
    }
  }
  renderQuestion();
}

function onMyAnswerChange(prev) {
  const a = S.ans[S.cur.qid];
  if (a?.startedAt?.toMillis && !prev?.startedAt?.toMillis) syncFromServerTime(a.startedAt);
  if (!a || !prev || prev.status !== a.status || (!prev.startedAt?.toMillis && a.startedAt?.toMillis)) renderQuestionKeepText();
}

async function keyFor(qid) {
  if (S.keys[qid] !== undefined) return S.keys[qid];
  try { const k = await getDoc(doc(db, 'classes', S.classId, 'keys', qid)); S.keys[qid] = k.exists() ? k.data() : null; }
  catch { S.keys[qid] = null; }
  return S.keys[qid];
}

// 쓰던 글을 잃지 않고 다시 그리기
function renderQuestionKeepText() {
  const keep = S.cur?.boxes?.map(b => b.value);
  return renderQuestion(keep);
}

async function renderQuestion(keep) {
  clearTimers();
  const { qid, q } = S.cur; const c = S.cls; const a = S.ans[qid];
  const needKey = a && a.status !== 'draft' || revealed(c, qid);
  const key = needKey ? await keyFor(qid) : null;
  if (S.cur?.qid !== qid) return;
  const dl = deadlineOf(c, a);
  const editable = a?.status === 'draft' && !!a.startedAt?.toMillis && (dl === null || serverNow() < dl);

  const total = a?.mode === 'live' && c.live?.qid === qid ? c.live.seconds : a?.seconds;
  const timer = a?.status === 'draft' ? timerView(() => deadlineOf(S.cls, S.ans[qid]), total, () => submit(true)) : h('div');
  if (timer._iv) S.timers.push(timer._iv);

  const boxes = q.subs.map((s, i) => {
    const ta = h('textarea', { rows: Math.max(2, s.lines * 2), 'aria-label': `(${s.no}) 답`, readonly: !editable, placeholder: editable ? '문장으로 써 보세요.' : '' });
    ta.value = (a?.status === 'draft' && keep?.[i] != null) ? keep[i] : (a?.texts?.[i] || '');
    ta.addEventListener('input', () => { S.cur.dirty = true; });
    return ta;
  });
  S.cur.boxes = boxes;
  const self = a?.self || [];
  let k = 0;
  const subs = q.subs.map((s, i) => h('div', { class: 'sub' },
    h('div', { class: 'prompt' }, `(${s.no}) ${s.prompt}`, h('span', { class: 'pts' }, `[${s.points}점]`)),
    a ? boxes[i] : null,
    key ? h('div', { class: 'reveal' },
      h('div', { class: 'label' }, '예시 답안'), h('div', {}, key.subs[i].answer),
      a && a.status !== 'draft' ? [h('div', { class: 'label', style: 'margin-top:6px' }, '스스로 점검 — 내 답에 들어 있으면 체크하세요'),
        key.subs[i].rubric.map(r => { const idx = k++; return h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: !!self[idx], onchange: e => selfCheck(idx, e.target.checked) }),
          h('span', {}, `${r.item} (${r.points}점)`)); })] : null) : null));

  const liveHere = c.mode === 'live' && liveOpen(c) && c.live.qid === qid;
  const msg = !a ? h('p', { class: 'muted' }, '이 문항은 지금 풀 수 없어요. 선생님이 시작하면 풀 수 있어요.')
    : a.status !== 'draft' ? h('p', {}, h('span', { class: 'tag ' + statusClass(a.status) }, STATUS[a.status]),
        a.submittedAt?.toMillis && a.startedAt?.toMillis ? ` · 걸린 시간 ${fmtTime((a.submittedAt.toMillis() - a.startedAt.toMillis()) / 1000)}` : '',
        key ? '' : h('span', { class: 'muted' }, ' · 선생님이 정답을 공개하면 아래에 나타나요.'))
    : !editable ? h('p', { class: 'muted' }, '시간이 끝났어요.') : null;
  let selfTotal = null;
  if (key && a && a.status !== 'draft') {
    const rub = key.subs.flatMap(s => s.rubric);
    const got = rub.reduce((n, r, i) => n + (self[i] ? r.points : 0), 0);
    selfTotal = h('p', { class: 'status-line' }, `스스로 점검 점수: ${got} / ${rub.reduce((n, r) => n + r.points, 0)}점`);
  }

  app.replaceChildren(
    h('div', { class: 'card' },
      h('div', { class: 'qhead' }, h('div', {}, h('h1', {}, `연습 ${q.no}. ${q.title}`), h('span', { class: 'tag concept' }, '핵심 개념: ' + q.concept)), timer),
      materialBox(q), msg, ...subs, selfTotal),
    h('div', { class: 'actions' },
      liveHere && a?.status === 'draft' ? null : h('button', { class: 'ghost', onclick: () => { saveDraft(); clearTimers(); S.cur = null; renderHome(); } }, '← 문항 목록'),
      editable ? h('button', { class: 'primary big', onclick: () => submit(false) }, '제출하기') : null));

  if (editable) S.timers.push(setInterval(saveDraft, 3000));
}

const texts = () => (S.cur?.boxes || []).map(b => b.value);
async function saveDraft() {
  if (!S.cur?.dirty || S.ans[S.cur.qid]?.status !== 'draft') return;
  S.cur.dirty = false;
  try { await updateDoc(ansRef(S.cur.qid), { texts: texts(), updatedAt: serverTimestamp() }); }
  catch { if (S.cur) S.cur.dirty = true; }
}

async function submit(timeout) {
  if (!S.cur || S.cur.submitting || S.ans[S.cur.qid]?.status !== 'draft') return;
  if (!timeout) {
    const empty = texts().filter(t => !t.trim()).length;
    if (empty && !confirm(`비어 있는 칸이 ${empty}개 있어요. 그래도 제출할까요?`)) return;
  }
  S.cur.submitting = true;
  try {
    await updateDoc(ansRef(S.cur.qid), { texts: texts(), status: timeout ? 'timeout' : 'submitted', submittedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    toast(timeout ? '시간이 끝나 자동으로 제출했어요.' : '제출했어요!');
  } catch {
    toast(timeout ? '시간이 지나 제출되지 않았어요. 선생님께 말씀하세요.' : '제출하지 못했어요. 다시 눌러 주세요.');
  } finally { if (S.cur) S.cur.submitting = false; }
}

async function selfCheck(idx, on) {
  const a = S.ans[S.cur.qid]; const arr = [...(a.self || [])];
  while (arr.length <= idx) arr.push(false);
  arr[idx] = on;
  try { await updateDoc(ansRef(S.cur.qid), { self: arr }); S.ans[S.cur.qid] = { ...a, self: arr }; renderQuestion(); }
  catch { toast('저장하지 못했어요.'); }
}

$('#leave').onclick = () => {
  if (!confirm('이 반에서 나가 다른 반으로 참여할까요?')) return;
  cleanup(); store.del('sp2_class'); S.classId = null; renderJoin();
};
window.addEventListener('beforeunload', () => { saveDraft(); });

(async () => {
  try { S.user = await studentSignIn(); }
  catch { return app.replaceChildren(h('div', { class: 'card' }, h('h2', {}, '연결하지 못했어요'), h('p', {}, '인터넷 연결을 확인하고 새로고침해 주세요.'))); }
  if (S.classId) {
    const mine = await getDoc(doc(db, 'classes', S.classId, 'students', S.user.uid)).catch(() => null);
    if (mine?.exists()) return enter();
    store.del('sp2_class'); S.classId = null;
  }
  renderJoin();
})();
