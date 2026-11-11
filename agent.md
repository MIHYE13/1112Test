# agent.md — AI 개발 도우미 작업 규칙

이 저장소에서 코드를 쓰는 AI 도우미(Claude Code 등)와 사람이 함께 지키는 규칙입니다. 설계는 [develop.md](develop.md)가 기준입니다. 이 문서와 develop.md가 다르면 develop.md를 따르고, 차이를 사용자에게 알립니다.

## 1. 프로젝트 요약
- 초등 5학년 2학기 과학 「열과 우리 생활」 서술형 연습 웹앱
- 사용자는 학생(태블릿·크롬북, 익명 로그인)과 교사(Google 로그인)입니다.
- 구성: GitHub 저장소 → Netlify 자동 배포(`public/` + `netlify/functions/`), Firebase(Auth·Firestore) 백엔드, Gemini 자동채점(Netlify 함수에서만)

## 2. 절대 규칙
1. **비밀 값을 코드·커밋·로그·화면에 넣지 않는다.** `GEMINI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_BASE64`는 `process.env`로만 읽는다. `.env`, 서비스 계정 JSON, `public/js/firebase-config.js`는 커밋하지 않는다(`.gitignore` 확인).
2. **Gemini는 브라우저에서 직접 부르지 않는다.** 반드시 `netlify/functions/grade.mjs`를 거친다.
3. **학생 이름·번호를 Gemini에 보내지 않는다.** 답 글과 문항·채점 기준만 보낸다. 학생 이름은 develop.md 11장 결정에 따른다(기본: Firebase에 저장하지 않음).
4. **보안 규칙을 느슨하게 만들지 않는다.** `allow read, write: if true`나 테스트 모드 규칙을 쓰지 않는다. 규칙을 바꾸면 `tests/`의 규칙 테스트를 함께 고치고 통과시킨다.
5. **학생 답을 다른 학생에게 보여 줄 때는 `shows` 문서로만 한다.** 이름은 넣지 않고(익명 또는 번호), ‘자기 모둠만’ 보여주기는 규칙으로 모둠을 검사한다.
6. **학생에게 정답을 미리 보내지 않는다.** `public/data/questions.json`에는 정답·채점 기준을 넣지 않는다. 정답은 `data/answer-keys.json`(함수용)과 공개 후의 `classes/{id}/keys/{qid}`에만 둔다.
7. **문항 내용(발문·배점·예시 답안)을 임의로 바꾸지 않는다.** 바꿔야 하면 사용자에게 먼저 묻는다.
8. **실제 Firebase·Gemini에 쓰는 작업(배포, 규칙 배포, 데이터 삭제, 유료 API 대량 호출)은 사용자 확인 후에 한다.** 개발과 테스트는 에뮬레이터와 가짜(mock) 응답으로 한다.
9. `git push`, 태그 삭제, 강제 푸시는 사용자가 요청할 때만 한다.

## 3. 폴더별 책임
| 경로 | 내용 | 주의 |
|---|---|---|
| `public/` | 브라우저가 받는 모든 파일 | 비밀 값 금지, 정답 금지 |
| `public/js/firebase.js` | Firebase 초기화·로그인 | 설정은 `firebase-config.js`에서만 읽기 |
| `public/js/keyword-grade.js` | 낱말 규칙 채점(순수 함수) | DOM에 의존하지 않게 작성해 테스트 가능하게 |
| `netlify/functions/` | 서버 함수(채점) | ID 토큰 확인 → 교사·반 소유 확인 → 처리 |
| `data/answer-keys.json` | 정답·채점 기준·핵심 낱말 | 함수와 교사용 도구만 사용 |
| `scripts/` | 빌드·운영 도구 | 비밀 값은 환경변수로만 |
| `firestore.rules` | 보안 규칙 | develop.md 5장과 일치 |
| `tests/` | 규칙·채점 테스트 | 에뮬레이터 사용 |

## 4. 코드 작성 방식
- 화면은 프레임워크 없이 HTML·CSS·ES 모듈(바닐라 JS)로 작성한다. 빌드 도구는 `scripts/build-config.mjs` 하나만 쓴다.
- Firebase 웹 SDK는 공식 CDN(`www.gstatic.com/firebasejs/<버전>/...`)의 모듈 버전을 **정확한 버전 번호로 고정**해 불러온다.
- 서버 함수는 Node 20 ES 모듈(`.mjs`), 공식 라이브러리 `firebase-admin`, `@google/genai`만 쓴다. 새 의존성을 추가하면 이유를 커밋 메시지에 적는다.
- Gemini 응답은 JSON 스키마로 받고, 서버에서 점수 범위와 필드를 다시 검사한 뒤 저장한다. 형식이 틀리면 저장하지 않고 `ai.status: "error"`로 둔다.
- 시간 계산은 Firestore 서버 시각(`serverTimestamp`, 규칙의 `request.time`)을 기준으로 한다.
- 오류는 학생에게 쉬운 한국어로 보여 준다(예: “인터넷 연결을 확인하고 다시 눌러 주세요.”). 개발용 상세 오류는 콘솔에만 남긴다.

## 5. 화면 문구·접근성
- 대상은 초등 5학년이다. 짧은 문장과 존댓말 해요체를 쓰고, 영어 약어는 쓰지 않는다.
- 글자 크기는 학생 화면 기본 17px 이상, 버튼 높이는 44px 이상, 휴대폰 너비(375px)에서 가로 스크롤이 생기지 않게 한다.
- 색으로만 상태를 구분하지 않는다(글자 표시 함께).
- 교사 화면에서 학생 이름은 ‘이름 가리기’ 기능을 항상 지원한다.

## 6. 테스트와 완료 기준
작업을 끝냈다고 말하기 전에:
1. `npm test`(에뮬레이터 실행 상태)로 규칙·채점 테스트를 통과한다.
2. `npm run dev`로 학생 2명·교사 1명 흐름을 직접 확인한다: 참여(번호·모둠 입력) → 시작 → 입력 → 자동 제출 → 정답 공개 → [피드백](개인 채점·점수) → 답 보여주기(1인·모둠·전체).
3. 휴대폰 너비 화면을 확인한다.
4. `git status`에 비밀 파일이 없는지 확인한다.
5. 확인하지 못한 부분(예: 실제 Gemini 호출, 실제 학교 와이파이)은 “확인하지 못함”으로 분명히 보고한다.

## 7. 커밋 규칙
- 한 커밋에는 한 가지 목적만 담는다. 메시지는 한국어로 쓴다. 예: `2단계: 학생 답 저장 규칙과 테스트 추가`
- develop.md의 단계 번호를 메시지 앞에 붙인다.
- 커밋 전에 `git diff --cached`로 비밀 값이 없는지 확인한다.

## 8. 도움말
- 설계·데이터 구조·보안 규칙: develop.md 5장
- 자동채점·[피드백] 버튼(개인 채점·점수 부여): develop.md 7장
- 답 보여주기(1인 / 모둠 / 전체)·모둠 관리: develop.md 6·8장
- 이전 버전 코드: `git checkout v1-local-server`
