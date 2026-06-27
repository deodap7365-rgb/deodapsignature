'use strict';
const fs = require('fs');
const path = require('path');
const db = require('./db');
const audit = require('./audit');
const mail = require('./email');
const { generateSignedPdf } = require('./pdf');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

// Public base URL for signing links. Auto-detected on common hosts so links are
// correct without manual config; override with APP_URL if needed.
const APP_URL = (
  process.env.APP_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : '') ||
  ('http://localhost:' + (process.env.PORT || 3000))
).replace(/\/$/, '');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const originalPath = (docId) => path.join(UPLOAD_DIR, docId + '.pdf');
const signedPath = (docId) => path.join(UPLOAD_DIR, docId + '.signed.pdf');
const signUrl = (token) => `${APP_URL}/sign.html?token=${token}`;
const safeName = (s) => String(s || 'document').replace(/[^\w.-]+/g, '_');

const recipientsOf = (docId) =>
  db.where('recipients', (r) => r.documentId === docId).sort((a, b) => a.order - b.order || (a.createdAt < b.createdAt ? -1 : 1));

/**
 * Activate the next pending signing "group" (all recipients sharing the lowest
 * pending order) and email them their unique signing link.
 */
async function activateNext(doc) {
  const pending = recipientsOf(doc.id).filter((r) => r.status === 'pending');
  if (!pending.length) return [];
  const nextOrder = pending[0].order;
  const group = pending.filter((r) => r.order === nextOrder);
  const owner = db.get('users', doc.ownerId);
  for (const r of group) {
    db.update('recipients', r.id, { status: 'sent', sentAt: db.now() });
    audit.log(doc.id, 'recipient.sent', { recipientId: r.id, detail: r.email });
    await mail.sendMail(
      r.email,
      `Signature requested: ${doc.title}`,
      mail.signRequestEmail({
        recipientName: r.name,
        senderName: owner ? owner.name : 'A sender',
        docTitle: doc.title,
        url: signUrl(r.token),
        message: doc.message,
      })
    );
  }
  return group;
}

// Finalize: stamp the PDF, append the certificate, mark complete, and email the
// SIGNED PDF as an attachment to the owner and every signer.
async function complete(doc) {
  const originalBytes = fs.readFileSync(originalPath(doc.id));
  const recipients = recipientsOf(doc.id);
  const fields = db.where('fields', (f) => f.documentId === doc.id);
  const buf = await generateSignedPdf({ originalBytes, doc, recipients, fields });
  fs.writeFileSync(signedPath(doc.id), buf);

  const updated = db.update('documents', doc.id, { status: 'completed', completedAt: db.now() });
  audit.log(doc.id, 'document.completed', {});

  const attachments = [{ filename: safeName(doc.title) + '-signed.pdf', content: buf, contentType: 'application/pdf' }];
  const owner = db.get('users', doc.ownerId);
  if (owner) await mail.sendMail(owner.email, `Completed: ${doc.title}`, mail.completedEmail({ docTitle: doc.title, attached: true }), attachments);
  for (const r of recipients) {
    await mail.sendMail(r.email, `Completed: ${doc.title}`, mail.completedEmail({ docTitle: doc.title, url: signUrl(r.token), attached: true }), attachments);
  }
  audit.log(doc.id, 'document.emailed', { detail: 'signed PDF sent to owner + ' + recipients.length + ' signer(s)' });
  return updated;
}

/**
 * Called after a recipient signs. If others in the current group are still
 * outstanding, wait. Otherwise activate the next group, or complete.
 */
async function advanceAfterSignature(doc) {
  const stillActive = db.where('recipients', (r) => r.documentId === doc.id && (r.status === 'sent' || r.status === 'viewed'));
  if (stillActive.length > 0) {
    return db.update('documents', doc.id, { status: 'in_progress' });
  }
  const activated = await activateNext(doc);
  if (activated.length === 0) return complete(doc);
  return db.update('documents', doc.id, { status: 'in_progress' });
}

module.exports = { activateNext, complete, advanceAfterSignature, signUrl, recipientsOf, safeName, UPLOAD_DIR, APP_URL, originalPath, signedPath };
