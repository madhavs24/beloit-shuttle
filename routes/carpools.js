// routes/carpools.js — student-run carpools: post a ride, request a seat,
// approve/decline requests. Reuses the notification system.
const store = require('../store');
const { HttpError, notify, emailUser } = require('../utils');
const userById = id => store.findOne('users', u => u.id === id) || {};

const carpoolById = id => store.findOne('carpools', c => c.id === id);
const approvedCount = cid => store.find('carpool_requests', r => r.carpool_id === cid && r.status === 'approved').length;

function shape(c) {
  const driver = store.findOne('users', u => u.id === c.driver_id) || {};
  const approved = approvedCount(c.id);
  return {
    ...c,
    driver_name: driver.name, driver_rating: driver.rating,
    seats_taken: approved, seats_left: Math.max(0, c.seat_capacity - approved),
  };
}

module.exports = [
  {
    method: 'GET', path: '/api/carpools', auth: true,
    handler: ({ user }) => {
      const today = new Date().toISOString().slice(0, 10);
      const carpools = store.all('carpools')
        .filter(c => c.status !== 'cancelled' && c.date >= today)
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
        .map(c => {
          const mine = store.findOne('carpool_requests', r => r.carpool_id === c.id && r.user_id === user.id);
          return { ...shape(c), my_request: mine ? mine.status : null, is_driver: c.driver_id === user.id };
        });
      return { carpools };
    },
  },
  {
    method: 'POST', path: '/api/carpools', auth: true,
    handler: ({ body, user }) => {
      const { date, time, meeting_spot, seat_capacity, car_desc, gas_split, notes } = body || {};
      if (!date || !time || !meeting_spot) throw new HttpError(400, 'Date, time and meeting spot are required');
      const c = store.insert('carpools', {
        driver_id: user.id, date, time, meeting_spot,
        seat_capacity: Number(seat_capacity) || 3, car_desc: car_desc || null,
        gas_split: gas_split || null, notes: notes || null, status: 'open',
      });
      return { carpool: shape(c) };
    },
  },
  {
    method: 'POST', path: '/api/carpools/:id/request', auth: true,
    handler: ({ params, user }) => {
      const c = carpoolById(Number(params.id));
      if (!c) throw new HttpError(404, 'Carpool not found');
      if (c.driver_id === user.id) throw new HttpError(400, "You can't request a seat in your own carpool");
      const existing = store.findOne('carpool_requests', r => r.carpool_id === c.id && r.user_id === user.id);
      if (existing && existing.status !== 'cancelled' && existing.status !== 'declined') {
        throw new HttpError(409, 'You already requested this carpool');
      }
      if (existing) store.update('carpool_requests', existing.id, { status: 'pending' });
      else store.insert('carpool_requests', { carpool_id: c.id, user_id: user.id, status: 'pending' });
      notify(c.driver_id, `${user.name} requested a seat in your ${c.date} carpool.`, 'carpool');
      emailUser(c.driver_id, `🚗 New carpool request from ${user.name}`,
        `${user.name} (${user.phone || 'no phone'}) asked to join your carpool on ${c.date} at ${c.time} from ${c.meeting_spot}.\n` +
        `Open the app to approve or decline.\n\n— Beloit Shuttle`);
      return { ok: true };
    },
  },
  {
    method: 'GET', path: '/api/carpools/:id/requests', auth: true,
    handler: ({ params, user }) => {
      const c = carpoolById(Number(params.id));
      if (!c) throw new HttpError(404, 'Carpool not found');
      if (c.driver_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'Not your carpool');
      const requests = store.find('carpool_requests', r => r.carpool_id === c.id && r.status !== 'cancelled')
        .map(r => {
          const u = store.findOne('users', x => x.id === r.user_id) || {};
          return { id: r.id, name: u.name, phone: u.phone, status: r.status };
        });
      return { carpool: shape(c), requests };
    },
  },
  {
    method: 'POST', path: '/api/carpools/requests/:rid/decide', auth: true,
    handler: ({ params, body, user }) => {
      const r = store.findOne('carpool_requests', x => x.id === Number(params.rid));
      if (!r) throw new HttpError(404, 'Request not found');
      const c = carpoolById(r.carpool_id);
      if (c.driver_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'Not your carpool');
      const decision = body && body.decision;
      if (!['approved', 'declined'].includes(decision)) throw new HttpError(400, 'Invalid decision');
      if (decision === 'approved' && approvedCount(c.id) >= c.seat_capacity) throw new HttpError(400, 'Carpool is full');

      store.update('carpool_requests', r.id, { status: decision });
      notify(r.user_id, `Your carpool request for ${c.date} was ${decision}.`, 'carpool');
      const rider = userById(r.user_id);
      const driver = userById(c.driver_id);
      if (decision === 'approved') {
        // Rider: you're confirmed. Driver: someone is joining you.
        emailUser(r.user_id, `✅ You're confirmed for the ${c.date} carpool`,
          `You've got a seat with ${driver.name} on ${c.date} at ${c.time}.\n` +
          `Meet at: ${c.meeting_spot}. Car: ${c.car_desc || 'see app'}. ${c.gas_split ? 'Gas: ' + c.gas_split : ''}\n` +
          `Driver contact: ${driver.phone || 'in app'}.\n\n— Beloit Shuttle`);
        emailUser(c.driver_id, `🚗 ${rider.name} is joining your ${c.date} carpool`,
          `${rider.name} (${rider.phone || 'no phone'}) is confirmed for your carpool on ${c.date} at ${c.time} from ${c.meeting_spot}.\n\n— Beloit Shuttle`);
        notify(c.driver_id, `${rider.name} will be carpooling with you on ${c.date}.`, 'carpool');
      } else {
        emailUser(r.user_id, `Carpool request declined — ${c.date}`,
          `Your request to join the ${c.date} carpool was declined. Check the app for other rides.\n\n— Beloit Shuttle`);
      }
      if (approvedCount(c.id) >= c.seat_capacity) store.update('carpools', c.id, { status: 'full' });
      return { ok: true };
    },
  },
  {
    method: 'POST', path: '/api/carpools/:id/cancel', auth: true,
    handler: ({ params, user }) => {
      const c = carpoolById(Number(params.id));
      if (!c) throw new HttpError(404, 'Carpool not found');
      if (c.driver_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'Not your carpool');
      store.update('carpools', c.id, { status: 'cancelled' });
      store.find('carpool_requests', r => r.carpool_id === c.id && r.status === 'approved')
        .forEach(r => notify(r.user_id, `The ${c.date} carpool you joined was cancelled by the driver.`, 'carpool'));
      return { ok: true };
    },
  },
];
