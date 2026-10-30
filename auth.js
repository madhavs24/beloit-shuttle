// auth.js — password hashing + session tokens using only node:crypto.
// scrypt for password hashing (salted); random opaque tokens for sessions.
const crypto = require('crypto');
const store = require('./store');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(derived, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  store.insert('sessions', { token, user_id: userId });
  return token;
}

function userFromToken(token) {
  if (!token) return null;
  const s = store.findOne('sessions', x => x.token === token);
  if (!s) return null;
  return store.findOne('users', u => u.id === s.user_id) || null;
}

module.exports = { hashPassword, verifyPassword, createSession, userFromToken };
