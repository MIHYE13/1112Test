// 실제 Firebase 에 교사 허용 목록(config/access)과 정답 키(answerKeys)를 올리는 관리 도구.
// 교사 PC에서만 실행합니다. Firebase CLI 에 로그인한 프로젝트 소유자 계정의 권한을 씁니다.
// 사용: node scripts/upload-keys.mjs <프로젝트 소유자 Google 이메일>
//   - 교사 이메일: .env 의 TEACHER_EMAILS
//   - 프로젝트: .env 의 FIREBASE_PROJECT_ID
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const env = {};
if (fs.existsSync('.env')) for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const project = env.FIREBASE_PROJECT_ID;
const owner = process.argv[2];
const emails = (env.TEACHER_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
if (!project || !owner || !emails.length) {
  console.error('사용: node scripts/upload-keys.mjs <소유자 이메일>  (.env 에 FIREBASE_PROJECT_ID, TEACHER_EMAILS 필요)');
  process.exit(1);
}

const auth = require(path.resolve('node_modules/firebase-tools/lib/auth'));
const acct = auth.getAllAccounts().find(a => a.user.email === owner);
if (!acct) { console.error(`Firebase CLI 에 ${owner} 로 로그인되어 있지 않습니다. npx firebase login:add 를 먼저 하세요.`); process.exit(1); }
const { access_token } = await auth.getAccessToken(acct.tokens.refresh_token, []);

const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/`;
const fv = v => v === null ? { nullValue: null }
  : Array.isArray(v) ? { arrayValue: { values: v.map(fv) } }
  : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fv(x)])) } }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) };
async function put(docPath, data) {
  const r = await fetch(base + docPath, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + access_token },
    body: JSON.stringify({ fields: fv(data).mapValue.fields }),
  });
  if (!r.ok) throw new Error(`${docPath}: ${r.status} ${await r.text()}`);
}

await put('config/access', { teacherEmails: emails });
const keys = JSON.parse(fs.readFileSync('data/answer-keys.json', 'utf8'));
for (const q of keys.questions) await put(`answerKeys/${q.id}`, { accept: q.accept, subs: q.subs });
console.log(`완료: 프로젝트 ${project} / 교사 ${emails.length}명 / 정답 키 ${keys.questions.length}개`);
