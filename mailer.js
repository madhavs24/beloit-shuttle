// mailer.js — zero-dependency email sending with two transports:
//
//   1) OUTBOX (default): every email is recorded in the datastore + logged to the
//      console. No config needed — works and is testable out of the box, and the
//      ResLife "Email log" screen shows exactly what was sent.
//
//   2) SMTP (optional): if SMTP_HOST / SMTP_USER / SMTP_PASS env vars are set, mail
//      is delivered for real over TLS (implicit TLS, port 465) using AUTH LOGIN.
//      Tested against Gmail app-passwords / SendGrid-style relays. See README.
//
// Public API:  sendMail({ to, subject, text }) -> Promise
const tls = require('tls');
const store = require('./store');

const FROM = process.env.MAIL_FROM || 'Beloit Shuttle <no-reply@beloit.edu>';
const SMTP = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
};
const useSMTP = !!(SMTP.host && SMTP.user && SMTP.pass);

function record(to, subject, text, status) {
  store.insert('emails', { to, subject, body: text, transport: useSMTP ? 'smtp' : 'outbox', status });
}

async function sendMail({ to, subject, text }) {
  if (!to) return { ok: false, skipped: 'no recipient' };
  if (!useSMTP) {
    record(to, subject, text, 'logged');
    console.log(`\n  ✉  [outbox] To: ${to}\n     Subject: ${subject}\n     ${text.replace(/\n/g, '\n     ')}\n`);
    return { ok: true, transport: 'outbox' };
  }
  try {
    await smtpSend(to, subject, text);
    record(to, subject, text, 'sent');
    return { ok: true, transport: 'smtp' };
  } catch (e) {
    record(to, subject, text, 'error: ' + e.message);
    console.error('  ✉  SMTP send failed:', e.message);
    return { ok: false, error: e.message };
  }
}

// Minimal SMTP-over-TLS (implicit TLS / port 465) client with AUTH LOGIN.
function smtpSend(to, subject, text) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: SMTP.host, port: SMTP.port, servername: SMTP.host }, () => {});
    let buf = '';
    let step = 0;
    const b64 = s => Buffer.from(s).toString('base64');
    const msg = [
      `From: ${FROM}`, `To: ${to}`, `Subject: ${subject}`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', text, '',
    ].join('\r\n');
    const script = [
      { expect: 220, send: `EHLO beloit-shuttle\r\n` },
      { expect: 250, send: `AUTH LOGIN\r\n` },
      { expect: 334, send: `${b64(SMTP.user)}\r\n` },
      { expect: 334, send: `${b64(SMTP.pass)}\r\n` },
      { expect: 235, send: `MAIL FROM:<${SMTP.user}>\r\n` },
      { expect: 250, send: `RCPT TO:<${to}>\r\n` },
      { expect: 250, send: `DATA\r\n` },
      { expect: 354, send: `${msg}\r\n.\r\n` },
      { expect: 250, send: `QUIT\r\n` },
    ];
    socket.setEncoding('utf8');
    socket.setTimeout(15000, () => { socket.destroy(); reject(new Error('SMTP timeout')); });
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      buf += chunk;
      if (!buf.endsWith('\n')) return;
      const code = parseInt(buf.slice(0, 3), 10);
      const cur = script[step];
      buf = '';
      if (cur.expect && code !== cur.expect) { socket.destroy(); return reject(new Error(`SMTP ${code} (wanted ${cur.expect})`)); }
      if (cur.send) socket.write(cur.send);
      step++;
      if (step >= script.length) { socket.end(); resolve(); }
    });
  });
}

module.exports = { sendMail, mailMode: () => (useSMTP ? 'smtp' : 'outbox') };
