// routes/trips.js — schedule/availability, reservations, waitlist, check-in,
// no-show, stranded flag, and the GPS location placeholder.
const store = require('../store');
const { HttpError, todayStr, withSeats, activeSeatCount, promoteWaitlist, notify, notifyRole, emailUser } = require('../utils');

// Riders with an active/waitlisted reservation on a trip (used for email fan-out).
const ridersOnTrip = tripId => store.find('reservations',
  r => r.trip_id === tripId && ['reserved', 'confirmed', 'waitlisted'].includes(r.status));

const RESERVE_CUTOFF_MIN = 15;

const tripById = id => store.findOne('trips', t => t.id === id);
const driverName = id => (store.findOne('users', u => u.id === id) || {}).name || 'Driver';
const departureDate = t => new Date(`${t.date}T${t.departure_time}:00`);

module.exports = [
  // ---- Reads (any signed-in user) ----------------------------------------
  {
    method: 'GET', path: '/api/trips', auth: true,
    handler: () => {
      const today = todayStr();
      const trips = store.all('trips')
        .filter(t => t.date >= today)
        .sort((a, b) => (a.date + a.departure_time).localeCompare(b.date + b.departure_time))
        .map(t => ({ ...withSeats(t), driver_name: driverName(t.driver_id) }));
      return { trips };
    },
  },
  {
    method: 'GET', path: '/api/trips/today', auth: true,
    handler: () => {
      const today = todayStr();
      const trips = store.all('trips')
        .filter(t => t.date === today && t.status !== 'cancelled')
        .sort((a, b) => a.departure_time.localeCompare(b.departure_time))
        .map(t => ({ ...withSeats(t), driver_name: driverName(t.driver_id) }));
      return { running: trips.length > 0, trips };
    },
  },
  {
    method: 'GET', path: '/api/trips/reservations/mine', auth: true,
    handler: ({ user }) => {
      const reservations = store.find('reservations', r => r.user_id === user.id && r.status !== 'cancelled')
        .map(r => {
          const t = tripById(r.trip_id) || {};
          return { ...r, date: t.date, departure_time: t.departure_time, return_time: t.return_time,
                   pickup_point: t.pickup_point, trip_status: t.status, driver_name: driverName(t.driver_id) };
        })
        .filter(r => r.trip_status !== 'completed')   // only show upcoming/active runs
        .sort((a, b) => ((a.date || '') + (a.departure_time || '')).localeCompare((b.date || '') + (b.departure_time || '')));
      return { reservations };
    },
  },
  {
    method: 'GET', path: '/api/trips/mine/driving', auth: true, roles: ['driver', 'admin'],
    handler: ({ user }) => {
      const trips = store.find('trips', t => t.driver_id === user.id || user.role === 'admin')
        .sort((a, b) => (b.date + b.departure_time).localeCompare(a.date + a.departure_time))
        .map(withSeats);
      return { trips };
    },
  },
  // Live location read. Ported from Jeremy Mueller's shuttle-track: same payload
  // shape (lat/lng/acc/heading/timestamp/etaCampus/etaStore) plus staleness so the
  // map can show "offline" when the driver stops sending (his WebSocket did this
  // via disconnect; we do it by checking how fresh the last update is).
  {
    method: 'GET', path: '/api/trips/:id/location', auth: true,
    handler: ({ params }) => {
      const t = tripById(Number(params.id));
      if (!t) throw new HttpError(404, 'Trip not found');
      if (t.live_lat == null) return { available: false };
      const ageMs = t.live_updated ? (Date.now() - Date.parse(t.live_updated)) : Infinity;
      const stale = ageMs > 20000 || t.status !== 'running';   // >20s or run not active => offline
      return {
        available: true, stale, status: t.status,
        lat: t.live_lat, lng: t.live_lng, acc: t.live_acc, heading: t.live_heading,
        timestamp: t.live_ts, etaCampus: t.live_eta_campus, etaStore: t.live_eta_store,
        updated: t.live_updated,
      };
    },
  },
  // Driver's device pushes GPS + ETA here (the app-native replacement for his
  // /ws/driver WebSocket). Only the trip's driver (or admin) may post.
  {
    method: 'POST', path: '/api/trips/:id/location', auth: true, roles: ['driver', 'admin'],
    handler: ({ params, body, user }) => {
      const t = tripById(Number(params.id));
      if (!t) throw new HttpError(404, 'Trip not found');
      if (t.driver_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'Not your run');
      const b = body || {};
      if (typeof b.lat !== 'number' || typeof b.lng !== 'number') throw new HttpError(400, 'lat/lng required');
      store.update('trips', t.id, {
        live_lat: b.lat, live_lng: b.lng, live_acc: b.acc ?? null, live_heading: b.heading ?? null,
        live_ts: b.timestamp ?? Date.now(),
        live_eta_campus: b.etaCampus ?? null, live_eta_store: b.etaStore ?? null,
        live_updated: new Date().toISOString(),
      });
      return { ok: true };
    },
  },
  {
    method: 'GET', path: '/api/trips/:id/roster', auth: true,
    handler: ({ params, user }) => {
      const t = tripById(Number(params.id));
      if (!t) throw new HttpError(404, 'Trip not found');
      const privileged = user.role === 'admin' || t.driver_id === user.id;
      const roster = store.find('reservations', r => r.trip_id === t.id && r.status !== 'cancelled')
        .sort((a, b) => (a.status === 'waitlisted' ? 1 : 0) - (b.status === 'waitlisted' ? 1 : 0)
                     || a.created_at.localeCompare(b.created_at))
        .map(r => {
          const u = store.findOne('users', x => x.id === r.user_id) || {};
          return { id: r.id, name: u.name, status: r.status, stranded: !!r.stranded,
                   no_show_count: u.no_show_count, phone: privileged ? u.phone : null };
        });
      return { trip: withSeats(t), privileged, roster };
    },
  },

  // ---- Driver / admin: manage schedule -----------------------------------
  {
    method: 'POST', path: '/api/trips', auth: true, roles: ['driver', 'admin'],
    handler: ({ body, user }) => {
      const { date, departure_time, return_time, pickup_point, seat_capacity } = body || {};
      if (!date || !departure_time) throw new HttpError(400, 'Date and departure time are required');
      const trip = store.insert('trips', {
        driver_id: user.id, date, departure_time, return_time: return_time || null,
        pickup_point: pickup_point || 'Pearsons Hall', seat_capacity: Number(seat_capacity) || 14,
        status: 'scheduled', cancel_reason: null, live_lat: null, live_lng: null, live_updated: null,
      });
      return { trip: withSeats(trip) };
    },
  },
  {
    method: 'PATCH', path: '/api/trips/:id/status', auth: true, roles: ['driver', 'admin'],
    handler: ({ params, body }) => {
      const t = tripById(Number(params.id));
      if (!t) throw new HttpError(404, 'Trip not found');
      const status = body && body.status;
      if (!['scheduled', 'running', 'completed'].includes(status)) throw new HttpError(400, 'Invalid status');
      store.update('trips', t.id, { status });
      // Driver "picked up" the shift → email + notify everyone booked on this run.
      if (status === 'running') {
        ridersOnTrip(t.id).forEach(r => {
          notify(r.user_id, `Your shuttle is now on the way — the ${t.date} ${t.departure_time} run just started.`, 'trip');
          emailUser(r.user_id, `🚐 Your Beloit shuttle is on the way`,
            `Good news! The driver has started the ${t.date} ${t.departure_time} shuttle to Walmart.\n` +
            `Pickup: ${t.pickup_point}. Head to the pickup point.\n\n— Beloit Shuttle`);
        });
      }
      return { ok: true, status };
    },
  },
  {
    method: 'POST', path: '/api/trips/:id/cancel', auth: true, roles: ['driver', 'admin'],
    handler: ({ params, body }) => {
      const t = tripById(Number(params.id));
      if (!t) throw new HttpError(404, 'Trip not found');
      const reason = (body && body.reason) || 'No reason given';
      store.update('trips', t.id, { status: 'cancelled', cancel_reason: reason });
      const affected = store.find('reservations',
        r => r.trip_id === t.id && ['reserved', 'confirmed', 'waitlisted'].includes(r.status));
      affected.forEach(r => {
        notify(r.user_id, `Shuttle CANCELLED: the ${t.date} ${t.departure_time} run is off. Reason: ${reason}`, 'cancelled');
        emailUser(r.user_id, `❌ Beloit shuttle cancelled — ${t.date} ${t.departure_time}`,
          `Heads up: the ${t.date} ${t.departure_time} shuttle to Walmart has been CANCELLED.\n` +
          `Reason: ${reason}\n\nCheck the app for other runs or a carpool.\n\n— Beloit Shuttle`);
      });
      return { ok: true, notified: affected.length };
    },
  },
  {
    method: 'POST', path: '/api/trips/reservations/:rid/no-show', auth: true, roles: ['driver', 'admin'],
    handler: ({ params }) => {
      const r = store.findOne('reservations', x => x.id === Number(params.rid));
      if (!r) throw new HttpError(404, 'Reservation not found');
      store.update('reservations', r.id, { status: 'no_show' });
      const u = store.findOne('users', x => x.id === r.user_id);
      if (u) store.update('users', u.id, { no_show_count: (u.no_show_count || 0) + 1 });
      promoteWaitlist(tripById(r.trip_id));
      return { ok: true };
    },
  },

  // ---- Student: reservations ---------------------------------------------
  {
    method: 'POST', path: '/api/trips/:id/reserve', auth: true,
    handler: ({ params, user }) => {
      const t = tripById(Number(params.id));
      if (!t) throw new HttpError(404, 'Trip not found');
      if (t.status === 'cancelled' || t.status === 'completed') throw new HttpError(400, 'This trip is not open for reservations');
      const cutoff = new Date(departureDate(t).getTime() - RESERVE_CUTOFF_MIN * 60000);
      if (new Date() > cutoff) throw new HttpError(400, `Reservations closed (they close ${RESERVE_CUTOFF_MIN} min before departure)`);

      const existing = store.findOne('reservations', r => r.trip_id === t.id && r.user_id === user.id);
      if (existing && existing.status !== 'cancelled') throw new HttpError(409, 'You already have a reservation on this trip');

      const status = (t.seat_capacity - activeSeatCount(t.id)) > 0 ? 'reserved' : 'waitlisted';
      if (existing) {
        store.update('reservations', existing.id, { status, stranded: 0, created_at: new Date().toISOString() });
      } else {
        store.insert('reservations', { trip_id: t.id, user_id: user.id, status, stranded: 0, share_loc: 0 });
      }
      return { ok: true, status };
    },
  },
  {
    method: 'POST', path: '/api/trips/reservations/:rid/cancel', auth: true,
    handler: ({ params, user }) => {
      const r = store.findOne('reservations', x => x.id === Number(params.rid));
      if (!r) throw new HttpError(404, 'Reservation not found');
      if (r.user_id !== user.id && user.role === 'student') throw new HttpError(403, 'Not your reservation');
      const wasActive = r.status === 'reserved' || r.status === 'confirmed';
      store.update('reservations', r.id, { status: 'cancelled' });
      if (wasActive) promoteWaitlist(tripById(r.trip_id));
      return { ok: true };
    },
  },
  {
    method: 'POST', path: '/api/trips/reservations/:rid/confirm', auth: true,
    handler: ({ params, user }) => {
      const r = store.findOne('reservations', x => x.id === Number(params.rid));
      if (!r || r.user_id !== user.id) throw new HttpError(404, 'Reservation not found');
      if (r.status !== 'reserved') throw new HttpError(400, 'Only reserved seats can be confirmed');
      store.update('reservations', r.id, { status: 'confirmed' });
      return { ok: true };
    },
  },
  {
    method: 'POST', path: '/api/trips/reservations/:rid/stranded', auth: true,
    handler: ({ params, user }) => {
      const r = store.findOne('reservations', x => x.id === Number(params.rid));
      if (!r || r.user_id !== user.id) throw new HttpError(404, 'Reservation not found');
      store.update('reservations', r.id, { stranded: 1 });
      const t = tripById(r.trip_id);
      notify(t.driver_id, `${user.name} is still at Walmart and needs a pickup (${user.phone || 'no phone on file'}).`, 'stranded');
      notifyRole('admin', `Stranded rider: ${user.name} on the ${t.date} run (${user.phone || 'no phone'}).`, 'stranded');
      return { ok: true };
    },
  },
  {
    method: 'POST', path: '/api/trips/reservations/:rid/share-location', auth: true,
    handler: ({ params, user, body }) => {
      const r = store.findOne('reservations', x => x.id === Number(params.rid));
      if (!r || r.user_id !== user.id) throw new HttpError(404, 'Reservation not found');
      const on = body && body.on ? 1 : 0;
      store.update('reservations', r.id, { share_loc: on });
      return { ok: true, share_loc: !!on };
    },
  },
];
