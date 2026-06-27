'use strict';
const nodemailer = require('nodemailer');
const { esc } = require('./util');

let transporter = null;
let mode = 'dev';

(function init() {
  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE) === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    mode = 'smtp';
  } else {
    transporter = nodemailer.createTransport({ jsonTransport: true });
    mode = 'dev';
  }
})();

const FROM = process.env.MAIL_FROM || 'DeoDap eSign <no-reply@deodap.local>';

// attachments: optional array of { filename, content (Buffer), contentType }
async function sendMail(to, subject, html, attachments) {
  try {
    const msg = { from: FROM, to, subject, html };
    if (attachments && attachments.length) msg.attachments = attachments;
    const info = await transporter.sendMail(msg);
    if (mode === 'dev') {
      const note = attachments && attachments.length ? `  (+${attachments.length} attachment)` : '';
      console.log(`\n────────── [email • DEV] ──────────\n To:      ${to}\n Subject: ${subject}${note}\n───────────────────────────────────`);
    }
    return { ok: true, mode, info };
  } catch (e) {
    console.error('[email] sendMail error:', e.message);
    return { ok: false, error: e.message };
  }
}

const shell = (inner) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#1f2937">
     <div style="font-size:20px;font-weight:700;color:#2563eb;padding:8px 0">DeoDap&nbsp;eSign</div>
     ${inner}
     <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
     <div style="font-size:12px;color:#9ca3af">Sent by DeoDap eSign. If you weren't expecting this, you can ignore it.</div>
   </div>`;

function signRequestEmail({ recipientName, senderName, docTitle, url, message }) {
  return shell(`
    <p>Hi ${esc(recipientName)},</p>
    <p><b>${esc(senderName)}</b> has requested your signature on <b>${esc(docTitle)}</b>.</p>
    ${message ? `<p style="background:#f3f4f6;border-radius:8px;padding:12px;color:#374151">${esc(message)}</p>` : ''}
    <p style="margin:24px 0">
      <a href="${esc(url)}" style="background:#2563eb;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Review &amp; Sign</a>
    </p>
    <p style="font-size:12px;color:#6b7280">Or paste this link into your browser:<br>${esc(url)}</p>`);
}

function completedEmail({ docTitle, url, attached }) {
  return shell(`
    <p>Good news — <b>${esc(docTitle)}</b> has been signed by all parties and is now complete.</p>
    ${attached ? `<p>The signed PDF is <b>attached</b> to this email.</p>` : ''}
    ${url ? `<p style="margin:24px 0"><a href="${esc(url)}" style="background:#16a34a;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">View signed document</a></p>` : ''}`);
}

function declinedEmail({ docTitle, who, reason }) {
  return shell(`
    <p><b>${esc(who)}</b> declined to sign <b>${esc(docTitle)}</b>.</p>
    ${reason ? `<p style="background:#fef2f2;border-radius:8px;padding:12px;color:#991b1b">Reason: ${esc(reason)}</p>` : ''}`);
}

function plainEmail({ title, body }) {
  return shell(`${title ? `<p><b>${esc(title)}</b></p>` : ''}<p>${esc(body)}</p><p>The signed PDF is attached.</p>`);
}

module.exports = { sendMail, signRequestEmail, completedEmail, declinedEmail, plainEmail, mode };
