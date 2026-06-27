/* Prepare page: render PDF, manage recipients, place + drag fields, send. */
'use strict';

const docId = new URLSearchParams(location.search).get('id');
const overlay = $('#overlay'); const modal = $('#modal');
const openModal = (n) => { modal.innerHTML = ''; modal.append(n); overlay.classList.add('show'); };
const closeModal = () => overlay.classList.remove('show');

const COLORS = ['#2563eb', '#db2777', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#4f46e5'];
const DEFAULTS = {
  signature: { w: 0.22, h: 0.07 }, initials: { w: 0.10, h: 0.06 }, date: { w: 0.16, h: 0.035 },
  name: { w: 0.20, h: 0.035 }, email: { w: 0.22, h: 0.035 }, text: { w: 0.20, h: 0.035 }, checkbox: { w: 0.03, h: 0.03 },
};
const LABELS = { signature: 'Signature', initials: 'Initials', date: 'Date signed', name: 'Full name', email: 'Email', text: 'Text', checkbox: '☑ Checkbox' };
const TYPES = Object.keys(LABELS);

let recipients = [];   // { id, name, email, color }
let fields = [];       // { id, recipientId, page, type, xPct, yPct, wPct, hPct, required, _node }
let pageInfos = [];    // { wrap, index, width, height }
let activeRecipientId = null;
let activeType = 'signature';
let seq = 1;

const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
const recipColor = (id) => (recipients.find((r) => r.id === id) || {}).color || '#64748b';

start();
async function start() {
  if (!docId) { document.body.innerHTML = '<div class="container">Missing document id.</div>'; return; }
  buildPalette();
  $('#addRecip').onclick = addRecipient;
  $('#rEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') addRecipient(); });
  $('#saveBtn').onclick = () => save().then((ok) => ok && toast('Draft saved'));
  $('#sendBtn').onclick = send;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  try {
    const data = await API.get(`/api/documents/${docId}`);
    if (data.document.status !== 'draft') { toast('This document has already been sent', true); setTimeout(() => location.href = '/', 1200); return; }
    $('#docTitle').textContent = data.document.title;
    // hydrate existing recipients/fields if returning to a draft
    recipients = data.recipients.map((r) => ({ id: r.id, name: r.name, email: r.email, color: r.color }));
    if (recipients.length) activeRecipientId = recipients[0].id;
    renderRecipients();

    const area = $('#canvas');
    const targetWidth = Math.min(840, Math.max(460, area.clientWidth - 56));
    pageInfos = await renderPdf(`/api/documents/${docId}/file`, area, targetWidth, true);
    pageInfos.forEach((pg) => pg.wrap.addEventListener('click', (e) => { if (!e.target.closest('.field')) placeField(pg, e); }));

    fields = data.fields.map((f) => ({ ...f, id: 'f' + (seq++) }));
    fields.forEach(drawField);
  } catch (e) {
    $('#canvas').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

/* ---- recipients ---- */
function addRecipient() {
  const name = $('#rName').value.trim();
  const email = $('#rEmail').value.trim();
  if (!name || !email) { toast('Enter a name and email', true); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Enter a valid email', true); return; }
  const r = { id: 'r' + (seq++), name, email, color: COLORS[recipients.length % COLORS.length] };
  recipients.push(r); activeRecipientId = r.id;
  $('#rName').value = ''; $('#rEmail').value = '';
  renderRecipients();
}

function renderRecipients() {
  const list = $('#recipList'); list.innerHTML = '';
  if (!recipients.length) list.append(el('div', { class: 'muted small', style: 'margin-bottom:8px' }, 'No recipients yet.'));
  recipients.forEach((r, i) => {
    const item = el('div', { class: 'recip-item' + (r.id === activeRecipientId ? ' active' : ''), onclick: () => { activeRecipientId = r.id; renderRecipients(); } },
      el('span', { class: 'swatch', style: `background:${r.color}` }),
      el('div', { class: 'info' }, el('b', {}, `${i + 1}. ${r.name}`), el('div', { class: 'small muted' }, r.email)),
      el('button', { class: 'x', style: 'font-size:18px', title: 'Remove', onclick: (e) => { e.stopPropagation(); removeRecipient(r.id); } }, '×'));
    list.append(item);
  });
}

function removeRecipient(id) {
  recipients = recipients.filter((r) => r.id !== id);
  fields.filter((f) => f.recipientId === id).forEach((f) => f._node && f._node.remove());
  fields = fields.filter((f) => f.recipientId !== id);
  if (activeRecipientId === id) activeRecipientId = recipients[0] ? recipients[0].id : null;
  renderRecipients();
}

/* ---- palette ---- */
function buildPalette() {
  const p = $('#palette'); p.innerHTML = '';
  TYPES.forEach((t) => {
    const b = el('button', { class: t === activeType ? 'active' : '', onclick: () => { activeType = t; buildPalette(); } }, LABELS[t]);
    p.append(b);
  });
}

/* ---- field placement + drag ---- */
function placeField(pg, e) {
  if (!recipients.length) { toast('Add a recipient first', true); return; }
  if (!activeRecipientId) { toast('Select a recipient first', true); return; }
  const rect = pg.wrap.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  const d = DEFAULTS[activeType];
  let wPct = d.w, hPct = d.h;
  if (activeType === 'checkbox') hPct = (d.w * pg.width) / pg.height; // keep square
  const wpx = wPct * pg.width, hpx = hPct * pg.height;
  const left = Math.max(0, Math.min(pg.width - wpx, px - wpx / 2));
  const top = Math.max(0, Math.min(pg.height - hpx, py - hpx / 2));
  const f = { id: 'f' + (seq++), recipientId: activeRecipientId, page: pg.index, xPct: left / pg.width, yPct: top / pg.height, wPct, hPct, required: $('#reqToggle').checked, type: activeType };
  fields.push(f); drawField(f);
}

function drawField(f) {
  const pg = pageInfos[f.page]; if (!pg) return;
  const color = recipColor(f.recipientId);
  const node = el('div', { class: 'field' });
  node.style.left = (f.xPct * pg.width) + 'px';
  node.style.top = (f.yPct * pg.height) + 'px';
  node.style.width = (f.wPct * pg.width) + 'px';
  node.style.height = (f.hPct * pg.height) + 'px';
  node.style.borderColor = color; node.style.background = hexA(color, 0.12); node.style.color = color;
  node.title = (recipients.find((r) => r.id === f.recipientId) || {}).name || '';
  node.append(el('span', { class: 'lbl' }, LABELS[f.type] + (f.required ? '' : ' (opt)')));
  node.append(el('button', { class: 'del', onclick: (e) => { e.stopPropagation(); removeField(f); } }, '×'));
  node.addEventListener('mousedown', (e) => startDrag(e, f, node));
  f._node = node; pg.wrap.append(node);
}

function removeField(f) { f._node && f._node.remove(); fields = fields.filter((x) => x !== f); }

function startDrag(e, f, node) {
  if (e.target.classList.contains('del')) return;
  e.preventDefault();
  const pg = pageInfos[f.page];
  const sx = e.clientX, sy = e.clientY;
  const ol = parseFloat(node.style.left), ot = parseFloat(node.style.top);
  const w = node.offsetWidth, h = node.offsetHeight;
  const move = (ev) => {
    const nl = Math.max(0, Math.min(pg.width - w, ol + (ev.clientX - sx)));
    const nt = Math.max(0, Math.min(pg.height - h, ot + (ev.clientY - sy)));
    node.style.left = nl + 'px'; node.style.top = nt + 'px';
  };
  const up = () => {
    document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
    f.xPct = parseFloat(node.style.left) / pg.width; f.yPct = parseFloat(node.style.top) / pg.height;
  };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
}

/* ---- save + send ---- */
async function save() {
  if (!recipients.length) { toast('Add at least one recipient', true); return false; }
  if (!fields.length) { toast('Place at least one field on the document', true); return false; }
  try {
    const res = await API.post(`/api/documents/${docId}/recipients`, { recipients: recipients.map((r, i) => ({ name: r.name, email: r.email, order: i + 1 })) });
    const idMap = {};
    recipients.forEach((r, i) => { idMap[r.id] = res.recipients[i].id; r.id = res.recipients[i].id; r.color = res.recipients[i].color; });
    if (activeRecipientId in idMap) activeRecipientId = idMap[activeRecipientId];
    fields.forEach((f) => { f.recipientId = idMap[f.recipientId] || f.recipientId; });
    await API.post(`/api/documents/${docId}/fields`, { fields: fields.map((f) => ({ recipientId: f.recipientId, page: f.page, type: f.type, xPct: f.xPct, yPct: f.yPct, wPct: f.wPct, hPct: f.hPct, required: f.required })) });
    return true;
  } catch (e) { toast(e.message, true); return false; }
}

async function send() {
  const btn = $('#sendBtn'); btn.disabled = true;
  if (!(await save())) { btn.disabled = false; return; }
  try {
    const res = await API.post(`/api/documents/${docId}/send`);
    showSent(res);
  } catch (e) { toast(e.message, true); }
  btn.disabled = false;
}

function showSent(res) {
  const devNote = res.emailMode === 'dev'
    ? el('div', { class: 'banner warn' }, 'Email is in DEV mode (no SMTP configured). Share these signing links manually to test:')
    : el('div', { class: 'banner ok' }, 'Signing invitations have been emailed. The first signer can sign now.');
  const links = res.recipients.map((r) =>
    el('div', { style: 'margin-bottom:10px' },
      el('div', { class: 'flex between' }, el('b', {}, `${r.order}. ${r.name}`), el('span', { html: badge(r.status) })),
      (r.status === 'sent' || r.status === 'viewed')
        ? el('div', { class: 'copybox', style: 'margin-top:5px' }, el('input', { value: r.signUrl, readonly: 'readonly', onclick: (e) => e.target.select() }), el('button', { class: 'btn sm', onclick: () => copy(r.signUrl) }, 'Copy'))
        : el('div', { class: 'muted small' }, 'Will be notified when it is their turn.')));
  openModal(el('div', {},
    el('div', { class: 'head' }, el('h3', {}, '✓ Sent for signature'), el('button', { class: 'x', onclick: () => location.href = '/' }, '×')),
    el('div', { class: 'body' }, devNote, ...links,
      el('div', { style: 'margin-top:14px' }, el('a', { class: 'btn primary', href: '/' }, 'Back to dashboard')))));
}
