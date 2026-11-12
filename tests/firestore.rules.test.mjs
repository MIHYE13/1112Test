// 보안 규칙 테스트(1·2단계) — Firestore 에뮬레이터 필요(npm run emulators 또는 firebase emulators:exec)
import { test, before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, collection, getDocs, query, where, Timestamp } from 'firebase/firestore';

let env;
const TEACHER = { email: 'teacher@example.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
const OTHER = { email: 'other@example.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
const ANON = { firebase: { sign_in_provider: 'anonymous' } };

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-seosul-rules',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085 },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'config/access'), { teacherEmails: ['teacher@example.com'] });
  });
});

const teacherDb = () => env.authenticatedContext('t1', TEACHER).firestore();
const studentDb = uid => env.authenticatedContext(uid, ANON).firestore();

async function makeClass(db = teacherDb(), code = 'K7P2QX') {
  const batch = writeBatch(db);
  batch.set(doc(db, 'classes/c1'), { ownerUid: 't1', name: '5-2', code, studentCount: 25, groupCount: 6,
    createdAt: serverTimestamp(), mode: 'live', freeSeconds: 180,
    revealPolicy: 'teacher', live: null, revealed: [], feedbackPublish: 'auto' });
  batch.set(doc(db, `classCodes/${code}`), { classId: 'c1' });
  return batch.commit();
}
function joinBatch(db, uid, number, group) {
  const batch = writeBatch(db);
  batch.set(doc(db, `classes/c1/students/${uid}`), { number, group, joinedAt: serverTimestamp(), lastSeen: serverTimestamp() });
  batch.set(doc(db, `classes/c1/numbers/${number}`), { uid });
  return batch.commit();
}

test('허용된 교사만 config/access 를 읽음', async () => {
  await assertSucceeds(getDoc(doc(teacherDb(), 'config/access')));
  await assertFails(getDoc(doc(env.authenticatedContext('o', OTHER).firestore(), 'config/access')));
  await assertFails(getDoc(doc(studentDb('s1'), 'config/access')));
});

test('교사는 반을 만들 수 있고, 허용되지 않은 계정·학생은 못 만듦', async () => {
  await assertSucceeds(makeClass());
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'config/access'), { teacherEmails: ['teacher@example.com'] }));
  await assertFails(makeClass(env.authenticatedContext('t1', OTHER).firestore()));
  await assertFails(makeClass(studentDb('t1')));
});

test('이미 있는 반 코드는 다시 만들 수 없음', async () => {
  await makeClass();
  const db = teacherDb();
  const batch = writeBatch(db);
  batch.set(doc(db, 'classes/c2'), { ownerUid: 't1', name: '5-3', code: 'K7P2QX', studentCount: 20, groupCount: 4, createdAt: serverTimestamp() });
  batch.set(doc(db, 'classCodes/K7P2QX'), { classId: 'c2' });
  await assertFails(batch.commit());
});

test('학생은 번호와 자기 모둠(1~모둠 수)을 골라 참여함', async () => {
  await makeClass();
  await assertSucceeds(joinBatch(studentDb('s1'), 's1', 7, 2));
  await assertSucceeds(joinBatch(studentDb('s2'), 's2', 8, 6));
  await assertFails(joinBatch(studentDb('s3'), 's3', 9, 7));   // 모둠 수 초과
  await assertFails(joinBatch(studentDb('s4'), 's4', 10, 0));  // 모둠 안 고름
});

test('같은 번호로 두 학생이 참여할 수 없음', async () => {
  await makeClass();
  await joinBatch(studentDb('s1'), 's1', 7, 2);
  await assertFails(joinBatch(studentDb('s2'), 's2', 7, 2));
});

test('학생 수를 넘는 번호는 참여할 수 없음', async () => {
  await makeClass();
  await assertFails(joinBatch(studentDb('s1'), 's1', 26, 1));
});

test('학생은 다른 학생 기록을 읽거나 목록을 볼 수 없음', async () => {
  await makeClass();
  await joinBatch(studentDb('s1'), 's1', 7, 2);
  await assertSucceeds(getDoc(doc(studentDb('s1'), 'classes/c1/students/s1')));
  await assertFails(getDoc(doc(studentDb('s2'), 'classes/c1/students/s1')));
  await assertFails(getDocs(collection(studentDb('s2'), 'classes/c1/students')));
  await assertSucceeds(getDocs(collection(teacherDb(), 'classes/c1/students')));
});

test('학생은 자기 모둠을 바꿀 수 없고, 교사는 바꿀 수 있음', async () => {
  await makeClass();
  await joinBatch(studentDb('s1'), 's1', 7, 2);
  await assertFails(updateDoc(doc(studentDb('s1'), 'classes/c1/students/s1'), { group: 3 }));
  await assertSucceeds(updateDoc(doc(studentDb('s1'), 'classes/c1/students/s1'), { lastSeen: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(teacherDb(), 'classes/c1/students/s1'), { group: 3 }));
  await assertFails(updateDoc(doc(teacherDb(), 'classes/c1/students/s1'), { group: 7 })); // 모둠 수 초과
});

test('다른 교사는 남의 반을 고치거나 볼 수 없음', async () => {
  await makeClass();
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'config/access'), { teacherEmails: ['teacher@example.com', 'other@example.com'] }));
  const other = env.authenticatedContext('t2', OTHER).firestore();
  await assertFails(updateDoc(doc(other, 'classes/c1'), { groupCount: 3 }));
  await assertFails(getDocs(collection(other, 'classes/c1/students')));
  await assertSucceeds(getDocs(query(collection(teacherDb(), 'classes'), where('ownerUid', '==', 't1'))));
});

test('교사는 반 코드·소유자를 바꿀 수 없음', async () => {
  await makeClass();
  await assertFails(updateDoc(doc(teacherDb(), 'classes/c1'), { code: 'AAAAAA' }));
  await assertSucceeds(updateDoc(doc(teacherDb(), 'classes/c1'), { groupCount: 4 }));
});

test('교사는 번호를 풀 수 있고 학생은 못 품', async () => {
  await makeClass();
  await joinBatch(studentDb('s1'), 's1', 7, 2);
  await assertFails(deleteDoc(doc(studentDb('s1'), 'classes/c1/numbers/7')));
  await assertSucceeds(deleteDoc(doc(teacherDb(), 'classes/c1/numbers/7')));
});

// ================= 2단계: 답·마감·정답 키 =================

async function setClass(patch) {
  await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'classes/c1'), patch));
}
const liveFor = (qid, seconds, agoMs = 0, extra = {}) => ({ mode: 'live', live: { qid, seconds, startedAt: Timestamp.fromMillis(Date.now() - agoMs), closed: false, closedAt: null, revealed: false, ...extra } });
const newAnswer = (uid, qid, mode = 'live', seconds = 0) => ({ uid, number: 7, group: 2, qid, mode, seconds, texts: ['', '', ''], status: 'draft',
  startedAt: serverTimestamp(), updatedAt: serverTimestamp(), submittedAt: null, self: [] });
async function joined() { await makeClass(); await joinBatch(studentDb('s1'), 's1', 7, 2); }

test('실시간 진행 중인 문항만 답을 시작할 수 있음', async () => {
  await joined();
  const db = studentDb('s1');
  await assertFails(setDoc(doc(db, 'classes/c1/answers/s1_p2'), newAnswer('s1', 'p2')));      // 진행 전
  await setClass(liveFor('p2', 60));
  await assertFails(setDoc(doc(db, 'classes/c1/answers/s1_p3'), newAnswer('s1', 'p3')));      // 다른 문항
  await assertSucceeds(setDoc(doc(db, 'classes/c1/answers/s1_p2'), newAnswer('s1', 'p2')));
  await assertFails(setDoc(doc(studentDb('s2'), 'classes/c1/answers/s2_p2'), { ...newAnswer('s2', 'p2'), number: 9 })); // 참여 안 한 학생
});

test('시간 안에는 제출되고, 마감 뒤에는 서버가 거부함', async () => {
  await joined();
  await setClass(liveFor('p2', 60));
  const db = studentDb('s1');
  await setDoc(doc(db, 'classes/c1/answers/s1_p2'), newAnswer('s1', 'p2'));
  await assertSucceeds(updateDoc(doc(db, 'classes/c1/answers/s1_p2'), { texts: ['열은', '', ''], updatedAt: serverTimestamp() }));
  await setClass({ 'live.startedAt': Timestamp.fromMillis(Date.now() - 70000) }); // 60초 + 5초 여유 지남
  await assertFails(updateDoc(doc(db, 'classes/c1/answers/s1_p2'), { texts: ['늦은 답', '', ''], status: 'submitted', submittedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  // 교사는 남은 작성 중 답을 시간 종료로 정리
  await assertSucceeds(updateDoc(doc(teacherDb(), 'classes/c1/answers/s1_p2'), { status: 'timeout', submittedAt: serverTimestamp() }));
});

test('교사가 마감하면 5초 뒤부터 제출 거부', async () => {
  await joined();
  await setClass(liveFor('p2', 300));
  const db = studentDb('s1');
  await setDoc(doc(db, 'classes/c1/answers/s1_p2'), newAnswer('s1', 'p2'));
  await setClass({ 'live.closed': true, 'live.closedAt': Timestamp.fromMillis(Date.now() - 10000) });
  await assertFails(updateDoc(doc(db, 'classes/c1/answers/s1_p2'), { status: 'submitted', submittedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});

test('제출 뒤에는 답을 고칠 수 없고 자기 점검만 바꿈', async () => {
  await joined();
  await setClass(liveFor('p2', 60));
  const db = studentDb('s1');
  await setDoc(doc(db, 'classes/c1/answers/s1_p2'), newAnswer('s1', 'p2'));
  await assertSucceeds(updateDoc(doc(db, 'classes/c1/answers/s1_p2'), { texts: ['a', 'b', 'c'], status: 'submitted', submittedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'classes/c1/answers/s1_p2'), { texts: ['고침', '', ''], updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db, 'classes/c1/answers/s1_p2'), { self: [true, false, true] }));
});

test('학생은 다른 학생 답을 읽거나 목록을 볼 수 없고, 교사는 볼 수 있음', async () => {
  await joined();
  await joinBatch(studentDb('s2'), 's2', 8, 1);
  await setClass(liveFor('p2', 60));
  await setDoc(doc(studentDb('s1'), 'classes/c1/answers/s1_p2'), newAnswer('s1', 'p2'));
  await assertFails(getDoc(doc(studentDb('s2'), 'classes/c1/answers/s1_p2')));
  await assertFails(getDocs(collection(studentDb('s2'), 'classes/c1/answers')));
  await assertSucceeds(getDocs(collection(teacherDb(), 'classes/c1/answers')));
});

test('정답 키: 공개 전에는 못 읽고, 공개 뒤 또는 제출 즉시 공개 반에서 제출 뒤에 읽음', async () => {
  await joined();
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'classes/c1/keys/p2'), { accept: '', subs: [] }));
  const db = studentDb('s1');
  await assertFails(getDoc(doc(db, 'classes/c1/keys/p2')));
  await setClass({ revealed: ['p2'] });
  await assertSucceeds(getDoc(doc(db, 'classes/c1/keys/p2')));
  await setClass({ revealed: [], revealPolicy: 'submit', ...liveFor('p2', 60) });
  await assertFails(getDoc(doc(db, 'classes/c1/keys/p2')));
  await setDoc(doc(db, 'classes/c1/answers/s1_p2'), newAnswer('s1', 'p2'));
  await assertFails(getDoc(doc(db, 'classes/c1/keys/p2')));                 // 아직 작성 중
  await updateDoc(doc(db, 'classes/c1/answers/s1_p2'), { status: 'submitted', submittedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await assertSucceeds(getDoc(doc(db, 'classes/c1/keys/p2')));
  await assertFails(getDoc(doc(studentDb('s9'), 'classes/c1/keys/p2')));    // 참여하지 않은 사람
  await assertFails(getDocs(collection(db, 'answerKeys')));                   // 원본 정답 키는 교사만
});

test('자유 연습: 반의 문항당 시간과 같아야 하고, 그 시간이 지나면 제출 거부', async () => {
  await joined();
  await setClass({ mode: 'free', freeSeconds: 60, live: null });
  const db = studentDb('s1');
  await assertFails(setDoc(doc(db, 'classes/c1/answers/s1_p5'), newAnswer('s1', 'p5', 'free', 300)));
  await assertSucceeds(setDoc(doc(db, 'classes/c1/answers/s1_p5'), newAnswer('s1', 'p5', 'free', 60)));
  await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'classes/c1/answers/s1_p5'), { startedAt: Timestamp.fromMillis(Date.now() - 70000) }));
  await assertFails(updateDoc(doc(db, 'classes/c1/answers/s1_p5'), { status: 'submitted', submittedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});

test('아직 없는 내 답 문서는 구독(읽기)할 수 있고, 남의 것은 안 됨', async () => {
  await joined();
  await assertSucceeds(getDoc(doc(studentDb('s1'), 'classes/c1/answers/s1_p4')));
  await assertFails(getDoc(doc(studentDb('s2'), 'classes/c1/answers/s1_p4')));
});
