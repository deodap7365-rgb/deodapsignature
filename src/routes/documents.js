'use strict';
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();

const db = require('../db');
const auth = require('../auth');
const audit = require('../audit');
const wf = require('../workflow');
const { getPageSizes } = require('../pdf');
const { clientIp, sha256 } = require('../util');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const COLORS = ['#2563eb', '#db2777', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#4f46e5'];
const FIELD_TYPES = ['signature', 'initials', 'date', 'text', 'name', 'email', 'checkbox'];

function loadOwned(req, res) {
  const doc = db.get('documents', req.params.id);
  if (!doc || doc.ownerId !== req.user.id) { res.status(404).json({ error: 'Document not found' }); return null; }
  return doc;
}

const recipientPublic = (r) => ({
  id: r.id, name: r.name, email: r.email, order: r.order, color: r.color,
  status: r.status, signedAt: r.signedAt || null, viewedAt: r.viewedAt || null,
  declineReason: r.declineReason || null, signUrl: wf.signUrl(r.token),
});

const recipientSummary = (docId) =>
  wf.recipientsOf(docId).map((r) => ({ name: r.name, email: r.email, status: r.status, order: r.order, color: r.color }));

router.use(auth.authRequired);

// Create a document by uploading a PDF
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'A PDF file is required (form field "file")' });
  const isPdf = req.file.mimetype === 'application/pdf' || /\.pdf$/i.test(req.file.originalname || '');
  if (!isPdf) return res.status(400).json({ error: 'Only PDF files are supported' });
  let pages;
  try { pages = await getPageSizes(req.file.buffer); }
  catch (e) { return res.status(400).json({ error: 'Could not read PDF: ' + e.message }); }
  const doc = db.insert('documents', {
    ownerId: req.user.id,
    title: (req.body.title || req.file.originalname || 'Untitled').replace(/\.pdf$/i, ''),
    message: req.body.message || '',
    status: 'draft', pageCount: pages.length, pages,
    originalSha256: sha256(req.file.buffer), sentAt: null, completedAt: null,
  });
  fs.writeFileSync(wf.originalPath(doc.id), req.file.buffer);
  audit.log(doc.id, 'document.created', { actor: req.user.email, ip: clientIp(req) });
  res.json({ document: doc });
});

// List the current user's documents
router.get('/', (req, res) => {
  const documents = db.where('documents', (d) => d.ownerId === req.user.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((d) => ({ id: d.id, title: d.title, status: d.status, pageCount: d.pageCount,
      createdAt: d.createdAt, sentAt: d.sentAt, completedAt: d.completedAt, recipients: recipientSummary(d.id) }));
  res.json({ documents });
});

// Full detail (recipients + fields)
router.get('/:id', (req, res) => {
  const doc = loadOwned(req, res); if (!doc) return;
  res.json({ document: doc, recipients: wf.recipientsOf(doc.id).map(recipientPublic), fields: db.where('fields', (f) => f.documentId === doc.id) });
});

// Update title / message (draft only)
router.put('/:id', (req, res) => {
  const doc = loadOwned(req, res); if (!doc) return;
  if (doc.status !== 'draft') return res.status(409).json({ error: 'Only draft documents can be edited' });
  const patch = {};
  if (typeof req.body.title === 'string') patch.title = req.body.title;
  if (typeof req.body.message === 'string') patch.message = req.body.message;
  res.json({ document: db.update('documents', doc.id, patch) });
});

// Replace recipients (draft only)
router.post('/:id/recipients', (req, res) => {
  const doc = loadOwned(req, res); if (!doc) return;
  if (doc.status !== 'draft') return res.status(409).json({ error: 'Recipients can only be set on a draft' });
  const list = Array.isArray(req.body.recipients) ? req.body.recipients : [];
  if (!list.length) return res.status(400).json({ error: 'At least one recipient is required' });
  for (const r of list) {
    if (!r.name || !r.email) return res.status(400).json({ error: 'Each recipient needs a name and email' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) return res.status(400).json({ error: `Invalid email: ${r.email}` });
  }
  db.removeWhere('fields', (f) => f.documentId === doc.id);
  db.removeWhere('recipients', (r) => r.documentId === doc.id);
  list.forEach((r, i) => {
    db.insert('recipients', {
      documentId: doc.id, name: String(r.name).trim(), email: String(r.email).trim(),
      order: Number.isFinite(r.order) ? Number(r.order) : i + 1, role: 'signer',
      color: COLORS[i % COLORS.length], status: 'pending', token: db.uuid(),
      sentAt: null, viewedAt: null, signedAt: null, signedIp: null, signedUserAgent: null, declineReason: null,
    });
  });
  res.json({ recipients: wf.recipientsOf(doc.id).map(recipientPublic) });
});

// Replace fields (draft only)
router.post('/:id/fields', (req, res) => {
  const doc = loadOwned(req, res); if (!doc) return;
  if (doc.status !== 'draft') return res.status(409).json({ error: 'Fields can only be set on a draft' });
  const list = Array.isArray(req.body.fields) ? req.body.fields : [];
  const recIds = new Set(wf.recipientsOf(doc.id).map((r) => r.id));
  for (const f of list) {
    if (!recIds.has(f.recipientId)) return res.status(400).json({ error: 'Field references an unknown recipient' });
    if (!FIELD_TYPES.includes(f.type)) return res.status(400).json({ error: 'Unknown field type: ' + f.type });
    if (!(f.page >= 0 && f.page < doc.pageCount)) return res.status(400).json({ error: 'Field page out of range' });
  }
  db.removeWhere('fields', (f) => f.documentId === doc.id);
  const saved = list.map((f) => db.insert('fields', {
    documentId: doc.id, recipientId: f.recipientId, page: Number(f.page), type: f.type,
    xPct: clamp(f.xPct), yPct: clamp(f.yPct), wPct: clamp(f.wPct), hPct: clamp(f.hPct),
    required: f.required !== false, label: f.label || '', value: null, signedAt: null,
  }));
  res.json({ fields: saved });
});

// Send for signature
router.post('/:id/send', async (req, res) => {
  const doc = loadOwned(req, res); if (!doc) return;
  if (doc.status !== 'draft') return res.status(409).json({ error: 'Document has already been sent' });
  const recipients = wf.recipientsOf(doc.id);
  if (!recipients.length) return res.status(400).json({ error: 'Add at least one recipient before sending' });
  if (!db.where('fields', (f) => f.documentId === doc.id).length) return res.status(400).json({ error: 'Add at least one field before sending' });
  db.update('documents', doc.id, { status: 'sent', sentAt: db.now() });
  audit.log(doc.id, 'document.sent', { actor: req.user.email, ip: clientIp(req) });
  await wf.activateNext(db.get('documents', doc.id));
  res.json({ document: db.get('documents', doc.id), recipients: wf.recipientsOf(doc.id).map(recipientPublic), emailMode: require('../email').mode });
});

// Resend invite to whoever is currently active
router.post('/:id/remind', async (req, res) => {
  const doc = loadOwned(req, res); if (!doc) return;
  const active = db.where('recipients', (r) => r.documentId === doc.id && (r.status === 'sent' || r.status === 'viewed'));
  const mail = require('../email');
  const owner = db.get('users', doc.ownerId);
  for (const r of active) {
    await mail.sendMail(r.email, `Reminder: please sign ${doc.title}`,
      mail.signRequestEmail({ recipientName: r.name, senderName: owner.name, docTitle: doc.title, url: wf.signUrl(r.token), message: doc.message }));
    audit.log(doc.id, 'recipient.sent', { recipientId: r.id, detail: 'reminder' });
  }
  res.json({ reminded: active.length });
});

// Void a document
router.post('/:id/void', (req, res) => {
  const doc = loadOwned(req, res); if (!doc) return;
  if (doc.status === 'completed') return res.status(409).json({ error: 'Completed documents cannot be voided' });
  db.update('documents', doc.id, { status: 'voided' });
  audit.log(doc.id, 'document.voided', { actor: req.user.email, ip: clientIp(req), detail: req.body.reason || '' });
  res.json({ document: db.get('documents', doc.id) });
});

// Audit trail
router.get('/:id/audit', (req, res) => {
  const doc = loadOwned(req, res); if (!doc) return;
  res.json({ events: audit.forDocument(doc.id), recipients: wf.recipientsOf(doc.id).map(recipientPublic) });
});

// Serve the original PDF bytes (for the prepare UI)
router.get('/:id/file', (req, res) => {
  const doc = loadOwned(req, res); if (!doc) return;
  sendPdf(res, wf.originalPath(doc.id), doc.title);
});

// Download original or signed PDF
router.get('/:id/download', (req, res) => {
  const doc = loadOwned(req, res); if (!doc) return;
  const wantSigned = req.query.type === 'signed';
  if (wantSigned && doc.status !== 'completed') return res.status(409).json({ error: 'Signed document is not ready yet' });
  const p = wantSigned ? wf.signedPath(doc.id) : wf.originalPath(doc.id);
  sendPdf(res, p, doc.title + (wantSigned ? '-signed' : ''), true);
});

// Email the signed PDF as an attachment to a chosen address (defaults to the owner)
router.post('/:id/email', async (req, res) => {
  const doc = loadOwned(req, res); if (!doc) return;
  if (doc.status !== 'completed') return res.status(409).json({ error: 'Signed document is not ready to email yet' });
  const mailer = require('../email');
  const to = (req.body && req.body.to && String(req.body.to).trim()) || (db.get('users', doc.ownerId) || {}).email;
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'A valid destination email is required' });
  const p = wf.signedPath(doc.id);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Signed file not found' });
  const result = await mailer.sendMail(
    to,
    `Signed document: ${doc.title}`,
    mailer.plainEmail({ title: doc.title, body: 'Please find the signed document attached.' }),
    [{ filename: wf.safeName(doc.title) + '-signed.pdf', content: fs.readFileSync(p), contentType: 'application/pdf' }]
  );
  if (!result.ok) return res.status(502).json({ error: 'Email failed: ' + (result.error || 'unknown') });
  audit.log(doc.id, 'document.emailed', { actor: req.user.email, detail: to });
  res.json({ ok: true, to, emailMode: mailer.mode });
});

function sendPdf(res, p, name, asAttachment) {
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${asAttachment ? 'attachment' : 'inline'}; filename="${name.replace(/[^\w.-]+/g, '_')}.pdf"`);
  fs.createReadStream(p).pipe(res);
}

function clamp(n) { n = Number(n); if (!Number.isFinite(n)) return 0; return Math.max(0, Math.min(1, n)); }

module.exports = router;
