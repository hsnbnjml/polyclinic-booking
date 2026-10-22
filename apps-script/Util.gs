/**
 * Util.gs — dates, times, phone numbers, ids.
 *
 * Design rule: dates are 'yyyy-MM-dd' strings and times are 'HH:mm' strings,
 * everywhere. Times are compared as minutes-since-midnight. Date objects only
 * appear at the very edge (calendar events, "now").
 */

const AR_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const AR_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function todayStr() {
  return formatDateStr(new Date());
}

/**
 * The clinic is due a full annual Excel export when the current year has not
 * been recorded yet. This is a reminder only; no booking data is ever deleted.
 */
function annualExportDue() {
  const last = Number(str(getSettings()[SETTING.ANNUAL_EXPORT_YEAR]));
  return !last || last < Number(todayStr().slice(0, 4));
}

function markAnnualExportDone() {
  const year = todayStr().slice(0, 4);
  setSetting(SETTING.ANNUAL_EXPORT_YEAR, year);
  return year;
}

function formatDateStr(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** 'yyyy-MM-dd' -> Date at local midnight (never UTC, to avoid off-by-one days). */
function parseDateStr(s) {
  const parts = String(s).split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function addDaysStr(dateStr, days) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + days);
  return formatDateStr(d);
}

function daysBetweenStr(a, b) {
  const ms = parseDateStr(b).getTime() - parseDateStr(a).getTime();
  return Math.round(ms / 86400000);
}

/** 0 = Sunday … 6 = Saturday (Egyptian week). */
function weekdayIndex(dateStr) {
  return parseDateStr(dateStr).getDay();
}

function weekdayAr(dateStr) {
  return AR_WEEKDAYS[weekdayIndex(dateStr)];
}

/** '2026-10-18' -> 'الأحد 18 أكتوبر 2026' */
function formatDateAr(dateStr) {
  const d = parseDateStr(dateStr);
  return weekdayAr(dateStr) + ' ' + d.getDate() + ' ' + AR_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

/**
 * 'اليوم' / 'غداً' / 'بعد غد' for a date near today, otherwise the full Arabic date.
 *
 * The reminder is sent whenever the reception gets to it — the day before, or two days
 * before a holiday — so the message must not claim "tomorrow" by itself.
 */
function relativeDayAr(dateStr) {
  const days = daysBetweenStr(todayStr(), str(dateStr));
  if (days === 0) return 'اليوم';
  if (days === 1) return 'غداً';
  if (days === 2) return 'بعد غد';
  return formatDateAr(dateStr);
}

/** '14:30' -> 870. Tolerates '9:00', '09:00', '' and numbers. */
function parseTimeToMin(t) {
  if (t === null || t === undefined || t === '') return null;
  if (typeof t === 'number') return Math.round(t * 24 * 60); // Sheets time serial, if it ever happens
  const s = String(t).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minToTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return pad2(h) + ':' + pad2(m);
}

/** 900 -> '3:00 م' (12-hour, Arabic meridiem). */
function minToTimeAr(min) {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h24 < 12 ? 'ص' : 'م';
  let h = h24 % 12;
  if (h === 0) h = 12;
  return h + ':' + pad2(m) + ' ' + suffix;
}

function timeToAr(t) {
  const min = parseTimeToMin(t);
  return min === null ? String(t || '') : minToTimeAr(min);
}

function nowMinutes() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Normalize to a dialable international number, digits only with a leading '+'.
 * Keeps the raw value in the sheet too, so a bad rule is always recoverable.
 */
function normalizePhone(raw, countryCode) {
  const cc = String(countryCode || '+20').replace(/[^\d+]/g, '');
  const ccDigits = cc.replace(/\D/g, '');
  let s = String(raw || '').trim();
  // Arabic-Indic digits -> ASCII
  s = s.replace(/[\u0660-\u0669]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0x0660 + 48); });
  s = s.replace(/[\u06f0-\u06f9]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0x06f0 + 48); });
  const hadPlus = s.indexOf('+') === 0;
  let digits = s.replace(/\D/g, '');
  digits = digits.replace(/^00/, '');
  if (!digits) return '';
  if (digits.indexOf(ccDigits) === 0 && (hadPlus || digits.length > 9)) {
    return '+' + digits;
  }
  digits = digits.replace(/^0+/, '');
  return '+' + ccDigits + digits;
}

/** Loose validity check: enough digits to be a real mobile number. */
function isPlausiblePhone(raw, countryCode) {
  const n = normalizePhone(raw, countryCode);
  const digits = n.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

/** 'x' -> falsey-safe trimmed string. */
function str(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/** Accepts an array or a comma-separated cell and returns clean, unique ids. */
function splitIds(value) {
  const raw = Object.prototype.toString.call(value) === '[object Array]'
    ? value
    : str(value).split(',');
  const out = [];
  raw.forEach(function (v) {
    const id = str(v);
    if (id && out.indexOf(id) === -1) out.push(id);
  });
  return out;
}

function reasonClinicIds(reason) {
  return splitIds(reason && reason.clinic_ids);
}

function reasonOwnedBy(reason, doctorId) {
  return !!reason && !!str(doctorId) && str(reason.doctor_id) === str(doctorId);
}

function reasonServesClinic(reason, clinicId) {
  return reasonClinicIds(reason).indexOf(str(clinicId)) !== -1;
}

function isTrue(v) {
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1' || s === 'نعم' || s === 'y';
}

function isFalseOrBlank(v) {
  const s = String(v).trim().toLowerCase();
  return s === '' || s === 'false' || s === 'no' || s === '0' || s === 'لا';
}

function newId(prefix) {
  const d = new Date();
  const stamp = formatDateStr(d).replace(/-/g, '') + '-' + pad2(d.getHours()) + pad2(d.getMinutes());
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return prefix + '-' + stamp + '-' + rnd;
}

function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Arabic-friendly CSV: BOM so Excel renders the text correctly. */
function csvFromRows(header, rows) {
  const esc = function (v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [header.map(esc).join(',')];
  rows.forEach(function (r) { lines.push(r.map(esc).join(',')); });
  return '\ufeff' + lines.join('\r\n');
}

/**
 * Stable ordering for config rows: explicit sort_order first, then the sheet's
 * existing row order. Blank sort_order is normal for rows created before the
 * admin page existed, so it must never jump to the top.
 */
function sortRowsByOrder(rows) {
  return rows.map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) {
    const ao = Number(a.r.sort_order);
    const bo = Number(b.r.sort_order);
    const av = ao > 0 ? ao : a.i + 1;
    const bv = bo > 0 ? bo : b.i + 1;
    return av - bv;
  }).map(function (x) { return x.r; });
}

function logInfo(context, message) {
  logLine('INFO', context, message);
}

function logWarn(context, message) {
  logLine('WARN', context, message);
}

function logError(context, message) {
  logLine('ERROR', context, message);
}

/** Doctor's colour as a hex value the browser can paint directly. */
function doctorColorHex(colorName) {
  return DOCTOR_COLOR_HEX[str(colorName).toLowerCase()] || '#0f6f6c';
}

/**
 * A phone number a patient can actually dial, or ''. Stops placeholder text like
 * '[هاتف الفرع]' from reaching the confirmation screen as a broken tel: link.
 */
function callablePhone(raw) {
  const s = str(raw);
  return s.replace(/\D/g, '').length >= 7 ? s : '';
}

function logLine(level, context, message) {
  try {
    Logger.log('[' + level + '] ' + context + ': ' + message);
    Db.append(SHEET.LOG, {
      timestamp: new Date().toISOString(),
      level: level,
      context: context,
      message: String(message).slice(0, 900)
    });
  } catch (err) {
    Logger.log('logLine failed: ' + err);
  }
}
