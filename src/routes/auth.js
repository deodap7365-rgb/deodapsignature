'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../auth');

const safe = (u) => ({ id: u.id, name: u.name, email: u.email });
const setCookie = (res, token) =>
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 86400000 });

router.post('/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.where('users', (u) => u.email.toLowerCase() === String(email).toLowerCase()).length)
    return res.status(409).json({ error: 'That email is already registered' });
  const user = db.insert('users', {
    name: name || String(email).split('@')[0],
    email: String(email),
    passwordHash: auth.hashPassword(String(password)),
  });
  const token = auth.signToken(user);
  setCookie(res, token);
  res.json({ user: safe(user), token });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.where('users', (u) => u.email.toLowerCase() === String(email || '').toLowerCase())[0];
  if (!user || !auth.verifyPassword(String(password || ''), user.passwordHash))
    return res.status(401).json({ error: 'Invalid email or password' });
  const token = auth.signToken(user);
  setCookie(res, token);
  res.json({ user: safe(user), token });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

router.get('/me', auth.authRequired, (req, res) => res.json({ user: safe(req.user) }));

module.exports = router;
