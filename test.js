// Quick end-to-end API test against the running server.
const BASE = 'http://localhost:3000/api';
let pass = 0, fail = 0;
function ok(c, m) { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ FAIL: ' + m)); }
async function call(method, path, body, token) {
  const h = {}; if (token) h.Authorization = 'Bearer ' + token;
  if (body) h['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

(async () => {
  console.log('AUTH');
  let r = await call('POST', '/auth/register', { name: 'Test User', email: 'test@gmail.com', password: 'secret1' });
  ok(r.status === 400, 'rejects non-beloit email');
  r = await call('POST', '/auth/register', { name: 'New Student', email: 'newbie@beloit.edu', phone: '608-555-9999', password: 'secret1', role: 'student' });
  ok(r.status === 200 && r.data.token, 'registers a @beloit.edu student');
  const newbie = r.data.token;
  r = await call('POST', '/auth/login', { email: 'priya@beloit.edu', password: 'password123' });
  ok(r.status === 200, 'seeded student logs in'); const priya = r.data.token;
  r = await call('POST', '/auth/login', { email: 'priya@beloit.edu', password: 'wrong' });
  ok(r.status === 401, 'rejects wrong password');
  const driver = (await call('POST', '/auth/login', { email: 'marcus@beloit.edu', password: 'password123' })).data.token;
  const admin = (await call('POST', '/auth/login', { email: 'reslife@beloit.edu', password: 'password123' })).data.token;

  console.log('TRIPS / RESERVATIONS');
  r = await call('GET', '/trips/today', null, newbie);
  ok(r.status === 200 && r.data.running === true, 'shuttle shows running today');
  const todayTrip = r.data.trips[0];
  ok(todayTrip.seats_taken === 3, 'today trip seeded with 3 riders');
  r = await call('POST', `/trips/${todayTrip.id}/reserve`, null, newbie);
  ok(r.status === 200 && r.data.status === 'reserved', 'newbie reserves a seat (4/6)');
  r = await call('POST', `/trips/${todayTrip.id}/reserve`, null, newbie);
  ok(r.status === 409, 'cannot double-reserve');

  // fill remaining seats (capacity 6, now 4 taken) with liam+grace already? seeded priya,liam,grace=3 +newbie=4. Add 2 more to fill, then waitlist.
  const liam = (await call('POST', '/auth/login', { email: 'liam@beloit.edu', password: 'password123' })).data.token; // already reserved
  const sam = (await call('POST', '/auth/login', { email: 'sam@beloit.edu', password: 'password123' })).data.token;
  const aisha = (await call('POST', '/auth/login', { email: 'aisha@beloit.edu', password: 'password123' })).data.token;
  await call('POST', `/trips/${todayTrip.id}/reserve`, null, sam);   // 5
  await call('POST', `/trips/${todayTrip.id}/reserve`, null, aisha); // 6 -> full
  r = await call('GET', '/trips/today', null, newbie);
  ok(r.data.trips[0].seats_left === 0, 'trip now full (0 left)');
  const graceTok = (await call('POST', '/auth/login', { email: 'grace@beloit.edu', password: 'password123' })).data.token;
  // grace already reserved in seed; make a fresh account to waitlist
  const wl = (await call('POST', '/auth/register', { name: 'Wait Lister', email: 'wl@beloit.edu', password: 'secret1' })).data.token;
  r = await call('POST', `/trips/${todayTrip.id}/reserve`, null, wl);
  ok(r.status === 200 && r.data.status === 'waitlisted', 'overflow rider is waitlisted');

  console.log('ROSTER + CONTACT REVEAL');
  r = await call('GET', `/trips/${todayTrip.id}/roster`, null, driver);
  ok(r.data.privileged === true && r.data.roster.some(x => x.phone), 'driver sees phone numbers');
  r = await call('GET', `/trips/${todayTrip.id}/roster`, null, newbie);
  ok(r.data.privileged === false && r.data.roster.every(x => x.phone === null), 'student roster hides phones');

  console.log('WAITLIST PROMOTION');
  // sam cancels -> waitlisted wl should be promoted
  const myres = (await call('GET', '/trips/reservations/mine', null, sam)).data.reservations[0];
  await call('POST', `/trips/reservations/${myres.id}/cancel`, null, sam);
  const wlres = (await call('GET', '/trips/reservations/mine', null, wl)).data.reservations[0];
  ok(wlres && wlres.status === 'reserved', 'waitlisted rider promoted after a cancel');

  console.log('CHECK-IN / STRANDED / NO-SHOW');
  const priyaRes = (await call('GET', '/trips/reservations/mine', null, priya)).data.reservations[0];
  r = await call('POST', `/trips/reservations/${priyaRes.id}/confirm`, null, priya);
  ok(r.status === 200, 'student checks in');
  r = await call('POST', `/trips/reservations/${priyaRes.id}/stranded`, null, priya);
  ok(r.status === 200, 'student flags stranded');
  r = await call('GET', '/notifications', null, driver);
  ok(r.data.notifications.some(n => n.type === 'stranded'), 'driver got stranded notification');
  r = await call('POST', `/trips/reservations/${priyaRes.id}/no-show`, null, driver);
  ok(r.status === 200, 'driver marks no-show');

  console.log('CANCEL RUN NOTIFIES');
  const anyFuture = (await call('GET', '/trips', null, driver)).data.trips[1];
  r = await call('POST', `/trips/${anyFuture.id}/cancel`, { reason: 'Van in shop' }, driver);
  ok(r.status === 200 && r.data.notified >= 0, 'driver cancels a run');

  console.log('CARPOOLS');
  r = await call('GET', '/carpools', null, priya);
  ok(r.data.carpools.length >= 1, 'carpool list loads');
  const cp = r.data.carpools[0];
  r = await call('POST', `/carpools/${cp.id}/request`, null, priya);
  ok(r.status === 200, 'student requests carpool seat');
  const cpDriver = aisha; // aisha owns seeded carpool
  const reqs = await call('GET', `/carpools/${cp.id}/requests`, null, cpDriver);
  ok(reqs.data.requests.length >= 1, 'carpool driver sees requests');
  const reqId = reqs.data.requests.find(x => x.status === 'pending').id;
  r = await call('POST', `/carpools/requests/${reqId}/decide`, { decision: 'approved' }, cpDriver);
  ok(r.status === 200, 'carpool driver approves request');
  r = await call('POST', '/carpools', { date: '2030-01-01', time: '10:00', meeting_spot: 'Wall St' }, priya);
  ok(r.status === 200, 'student posts a carpool');

  console.log('ADMIN');
  r = await call('GET', '/admin/dashboard', null, admin);
  ok(r.status === 200 && typeof r.data.stats.trips_run === 'number', 'admin dashboard loads');
  r = await call('GET', '/admin/dashboard', null, priya);
  ok(r.status === 403, 'student blocked from admin dashboard');
  r = await call('POST', '/admin/broadcast', { message: 'Hello campus' }, admin);
  ok(r.status === 200 && r.data.sent > 0, 'admin broadcast sends');
  r = await call('GET', '/notifications', null, priya);
  ok(r.data.notifications.some(n => n.type === 'broadcast'), 'student receives broadcast');

  console.log('EMAIL NOTIFICATIONS');
  // Driver "picks up" the shift → riders emailed.
  r = await call('PATCH', `/trips/${todayTrip.id}/status`, { status: 'running' }, driver);
  ok(r.status === 200, 'driver starts today\'s run (picks up shift)');
  let box = (await call('GET', '/admin/emails', null, admin)).data;
  ok(box.emails.some(e => /on the way/i.test(e.subject)), 'riders emailed that shuttle is on the way');
  // Carpool approval already happened above → confirmation + "joining" emails.
  ok(box.emails.some(e => /confirmed for the/i.test(e.subject)), 'rider emailed carpool confirmation');
  ok(box.emails.some(e => /is joining your/i.test(e.subject)), 'carpool driver emailed that someone is joining');
  // Cancel a run with a rider → cancellation email.
  const t2 = (await call('POST', '/trips', { date: '2031-05-05', departure_time: '12:00', seat_capacity: 4 }, driver)).data.trip;
  await call('POST', `/trips/${t2.id}/reserve`, null, priya);
  await call('POST', `/trips/${t2.id}/cancel`, { reason: 'Weather' }, driver);
  box = (await call('GET', '/admin/emails', null, admin)).data;
  ok(box.emails.some(e => /cancelled/i.test(e.subject)), 'rider emailed on run cancellation');
  ok(box.mode === 'outbox', 'mailer in demo outbox mode (no SMTP configured)');

  console.log('LIVE TRACKING');
  // todayTrip was set 'running' in the email section above.
  r = await call('POST', `/trips/${todayTrip.id}/location`,
    { lat: 42.512, lng: -89.01, acc: 8, heading: 90, timestamp: Date.now(), etaCampus: 6, etaStore: 12 }, driver);
  ok(r.status === 200, 'driver posts GPS location');
  r = await call('GET', `/trips/${todayTrip.id}/location`, null, newbie);
  ok(r.status === 200 && r.data.available === true && r.data.stale === false && r.data.etaStore === 12,
     'student reads fresh live location (lat/lng/eta, not stale)');
  r = await call('POST', `/trips/${todayTrip.id}/location`, { lat: 1, lng: 2 }, newbie);
  ok(r.status === 403, 'non-driver cannot post location');
  await call('PATCH', `/trips/${todayTrip.id}/status`, { status: 'completed' }, driver);
  r = await call('GET', `/trips/${todayTrip.id}/location`, null, newbie);
  ok(r.data.stale === true, 'location goes stale/offline when the run is not active');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
