// app.js — Beloit Shuttle single-page front end (vanilla JS, no build step).
(() => {
  const $app = document.getElementById('app');
  const state = { token: localStorage.getItem('bs_token') || null, user: null, view: null };

  // ---------- API helper ----------
  async function api(method, path, body) {
    const opts = { method, headers: {} };
    if (state.token) opts.headers['Authorization'] = 'Bearer ' + state.token;
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch('/api' + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // ---------- misc helpers ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const initials = n => (n || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800);
  }
  function fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  const isToday = d => d === new Date().toISOString().slice(0, 10);

  // ---------- auth screen ----------
  function renderAuth(mode = 'login') {
    $app.innerHTML = `
      <div class="auth-wrap"><div class="auth-card">
        <div class="auth-hero" style="background-image:url('/img/campus.jpg')">
          <div class="brandline"><div class="mark"><div class="mono">B</div><h1 class="serif">Beloit Shuttle</h1></div>
            <div class="tag">Be more. Be remarkable.</div></div>
        </div>
        <div class="auth-body">
          <div class="sub">Walmart runs, reservations & carpools — for Beloit students.</div>
          <div class="tabs">
            <button data-m="login" class="${mode==='login'?'active':''}">Sign in</button>
            <button data-m="register" class="${mode==='register'?'active':''}">Create account</button>
          </div>
          <form id="authForm">
            ${mode==='register' ? `
              <label>Full name</label><input name="name" required>
              <label>Phone (so a driver can reach you if stranded)</label><input name="phone" placeholder="608-555-0000">
            ` : ''}
            <label>Beloit email</label><input name="email" type="email" placeholder="you@beloit.edu" required>
            <label>Password</label><input name="password" type="password" required>
            ${mode==='register' ? `
              <label>I am a…</label>
              <select name="role">
                <option value="student">Student (rider)</option>
                <option value="driver">Shuttle driver</option>
                <option value="admin">ResLife / admin</option>
              </select>` : ''}
            <div class="err" id="authErr"></div>
            <button class="btn gold block" type="submit">${mode==='register'?'Create account':'Sign in'}</button>
          </form>
          <div class="hint">Demo accounts (password <b>password123</b>): reslife@beloit.edu · marcus@beloit.edu · priya@beloit.edu</div>
          <div class="motto">Scientia vera cum fide pura</div>
        </div>
      </div></div>`;

    $app.querySelectorAll('.tabs button').forEach(b => b.onclick = () => renderAuth(b.dataset.m));
    document.getElementById('authForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const payload = Object.fromEntries(f.entries());
      try {
        const path = mode === 'register' ? '/auth/register' : '/auth/login';
        const data = await api('POST', path, payload);
        state.token = data.token; state.user = data.user;
        localStorage.setItem('bs_token', data.token);
        startApp();
      } catch (err) { document.getElementById('authErr').textContent = err.message; }
    };
  }

  // ---------- app shell ----------
  function navFor(role) {
    if (role === 'driver') return [['runs','My Runs'],['carpool','Carpools'],['track','Track']];
    if (role === 'admin')  return [['dashboard','Dashboard'],['runs','All Runs'],['users','Users'],['emails','Email log'],['carpool','Carpools']];
    return [['home','Home'],['trips','My Trips'],['carpool','Carpools'],['track','Track']];
  }

  function renderShell() {
    const nav = navFor(state.user.role).map(([v, label]) =>
      `<button data-view="${v}" class="${state.view===v?'active':''}">${label}</button>`).join('');
    $app.innerHTML = `
      <div class="topbar">
        <div class="mono">B</div><h1 class="serif">Beloit Shuttle</h1>
        <div class="spacer"></div>
        <button class="icon-btn" id="bell">🔔<span class="badge" id="bellBadge" style="display:none">0</span></button>
        <div class="who"><b>${esc(state.user.name)}</b>${state.user.role==='admin'?'ResLife':state.user.role}</div>
        <button class="logout" id="logout">Sign out</button>
      </div>
      <div class="nav">${nav}</div>
      <div class="wrap" id="content"></div>`;
    $app.querySelectorAll('.nav button').forEach(b => b.onclick = () => navigate(b.dataset.view));
    document.getElementById('logout').onclick = () => {
      stopTracking();
      localStorage.removeItem('bs_token'); state.token = null; state.user = null; renderAuth();
    };
    document.getElementById('bell').onclick = toggleNotifs;
  }

  function navigate(view) {
    stopTracking();          // clear any map polling / GPS watch from a Track view
    state.view = view;
    renderShell();
    const map = { home: viewHome, trips: viewMyTrips, carpool: viewCarpools, track: viewTrack,
                  runs: viewRuns, dashboard: viewDashboard, users: viewUsers, roster: viewRoster, emails: viewEmails };
    (map[view] || viewHome)();
  }

  const content = () => document.getElementById('content');
  const loading = () => { content().innerHTML = `<div class="empty">Loading…</div>`; };

  // ---------- STUDENT: Home ----------
  async function viewHome() {
    loading();
    try {
      const [{ running, trips: todayTrips }, { trips }] = await Promise.all([
        api('GET', '/trips/today'), api('GET', '/trips'),
      ]);
      const banner = running
        ? `<div class="banner hero run"><div class="inner"><div class="state"><span class="dot"></span> RUNNING TODAY</div>
             <div class="meta">${todayTrips.map(t => `Departs ${t.departure_time} from ${esc(t.pickup_point)} · ${t.seats_left} of ${t.seat_capacity} seats left`).join('<br>')}</div></div></div>`
        : `<div class="banner hero norun"><div class="inner"><div class="state"><span class="dot"></span> NOT RUNNING TODAY</div>
             <div class="meta">No shuttle scheduled for today. Check upcoming days below or find a carpool.</div></div></div>`;

      const list = trips.length ? trips.map(tripCard).join('') : `<div class="empty">No upcoming trips scheduled yet.</div>`;
      content().innerHTML = banner + `<h2 class="title">Upcoming shuttles</h2>` + list;
    } catch (e) { content().innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  function tripCard(t) {
    const pct = Math.round(100 * t.seats_taken / t.seat_capacity);
    const cancelled = t.status === 'cancelled';
    const badge = cancelled ? `<span class="pill r">Cancelled</span>`
      : t.seats_left > 0 ? `<span class="pill g">${t.seats_left} seats left</span>`
      : `<span class="pill y">Full — waitlist</span>`;
    return `<div class="card">
      <div class="row"><b>${fmtDate(t.date)}${isToday(t.date)?' · Today':''} · ${t.departure_time}</b>${badge}</div>
      <div class="muted">From ${esc(t.pickup_point)} → Walmart${t.return_time?` · returns ${t.return_time}`:''} · driver ${esc(t.driver_name||'TBD')}</div>
      <div class="seatbar"><i style="width:${pct}%"></i></div>
      ${cancelled ? `<div class="muted">Reason: ${esc(t.cancel_reason||'')}</div>`
        : `<button class="btn ${t.seats_left>0?'gold':'ghost'} sm" data-action="reserve" data-trip="${t.id}">${t.seats_left>0?'Reserve my seat':'Join waitlist'}</button>`}
    </div>`;
  }

  // ---------- STUDENT: My Trips ----------
  async function viewMyTrips() {
    loading();
    try {
      const { reservations } = await api('GET', '/trips/reservations/mine');
      if (!reservations.length) { content().innerHTML = `<h2 class="title">My trips</h2><div class="empty">No reservations yet — grab a seat from Home.</div>`; return; }
      content().innerHTML = `<h2 class="title">My trips</h2>` + reservations.map(r => {
        const st = r.status === 'waitlisted' ? `<span class="pill y">Waitlisted</span>`
          : r.status === 'confirmed' ? `<span class="pill g">Checked in</span>`
          : `<span class="pill n">Reserved</span>`;
        const cancelledTrip = r.trip_status === 'cancelled';
        return `<div class="card">
          <div class="row"><b>${fmtDate(r.date)}${isToday(r.date)?' · Today':''} · ${r.departure_time}</b>${cancelledTrip?`<span class="pill r">Trip cancelled</span>`:st}</div>
          <div class="muted">→ Walmart${r.return_time?` · returns ${r.return_time}`:''} · driver ${esc(r.driver_name||'')}</div>
          ${cancelledTrip ? '' : `<div class="right" style="margin-top:10px;flex-wrap:wrap">
            ${r.status==='reserved'?`<button class="btn gold sm" data-action="confirm" data-res="${r.id}">Check in</button>`:''}
            <button class="btn red sm" data-action="cancelres" data-res="${r.id}">Cancel seat</button>
            <button class="btn red sm" data-action="stranded" data-res="${r.id}">I'm still at Walmart</button>
            <button class="btn ghost sm" data-action="sharetoggle" data-res="${r.id}" data-on="${r.share_loc?0:1}">${r.share_loc?'Stop sharing location':'Share my location'}</button>
          </div>${r.stranded?`<div class="gps-note">🚨 You flagged yourself as stranded — driver & ResLife notified.</div>`:''}`}
        </div>`;
      }).join('');
    } catch (e) { content().innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  // ---------- Live tracking ----------
  // Ported from Jeremy Mueller's shuttle-track (github.com/jeremy-mueller/shuttle-track):
  // same Beloit coordinates, OSRM ETA logic, Leaflet marker + animation. Adapted from
  // his WebSocket transport to this app's authenticated REST endpoints (HTTP polling).
  const CAMPUS_COORDS = { lat: 42.50636926562066, lng: -89.02955022039797 }; // The Wall
  const STORE_COORDS  = { lat: 42.52614093765691, lng: -88.98531210456696 }; // Walmart lot

  let _leafletPromise = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (_leafletPromise) return _leafletPromise;
    _leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load the map library (needs internet access).'));
      document.head.appendChild(s);
    });
    return _leafletPromise;
  }

  function stopTracking() {
    if (window._trackPoll) { clearInterval(window._trackPoll); window._trackPoll = null; }
    if (window._etaLoop) { clearInterval(window._etaLoop); window._etaLoop = null; }
    if (window._geoWatch != null && navigator.geolocation) { navigator.geolocation.clearWatch(window._geoWatch); window._geoWatch = null; }
  }

  // ETA via the free OSRM routing service (same call his driver.html makes).
  async function fetchETA(lat, lng, dLat, dLng) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${lng},${lat};${dLng},${dLat}?overview=false`;
      const r = await fetch(url); const d = await r.json();
      if (d.code === 'Ok') return Math.round(d.routes[0].duration / 60);
    } catch (e) {}
    return '--';
  }

  async function viewTrack() {
    stopTracking();
    loading();
    try {
      const { trips } = await api('GET', '/trips/today');
      const t = trips.find(x => x.status === 'running') || trips[0];
      if (!t) { content().innerHTML = `<h2 class="title">Live shuttle</h2><div class="empty">No shuttle scheduled today to track.</div>`; return; }
      if (state.user.role === 'driver' || state.user.role === 'admin') return driverBroadcast(t);
      return studentMap(t);
    } catch (e) { content().innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  // Student: full Leaflet map that polls the trip's live location.
  async function studentMap(trip) {
    content().innerHTML = `<h2 class="title">Live shuttle</h2>
      <div class="card" style="padding:0;overflow:hidden">
        <div class="track-head">
          <span class="live-dot" id="liveDot"></span><span id="liveText">Connecting…</span>
          <span class="spacer"></span>
          <span class="eta-chip">Campus <b id="etaCampus">--</b>m</span>
          <span class="eta-chip gold">Walmart <b id="etaStore">--</b>m</span>
        </div>
        <div id="liveMap"></div>
      </div>
      <div class="muted" style="margin-top:8px">Tracking the ${fmtDate(trip.date)} ${trip.departure_time} run · driver ${esc(trip.driver_name||'')}. Live GPS comes from the driver's device.</div>`;
    // The live status + ETA come from our own backend and work on their own.
    // The Leaflet map (CDN + tiles) needs internet, so we load it separately and
    // never let a map problem block the textual live info.
    let map = null, marker = null, circle = null, anim = null, icon = null;
    loadLeaflet().then(() => {
      map = L.map('liveMap', { attributionControl: false }).setView([42.5083, -89.0318], 13);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 20 }).addTo(map);
      setTimeout(() => map.invalidateSize(), 200);
      L.circleMarker([CAMPUS_COORDS.lat, CAMPUS_COORDS.lng], { radius: 6, color: '#003865', fillColor: '#003865', fillOpacity: 1 }).addTo(map).bindTooltip('Campus (The Wall)');
      L.circleMarker([STORE_COORDS.lat, STORE_COORDS.lng], { radius: 6, color: '#006F62', fillColor: '#006F62', fillOpacity: 1 }).addTo(map).bindTooltip('Walmart');
      icon = L.divIcon({ html: `<svg width="34" height="34" viewBox="0 0 24 24" style="transform:rotate(0deg);transition:transform 1s linear;transform-origin:center"><path d="M12 2L22 22L12 18L2 22L12 2Z" fill="#F2A900" stroke="#003865" stroke-width="2"/></svg>`, className: '', iconSize: [34, 34], iconAnchor: [17, 17] });
    }).catch(() => {
      const m = document.getElementById('liveMap');
      if (m) m.innerHTML = `<div class="empty" style="padding:40px">Map needs internet to load — the live status and ETA above still update.</div>`;
    });

    function animate(mk, ci, tLat, tLng, tRad, dur) {
      if (anim) cancelAnimationFrame(anim);
      const s = mk.getLatLng(), sr = ci.getRadius(), t0 = performance.now();
      (function step(now) {
        const p = Math.min((now - t0) / dur, 1);
        const la = s.lat + (tLat - s.lat) * p, ln = s.lng + (tLng - s.lng) * p, r = sr + (tRad - sr) * p;
        mk.setLatLng([la, ln]); ci.setLatLng([la, ln]); ci.setRadius(r);
        if (p < 1) anim = requestAnimationFrame(step);
      })(performance.now());
    }

    async function poll() {
      let d; try { d = await api('GET', `/trips/${trip.id}/location`); } catch (e) { return; }
      const dot = document.getElementById('liveDot'), txt = document.getElementById('liveText');
      if (!dot) return; // navigated away
      if (!d.available) { txt.textContent = 'Waiting for the driver to start tracking…'; dot.className = 'live-dot'; return; }
      if (d.etaCampus != null && d.etaCampus !== '--') document.getElementById('etaCampus').textContent = d.etaCampus;
      if (d.etaStore != null && d.etaStore !== '--') document.getElementById('etaStore').textContent = d.etaStore;
      const rad = d.acc || 20, pos = [d.lat, d.lng];
      if (d.stale) { txt.textContent = 'Shuttle offline'; dot.className = 'live-dot off'; }
      else { txt.textContent = 'Shuttle is live'; dot.className = 'live-dot on'; }
      if (!map || !window.L || !icon) return;   // map not ready yet — status/ETA already updated
      if (!marker) {
        marker = L.marker(pos, { icon }).addTo(map);
        circle = L.circle(pos, { radius: rad, color: '#003865', fillColor: '#003865', fillOpacity: 0.15 }).addTo(map);
        map.setView(pos, 15);
      } else {
        marker.setOpacity(d.stale ? 0.45 : 1);
        animate(marker, circle, d.lat, d.lng, rad, 1000);
      }
      if (typeof d.heading === 'number' && marker.getElement()) {
        const svg = marker.getElement().querySelector('svg'); if (svg) svg.style.transform = `rotate(${d.heading}deg)`;
      }
    }
    window._trackPoll = setInterval(poll, 3000); poll();
  }

  // Driver: broadcast this device's GPS (the app-native version of his driver.html).
  async function driverBroadcast(trip) {
    content().innerHTML = `<h2 class="title">Broadcast location</h2>
      <div class="card">
        <div class="row"><b>${fmtDate(trip.date)}${isToday(trip.date)?' · Today':''} · ${trip.departure_time}</b>
          <span class="pill ${trip.status==='running'?'g':'n'}" id="runStatus">${esc(trip.status)}</span></div>
        <div class="muted">${trip.seats_taken}/${trip.seat_capacity} riders · from ${esc(trip.pickup_point)} → Walmart</div>
        <div class="track-stats">
          <div><span class="muted">GPS</span><div id="gpsStat">Inactive</div></div>
          <div><span class="muted">Lat / Lng</span><div id="ll">--</div></div>
          <div><span class="muted">Accuracy</span><div id="accStat">--</div></div>
          <div><span class="muted">ETA campus / Walmart</span><div id="etaStat">-- / --</div></div>
        </div>
        <button class="btn gold block" id="startBc">Start tracking my run</button>
        <button class="btn red block" id="stopBc" style="display:none">Stop tracking</button>
        <div class="gps-note">Starting shares your device's GPS with riders and marks the run “on the way” (emails them). Keep this tab open while driving.</div>
      </div>`;
    const startBtn = document.getElementById('startBc'), stopBtn = document.getElementById('stopBc');
    const latest = { campus: '--', store: '--' };

    startBtn.onclick = async () => {
      if (!('geolocation' in navigator)) { toast('Geolocation is not supported on this device'); return; }
      try { await api('PATCH', `/trips/${trip.id}/status`, { status: 'running' }); document.getElementById('runStatus').textContent = 'running'; } catch (e) {}
      startBtn.style.display = 'none'; stopBtn.style.display = 'block';
      document.getElementById('gpsStat').textContent = 'Requesting permission…';
      // Recompute ETAs every 30s (same cadence as his driver.html).
      window._etaLoop = setInterval(async () => {
        const ll = document.getElementById('ll').textContent;
        if (ll && ll !== '--') {
          const [la, ln] = ll.split(',').map(s => parseFloat(s));
          latest.campus = await fetchETA(la, ln, CAMPUS_COORDS.lat, CAMPUS_COORDS.lng);
          latest.store = await fetchETA(la, ln, STORE_COORDS.lat, STORE_COORDS.lng);
          const el = document.getElementById('etaStat'); if (el) el.textContent = `${latest.campus} / ${latest.store}`;
        }
      }, 30000);
      window._geoWatch = navigator.geolocation.watchPosition(async (pos) => {
        const { latitude: lat, longitude: lng, accuracy: acc, heading } = pos.coords;
        const g = document.getElementById('gpsStat'); if (!g) return;
        g.textContent = 'Tracking active';
        document.getElementById('ll').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        document.getElementById('accStat').textContent = `± ${Math.round(acc)} m`;
        try { await api('POST', `/trips/${trip.id}/location`, { lat, lng, acc, heading, timestamp: pos.timestamp, etaCampus: latest.campus, etaStore: latest.store }); } catch (e) {}
      }, (err) => { const g = document.getElementById('gpsStat'); if (g) g.textContent = 'Error: code ' + err.code; },
         { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
      toast('Broadcasting — riders can see you now');
    };
    stopBtn.onclick = () => {
      stopTracking();
      startBtn.style.display = 'block'; stopBtn.style.display = 'none';
      document.getElementById('gpsStat').textContent = 'Stopped';
      toast('Stopped broadcasting');
    };
  }

  // ---------- Carpools ----------
  async function viewCarpools() {
    loading();
    try {
      const { carpools } = await api('GET', '/carpools');
      const offer = `<div class="card"><h3>Offer a ride</h3>
        <form id="cpForm">
          <div class="grid2">
            <div><label>Date</label><input name="date" type="date" required></div>
            <div><label>Time</label><input name="time" type="time" required></div>
          </div>
          <label>Meeting spot</label><input name="meeting_spot" placeholder="Chapin Hall" required>
          <div class="grid2">
            <div><label>Seats</label><input name="seat_capacity" type="number" min="1" max="7" value="3"></div>
            <div><label>Car</label><input name="car_desc" placeholder="Silver Honda Civic"></div>
          </div>
          <label>Gas split / notes</label><input name="gas_split" placeholder="~$2 each">
          <button class="btn block" type="submit">Post my carpool</button>
        </form></div>`;
      const list = carpools.length ? carpools.map(carpoolCard).join('') : `<div class="empty">No carpools posted yet — be the first to offer one.</div>`;
      content().innerHTML = `<h2 class="title">Carpools</h2>` + list + offer;
      document.getElementById('cpForm').onsubmit = async (e) => {
        e.preventDefault();
        try { await api('POST', '/carpools', Object.fromEntries(new FormData(e.target).entries())); toast('Carpool posted'); viewCarpools(); }
        catch (err) { toast(err.message); }
      };
    } catch (e) { content().innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  function carpoolCard(c) {
    const status = c.status === 'full' ? `<span class="pill r">Full</span>`
      : c.status === 'cancelled' ? `<span class="pill r">Cancelled</span>`
      : `<span class="pill g">${c.seats_left} seats</span>`;
    let action = '';
    if (c.is_driver) {
      action = `<button class="btn ghost sm" data-action="openreqs" data-cp="${c.id}">View requests</button>
                <button class="btn red sm" data-action="cancelcp" data-cp="${c.id}">Cancel</button>`;
    } else if (c.my_request === 'approved') action = `<span class="pill g">You're in ✓</span>`;
    else if (c.my_request === 'pending') action = `<span class="pill y">Requested…</span>`;
    else if (c.status === 'open') action = `<button class="btn gold sm" data-action="requestcp" data-cp="${c.id}">Request seat</button>`;
    else action = `<span class="pill n">${esc(c.status)}</span>`;
    return `<div class="card">
      <div class="row"><div class="flex"><span class="avatar">${initials(c.driver_name)}</span>
        <div><b>${esc(c.driver_name)}</b> <span class="pill y">★ ${(c.driver_rating||5).toFixed(1)}</span>
        <div class="muted">${fmtDate(c.date)} · ${c.time} · ${esc(c.car_desc||'car')}</div></div></div>${status}</div>
      <div class="muted">Meet at ${esc(c.meeting_spot)}${c.gas_split?` · ${esc(c.gas_split)}`:''}</div>
      <div class="right" style="margin-top:10px">${action}</div>
      <div id="reqs-${c.id}"></div>
    </div>`;
  }

  // ---------- DRIVER / ADMIN: Runs ----------
  async function viewRuns() {
    loading();
    try {
      const { trips } = await api('GET', '/trips/mine/driving');
      const form = `<div class="card"><h3>Add a run (your availability)</h3>
        <form id="tripForm">
          <div class="grid2">
            <div><label>Date</label><input name="date" type="date" required></div>
            <div><label>Departure</label><input name="departure_time" type="time" required></div>
          </div>
          <div class="grid2">
            <div><label>Return from Walmart</label><input name="return_time" type="time"></div>
            <div><label>Seats</label><input name="seat_capacity" type="number" min="1" value="14"></div>
          </div>
          <label>Pickup point</label><input name="pickup_point" value="Pearsons Hall">
          <button class="btn block" type="submit">Post this run</button>
        </form></div>`;
      const list = trips.length ? trips.map(runCard).join('') : `<div class="empty">No runs yet — add one below.</div>`;
      content().innerHTML = `<h2 class="title">Runs</h2>` + list + form;
      document.getElementById('tripForm').onsubmit = async (e) => {
        e.preventDefault();
        try { await api('POST', '/trips', Object.fromEntries(new FormData(e.target).entries())); toast('Run posted'); viewRuns(); }
        catch (err) { toast(err.message); }
      };
    } catch (e) { content().innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  function runCard(t) {
    const cancelled = t.status === 'cancelled';
    const st = cancelled ? `<span class="pill r">Cancelled</span>` : `<span class="pill n">${esc(t.status)}</span>`;
    return `<div class="card">
      <div class="row"><b>${fmtDate(t.date)}${isToday(t.date)?' · Today':''} · ${t.departure_time}</b>${st}</div>
      <div class="muted">${t.seats_taken}/${t.seat_capacity} riders · from ${esc(t.pickup_point)}${t.return_time?` · returns ${t.return_time}`:''}</div>
      ${cancelled ? `<div class="muted">Reason: ${esc(t.cancel_reason||'')}</div>` : `
      <div class="right" style="margin-top:10px;flex-wrap:wrap">
        <button class="btn ghost sm" data-action="roster" data-trip="${t.id}">Roster & contacts</button>
        ${t.status==='scheduled'?`<button class="btn gold sm" data-action="status" data-trip="${t.id}" data-status="running">Start trip</button>`:''}
        ${t.status==='running'?`<button class="btn gold sm" data-action="status" data-trip="${t.id}" data-status="completed">Complete</button>`:''}
        <button class="btn red sm" data-action="canceltrip" data-trip="${t.id}">Cancel run</button>
      </div>`}
    </div>`;
  }

  async function viewRoster() {
    loading();
    const tripId = state._rosterTrip;
    try {
      const { trip, roster, privileged } = await api('GET', `/trips/${tripId}/roster`);
      const rows = roster.length ? roster.map((r, i) => `
        <div class="row">
          <div class="flex"><b style="width:18px">${r.status==='waitlisted'?'—':i+1}</b>
            <span class="avatar">${initials(r.name)}</span>
            <div><b>${esc(r.name)}</b>${r.no_show_count?` <span class="pill r">${r.no_show_count} no-shows</span>`:''}
              <div class="muted">${privileged && r.phone ? esc(r.phone) : 'contact hidden'}</div></div>
          </div>
          <div class="right">
            ${r.stranded?`<span class="pill r">Stranded</span>`:''}
            <span class="pill ${r.status==='waitlisted'?'y':r.status==='confirmed'?'g':'n'}">${esc(r.status)}</span>
            ${r.status!=='no_show'&&r.status!=='waitlisted'?`<button class="btn red sm" data-action="noshow" data-res="${r.id}">No-show</button>`:''}
          </div>
        </div>`).join('') : `<div class="empty">No one on this run yet.</div>`;
      content().innerHTML = `<button class="btn ghost sm" data-action="backruns">← Back to runs</button>
        <h2 class="title" style="margin-top:12px">${fmtDate(trip.date)} · ${trip.departure_time}</h2>
        <div class="card"><h3>Roster · registered first, then walk-ins/waitlist</h3>
          <div class="muted" style="margin-bottom:6px">${trip.seats_taken}/${trip.seat_capacity} seats filled</div>
          ${rows}</div>`;
    } catch (e) { content().innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  // ---------- ADMIN: Dashboard ----------
  async function viewDashboard() {
    loading();
    try {
      const { stats, slots } = await api('GET', '/admin/dashboard');
      const cell = (n, l) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`;
      const slotRows = slots.length ? slots.map(s => {
        const over = s.waitlist > 0;
        return `<div class="row"><span>${esc(s.slot)}</span>
          <span class="pill ${over?'r':'g'}">${s.riders} riders${over?` · ${s.waitlist} waitlisted`:''}</span></div>`;
      }).join('') : `<div class="empty">No trips yet.</div>`;
      content().innerHTML = `<h2 class="title">ResLife dashboard</h2>
        <div class="grid2" style="margin-bottom:13px">
          ${cell(stats.trips_run,'Trips completed')}${cell(stats.total_riders,'Total riders')}
          ${cell(stats.avg_fill_pct+'%','Avg seats filled')}${cell(stats.waitlisted,'Waitlisted (unmet demand)')}
          ${cell(stats.no_shows,'No-shows')}${cell(stats.verified_students,'Verified students')}
        </div>
        <div class="card"><h3>Demand by slot — where to add runs</h3>${slotRows}</div>
        <div class="card"><h3>Broadcast to everyone</h3>
          <form id="bcForm"><textarea name="message" rows="2" placeholder="e.g. Sunday shuttle moved to 2pm this week" required></textarea>
          <button class="btn block" type="submit">Send broadcast</button></form></div>`;
      document.getElementById('bcForm').onsubmit = async (e) => {
        e.preventDefault();
        try { const r = await api('POST', '/admin/broadcast', Object.fromEntries(new FormData(e.target).entries()));
          toast(`Sent to ${r.sent} people`); e.target.reset(); }
        catch (err) { toast(err.message); }
      };
    } catch (e) { content().innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  async function viewUsers() {
    loading();
    try {
      const { users } = await api('GET', '/admin/users');
      content().innerHTML = `<h2 class="title">Users</h2><div class="card">` + users.map(u => `
        <div class="row"><div class="flex"><span class="avatar">${initials(u.name)}</span>
          <div><b>${esc(u.name)}</b><div class="muted">${esc(u.email)} · ${esc(u.phone||'no phone')}</div></div></div>
          <span class="pill ${u.role==='admin'?'y':u.role==='driver'?'g':'n'}">${u.role==='admin'?'ResLife':u.role}</span></div>`).join('') + `</div>`;
    } catch (e) { content().innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  // ---------- ADMIN: Email log ----------
  async function viewEmails() {
    loading();
    try {
      const { mode, emails } = await api('GET', '/admin/emails');
      const modeNote = mode === 'smtp'
        ? `<span class="mode-tag">Live SMTP</span>`
        : `<span class="mode-tag">Outbox (demo)</span>`;
      const rows = emails.length ? emails.map(e => `
        <div class="email-row">
          <div class="to">${esc(e.to)} <span class="pill ${e.status && e.status.startsWith('error')?'r':'g'}">${esc(e.status||'')}</span></div>
          <div class="subj"><b>${esc(e.subject)}</b></div>
          <div class="body">${esc(e.body)}</div>
        </div>`).join('') : `<div class="empty">No emails sent yet. Start or cancel a run, or approve a carpool, to trigger one.</div>`;
      content().innerHTML = `<h2 class="title">Email log ${modeNote}</h2>
        <div class="card"><div class="muted" style="margin-bottom:8px">Every automated email is recorded here. In demo mode nothing leaves the server; set SMTP env vars to send for real (see README).</div>${rows}</div>`;
    } catch (e) { content().innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  // ---------- notifications ----------
  let notifOpen = false;
  async function refreshBadge() {
    if (!state.token) return;
    try {
      const { unread } = await api('GET', '/notifications');
      const b = document.getElementById('bellBadge');
      if (!b) return;
      b.textContent = unread; b.style.display = unread ? 'flex' : 'none';
    } catch {}
  }
  async function toggleNotifs() {
    const existing = document.getElementById('notifPanel');
    if (existing) { existing.remove(); notifOpen = false; return; }
    const { notifications } = await api('GET', '/notifications');
    const panel = document.createElement('div');
    panel.className = 'notif-panel'; panel.id = 'notifPanel';
    panel.innerHTML = `<div class="head">Notifications <span class="muted" data-action="markread" style="cursor:pointer">Mark read</span></div>
      <div class="notif-list">${notifications.length ? notifications.map(n =>
        `<div class="notif-item ${n.is_read?'':'unread'}">${esc(n.message)}</div>`).join('')
        : `<div class="notif-item muted">No notifications yet.</div>`}</div>`;
    document.body.appendChild(panel);
    notifOpen = true;
    await api('POST', '/notifications/read'); refreshBadge();
  }

  // ---------- delegated actions ----------
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) { if (notifOpen && !e.target.closest('#notifPanel') && e.target.id !== 'bell') { const p = document.getElementById('notifPanel'); if (p) { p.remove(); notifOpen = false; } } return; }
    const a = el.dataset.action;
    try {
      if (a === 'reserve') { const r = await api('POST', `/trips/${el.dataset.trip}/reserve`); toast(r.status==='waitlisted'?'Added to waitlist':'Seat reserved!'); viewHome(); }
      else if (a === 'confirm') { await api('POST', `/trips/reservations/${el.dataset.res}/confirm`); toast('Checked in ✓'); viewMyTrips(); }
      else if (a === 'cancelres') { await api('POST', `/trips/reservations/${el.dataset.res}/cancel`); toast('Seat cancelled'); viewMyTrips(); }
      else if (a === 'stranded') { await api('POST', `/trips/reservations/${el.dataset.res}/stranded`); toast('Driver & ResLife notified 🚨'); viewMyTrips(); }
      else if (a === 'sharetoggle') { const r = await api('POST', `/trips/reservations/${el.dataset.res}/share-location`, { on: el.dataset.on==='1' }); toast(r.share_loc?'Location sharing on':'Location sharing off'); viewMyTrips(); }
      else if (a === 'roster') { state._rosterTrip = el.dataset.trip; state.view='roster'; renderShell(); viewRoster(); }
      else if (a === 'backruns') { navigate('runs'); }
      else if (a === 'status') { await api('PATCH', `/trips/${el.dataset.trip}/status`, { status: el.dataset.status }); toast('Updated'); viewRuns(); }
      else if (a === 'canceltrip') { await api('POST', `/trips/${el.dataset.trip}/cancel`, { reason: 'Cancelled by driver' }); toast('Run cancelled, riders notified'); viewRuns(); }
      else if (a === 'noshow') { await api('POST', `/trips/reservations/${el.dataset.res}/no-show`); toast('Marked no-show'); viewRoster(); }
      else if (a === 'requestcp') { await api('POST', `/carpools/${el.dataset.cp}/request`); toast('Seat requested'); viewCarpools(); }
      else if (a === 'cancelcp') { await api('POST', `/carpools/${el.dataset.cp}/cancel`); toast('Carpool cancelled'); viewCarpools(); }
      else if (a === 'openreqs') { await openRequests(el.dataset.cp); }
      else if (a === 'decidereq') { await api('POST', `/carpools/requests/${el.dataset.req}/decide`, { decision: el.dataset.decision }); toast(el.dataset.decision); openRequests(el.dataset.cp, true); }
      else if (a === 'markread') { await api('POST', '/notifications/read'); document.querySelectorAll('#notifPanel .notif-item').forEach(n => n.classList.remove('unread')); refreshBadge(); }
    } catch (err) { toast(err.message); }
  });

  async function openRequests(cpId, keep) {
    const box = document.getElementById('reqs-' + cpId);
    if (!box) return;
    if (box.innerHTML && !keep) { box.innerHTML = ''; return; }
    const { requests } = await api('GET', `/carpools/${cpId}/requests`);
    box.innerHTML = `<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px">` +
      (requests.length ? requests.map(r => `<div class="row"><div><b>${esc(r.name)}</b> <span class="muted">${esc(r.phone||'')}</span></div>
        <div class="right">${r.status==='pending' ? `
          <button class="btn gold sm" data-action="decidereq" data-req="${r.id}" data-cp="${cpId}" data-decision="approved">Approve</button>
          <button class="btn red sm" data-action="decidereq" data-req="${r.id}" data-cp="${cpId}" data-decision="declined">Decline</button>`
          : `<span class="pill ${r.status==='approved'?'g':'n'}">${esc(r.status)}</span>`}</div></div>`).join('')
        : `<div class="muted">No requests yet.</div>`) + `</div>`;
  }

  // ---------- boot ----------
  async function startApp() {
    navigate(navFor(state.user.role)[0][0]);
    refreshBadge();
    clearInterval(window._bsPoll);
    window._bsPoll = setInterval(refreshBadge, 20000);
  }

  async function boot() {
    if (!state.token) return renderAuth();
    try { const { user } = await api('GET', '/auth/me'); state.user = user; startApp(); }
    catch { localStorage.removeItem('bs_token'); state.token = null; renderAuth(); }
  }
  boot();
})();
