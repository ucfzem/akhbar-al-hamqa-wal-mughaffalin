/* ===== أخبار الحمقى والمغفلين — app.js ===== */
'use strict';
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

const KEY = { pos: 'hamqa_pos', theme: 'hamqa_theme', font: 'hamqa_fontsize' };

const state = {
  chapters: [],
  curId: 1,
  q: '',
  re: null,
  hitIndex: -1,
  results: {},        // chapterId -> occurrence count
  hitChapters: [],    // ordered chapter ids that contain the query
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const isMobile = () => window.innerWidth < 900;

/* ---------- Secours ---------- */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/* مطابقة تتجاوز التشكيل واختلاف الهمزات */
function tolerantRegex(q) {
  const D = '[\\u064B-\\u065F\\u0670\\u06D6-\\u06ED]*';
  const parts = [...q].map((ch) => {
    let e = ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    e = e.replace(/[أإآٱا]/g, '[أإآٱا]').replace(/[ىي]/g, '[ىي]')
         .replace(/ة/g, '[ةه]').replace(/[ؤئو]/g, '[ؤئوي]');
    return e + D;
  });
  return new RegExp('(' + parts.join('') + ')', 'g');
}
function countMatches(text, re) {
  if (!re) return 0;
  let n = 0;
  for (const _ of text.matchAll(re)) n++;
  return n;
}
function highlight(text, re) {
  const safe = esc(text);
  if (!re) return safe;
  return safe.replace(re, '<mark>$1</mark>');
}
const chapterText = (ch) => (ch.content || []).join('\n');

/* ---------- تنبيه ---------- */
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- تحميل البيانات ---------- */
async function init() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch('./data/chapters.json', { cache: 'no-cache', signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('data');
    const data = await res.json();
    state.chapters = Array.isArray(data) ? data : (data.chapters || []);
    if (!state.chapters.length) throw new Error('empty');
  } catch (e) {
    $('#chapter').innerHTML = '<div class="empty-state">تعذّر تحميل ملف <b>data/chapters.json</b>.<br>'
      + 'إن كنت تستعمل نسخة قديمة، حدِّث الصفحة (Ctrl+F5) أو انتظر تحديث التخزين المؤقت.<br><br>'
      + '<button id="retryBtn" class="iconbtn" style="cursor:pointer">إعادة المحاولة</button></div>';
    const rb = document.getElementById('retryBtn');
    if (rb) rb.addEventListener('click', () => location.reload());
    return;
  }
  let start = 1;
  try { start = parseInt(localStorage.getItem(KEY.pos), 10) || 1; } catch (e) {}
  if (start < 1 || start > state.chapters.length) start = 1;

  bindUI();
  gotoChapter(start, { scroll: 'top' });
}

/* ---------- الفهرس (يُبنى حسب حالة البحث/التصفية) ---------- */
function renderToc() {
  const list = $('#tocList');
  const filter = ($('#tocFilter').value || '').trim().toLowerCase();
  $('#chapterCount').textContent = state.chapters.length + ' باب';
  list.innerHTML = '';

  if (state.q) {
    const total = Object.values(state.results).reduce((a, b) => a + b, 0);
    const head = document.createElement('div');
    head.className = 'toc-empty';
    head.innerHTML = total
      ? `<b>${total}</b> نتيجة في <b>${state.hitChapters.length}</b> باب`
      : 'لا توجد نتائج مطابقة';
    list.appendChild(head);
    state.hitChapters.forEach((id) => {
      const ch = state.chapters[id - 1];
      const b = document.createElement('button');
      b.className = 'toc-item' + (id === state.curId ? ' active' : '');
      b.innerHTML = `<span class="hitcount">${state.results[id]}</span><span class="num">${id}.</span> ${esc(ch.title)}`;
      b.onclick = () => gotoChapter(id, { focus: true, closeMenu: true });
      list.appendChild(b);
    });
    return;
  }

  state.chapters.forEach((ch, idx) => {
    const id = idx + 1;
    if (filter && !ch.title.toLowerCase().includes(filter)) return;
    const b = document.createElement('button');
    b.className = 'toc-item' + (id === state.curId ? ' active' : '');
    b.innerHTML = `<span class="num">${id}.</span> ${esc(ch.title)}`;
    b.onclick = () => gotoChapter(id, { closeMenu: true });
    list.appendChild(b);
  });
  if (!list.children.length) list.innerHTML = '<div class="toc-empty">لا يوجد باب مطابق للتصفية.</div>';
}

/* ---------- رسم الفصل ---------- */
function chapterMarkup(ch) {
  const total = state.chapters.length;
  const info = ch.id === 1;
  const kicker = info ? 'بطاقة الكتاب' : `الباب ${ch.id - 1} من ${total - 1}`;
  const body = (ch.content || []).map((p) => {
    const inner = state.re ? highlight(p, state.re) : esc(p);
    return `<p class="${info ? 'info-list' : ''}">${inner}</p>`;
  }).join('') || '<p class="info-list">—</p>';
  return `
    <div class="chapter-head">
      <div>
        <p class="chapter-kicker">${kicker}</p>
        <h2 class="chapter-title">${esc(ch.title)}</h2>
      </div>
      <div class="chapter-actions">
        <button id="copyBtn" title="نسخ الباب" aria-label="نسخ الباب">⧉</button>
      </div>
    </div>${body}`;
}

function paintChapter() {
  const ch = state.chapters[state.curId - 1];
  $('#chapter').innerHTML = chapterMarkup(ch);
  $('#copyBtn').onclick = () => copyChapter(ch);
  $('#pageInfo').textContent = `${state.curId} / ${state.chapters.length}`;
  $('#prevCh').disabled = state.curId <= 1;
  $('#nextCh').disabled = state.curId >= state.chapters.length;
  $('#pager').hidden = false;
  state.hitIndex = -1;
  updateHitButtons();
}

function gotoChapter(id, opts = {}) {
  id = Math.max(1, Math.min(state.chapters.length, id));
  state.curId = id;
  paintChapter();
  renderToc();
  try { localStorage.setItem(KEY.pos, String(id)); } catch (e) {}

  if (opts.focus) requestAnimationFrame(() => focusHit(0, true));
  else if (opts.scroll === 'top') window.scrollTo({ top: 0, behavior: 'auto' });
  if (opts.closeMenu && isMobile()) closeMenu();
}

/* إعادة رسم المحتوى عند تغيّر البحث دون تغيير الباب */
function refreshBody() {
  const ch = state.chapters[state.curId - 1];
  const info = ch.id === 1;
  const paras = $$('#chapter > p');
  if (paras.length === (ch.content || []).length) {
    (ch.content || []).forEach((p, i) => {
      paras[i].innerHTML = state.re ? highlight(p, state.re) : esc(p);
    });
  } else {
    paintChapter();
  }
  state.hitIndex = -1;
  updateHitButtons();
}

/* ---------- البحث ---------- */
function runSearch() {
  const q = $('#searchInput').value.trim();
  state.q = q;

  if (!q) {
    document.documentElement.removeAttribute('data-search');
    $('#clearBtn').hidden = true;
    $('#searchCount').textContent = '';
    state.re = null; state.results = {}; state.hitChapters = [];
    renderToc(); refreshBody();
    return;
  }

  document.documentElement.setAttribute('data-search', 'on');
  $('#clearBtn').hidden = false;
  state.re = tolerantRegex(q);

  state.results = {}; state.hitChapters = [];
  let total = 0;
  state.chapters.forEach((ch, idx) => {
    const n = countMatches(chapterText(ch), state.re);
    if (n > 0) { state.results[idx + 1] = n; state.hitChapters.push(idx + 1); total += n; }
  });

  $('#searchCount').textContent = `${total} نتيجة`;
  renderToc(); refreshBody();
}
function clearSearch() {
  $('#searchInput').value = '';
  runSearch();
  $('#searchInput').focus();
}

/* ---------- التنقّل بين المواضع ---------- */
const currentMarks = () => $$('#chapter mark');
function updateHitButtons() {
  const has = currentMarks().length > 0;
  $('#prevHit').disabled = !has;
  $('#nextHit').disabled = !has;
}
function focusHit(index, quiet) {
  const marks = currentMarks();
  if (!marks.length) {
    if (state.hitChapters.length) {
      const at = state.hitChapters.indexOf(state.curId);
      const nextId = at >= 0 ? state.hitChapters[at] : (state.hitChapters.find((i) => i > state.curId) || state.hitChapters[0]);
      gotoChapter(nextId, { focus: true, closeMenu: true });
    } else if (!quiet) toast(state.q ? 'لا توجد نتائج' : 'اكتب كلمة للبحث');
    return;
  }
  if (index < 0) index = 0;
  if (index >= marks.length) index = marks.length - 1;
  state.hitIndex = index;
  marks.forEach((m) => m.classList.remove('flash'));
  marks[index].classList.add('flash');
  marks[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (!quiet) toast(`النتيجة ${index + 1} من ${marks.length} في هذا الباب`);
}
function nextHit() {
  const marks = currentMarks();
  if (!marks.length) { focusHit(0); return; }
  if (state.hitIndex + 1 < marks.length) focusHit(state.hitIndex + 1);
  else {
    const at = state.hitChapters.indexOf(state.curId);
    const nid = at >= 0 && at + 1 < state.hitChapters.length ? state.hitChapters[at + 1] : state.hitChapters[0];
    if (nid && nid !== state.curId) gotoChapter(nid, { focus: true, closeMenu: true });
    else focusHit(0);
  }
}
function prevHit() {
  const marks = currentMarks();
  if (!marks.length) { focusHit(0); return; }
  if (state.hitIndex - 1 >= 0) focusHit(state.hitIndex - 1);
  else {
    const at = state.hitChapters.indexOf(state.curId);
    const pid = at > 0 ? state.hitChapters[at - 1] : state.hitChapters[state.hitChapters.length - 1];
    if (pid && pid !== state.curId) gotoChapter(pid, { focus: true, closeMenu: true });
    else focusHit(marks.length - 1);
  }
}

/* ---------- القائمة ---------- */
function openMenu() {
  document.documentElement.setAttribute('data-menu', 'open');
  $('#scrim').hidden = false;
  $('#menuBtn').setAttribute('aria-expanded', 'true');
}
function closeMenu() {
  if (!isMobile()) return;                 // على الحاسوب تبقى القائمة ظاهرة
  document.documentElement.setAttribute('data-menu', 'closed');
  $('#scrim').hidden = true;
  $('#menuBtn').setAttribute('aria-expanded', 'false');
}

/* ---------- المظهر والخط ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('#themeBtn').textContent = t === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(KEY.theme, next); } catch (e) {}
}
const applyFont = (rem) => document.documentElement.style.setProperty('--content-font-size', rem + 'rem');
function changeFont(dir) {
  let cur = 1.35;
  try { cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--content-font-size')) || 1.35; } catch (e) {}
  const next = Math.min(2.3, Math.max(1.0, Math.round((cur + dir * 0.15) * 100) / 100));
  applyFont(next);
  try { localStorage.setItem(KEY.font, String(next)); } catch (e) {}
}

/* ---------- نسخ ---------- */
function copyChapter(ch) {
  const txt = `${ch.title}\n\n${(ch.content || []).join('\n\n')}\n\n— من كتاب «أخبار الحمقى والمغفلين» لابن الجوزي`;
  const done = () => toast('نُسخ الباب ✓');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(done).catch(() => fallbackCopy(txt, done));
  } else fallbackCopy(txt, done);
}
function fallbackCopy(txt, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta); done();
  } catch (e) { toast('تعذّرت النسخ'); }
}

/* ---------- ربط الواجهة ---------- */
function bindUI() {
  $('#menuBtn').onclick = () => {
    if (document.documentElement.getAttribute('data-menu') === 'open') closeMenu(); else openMenu();
  };
  $('#scrim').onclick = closeMenu;

  const input = $('#searchInput');
  let debounce = null;
  input.addEventListener('input', () => {
    $('#clearBtn').hidden = !input.value;
    clearTimeout(debounce);
    debounce = setTimeout(runSearch, 120);
  });
  input.addEventListener('compositionend', () => { clearTimeout(debounce); runSearch(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? prevHit() : nextHit(); }
    else if (e.key === 'Escape') clearSearch();
  });
  input.addEventListener('focus', () => { if (isMobile()) openMenu(); });
  $('#clearBtn').onclick = clearSearch;

  $('#prevHit').onclick = prevHit;
  $('#nextHit').onclick = nextHit;

  $('#prevCh').onclick = () => gotoChapter(state.curId - 1, { scroll: 'top' });
  $('#nextCh').onclick = () => gotoChapter(state.curId + 1, { scroll: 'top' });

  $('#themeBtn').onclick = toggleTheme;
  $('#fontInc').onclick = () => changeFont(1);
  $('#fontDec').onclick = () => changeFont(-1);

  $('#tocFilter').addEventListener('input', () => { if (!state.q) renderToc(); });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '/') { e.preventDefault(); input.focus(); }
    else if (e.key === 'ArrowRight') gotoChapter(state.curId - 1, { scroll: 'top' });
    else if (e.key === 'ArrowLeft') gotoChapter(state.curId + 1, { scroll: 'top' });
  });
}

/* ---------- الإقلاع ---------- */
(function boot() {
  let t = null;
  try { t = localStorage.getItem(KEY.theme); } catch (e) {}
  if (!t) t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  applyTheme(t);
  let f = null;
  try { f = localStorage.getItem(KEY.font); } catch (e) {}
  if (f) applyFont(parseFloat(f) || 1.35);
  document.documentElement.setAttribute('data-menu', isMobile() ? 'closed' : 'open');
})();

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
