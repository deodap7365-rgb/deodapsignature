/* Shared helpers: API client, DOM utilities, toast, PDF.js loader, signature pad. */
'use strict';

const PDFJS_VER = '3.11.174';
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}`;

const API = {
  async req(method, url, body, isForm) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (isForm) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const r = await fetch(url, opts);
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await r.json() : await r.text();
    if (!r.ok) throw new Error((data && data.error) || ('Request failed (' + r.status + ')'));
    return data;
  },
  get(u) { return this.req('GET', u); },
  post(u, b) { return this.req('POST', u, b); },
  put(u, b) { return this.req('PUT', u, b); },
  postForm(u, fd) { return this.req('POST', u, fd, true); },
};

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  attrs = attrs || {};
  for (const k in attrs) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  }
  for (const kid of kids.flat()) { if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid)); }
  return n;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, isErr) {
  let t = $('#toast');
  if (!t) { t = el('div', { id: 'toast' }); document.body.append(t); }
  t.textContent = msg;
  t.className = isErr ? 'err show' : 'show';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.className = ''), 2800);
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const TITLECASE = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const badge = (status) => `<span class="badge ${status}">${TITLECASE(status)}</span>`;
const initials = (name) => String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  catch (e) { toast('Copy failed — select and copy manually', true); }
}

/* ---- PDF.js loader ---- */
let _pdfjsReady = null;
function loadPdfJs() {
  if (_pdfjsReady) return _pdfjsReady;
  _pdfjsReady = new Promise((resolve, reject) => {
    if (window.pdfjsLib) return resolve(window.pdfjsLib);
    const s = document.createElement('script');
    s.src = `${PDFJS_BASE}/pdf.min.js`;
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.js`; resolve(window.pdfjsLib); };
    s.onerror = () => reject(new Error('Could not load PDF viewer (offline?)'));
    document.head.append(s);
  });
  return _pdfjsReady;
}

// Render every page of a PDF (by URL) into .page-wrap containers under `mount`.
// Returns [{ wrap, page, width, height }]. Each page fit to `targetWidth`.
async function renderPdf(url, mount, targetWidth, withCreds) {
  const pdfjsLib = await loadPdfJs();
  const doc = await pdfjsLib.getDocument({ url, withCredentials: !!withCreds }).promise;
  mount.innerHTML = '';
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = targetWidth / base.width;
    const vp = page.getViewport({ scale });
    const canvas = el('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    const wrap = el('div', { class: 'page-wrap' }, canvas);
    wrap.style.width = vp.width + 'px'; wrap.style.height = vp.height + 'px';
    mount.append(wrap);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    out.push({ wrap, index: i - 1, width: vp.width, height: vp.height });
  }
  return out;
}

/* ---- Signature pad modal: resolves to a PNG dataURL, or null if cancelled ---- */
function openSignaturePad(defaultName) {
  return new Promise((resolve) => {
    const canvas = el('canvas', { class: 'pad-canvas' });
    const typeInput = el('input', { type: 'text', value: defaultName || '', placeholder: 'Type your name' });
    const typePrev = el('div', { class: 'type-preview' });
    const drawPane = el('div', {}, el('div', { class: 'muted small', style: 'margin-bottom:8px' }, 'Draw your signature below'), el('div', { class: 'padbox' }, canvas));
    const typePane = el('div', { style: 'display:none' }, el('label', { class: 'fld' }, el('span', {}, 'Type your signature'), typeInput), typePrev);

    const tabDraw = el('button', { class: 'btn sm primary' }, 'Draw');
    const tabType = el('button', { class: 'btn sm' }, 'Type');
    let mode = 'draw';
    const setMode = (m) => {
      mode = m;
      tabDraw.className = 'btn sm' + (m === 'draw' ? ' primary' : '');
      tabType.className = 'btn sm' + (m === 'type' ? ' primary' : '');
      drawPane.style.display = m === 'draw' ? '' : 'none';
      typePane.style.display = m === 'type' ? '' : 'none';
    };
    tabDraw.onclick = () => setMode('draw');
    tabType.onclick = () => setMode('type');

    const renderType = () => { typePrev.style.fontFamily = "'Brush Script MT','Segoe Script',cursive"; typePrev.textContent = typeInput.value || 'Your name'; };
    typeInput.addEventListener('input', renderType); renderType();

    const overlay = el('div', { class: 'overlay show' },
      el('div', { class: 'modal', style: 'max-width:520px' },
        el('div', { class: 'head' }, el('h3', {}, 'Add your signature'),
          el('button', { class: 'x', onclick: () => done(null) }, '×')),
        el('div', { class: 'body' },
          el('div', { class: 'pad-tabs' }, tabDraw, tabType),
          drawPane, typePane,
          el('div', { class: 'flex between', style: 'margin-top:16px' },
            el('button', { class: 'btn sm', onclick: () => clear() }, 'Clear'),
            el('div', { class: 'flex' },
              el('button', { class: 'btn', onclick: () => done(null) }, 'Cancel'),
              el('button', { class: 'btn primary', onclick: () => accept() }, 'Apply'))))));
    document.body.append(overlay);

    // drawing
    const ctx = canvas.getContext('2d');
    let drawing = false, dirty = false, last = null;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const data = dirty ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
      canvas.width = r.width; canvas.height = r.height;
      ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.strokeStyle = '#13294b';
      if (data) ctx.putImageData(data, 0, 0);
    };
    setTimeout(resize, 30);
    const pos = (e) => { const r = canvas.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return { x: p.clientX - r.left, y: p.clientY - r.top }; };
    const start = (e) => { drawing = true; last = pos(e); e.preventDefault(); };
    const move = (e) => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; dirty = true; e.preventDefault(); };
    const end = () => { drawing = false; };
    canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start); canvas.addEventListener('touchmove', move); canvas.addEventListener('touchend', end);

    function clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; typeInput.value = ''; renderType(); }

    function accept() {
      let dataUrl = null;
      if (mode === 'draw') {
        if (!dirty) { toast('Please draw your signature first', true); return; }
        dataUrl = trimCanvas(canvas);
      } else {
        const txt = typeInput.value.trim();
        if (!txt) { toast('Please type your name', true); return; }
        dataUrl = textToPng(txt);
      }
      done(dataUrl);
    }
    function done(val) {
      canvas.removeEventListener('mousedown', start); canvas.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      overlay.remove(); resolve(val);
    }
  });
}

// Render typed text to a transparent PNG in a script font.
function textToPng(txt) {
  const c = el('canvas'); c.width = 600; c.height = 200;
  const x = c.getContext('2d');
  x.fillStyle = '#13294b'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = "64px 'Brush Script MT','Segoe Script',cursive";
  x.fillText(txt, c.width / 2, c.height / 2);
  return trimCanvas(c);
}

// Crop transparent margins so the stamped signature sits tight in its box.
function trimCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const d = ctx.getImageData(0, 0, w, h).data;
  let top = h, left = w, right = 0, bottom = 0, found = false;
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
    if (d[(y * w + xx) * 4 + 3] > 8) { found = true; if (y < top) top = y; if (y > bottom) bottom = y; if (xx < left) left = xx; if (xx > right) right = xx; }
  }
  if (!found) return canvas.toDataURL('image/png');
  const pad = 6; top = Math.max(0, top - pad); left = Math.max(0, left - pad); right = Math.min(w, right + pad); bottom = Math.min(h, bottom + pad);
  const out = el('canvas'); out.width = right - left; out.height = bottom - top;
  out.getContext('2d').drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
