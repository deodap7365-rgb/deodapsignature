'use strict';
const express = require('express');
const fs = require('fs');
const router = express.Router();

const db = require('../db');
const audit = require('../audit');
const wf = require('../workflow');
const mail = require('../email');
const { clientIp } = require('../util');

// Resolve a recipient by signing token, plus their document.
function resolve(req, res) {
  const r = db.where('recipients', (x) => x.token === req.params.token)[0];
  if (!r) { res.status(404).json({ error: 'Invalid or expired signing link' }); return null; }
  const doc = db.get('documents', r.documentId);
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return null; }
  return { r, doc };
}

// Load the signing session
router.get('/:token', (req, res) => {
  const ctx = resolve(req, res); if (!ctx) return;
  const { r, doc } = ctx;
  if (doc.status === 'voided') return res.status(410).json({ error: 'This document has been voided by the sender' });
  if (doc.status === 'declined') return res.status(410).json({ error: 'This document was declined and is closed' });

  const owner = db.get('users', doc.ownerId);
  const myTurn = r.status === 'sent' || r.status === 'viewed';
  if (r.status === 'sent') {
    db.update('recipients', r.id, { status: 'viewed', viewedAt: db.now() });
    audit.log(doc.id, 'recipient.viewed', { recipientId: r.id, actor: r.email, ip: clientIp(req), userAgent: req.headers['user-agent'] });
  }

  res.json({
    document: { id: doc.id, title: doc.title, message: doc.message, status: doc.status, pages: doc.pages, pageCount: doc.pageCount },
    sender: owner ? { name: owner.name, email: owner.email } : null,
    recipient: { id: r.id, name: r.name, email: r.email, status: db.get('recipients', r.id).status, color: r.color },
    myTurn,
    alreadySigned: r.status === 'signed',
    declined: r.status === 'declined',
    completed: doc.status === 'completed',
    fields: db.where('fields', (f) => f.documentId === doc.id && f.recipientId === r.id)
      .map((f) => ({ id: f.id, page: f.page, type: f.type, xPct: f.xPct, yPct: f.yPct, wPct: f.wPct, hPct: f.hPct, required: f.required, value: f.value })),
  });
});

// Serve the PDF bytes for signing (token-gated, no login)
router.get('/:token/file', (req, res) => {
  const ctx = resolve(req, res); if (!ctx) return;
  const p = ctx.doc.status === 'completed' ? wf.signedPath(ctx.doc.id) : wf.originalPath(ctx.doc.id);
  const path2 = fs.existsSync(p) ? p : wf.originalPath(ctx.doc.id);
  if (!fs.existsSync(path2)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', 'application/pdf');
  fs.createReadStream(path2).pipe(res);
});

// Submit signature / field values
router.post('/:token', async (req, res) => {
  const ctx = resolve(req, res); if (!ctx) return;
  const { r, doc } = ctx;
  if (['voided', 'declined'].includes(doc.status)) return res.status(410).json({ error: 'This document is no longer available for signing' });
  if (r.status === 'signed') return res.status(409).json({ error: 'You have already signed this document' });
  if (!['sent', 'viewed'].includes(r.status)) return res.status(403).json({ error: 'It is not your turn to sign yet' });

  const values = (req.body && req.body.values) || {};
  const fields = db.where('fields', (f) => f.documentId === doc.id && f.recipientId === r.id);
  for (const f of fields) {
    const v = values[f.id];
    const empty = v == null || v === '' || v === false;
    if (f.required && empty) return res.status(400).json({ error: 'Please complete all required fields before submitting' });
  }
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(values, f.id)) {
      db.update('fields', f.id, { value: values[f.id], signedAt: db.now() });
    }
  }
  db.update('recipients', r.id, {
    status: 'signed', signedAt: db.now(), signedIp: clientIp(req), signedUserAgent: req.headers['user-agent'] || null,
  });
  audit.log(doc.id, 'recipient.signed', { recipientId: r.id, actor: r.email, ip: clientIp(req), userAgent: req.headers['user-agent'] });

  const updated = await wf.advanceAfterSignature(db.get('documents', doc.id));
  res.json({ ok: true, status: updated.status, completed: updated.status === 'completed' });
});

// Decline to sign
router.post('/:token/decline', async (req, res) => {
  const ctx = resolve(req, res); if (!ctx) return;
  const { r, doc } = ctx;
  if (r.status === 'signed') return res.status(409).json({ error: 'You have already signed this document' });
  const reason = (req.body && req.body.reason) || '';
  db.update('recipients', r.id, { status: 'declined', declineReason: reason });
  db.update('documents', doc.id, { status: 'declined' });
  audit.log(doc.id, 'recipient.declined', { recipientId: r.id, actor: r.email, ip: clientIp(req), detail: reason });
  const owner = db.get('users', doc.ownerId);
  if (owner) await mail.sendMail(owner.email, `Declined: ${doc.title}`, mail.declinedEmail({ docTitle: doc.title, who: r.name, reason }));
  res.json({ ok: true, status: 'declined' });
});

// Download the completed, signed PDF (after completion)
router.get('/:token/download', (req, res) => {
  const ctx = resolve(req, res); if (!ctx) return;
  if (ctx.doc.status !== 'completed') return res.status(409).json({ error: 'Signed document is not ready yet' });
  const p = wf.signedPath(ctx.doc.id);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${ctx.doc.title.replace(/[^\w.-]+/g, '_')}-signed.pdf"`);
  fs.createReadStream(p).pipe(res);
});

module.exports = router;
