/**
 * build-pwa.mjs — assembles the installable app shell into dist/pwa/.
 *
 *   node tools/build-pwa.mjs
 *
 * pwa/index.html deliberately ships with an __APP_URL__ placeholder: the public
 * repository must never carry the live booking URL. This script fills it in from the
 * git-ignored apps-script/.clasp.json, so the real URL exists only on this machine
 * (and on whatever host the dist/pwa folder is uploaded to).
 *
 * Output is dist/pwa/ — upload that folder to any static host. The recommended one is
 * Cloudflare Pages (free, commercial use allowed); see pwa/README.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');

const claspPath = path.join(ROOT, 'apps-script', '.clasp.json');
if (!fs.existsSync(claspPath)) {
  throw new Error('apps-script/.clasp.json not found — this machine has no clasp project, so the live URL cannot be baked in');
}
const clasp = JSON.parse(fs.readFileSync(claspPath, 'utf8'));
if (!clasp.deploymentId) {
  throw new Error('apps-script/.clasp.json has no "deploymentId" — add the id from "clasp deployments" first');
}
const APP_URL = 'https://script.google.com/macros/s/' + clasp.deploymentId + '/exec';

const SRC = path.join(ROOT, 'pwa');
const OUT = path.join(ROOT, 'dist', 'pwa');

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

const wrapper = path.join(OUT, 'index.html');
let html = fs.readFileSync(wrapper, 'utf8');
if (html.indexOf('__APP_URL__') === -1) {
  throw new Error('pwa/index.html has lost its __APP_URL__ placeholder — refusing to build a shell with no app');
}
html = html.split('__APP_URL__').join(APP_URL);
fs.writeFileSync(wrapper, html);

// The placeholder must be gone from the built copy, or a patient could install a shell
// that frames a literally broken URL.
if (fs.readFileSync(wrapper, 'utf8').indexOf('__APP_URL__') !== -1) {
  throw new Error('placeholder survived the build');
}
['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'manifest.webmanifest'].forEach((f) => {
  if (!fs.existsSync(path.join(OUT, f))) throw new Error('dist/pwa is missing ' + f);
});

console.log('dist/pwa/ is ready.');
console.log('  app framed: ' + APP_URL);
console.log('  upload the dist/pwa folder to a static host (Cloudflare Pages → Upload assets).');
