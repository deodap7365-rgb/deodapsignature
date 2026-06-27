# DeoDap eSign

A self-hosted electronic-signature platform, in the spirit of Zoho Sign. Upload a
PDF, drag signature / date / text fields onto it, route it to internal and external
signers in a defined order, collect signatures in the browser, and produce a final
signed PDF with a **Certificate of Completion** and a full **audit trail**.

No native modules, no database server, no build step — it runs anywhere Node 18+ runs.

---

## Quick start

```bash
cd esign
npm install        # installs dependencies (pure JS, no compiler needed)
npm start          # starts on http://localhost:3000
```

Open **http://localhost:3000**, create an account, and you're in.

> Optional: `cp .env.example .env` and edit it to set a real `JWT_SECRET`,
> a public `APP_URL`, and SMTP credentials. Everything works without it for local use.

---

## The signing flow

1. **Create an account** (the sender / document owner).
2. **New document** → upload a PDF. You're taken to the *Prepare* screen.
3. **Add recipients** in the order they should sign (e.g. Internal Approver first,
   external Vendor second). Each gets a colour.
4. **Place fields** — pick a recipient, pick a field type (Signature, Initials,
   Date, Name, Email, Text, Checkbox), then click on the page. Drag to reposition,
   click the × to remove.
5. **Send for signature.** The first signer is notified; later signers wait their turn.
6. **Signers** open their personal link, fill their fields, draw or type a signature,
   and submit. When one finishes, the next is automatically notified.
7. When everyone has signed, the document is **completed**: a stamped PDF + certificate
   is generated, and everyone is emailed a copy. Track status and download from the
   dashboard.

### Email modes (important for testing)

If no `SMTP_HOST` is configured, the app runs in **DEV email mode**: it does *not* send
real email. Instead, every signing link is

- printed to the server console, **and**
- shown in the UI right after you click *Send* (copy-paste to test signing yourself),
  and on each document's *Track* panel.

Set the `SMTP_*` variables in `.env` to send real invitations.

---

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `APP_URL` | `http://localhost:3000` | Base URL used to build signing links in emails |
| `JWT_SECRET` | dev fallback | **Change in production.** Signs login sessions |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | empty | SMTP for real email; empty = DEV mode |
| `MAIL_FROM` | `DeoDap eSign <…>` | From address on outgoing mail |
| `DATA_DIR` / `UPLOAD_DIR` | `./data` / `./uploads` | Where the JSON store and PDFs live |

---

## Testing

```bash
npm test
```

Runs an automated end-to-end test (no browser needed) that registers a sender,
uploads a 2-page PDF, adds two sequential recipients, places fields, sends, has both
parties sign in order, and verifies the document completes, the signed PDF is valid
(original pages + certificate), and the audit trail is correct.

---

## Project structure

```
esign/
├── server.js              Express app wiring (routes, static, error handling)
├── src/
│   ├── db.js              Zero-dependency JSON data store (swap point for Postgres)
│   ├── auth.js            Password hashing + JWT sessions
│   ├── email.js           Nodemailer (SMTP or DEV-log) + email templates
│   ├── pdf.js             Stamp fields into the PDF + Certificate of Completion
│   ├── workflow.js        Sequential routing, activation, completion
│   ├── audit.js           Immutable audit-event log
│   ├── util.js            client IP, SHA-256, HTML escaping
│   └── routes/
│       ├── auth.js        register / login / logout / me
│       ├── documents.js   upload, recipients, fields, send, track, download (sender)
│       └── sign.js        signing session, submit, decline, download (signer, token-gated)
├── public/                Front end (vanilla JS + PDF.js from CDN)
│   ├── index.html · js/app.js        Dashboard, auth, tracking, audit
│   ├── prepare.html · js/prepare.js  PDF render + drag-and-drop field placement
│   ├── sign.html · js/sign.js        Signer view + signature pad
│   └── js/common.js · css/styles.css Shared helpers, signature pad, styling
├── test/smoke.js          End-to-end test
├── data/                  JSON store (created at runtime)
└── uploads/               Original + signed PDFs (created at runtime)
```

---

## How it works under the hood

- **Field coordinates** are stored as fractions of each page (`xPct`, `yPct` from the
  top-left, `wPct`/`hPct` of page size), so a field placed at one zoom level stamps
  correctly regardless of the signer's screen or zoom.
- **Signatures** are captured on an HTML canvas (draw) or rendered from typed text,
  exported as a trimmed PNG, and embedded into the PDF with `pdf-lib`.
- **Sequential routing**: recipients have an `order`. Only the lowest outstanding
  order is "active"; signing it activates the next. Same-order recipients sign in
  parallel.
- **Audit trail**: every create / send / view / sign / decline / complete event is
  logged with actor, timestamp (UTC), and IP, and printed on the certificate page
  along with the SHA-256 hash of the original document.

---

## Scaling to production

This ships with a **single-file JSON store** (`src/db.js`) so it runs with zero setup.
It's perfect for a team / internal tool. For higher volume:

- **Database**: `src/db.js` exposes a tiny repository API (`insert`, `update`, `get`,
  `where`, `all`, `removeWhere`). Re-implement those against Postgres/MySQL and nothing
  else changes.
- **File storage**: `uploads/` holds PDFs on local disk. Point `UPLOAD_DIR` at a mounted
  volume, or swap the `fs` calls in `workflow.js` / routes for S3.
- **Sessions**: JWTs are stateless; set a strong `JWT_SECRET` and run multiple instances
  behind a load balancer.

### Production checklist

- [ ] Set a strong `JWT_SECRET` and a real `APP_URL`.
- [ ] Configure SMTP so signers actually receive invitations.
- [ ] Serve over **HTTPS** (put it behind nginx/Caddy or a platform like Render/Railway).
- [ ] Tighten the Content-Security-Policy in `server.js` (CSP is disabled so PDF.js can
      load from a CDN; either allow that CDN explicitly or self-host PDF.js).
- [ ] Add rate-limiting on `/api/auth/*` and `/api/sign/*`.
- [ ] Back up `data/` and `uploads/` (or your DB + object store).

---

## What's included vs. Zoho Sign

**Included:** accounts, PDF upload, drag-and-drop field placement, 7 field types,
internal + external signers, sequential signing order, email or link-based delivery,
in-browser draw/type signatures, status tracking, decline flow, signed-PDF generation,
certificate of completion, document hashing, and a full audit trail.

**Not (yet) included** — natural next steps to extend: reusable templates, bulk send,
SMS/OTP signer authentication, in-person signing, payments, and a hosted multi-tenant
billing layer.

---

*Built for the DeoDap team. MIT-licensed — use and modify freely.*
