# 🚐 Beloit Shuttle

A web app for the Beloit College → Walmart shuttle: students can see whether the
shuttle is **running today**, **reserve a seat** (with a 15-minute priority window
and automatic waitlist), and fall back on **student-run carpools**. Drivers manage
their schedule and rosters; ResLife gets a demand dashboard and can broadcast to
everyone. Everyone signs in with a verified **@beloit.edu** account.

Styled to the **Beloit College** brand — Beloit Blue `#003865`, Beloit Gold `#F2A900`,
the *"Be more. Be remarkable."* tagline, the college motto *Scientia vera cum fide pura*,
and a Middle College campus photo on the sign-in screen. Headings use Fraunces (serif),
UI text uses Inter, loaded from Google Fonts (falls back to system fonts offline).

> **Live GPS tracking is integrated.** The tracking + ETA logic is ported from
> Jeremy Mueller's [shuttle-track](https://github.com/jeremy-mueller/shuttle-track)
> (Beloit coordinates, OSRM ETA, Leaflet map) and adapted from his Python/WebSocket
> server to this app's authenticated REST endpoints. See
> [Live tracking](#live-tracking) below.

---

## Running it

You only need **Node.js 18+**. There are **no external dependencies** to install —
the whole thing runs on Node's built-in modules.

```bash
npm run seed      # create demo accounts + trips (first time only)
npm start         # start the server
```

Then open **http://localhost:3000**.

Demo accounts (all use password **`password123`**):

| Role     | Email                 |
|----------|-----------------------|
| ResLife  | `reslife@beloit.edu`  |
| Driver   | `marcus@beloit.edu`   |
| Student  | `priya@beloit.edu` (also liam@, grace@, aisha@, sam@) |

To wipe and reseed: `npm run reset`.
To run the automated test suite (server must be running): `node test.js`.

---

## Features

**Auth** — register/login, passwords hashed with scrypt, sessions via opaque
tokens, `@beloit.edu` enforced, three roles (student / driver / admin).

**Students** — "running today?" banner, 7-day upcoming list, reserve a seat (15-min
cutoff, priority by reserve time, auto-waitlist when full), check-in, cancel,
"I'm still at Walmart" stranded flag, **live shuttle map with ETA to campus & Walmart**, browse/join/offer
carpools, notifications.

**Drivers** — post availability/runs, see rosters **with rider phone numbers**
(revealed only to the trip's driver and ResLife), mark no-shows, start/complete/cancel
a run (cancelling notifies everyone registered), **broadcast live GPS from their phone**.

**ResLife / admin** — demand dashboard (trips run, riders, avg fill, waitlist =
unmet demand, no-shows, busiest slots), broadcast messages, user list, **email log**.

---

## Email notifications

Automated emails fire on these events (in addition to the in-app bell):

| Event | Who gets emailed |
|-------|------------------|
| Driver **starts** a run ("picks up" the shift) | every rider booked on that run |
| Driver **cancels** a run | every rider booked on that run |
| Someone **requests** your carpool | the carpool driver |
| Carpool request **approved** | the rider ("you're confirmed") **and** the driver ("X is joining you") |
| Carpool request declined | the rider |

**Two transports, chosen automatically:**

- **Outbox (default, no setup):** every email is recorded and shown on the ResLife
  **Email log** screen and printed to the server console. Nothing leaves the machine —
  perfect for developing and demoing. This is what runs out of the box.
- **Real SMTP (optional):** set these environment variables and mail is actually sent
  over TLS (port 465, `AUTH LOGIN`):

  ```bash
  SMTP_HOST=smtp.gmail.com SMTP_USER=you@gmail.com SMTP_PASS=your_app_password \
  MAIL_FROM="Beloit Shuttle <you@gmail.com>" npm start
  ```

  For Gmail, create an **App Password** (not your normal password). Any standard SMTP
  relay works (SendGrid, Mailgun, your college's SMTP, etc.). The Email log screen
  shows `Live SMTP` instead of `Outbox (demo)` when SMTP is configured.

> Note: the SMTP client is a minimal hand-rolled implementation (zero dependencies).
> It's straightforward, but for high volume in production you'd swap `mailer.js` for a
> service SDK/API.

---

## Project layout

```
server.js            HTTP server: tiny router + static file serving (no framework)
store.js             JSON-file datastore (swappable for SQLite/Firebase)
auth.js              password hashing + session tokens (node:crypto)
mailer.js            email sending — outbox (default) or real SMTP over TLS
utils.js             shared helpers (notify, email, seat math, waitlist promotion)
seed.js              demo data
test.js              end-to-end API tests
routes/
  auth.js            register / login / me
  trips.js           schedule, reservations, waitlist, stranded, live location
  carpools.js        carpool posts + requests
  admin.js           notifications + dashboard + broadcast + email log
public/
  index.html         SPA shell (Beloit brand fonts + favicon)
  app.js             all front-end views & logic (vanilla JS)
  styles.css         Beloit-branded styling
  img/campus.jpg     Middle College campus photo (sign-in hero)
```

Data persists to `data.json` in the project root.

---

## Live tracking

Ported from **Jeremy Mueller's [shuttle-track](https://github.com/jeremy-mueller/shuttle-track)**
— his Beloit coordinates (campus = "The Wall", store = Walmart lot), his OSRM ETA
calls, and his Leaflet map/marker/animation. The one change: his standalone
Python/FastAPI server broadcast over **WebSockets** with a single global shuttle and
no login; here it's folded into this app's **authenticated, per-trip REST API** so the
map is tied to real runs and only the run's driver can broadcast.

**How it flows (all in `routes/trips.js` + `public/app.js`):**

1. A **driver** opens **Track → "Start tracking my run."** The browser reads GPS with
   `navigator.geolocation.watchPosition`, recomputes ETAs to campus + Walmart every 30s
   via OSRM, and `POST`s each fix to `POST /api/trips/:id/location`. Starting also marks
   the run `running` (which fires the "on the way" emails).
2. **Students** open **Track** and see a **Leaflet** map that polls
   `GET /api/trips/:id/location` every 3s, animating the shuttle marker and showing both
   ETAs. Live status + ETA come from your own backend, so they work even if the map
   library is slow; the map tiles themselves need internet.
3. If the driver stops (or the run isn't `running`), the last fix is older than 20s and
   the app shows **"Shuttle offline"** — the same idea as his WebSocket disconnect signal.

**Payload shape** is identical to his, so his work stays compatible:

```json
{ "lat": 42.51, "lng": -89.01, "acc": 9, "heading": 45,
  "timestamp": 1699999999999, "etaCampus": 5, "etaStore": 11 }
```

**Requires internet at runtime** for three third-party pieces (as in the original):
Leaflet from unpkg, map tiles from CARTO/OpenStreetMap, and routing/ETA from the public
OSRM server. For heavy use, self-host OSRM or swap in Mapbox/Google Directions.

**If you'd rather keep his WebSocket server as the source of truth** (e.g. while he's
still developing it), you can instead point `studentMap()` at his `ws://…/ws/student`
feed and drop the polling — the payload is the same. This port is the single-server,
no-Python path; that's the two-server path.

---

## Notes for going to production

This is a working MVP built to be easy to run and read. Before real deployment:

- **Datastore** — `store.js` is a JSON file (fine for campus scale, single process).
  Swap it for **SQLite** or **Firebase** by reimplementing the same small function
  surface (`insert/find/findOne/update/all`); no route handler changes needed.
- **Secrets** — set a real `JWT_SECRET`-style secret and serve over HTTPS.
- **Notifications** — currently in-app (with an unread bell). Add web push / SMS
  (e.g. Twilio) for the critical "left behind / cancelled" cases.
- **Privacy** — phone numbers are only exposed to a trip's driver and ResLife, and
  location sharing is opt-in; keep it that way, and loop in ResLife/campus IT before
  handling real student data. (See the product plan in the project.)

---

## Credits

Live GPS tracking + ETA logic is ported and adapted from **Jeremy Mueller's
[shuttle-track](https://github.com/jeremy-mueller/shuttle-track)** (Leaflet map, OSRM
ETA, Beloit campus/Walmart coordinates). Thanks Jeremy. Map data © OpenStreetMap
contributors, tiles © CARTO, routing by the public OSRM demo server.
