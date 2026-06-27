# Deploying DeoDap eSign (with unique signing links)

This is the full backend version. **Every document automatically gets a unique,
unguessable signing link per signer** — e.g. `https://your-app.onrender.com/sign.html?token=…`.
You email that link (or let the app email it), the signer opens it, signs, and the
signed PDF + certificate is generated and tracked in your dashboard.

You can deploy free in about 10 minutes. Two good hosts below — pick one.

---

## Option A — Render (recommended, includes `render.yaml`)

1. **Put the code on GitHub.** Create a new repo and push the contents of this
   `esign` folder to it.
   ```bash
   cd esign
   git init && git add . && git commit -m "DeoDap eSign"
   git branch -M main
   git remote add origin https://github.com/<you>/deodap-esign.git
   git push -u origin main
   ```
2. **Create the service.** Go to [dashboard.render.com](https://dashboard.render.com)
   → **New** → **Blueprint** → pick your repo. Render reads `render.yaml`, builds,
   and deploys. It auto-generates `JWT_SECRET` and sets the public URL.
3. **Open your app** at the `https://deodap-esign.onrender.com` URL Render gives you.
   Create an account and you're live. Signing links are already correct because the
   app reads Render's `RENDER_EXTERNAL_URL` automatically.

> **Free tier note:** the free plan has no persistent disk and sleeps after ~15 min
> idle (first request then takes ~30s to wake). Documents are stored on disk and will
> reset on redeploy/restart. For production persistence, edit `render.yaml`: change
> `plan: free` to `plan: starter` and uncomment the `DATA_DIR`, `UPLOAD_DIR`, and
> `disk:` blocks (a 1 GB disk on the Starter instance keeps everything permanently).

---

## Option B — Railway

1. Push the `esign` folder to GitHub (same as above).
2. At [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
   Railway detects Node and runs `npm install` + `npm start`.
3. **Generate a domain:** Settings → Networking → **Generate Domain**. The app reads
   Railway's `RAILWAY_PUBLIC_DOMAIN` automatically, so signing links are correct.
4. **Set a secret:** Variables → add `JWT_SECRET` = any long random string.
5. **(Recommended) Persistent storage:** add a **Volume**, mount it at `/data`, then
   add variables `DATA_DIR=/data/data` and `UPLOAD_DIR=/data/uploads`.

---

## Email delivery (so signers get the link by email)

The app sends real email when SMTP is configured. Add these environment variables
(Render: Environment tab / Railway: Variables):

| Variable | Example |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` (or Brevo, SendGrid, Mailgun, etc.) |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | your SMTP username |
| `SMTP_PASS` | your SMTP password / app password |
| `MAIL_FROM` | `DeoDap eSign <no-reply@deodap.app>` |

**Without SMTP** the app still works end-to-end — after you click **Send**, each
signer's unique link is shown on screen and in the document's **Track** panel, ready
to copy and share however you like (WhatsApp, your own email, etc.).

> Gmail tip: enable 2-factor auth, then create an **App Password** and use that as
> `SMTP_PASS`. Free transactional services like **Brevo** (300 emails/day) also work well.

---

## How the unique links work

- When you click **Send for signature**, each recipient is issued a random UUID token.
- Their link is `${APP_URL}/sign.html?token=<token>` — unguessable and specific to that
  person and document.
- Signing order is respected: signer 2's link only activates after signer 1 finishes.
- Every view/sign/decline is recorded in the audit trail, and the finished PDF carries
  a Certificate of Completion (signer identities, UTC timestamps, IPs, document hash).

## After deploy — quick checklist

- [ ] Create your account on the live URL.
- [ ] Upload a PDF, place fields, add a signer, click **Send**.
- [ ] Copy the signer link (or have it emailed), open it in a private window, and sign.
- [ ] Confirm the document shows **Completed** and the signed PDF downloads.
- [ ] Set `SMTP_*` for automatic email, and switch on a persistent disk/volume for production.
