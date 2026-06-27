'use strict';
/**
 * End-to-end smoke test of the full signing flow — no browser required.
 * register -> upload -> recipients -> fields -> send -> sequential routing ->
 * sign x2 -> complete -> signed PDF + certificate -> audit trail ->
 * email signed PDF (attachment endpoint) -> email layer attaches files.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'esign-test-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.UPLOAD_DIR = path.join(TMP, 'uploads');
process.env.JWT_SECRET = 'test-secret';
process.env.APP_URL = 'http://localhost:0';
process.env.PORT = '0';

const { PDFDocument, StandardFonts } = require('pdf-lib');
const app = require('../server');

let BASE = '';
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}`); if (!cond) failures++; };

function makePng(w, h, rgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0, 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function makePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p1 = pdf.addPage([612, 792]); p1.drawText('DeoDap Vendor Agreement', { x: 50, y: 740, size: 18, font });
  const p2 = pdf.addPage([612, 792]); p2.drawText('Page 2 - Signatures', { x: 50, y: 740, size: 18, font });
  return Buffer.from(await pdf.save());
}

const tokenFromUrl = (u) => new URL(u).searchParams.get('token');

async function jreq(method, url, body, token) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let opts = { method, headers };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(BASE + url, opts);
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
  return { status: r.status, data };
}

(async () => {
  const server = app.listen(0);
  await new Promise((res) => server.once('listening', res));
  BASE = `http://127.0.0.1:${server.address().port}`;
  console.log('\nRunning eSign smoke test against', BASE, '\n');

  try {
    const reg = await jreq('POST', '/api/auth/register', { name: 'Owner', email: `owner${Date.now()}@deodap.com`, password: 'secret123' });
    ok(reg.status === 200 && reg.data.token, 'register sender returns a token');
    const token = reg.data.token;

    const pdfBytes = await makePdf();
    const fd = new FormData();
    fd.append('title', 'Vendor Agreement');
    fd.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'agreement.pdf');
    const up = await jreq('POST', '/api/documents', fd, token);
    ok(up.status === 200 && up.data.document, 'upload PDF creates a document');
    ok(up.data.document.pageCount === 2, 'document reports 2 pages');
    const docId = up.data.document.id;

    const rec = await jreq('POST', `/api/documents/${docId}/recipients`, {
      recipients: [
        { name: 'Internal Approver', email: 'approver@deodap.com', order: 1 },
        { name: 'External Vendor', email: 'vendor@example.com', order: 2 },
      ],
    }, token);
    ok(rec.status === 200 && rec.data.recipients.length === 2, 'two recipients saved');
    const [r1, r2] = rec.data.recipients;

    const fields = await jreq('POST', `/api/documents/${docId}/fields`, {
      fields: [
        { recipientId: r1.id, page: 0, type: 'signature', xPct: 0.1, yPct: 0.8, wPct: 0.3, hPct: 0.06, required: true },
        { recipientId: r2.id, page: 1, type: 'date', xPct: 0.1, yPct: 0.8, wPct: 0.2, hPct: 0.04, required: true },
      ],
    }, token);
    ok(fields.status === 200 && fields.data.fields.length === 2, 'two fields saved');

    const send = await jreq('POST', `/api/documents/${docId}/send`, {}, token);
    ok(send.status === 200, 'document sent');
    const sr1 = send.data.recipients.find((x) => x.id === r1.id);
    const sr2 = send.data.recipients.find((x) => x.id === r2.id);
    ok(sr1.status === 'sent', 'signer 1 is activated on send');
    ok(sr2.status === 'pending', 'signer 2 still pending (sequential order)');
    ok(/\/sign\.html\?token=/.test(sr1.signUrl), 'each signer gets a unique signing link');
    const t1 = tokenFromUrl(sr1.signUrl);
    const t2 = tokenFromUrl(sr2.signUrl);

    const early = await jreq('POST', `/api/sign/${t2}`, { values: {} });
    ok(early.status === 403, 'signer 2 is blocked until it is their turn');

    const sess1 = await jreq('GET', `/api/sign/${t1}`);
    ok(sess1.status === 200 && sess1.data.myTurn === true, 'signer 1 session loads and it is their turn');
    const sigField = sess1.data.fields.find((f) => f.type === 'signature');
    const sigPng = 'data:image/png;base64,' + makePng(240, 80, [20, 40, 120]).toString('base64');
    const sign1 = await jreq('POST', `/api/sign/${t1}`, { values: { [sigField.id]: sigPng } });
    ok(sign1.status === 200 && sign1.data.completed === false, 'signer 1 signs; not yet complete');

    const sess2 = await jreq('GET', `/api/sign/${t2}`);
    ok(sess2.status === 200 && sess2.data.myTurn === true, 'signer 2 is activated after signer 1');
    const dateField = sess2.data.fields.find((f) => f.type === 'date');
    const sign2 = await jreq('POST', `/api/sign/${t2}`, { values: { [dateField.id]: '2026-06-26' } });
    ok(sign2.status === 200 && sign2.data.completed === true, 'signer 2 signs; document completes');

    const detail = await jreq('GET', `/api/documents/${docId}`, undefined, token);
    ok(detail.data.document.status === 'completed', 'owner sees status completed');
    const dl = await jreq('GET', `/api/documents/${docId}/download?type=signed`, undefined, token);
    ok(dl.data.slice(0, 5).toString() === '%PDF-', 'signed PDF downloads and is a valid PDF');
    const signedPdf = await PDFDocument.load(dl.data);
    ok(signedPdf.getPageCount() === 3, 'signed PDF has original 2 pages + certificate page');

    const aud = await jreq('GET', `/api/documents/${docId}/audit`, undefined, token);
    const evts = aud.data.events.map((e) => e.event);
    ok(evts.includes('document.created') && evts.includes('document.sent') &&
       evts.filter((e) => e === 'recipient.signed').length === 2 && evts.includes('document.completed'),
       'audit trail records created, sent, both signatures, and completion');

    const emailRes = await jreq('POST', `/api/documents/${docId}/email`, { to: 'finance@deodap.com' }, token);
    ok(emailRes.status === 200 && emailRes.data.ok && emailRes.data.to === 'finance@deodap.com',
       'signed PDF can be emailed to a chosen address (attachment endpoint works)');

    const mailMod = require('../src/email');
    const mres = await mailMod.sendMail('x@y.com', 'subj', '<p>hi</p>',
      [{ filename: 'a.pdf', content: Buffer.from('%PDF-1.4 test'), contentType: 'application/pdf' }]);
    const parsed = JSON.parse(mres.info.message);
    ok(mres.ok && parsed.attachments && parsed.attachments.length === 1, 'email layer attaches the PDF file to outgoing mail');
  } catch (e) {
    console.error('\nUnexpected error:', e);
    failures++;
  } finally {
    server.close();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
