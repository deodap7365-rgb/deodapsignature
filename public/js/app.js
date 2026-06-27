/* Dashboard: auth, document list, upload, tracking + audit, email signed PDF. */
'use strict';

const view = $('#view');
const overlay = $('#overlay');
const modal = $('#modal');
let me = null;

const openModal = (node) => { modal.innerHTML = ''; modal.append(node); overlay.classList.add('show'); };
const closeModal = () => overlay.classList.remove('show');
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

init();
async function init() {
  try { me = (await API.get('/api/auth/me')).user; renderUser(); dashboard(); }
  catch (e) { me = null; renderUser(); authScreen(); }
}

function renderUser() {
  const area = $('#userArea');
  area.innerHTML = '';
  if (me) {
    area.append(
      el('span', { class: 'muted small' }, me.email),
      el('button', { class: 'btn sm', onclick: logout }, 'Sign out')
    );
  }
}
async function logout() { await API.post('/api/auth/logout'); location.reload(); }

/* ---------------- Auth ---------------- */
function authScreen() {
  let mode = 'login';
  const wrap = el('div', { class: 'auth-wrap' });
  const card = el('div', { class: 'card pad' });
  const form = el('div');
  const tabs = el('div', { class: 'tabs' },
    el('button', { class: 'active', onclick: () => switchMode('login') }, 'Sign in'),
    el('button', { onclick: () => switchMode('register') }, 'Create account'));

  const nameI = el('input', { type: 'text', placeholder: 'Your name' });
  const emailI = el('input', { type: 'email', placeholder: 'you@deodap.com' });
  const passI = el('input', { type: 'password', placeholder: 'Password (min 6 chars)' });
  const btn = el('button', { class: 'btn primary', style: 'width:100%', onclick: submit }, 'Sign in');
  const nameField = el('label', { class: 'fld', style: 'display:none' }, el('span', {}, 'Name'), nameI);

  function switchMode(m) {
    mode = m;
    $$('.tabs button', tabs).forEach((b, i) => b.classList.toggle('active', (m === 'login') === (i === 0)));
    nameField.style.display = m === 'register' ? '' : 'none';
    btn.textContent = m === 'login' ? 'Sign in' : 'Create account';
  }
  async function submit() {
    try {
      const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'login'
        ? { email: emailI.value, password: passI.value }
        : { name: nameI.value, email: emailI.value, password: passI.value };
      await API.post(url, body);
      location.reload();
    } catch (e) { toast(e.message, true); }
  }
  passI.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  form.append(
    nameField,
    el('label', { class: 'fld' }, el('span', {}, 'Email'), emailI),
    el('label', { class: 'fld' }, el('span', {}, 'Password'), passI),
    btn);
  card.append(el('h2', {}, 'Welcome to DeoDap eSign'),
    el('p', { class: 'muted', style: 'margin-top:-4px' }, 'Send documents for secure electronic signature.'),
    tabs, form);
  wrap.append(card);
  view.innerHTML = ''; view.append(wrap);
}

/* ---------------- Dashboard ---------------- */
async function dashboard() {
  view.innerHTML = '';
  const head = el('div', { class: 'flex between', style: 'margin-bottom:18px' },
    el('div', {}, el('h2', { style: 'margin:0' }, 'Documents'),
      el('div', { class: 'muted small' }, 'Upload a PDF, place fields, and route it for signature.')),
    el('button', { class: 'btn primary', onclick: uploadDialog }, '+ New document'));
  const listCard = el('div', { class: 'card' }, el('div', { class: 'empty' }, 'Loading…'));
  view.append(el('div', { class: 'container' }, head, listCard));

  try {
    const { documents } = await API.get('/api/documents');
    listCard.innerHTML = '';
    if (!documents.length) {
      listCard.append(el('div', { class: 'empty' },
        el('div', { style: 'font-size:40px' }, '📄'),
        el('h3', { style: 'margin:10px 0 4px' }, 'No documents yet'),
        el('div', { class: 'muted' }, 'Click “New document” to upload your first PDF.')));
      return;
    }
    documents.forEach((d) => listCard.append(docRow(d)));
  } catch (e) { listCard.innerHTML = ''; listCard.append(el('div', { class: 'empty' }, e.message)); }
}

function docRow(d) {
  const avatars = el('div', { class: 'avatars' });
  (d.recipients || []).forEach((r) =>
    avatars.append(el('div', { class: 'av', title: `${r.name} — ${r.status}`, style: `background:${r.color || '#94a3b8'}` }, initials(r.name))));

  const actions = el('div', { class: 'actions' });
  if (d.status === 'draft') {
    actions.append(el('a', { class: 'btn sm primary', href: `/prepare.html?id=${d.id}` }, 'Prepare & send'));
    actions.append(el('button', { class: 'btn sm danger', onclick: () => voidDoc(d.id) }, 'Delete'));
  } else if (d.status === 'completed') {
    actions.append(el('a', { class: 'btn sm green', href: `/api/documents/${d.id}/download?type=signed` }, '↓ Signed PDF'));
    actions.append(el('button', { class: 'btn sm', onclick: () => emailDialog(d.id) }, '✉ Email'));
    actions.append(el('button', { class: 'btn sm', onclick: () => trackDialog(d.id) }, 'Details'));
  } else if (d.status === 'voided' || d.status === 'declined') {
    actions.append(el('button', { class: 'btn sm', onclick: () => trackDialog(d.id) }, 'Details'));
  } else {
    actions.append(el('button', { class: 'btn sm primary', onclick: () => trackDialog(d.id) }, 'Track'));
    actions.append(el('button', { class: 'btn sm', onclick: () => remind(d.id) }, 'Remind'));
  }

  return el('div', { class: 'doc-row' },
    el('div', { class: 'grow' },
      el('div', { class: 'title' }, d.title),
      el('div', { class: 'meta' }, `${d.pageCount} page${d.pageCount === 1 ? '' : 's'} · created ${fmtDate(d.createdAt)}`)),
    avatars,
    el('div', { html: badge(d.status) }),
    actions);
}

/* ---------------- Upload ---------------- */
function uploadDialog() {
  const fileI = el('input', { type: 'file', accept: 'application/pdf' });
  const titleI = el('input', { type: 'text', placeholder: 'e.g. Vendor NDA (defaults to file name)' });
  const status = el('div', { class: 'muted small' });
  const go = el('button', { class: 'btn primary', onclick: submit }, 'Upload & continue');

  async function submit() {
    if (!fileI.files[0]) { toast('Choose a PDF first', true); return; }
    go.disabled = true; status.textContent = 'Uploading…';
    try {
      const fd = new FormData();
      fd.append('file', fileI.files[0]);
      if (titleI.value) fd.append('title', titleI.value);
      const { document } = await API.postForm('/api/documents', fd);
      location.href = `/prepare.html?id=${document.id}`;
    } catch (e) { toast(e.message, true); go.disabled = false; status.textContent = ''; }
  }

  openModal(el('div', {},
    el('div', { class: 'head' }, el('h3', {}, 'New document'), el('button', { class: 'x', onclick: closeModal }, '×')),
    el('div', { class: 'body' },
      el('label', { class: 'fld' }, el('span', {}, 'PDF file'), fileI),
      el('label', { class: 'fld' }, el('span', {}, 'Title (optional)'), titleI),
      el('div', { class: 'flex between', style: 'margin-top:8px' }, status, go))));
}

/* ---------------- Email signed PDF ---------------- */
function emailDialog(id) {
  const toI = el('input', { type: 'email', placeholder: 'name@example.com (blank = your account email)' });
  const status = el('div', { class: 'muted small' });
  const go = el('button', { class: 'btn primary', onclick: submit }, 'Send signed PDF');
  async function submit() {
    go.disabled = true; status.textContent = 'Sending…';
    try {
      const r = await API.post(`/api/documents/${id}/email`, { to: toI.value });
      toast(r.emailMode === 'dev'
        ? `Queued for ${r.to} (DEV mode — configure SMTP to actually deliver)`
        : `Signed PDF emailed to ${r.to}`);
      closeModal();
    } catch (e) { toast(e.message, true); go.disabled = false; status.textContent = ''; }
  }
  openModal(el('div', {},
    el('div', { class: 'head' }, el('h3', {}, 'Email signed PDF'), el('button', { class: 'x', onclick: closeModal }, '×')),
    el('div', { class: 'body' },
      el('p', { class: 'muted', style: 'margin-top:0' }, 'Sends the signed PDF as an email attachment.'),
      el('label', { class: 'fld' }, el('span', {}, 'Recipient email'), toI),
      el('div', { class: 'flex between', style: 'margin-top:8px' }, status, go))));
}

/* ---------------- Track / details + audit ---------------- */
async function trackDialog(id) {
  openModal(el('div', {}, el('div', { class: 'body' }, 'Loading…')));
  try {
    const [{ document: doc, recipients }, audit] = await Promise.all([
      API.get(`/api/documents/${id}`), API.get(`/api/documents/${id}/audit`),
    ]);
    const recipNodes = recipients.map((r) => {
      const canCopy = r.status === 'sent' || r.status === 'viewed';
      return el('div', { style: 'padding:10px 0;border-bottom:1px solid var(--line)' },
        el('div', { class: 'flex between' },
          el('div', { class: 'flex' },
            el('span', { class: 'av', style: `background:${r.color};width:26px;height:26px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:11px;font-weight:700` }, initials(r.name)),
            el('div', {}, el('b', {}, `${r.name} `), el('span', { class: 'muted small' }, r.email))),
          el('div', { html: badge(r.status) })),
        canCopy ? el('div', { class: 'copybox', style: 'margin-top:8px' },
          el('input', { value: r.signUrl, readonly: 'readonly', onclick: (e) => e.target.select() }),
          el('button', { class: 'btn sm', onclick: () => copy(r.signUrl) }, 'Copy link')) : null);
    });

    const timeline = el('ul', { class: 'tl' }, audit.events.map((e) =>
      el('li', {}, el('div', { class: 'ev' }, TITLECASE(e.event.replace('.', ' '))),
        el('div', { class: 'muted small' }, `${fmtDate(e.createdAt)}${e.actor ? ' · ' + e.actor : ''}${e.ip ? ' · ' + e.ip : ''}${e.detail ? ' · ' + e.detail : ''}`))));

    const dl = doc.status === 'completed'
      ? el('div', { class: 'flex', style: 'gap:8px;flex-wrap:wrap' },
          el('a', { class: 'btn green sm', href: `/api/documents/${id}/download?type=signed` }, '↓ Download signed PDF'),
          el('button', { class: 'btn sm', onclick: () => emailDialog(id) }, '✉ Email signed PDF'))
      : null;

    openModal(el('div', {},
      el('div', { class: 'head' },
        el('div', {}, el('h3', { style: 'margin:0' }, doc.title), el('span', { html: badge(doc.status) })),
        el('button', { class: 'x', onclick: closeModal }, '×')),
      el('div', { class: 'body' },
        el('h3', { class: 'muted small', style: 'text-transform:uppercase;letter-spacing:.5px' }, 'Recipients'),
        ...recipNodes,
        dl ? el('div', { style: 'margin:14px 0' }, dl) : null,
        el('h3', { class: 'muted small', style: 'text-transform:uppercase;letter-spacing:.5px;margin-top:18px' }, 'Audit trail'),
        timeline)));
  } catch (e) { toast(e.message, true); closeModal(); }
}

async function remind(id) {
  try { const r = await API.post(`/api/documents/${id}/remind`); toast(r.reminded ? `Reminder sent to ${r.reminded} signer(s)` : 'No active signers to remind'); }
  catch (e) { toast(e.message, true); }
}
async function voidDoc(id) {
  if (!confirm('Delete this draft? This cannot be undone.')) return;
  try { await API.post(`/api/documents/${id}/void`); toast('Draft removed'); dashboard(); }
  catch (e) { toast(e.message, true); }
}
