'use strict';
const crypto = require('crypto');

// Best-effort client IP, honoring a reverse proxy if present.
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || req.ip || null;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = { clientIp, sha256, esc };
