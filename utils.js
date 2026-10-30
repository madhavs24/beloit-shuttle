// utils.js — shared helpers used across route handlers.
const store = require('./store');
const { sendMail } = require('./mailer');

// Email a user by id (no-op if we don't have their address). Fire-and-forget.
function emailUser(userId, subject, text) {
  const u = store.findOne('users', x => x.id === userId);
  if (u && u.email) sendMail({ to: u.email, subject, text });
}

// Throwable error carrying an HTTP status; the server turns it into a JSON response.
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Strip sensitive fields before sending a user to the client.
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role,
           rating: u.rating, no_show_count: u.no_show_count };
}

function notify(userId, message, type = 'info') {
  store.insert('notifications', { user_id: userId, message, type, is_read: 0 });
}
function notifyRole(role, message, type = 'info') {
  store.find('users', u => u.role === role).forEach(u => notify(u.id, message, type));
}

function activeSeatCount(tripId) {
  return store.find('reservations',
    r => r.trip_id === tripId && (r.status === 'reserved' || r.status === 'confirmed')).length;
}

function withSeats(trip) {
  const taken = activeSeatCount(trip.id);
  return { ...trip, seats_taken: taken, seats_left: Math.max(0, trip.seat_capacity - taken) };
}

// When a seat frees, promote the earliest-registered waitlisted rider.
function promoteWaitlist(trip) {
  if (trip.seat_capacity - activeSeatCount(trip.id) <= 0) return;
  const waiting = store.find('reservations', r => r.trip_id === trip.id && r.status === 'waitlisted')
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const next = waiting[0];
  if (!next) return;
  store.update('reservations', next.id, { status: 'reserved' });
  notify(next.user_id, `A seat opened up — you're confirmed on the ${trip.date} ${trip.departure_time} shuttle.`, 'promoted');
}

module.exports = { HttpError, todayStr, publicUser, notify, notifyRole, emailUser, activeSeatCount, withSeats, promoteWaitlist };
