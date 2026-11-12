// 학생·교사 화면 공용 기능
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false)
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// ---------- 서버 시각 보정 ----------
// serverTimestamp 로 쓴 값을 다시 읽었을 때 (서버 시각 - 내 시계) 차이를 기억
let skew = 0;
export function syncFromServerTime(ts) { if (ts?.toMillis) skew = ts.toMillis() - Date.now(); }
export const serverNow = () => Date.now() + skew;
const ms = ts => (ts?.toMillis ? ts.toMillis() : null);

/** 답 또는 반 진행 상태로 마감 시각(ms)을 계산. 제한 시간이 없으면 null */
export function deadlineOf(cls, ans) {
  const mode = ans?.mode || cls?.mode;
  if (mode === 'live') {
    const L = cls?.live;
    if (!L || (ans && L.qid !== ans.qid)) return ans ? ms(ans.startedAt) : null; // 이미 끝난 문항
    if (L.closed) return ms(L.closedAt) ?? 0;
    const s = ms(L.startedAt); return s === null ? null : s + L.seconds * 1000;
  }
  if (!ans || !ans.seconds) return null;
  const s = ms(ans.startedAt); return s === null ? null : s + ans.seconds * 1000;
}
export function liveOpen(cls) {
  const L = cls?.live; if (!L || L.closed) return false;
  const s = ms(L.startedAt); return s === null || serverNow() <= s + L.seconds * 1000;
}

// ---------- 문항 ----------
let qcache = null;
export async function loadQuestions() {
  if (!qcache) qcache = (await (await fetch('data/questions.json', { cache: 'no-cache' })).json()).questions;
  return qcache;
}
export const QIDS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

export function materialBox(q) {
  return h('div', { class: 'material' }, q.material.map(line =>
    h('p', { class: /^\[|^※/.test(line) ? 'mat-head' : '' }, line)));
}

export const STATUS = { draft: '작성 중', submitted: '제출', timeout: '시간 종료', none: '미제출' };
export const statusClass = st => (st === 'submitted' ? 'ok' : st || '');

export function toast(msg, t = 2500) {
  let el = $('#toast');
  if (!el) { el = h('div', { id: 'toast', role: 'status' }); document.body.append(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._h); el._h = setTimeout(() => el.classList.remove('show'), t);
}

/** 남은 시간 표시 요소를 만들고, 매 250ms 갱신. 끝나면 onEnd 1회 호출 */
export function timerView(getDeadline, total, onEnd) {
  const el = h('div', { class: 'timer' });
  let fired = false;
  const tick = () => {
    const d = getDeadline();
    if (d === null) { el.replaceChildren(h('span', { class: 'muted' }, '제한 시간 없음')); return; }
    const r = (d - serverNow()) / 1000;
    el.className = 'timer' + (r <= 10 ? ' danger' : r <= 30 ? ' warn' : '');
    el.replaceChildren(h('div', { class: 'num' }, fmtTime(r)),
      h('div', { class: 'bar' }, h('i', { style: `width:${total ? Math.max(0, Math.min(100, r / total * 100)) : 0}%` })));
    if (r <= 0 && !fired) { fired = true; onEnd && onEnd(); }
  };
  tick();
  el._iv = setInterval(tick, 250);
  return el;
}
