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
 * The build creates three entries from the same shell:
 *   /        patient booking (forwards campaign parameters)
 *   /staff/  reception app (fixed to ?page=staff)
 *   /admin/  admin and doctor app (fixed to ?page=admin)
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

const ENTRIES = [
  {
    dir: '',
    query: '',
    title: 'العيادة — حجز المواعيد',
    appleTitle: 'العيادة',
    name: 'العيادة — حجز المواعيد',
    shortName: 'العيادة',
    description: 'نظام حجز مواعيد العيادة — للمرضى'
  },
  {
    dir: 'staff',
    query: '?page=staff',
    title: 'شاشة الاستقبال — العيادة',
    appleTitle: 'الاستقبال',
    name: 'العيادة — الاستقبال',
    shortName: 'الاستقبال',
    description: 'شاشة الاستقبال اليومية — للموظفين'
  },
  {
    dir: 'admin',
    query: '?page=admin',
    title: 'إعدادات العيادة — العيادة',
    appleTitle: 'الإدارة',
    name: 'العيادة — الإدارة',
    shortName: 'الإدارة',
    description: 'إعدادات العيادة وبوابة الأطباء'
  }
];

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

ENTRIES.forEach(function (entry) {
  const target = entry.dir ? path.join(OUT, entry.dir) : OUT;
  if (entry.dir) {
    fs.cpSync(SRC, target, { recursive: true });
    // Only the root _redirects and README are part of the deployed site.
    fs.rmSync(path.join(target, '_redirects'), { force: true });
    fs.rmSync(path.join(target, 'README.md'), { force: true });
  }

  const wrapper = path.join(target, 'index.html');
  let html = fs.readFileSync(wrapper, 'utf8');
  if (html.indexOf('__APP_URL__') === -1 || html.indexOf('__START_QUERY__') === -1) {
    throw new Error(entry.dir + '/index.html lost a build placeholder — refusing to build a broken shell');
  }
  html = html.split('__START_QUERY__').join(entry.query)
    .split('__APP_URL__').join(APP_URL)
    .replace('<title>العيادة — حجز المواعيد</title>', '<title>' + entry.title + '</title>')
    .replace('<meta name="apple-mobile-web-app-title" content="العيادة">',
      '<meta name="apple-mobile-web-app-title" content="' + entry.appleTitle + '">');
  fs.writeFileSync(wrapper, html);

  const manifestPath = path.join(target, 'manifest.webmanifest');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.name = entry.name;
  manifest.short_name = entry.shortName;
  manifest.description = entry.description;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // A placeholder that survived would install a shell framing a broken URL.
  if (fs.readFileSync(wrapper, 'utf8').indexOf('__APP_URL__') !== -1 ||
      fs.readFileSync(wrapper, 'utf8').indexOf('__START_QUERY__') !== -1) {
    throw new Error(entry.dir + '/index.html still contains a build placeholder');
  }
  ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'manifest.webmanifest'].forEach((f) => {
    if (!fs.existsSync(path.join(target, f))) throw new Error('dist/pwa/' + entry.dir + ' is missing ' + f);
  });
});

if (!fs.existsSync(path.join(OUT, '_redirects'))) {
  throw new Error('dist/pwa/_redirects is missing — /staff and /admin would 404 without it');
}

console.log('dist/pwa/ is ready.');
console.log('  app framed: ' + APP_URL);
console.log('  patient entry: /');
console.log('  staff entry:   /staff/');
console.log('  admin entry:   /admin/');
console.log('  upload the dist/pwa folder to a static host (Cloudflare Pages → Upload assets).');
