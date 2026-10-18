/* StoryStream: a free audiobook player for public-domain LibriVox recordings.
   Data comes straight from the Internet Archive's public APIs (they allow
   browser requests), no server of our own, no trackers. */
'use strict';
(() => {
const IA = 'https://archive.org';
const PAGE = 24;
const GENRES = [
  {key:'popular', label:'🔥 Popular', q:''},
  {key:'kids', label:'🧸 Kids', q:'subject:children'},
  {key:'adventure', label:'🏴‍☠️ Adventure', q:'subject:adventure'},
  {key:'fantasy', label:'🐉 Fantasy', q:'subject:fantasy'},
  {key:'fairy', label:'🧚 Fairy Tales', q:'subject:"fairy tales"'},
  {key:'mystery', label:'🕵️ Mystery', q:'subject:mystery'},
  {key:'scifi', label:'🚀 Sci-Fi', q:'subject:"science fiction"'},
  {key:'animals', label:'🐾 Animals', q:'subject:animals'},
  {key:'funny', label:'😂 Funny', q:'subject:humor'},
  {key:'poetry', label:'📝 Poetry', q:'subject:poetry'},
  {key:'history', label:'🏛️ History', q:'subject:history'},
];

const $ = s => document.querySelector(s);
const view = $('#view');
const audio = $('#audio');

/* ---------- storage ---------- */
const store = {
  get(k, d){ try { const v = localStorage.getItem('ss.'+k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v){ try { localStorage.setItem('ss.'+k, JSON.stringify(v)); } catch {} },
};
let books = store.get('books', {});          // id -> {id,title,creator,idx,t,n,updated,saved,done}
const saveBooks = () => store.set('books', books);
let englishOnly = store.get('englishOnly', true);

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const one = v => Array.isArray(v) ? v[0] : v;
const cover = id => `${IA}/services/img/${encodeURIComponent(id)}`;
const fmt = s => {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s); const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60;
  return (h ? h + ':' + String(m).padStart(2,'0') : m) + ':' + String(x).padStart(2,'0');
};
const parseLen = v => {
  if (v == null) return 0; v = String(v);
  if (v.includes(':')) return v.split(':').reduce((a, b) => a*60 + (parseFloat(b)||0), 0);
  return parseFloat(v) || 0;
};
const cleanTitle = (title, creator) => {
  title = String(one(title) || 'Untitled');
  const c = String(one(creator) || '');
  if (c && title.toLowerCase().endsWith((', by ' + c).toLowerCase())) title = title.slice(0, -(c.length + 5));
  return title;
};
const htmlToText = html => {
  html = Array.isArray(html) ? html.join('\n') : String(html || '');
  html = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent || '').split('\n').map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => !/^(for further information|download m4b|download (the )?(zip|mp3)|this recording is in the public domain\.?$)/i.test(l))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
const niceChapterTitle = (title, name, n) => {
  const t = String(title || '').trim();
  // Many LibriVox files only carry a file-style name like "wonderland_ch_01"
  if (!t || (!/\s/.test(t) && /[_\d]/.test(t))) return 'Chapter ' + n;
  const stripped = t.replace(/^\d+\s*[-\u2013.:]\s*/, '');
  return stripped || t;
};
const luceneEscape = s => s.replace(/[+\-!(){}\[\]^"~*?:\\\/&|]/g, ' ').trim();
const loading = () => '<div class="loading"><div class="spinner" aria-label="Loading"></div></div>';

async function getJSON(url){
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function searchIA(extra, page = 1){
  let q = 'collection:librivoxaudio AND mediatype:audio';
  if (englishOnly) q += ' AND language:eng';
  if (extra) q += ' AND ' + extra;
  const p = new URLSearchParams({q, rows: PAGE, page, output: 'json'});
  ['identifier','title','creator','runtime','downloads'].forEach(f => p.append('fl[]', f));
  p.append('sort[]', 'downloads desc');
  const d = await getJSON(`${IA}/advancedsearch.php?${p}`);
  return {docs: d.response.docs || [], total: d.response.numFound || 0};
}

const metaCache = new Map();
async function getBook(id){
  if (metaCache.has(id)) return metaCache.get(id);
  const d = await getJSON(`${IA}/metadata/${encodeURIComponent(id)}`);
  if (!d || !d.metadata) throw new Error('Book not found');
  const m = d.metadata, files = d.files || [];
  const mp3 = files.filter(f => /\.mp3$/i.test(f.name || ''));
  const pick = ['64Kbps MP3', 'VBR MP3', '128Kbps MP3', '32Kbps MP3'];
  let list = [];
  for (const fmtName of pick){ list = mp3.filter(f => f.format === fmtName); if (list.length) break; }
  if (!list.length) list = mp3;
  const trackNo = f => { const n = parseInt(String(f.track || '').split('/')[0], 10); return isNaN(n) ? 1e9 : n; };
  list.sort((a, b) => trackNo(a) - trackNo(b) || a.name.localeCompare(b.name, undefined, {numeric: true}));
  const creator = one(m.creator) || 'Unknown author';
  const book = {
    id, creator,
    title: cleanTitle(m.title, creator),
    desc: htmlToText(m.description),
    runtime: m.runtime || '',
    librivox: (String(m.description||'').match(/https?:\/\/librivox\.org\/[^"'\s<]+/) || [null])[0],
    chapters: list.map((f, i) => ({
      title: niceChapterTitle(f.title, f.name, i + 1),
      url: `${IA}/download/${encodeURIComponent(id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
      len: parseLen(f.length),
      n: i + 1,
    })),
  };
  metaCache.set(id, book);
  return book;
}

/* ---------- cards ---------- */
function card(doc, progress){
  const creator = one(doc.creator) || '';
  const title = cleanTitle(doc.title, creator);
  const pct = progress && progress.n ? Math.min(100, Math.round(((progress.idx || 0) + 0.5) / progress.n * 100)) : 0;
  return `<a class="card" href="#/book/${encodeURIComponent(doc.identifier || doc.id)}">
    <div class="cv"><img loading="lazy" src="${cover(doc.identifier || doc.id)}" alt="" onerror="this.remove()">
      ${doc.runtime ? `<span class="badge">⏱ ${esc(String(doc.runtime).replace(/:\d\d$/, '').replace(/^(\d+):(\d+)$/, (m,h,mm)=> +h ? h+'h '+(+mm)+'m' : (+mm)+'m'))}</span>` : ''}</div>
    ${progress ? `<div class="prog"><i style="width:${pct}%"></i></div>` : ''}
    <div class="meta"><div class="t">${esc(title)}</div><div class="a">${esc(creator)}</div></div></a>`;
}

/* ---------- views ---------- */
function setTab(name){ document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === name)); }

function continueRow(){
  const list = Object.values(books).filter(b => b.updated && b.t + (b.idx||0) > 0).sort((a, b) => b.updated - a.updated).slice(0, 12);
  if (!list.length) return '';
  return `<div class="section-title"><h2>▶️ Continue listening</h2><a href="#/library">See all</a></div>
    <div class="row">${list.map(b => card({identifier: b.id, title: b.title, creator: b.creator}, b)).join('')}</div>`;
}

function langToggle(){
  return `<label class="toggle"><input type="checkbox" id="eng" ${englishOnly ? 'checked' : ''}> English books only</label>`;
}
function bindLangToggle(){
  const el = $('#eng'); if (!el) return;
  el.onchange = () => { englishOnly = el.checked; store.set('englishOnly', englishOnly); route(); };
}

async function listInto(container, extra, emptyMsg){
  let page = 1, shown = 0;
  container.innerHTML = loading();
  const grid = document.createElement('div'); grid.className = 'grid';
  const more = document.createElement('div'); more.className = 'more';
  async function load(){
    try {
      const {docs, total} = await searchIA(extra, page);
      if (page === 1){ container.innerHTML = ''; container.append(grid, more); }
      if (!docs.length && page === 1){ container.innerHTML = `<div class="empty"><div class="big">🔎</div><p>${emptyMsg}</p></div>`; return; }
      grid.insertAdjacentHTML('beforeend', docs.map(d => card(d)).join(''));
      shown += docs.length;
      more.innerHTML = shown < total ? `<button class="btn pink">Show more books</button>` : '';
      const b = more.querySelector('button'); if (b) b.onclick = () => { b.disabled = true; b.textContent = 'Loading…'; page++; load(); };
    } catch (e) {
      container.innerHTML = `<div class="empty"><div class="big">📡</div><p>Couldn't reach the library. Check your internet and try again.</p><button class="btn" id="retry">Try again</button></div>`;
      $('#retry').onclick = route;
    }
  }
  await load();
}

function renderHome(genreKey){
  setTab('home');
  const g = GENRES.find(x => x.key === genreKey) || GENRES[0];
  view.innerHTML = `
    <section class="hero"><h1>Hi! What story do you want today? 🎧</h1>
      <p>Thousands of free audiobooks, read out loud by LibriVox volunteers. All of them are public domain, so they're 100% free.</p></section>
    ${continueRow()}
    <div class="section-title"><h2>${esc(g.label)} books</h2>${langToggle()}</div>
    <div class="chips">${GENRES.map(x => `<a class="chip ${x.key === g.key ? 'on' : ''}" href="#/genre/${x.key}">${x.label}</a>`).join('')}</div>
    <div id="list"></div>`;
  bindLangToggle();
  listInto($('#list'), g.q, 'No books here yet.');
}

function renderSearch(q){
  setTab('');
  $('#q').value = q;
  const t = luceneEscape(q);
  view.innerHTML = `<div class="section-title"><h2>Results for “${esc(q)}”</h2>${langToggle()}</div><div id="list"></div>`;
  bindLangToggle();
  if (!t){ $('#list').innerHTML = '<div class="empty">Type a book or author name.</div>'; return; }
  const wild = t.toLowerCase().split(/\s+/).filter(Boolean).map(w => w + '*').join(' ');
  listInto($('#list'), `(title:(${t}) OR title:(${wild}) OR creator:(${t}))`, `No free audiobooks matched “${esc(q)}”. Try a different word, or a classic like “Alice”, “Peter Pan” or “Sherlock”.`);
}

function renderLibrary(){
  setTab('library');
  const all = Object.values(books).sort((a, b) => (b.updated||0) - (a.updated||0));
  const listening = all.filter(b => b.updated && (b.t > 0 || b.idx > 0));
  const saved = all.filter(b => b.saved);
  const grid = list => `<div class="grid">${list.map(b => card({identifier: b.id, title: b.title, creator: b.creator}, b.n ? b : null)).join('')}</div>`;
  view.innerHTML = `<h1>📚 My Library</h1>
    <div class="section-title"><h2>▶️ Continue listening</h2></div>
    ${listening.length ? grid(listening) : '<div class="empty"><div class="big">🎧</div><p>Books you start will show up here, with your spot saved.</p></div>'}
    <div class="section-title"><h2>⭐ Saved for later</h2></div>
    ${saved.length ? grid(saved) : '<div class="empty"><p>Tap “Save” on a book to keep it here.</p></div>'}
    ${all.length ? '<div class="more"><button class="btn" id="clearAll">🗑️ Clear my library</button></div>' : ''}`;
  const c = $('#clearAll');
  if (c) c.onclick = () => { if (confirm('Clear all saved books and listening spots on this device?')) { const keep = cur ? books[cur.id] : null; books = {}; if (keep) books[keep.id] = keep; saveBooks(); renderLibrary(); } };
}

async function renderBook(id){
  setTab('');
  view.innerHTML = loading();
  let b;
  try { b = await getBook(id); }
  catch (e) { view.innerHTML = `<div class="empty"><div class="big">😕</div><p>Couldn't load this book. Check your internet and try again.</p><a class="btn" href="#/">Go home</a></div>`; return; }
  if (location.hash !== '#/book/' + encodeURIComponent(id)) return;
  const p = books[id];
  const startIdx = p ? p.idx || 0 : 0;
  const isCur = cur && cur.id === id;
  view.innerHTML = `<div class="book">
      <img class="cover" src="${cover(id)}" alt="Cover of ${esc(b.title)}">
      <div>
        <h1>${esc(b.title)}</h1>
        <p class="muted">by <b>${esc(b.creator)}</b>${b.runtime ? ` · ⏱ ${esc(b.runtime)}` : ''} · ${b.chapters.length} chapters</p>
        <div class="btns">
          ${b.chapters.length ? `<button class="btn primary" id="playBook">▶ ${p && (p.t > 5 || p.idx > 0) ? `Continue (Ch. ${startIdx + 1} · ${fmt(p.t)})` : 'Start listening'}</button>` : ''}
          <button class="btn" id="saveBook">${p && p.saved ? '⭐ Saved' : '☆ Save'}</button>
          ${b.librivox ? `<a class="btn" href="${esc(b.librivox)}" target="_blank" rel="noopener">LibriVox page ↗</a>` : ''}
        </div>
        ${b.desc ? `<div class="desc" id="desc">${esc(b.desc)}</div><button class="link" id="moreDesc">Read more</button>` : ''}
        <p class="small muted">🎙️ Read by LibriVox volunteers. This book is in the public domain.</p>
        <div class="section-title"><h2>Chapters</h2></div>
        ${b.chapters.length ? `<ol class="chapters">${b.chapters.map((c, i) => `<li><button data-i="${i}" class="${(isCur && cur.idx === i) || (!isCur && p && p.idx === i && (p.t > 0 || i > 0)) ? 'now' : (p && p.done && p.done[i] ? 'done' : '')}">
          <span class="n">${p && p.done && p.done[i] ? '✓' : i + 1}</span><span class="ct">${esc(c.title)}<small>${c.len ? fmt(c.len) : ''}</small></span><span>▶</span></button></li>`).join('')}</ol>`
          : '<p class="err">Sorry, this book has no audio files we can play.</p>'}
      </div></div>`;
  const desc = $('#desc'), md = $('#moreDesc');
  if (desc && md){ if (desc.scrollHeight <= desc.clientHeight + 4) md.remove(); else md.onclick = () => { desc.classList.toggle('open'); md.textContent = desc.classList.contains('open') ? 'Show less' : 'Read more'; }; }
  const pb = $('#playBook');
  if (pb) pb.onclick = () => { if (isCur){ audio.play(); openPlayer(); } else startBook(b, startIdx, p ? p.t : 0); };
  $('#saveBook').onclick = e => {
    const r = ensureRec(b); r.saved = !r.saved; saveBooks();
    e.currentTarget.textContent = r.saved ? '⭐ Saved' : '☆ Save';
  };
  view.querySelectorAll('.chapters button').forEach(btn => btn.onclick = () => {
    const i = +btn.dataset.i;
    const resume = p && p.idx === i ? p.t : 0;
    if (cur && cur.id === id && cur.idx === i){ audio.play(); openPlayer(); return; }
    startBook(b, i, resume);
  });
}

function ensureRec(b){
  return books[b.id] || (books[b.id] = {id: b.id, title: b.title, creator: b.creator, idx: 0, t: 0, n: b.chapters.length, updated: 0, saved: false, done: {}});
}

/* ---------- router ---------- */
function route(){
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [r, ...rest] = h.split('/'); const arg = rest.join('/');
  window.scrollTo(0, 0);
  if (r === 'book' && arg) renderBook(arg);
  else if (r === 'search') renderSearch(arg);
  else if (r === 'library') renderLibrary();
  else if (r === 'genre') renderHome(arg);
  else renderHome('popular');
}
window.addEventListener('hashchange', () => { closePlayer(); route(); });
$('#searchForm').onsubmit = e => {
  e.preventDefault(); const q = $('#q').value.trim(); if (!q) return;
  $('#q').blur(); location.hash = '#/search/' + encodeURIComponent(q);
};

/* ---------- player ---------- */
let cur = null;            // {id,title,creator,chapters,idx}
let pendingSeek = 0;
let lastSave = 0;
const playBtns = [$('#playBtn'), $('#miniPlay')];

function startBook(b, idx, t){
  cur = {id: b.id, title: b.title, creator: b.creator, chapters: b.chapters, idx: 0};
  const r = ensureRec(b); r.n = b.chapters.length; r.title = b.title; r.creator = b.creator;
  loadChapter(idx, t || 0, true);
  openPlayer();
}

function loadChapter(idx, t, autoplay){
  if (!cur || idx < 0 || idx >= cur.chapters.length) return;
  cur.idx = idx;
  const c = cur.chapters[idx];
  $('#pErr').classList.add('hidden');
  pendingSeek = t > 0 ? t : 0;
  audio.src = c.url;
  audio.playbackRate = +$('#speed').value;
  audio.load();
  if (autoplay) audio.play().catch(() => {});
  updateNowPlaying();
  savePos(true);
}

function updateNowPlaying(){
  if (!cur) return;
  const c = cur.chapters[cur.idx];
  $('#mini').classList.remove('hidden');
  $('#miniCover').src = $('#pCover').src = cover(cur.id);
  $('#miniTitle').textContent = $('#pTitle').textContent = cur.title;
  $('#pAuthor').textContent = 'by ' + cur.creator;
  const chap = `Chapter ${cur.idx + 1} of ${cur.chapters.length}: ${c.title}`;
  $('#pChap').textContent = chap; $('#miniChap').textContent = chap;
  $('#prevChap').disabled = cur.idx === 0; $('#nextChap').disabled = cur.idx >= cur.chapters.length - 1;
  document.title = `${c.title} · ${cur.title} · StoryStream`;
  if ('mediaSession' in navigator){
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: c.title, artist: cur.creator, album: cur.title,
        artwork: [{src: cover(cur.id), sizes: '180x180', type: 'image/jpeg'}, {src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png'}],
      });
    } catch {}
  }
}

function savePos(force){
  if (!cur) return;
  const now = Date.now();
  if (!force && now - lastSave < 4000) return;
  lastSave = now;
  const r = books[cur.id]; if (!r) return;
  r.idx = cur.idx;
  r.t = pendingSeek || audio.currentTime || 0;
  r.updated = now;
  saveBooks();
}

audio.addEventListener('loadedmetadata', () => {
  if (pendingSeek && pendingSeek < (audio.duration || Infinity) - 1){ try { audio.currentTime = pendingSeek; } catch {} }
  pendingSeek = 0;
  audio.playbackRate = +$('#speed').value;
  tick();
});
audio.addEventListener('timeupdate', () => { tick(); if (!audio.paused) savePos(false); });
audio.addEventListener('play', () => { setPlaying(true); sleepCheck(); });
audio.addEventListener('pause', () => { setPlaying(false); savePos(true); });
audio.addEventListener('ratechange', () => tick());
audio.addEventListener('error', () => {
  if (!cur || !audio.getAttribute('src')) return;
  const e = $('#pErr'); e.textContent = "Hmm, this chapter wouldn't load. Check your internet, or try the next chapter."; e.classList.remove('hidden');
});
audio.addEventListener('ended', () => {
  if (!cur) return;
  const r = books[cur.id]; if (r){ r.done = r.done || {}; r.done[cur.idx] = 1; }
  if (sleepMode === 'chap'){ clearSleep(); savePos(true); return; }
  if (cur.idx < cur.chapters.length - 1) loadChapter(cur.idx + 1, 0, true);
  else { if (r){ r.t = 0; r.idx = 0; r.finished = true; } saveBooks(); setPlaying(false); }
});

function setPlaying(on){
  playBtns.forEach(b => { b.textContent = on ? '❚❚' : '▶'; b.setAttribute('aria-label', on ? 'Pause' : 'Play'); });
  $('#player').classList.toggle('playing', on);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = on ? 'playing' : 'paused';
}
function tick(){
  const d = audio.duration, t = audio.currentTime;
  const dur = isFinite(d) ? d : (cur ? cur.chapters[cur.idx].len : 0);
  $('#tCur').textContent = fmt(t); $('#tDur').textContent = '-' + fmt(Math.max(0, dur - t));
  if (!seeking) $('#seek').value = dur ? Math.round(t / dur * 1000) : 0;
  $('#miniProg').style.width = (dur ? t / dur * 100 : 0) + '%';
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && isFinite(d) && d > 0){
    try { navigator.mediaSession.setPositionState({duration: d, playbackRate: audio.playbackRate || 1, position: Math.min(t, d)}); } catch {}
  }
  if (sleepMode && sleepMode !== 'chap') sleepCheck();
}
const toggle = () => { if (!cur) return; audio.paused ? audio.play().catch(() => {}) : audio.pause(); };
const skip = s => { if (!cur) return; const d = isFinite(audio.duration) ? audio.duration : 1e9; audio.currentTime = Math.max(0, Math.min(d - 0.5, audio.currentTime + s)); savePos(true); };
const nextChap = () => { if (cur && cur.idx < cur.chapters.length - 1) loadChapter(cur.idx + 1, 0, !audio.paused || true); };
const prevChap = () => { if (!cur) return; if (audio.currentTime > 5) { audio.currentTime = 0; return; } if (cur.idx > 0) loadChapter(cur.idx - 1, 0, true); };

playBtns.forEach(b => b.onclick = toggle);
$('#back15').onclick = $('#miniBack').onclick = () => skip(-15);
$('#fwd30').onclick = $('#miniFwd').onclick = () => skip(30);
$('#nextChap').onclick = nextChap; $('#prevChap').onclick = prevChap;
let seeking = false;
const seek = $('#seek');
seek.addEventListener('input', () => { seeking = true; const d = audio.duration; if (isFinite(d)) $('#tCur').textContent = fmt(seek.value / 1000 * d); });
seek.addEventListener('change', () => { const d = audio.duration; if (isFinite(d)) audio.currentTime = seek.value / 1000 * d; seeking = false; savePos(true); });

const speedSel = $('#speed');
speedSel.value = String(store.get('speed', 1));
speedSel.onchange = () => { audio.playbackRate = +speedSel.value; store.set('speed', +speedSel.value); };

if ('mediaSession' in navigator){
  const ms = navigator.mediaSession, set = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
  set('play', () => audio.play()); set('pause', () => audio.pause());
  set('seekbackward', d => skip(-(d && d.seekOffset || 15)));
  set('seekforward', d => skip(d && d.seekOffset || 30));
  set('previoustrack', prevChap); set('nexttrack', nextChap);
  set('seekto', d => { if (d.fastSeek && audio.fastSeek) audio.fastSeek(d.seekTime); else audio.currentTime = d.seekTime; savePos(true); });
}

/* sleep timer */
let sleepMode = 0, sleepEnd = 0;
const sleepSel = $('#sleep'), sleepLeft = $('#sleepLeft');
setInterval(() => { if (sleepMode && sleepMode !== 'chap') sleepCheck(); }, 1000);
function clearSleep(){ sleepMode = 0; sleepEnd = 0; sleepSel.value = '0'; sleepLeft.classList.add('hidden'); }
function sleepCheck(){
  if (!sleepMode) return;
  if (sleepMode === 'chap'){ sleepLeft.textContent = '😴 after this chapter'; sleepLeft.classList.remove('hidden'); return; }
  const left = sleepEnd - Date.now();
  if (left <= 0){ audio.pause(); clearSleep(); return; }
  sleepLeft.textContent = '😴 ' + fmt(left / 1000); sleepLeft.classList.remove('hidden');
}
sleepSel.onchange = () => {
  const v = sleepSel.value;
  if (v === '0') return clearSleep();
  sleepMode = v === 'chap' ? 'chap' : +v; sleepEnd = Date.now() + (+v || 0) * 60000; sleepCheck();
};

/* open / close full player */
function openPlayer(){ if (!cur) return; $('#player').classList.remove('hidden'); document.body.style.overflow = 'hidden'; $('#playerClose').focus({preventScroll: true}); }
function closePlayer(){ $('#player').classList.add('hidden'); document.body.style.overflow = ''; }
$('#miniOpen').onclick = openPlayer;
$('#playerClose').onclick = closePlayer;
$('#pBook').onclick = () => { if (!cur) return; closePlayer(); location.hash = '#/book/' + encodeURIComponent(cur.id); };

document.addEventListener('keydown', e => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range') return;
  if (e.key === 'Escape') closePlayer();
  if (!cur) return;
  if (e.key === ' ' && e.target.tagName !== 'BUTTON'){ e.preventDefault(); toggle(); }
  else if (e.key === 'ArrowLeft' && e.target.type !== 'range') skip(-15);
  else if (e.key === 'ArrowRight' && e.target.type !== 'range') skip(30);
});
window.addEventListener('pagehide', () => savePos(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) savePos(true); });

/* restore last book into mini player (paused) so one tap resumes */
async function restore(){
  const last = Object.values(books).filter(b => b.updated).sort((a, b) => b.updated - a.updated)[0];
  if (!last) return;
  try {
    const b = await getBook(last.id);
    if (cur || !b.chapters.length) return;
    cur = {id: b.id, title: b.title, creator: b.creator, chapters: b.chapters, idx: Math.min(last.idx || 0, b.chapters.length - 1)};
    pendingSeek = last.t || 0;
    audio.src = b.chapters[cur.idx].url;
    audio.preload = 'metadata';
    updateNowPlaying(); setPlaying(false);
    $('#tCur').textContent = fmt(pendingSeek);
  } catch {}
}

/* expose a tiny hook for automated tests */
window.StoryStream = {get cur(){ return cur; }, audio, books: () => books};

route();
restore();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
