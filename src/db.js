'use strict';
/**
 * Zero-dependency JSON-backed data store.
 *
 * Keeps all data in memory and write-through persists to data/db.json after each
 * mutation (atomic temp-file + rename). This means the app runs anywhere Node runs
 * with no native modules, no DB server, and no build tools.
 *
 * Everything goes through the small repository API below, so swapping this for
 * Postgres/SQLite later only touches this one file. See README "Scaling" section.
 */
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const COLLECTIONS = ['users', 'documents', 'recipients', 'fields', 'audit'];

function emptyDb() {
  const o = {};
  for (const c of COLLECTIONS) o[c] = [];
  return o;
}

function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8') || '{}');
      return Object.assign(emptyDb(), parsed);
    }
  } catch (e) {
    console.error('[db] load error:', e.message);
  }
  return emptyDb();
}

const data = load();

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error('[db] persist error:', e.message);
  }
}

const now = () => new Date().toISOString();

function insert(coll, row) {
  const rec = Object.assign({ id: uuid(), createdAt: now(), updatedAt: now() }, row);
  data[coll].push(rec);
  persist();
  return rec;
}

function update(coll, id, patch) {
  const rec = data[coll].find((r) => r.id === id);
  if (!rec) return null;
  Object.assign(rec, patch, { updatedAt: now() });
  persist();
  return rec;
}

function get(coll, id) {
  return data[coll].find((r) => r.id === id) || null;
}

function where(coll, pred) {
  return data[coll].filter(pred);
}

function all(coll) {
  return data[coll].slice();
}

function removeWhere(coll, pred) {
  const before = data[coll].length;
  data[coll] = data[coll].filter((r) => !pred(r));
  if (data[coll].length !== before) persist();
}

module.exports = { data, persist, insert, update, get, where, all, removeWhere, now, uuid };
