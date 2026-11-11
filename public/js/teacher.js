// 교사 화면 — 1단계: Google 로그인, 반 만들기(반 코드), 참여 학생 확인, 모둠 수·모둠 고치기, 명렬표(이 브라우저에만)
import { $, h, store, toast } from './common.js';
import {
  auth, db, usingEmulator, currentUser, teacherSignIn, isAllowedTeacher, logout,
  doc, getDoc, updateDoc, collection, query, where, getDocs, onSnapshot, writeBatch, runTransaction, serverTimestamp,
} from './firebase.js';

const app = $('#app');
const T = { user: null, classes: [], classId: store.get('sp2_tclass'), cls: null, students: [], tab: 'join', unsub: [] };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0·O·1·I 제외

// ---------------- 로그인 ----------------
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
  $('#classSel').hidden = false; $('#newClass').hidden = false;
  await loadClasses();
}

// ---------------- 반 ----------------
async function loadClasses() {
  const snap = await getDocs(query(collection(db, 'classes'), where('ownerUid', '==', T.user.uid)));
  T.classes = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  if (!T.classes.find(c => c.id === T.classId)) T.classId = T.classes[0]?.id || null;
  const sel = $('#classSel');
  sel.replaceChildren(...(T.classes.length ? T.classes.map(c => h('option', { value: c.id, selected: c.id === T.classId }, c.name)) : [h('option', { value: '' }, '반 없음')]));
  openClass(T.classId);
}

function openClass(id) {
  T.unsub.forEach(f => f()); T.unsub = [];
  T.classId = id; store.set('sp2_tclass', id);
  if (!id) return renderNoClass();
  T.unsub.push(onSnapshot(doc(db, 'classes', id), s => { T.cls = s.exists() ? { id, ...s.data() } : null; render(); }));
  T.unsub.push(onSnapshot(collection(db, 'classes', id, 'students'), s => {
    T.students = s.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => a.number - b.number); render();
  }));
}

function renderNoClass() {
  app.replaceChildren(h('div', { class: 'card' }, h('h1', {}, '반을 만들어 주세요'),
    h('p', { class: 'muted' }, '위쪽의 [+ 반 만들기]를 누르면 반 코드가 만들어져요. 학생은 그 코드로 참여합니다.')));
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
        tx.set(ref, { ownerUid: T.user.uid, name: name.value.trim(), code, studentCount, groupCount,
          createdAt: serverTimestamp(),
          mode: 'live', freeSeconds: 180, revealPolicy: 'teacher', live: null, revealed: [], feedbackPublish: 'auto' });
        tx.set(doc(db, 'classCodes', code), { classId: ref.id });
      });
      T.classId = ref.id; toast(`반을 만들었어요. 반 코드: ${code}`); await loadClasses();
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

// ---------------- 화면 ----------------
function render() {
  const c = T.cls; if (!c) return;
  const tabs = [['join', '참여 안내'], ['groups', `모둠 관리 (${c.groupCount}모둠)`], ['students', `참여 학생 (${T.students.length}/${c.studentCount})`], ['roster', '명렬표']];
  const body = T.tab === 'groups' ? groupsView(c) : T.tab === 'students' ? studentsView(c) : T.tab === 'roster' ? rosterView(c) : joinView(c);
  // 입력 중에는 다시 그리지 않음
  if (app.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && T.lastTab === T.tab) return;
  T.lastTab = T.tab;
  app.replaceChildren(
    h('div', { class: 'tabs' }, tabs.map(([k, t]) => h('button', { class: T.tab === k ? 'on' : '', onclick: () => { T.tab = k; render(); } }, t))),
    body);
}

const studentUrl = () => new URL('./', location.href).href;
function joinView(c) {
  return h('div', { class: 'card board-panel' },
    h('p', { class: 'muted' }, `${c.name} 학생 참여 방법`),
    h('p', {}, '① 접속 주소'), h('p', {}, h('span', { class: 'urlbox' }, studentUrl())),
    h('p', {}, '② 반 코드'), h('div', { class: 'time', style: 'letter-spacing:.15em' }, c.code),
    h('p', {}, '③ 자기 번호와 모둠 입력'),
    h('p', { class: 'muted' }, `지금 ${T.students.length}명 참여 / ${c.studentCount}명`));
}

const rosterKey = id => 'sp2_roster_' + id;
const roster = () => store.get(rosterKey(T.classId), {});
const nameOf = n => roster()[n] ? `${n}번 ${roster()[n]}` : `${n}번`;

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

async function moveStudent(c, s, g) {
  try { await updateDoc(doc(db, 'classes', c.id, 'students', s.uid), { group: g }); toast(`${s.number}번 → ${g}모둠`); }
  catch (e) { toast('옮기지 못했어요: ' + e.message); }
}

async function saveGroupCount(c, groupCount) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'classes', c.id), { groupCount });
  for (const s of T.students) if (s.group > groupCount) batch.update(doc(db, 'classes', c.id, 'students', s.uid), { group: 0 });
  try { await batch.commit(); toast(`모둠 수를 ${groupCount}개로 저장했어요.`); } catch (e) { toast('저장하지 못했어요: ' + e.message); }
}

function studentsView(c) {
  return h('div', { class: 'card' },
    h('p', { class: 'muted' }, '학생은 반 코드와 번호로 참여해요. 다른 기기로 다시 참여해야 하는 학생은 [번호 풀기]를 누른 뒤 다시 참여하게 하세요.'),
    T.students.length ? h('table', { class: 'ans' },
      h('thead', {}, h('tr', {}, h('th', {}, '학생'), h('th', {}, '모둠'), h('th', {}, '마지막 접속'), h('th', {}, ''))),
      h('tbody', {}, T.students.map(s => h('tr', {},
        h('td', {}, nameOf(s.number)), h('td', {}, s.group ? `${s.group}모둠` : '모둠 없음'),
        h('td', {}, s.lastSeen?.toDate ? s.lastSeen.toDate().toLocaleTimeString('ko-KR') : '-'),
        h('td', {}, h('button', { onclick: () => release(c, s) }, '번호 풀기'))))))
      : h('p', {}, '아직 참여한 학생이 없어요.'));
}

async function release(c, s) {
  if (!confirm(`${s.number}번의 참여 기록을 지우고 번호를 풀까요? (지금까지의 답은 3단계 이후 이어 쓰기 기능으로 연결합니다)`)) return;
  const batch = writeBatch(db);
  batch.delete(doc(db, 'classes', c.id, 'numbers', String(s.number)));
  batch.delete(doc(db, 'classes', c.id, 'students', s.uid));
  try { await batch.commit(); toast(`${s.number}번을 풀었어요.`); } catch (e) { toast(e.message); }
}

function rosterView(c) {
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
        store.set(rosterKey(T.classId), out); toast(`${Object.keys(out).length}명 저장했어요.`); render();
      } }, '저장'),
      h('button', { onclick: () => { if (confirm('이 반의 명렬표를 이 브라우저에서 지울까요?')) { store.del(rosterKey(T.classId)); render(); } } }, '지우기')));
}

// ---------------- 시작 ----------------
$('#classSel').onchange = e => openClass(e.target.value);
$('#newClass').onclick = () => createClassForm();
$('#logout').onclick = async () => { T.unsub.forEach(f => f()); await logout(); location.reload(); };

(async () => {
  const u = await currentUser();
  if (u && !u.isAnonymous) afterLogin(); else renderLogin();
})();
