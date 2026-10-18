/**
 * serve-demo.mjs — a tiny static server for the offline demo.
 *
 *   node tools/serve-demo.mjs [port]
 *   → http://localhost:8787/demo/
 *
 * Why serve instead of double-clicking: every browser shares localStorage across
 * all file:// pages, but some (Safari, and Chrome with strict flags) isolate each
 * file. Serving over http guarantees that a booking made in the patient page shows
 * up on the reception screen, which is the whole point of the demo.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const PORT = Number(process.argv[2] || 8787);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (err) {
    res.writeHead(400).end('bad request');
    return;
  }
  if (pathname === '/') pathname = '/demo/index.html';

  const target = path.join(ROOT, path.normalize(pathname).replace(/^([/\\])+/, ''));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  let stat = null;
  try { stat = fs.statSync(target); } catch (err) { stat = null; }

  if (stat && stat.isDirectory()) {
    const index = path.join(target, 'index.html');
    if (fs.existsSync(index)) return send(index, res);
    const listing = fs.readdirSync(target).map((f) => `<li><a href="${pathname.replace(/\/$/, '')}/${f}">${f}</a></li>`).join('');
    res.writeHead(200, { 'content-type': TYPES['.html'] }).end(`<meta charset="utf-8"><ul>${listing}</ul>`);
    return;
  }

  if (!stat) {
    res.writeHead(404, { 'content-type': TYPES['.html'] })
      .end('<meta charset="utf-8"><p dir="rtl">الملف غير موجود. جرّب <a href="/demo/">/demo/</a>');
    return;
  }
  send(target, res);
});

function send(file, res) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'content-type': TYPES[ext] || 'application/octet-stream',
    'cache-control': 'no-store'
  });
  fs.createReadStream(file).pipe(res);
}

server.listen(PORT, () => {
  console.log('Demo running:');
  console.log('  launcher   http://localhost:' + PORT + '/demo/');
  console.log('  patient    http://localhost:' + PORT + '/demo/patient.html');
  console.log('  reception  http://localhost:' + PORT + '/demo/reception.html');
  console.log('\nCtrl+C to stop.');
});
