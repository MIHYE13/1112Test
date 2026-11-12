// 에뮬레이터 전용: 교사 허용 목록(config/access)과 정답 키(answerKeys)를 넣습니다. 실제 Firebase 에는 쓰지 않습니다.
// 사용: npm run emulators 를 켠 상태에서 npm run seed
// 교사 이메일은 .env 의 TEACHER_EMAILS, 없으면 teacher@example.com
import fs from 'node:fs';

if (fs.existsSync('.env')) for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*TEACHER_EMAILS\s*=\s*(.*)$/); if (m && !process.env.TEACHER_EMAILS) process.env.TEACHER_EMAILS = m[1].trim();
}
const emails = (process.env.TEACHER_EMAILS || 'teacher@example.com').split(',').map(s => s.trim()).filter(Boolean);
const base = 'http://127.0.0.1:8085/v1/projects/demo-seosul/databases/(default)/documents/';

// JS 값 → Firestore REST 값
const fv = v => v === null ? { nullValue: null }
  : Array.isArray(v) ? { arrayValue: { values: v.map(fv) } }
  : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fv(x)])) } }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) };

async function put(path, data) {
  const r = await fetch(base + path, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: fv(data).mapValue.fields }),
  });
  if (!r.ok) { console.error('에뮬레이터에 쓰지 못했습니다. npm run emulators 가 켜져 있는지 확인하세요.', r.status, await r.text()); process.exit(1); }
}

await put('config/access', { teacherEmails: emails });
const keys = JSON.parse(fs.readFileSync('data/answer-keys.json', 'utf8'));
for (const q of keys.questions) await put(`answerKeys/${q.id}`, { accept: q.accept, subs: q.subs });
console.log('교사 허용 목록(에뮬레이터):', emails.join(', '), `/ 정답 키 ${keys.questions.length}개`);
