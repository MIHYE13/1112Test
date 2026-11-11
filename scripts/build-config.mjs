// 빌드 단계: 환경변수(.env 또는 Netlify 환경변수)의 Firebase 웹 설정을
// public/js/firebase-config.js 로 만듭니다. 이 파일은 .gitignore 로 GitHub에 올라가지 않습니다.
// 비밀 값(GEMINI_API_KEY, FIREBASE_SERVICE_ACCOUNT_BASE64)은 여기서 절대 읽거나 쓰지 않습니다.
//
// USE_EMULATOR=1 이거나 FIREBASE_PROJECT_ID 가 비어 있으면 에뮬레이터(demo-seosul) 설정을 만듭니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env 읽기 (이미 설정된 환경변수가 우선)
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;
const useEmulator = env.USE_EMULATOR === '1' || !env.FIREBASE_PROJECT_ID;

const config = useEmulator
  ? {
      useEmulator: true,
      firebase: { apiKey: 'demo-key', authDomain: 'demo-seosul.firebaseapp.com', projectId: 'demo-seosul', appId: 'demo-app' },
      emulator: { authUrl: 'http://127.0.0.1:9099', firestoreHost: '127.0.0.1', firestorePort: 8085 },
    }
  : {
      useEmulator: false,
      firebase: {
        apiKey: env.FIREBASE_API_KEY,
        authDomain: env.FIREBASE_AUTH_DOMAIN,
        projectId: env.FIREBASE_PROJECT_ID,
        appId: env.FIREBASE_APP_ID,
      },
    };

if (!useEmulator) {
  const missing = ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID', 'FIREBASE_APP_ID'].filter(k => !env[k]);
  if (missing.length) { console.error('Firebase 설정 환경변수가 비어 있습니다: ' + missing.join(', ')); process.exit(1); }
}

const out = path.join(root, 'public', 'js', 'firebase-config.js');
fs.writeFileSync(out, `// 자동 생성 파일(scripts/build-config.mjs). 직접 고치지 말고 커밋하지 마세요.\nexport default ${JSON.stringify(config, null, 2)};\n`);
console.log(`firebase-config.js 생성 완료 (${useEmulator ? '에뮬레이터 demo-seosul' : '프로젝트 ' + config.firebase.projectId})`);
