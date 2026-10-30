// store.js — tiny zero-dependency JSON datastore.
// Persists all collections to data.json on disk. Good enough for a campus-scale
// app; the CRUD surface below is deliberately small so you can later swap this
// file for SQLite or Firebase without touching the route handlers.
const fs = require('fs');
const path = require('path');

const FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

const empty = () => ({
  users: [], trips: [], reservations: [],
  carpools: [], carpool_requests: [], notifications: [],
  emails: [], sessions: [], _seq: {},
});

let data = empty();

function load() {
  try {
    if (fs.existsSync(FILE)) data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    console.error('Could not read data file, starting fresh:', e.message);
    data = empty();
  }
}
function save() {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}
function reset() { data = empty(); save(); }

function nextId(coll) {
  data._seq[coll] = (data._seq[coll] || 0) + 1;
  return data._seq[coll];
}

function insert(coll, obj) {
  if (!data[coll]) data[coll] = [];   // tolerate collections added after an old data.json
  obj.id = nextId(coll);
  if (!obj.created_at) obj.created_at = new Date().toISOString();
  data[coll].push(obj);
  save();
  return obj;
}
function all(coll) { return data[coll]; }
function find(coll, pred) { return data[coll].filter(pred); }
function findOne(coll, pred) { return data[coll].find(pred); }
function update(coll, id, patch) {
  const row = data[coll].find(r => r.id === id);
  if (row) { Object.assign(row, patch); save(); }
  return row;
}

load();

module.exports = { data, load, save, reset, insert, all, find, findOne, update, nextId, FILE };
