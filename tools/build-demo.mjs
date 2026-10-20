/**
 * build-demo.mjs — produces the offline demo.
 *
 *   node tools/build-demo.mjs
 *
 * Output (both are single, self-contained files — no server, no internet):
 *   demo/patient.html     the real booking page, running the real slot engine
 *   demo/reception.html   the real reception screen, running the real staff actions
 *
 * Nothing here reimplements product logic: the .gs files and the two HTML views are
 * used verbatim, with a browser runtime that fakes Google's storage. That is why the
 * demo cannot drift away from what will actually be deployed.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const GS = path.join(ROOT, 'apps-script');
const OUT = path.join(ROOT, 'demo');

const SERVER_FILES = [
  'Config.gs', 'Util.gs', 'Db.gs', 'I18n.gs', 'Catalog.gs', 'Availability.gs',
  'Calendar.gs', 'WhatsApp.gs', 'BookingApi.gs', 'Reports.gs', 'StaffApi.gs',
  'Notify.gs', 'Setup.gs', 'AdminApi.gs', 'Code.gs'
];

const read = (p) => fs.readFileSync(p, 'utf8');
const token = (text, name, value) => text.replace(name, () => value);

/* ------------------------------------------------------------------ *
 * 1. The real server source
 * ------------------------------------------------------------------ */

const serverSource = SERVER_FILES.map((f) => read(path.join(GS, f))).join('\n');

// Read SETTING_DEFAULTS out of the real Config.gs so the demo's view config cannot drift.
const configApi = vm.runInNewContext(
  '(function(){' + read(path.join(GS, 'Config.gs')) + '\nreturn {SETTING_DEFAULTS, SETTING};})()',
  { Db: { rows: () => [] }, Logger: { log: () => {} }, logWarn: () => {}, SHEET: {} }
);

const DEMO_OVERRIDES = {
  staff_code: '1234',
  admin_code: 'admin123',
  report_email: 'demo@polyclinic.example',
  whatsapp_number: '+201000000000',
  support_phone: '0220000000'
};

/** Exactly what demo-runtime.js writes into the Settings sheet when it seeds. */
const demoSettings = Object.assign({}, configApi.SETTING_DEFAULTS, DEMO_OVERRIDES);

/**
 * Build the view's config the way production does — by running the real
 * getPublicConfig() over the demo's settings.
 *
 * Hand-mapping the setting keys (brand_primary) to the view's shape (brandPrimary)
 * once produced `--primary: ;`, and the booking header rendered white-on-white.
 * There is now a single source of truth for that mapping: the app's own code.
 */
const demoConfig = vm.runInNewContext(
  '(function(){\n' +
    read(path.join(GS, 'Config.gs')) + '\n' +
    read(path.join(GS, 'Catalog.gs')) + '\n' +
    'function getSettings(){ return __demoSettings; }\n' +
    'function str(v){ return v === null || v === undefined ? "" : String(v); }\n' +
    'function isTrue(v){ var s = String(v).trim().toLowerCase(); return !(s === "" || s === "false" || s === "no" || s === "0"); }\n' +
    'return getPublicConfig();\n' +
  '})()',
  { __demoSettings: demoSettings }
);

// Guard: the views read config.brandPrimary, not brand_primary. Getting that wrong
// once made --primary empty, which silently turned every var(--primary) rule into
// nothing — including the booking header's white-on-white text.
const viewConfigKeys = new Set();
['Booking.html', 'Staff.html', 'Admin.html'].forEach((view) => {
  const src = read(path.join(GS, view));
  const re = /config\.([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(src))) viewConfigKeys.add(m[1]);
});
const missingConfig = [...viewConfigKeys].filter((k) => !(k in demoConfig));
if (missingConfig.length) {
  throw new Error('demo config is missing fields the views read: ' + missingConfig.join(', '));
}
['brandPrimary', 'brandSecondary', 'clinicName'].forEach((k) => {
  if (!String(demoConfig[k] || '').trim()) {
    throw new Error('demo config.' + k + ' is empty — the UI would lose its colours');
  }
});

// Guard: demo/index.html reads the same localStorage key the runtime writes. When they
// drifted (launcher on v2 while the runtime moved to v3) the launcher quietly claimed
// "no demo data yet" and the calendar mirror stayed empty.
const runtimeKey = (read(path.join(here, 'demo-runtime.js')).match(/STORE_KEY\s*=\s*'([^']+)'/) || [])[1];
const launcherKey = (read(path.join(OUT, 'index.html')).match(/var KEY\s*=\s*'([^']+)'/) || [])[1];
if (!runtimeKey || runtimeKey !== launcherKey) {
  throw new Error('demo store key mismatch: demo-runtime.js has "' + runtimeKey + '", demo/index.html has "' + launcherKey + '"');
}

// Guard: the launcher's calendar mirror colours every doctor, so its palette has to be
// the one the reception board paints — apps-script/Config.gs DOCTOR_COLOR_HEX.
const hexBlock = (read(path.join(GS, 'Config.gs')).match(/const DOCTOR_COLOR_HEX = \{([\s\S]*?)\};/) || [])[1] || '';
const serverHex = {};
[...hexBlock.matchAll(/(\w+):\s*'(#[0-9a-fA-F]{6})'/g)].forEach((m) => { serverHex[m[1]] = m[2]; });
const launcherColors = (read(path.join(OUT, 'index.html')).match(/var COLORS = \{([\s\S]*?)\};/) || [])[1] || '';
const launcherHex = {};
[...launcherColors.matchAll(/(\w+):\s*'(#[0-9a-fA-F]{6})'/g)].forEach((m) => { launcherHex[m[1]] = m[2]; });
const driftedColors = Object.keys(serverHex).filter((k) => launcherHex[k] !== serverHex[k]);
if (!Object.keys(serverHex).length || driftedColors.length) {
  throw new Error('demo/index.html colours drifted from DOCTOR_COLOR_HEX: ' + (driftedColors.length ? driftedColors.join(', ') : 'palette not found'));
}

/* ------------------------------------------------------------------ *
 * 2. A tiny Apps Script template renderer
 *
 * Apps Script evaluates <?# ?> scriptlets server-side. Reproducing that here
 * means the views stay untouched: no demo-only branches inside Booking.html.
 * ------------------------------------------------------------------ */

const escapeExpr =
  "String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')" +
  ".replace(/\"/g,'&quot;').replace(/'/g,'&#39;')";

function renderTemplate(template, scope, filename) {
  let body = "var __s='';\nfunction __o(v){__s+=v;}\nfunction __e(v){__s+=(v===null||v===undefined)?'':" + escapeExpr + ";}\n";
  const re = /<\?([\s\S]*?)>/g;
  const open = /<\?([\s\S]*?)\?>/g;
  void re;

  let last = 0;
  let match;
  const scroller = new RegExp(open.source, 'g');
  while ((match = scroller.exec(template))) {
    body += '__o(' + JSON.stringify(template.slice(last, match.index)) + ');\n';
    const code = match[1];
    if (code.startsWith('!=')) body += '__o(' + code.slice(2) + ');\n';
    else if (code[0] === '=') body += '__e(' + code.slice(1) + ');\n';
    else body += code + '\n';
    last = scroller.lastIndex;
  }
  body += '__o(' + JSON.stringify(template.slice(last)) + ');\nreturn __s;';

  let fn;
  try {
    fn = new Function('scope', 'with (scope) { ' + body + ' }');
  } catch (err) {
    throw new Error(`${filename}: could not compile template — ${err.message}`);
  }
  return fn(scope);
}

function makeScope(extra) {
  const scope = Object.assign({}, extra);
  scope.include = (name) => read(path.join(GS, name + '.html')); // matches createHtmlOutputFromFile
  return scope;
}

/* ------------------------------------------------------------------ *
 * 3. Render the two views
 * ------------------------------------------------------------------ */

const runtimeTemplate = read(path.join(here, 'demo-runtime.js'));

// Every substitution this file performs must have a token to land in, or a page would
// silently ship without part of the runtime (that is how the CSV-instead-of-xlsx
// fallback survived unnoticed).
['/*__PAGE__*/', '/*__SERVER_SOURCE__*/', '/*__XLSX_WRITER__*/'].forEach((marker) => {
  if (runtimeTemplate.indexOf(marker) === -1) {
    throw new Error('demo-runtime.js no longer contains ' + marker);
  }
});

const xlsxWriter = read(path.join(here, 'xlsx-writer.js'));
if (xlsxWriter.indexOf('POLYCLINIC_XLSX') === -1) {
  throw new Error('tools/xlsx-writer.js no longer exposes POLYCLINIC_XLSX');
}

// The demo opens as a plain static file with no Apps Script runtime around it, so the
// two things Code.gs normally adds at serve time — the mobile viewport meta and a brand
// touch — have to be baked into the generated HTML here. Without the viewport meta a
// phone renders the page as a zoomed-out ~980px desktop layout (this actually shipped).
const demoFavicon =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<rect width="64" height="64" rx="14" fill="' + demoConfig.brandPrimary + '"/>' +
    '<path d="M32 17v30M17 32h30" stroke="#fff" stroke-width="10" stroke-linecap="round"/>' +
    '</svg>'
  );

function buildPage({ view, scope, page, title }) {
  let html = renderTemplate(read(path.join(GS, view)), makeScope(scope), view);

  const runtime = token(
    token(
      token(runtimeTemplate, '/*__PAGE__*/', JSON.stringify(page)),
      '/*__SERVER_SOURCE__*/',
      serverSource
    ),
    '/*__XLSX_WRITER__*/',
    xlsxWriter
  );

  // Validate the fused runtime before it is written. This also validates every
  // .gs file, since they are inlined into it.
  try {
    new vm.Script(runtime, { filename: page + '-runtime.js' });
  } catch (err) {
    throw new Error(`${page}: runtime or server source has a syntax error — ${err.message}`);
  }

  html = html.replace(/<head>/i, function () {
    return '<head>\n' +
      '<title>' + title + '</title>\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<meta name="theme-color" content="' + demoConfig.brandPrimary + '">\n' +
      '<link rel="icon" href="' + demoFavicon + '">';
  });
  // Use a function replacement: the runtime now contains server source such as
  // `new RegExp('...$')`. In a string replacement, `$'` means "the text after the
  // match", which would splice a second copy of the page into the runtime.
  html = html.replace(/<body>/, function () {
    return '<body>\n<script>\n' + runtime + '\n</script>\n';
  });

  // Unreplaced Apps Script scriptlets. `<?xml …?>` is not a scriptlet — the inlined
  // xlsx writer emits that string when it builds the OOXML parts.
  const leftovers = html.match(/<\?(?!xml)[!=]?[^>]*\?>/g);
  if (leftovers) {
    throw new Error(`${view}: unreplaced scriptlet(s): ${leftovers.slice(0, 3).join(' / ')}`);
  }

  // A CSS custom property with no value means a scriptlet resolved to nothing —
  // which is how the booking header ended up white text on a white page.
  const emptyVar = html.match(/--[a-z-]+:\s*;/);
  if (emptyVar) {
    throw new Error(`${view}: empty CSS value "${emptyVar[0].trim()}" — a config field is blank`);
  }

  // Guard the fix above: a demo page without it renders like a 2010 desktop site on phones.
  if (!/<meta name="viewport"/.test(html)) {
    throw new Error(`${view}: generated page has no viewport meta — phones would render it in desktop mode`);
  }

  // A `$'` in the injected runtime can expand a string replacement into a second
  // copy of the page. Keep this assertion close to the injection site.
  if ((html.match(/<\/html>/gi) || []).length !== 1) {
    throw new Error(`${view}: generated page has more than one closing html tag — runtime injection was spliced`);
  }

  return html;
}

fs.mkdirSync(OUT, { recursive: true });

const patient = buildPage({
  view: 'Booking.html',
  page: 'patient',
  title: 'عرض تجريبي — صفحة حجز المريض',
  scope: { config: demoConfig, preset: {}, source: 'instagram' }
});

const reception = buildPage({
  view: 'Staff.html',
  page: 'reception',
  title: 'عرض تجريبي — شاشة الاستقبال',
  scope: { config: demoConfig, webAppUrl: 'demo://export' }
});

const admin = buildPage({
  view: 'Admin.html',
  page: 'admin',
  title: 'عرض تجريبي — إعدادات العيادة',
  scope: {
    config: demoConfig,
    links: { booking: 'patient.html', staff: 'reception.html' }
  }
});

fs.writeFileSync(path.join(OUT, 'patient.html'), patient, 'utf8');
fs.writeFileSync(path.join(OUT, 'reception.html'), reception, 'utf8');
fs.writeFileSync(path.join(OUT, 'admin.html'), admin, 'utf8');

[['patient', patient], ['reception', reception], ['admin', admin]].forEach(([name, html]) => {
  if (html.indexOf('POLYCLINIC_XLSX') === -1 || html.indexOf('/*__XLSX_WRITER__*/') !== -1) {
    throw new Error('demo/' + name + '.html did not receive the xlsx writer — Excel export would fall back to CSV');
  }
});

console.log('demo/patient.html    ' + Math.round(patient.length / 1024) + ' KB');
console.log('demo/reception.html  ' + Math.round(reception.length / 1024) + ' KB');
console.log('demo/admin.html      ' + Math.round(admin.length / 1024) + ' KB');
console.log('\nServer files inlined: ' + SERVER_FILES.length);
console.log('Settings baked into the view config:');
console.log('  clinicName   = ' + demoConfig.clinicName);
console.log('  brandPrimary = ' + demoConfig.brandPrimary);
console.log('  staff_code   = ' + DEMO_OVERRIDES.staff_code + '  (demo only — not part of the public config)');
console.log('  whatsapp     = ' + demoConfig.whatsappNumber);
console.log('  supportPhone = ' + (demoConfig.supportPhone || '(none)'));
console.log('\nDemo clock is pinned by the runtime (next Sunday 08:00, seeded notice zeroed) so the');
console.log('Sunday/Wednesday rules always have something to show.');
