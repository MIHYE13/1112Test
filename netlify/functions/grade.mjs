// Gemini 자동채점 서버 함수 (POST /.netlify/functions/grade)
// 1) 요청의 Firebase ID 토큰으로 교사인지 확인
// 2) Firestore 에서 학생 답(번호·이름 제외)을 읽고 data/answer-keys.json 의 채점 기준과 함께 Gemini 에 보냄
// 3) 소문항별 점수·피드백(JSON)을 grades 에 '초안'으로 저장
// 키: process.env.GEMINI_API_KEY, process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 (브라우저로 전달 금지)
// 구현: 4단계(develop.md 7장)
export default async () => new Response(JSON.stringify({ error: '아직 구현되지 않았습니다.' }), { status: 501, headers: { 'Content-Type': 'application/json' } });
