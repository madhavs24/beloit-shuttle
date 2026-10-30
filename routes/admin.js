// routes/admin.js — notifications (all users) + ResLife dashboard & broadcast.
const store = require('../store');
const { HttpError, notify, publicUser } = require('../utils');

module.exports = [
  // ---- Notifications (any user) ------------------------------------------
  {
    method: 'GET', path: '/api/notifications', auth: true,
    handler: ({ user }) => {
      const list = store.find('notifications', n => n.user_id === user.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 50);
      return { notifications: list, unread: list.filter(n => !n.is_read).length };
    },
  },
  {
    method: 'POST', path: '/api/notifications/read', auth: true,
    handler: ({ user }) => {
      store.find('notifications', n => n.user_id === user.id && !n.is_read)
        .forEach(n => store.update('notifications', n.id, { is_read: 1 }));
      return { ok: true };
    },
  },

  // ---- ResLife / admin ----------------------------------------------------
  {
    method: 'GET', path: '/api/admin/dashboard', auth: true, roles: ['admin'],
    handler: () => {
      const trips = store.all('trips');
      const reservations = store.all('reservations');
      const completed = trips.filter(t => t.status === 'completed');
      const ridersOn = t => reservations.filter(r => r.trip_id === t.id && ['reserved', 'confirmed'].includes(r.status)).length;

      const fills = trips.filter(t => t.status !== 'cancelled')
        .map(t => t.seat_capacity ? ridersOn(t) / t.seat_capacity : 0);
      const avgFill = fills.length ? Math.round(100 * fills.reduce((a, b) => a + b, 0) / fills.length) : 0;

      // Demand by day-of-week + time slot (helps ResLife decide when to add runs).
      const bySlot = {};
      trips.forEach(t => {
        const dow = new Date(`${t.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
        const key = `${dow} ${t.departure_time}`;
        bySlot[key] = bySlot[key] || { slot: key, riders: 0, capacity: 0, waitlist: 0 };
        bySlot[key].riders += ridersOn(t);
        bySlot[key].capacity += t.seat_capacity;
        bySlot[key].waitlist += reservations.filter(r => r.trip_id === t.id && r.status === 'waitlisted').length;
      });
      const slots = Object.values(bySlot).sort((a, b) => b.riders - a.riders);

      return {
        stats: {
          trips_run: completed.length,
          total_riders: completed.reduce((sum, t) => sum + ridersOn(t), 0),
          avg_fill_pct: avgFill,
          waitlisted: reservations.filter(r => r.status === 'waitlisted').length,
          no_shows: reservations.filter(r => r.status === 'no_show').length,
          verified_students: store.find('users', u => u.role === 'student').length,
          active_drivers: store.find('users', u => u.role === 'driver').length,
          carpools: store.all('carpools').filter(c => c.status !== 'cancelled').length,
        },
        slots,
      };
    },
  },
  {
    method: 'GET', path: '/api/admin/users', auth: true, roles: ['admin'],
    handler: () => ({ users: store.all('users').map(publicUser) }),
  },
  {
    method: 'GET', path: '/api/admin/emails', auth: true, roles: ['admin'],
    handler: () => {
      const emails = (store.all('emails') || [])
        .slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 60);
      return { mode: require('../mailer').mailMode(), emails };
    },
  },
  {
    method: 'POST', path: '/api/admin/broadcast', auth: true, roles: ['admin'],
    handler: ({ body, user }) => {
      const message = (body && body.message || '').trim();
      if (!message) throw new HttpError(400, 'Message is required');
      const recipients = store.find('users', u => u.id !== user.id);
      recipients.forEach(u => notify(u.id, `📣 ResLife: ${message}`, 'broadcast'));
      return { ok: true, sent: recipients.length };
    },
  },
];
