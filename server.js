// server.js — zero-dependency HTTP server: tiny router + static file serving.
// Run with: node server.js   (then open http://localhost:3000)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { userFromToken } = require('./auth');
const { HttpError } = require('./utils');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Collect all route definitions.
const routes = [
  ...require('./routes/auth'),
  ...require('./routes/trips'),
  ...require('./routes/carpools'),
  ...require('./routes/admin'),
];

// Pre-split route paths into segments for matching.
routes.forEach(r => { r._segs = r.path.split('/').filter(Boolean); });

function matchRoute(method, pathname) {
  const segs = pathname.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.method !== method) continue;
    if (r._segs.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      const rs = r._segs[i];
      if (rs.startsWith(':')) params[rs.slice(1)] = decodeURIComponent(segs[i]);
      else if (rs !== segs[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.png': 'image/png', '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  // Default document + SPA fallback.
  let rel = pathname === '/' ? '/index.html' : pathname;
  let filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: unknown non-file GET → index.html
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Non-API → static assets / SPA.
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const match = matchRoute(req.method, pathname);
  if (!match) return sendJSON(res, 404, { error: 'Not found' });

  const { route, params } = match;
  try {
    let user = null;
    if (route.auth || route.roles) {
      const hdr = req.headers.authorization || '';
      const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
      user = userFromToken(token);
      if (!user) throw new HttpError(401, 'Please sign in');
      if (route.roles && !route.roles.includes(user.role)) throw new HttpError(403, 'You do not have permission for that');
    }
    const body = (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') ? await readBody(req) : {};
    const result = await route.handler({ user, params, body, req });
    sendJSON(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) return sendJSON(res, err.status, { error: err.message });
    console.error('Server error:', err);
    sendJSON(res, 500, { error: 'Something went wrong' });
  }
});

server.listen(PORT, () => {
  console.log(`\n  🚐  Beloit Shuttle running at http://localhost:${PORT}`);
  console.log(`      (data stored in ${require('./store').FILE})`);
  console.log(`      Seed demo accounts with:  npm run seed\n`);
});
