/**
 * check-html.mjs — static checks on the Apps Script front end.
 *
 *   node tools/check-html.mjs
 *
 * Verifies:
 *   1. every inline <script> block in the HTML views parses as valid JS
 *   2. every include('X') target exists as X.html
 *   3. every api('serverFunction', …) call the pages make actually exists in Code.gs
 *   4. every .gs file the test harness expects is present
 *   5. the Arabic WhatsApp templates' placeholders are all supplied
 *   6. every config.* field a view reads is actually returned by getPublicConfig()
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const GS_DIR = path.join(here, '..', 'apps-script');

const HTML_FILES = ['Booking.html', 'Staff.html', 'Styles.html', 'ClientJs.html'];
const GS_FILES = [
  'Code.gs', 'Config.gs', 'Db.gs', 'Util.gs', 'I18n.gs', 'Catalog.gs',
  'Availability.gs', 'Booking.gs', 'Calendar.gs', 'Staff.gs', 'WhatsApp.gs',
  'Reports.gs', 'Notify.gs', 'Setup.gs'
];

let failed = 0;
const fail = (msg) => { failed++; console.log('  FAIL ' + msg); };
const ok = (msg) => console.log('  ok   ' + msg);

console.log('\n1. Files');
GS_FILES.forEach((f) => {
  if (!fs.existsSync(path.join(GS_DIR, f))) fail('missing apps-script/' + f);
  else ok('apps-script/' + f);
});
HTML_FILES.forEach((f) => {
  if (!fs.existsSync(path.join(GS_DIR, f))) fail('missing apps-script/' + f);
  else ok('apps-script/' + f);
});
if (!fs.existsSync(path.join(GS_DIR, 'appsscript.json'))) fail('missing appsscript.json');

console.log('\n2. Inline scripts parse');
HTML_FILES.forEach((f) => {
  const full = path.join(GS_DIR, f);
  if (!fs.existsSync(full)) return;
  const html = fs.readFileSync(full, 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (!blocks.length) { ok(`${f}: no inline script`); return; }
  blocks.forEach((code, i) => {
    if (!code.trim()) return;
    // Apps Script scriptlets (<?= … ?> / <?!= … ?>) are resolved server-side before the
    // browser ever sees the file, so they must be neutralised for a JS parse.
    const neutralised = code.replace(/<\?[\s\S]*?\?>/g, 'null');
    try {
      new vm.Script(neutralised, { filename: `${f}#script${i + 1}` });
      ok(`${f}: script ${i + 1} parses (${neutralised.split('\n').length} lines)`);
    } catch (err) {
      fail(`${f}: script ${i + 1} — ${err.message}`);
    }
  });
});

console.log('\n3. include() targets exist');
HTML_FILES.forEach((f) => {
  const full = path.join(GS_DIR, f);
  if (!fs.existsSync(full)) return;
  const html = fs.readFileSync(full, 'utf8');
  [...html.matchAll(/include\(\s*'([^']+)'\s*\)/g)].forEach((m) => {
    const target = path.join(GS_DIR, m[1] + '.html');
    if (!fs.existsSync(target)) fail(`${f} includes '${m[1]}' but ${m[1]}.html does not exist`);
    else ok(`${f} → ${m[1]}.html`);
  });
});

console.log('\n4. Client api() calls exist on the server');
const serverSource = GS_FILES
  .map((f) => (fs.existsSync(path.join(GS_DIR, f)) ? fs.readFileSync(path.join(GS_DIR, f), 'utf8') : ''))
  .join('\n');
const defined = new Set([...serverSource.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]));

HTML_FILES.forEach((f) => {
  const full = path.join(GS_DIR, f);
  if (!fs.existsSync(full)) return;
  const html = fs.readFileSync(full, 'utf8');
  const calls = [...html.matchAll(/\bapi\(\s*'([^']+)'/g)].map((m) => m[1]);
  [...new Set(calls)].forEach((name) => {
    if (defined.has(name)) ok(`${f} calls ${name}()`);
    else fail(`${f} calls ${name}() which is not defined in any .gs file`);
  });
});

console.log('\n5. Arabic WhatsApp templates have all their placeholders provided');
const i18nFull = fs.readFileSync(path.join(GS_DIR, 'I18n.gs'), 'utf8');
const waBlockStart = i18nFull.indexOf('const WA_TEMPLATES');
const waBlock = waBlockStart === -1 ? '' : i18nFull.slice(waBlockStart);
if (!waBlock) {
  fail('WA_TEMPLATES block not found in I18n.gs');
} else {
  const vars = [];
  const waVars = fs.readFileSync(path.join(GS_DIR, 'WhatsApp.gs'), 'utf8');
  [...waVars.matchAll(/^\s{4}(\w+):/gm)].forEach((m) => vars.push(m[1]));
  const used = [...new Set([...waBlock.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
  const missing = used.filter((v) => !vars.includes(v));
  const unused = vars.filter((v) => !used.includes(v));
  if (missing.length) missing.forEach((v) => fail(`template placeholder {${v}} is not returned by templateVars()`));
  else ok(`all ${used.length} placeholders are provided by templateVars()`);
  if (unused.length) console.log(`  note unused templateVars entries: ${unused.join(', ')}`);
}

console.log('\n6. The views\' config.* fields are all provided by getPublicConfig()');
const CONFIG_KEYS = (function () {
  // Ask the real function what it returns, with a settings object that answers
  // every key — so this cannot drift from Catalog.gs.
  const source =
    '(function(){\n' +
    fs.readFileSync(path.join(GS_DIR, 'Config.gs'), 'utf8') + '\n' +
    fs.readFileSync(path.join(GS_DIR, 'Catalog.gs'), 'utf8') + '\n' +
    'function getSettings(){ return new Proxy({}, { get: function(){ return "probe"; } }); }\n' +
    'return getPublicConfig();\n' +
    '})()';
  return Object.keys(vm.runInNewContext(source, {}));
})();

['Booking.html', 'Staff.html'].forEach((f) => {
  const full = path.join(GS_DIR, f);
  if (!fs.existsSync(full)) return;
  const html = fs.readFileSync(full, 'utf8');
  const used = [...new Set([...html.matchAll(/config\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
  const missing = used.filter((k) => !CONFIG_KEYS.includes(k));
  if (missing.length) {
    // This is the bug that made the booking header white-on-white: the page asked
    // for config.brandPrimary while the config carried brand_primary, so --primary
    // resolved to nothing and every var(--primary) rule collapsed.
    missing.forEach((k) => fail(`${f} uses config.${k} but getPublicConfig() does not provide it — styles that depend on it would collapse`));
  } else {
    ok(`${f}: all ${used.length} config.* fields are provided (${used.join(', ')})`);
  }
});

console.log('\n7. Every inline on*= handler exists in the page\'s own scripts');
const scriptOf = (file) => {
  const full = path.join(GS_DIR, file);
  if (!fs.existsSync(full)) return '';
  const html = fs.readFileSync(full, 'utf8');
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
};
['Booking.html', 'Staff.html'].forEach((f) => {
  const full = path.join(GS_DIR, f);
  if (!fs.existsSync(full)) return;
  const html = fs.readFileSync(full, 'utf8');
  // A handler may live in the page, or in a file the page includes.
  let pool = scriptOf(f);
  [...html.matchAll(/include\(\s*'([^']+)'\s*\)/g)].forEach((m) => { pool += '\n' + scriptOf(m[1] + '.html'); });
  const declared = new Set([...pool.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  const used = [...new Set([...html.matchAll(/\son\w+\s*=\s*"([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]))];
  const missing = used.filter((h) => !declared.has(h));
  if (missing.length) missing.forEach((h) => fail(`${f} wires on*= to ${h}() which no page script defines — the button would do nothing`));
  else ok(`${f}: all ${used.length} on*= handlers are defined`);
});

console.log(`\n${'-'.repeat(60)}`);
console.log(failed ? `${failed} problem(s) found` : 'front-end checks passed');
process.exit(failed ? 1 : 0);
