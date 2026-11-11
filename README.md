# 서술형 연습 웹앱 v2 — 5-2 과학 「열과 우리 생활」

> 개발 중(0단계: 폴더 구조·설계 문서). 설계는 [develop.md](develop.md), 개발 규칙은 [agent.md](agent.md)를 보세요.

- 화면 코드: GitHub `public/` → **Netlify** 자동 배포
- 백엔드: **Firebase** (Authentication, Firestore)
- 자동채점: **Gemini API** (Netlify 함수에서만 호출)
- 비밀 키: `.env`(내 PC) / Netlify 환경변수 — 저장소에 올리지 않음. 필요한 이름은 [.env.example](.env.example)

이전 버전(교사 PC 서버 + GitHub Pages 혼자 연습)은 git 태그 `v1-local-server`에 있습니다.
