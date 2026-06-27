'use strict';
const db = require('./db');

/**
 * Append an immutable audit event. Events recorded:
 *  document.created, document.sent, recipient.sent, recipient.viewed,
 *  recipient.signed, recipient.declined, document.completed, document.voided
 */
function log(documentId, event, opts = {}) {
  return db.insert('audit', {
    documentId,
    event,
    recipientId: opts.recipientId || null,
    actor: opts.actor || null,
    ip: opts.ip || null,
    userAgent: opts.userAgent || null,
    detail: opts.detail || null,
  });
}

function forDocument(documentId) {
  return db
    .where('audit', (a) => a.documentId === documentId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

module.exports = { log, forDocument };
