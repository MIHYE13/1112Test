// 학생 화면 — 1단계: 익명 로그인, 반 코드 → 번호·모둠 직접 입력 후 시작
// (문항 풀기·정답 확인·친구 답 보기는 2·4·5단계에서 이어 붙입니다)
import { $, h, store, toast } from './common.js';
import { db, studentSignIn, doc, getDoc, updateDoc, onSnapshot, writeBatch, serverTimestamp } from './firebase.js';

const app = $('#app');
const S = { user: null, classId: store.get('sp2_class'), cls: null, me: null, unsub: [] };

function cleanup() { S.unsub.forEach(f => f()); S.unsub = []; }

// 1) 반 코드 입력 → 2) 번호와 모둠 입력 → 참여
function renderJoin(msg) {
  cleanup();
  $('#who').textContent = ''; $('#leave').hidden = true;
  const code = h('input', { maxlength: 6, placeholder: '예: K7P2QX', autocomplete: 'off', autocapitalize: 'characters',
    style: 'text-transform:uppercase;letter-spacing:.15em;font-size:1.3em', required: true });
  const err = h('p', { style: 'color:var(--bad)' }, msg || '');
  const btn = h('button', { class: 'primary big', type: 'submit' }, '다음');
  app.replaceChildren(h('form', { class: 'card', onsubmit: async e => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try { const found = await findClass(code.value.trim().toUpperCase()); renderNumberGroup(found); }
    catch (x) { err.textContent = x.message; btn.disabled = false; }
  } },
    h('h1', {}, '서술형 연습에 참여하기'),
    h('p', { class: 'muted' }, '선생님이 알려 준 반 코드를 입력하세요.'),
    h('label', { class: 'field' }, '반 코드 (6글자)', code),
    err, btn));
  code.focus();
}

async function findClass(code) {
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('반 코드는 6글자예요.');
  const codeSnap = await getDoc(doc(db, 'classCodes', code)).catch(() => null);
  if (!codeSnap?.exists()) throw new Error('반 코드를 찾을 수 없어요. 다시 확인해 주세요.');
  const classId = codeSnap.data().classId;
  const cls = (await getDoc(doc(db, 'classes', classId))).data();
  return { classId, cls };
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
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'ghost', onclick: () => renderJoin() }, '← 반 코드 다시 입력'), h('span', { class: 'grow' }), btn)));
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

function enter() {
  cleanup();
  const meRef = doc(db, 'classes', S.classId, 'students', S.user.uid);
  updateDoc(meRef, { lastSeen: serverTimestamp() }).catch(() => {});
  S.unsub.push(onSnapshot(meRef, s => {
    if (!s.exists()) { store.del('sp2_class'); S.classId = null; return renderJoin('선생님이 참여 기록을 정리했어요. 다시 참여해 주세요.'); }
    S.me = s.data(); renderHome();
  }, () => renderJoin()));
  S.unsub.push(onSnapshot(doc(db, 'classes', S.classId), s => { S.cls = s.data(); renderHome(); }, () => {}));
}

function renderHome() {
  if (!S.me || !S.cls) return;
  $('#who').textContent = `${S.cls.name} ${S.me.number}번`;
  $('#leave').hidden = false;
  app.replaceChildren(h('div', { class: 'card notice' },
    h('div', { class: 'emoji' }, '⏳'),
    h('h2', {}, `${S.cls.name} ${S.me.number}번으로 참여했어요`),
    h('p', {}, S.me.group ? h('span', { class: 'tag concept', style: 'font-size:1em' }, `${S.me.group}모둠`) : h('span', { class: 'tag' }, '모둠 없음 — 선생님께 말씀하세요')),
    h('p', { class: 'muted' }, '선생님이 문항을 시작하면 이 화면에 나타나요. 화면을 켜 둔 채로 기다려 주세요.')));
}

$('#leave').onclick = () => {
  if (!confirm('이 반에서 나가 다른 반 코드로 참여할까요?')) return;
  store.del('sp2_class'); S.classId = null; renderJoin();
};

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
