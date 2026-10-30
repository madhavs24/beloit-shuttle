// routes/auth.js — register, login, current user.
const store = require('../store');
const { hashPassword, verifyPassword, createSession } = require('../auth');
const { HttpError, publicUser } = require('../utils');

const ALLOWED_ROLES = ['student', 'driver', 'admin'];

module.exports = [
  {
    method: 'POST', path: '/api/auth/register',
    handler: ({ body }) => {
      let { name, email, phone, password, role } = body || {};
      name = (name || '').trim();
      email = (email || '').trim().toLowerCase();
      role = ALLOWED_ROLES.includes(role) ? role : 'student';

      if (!name || !email || !password) throw new HttpError(400, 'Name, email and password are required');
      if (!email.endsWith('@beloit.edu')) throw new HttpError(400, 'Please use your @beloit.edu email address');
      if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
      if (store.findOne('users', u => u.email === email)) throw new HttpError(409, 'An account with that email already exists');

      const user = store.insert('users', {
        name, email, phone: phone || null, password_hash: hashPassword(password),
        role, rating: 5.0, rating_count: 0, no_show_count: 0,
      });
      return { token: createSession(user.id), user: publicUser(user) };
    },
  },
  {
    method: 'POST', path: '/api/auth/login',
    handler: ({ body }) => {
      const email = ((body && body.email) || '').trim().toLowerCase();
      const user = store.findOne('users', u => u.email === email);
      if (!user || !verifyPassword((body && body.password) || '', user.password_hash)) {
        throw new HttpError(401, 'Incorrect email or password');
      }
      return { token: createSession(user.id), user: publicUser(user) };
    },
  },
  {
    method: 'GET', path: '/api/auth/me', auth: true,
    handler: ({ user }) => ({ user: publicUser(user) }),
  },
];
