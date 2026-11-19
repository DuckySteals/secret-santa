// Sends one plain-text email over SMTP (Gmail by default: smtp.gmail.com:465 with an app password).
import { connect } from 'cloudflare:sockets';

export async function sendMail(env, to, subject, text) {
  const sock = connect({ hostname: env.SMTP_HOST || 'smtp.gmail.com', port: +(env.SMTP_PORT || 465) },
    { secureTransport: env.SMTP_TLS === 'off' ? 'off' : 'on' });
  const w = sock.writable.getWriter(), r = sock.readable.getReader();
  const dec = new TextDecoder(), enc = new TextEncoder();
  let buf = '';
  // Read one full reply (multi-line replies use "250-" until the last "250 ").
  const reply = async want => {
    for (;;) {
      const lines = buf.split('\r\n');
      const end = lines.findIndex(l => /^\d{3} /.test(l));
      if (end >= 0) {
        buf = lines.slice(end + 1).join('\r\n');
        if (!lines[end].startsWith(want)) throw new Error(`SMTP: ${lines[end]}`);
        return;
      }
      const { value, done } = await r.read();
      if (done) throw new Error('SMTP: connection closed');
      buf += dec.decode(value);
    }
  };
  const cmd = async (line, want) => { await w.write(enc.encode(line + '\r\n')); await reply(want); };
  try {
    await reply('220');
    await cmd('EHLO secret-santa', '250');
    await cmd(`AUTH PLAIN ${btoa(`\0${env.SMTP_USER}\0${env.SMTP_PASS}`)}`, '235');
    await cmd(`MAIL FROM:<${env.SMTP_USER}>`, '250');
    await cmd(`RCPT TO:<${to}>`, '250');
    await cmd('DATA', '354');
    const body = text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    await cmd([
      `From: Secret Santa <${env.SMTP_USER}>`, `To: <${to}>`, `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@secret-santa>`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit',
      '', body, '.',
    ].join('\r\n'), '250');
    await w.write(enc.encode('QUIT\r\n'));
  } finally {
    await sock.close().catch(() => {});
  }
}
