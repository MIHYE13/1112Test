# 테스트

- `firestore.rules.test.mjs`: Firebase 에뮬레이터에서 보안 규칙 검사(학생은 자기 답만, 마감 후 제출 거부 등) — 2단계
- `keyword-grade.test.mjs`: 낱말 규칙 채점 단위 검사 — 4단계
- `grade.function.test.mjs`: Gemini 응답 형식 검증(실제 API 대신 가짜 응답) — 4단계

실행: `npm run emulators` 를 켠 상태에서 `npm test`
