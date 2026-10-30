// seed.js — populate demo accounts + trips so the app is explorable immediately.
// Usage:  node seed.js         (seeds only if the DB is empty)
//         node seed.js --reset (wipe and reseed)
const store = require('./store');
const { hashPassword } = require('./auth');

const reset = process.argv.includes('--reset');
if (reset) store.reset();

if (store.all('users').length > 0 && !reset) {
  console.log('Data already present — run `node seed.js --reset` to wipe and reseed.');
  process.exit(0);
}

const pw = hashPassword('password123');
function user(name, email, phone, role) {
  return store.insert('users', { name, email, phone, password_hash: pw, role, rating: 5.0, rating_count: 0, no_show_count: 0 });
}

// --- Accounts (all use password: password123) ---
const admin  = user('Res Life Office', 'reslife@beloit.edu', '608-555-0100', 'admin');
const driver = user('Marcus Turner',  'marcus@beloit.edu',  '608-555-0111', 'driver');
const priya  = user('Priya Sharma',   'priya@beloit.edu',   '608-555-0121', 'student');
const liam   = user('Liam O\'Brien',  'liam@beloit.edu',    '608-555-0122', 'student');
const grace  = user('Grace Lee',      'grace@beloit.edu',   '608-555-0123', 'student');
const aisha  = user('Aisha Khan',     'aisha@beloit.edu',   '608-555-0124', 'student');
user('Sam Wright', 'sam@beloit.edu', '608-555-0125', 'student');

// --- Helpers for dates/times relative to now (so trips are always "live") ---
const now = new Date();
const dstr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const plus = (base, ms) => new Date(base.getTime() + ms);

// Today's run: departs a couple hours out so reservations are open when you test.
// If "now + 2h" would roll past midnight (e.g. testing late at night), clamp to
// 23:59 today so the trip stays on *today's* date and still in the future.
let dep = plus(now, 2 * 3600 * 1000);
if (dstr(dep) !== dstr(now)) { dep = new Date(now); dep.setHours(23, 59, 0, 0); }
const ret = plus(dep, 75 * 60 * 1000);
const todayTrip = store.insert('trips', {
  driver_id: driver.id, date: dstr(now), departure_time: hm(dep), return_time: hm(ret),
  pickup_point: 'Pearsons Hall', seat_capacity: 6, status: 'scheduled',
  cancel_reason: null, live_lat: null, live_lng: null, live_updated: null,
});

// A couple of future runs.
store.insert('trips', {
  driver_id: driver.id, date: dstr(plus(now, 3 * 86400000)), departure_time: '13:00', return_time: '14:30',
  pickup_point: 'Pearsons Hall', seat_capacity: 14, status: 'scheduled',
  cancel_reason: null, live_lat: null, live_lng: null, live_updated: null,
});
store.insert('trips', {
  driver_id: driver.id, date: dstr(plus(now, 6 * 86400000)), departure_time: '14:00', return_time: '15:15',
  pickup_point: 'Pearsons Hall', seat_capacity: 14, status: 'scheduled',
  cancel_reason: null, live_lat: null, live_lng: null, live_updated: null,
});

// A completed past run (gives the ResLife dashboard something to show).
store.insert('trips', {
  driver_id: driver.id, date: dstr(plus(now, -3 * 86400000)), departure_time: '14:00', return_time: '15:15',
  pickup_point: 'Pearsons Hall', seat_capacity: 14, status: 'completed',
  cancel_reason: null, live_lat: null, live_lng: null, live_updated: null,
});
const pastTrip = store.all('trips').slice(-1)[0];

// Seed reservations on today's trip (priority order = reservation time).
[priya, liam, grace].forEach(u =>
  store.insert('reservations', { trip_id: todayTrip.id, user_id: u.id, status: 'reserved', stranded: 0, share_loc: 0 }));
// Fill past trip for dashboard numbers.
[priya, liam, grace, aisha].forEach(u =>
  store.insert('reservations', { trip_id: pastTrip.id, user_id: u.id, status: 'confirmed', stranded: 0, share_loc: 0 }));

// A sample carpool offered by a student.
store.insert('carpools', {
  driver_id: aisha.id, date: dstr(plus(now, 3 * 86400000)), time: '17:30', meeting_spot: 'Chapin Hall',
  seat_capacity: 3, car_desc: 'Silver Honda Civic', gas_split: '~$2 each', notes: 'Back by 7pm', status: 'open',
});

console.log('Seeded demo data. Log in with any of these (password: password123):');
console.log('  ResLife (admin):  reslife@beloit.edu');
console.log('  Driver:           marcus@beloit.edu');
console.log('  Student:          priya@beloit.edu  (or liam@ / grace@ / aisha@ / sam@)');
