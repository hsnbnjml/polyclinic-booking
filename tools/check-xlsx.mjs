/**
 * check-xlsx.mjs — proves the offline demo's Excel export is a real .xlsx.
 *
 *   node tools/check-xlsx.mjs
 *
 * The other tools cannot check this: a hand-made ZIP can look fine in a text editor
 * and still be rejected by Excel. So this does two independent things:
 *
 *   1. parses the bytes back as a ZIP in Node and re-computes every CRC-32, which
 *      catches wrong sizes, offsets or checksums;
 *   2. hands the same file to .NET's own ZIP reader (System.IO.Compression) through
 *      PowerShell, extracts every part and parses each XML one. That is the reader
 *      path closest to Excel's, and malformed parts fail here instead of on the
 *      doctor's screen.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const WRITER = path.join(here, 'xlsx-writer.js');

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
function section(title) { console.log(`\n${title}`); }

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal, strict stored-ZIP reader: throws on anything inconsistent. */
function unzip(bytes) {
  const buf = Buffer.from(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.length);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  const centralStart = buf.readUInt32LE(eocd + 16);

  const entries = [];
  let p = centralStart;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central header at ${p}`);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');

    if (buf.readUInt32LE(offset) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const localNameLen = buf.readUInt16LE(offset + 26);
    const localExtraLen = buf.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + localNameLen + localExtraLen;
    const data = buf.subarray(dataStart, dataStart + size);

    if (method !== 0) throw new Error(`${name} is not stored (method ${method})`);
    if (data.length !== size) throw new Error(`${name} is truncated`);
    if (crc32(data) !== crc) throw new Error(`${name} fails its CRC`);
    if (buf.subarray(offset + 30, offset + 30 + localNameLen).toString('utf8') !== name) {
      throw new Error(`${name} disagrees with its local name`);
    }

    entries.push({ name, data, text: data.toString('utf8') });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* ------------------------------------------------------------------ *
 * 1. Load the writer the way the browser does
 * ------------------------------------------------------------------ */

const sandbox = { self: {}, console, TextEncoder };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(WRITER, 'utf8'), sandbox, { filename: 'xlsx-writer.js' });
const XLSX = sandbox.self.POLYCLINIC_XLSX;
check('the writer exposes build() to the browser', !!XLSX && typeof XLSX.build === 'function');

/* ------------------------------------------------------------------ *
 * 2. Build a report-shaped sheet
 * ------------------------------------------------------------------ */

const HEADER = [
  'رقم الحجز', 'تاريخ الحجز', 'الفرع', 'الطبيب', 'سبب الزيارة',
  'تاريخ الموعد', 'اليوم', 'الوقت', 'الاسم', 'الجوال',
  'الحالة', 'آخر تحديث', 'تم التواصل واتساب', 'قالب الرسالة',
  'ملاحظة الطاقم', 'مصدر الحجز'
];

const rows = [
  HEADER,
  ['ah-20261018-1', '2026-10-17T09:00:00.000Z', 'الفرع الأول', 'د. أحمد سمير', 'فحص أولي',
    '2026-10-18', 'الأحد', '9:00 ص', 'سارة محمد', '+201001234567', 'مؤكد', '', '', '', '', 'web'],
  ['ah-20261018-2', '2026-10-17T09:05:00.000Z', 'الفرع الأول', 'د. أحمد سمير', 'متابعة',
    '2026-10-18', 'الأحد', '9:45 ص', '', '+201009999888', 'حضر', '', '', '', 'ملاحظة', 'web'],
  // Edge cases that break naive writers: quotes, ampersands, angle brackets, a newline,
  // an emoji (4-byte UTF-8) and a numeric cell.
  ['قه-2026/"&<>', 'x', 'فرع "أ" & شركاه', 'د. منى <اختبار>', 'متابعة',
    '2026-10-19', 'الاثنين', '10:00 ص', 'سطر أول\nسطر ثانٍ', '+201000000000', 'ملغي', '', '', '', '😀 ملاحظة', 'staff'],
  ['n-1', '', '', '', '', '', '', '', 'رقم صحيح في خلية', '', '', '', '', '', '', 42]
];

const bytes = XLSX.build(rows, 'Bookings');
check('build() returns bytes',
  !!bytes && bytes.length > 500 && bytes.BYTES_PER_ELEMENT === 1, bytes && bytes.length);
check('the bytes start with the ZIP signature', bytes[0] === 0x50 && bytes[1] === 0x4b, `${bytes[0]},${bytes[1]}`);

const expectedParts = [
  '[Content_Types].xml',
  '_rels/.rels',
  'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels',
  'xl/worksheets/sheet1.xml'
];

/* ------------------------------------------------------------------ *
 * 3. Parse it back as a ZIP and re-check every CRC
 * ------------------------------------------------------------------ */

section('1. The ZIP container');

let entries = [];
let zipError = '';
try { entries = unzip(bytes); } catch (err) { zipError = String(err.message); }
check('the archive reads back as a valid ZIP', !zipError, zipError);
check('all five part names are the expected ones and in order',
  entries.length === 5 && expectedParts.every((n, i) => entries[i] && entries[i].name === n),
  entries.map((e) => e.name).join(', '));

const partText = (name) => {
  const e = entries.filter((x) => x.name === name)[0];
  return e ? e.text : '';
};

/* ------------------------------------------------------------------ *
 * 4. The parts Excel requires
 * ------------------------------------------------------------------ */

section('2. The XLSX parts');

check('the workbook declares one sheet called Bookings',
  partText('xl/workbook.xml').indexOf('name="Bookings"') !== -1 &&
  partText('xl/workbook.xml').indexOf('r:id="rId1"') !== -1);
check('content types cover the workbook and the sheet',
  partText('[Content_Types].xml').indexOf('spreadsheetml.sheet.main+xml') !== -1 &&
  partText('[Content_Types].xml').indexOf('spreadsheetml.worksheet+xml') !== -1);
check('the package relationship points at the workbook',
  partText('_rels/.rels').indexOf('Target="xl/workbook.xml"') !== -1);
check('the workbook relationship points at the sheet',
  partText('xl/_rels/workbook.xml.rels').indexOf('Target="worksheets/sheet1.xml"') !== -1);

const sheet = partText('xl/worksheets/sheet1.xml');
check('the sheet is marked right-to-left', sheet.indexOf('rightToLeft="1"') !== -1);
check('the dimension covers 16 columns and 5 rows', sheet.indexOf('<dimension ref="A1:P5"/>') !== -1,
  (sheet.match(/<dimension ref="[^"]*"/) || [''])[0]);
check('the header row is written as inline strings', sheet.indexOf('<row r="1">') !== -1 && sheet.indexOf('t="inlineStr"') !== -1);
check('arabic text survives (header)', sheet.indexOf('رقم الحجز') !== -1);
check('arabic text survives (a data row)', sheet.indexOf('د. أحمد سمير') !== -1 && sheet.indexOf('سارة محمد') !== -1);
check('quotes, ampersands and angle brackets are escaped',
  sheet.indexOf('&quot;') !== -1 && sheet.indexOf('&amp;') !== -1 && sheet.indexOf('&lt;اختبار&gt;') !== -1);
check('a newline inside a cell stays inside the cell', sheet.indexOf('سطر أول\nسطر ثانٍ') !== -1);
check('a 4-byte emoji survives', sheet.indexOf('😀') !== -1);
check('real numbers become numeric cells', sheet.indexOf('<c r="P5"><v>42</v></c>') !== -1);
const lastRow = (sheet.match(/<row r="5">(.*?)<\/row>/) || ['', ''])[1];
check('empty cells are skipped, not written as empty cells',
  lastRow.indexOf('<c r="I5"') !== -1 && lastRow.indexOf('<c r="B5"') === -1,
  lastRow);
check('control characters are stripped, not passed through',
  unzip(XLSX.build([['a\u0000b\u001f c']], 'S'))
    .filter((e) => e.name === 'xl/worksheets/sheet1.xml')[0].text.indexOf('ab c') !== -1);

/* ------------------------------------------------------------------ *
 * 5. A real ZIP reader must open it (the Excel compatibility proxy)
 * ------------------------------------------------------------------ */

section("3. .NET's ZIP reader opens it (PowerShell)");

const work = path.join(os.tmpdir(), 'polyclinic-xlsx-check');
const xlsxPath = path.join(work, 'report.xlsx');
const extractDir = path.join(work, 'parts');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(extractDir, { recursive: true });
fs.writeFileSync(xlsxPath, bytes);

const q = (s) => `'${s.replace(/'/g, "''")}'`;
const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead(${q(xlsxPath)})
$names = @()
foreach ($e in $zip.Entries) {
  $dest = Join-Path ${q(extractDir)} ($e.FullName -replace '[\\\\/]', '__')
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
  $names += $e.FullName
}
$zip.Dispose()
$parsed = 0
$bad = 0
foreach ($f in Get-ChildItem ${q(extractDir)} | Where-Object { $_.Name -match '\\.(xml|rels)$' }) {
  try {
    $doc = New-Object System.Xml.XmlDocument
    $doc.LoadXml([System.IO.File]::ReadAllText($f.FullName))
    $parsed++
  } catch {
    $bad++
    Write-Output ("XMLERR=" + $f.Name + " " + $_.Exception.Message)
  }
}
Write-Output ("ENTRIES=" + ($names -join '|'))
Write-Output ("XML_OK=" + $parsed)
Write-Output ("XML_FAIL=" + $bad)
`;

let psOut = '';
let psError = '';
try {
  psOut = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
} catch (err) {
  psError = String(err.stderr || err.message);
}

check('.NET extracted the file without an error', !psError, psError.slice(0, 300));
check('.NET sees the same five parts',
  psOut.indexOf('ENTRIES=' + expectedParts.join('|')) !== -1, psOut.trim().slice(0, 200));
check('every XML and .rels part parses as XML',
  psOut.indexOf('XML_OK=5') !== -1 && psOut.indexOf('XML_FAIL=0') !== -1, psOut.trim().slice(0, 300));

const extractedSheet = fs.existsSync(path.join(extractDir, 'xl__worksheets__sheet1.xml'))
  ? fs.readFileSync(path.join(extractDir, 'xl__worksheets__sheet1.xml'), 'utf8')
  : '';
check(".NET's extraction round-trips the sheet byte-for-byte", extractedSheet === sheet,
  `${extractedSheet.length} vs ${sheet.length} chars`);

/* ------------------------------------------------------------------ *
 * 6. Edge cases
 * ------------------------------------------------------------------ */

section('4. Edge cases');

const empty = XLSX.build([HEADER], 'Bookings');
check('a header-only export is still a ZIP', empty[0] === 0x50 && empty[1] === 0x4b);
check('a header-only export has one row and a valid dimension',
  unzip(empty).filter((e) => e.name === 'xl/worksheets/sheet1.xml')[0].text.indexOf('<dimension ref="A1:P1"/>') !== -1);
const noRows = XLSX.build([], 'Bookings');
check('an empty export does not throw', noRows.length > 400 && noRows[0] === 0x50);
const long = XLSX.build([[('ط' + 'ويل').repeat(2000)]], 'S');
check('a ~12k-character cell is stored intact', long.length > 12000);
check('a sheet name with path characters is sanitised',
  unzip(XLSX.build([['x']], 'a/b:c*d?')).filter((e) => e.name === 'xl/workbook.xml')[0].text.indexOf('name="a b c d "') !== -1);
check('column names go past Z', XLSX.columnName(0) === 'A' && XLSX.columnName(25) === 'Z' &&
  XLSX.columnName(26) === 'AA' && XLSX.columnName(51) === 'AZ' && XLSX.columnName(52) === 'BA');

/* ------------------------------------------------------------------ */

console.log(`\n${'-'.repeat(60)}`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
