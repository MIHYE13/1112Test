// 학생·교사 화면 공용 기능
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false)
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

export async function isClassServer() {
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 2500);
    const r = await fetch('api/ping', { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) return false;
    const j = await r.json(); return j.mode === 'class';
  } catch { return false; }
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// 핵심 낱말 일치: keywords 배열의 각 항목은 '가|나' 처럼 대안을 가질 수 있음
const norm = s => String(s || '').replace(/\s+/g, '');
export function kwHits(text, keywords) {
  const t = norm(text);
  return keywords.map(k => k.split('|').some(alt => alt && t.includes(norm(alt))));
}

// 서버 시각 보정
let skew = 0;
export function syncClock(serverNow) { if (serverNow) skew = serverNow - Date.now(); }
export const serverTime = () => Date.now() + skew;

// 실시간 알림: SSE, 끊기면 폴링으로 대체
export function listen(url, onMsg, pollFn) {
  let es, pollTimer, closed = false;
  const startPoll = () => { if (!pollTimer && pollFn) pollTimer = setInterval(pollFn, 5000); };
  const open = () => {
    if (closed) return;
    try { es = new EventSource(url); } catch { return startPoll(); }
    es.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch {} };
    es.onopen = () => { clearInterval(pollTimer); pollTimer = null; };
    es.onerror = () => { es.close(); startPoll(); setTimeout(open, 8000); };
  };
  open();
  return () => { closed = true; es && es.close(); clearInterval(pollTimer); };
}

export function materialBox(q) {
  return h('div', { class: 'material' }, q.material.map(line =>
    h('p', { class: /^\[|^※/.test(line) ? 'mat-head' : '' }, line)));
}

export const STATUS = { draft: '작성 중', submitted: '제출', timeout: '시간 종료', none: '미제출' };

export function toast(msg, ms = 2500) {
  let t = $('#toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}
