# develop.md — 서술형 연습 웹앱 v2 개발 설계

5학년 2학기 과학 「열과 우리 생활」 서술형 연습 문항 8개를 학생과 함께 풀고, 교사가 반별·문항별로 답을 실시간으로 확인합니다. 학생 답은 **1인 / 모둠 / 전체** 단위로 골라 보여 주고, 교사가 **[피드백] 버튼**을 누르면 그 학생의 답이 채점되어 점수와 피드백이 부여됩니다.

- 저장소: https://github.com/MIHYE13/1112Test
- 이전 버전(교사 PC 서버 + GitHub Pages): git 태그 `v1-local-server`에 보관되어 있습니다.

---

## 1. 구성 한눈에 보기

```
 ┌──────────── GitHub (코드 저장소) ────────────┐
 │ public/ 화면 · netlify/functions/ 채점 함수  │
 │ data/answer-keys.json 정답 키 · 규칙 파일    │
 └──────────────┬──────────────────────────────┘
                │ main 브랜치에 push 하면 자동 배포
 ┌──────────────▼──────── Netlify ──────────────┐
 │ 정적 화면(public/)  ←  학생·교사 브라우저     │
 │ Functions: grade (Gemini 자동채점)            │
 │ 환경변수: GEMINI_API_KEY, 서비스 계정 등      │
 └───────┬──────────────────────────┬───────────┘
         │ Admin SDK                │ Gemini API
 ┌───────▼──────── Firebase ────────┐  ┌───────▼──────┐
 │ Authentication: 학생 익명 /      │  │ Google Gemini │
 │                 교사 Google      │  │ (답 글만 전송) │
 │ Firestore: 반·진행 상태·답·점수  │  └──────────────┘
 │ 실시간 구독(onSnapshot)          │
 └──────────────────────────────────┘
```

| 역할 | 담당 | 하는 일 |
|---|---|---|
| 프런트엔드 코드 | GitHub `public/` | 학생 화면, 교사 화면, 문항(정답 없는 판) |
| 배포 | Netlify | GitHub와 연결해 자동 배포. 빌드 때 환경변수를 설정 파일로 주입합니다. 채점 함수를 실행합니다. |
| 백엔드 | Firebase | 로그인, 데이터베이스(Firestore), 실시간 반영, 보안 규칙 |
| 자동채점 | Gemini API | Netlify 함수에서만 호출합니다. 키는 브라우저로 가지 않습니다. |

## 2. 폴더 구조

```
서술형연습웹앱/                     (GitHub: MIHYE13/1112Test)
├─ develop.md                     이 문서 — 설계·단계·결정 사항
├─ agent.md                       AI 개발 도우미 작업 규칙
├─ README.md                      설치·실행·배포 안내
├─ .gitignore                     .env, 서비스 계정, 생성 파일 제외
├─ .env.example                   필요한 환경변수 이름(값 없음)
├─ netlify.toml                   빌드 명령·게시 폴더·함수 폴더·보안 헤더
├─ package.json                   npm 스크립트(build, dev, emulators, test)
├─ firebase.json                  Firestore 규칙 배포·에뮬레이터 설정
├─ firestore.rules                보안 규칙(지금은 전부 차단)
├─ firestore.indexes.json         색인
│
├─ public/                        ◀ Netlify 게시 폴더 = 브라우저가 받는 파일
│  ├─ index.html                  학생 화면
│  ├─ teacher.html                교사 화면
│  ├─ css/style.css
│  ├─ js/
│  │  ├─ firebase.js              Firebase 초기화·로그인
│  │  ├─ firebase-config.js       (빌드 때 생성, Git 제외)
│  │  ├─ common.js                공용 기능(시간, 화면 도우미)
│  │  ├─ student.js               학생 화면 동작
│  │  ├─ teacher.js               교사 화면 동작
│  │  └─ keyword-grade.js         핵심 낱말 규칙 채점
│  └─ data/questions.json         학생용 문항(정답·채점 기준 없음)
│
├─ netlify/functions/
│  └─ grade.mjs                   Gemini 자동채점 서버 함수
├─ data/
│  └─ answer-keys.json            정답·채점 기준·핵심 낱말(브라우저에 직접 배포하지 않음)
├─ scripts/
│  ├─ build-config.mjs            환경변수 → public/js/firebase-config.js
│  └─ upload-keys.mjs             (선택) 정답 키를 Firestore에 올림
└─ tests/                         보안 규칙·채점 테스트
```

현재 `public/js/student.js`, `teacher.js`는 v1(교사 PC 서버) 코드를 옮겨 둔 상태입니다. 2단계에서 Firestore를 쓰도록 바꿉니다.

## 3. 비밀 값 관리

| 값 | 비밀인가 | 어디에 두나 | 브라우저로 가나 |
|---|---|---|---|
| `GEMINI_API_KEY` | **비밀** | Netlify 환경변수 / 내 PC `.env` | **절대 안 감**(함수에서만 사용) |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | **비밀** | Netlify 환경변수 / 내 PC `.env` | **절대 안 감** |
| `GEMINI_MODEL` | 일반 설정 | Netlify 환경변수 / `.env` | 안 감 |
| `TEACHER_EMAILS` | 일반 설정 | Netlify 환경변수 / `.env` + Firestore `config/access` | 안 감 |
| `FIREBASE_API_KEY` 등 웹 설정 | 공개용 값(비밀 아님) | Netlify 환경변수 → 빌드 때 `firebase-config.js` 생성 | 감 |

- Firebase 웹 설정은 원래 브라우저에 공개되는 값입니다. 보안은 **Firestore 보안 규칙**으로 지킵니다. 그래도 저장소에는 넣지 않고 빌드 때 주입합니다.
- `.env`, `*service-account*.json`, `public/js/firebase-config.js`는 `.gitignore`로 제외되어 있습니다.
- 키를 바꾸려면 Netlify 환경변수만 수정하고 다시 배포합니다. 코드는 바꿀 필요가 없습니다.

## 4. 사용자와 로그인

| 사용자 | 로그인 방법 | 할 수 있는 일 |
|---|---|---|
| 학생 | **익명 로그인** + 반 고르기(첫 화면 반 버튼 또는 반 바로가기 링크) + 번호·모둠 | 자기 답 쓰기·제출, 공개된 정답·점수 보기, 공유된 친구 답 보기 |
| 교사 | **Google 로그인**, `TEACHER_EMAILS`에 있는 계정만 | 반 만들기, 진행, 모든 답 보기, 채점, 공유 |

- 학생 기기가 바뀌면 익명 계정도 새로 만들어집니다. 같은 반·번호로 다시 참여하면 교사 화면에서 [이어 쓰기 허용]을 눌러 이전 기록에 연결합니다.

## 5. 데이터 구조 (Firestore)

```
config/access                       { teacherEmails: [...] }   교사 허용 목록
classes/{classId}                   반
  ownerUid, name("5-2"), code("K7P2QX"), createdAt
  mode: "live" | "free"             진행 방식
  freeSeconds: 0~300                자유 연습 문항당 제한 시간
  revealPolicy: "submit" | "teacher"
  live: { qid, seconds, startedAt, endsAt, closed, revealed } | null
  revealed: [qid...]                정답 공개된 문항
  share: { [qid]: { on, mode: "anon"|"number", picked: [answerId...] | null } }
  groupCount: 1~6                   이 반의 모둠 수(반마다 다름)
  feedbackPublish: "auto" | "review" [피드백] 결과를 바로 공개할지, 교사 확인 후 공개할지
classCodes/{code}                   { classId }  (내부용 반 코드 — 학생 화면에서는 쓰지 않음)
classes/{classId}/numbers/{number}  { uid }   한 번호에 한 학생(중복 참여 방지)
classes/{classId}/students/{uid}    { number, group, joinedAt, lastSeen }   group: 학생이 참여할 때 직접 고름, 이후에는 교사만 수정
classes/{classId}/answers/{uid_qid} { uid, number, qid, texts[], status, startedAt, endsAt,
                                      submittedAt, elapsed, self[] }
classes/{classId}/grades/{uid_qid}  { subs: [{ score, feedback, source }], total, overall,
                                      kwScore, ai: { model, at, status }, published, publishedAt }
answerKeys/{qid}                    정답 키 원본(교사만 읽고 씀) — 교사 화면에서 data/answer-keys.json 을 한 번 올림
classes/{classId}/keys/{qid}        반별 정답 키 사본. 학생은 정답 공개 문항, 또는 '제출 즉시' 반에서 자기 답 제출 뒤에만 읽음
classes/{classId}/shows/{showId}    답 보여주기(8장)
  { qid, sub(0=전체 소문항|1~n), scope: "one"|"group"|"all",
    audience: "class"|"ownGroup",   반 전체에게 / 각 모둠은 자기 모둠 답만
    group: 1~6 | null, label: "anon"|"number",
    items: [{ label, group, texts[], mine? }], createdAt, updatedAt, active }
```

### 보안 규칙 요점
- 학생은 자기 `answers/{uid_qid}`만 만들고 고칠 수 있습니다. 제출한 뒤에는 수정할 수 없습니다.
- 제출 시각은 규칙에서 `request.time <= endsAt + 5초`로 검사합니다. 마감 뒤 제출은 서버가 거부합니다.
- 학생은 다른 학생의 `answers`를 읽을 수 없습니다. 친구 답은 교사가 만든 `shows/{showId}`로만 봅니다.
- `audience: "ownGroup"`인 보여주기는 규칙에서 `students/{uid}.group`과 같은 모둠의 문서만 읽게 합니다(모둠별로 문서를 나눠 저장).
- 학생은 참여할 때 번호와 모둠(1~모둠 수)을 직접 고릅니다. 참여한 뒤 모둠은 교사만 바꿀 수 있습니다.
- `grades`는 교사와 채점 함수(Admin SDK)만 씁니다. 학생은 `published == true`인 자기 점수만 읽습니다.
- `keys/{qid}`는 정답이 공개된 문항만 존재하므로, 공개 전에는 학생이 정답을 받을 수 없습니다.
- 글자 수 제한(소문항당 2,000자), 허용 필드 목록(`hasOnly`), 점수 범위를 규칙으로 검사합니다.

## 6. 화면과 기능 (v1 기능 유지 + 추가)

| 기능 | 내용 |
|---|---|
| 실시간 진행 | 교사가 문항과 시간(1~5분)을 정해 [시작] → 학생 화면에 문항과 카운트다운 → 시간이 끝나면 쓰던 답 자동 제출 |
| 자유 연습 | 학생이 문항을 고름. 문항당 제한 시간은 교사가 정함 |
| 정답 공개 | 제출 즉시 공개 또는 교사가 공개할 때. 공개 후 예시 답안과 자기 점검 체크 |
| 반별·문항별 보기 | 학생 × 소문항 표, 소문항별 답 모아 보기, 반 전체 현황, 이름 가리기, 큰 화면, CSV |
| **모둠(신규)** | 교사는 반마다 모둠 수(1~6)만 정합니다. **학생이 참여할 때 자기 번호와 모둠을 입력하고 시작**합니다. 잘못 고른 학생은 교사가 옮깁니다. |
| **답 보여주기: 1인 / 모둠 / 전체(신규)** | 8장 |
| **[피드백] 버튼: 개인 채점·점수 부여(신규)** | 7-1, 7-2 |
| 일괄 자동채점 | 7장 |

시간은 Firestore 서버 시각 기준입니다. 학생 기기는 참여할 때 서버 시각과의 차이를 계산해 카운트다운을 보정합니다.

## 7. 자동채점

### 7-1. 채점 방법
| 방법 | 내용 | 시점 | 비용 |
|---|---|---|---|
| ① 낱말 규칙 채점 | `keyword-grade.js`가 채점 기준의 핵심 낱말 일치 정도로 예상 점수를 계산 | 교사 화면에서 즉시(참고용) | 무료 |
| ② **[피드백] 버튼(개인)** | 교사가 학생 한 명의 답 옆 [피드백]을 누르면 그 답을 Gemini로 채점해 **소문항별 점수 + 피드백**을 부여 | 교사가 누를 때 | API 사용료(답 1개분) |
| ③ 일괄 채점 | 문항 단위로 [모두 피드백]을 누르면 아직 채점하지 않은 답을 차례로 ②와 같이 처리 | 교사가 누를 때 | 답 수만큼 |

### 7-1-1. [피드백] 버튼 동작
1. 교사 화면 문항별 보기의 학생 행(또는 답 카드)마다 **[피드백]** 버튼이 있습니다. 제출한 답에만 활성화됩니다.
2. 누르면 버튼이 ‘채점 중…’으로 바뀌고, `grade` 함수가 그 학생의 답 1개를 채점합니다.
3. 결과가 오면 소문항별 점수 칸, 합계, 피드백 칸이 채워집니다(`source: "ai"`).
4. 반 설정 `feedbackPublish`에 따라 처리합니다.
   - `"auto"`(기본): 바로 학생에게 공개됩니다. 학생 화면에 “선생님 피드백이 도착했어요”가 뜨고 점수와 피드백이 보입니다.
   - `"review"`: 교사 화면에만 초안으로 보이고, 교사가 [보내기]를 눌러야 공개됩니다.
5. 교사는 공개 뒤에도 점수와 피드백을 직접 고칠 수 있습니다(`source: "teacher"`). 고친 내용은 학생 화면에 바로 반영됩니다.
6. 다시 [피드백]을 누르면 새로 채점하되, 교사가 직접 고친 소문항 점수는 덮어쓰지 않습니다.
7. 실패하면 버튼에 ‘다시 시도’가 표시되고, 다른 학생 채점에는 영향을 주지 않습니다.

- 점수 출처는 `source: "keyword" | "ai" | "teacher"`로 남깁니다.

### 7-2. 채점 함수 흐름 (`netlify/functions/grade.mjs`)
1. 교사 브라우저가 Firebase ID 토큰을 붙여 `POST /.netlify/functions/grade { classId, qid, answerIds[] }`를 보냅니다. [피드백] 버튼은 `answerIds`에 1개, [모두 피드백]은 여러 개를 담습니다.
2. 함수가 Admin SDK로 토큰을 확인하고, 교사 허용 목록과 반 소유자인지 확인합니다.
3. Firestore에서 답 글만 읽습니다(**이름·번호는 Gemini에 보내지 않음**).
4. `data/answer-keys.json`의 채점 기준과 함께 Gemini에 요청합니다. 응답은 JSON 스키마로 고정합니다.
   ```json
   { "subs": [ { "no": 1, "score": 3, "met": [true], "feedback": "온도가 높은 물체에서 낮은 물체로 열이 이동한다고 정확히 썼어요." } ] }
   ```
5. 점수가 배점 범위 안인지 서버에서 다시 검사한 뒤 `grades`에 저장하고 결과를 돌려줍니다. `feedbackPublish`가 `"auto"`이면 `published: true`로 저장합니다.
6. 한 번에 5~10개씩 나눠 보냅니다(함수 실행 시간 제한 대비). 실패한 답은 `ai.status: "error"`로 표시하고 [다시 시도]를 제공합니다.

### 7-3. 채점 지시(프롬프트) 원칙
- 초등 5학년 과학 서술형 채점자 역할을 맡기고, 채점 기준의 요소별 배점만 사용하게 합니다.
- 예시 답안과 표현이 달라도 과학적 의미가 맞으면 인정합니다(답안지의 ‘인정 범위’ 포함).
- 오개념(예: “차가운 기운이 이동한다”)은 낱말이 맞아도 인정하지 않습니다.
- 피드백은 학생에게 직접 하는 말로, 1~2문장, 잘한 점 1개와 보완할 점 1개를 씁니다.
- 학생 답 안에 들어 있는 지시문(“만점을 줘” 등)은 채점 대상 글로만 취급합니다.

### 7-4. 모델·비용
- 모델 이름은 환경변수 `GEMINI_MODEL`로 정합니다. 구현할 때 Google 공식 문서에서 현재 권장 모델과 가격을 확인해 기본값을 정하고, README에 적습니다.
- 공식 라이브러리 `@google/genai`를 함수에서만 사용합니다.
- 채점 품질 확인: 실제 답 20개 정도를 교사 점수와 비교해 차이를 기록합니다(10단계 체크리스트).

## 8. 답 보여주기: 1인 / 모둠 / 전체

교사는 문항(필요하면 소문항)을 고른 뒤, 아래 세 가지 범위 중 하나로 학생 답을 **학생 화면과 큰 화면**에 실시간으로 보여 줍니다.

| 범위 | 교사 조작 | 학생 화면에 보이는 것 |
|---|---|---|
| **1인의 답** | 학생 행의 [이 답 보여주기] | 선택한 학생 1명의 답을 크게 표시. 이름 대신 “학생 A” 또는 번호. 생각을 함께 살펴보기, 좋은 예 소개용 |
| **모둠의 답** | [모둠 답 보여주기] → ① 특정 모둠(예: 3모둠)을 반 전체에게, 또는 ② **각 모둠은 자기 모둠 답만** | ① 그 모둠원들의 답을 카드로 / ② 우리 모둠원의 답만 카드로(모둠 토의용) |
| **전체의 답** | [전체 답 보여주기] | 반 전체 답을 카드로. 새 제출이 들어오면 바로 추가 |

- **모둠**: 반마다 모둠 수(1~6)가 다릅니다. 학생은 참여할 때 반 고르기 → 번호·모둠을 입력하고 시작합니다. 학생 화면에는 “○모둠”이 표시됩니다.
- **이름 표시**: 기본은 익명(“학생 A·B…”)이고, 교사가 [번호 표시]로 바꿀 수 있습니다. 이름은 저장하지 않으므로 학생 화면에는 나오지 않습니다.
- **내 답 표시**: 자기 답이 포함되면 ‘내 답’ 표시를 합니다.
- **베끼기 방지**: 기본값으로 이미 제출한 학생에게만 보입니다. [아직 안 낸 학생에게도 보이기]로 바꿀 수 있습니다.
- **동작 방식**: 교사 화면이 `shows/{showId}` 문서를 만들고, 열려 있는 동안 새 제출을 반영해 갱신합니다. 학생 화면은 onSnapshot으로 즉시 표시합니다. ②번(자기 모둠만)은 모둠별 문서를 따로 만들고, 규칙이 자기 모둠 문서만 읽게 합니다.
- [보여주기 끝]을 누르면 문서를 비활성화해 학생 화면에서 즉시 사라집니다. 한 번에 하나의 보여주기만 켜집니다.
- 큰 화면 모드에서도 같은 내용을 크게 보여 줍니다.

## 9. 개발·배포 절차

### 9-1. 준비물 (교사 PC)
- Node.js 20 이상(설치됨), Netlify CLI(`netlify-cli`), Firebase CLI(`firebase-tools`)
- 계정: GitHub(MIHYE13), Firebase(Google 계정), Netlify(GitHub로 로그인), Google AI Studio(Gemini 키)

### 9-2. 개발 명령
| 명령 | 하는 일 |
|---|---|
| `npm install` | 개발 도구 설치(firebase-tools, 규칙 테스트 라이브러리) |
| `npm run emulators` | Firebase 에뮬레이터(Auth 9099·Firestore 8085·UI 4000)를 내 PC에서 실행. 실제 데이터에 영향 없음. **Java 21 필요**(설치됨: Microsoft OpenJDK 21) |
| `npm run seed` | 에뮬레이터에 교사 허용 목록(config/access)과 정답 키(answerKeys) 넣기 — `.env`의 `TEACHER_EMAILS`, 없으면 `teacher@example.com` |
| `npm run build` | `public/js/firebase-config.js`를 `.env`(실제 Firebase) 값으로 생성(Netlify가 배포 때 자동 실행) |
| `npm run build:emu` | 같은 파일을 에뮬레이터(`demo-seosul`)용으로 생성 — 내 PC 개발·테스트 때 |
| `npm run dev` | `netlify dev`: 화면과 함수를 `.env` 값으로 내 PC에서 실행 |
| `npm test` | 에뮬레이터를 잠시 켜서 보안 규칙 테스트 실행 |

에뮬레이터에서 교사로 로그인할 때는 Google 로그인 창에서 [Add new account] → 이메일에 `teacher@example.com`을 넣습니다. 학생 화면은 교사와 다른 주소(예: 교사 `127.0.0.1`, 학생 `localhost`)나 다른 브라우저로 열어야 로그인이 섞이지 않습니다.

### 9-3. 배포
1. Firebase 콘솔: 프로젝트 → Authentication(익명, Google) 사용 → Firestore 생성(서울 `asia-northeast3`) → 웹 앱 등록 → 서비스 계정 키 발급
2. `firebase deploy --only firestore:rules,firestore:indexes` (교사 PC에서)
3. Netlify: GitHub 저장소 연결 → 환경변수 입력(`.env.example`의 이름 그대로) → 배포
4. Firebase Authentication → 승인된 도메인에 Netlify 주소(`*.netlify.app`) 추가
5. 학생 기기 1~2대로 실제 리허설

## 10. 단계별 계획

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| 0 | 폴더 구조·develop.md·agent.md | 완료 |
| 1 | Firebase 연결, 로그인(학생 익명·교사 Google), 반 만들기·반 코드 참여(학생이 번호·모둠 입력), 모둠 고치기, 명렬표(교사 브라우저) | **완료(2026-11-12)** — 규칙 테스트 11개 통과, 에뮬레이터 화면 확인 |
| 2 | 답 저장·보안 규칙(마감 시각 서버 검사), 실시간 진행·자유 연습, 1~5분·연장·마감·자동 제출, 정답 공개·자기 점검, 문항별·반 전체 보기, 낱말 예상 점수, CSV, 큰 화면, 정답 키 | **완료(2026-11-12)** — 규칙 테스트 19개 통과, 에뮬레이터에서 시작→작성→자동 제출→정답 공개→자기 점검·자유 연습 확인 |
| 3 | Netlify 배포, 환경변수 주입 | 배포 주소에서 학생 2명·교사 1명 동시 테스트 — **진행 중**: 규칙 배포·허용 목록·정답 키·Netlify 배포·승인 도메인 완료, Google 로그인 사용 설정(콘솔) 후 교사 테스트 남음 |
| 4 | 채점: 낱말 규칙 → [피드백] 버튼(개인 Gemini 채점·점수 부여) → [모두 피드백] | 학생 1명 [피드백]으로 점수·피드백이 학생 화면에 도착, 교사 수정 반영 |
| 5 | 답 보여주기: 1인 / 모둠(반 전체에게·자기 모둠만) / 전체 | 세 범위 모두 학생 화면·큰 화면에 실시간 표시, 끄기 동작 |
| 6 | 마무리: README, CSV, 큰 화면, 오류 문구 | 수업 리허설 완료 |

## 배포 정보 (2026-11-12)

| 항목 | 값 |
|---|---|
| 학생 주소 | https://1112test-seosul.netlify.app/ |
| 교사 주소 | https://1112test-seosul.netlify.app/teacher.html |
| Netlify 사이트 | `1112test-seosul` (GitHub `MIHYE13/1112Test` main 브랜치 자동 배포) |
| Firebase 프로젝트 | `mychatbot1-d4ff5` (웹 앱 `1112test`), Firestore `(default)` |
| 교사 허용 목록 | `config/access` — `node scripts/upload-keys.mjs <소유자 이메일>` 로 `.env`의 TEACHER_EMAILS와 정답 키를 올림 |
| Gemini 모델 | `gemini-3.5-flash-lite` (저렴한 Flash-Lite 등급. 서술형 채점 시험 호출 약 110토큰·2초) |

- 기존 Firestore 규칙은 2025-12-17에 만료된 테스트 모드 규칙(모든 접근 차단 상태)이어서 이 앱의 규칙으로 바꿨습니다.

## 11. 정한 사항 (2026-11-12, 제안대로 진행)

- **반 코드 입력 삭제**: 학생은 첫 화면에서 반 이름 버튼을 누르거나, 교사가 준 반 바로가기 링크·QR(`?c=반ID`)로 바로 번호·모둠 입력 화면에 들어갑니다. 이를 위해 로그인한 사용자는 반 목록을 읽을 수 있습니다(반 이름·진행 상태만 있고 개인정보 없음).

- 학생 이름은 Firebase·Gemini에 저장하지 않고 **번호만 저장**합니다(이름은 교사 브라우저의 명렬표에서만 표시).
- Firebase 프로젝트는 **새로 만듭니다**. 개발과 테스트는 먼저 에뮬레이터(`demo-seosul`)로 합니다.
- 교사 계정 이메일은 `.env`의 `TEACHER_EMAILS`에 선생님이 직접 입력합니다(저장소에는 넣지 않음).
- 연습 문항의 정답 키는 공개 저장소에 둡니다. 실전 문항은 비공개 저장소에서 다룹니다.
- Gemini는 무료 한도로 시작합니다.
- [피드백] 결과는 기본적으로 **바로 학생에게 공개**(`feedbackPublish: "auto"`)하고, 반 설정에서 ‘확인 후 공개’로 바꿀 수 있습니다.
- 모둠은 **학생이 참여할 때 자기 번호와 모둠을 입력**합니다(교사가 미리 배정하지 않음).
- 모둠 답 보여주기는 **특정 모둠을 반 전체에게**와 **각 모둠은 자기 모둠 답만** 두 방식을 모두 제공합니다.

## 12. 처음 검토한 질문 (참고)

| # | 질문 | 제안(기본값) |
|---|---|---|
| 1 | **학생 이름을 Firebase(구글 클라우드)에 저장할까요?** 이전에는 “개인정보는 내 PC에만” 원칙이었습니다. | **번호만 저장**합니다. 이름 명렬표는 교사 브라우저에만 저장(파일 불러오기)해 화면에서 번호 옆에 이름을 붙여 보여 줍니다. 이름은 Firebase·Gemini 어디에도 가지 않습니다. |
| 2 | Firebase 프로젝트를 새로 만들까요, 기존(`weather-test-db064`)을 쓸까요? | 새 프로젝트를 추천합니다(규칙·데이터가 섞이지 않음). |
| 3 | 교사 계정(Google 이메일)은? | 선생님 이메일 1개 |
| 4 | 정답 키 공개 범위 | 저장소가 공개라 `data/answer-keys.json`을 누구나 볼 수 있습니다. 연습 문항은 괜찮지만, 실전 문항을 넣을 때는 저장소를 비공개로 바꾸세요(Netlify는 비공개 저장소도 배포 가능). |
| 5 | Gemini 결제 | 무료 한도로 시작하고, 한 반 실제 사용량을 본 뒤 결정 |
