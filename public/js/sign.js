/* Signer page: load session, render PDF, fill fields, submit or decline. */
'use strict';

const token = new URLSearchParams(location.search).get('token');
const overlay = $('#overlay'); const modal = $('#modal');
const openModal = (n) => { modal.innerHTML = ''; modal.append(n); overlay.classList.add('show'); };
const closeModal = () => overlay.classList.remove('show');
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

const banner = $('#banner'); const area = $('#canvas');
let session = null; let pageInfos = []; let fields = []; const values = {};

const todayISO = () => new Date().toISOString().slice(0, 10);
const prettyDate = (iso) => { const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };

start();
async function start() {
  if (!token) { area.innerHTML = '<div class="empty">Invalid signing link.</div>'; return; }
  try { session = await API.get(`/api/sign/${token}`); }
  catch (e) { area.innerHTML = `<div class="container"><div class="banner err">${esc(e.message)}</div></div>`; return; }

  $('#who').textContent = session.sender ? `From ${session.sender.name} (${session.sender.email})` : '';

  if (session.completed && session.alreadySigned) return finishedScreen('This document is complete.', true);
  if (session.declined) return messageScreen('You declined to sign this document.', 'err');
  if (session.alreadySigned) return messageScreen('You have already signed. Thank you — we will notify you when everyone has signed.', 'ok');
  if (!session.myTurn) return messageScreen('This document is waiting on an earlier signer. You will receive an email when it is your turn.', 'info');

  banner.innerHTML = '';
  banner.append(el('div', { class: 'banner info' },
    el('b', {}, session.document.title), session.document.message ? ' — ' + session.document.message : '',
    el('div', { class: 'small', style: 'font-weight:400;margin-top:4px' }, `Signing as ${session.recipient.name} <${session.recipient.email}>`)));

  fields = session.fields.slice();
  // sensible defaults so prefilled fields count as complete
  fields.forEach((f) => {
    if (f.type === 'date') values[f.id] = todayISO();
    else if (f.type === 'name') values[f.id] = session.recipient.name;
    else if (f.type === 'email') values[f.id] = session.recipient.email;
  });

  const targetWidth = Math.min(840, Math.max(460, area.clientWidth - 56));
  pageInfos = await renderPdf(`/api/sign/${token}/file`, area, targetWidth, false);
  fields.forEach(drawField);

  $('#signbar').style.display = 'flex';
  $('#finishBtn').onclick = finish;
  $('#declineBtn').onclick = declineDialog;
  updateProgress();
}

function drawField(f) {
  const pg = pageInfos[f.page]; if (!pg) return;
  const node = el('div', { class: 'sfield todo' });
  node.style.left = (f.xPct * pg.width) + 'px';
  node.style.top = (f.yPct * pg.height) + 'px';
  node.style.width = (f.wPct * pg.width) + 'px';
  node.style.height = (f.hPct * pg.height) + 'px';
  f._node = node; pg.wrap.append(node);

  if (f.type === 'signature' || f.type === 'initials') {
    node.textContent = f.type === 'initials' ? 'Initials' : 'Sign';
    node.onclick = async () => {
      const url = await openSignaturePad(f.type === 'initials' ? '' : session.recipient.name);
      if (!url) return;
      values[f.id] = url; node.innerHTML = ''; node.append(el('img', { src: url })); markDone(f); updateProgress();
    };
  } else if (f.type === 'checkbox') {
    const cb = el('input', { type: 'checkbox', style: 'width:18px;height:18px;cursor:pointer' });
    cb.onchange = () => { values[f.id] = cb.checked; cb.checked ? markDone(f) : markTodo(f); updateProgress(); };
    node.append(cb);
  } else {
    const input = el('input', { type: f.type === 'date' ? 'date' : 'text', value: values[f.id] || '' });
    if (f.type === 'name') input.placeholder = 'Full name';
    if (f.type === 'email') input.placeholder = 'Email';
    if (f.type === 'text') input.placeholder = 'Type here';
    if (values[f.id]) markDone(f);
    input.oninput = () => { values[f.id] = input.value; input.value ? markDone(f) : markTodo(f); updateProgress(); };
    node.append(input);
  }
}

function markDone(f) { f._node.classList.remove('todo'); f._node.classList.add('done'); }
function markTodo(f) { f._node.classList.add('todo'); f._node.classList.remove('done'); }

function filled(f) { const v = values[f.id]; return !(v == null || v === '' || v === false); }
function updateProgress() {
  const req = fields.filter((f) => f.required);
  const done = req.filter(filled).length;
  $('#progress').textContent = `${done} of ${req.length} required`;
  $('#finishBtn').disabled = false;
}

async function finish() {
  const firstMissing = fields.find((f) => f.required && !filled(f));
  if (firstMissing) {
    toast('Please complete all required fields', true);
    firstMissing._node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    firstMissing._node.animate([{ boxShadow: '0 0 0 3px rgba(220,38,38,.6)' }, { boxShadow: 'none' }], { duration: 900 });
    return;
  }
  const payload = {};
  fields.forEach((f) => {
    if (!filled(f)) return;
    payload[f.id] = f.type === 'date' ? prettyDate(values[f.id]) : values[f.id];
  });
  $('#finishBtn').disabled = true;
  try {
    const res = await API.post(`/api/sign/${token}`, { values: payload });
    if (res.completed) finishedScreen('All parties have signed. The document is complete!', true);
    else finishedScreen('Thank you. Your signature has been recorded — the remaining signers have been notified.', false);
  } catch (e) { toast(e.message, true); $('#finishBtn').disabled = false; }
}

function declineDialog() {
  const reason = el('textarea', { rows: '3', placeholder: 'Optional: let the sender know why' });
  openModal(el('div', {},
    el('div', { class: 'head' }, el('h3', {}, 'Decline to sign'), el('button', { class: 'x', onclick: closeModal }, '×')),
    el('div', { class: 'body' },
      el('p', { class: 'muted' }, 'The sender will be notified and the document will be closed.'),
      el('label', { class: 'fld' }, el('span', {}, 'Reason'), reason),
      el('div', { class: 'flex between' }, el('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
        el('button', { class: 'btn danger', onclick: async () => {
          try { await API.post(`/api/sign/${token}/decline`, { reason: reason.value }); closeModal(); messageScreen('You have declined to sign. The sender has been notified.', 'err'); }
          catch (e) { toast(e.message, true); }
        } }, 'Confirm decline')))));
}

function messageScreen(msg, kind) {
  $('#signbar').style.display = 'none'; banner.innerHTML = '';
  area.innerHTML = `<div class="container"><div class="card pad" style="text-align:center"><div class="banner ${kind}" style="margin:0">${esc(msg)}</div></div></div>`;
}

function finishedScreen(msg, canDownload) {
  $('#signbar').style.display = 'none'; banner.innerHTML = '';
  const card = el('div', { class: 'card pad', style: 'text-align:center;max-width:520px;margin:6vh auto' },
    el('div', { style: 'font-size:48px' }, '✓'),
    el('h2', { style: 'margin:6px 0' }, 'Done!'),
    el('p', { class: 'muted' }, msg),
    canDownload ? el('a', { class: 'btn green', href: `/api/sign/${token}/download` }, '↓ Download signed PDF') : null);
  area.innerHTML = ''; area.append(card);
}
