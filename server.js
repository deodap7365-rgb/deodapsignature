'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

// CSP is disabled so the bundled pages can load PDF.js from a CDN and use inline
// scripts. For production, set a Content-Security-Policy allowing your CDN instead.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.set('trust proxy', true);

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/documents', require('./src/routes/documents'));
app.use('/api/sign', require('./src/routes/sign'));

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// JSON error handler
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 25 MB)' });
  console.error('[error]', err && err.message);
  res.status(500).json({ error: (err && err.message) || 'Server error' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`\n  DeoDap eSign running →  http://localhost:${PORT}\n`));
}

module.exports = app;
