// 핵심 낱말 규칙 채점(즉시·무료, 참고용). DOM 에 의존하지 않는 순수 함수.
// keywords 의 각 항목은 '가|나' 처럼 대안을 가질 수 있고, 하나라도 들어 있으면 일치로 봅니다.
const norm = s => String(s || '').replace(/\s+/g, '');

export function kwHits(text, keywords) {
  const t = norm(text);
  return keywords.map(k => k.split('|').some(alt => alt && t.includes(norm(alt))));
}

/** 소문항 하나의 예상 점수: 채점 요소마다 (일치한 낱말 수 / 전체) × 배점 을 내림 */
export function kwSubScore(text, keySub) {
  if (!keySub) return null;
  if (!String(text || '').trim()) return 0;
  return keySub.rubric.reduce((sum, r) => {
    const hits = kwHits(text, r.keywords).filter(Boolean).length;
    return sum + Math.floor(r.points * hits / Math.max(1, r.keywords.length));
  }, 0);
}

/** 문항 전체 예상 점수 */
export function kwScore(texts, key) {
  if (!key) return null;
  return key.subs.reduce((sum, s, i) => sum + kwSubScore(texts?.[i], s), 0);
}
