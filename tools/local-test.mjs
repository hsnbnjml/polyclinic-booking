/**
 * local-test.mjs — runs the real .gs source against an in-memory fake of the
 * Google services Apps Script would provide.
 *
 *   node tools/local-test.mjs
 *
 * This is not a replacement for testing on a deployed web app. It is how the
 * slot engine, the booking rules and the staff actions get verified before
 * anything is uploaded, because a bug in generateSlots means either an empty
 * calendar or two patients in one chair.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const GS_DIR = path.join(here, '..', 'apps-script');

const FILES = [
  'Config.gs', 'Util.gs', 'Db.gs', 'I18n.gs', 'Availability.gs', 'Catalog.gs',
  'Calendar.gs', 'WhatsApp.gs', 'BookingApi.gs', 'Reports.gs', 'StaffApi.gs',
  'Setup.gs', 'Notify.gs', 'AdminApi.gs'
];

/* ------------------------------------------------------------------ *
 * A small in-memory spreadsheet
 * ------------------------------------------------------------------ */

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        line.push(this.sheet.get(this.row + r, this.col + c));
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.numRows) {
      // Apps Script would throw; being strict here catches real bugs early.
      throw new Error(`setValues shape mismatch: got ${values.length} rows, expected ${this.numRows}`);
    }
    values.forEach((line, r) => {
      if (line.length !== this.numCols) {
        throw new Error(`setValues shape mismatch: got ${line.length} cols, expected ${this.numCols}`);
      }
      line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v));
    });
    return this;
  }
  getValue() { return this.getValues()[0][0]; }
  setValue(v) { this.sheet.set(this.row, this.col, v); return this; }
  clearContent() { this.fill(() => ''); return this; }
  clear() { this.fill(() => ''); return this; }
  fill(make) {
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) this.sheet.set(this.row + r, this.col + c, make(r, c));
    }
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setNote() { return this; }
  autoResizeColumns() { return this; }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.grid = []; // 1-based access via get/set
  }
  ensure(r, c) {
    while (this.grid.length < r) this.grid.push([]);
    for (let i = 0; i < this.grid.length; i++) {
      while (this.grid[i].length < c) this.grid[i].push('');
    }
  }
  get(r, c) {
    this.ensure(r, c);
    const v = this.grid[r - 1][c - 1];
    return v === undefined || v === null ? '' : v;
  }
  set(r, c, v) {
    this.ensure(r, c);
    this.grid[r - 1][c - 1] = v === undefined || v === null ? '' : v;
  }
  rowCount() { return this.grid.length; }
  colCount() { return this.grid.reduce((m, row) => Math.max(m, row.length), 0); }
  getLastRow() {
    for (let r = this.grid.length; r >= 1; r--) {
      if (this.grid[r - 1].some((v) => v !== '' && v !== undefined && v !== null)) return r;
    }
    return 0;
  }
  getLastColumn() { return this.colCount(); }
  getMaxRows() { return Math.max(this.rowCount(), 50); }
  getMaxColumns() { return Math.max(this.colCount(), 20); }
  getName() { return this.name; }
  setFrozenRows() { return this; }
  setColumnWidth() { return this; }
  autoResizeColumns() { return this; }
  getRange(row, col, numRows = 1, numCols = 1) { return new FakeRange(this, row, col, numRows, numCols); }
}

function createFakeEnv() {
  const state = {
    sheets: new Map(),
    events: new Map(),
    eventSeq: 0,
    mails: [],
    calendar: null
  };

  const spreadsheet = {
    getId: () => 'fake-spreadsheet',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/fake',
    getName: () => 'Fake',
    getSheetByName: (name) => state.sheets.get(name) || null,
    insertSheet: (name) => {
      const sh = new FakeSheet(name);
      state.sheets.set(name, sh);
      return sh;
    },
    getSheets: () => Array.from(state.sheets.values())
  };

  const CalendarApp = {
    getCalendarById: (id) => (state.calendar && state.calendar.getId() === id ? state.calendar : null),
    createCalendar: (name) => {
      state.calendar = {
        getId: () => 'cal-1',
        getName: () => name,
        createEvent: (title, start, end, opts = {}) => {
          const ev = makeEvent(title, start, end, opts);
          state.events.set(ev.getId(), ev);
          return ev;
        },
        getEvents: () => Array.from(state.events.values())
      };
      return state.calendar;
    },
    getEventById: (id) => state.events.get(id) || null,
    Color: { RED: 'red', ORANGE: 'orange', YELLOW: 'yellow', GREEN: 'green', TEAL: 'teal', BLUE: 'blue', PURPLE: 'purple', GRAY: 'gray' }
  };

  function makeEvent(title, start, end, opts) {
    state.eventSeq++;
    const ev = {
      _id: 'evt-' + state.eventSeq,
      _title: title,
      _start: start,
      _end: end,
      _opts: opts,
      getId: () => ev._id,
      getTitle: () => ev._title,
      setTitle: (t) => { ev._title = t; },
      setTime: (s, e) => { ev._start = s; ev._end = e; },
      setColor: () => {},
      deleteEvent: () => { state.events.delete(ev._id); },
      getStartTime: () => ev._start,
      getEndTime: () => ev._end
    };
    return ev;
  }

  const sandbox = {
    console,
    Logger: { log: () => {} },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      create: () => {
        const ss = { sheets: new Map(), getId: () => 'temp-' + Math.random(), getUrl: () => 'https://docs.google.com/spreadsheets/d/temp' };
        const sh = new FakeSheet('Sheet1');
        ss.sheets.set('Sheet1', sh);
        ss.getSheets = () => Array.from(ss.sheets.values());
        ss.getSheetByName = (n) => ss.sheets.get(n) || null;
        ss.insertSheet = (n) => { const s = new FakeSheet(n); ss.sheets.set(n, s); return s; };
        return ss;
      }
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    CalendarApp,
    MailApp: { sendEmail: (msg) => state.mails.push(msg) },
    DriveApp: {
      createFolder: (name) => ({ getId: () => 'folder-1', getName: () => name }),
      createFile: () => ({ getUrl: () => 'https://drive.google.com/file/d/x/view' }),
      getFolderById: () => ({
        createFile: () => ({ getUrl: () => 'https://drive.google.com/file/d/x/view' }),
        getFilesByName: () => ({ hasNext: () => true })
      }),
      getFileById: () => ({ makeCopy: () => ({ getUrl: () => 'https://drive.google.com/file/d/backup/view', getName: () => 'PolyClinic-MASTER-test' }), setTrashed: () => {} })
    },
    ScriptApp: {
      getOAuthToken: () => 'fake-token',
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/fake/exec' }),
      getProjectTriggers: () => [],
      deleteTrigger: () => {},
      newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ everyDays: () => ({ create: () => {} }) }), onWeekDay: () => ({ atHour: () => ({ create: () => {} }) }) }) })
    },
    UrlFetchApp: { fetch: () => ({ getBlob: () => ({ setName: () => ({}) }) }) },
    Utilities: {
      getUuid: () => 'uuid-' + Math.random().toString(36).slice(2),
      formatDate: (date, tz) => {
        if (tz !== 'UTC' && !/^(Africa|Asia|Europe|America|Australia|Pacific|Atlantic|Indian|Etc)\//.test(tz)) {
          throw new Error('invalid timezone: ' + tz);
        }
        return '2026-01-01';
      }
    },
    HtmlService: {
      createTemplateFromFile: () => ({ evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } }) }),
      createHtmlOutput: () => ({ getContent: () => '' }),
      createHtmlOutputFromFile: () => ({ getContent: () => '' }),
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' }
    }
  };
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);

  const source = FILES.map((f) => fs.readFileSync(path.join(GS_DIR, f), 'utf8')).join('\n');
  const exported = [
    'HEADERS', 'SHEET', 'STATUS', 'SETTING', 'SETTING_DEFAULTS', 'WA_TEMPLATES',
    'createAllSheets', 'seedPlaceholders',
    'generateSlots', 'findSlot', 'buildOccupancy', 'isBlackedOut',
    'normalizePhone', 'isPlausiblePhone', 'minToTimeAr', 'formatDateAr', 'weekdayIndex',
    'addDaysStr', 'todayStr', 'parseTimeToMin', 'minToTime',
    'submitBooking', 'bookingConfirmation', 'getBootstrap',
    'setBookingStatus', 'rescheduleBooking', 'blockTime', 'lookupPatient', 'getStaffBoard',
    'waLinksFor', 'markWhatsAppSent', 'kpiSummary', 'reportRows', 'Db',
    'doctorCode', 'doctorColorHex', 'dayDoctors', 'checkConfiguration', 'callablePhone',
    'relativeDayAr', 'waTemplateLabelAr', 'templateVars', 'renderTemplate',
    'doctorIdList', 'filterBookings', 'scopeLabelAr', 'exportScopeSlug', 'exportBaseName', 'exportCsv',
    'getPublicConfig', 'getWaTemplates', 'waTemplateSettingKey', 'errorMessageAr', 'sortRowsByOrder',
    'adminMigrateSchema', 'adminLogin', 'adminBootstrap', 'adminGet', 'adminSave', 'adminDelete',
    'adminReorder', 'adminSetDoctorPin', 'adminChangePin', 'adminBackup', 'adminRoleFor', 'adminPinHash',
    'adminCopyReason', 'migrateReasonsToDoctors', 'splitIds', 'reasonClinicIds', 'isActive',
    'annualExportDue', 'markAnnualExportDone'
  ];
  const wrapped = '(function(){\n' + source + '\nreturn {' + exported.join(',') + '};\n})()';
  const api = vm.runInContext(wrapped, context, { filename: 'polyclinic.gs' });

  /** Rebuild every sheet from a fixture definition. */
  function load(fixtures) {
    state.sheets.clear();
    state.events.clear();
    state.calendar = null;
    api.Db.reset();
    Object.keys(fixtures).forEach((sheetName) => {
      const rows = fixtures[sheetName];
      const sh = new FakeSheet(sheetName);
      rows.forEach((row, r) => row.forEach((v, c) => sh.set(r + 1, c + 1, v)));
      state.sheets.set(sheetName, sh);
    });
  }

  return { api, state, load, spreadsheet };
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

function buildFixtures(api) {
  const H = api.HEADERS;
  const rowsFor = (sheetName, objects) => {
    const header = H[sheetName];
    return [header].concat(objects.map((o) => header.map((h) => (o[h] === undefined ? '' : o[h]))));
  };

  const clinics = [
    { clinic_id: 'C1', name_ar: 'الفرع الأول', address_ar: 'شارع ١', map_link: 'https://maps.example/1', phone: '0220000000', working_hours_ar: '٩–٩', active: 'TRUE' },
    { clinic_id: 'C2', name_ar: 'الفرع الثاني', address_ar: 'شارع ٢', phone: '0220000001', active: 'FALSE' }
  ];

  const doctors = [
    { doctor_id: 'D1', name_ar: 'د. أحمد', specialty_ar: 'باطنة', clinic_ids: 'C1', color: 'teal', active: 'TRUE' },
    { doctor_id: 'D2', name_ar: 'د. منى', specialty_ar: 'أطفال', clinic_ids: 'C1', color: 'blue', active: 'TRUE' }
  ];

  const reasons = [
    { reason_id: 'R1', doctor_id: 'D1', clinic_ids: 'C1', name_ar: 'فحص أولي', duration_min: 45, lead_hours: 12, book_days_ahead: 21, max_per_day: 20, active: 'TRUE', sort_order: 1 },
    { reason_id: 'R2', doctor_id: 'D1', clinic_ids: 'C1', name_ar: 'استشارة', duration_min: 30, lead_hours: 4, book_days_ahead: 14, max_per_day: 20, active: 'TRUE', sort_order: 2 },
    { reason_id: 'R3', doctor_id: 'D1', clinic_ids: 'C1', name_ar: 'متابعة', duration_min: 15, lead_hours: 0, book_days_ahead: 14, max_per_day: 20, active: 'TRUE', sort_order: 3 },
    { reason_id: 'R4', doctor_id: 'D2', clinic_ids: 'C1', name_ar: 'استشارة أطفال', duration_min: 30, lead_hours: 4, book_days_ahead: 14, max_per_day: 20, active: 'TRUE', sort_order: 4 }
  ];

  const availability = [
    { availability_id: 'A1', doctor_id: 'D1', clinic_id: 'C1', reason_id: 'R1', weekday: 0, from_time: '09:00', to_time: '16:00', slot_min: '', max_per_day_override: '', active: 'TRUE' },
    { availability_id: 'A2', doctor_id: 'D1', clinic_id: 'C1', reason_id: 'R1', weekday: 3, from_time: '09:00', to_time: '16:00', slot_min: '', max_per_day_override: '', active: 'TRUE' },
    { availability_id: 'A3', doctor_id: 'D1', clinic_id: 'C1', reason_id: 'R3', weekday: 0, from_time: '16:00', to_time: '19:00', slot_min: '', max_per_day_override: '', active: 'TRUE' },
    { availability_id: 'A4', doctor_id: 'D2', clinic_id: 'C1', reason_id: 'R4', weekday: 1, from_time: '10:00', to_time: '14:00', slot_min: '', max_per_day_override: '', active: 'TRUE' },
    { availability_id: 'A5', doctor_id: 'D2', clinic_id: 'C1', reason_id: 'R4', weekday: 2, from_time: '10:00', to_time: '14:00', slot_min: '', max_per_day_override: '', active: 'FALSE' }
  ];

  const settings = Object.keys(api.SETTING_DEFAULTS).map((key) => ({
    key,
    value: api.SETTING_DEFAULTS[key],
    note: ''
  }));
  // Make the test deterministic: a real staff code, a fixed country code.
  settings.forEach((s) => {
    if (s.key === api.SETTING.STAFF_CODE) s.value = 'TEST-CODE';
    if (s.key === api.SETTING.MIN_LEAD_HOURS) s.value = '0';
  });

  return {
    [api.SHEET.CLINICS]: rowsFor(api.SHEET.CLINICS, clinics),
    [api.SHEET.DOCTORS]: rowsFor(api.SHEET.DOCTORS, doctors),
    [api.SHEET.REASONS]: rowsFor(api.SHEET.REASONS, reasons),
    [api.SHEET.AVAILABILITY]: rowsFor(api.SHEET.AVAILABILITY, availability),
    [api.SHEET.BLACKOUTS]: rowsFor(api.SHEET.BLACKOUTS, []),
    [api.SHEET.BOOKINGS]: rowsFor(api.SHEET.BOOKINGS, []),
    [api.SHEET.SETTINGS]: rowsFor(api.SHEET.SETTINGS, settings),
    [api.SHEET.LOG]: rowsFor(api.SHEET.LOG, [])
  };
}

/* ------------------------------------------------------------------ *
 * Test plumbing
 * ------------------------------------------------------------------ */

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------------ *
 * The suite
 * ------------------------------------------------------------------ */

const env = createFakeEnv();
const { api, state, load } = env;
const CODE = 'TEST-CODE';
let fixtures;

function reset() {
  fixtures = buildFixtures(api);
  load(fixtures);
}

function firstFreeSlot(res) {
  for (const day of res.days) {
    for (const slot of day.slots) return { date: day.date, start: slot.start, day };
  }
  return null;
}

function slotForWeekday(res, weekday) {
  for (const day of res.days) {
    if (api.weekdayIndex(day.date) === weekday && day.slots.length) return { date: day.date, start: day.slots[0].start };
  }
  return null;
}

/**
 * The first day that still has at least n bookable slots. days[0] is "today" whenever
 * today is still ahead, and today shrinks as the clock moves — a test that books slots
 * 0..n of days[0] crashes in the last hours of a workday. Derive like the checks above:
 * fall through to the next full day instead of assuming today is whole.
 */
function dayWithSlots(res, n) {
  for (const day of res.days) {
    if (day.slots.length >= n) return day;
  }
  throw new Error('local-test: no day with ' + n + ' free slots — widen the fixture window');
}

reset();

/* -------------------------------------------------- */
section('1. Phone normalisation (the patient key)');

check('local 0100... becomes +20 100...', api.normalizePhone('01001234567', '+20') === '+201001234567', api.normalizePhone('01001234567', '+20'));
check('spaced local number', api.normalizePhone('0100 123 4567', '+20') === '+201001234567', api.normalizePhone('0100 123 4567', '+20'));
check('international with plus', api.normalizePhone('+20 100 123 4567', '+20') === '+201001234567', api.normalizePhone('+20 100 123 4567', '+20'));
check('international with 00', api.normalizePhone('00201001234567', '+20') === '+201001234567', api.normalizePhone('00201001234567', '+20'));
check('arabic-indic digits', api.normalizePhone('٠١٠٠١٢٣٤٥٦٧', '+20') === '+201001234567', api.normalizePhone('٠١٠٠١٢٣٤٥٦٧', '+20'));
check('garbage is rejected', api.isPlausiblePhone('123', '+20') === false);
check('empty is rejected', api.isPlausiblePhone('', '+20') === false);

/* -------------------------------------------------- */
section('2. Slot engine — the doctor\'s fixed rule');

const slotsR1 = api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' });
check('returns ok', slotsR1.ok === true);
check('clinic resolved', slotsR1.clinic.nameAr === 'الفرع الأول');
check('only Sundays and Wednesdays are offered',
  slotsR1.days.every((d) => [0, 3].indexOf(api.weekdayIndex(d.date)) !== -1),
  JSON.stringify(slotsR1.days.map((d) => d.weekdayAr)));

// The offer is "every Sunday and Wednesday among the next 14 days" (the default
// booking window, capped by R1's 21-day limit). Today counts only while it still
// has a slot past the reason's 12-hour notice, so the exact set moves with the
// clock — derive it instead of hard-coding four.
const windowDates = [];
for (let i = 0; i < 14; i++) {
  const day = api.addDaysStr(api.todayStr(), i);
  if ([0, 3].indexOf(api.weekdayIndex(day)) !== -1) windowDates.push(day);
}
const offersToday = slotsR1.days.some((d) => d.date === api.todayStr());
// Today only belongs to this list when it is itself a Sunday or Wednesday, and it is
// dropped only when its own notice period has already swallowed the day. On a Monday
// neither applies, so nothing is subtracted.
const todayInWindow = windowDates.indexOf(api.todayStr()) !== -1;
check('every Sunday and Wednesday in the booking window is offered (today only while it is still ahead)',
  slotsR1.days.length === windowDates.length - (todayInWindow && !offersToday ? 1 : 0) &&
  slotsR1.days.every((d) => windowDates.indexOf(d.date) !== -1),
  'offered ' + JSON.stringify(slotsR1.days.map((d) => d.date)) + ' of ' + JSON.stringify(windowDates));
check('nine 45-minute slots per day between 09:00 and 16:00',
  // Today shrinks as the clock moves, so only the days still ahead are exactly nine.
  slotsR1.days.filter((d) => d.date > api.todayStr()).every((d) => d.slots.length === 9),
  JSON.stringify(slotsR1.days.map((d) => d.slots.length)));
check('first slot is 09:00', slotsR1.days[1].slots[0].start === '09:00', slotsR1.days[1].slots[0].start);
check('last slot ends at 15:45 + 45m <= 16:00', slotsR1.days[1].slots.slice(-1)[0].end === '15:45', slotsR1.days[1].slots.slice(-1)[0].end);
check('slot labels are Arabic 12-hour', slotsR1.days[1].slots[0].labelAr === '9:00 ص', slotsR1.days[1].slots[0].labelAr);

const slotsR3 = api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R3' });
// R3 (متابعة) runs in its own evening window, Sundays 16:00–19:00, 15 minutes per patient.
// Today is offered as soon as it still has a slot, so assert the window's own bounds rather
// than its first remaining slot — that moves with the clock.
check('a reason with its own window never leaves that window',
  slotsR3.days.length > 0 &&
  slotsR3.days.every((d) => d.slots.every((s) => s.start >= '16:00' && s.end <= '19:00')),
  JSON.stringify(slotsR3.days.map((d) => d.date + ' ' + (d.slots[0] || {}).start + '..' + (d.slots.slice(-1)[0] || {}).end)));
const fullR3 = slotsR3.days.filter((d) => d.date > api.todayStr())[0];
check('a 15-minute day that has not started runs 16:00 to 18:45',
  !!fullR3 && fullR3.slots[0].start === '16:00' && fullR3.slots.slice(-1)[0].start === '18:45',
  JSON.stringify(fullR3 && [fullR3.slots[0].start, fullR3.slots.slice(-1)[0].start]));

const wrongClinic = api.generateSlots({ clinicId: 'C2', doctorId: 'D1', reasonId: 'R1' });
check('inactive clinic is refused', wrongClinic.ok === false && wrongClinic.error === 'CLINIC_NOT_FOUND');

const noAvailability = api.generateSlots({ clinicId: 'C1', doctorId: 'D2', reasonId: 'R1' });
check('a reason that belongs to another doctor is refused even if a block exists',
  noAvailability.ok === false && noAvailability.error === 'REASON_NOT_FOUND',
  JSON.stringify(noAvailability));

const inactiveAvailability = api.generateSlots({ clinicId: 'C1', doctorId: 'D2', reasonId: 'R4' });
check('the Tuesday row is inactive, Monday still works',
  inactiveAvailability.days.every((d) => api.weekdayIndex(d.date) === 1),
  JSON.stringify(inactiveAvailability.days.map((d) => d.weekdayAr)));

/* -------------------------------------------------- */
section('3. Booking writes are authoritative');

const target = firstFreeSlot(slotsR1);
const booked = api.submitBooking({
  clinicId: 'C1', doctorId: 'D1', reasonId: 'R1',
  date: target.date, start: target.start,
  name: 'مريضة تجريبية', phone: '01001234567', phoneConfirm: '0100 123 4567',
  consent: 'true', source: 'test'
});
check('booking succeeds', booked.ok === true, JSON.stringify(booked));
check('returns an Arabic date label', !!booked.dateAr && booked.dateAr.indexOf('أكتوبر') !== -1 || /\d/.test(booked.dateAr || ''), booked.dateAr);
check('returns a calendar link', !!booked.calendarUrl && booked.calendarUrl.indexOf('calendar.google.com') !== -1);
check('writes one row', api.Db.rows(api.SHEET.BOOKINGS).length === 1);
check('creates one calendar event', state.events.size === 1);
check('the confirmation carries a dialable reception number',
  booked.contactPhone === '0220000000', booked.contactPhone);
check('placeholder phone text is never offered as a number',
  api.callablePhone('[هاتف الفرع]') === '' &&
  api.callablePhone('022 000 0000') === '022 000 0000' &&
  api.callablePhone('') === '', String(api.callablePhone('[هاتف الفرع]')));

const afterBooking = api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' });
const stillThere = afterBooking.days.some((d) => d.date === target.date && d.slots.some((s) => s.start === target.start));
check('the booked slot disappears', stillThere === false);

const sameSlotOtherPhone = api.submitBooking({
  clinicId: 'C1', doctorId: 'D1', reasonId: 'R1', date: target.date, start: target.start,
  name: 'شخص آخر', phone: '01009999999', phoneConfirm: '01009999999', consent: 'true'
});
check('one patient per slot: the second attempt is refused',
  sameSlotOtherPhone.ok === false && sameSlotOtherPhone.error === 'SLOT_TAKEN', JSON.stringify(sameSlotOtherPhone));

const doubleTap = api.submitBooking({
  clinicId: 'C1', doctorId: 'D1', reasonId: 'R1', date: target.date, start: target.start,
  name: 'مريضة تجريبية', phone: '01001234567', phoneConfirm: '01001234567', consent: 'true'
});
check('double-tap is idempotent, not a second booking',
  doubleTap.ok === true && doubleTap.duplicate === true && api.Db.rows(api.SHEET.BOOKINGS).length === 1);

check('patient name is required', api.submitBooking({
  clinicId: 'C1', doctorId: 'D1', reasonId: 'R1', date: target.date, start: '09:45',
  phone: '01006666666', phoneConfirm: '01006666666', consent: 'true'
}).error === 'NAME_REQUIRED');

check('phone mismatch is caught', api.submitBooking({
  clinicId: 'C1', doctorId: 'D1', reasonId: 'R1', date: target.date, start: '09:45',
  name: 'اختبار', phone: '01001234567', phoneConfirm: '01001234568', consent: 'true'
}).error === 'PHONE_MISMATCH');

check('consent is required', api.submitBooking({
  clinicId: 'C1', doctorId: 'D1', reasonId: 'R1', date: target.date, start: '09:45',
  name: 'اختبار', phone: '01005555555', phoneConfirm: '01005555555'
}).error === 'CONSENT_REQUIRED');

check('bad phone is refused', api.submitBooking({
  clinicId: 'C1', doctorId: 'D1', reasonId: 'R1', date: target.date, start: '09:45',
  name: 'اختبار', phone: '12', phoneConfirm: '12', consent: 'true'
}).error === 'PHONE_INVALID');

check('honeypot is refused', api.submitBooking({
  clinicId: 'C1', doctorId: 'D1', reasonId: 'R1', date: target.date, start: '09:45',
  name: 'اختبار', phone: '01007777777', phoneConfirm: '01007777777', consent: 'true', trap: 'bot'
}).error === 'REJECTED');

check('a slot outside the doctor\'s hours is refused', api.submitBooking({
  clinicId: 'C1', doctorId: 'D1', reasonId: 'R1', date: target.date, start: '20:00',
  name: 'اختبار', phone: '01008888888', phoneConfirm: '01008888888', consent: 'true'
}).error === 'SLOT_TAKEN');

/* -------------------------------------------------- */
section('4. Rate limiting per phone');

reset();
const r1 = api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' });
const picks = [];
r1.days.forEach((d) => d.slots.slice(0, 2).forEach((s) => picks.push({ date: d.date, start: s.start })));
for (let i = 0; i < 3; i++) {
  const res = api.submitBooking({
    clinicId: 'C1', doctorId: 'D1', reasonId: 'R1', date: picks[i].date, start: picks[i].start,
    name: 'مريض التكرار', phone: '01001234567', phoneConfirm: '01001234567', consent: 'true'
  });
  check(`booking ${i + 1} of 3 accepted`, res.ok === true, JSON.stringify(res));
}
const fourth = api.submitBooking({
  clinicId: 'C1', doctorId: 'D1', reasonId: 'R1', date: picks[3].date, start: picks[3].start,
  name: 'مريض التكرار', phone: '01001234567', phoneConfirm: '01001234567', consent: 'true'
});
check('fourth future booking for the same phone is blocked',
  fourth.ok === false && fourth.error === 'TOO_MANY_ACTIVE', JSON.stringify(fourth));

/* -------------------------------------------------- */
section('5. Staff actions');

const board = api.getStaffBoard(api.todayStr(), CODE);
check('staff board needs the right code', api.getStaffBoard(api.todayStr(), 'nope').ok === false);
check('board lists the day', board.ok === true);
check('a wrong code on a status change is refused',
  api.setBookingStatus(picks[0] ? 'x' : 'x', 'attended', 'wrong').ok === false);

reset();
const one = api.submitBooking({
  clinicId: 'C1', doctorId: 'D1', reasonId: 'R1',
  date: firstFreeSlot(api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' })).date,
  start: firstFreeSlot(api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' })).start,
  name: 'أ', phone: '01001112222', phoneConfirm: '01001112222', consent: 'true'
});
const bookingId = one.bookingId;
const dayOfBooking = one.date;

const cancelled = api.setBookingStatus(bookingId, 'cancelled', CODE, 'طلب المريض');
check('cancel succeeds', cancelled.ok === true);
check('cancel frees the slot',
  api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' })
    .days.some((d) => d.date === dayOfBooking && d.slots.some((s) => s.start === one.startTime)));
check('cancel removes the calendar event', state.events.size === 0);
check('the row is kept, marked cancelled',
  api.Db.rows(api.SHEET.BOOKINGS).filter((b) => b.status === 'cancelled').length === 1);

const second = api.submitBooking({
  clinicId: 'C1', doctorId: 'D1', reasonId: 'R1', date: dayOfBooking, start: one.startTime,
  name: 'ب', phone: '01003334444', phoneConfirm: '01003334444', consent: 'true'
});
check('the freed slot can be re-booked', second.ok === true);

const later = slotForWeekday(api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' }), 3);
const moved = api.rescheduleBooking(second.bookingId, later.date, later.start, CODE, 'تغيير');
check('reschedule succeeds', moved.ok === true, JSON.stringify(moved));
check('old row is marked rescheduled, not deleted',
  api.Db.rows(api.SHEET.BOOKINGS).filter((b) => b.booking_id === second.bookingId)[0].status === 'rescheduled');
check('new row points back at the old one',
  api.Db.rows(api.SHEET.BOOKINGS).filter((b) => b.rescheduled_from === second.bookingId).length === 1);
check('history keeps both rows', api.Db.rows(api.SHEET.BOOKINGS).length === 3);
check('still exactly one calendar event', state.events.size === 1);

const noShow = api.setBookingStatus(moved.booking.bookingId, 'no_show', CODE, '');
check('no-show is recorded', noShow.ok === true);
check('no-show does not free the slot', !!api.Db.rows(api.SHEET.BOOKINGS).filter((b) => b.status === 'no_show').length);

/* -------------------------------------------------- */
section('6. Blackouts and daily caps');

reset();
const base = api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' });
// Measure the partial blackout on a day that has not started yet: "today" shrinks as
// the clock moves through it, so its slot count is not 09:00–16:00 after noon.
const firstDay = base.days.filter((d) => d.date > api.todayStr())[0] || base.days[0];
const beforeCount = firstDay.slots.length;

api.blockTime({ date: firstDay.date, scopeType: 'doctor', scopeId: 'D1', fromTime: '09:00', toTime: '12:00', note: 'إجازة صباحية' }, CODE);
const withPartial = api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' });
const afterPartial = (withPartial.days.filter((d) => d.date === firstDay.date)[0] || { slots: [] }).slots;
check('a partial blackout removes only the overlapping slots',
  afterPartial.length === beforeCount - 4, `${beforeCount} -> ${afterPartial.length}`);
check('remaining slots start at 12:00',
  afterPartial.length === 0 || afterPartial[0].start === '12:00', afterPartial[0] && afterPartial[0].start);

api.blockTime({ date: base.days[1].date, scopeType: 'all', scopeId: '', fromTime: '', toTime: '', note: 'عطلة' }, CODE);
const withFull = api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' });
check('a whole-day blackout removes the whole day',
  withFull.days.every((d) => d.date !== base.days[1].date));
check('other days are untouched', withFull.days.length === base.days.length - 1);

api.blockTime({ date: base.days[0].date, scopeType: 'clinic', scopeId: 'C2', fromTime: '', toTime: '', note: 'فرع آخر' }, CODE);
check('a blackout for another clinic does not affect this one',
  api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' }).days.some((d) => d.date === base.days[0].date));

reset();
const capTarget = api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' }).days[0];
api.Db.update(api.SHEET.AVAILABILITY, 'availability_id', 'A1', { max_per_day_override: 2 });
const capped = api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' });
if (api.weekdayIndex(capTarget.date) === 0) {
  const cappedDay = capped.days.filter((d) => d.date === capTarget.date)[0];
  check('max_per_day_override caps the day', cappedDay && cappedDay.slots.length === 2, JSON.stringify(cappedDay && cappedDay.slots.length));
} else {
  check('cap test skipped (first day was not Sunday)', true);
}

/* -------------------------------------------------- */
section('7. Reports, history and board');

reset();
const rep1 = api.submitBooking({
  clinicId: 'C1', doctorId: 'D1', reasonId: 'R1',
  date: firstFreeSlot(api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' })).date,
  start: firstFreeSlot(api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' })).start,
  name: 'سارة', phone: '01010000001', phoneConfirm: '01010000001', consent: 'true'
});
api.setBookingStatus(rep1.bookingId, 'attended', CODE, '');
const secondSlot = api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' }).days[0].slots[0];
api.submitBooking({
  clinicId: 'C1', doctorId: 'D1', reasonId: 'R1', date: api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' }).days[0].date,
  start: secondSlot.start, name: 'سارة', phone: '01010000001', phoneConfirm: '01010000001', consent: 'true'
});

const history = api.lookupPatient('01010000001', CODE);
check('patient history found by phone', history.ok === true && history.total === 2, JSON.stringify(history));
check('history counts attendance', history.attended === 1);
check('history shows the name', history.name === 'سارة');
check('history needs the staff code', api.lookupPatient('01010000001', 'bad').ok === false);

const kpi = api.kpiSummary('', '');
check('kpi totals match the rows', kpi.totalBookings === 2, JSON.stringify(kpi.totalBookings));
check('kpi detects a repeat patient', kpi.repeatPatients === 1 && kpi.uniquePatients === 1);
check('kpi groups by doctor', kpi.byDoctor.length === 1 && kpi.byDoctor[0].count === 2);
check('kpi groups by reason', kpi.byReason[0].labelAr === 'فحص أولي');
check('report rows are Arabic-labelled',
  api.reportRows({}).length === 2 && api.reportRows({})[0].length === 16, String(api.reportRows({})[0] && api.reportRows({})[0].length));
check('report filters by doctor', api.reportRows({ doctorId: 'D2' }).length === 0);

const boardToday = api.getStaffBoard(rep1.date, CODE);
check('board shows the day\'s bookings', boardToday.bookings.length >= 1);
check('board items carry 4 WhatsApp templates',
  boardToday.bookings[0].waLinks.length === 4, String(boardToday.bookings[0].waLinks.length));
check('WhatsApp links point at wa.me with the normalised number',
  boardToday.bookings[0].waLinks[0].url.indexOf('https://wa.me/201010000001') === 0,
  boardToday.bookings[0].waLinks[0].url.slice(0, 40));
check('confirmation template contains the doctor name',
  boardToday.bookings[0].waLinks[0].text.indexOf('د. أحمد') !== -1);
check('board has no patient data without the code', api.getStaffBoard(rep1.date, 'x').ok === false);

const marked = api.markWhatsAppSent(rep1.bookingId, 'confirm');
check('marking a WhatsApp send stamps the row', marked.ok === true &&
  api.Db.rows(api.SHEET.BOOKINGS).filter((b) => b.booking_id === rep1.bookingId)[0].wa_template === 'confirm');

/* -------------------------------------------------- */
section('7b. The reminder carries the location too');

const boardAfterSend = api.getStaffBoard(rep1.date, CODE);
const cardFor = boardAfterSend.bookings.filter((b) => b.bookingId === rep1.bookingId)[0] || boardAfterSend.bookings[0];
const linksByKey = {};
cardFor.waLinks.forEach((w) => { linksByKey[w.key] = w; });
const reminder = linksByKey.remind24;

check('the reminder button absorbed the old "العنوان والموقع" button',
  !!reminder && linksByKey.directions === undefined);
check('the reminder is labelled as reminder + location',
  reminder.labelAr === 'تذكير بالموعد والموقع', reminder.labelAr);
check('one tap sends the appointment details',
  reminder.text.indexOf(cardFor.timeAr) !== -1 && reminder.text.indexOf('د. أحمد') !== -1,
  reminder.text.replace(/\n/g, ' | ').slice(0, 90));
check('the same message carries the branch address',
  reminder.text.indexOf('شارع ١') !== -1, reminder.text.replace(/\n/g, ' | '));
check('the same message carries the map link',
  reminder.text.indexOf('https://maps.example/1') !== -1);
check('the reminder still asks for the ten minutes and a call if he cannot come',
  reminder.text.indexOf('عشر دقائق') !== -1 && reminder.text.indexOf('بلّغنا') !== -1);
check('the reminder does not hard-code "tomorrow"',
  reminder.text.indexOf('غداً') === -1 || api.relativeDayAr(rep1.date) === 'غداً',
  'date=' + rep1.date + ' rel=' + api.relativeDayAr(rep1.date) + ' today=' + api.todayStr());
check('the link is a wa.me link to the patient',
  reminder.url.indexOf('https://wa.me/201010000001?text=') === 0);

const DAY_TODAY = api.todayStr();
check('a booking later today reads "اليوم"', api.relativeDayAr(DAY_TODAY) === 'اليوم');
check('a booking tomorrow reads "غداً"', api.relativeDayAr(api.addDaysStr(DAY_TODAY, 1)) === 'غداً');
check('a booking the day after reads "بعد غد"', api.relativeDayAr(api.addDaysStr(DAY_TODAY, 2)) === 'بعد غد');
check('a booking further out gets the full date',
  api.relativeDayAr(api.addDaysStr(DAY_TODAY, 10)).indexOf(String(new Date().getFullYear())) !== -1,
  api.relativeDayAr(api.addDaysStr(DAY_TODAY, 10)));

// A branch that has not filled its address yet must not produce a dangling "📍".
const noAddressVars = api.templateVars({
  doctor_id: 'D1', clinic_id: 'C9', reason_id: 'R1', date: DAY_TODAY, start_time: '09:00', booking_id: 'x'
});
check('a clinic without an address produces no empty location line',
  noAddressVars.addressBlock === '', JSON.stringify(noAddressVars.addressBlock));
const noAddressText = api.renderTemplate('قبل\n{addressBlock}بعد', noAddressVars);
check('an empty address block collapses cleanly in the message',
  noAddressText === 'قبل\nبعد', JSON.stringify(noAddressText));

check('the sent template is readable in Arabic, not a code',
  cardFor.waTemplate === 'تأكيد الحجز', cardFor.waTemplate);
check('a hand-sent template is named in Arabic in the report too',
  api.reportRows({})[0][13] === 'تأكيد الحجز', api.reportRows({})[0][13]);
check('an unknown stored template is shown as it is, not blanked',
  api.waTemplateLabelAr('something_old') === 'something_old' &&
  api.waTemplateLabelAr('') === '');

/* -------------------------------------------------- */
section('8. Public catalogue exposes no patient data');

const boot = api.getBootstrap();
check('bootstrap lists clinics and doctors', boot.clinics.length === 1 && boot.doctors.length === 2);
check('bootstrap exposes reasons with links', boot.reasons.length === 3);
check('each public reason carries one doctor and its branch list',
  boot.reasons.every((r) => !!r.doctorId && Array.isArray(r.clinicIds) && r.clinicIds.length > 0 &&
    r.links.every((l) => l.doctorId === r.doctorId && r.clinicIds.indexOf(l.clinicId) !== -1)));
check('bootstrap leaks nothing patient-related',
  JSON.stringify(boot).indexOf('01010000001') === -1 && JSON.stringify(boot).indexOf('سارة') === -1);
check('an annual Excel export is due until it is marked', api.annualExportDue() === true);
const annualYear = api.markAnnualExportDone();
check('marking the annual export clears the reminder', api.annualExportDue() === false &&
  annualYear === api.todayStr().slice(0, 4), annualYear);

/* -------------------------------------------------- */
section('9. Booking reference — doctor initials, date, running number');

reset();
const refDays = dayWithSlots(api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' }), 3);
const refStamp = refDays.date.replace(/-/g, '');

const ref1 = api.submitBooking({
  clinicId: 'C1', doctorId: 'D1', reasonId: 'R1', date: refDays.date, start: refDays.slots[0].start,
  name: 'الأول', phone: '01020000001', phoneConfirm: '01020000001', consent: 'true'
});
check('reference reads <code>-<date>-<n>', ref1.bookingId === 'ah-' + refStamp + '-1', ref1.bookingId);

const ref2 = api.submitBooking({
  clinicId: 'C1', doctorId: 'D1', reasonId: 'R1', date: refDays.date, start: refDays.slots[1].start,
  name: 'الثاني', phone: '01020000002', phoneConfirm: '01020000002', consent: 'true'
});
check('the second booking of the same doctor and day ends in -2',
  ref2.bookingId === 'ah-' + refStamp + '-2', ref2.bookingId);

const refD2 = api.generateSlots({ clinicId: 'C1', doctorId: 'D2', reasonId: 'R4' }).days[0];
const refOther = api.submitBooking({
  clinicId: 'C1', doctorId: 'D2', reasonId: 'R4', date: refD2.date, start: refD2.slots[0].start,
  name: 'مريض ثالث', phone: '01020000003', phoneConfirm: '01020000003', consent: 'true'
});
check('each doctor has his own running number',
  refOther.bookingId === 'mn-' + refD2.date.replace(/-/g, '') + '-1', refOther.bookingId);

api.Db.update(api.SHEET.DOCTORS, 'doctor_id', 'D1', { code: 'AE' });
const ref3 = api.submitBooking({
  clinicId: 'C1', doctorId: 'D1', reasonId: 'R1', date: refDays.date, start: refDays.slots[2].start,
  name: 'الرابع', phone: '01020000004', phoneConfirm: '01020000004', consent: 'true'
});
check('the code column in Doctors overrides the guess',
  ref3.bookingId === 'ae-' + refStamp + '-3', ref3.bookingId);

check('latin names give their initials', api.doctorCode({ name_ar: 'د. Ashraf Elzamany' }) === 'ae',
  api.doctorCode({ name_ar: 'د. Ashraf Elzamany' }));
check('single-word arabic names give two letters', api.doctorCode({ name_ar: 'د. أحمد' }) === 'ah',
  api.doctorCode({ name_ar: 'د. أحمد' }));
check('an empty name falls back to the doctor id', api.doctorCode({ doctor_id: 'D9' }) === 'd9',
  api.doctorCode({ doctor_id: 'D9' }));

api.Db.update(api.SHEET.DOCTORS, 'doctor_id', 'D1', { code: '' });
api.Db.update(api.SHEET.DOCTORS, 'doctor_id', 'D2', { name_ar: 'د. أحمد' });
check('configuration warns when two doctors share a booking code',
  api.checkConfiguration().warnings.filter((w) => w.indexOf('كود الحجز') !== -1).length === 1,
  JSON.stringify(api.checkConfiguration().warnings));

/* -------------------------------------------------- */
section('10. Reception board: shared schedule and per-doctor filter');

const schedBoard = api.getStaffBoard(refDays.date, CODE);
check('board lists the doctors on duty', schedBoard.doctors.length === 1, JSON.stringify(schedBoard.doctors.map((d) => d.id)));
check('each doctor label carries a colour for the shared schedule',
  /^#[0-9a-f]{6}$/i.test(schedBoard.doctors[0].color), schedBoard.doctors[0].color);
check('each doctor label carries the day\'s window',
  schedBoard.doctors[0].windowsAr.indexOf('–') !== -1, schedBoard.doctors[0].windowsAr);
check('each doctor label counts the day\'s bookings',
  schedBoard.doctors[0].bookings === 3, String(schedBoard.doctors[0].bookings));
check('a booking carries its doctor colour, so columns and cards match',
  schedBoard.bookings[0].doctorColor === schedBoard.doctors[0].color,
  schedBoard.bookings[0].doctorColor + ' vs ' + schedBoard.doctors[0].color);

let quietDay = refDays.date;
while (api.weekdayIndex(quietDay) !== 5) quietDay = api.addDaysStr(quietDay, 1);
check('a day nobody works has no schedule columns',
  api.getStaffBoard(quietDay, CODE).doctors.length === 0,
  JSON.stringify(api.getStaffBoard(quietDay, CODE).doctors));

/* -------------------------------------------------- */
section('11. Reports: one doctor, several, or all');

reset();

const d1Day = dayWithSlots(api.generateSlots({ clinicId: 'C1', doctorId: 'D1', reasonId: 'R1' }), 2);
const d2Day = dayWithSlots(api.generateSlots({ clinicId: 'C1', doctorId: 'D2', reasonId: 'R4' }), 2);

let seq = 0;
function bookFor(doctorId, reasonId, day, slotIndex, name) {
  seq++;
  return api.submitBooking({
    clinicId: 'C1', doctorId: doctorId, reasonId: reasonId,
    date: day.date, start: day.slots[slotIndex].start,
    name: name, phone: '0103000000' + seq, phoneConfirm: '0103000000' + seq, consent: 'true'
  });
}

const scoped1 = bookFor('D1', 'R1', d1Day, 0, 'أول');
bookFor('D1', 'R1', d1Day, 1, 'ثاني');
bookFor('D2', 'R4', d2Day, 0, 'ثالث');
bookFor('D2', 'R4', d2Day, 1, 'رابع');
api.setBookingStatus(scoped1.bookingId, 'attended', CODE, '');

check('an untouched filter means every doctor', api.reportRows({}).length === 4);
check('one doctor id narrows the report', api.reportRows({ doctorId: 'D1' }).length === 2);
check('the narrowed report holds only that doctor',
  api.reportRows({ doctorId: 'D1' }).every((r) => r[3] === 'د. أحمد'));
check('a comma list is a comparison scope', api.reportRows({ doctorId: 'D1,D2' }).length === 4);
check('an array of ids behaves exactly like a comma list',
  api.reportRows({ doctorIds: ['D1', 'D2'] }).length === 4);
check('doctorIds wins over the older single field',
  api.reportRows({ doctorId: 'D1', doctorIds: ['D2'] }).length === 2);
check('two doctors come out grouped per doctor, not interleaved by date',
  api.reportRows({ doctorId: 'D1,D2' }).map((r) => r[3]).join('|') ===
  ['د. أحمد', 'د. أحمد', 'د. منى', 'د. منى'].join('|'),
  api.reportRows({ doctorId: 'D1,D2' }).map((r) => r[3]).join('|'));
check('the date range and the doctors apply together',
  api.reportRows({ doctorId: 'D1,D2', from: d2Day.date, to: d2Day.date }).length === 2);
check('an unknown doctor id exports nothing, not everything',
  api.reportRows({ doctorId: 'D9' }).length === 0 &&
  api.reportRows({ doctorId: 'D1,D9' }).length === 2);
check('doctorIdList reads every shape',
  api.doctorIdList('D1,D2').length === 2 && api.doctorIdList(' D1 , D2 ').length === 2 &&
  api.doctorIdList(['D1'])[0] === 'D1' && api.doctorIdList('').length === 0 &&
  api.doctorIdList(null).length === 0);

const kpiAll = api.kpiSummary('', '');
check('kpi without a filter covers every doctor',
  kpiAll.totalBookings === 4 && kpiAll.byDoctor.length === 2 && kpiAll.scopeLabelAr === 'كل الأطباء',
  JSON.stringify({ total: kpiAll.totalBookings, scope: kpiAll.scopeLabelAr }));
check('kpi dates still arrive through the positional arguments',
  api.kpiSummary(d1Day.date, d1Day.date).totalBookings === 2);

const kpiD1 = api.kpiSummary('', '', { doctorId: 'D1' });
check('kpi follows a single doctor',
  kpiD1.totalBookings === 2 && kpiD1.byDoctor.length === 1 && kpiD1.attended === 1,
  JSON.stringify({ total: kpiD1.totalBookings, by: kpiD1.byDoctor.length }));
check('the one-doctor kpi names him', kpiD1.scopeLabelAr === 'د. أحمد', kpiD1.scopeLabelAr);
check('a one-doctor kpi hides the other doctor\'s rows',
  kpiD1.byDoctor[0].id === 'D1');

const kpiTwo = api.kpiSummary('', '', { doctorIds: ['D1', 'D2'] });
check('a comparison kpi names both doctors', kpiTwo.scopeLabelAr === 'د. أحمد + د. منى', kpiTwo.scopeLabelAr);
check('a comparison kpi keeps the doctors apart',
  kpiTwo.byDoctor.length === 2 && kpiTwo.byDoctor.reduce((sum, d) => sum + d.count, 0) === 4);

check('an export of everything says so in the name', api.exportScopeSlug({}) === 'كل-الأطباء');
check('a one-doctor export is named after him',
  api.exportScopeSlug({ doctorId: 'D1' }) === 'د.-أحمد', api.exportScopeSlug({ doctorId: 'D1' }));
check('a comparison export counts the doctors',
  api.exportScopeSlug({ doctorId: 'D1,D2' }) === 'مقارنة-2-أطباء' &&
  api.exportScopeSlug({ doctorId: 'D1,D2,D3' }) === 'مقارنة-3-أطباء');

const allName = api.exportBaseName({});
check('the export name leads with what it is',
  allName.indexOf('تقرير-الحجوزات-كل-الأطباء-') === 0, allName);
check('the export name ends with a date and a time',
  /-\d{4}-\d{2}-\d{2}-\d{4}$/.test(allName), allName);
check('the backup label rides along with the scope, keeping the name unique',
  api.exportBaseName({}, 'نسخة-احتياطية-الحجوزات').indexOf('نسخة-احتياطية-الحجوزات-كل-الأطباء-') === 0);
check('a two-doctor file name says it is a comparison',
  api.exportBaseName({ doctorId: 'D1,D2' }).indexOf('-مقارنة-2-أطباء-') !== -1,
  api.exportBaseName({ doctorId: 'D1,D2' }));

const csvAll = api.exportCsv({});
const csvD1 = api.exportCsv({ doctorId: 'D1' });
const csvTwo = api.exportCsv({ doctorId: 'D1,D2' });
check('the CSV keeps its BOM so Excel reads Arabic',
  csvAll.charCodeAt(0) === 0xfeff);
check('the CSV header is unchanged', csvAll.split('\r\n')[0].indexOf('رقم الحجز') !== -1);
check('a one-doctor CSV drops the other doctor',
  csvD1.indexOf('د. أحمد') !== -1 && csvD1.indexOf('د. منى') === -1);
check('a comparison CSV holds both doctors',
  csvTwo.indexOf('د. أحمد') !== -1 && csvTwo.indexOf('د. منى') !== -1 &&
  csvTwo.trim().split(/\r?\n/).length === 5, String(csvTwo.trim().split(/\r?\n/).length));

/* -------------------------------------------------- */
section('12. Admin settings, doctor PINs and the public pause');

reset();
const ADMIN = 'ADMIN-123';

check('the first admin code is bootstrapped from the staff code',
  api.adminBootstrap(CODE, ADMIN).ok === true);
check('bootstrap creates the Access sheet',
  !!state.sheets.get(api.SHEET.ACCESS), JSON.stringify(Array.from(state.sheets.keys())));
check('the Clinics header gained sort_order without shifting existing columns',
  state.sheets.get(api.SHEET.CLINICS).get(1, 8) === 'sort_order',
  state.sheets.get(api.SHEET.CLINICS).get(1, 1) + '…' + state.sheets.get(api.SHEET.CLINICS).get(1, 8));
check('the Reasons header gained doctor_id and clinic_ids at the end',
  state.sheets.get(api.SHEET.REASONS).get(1, 10) === 'doctor_id' &&
  state.sheets.get(api.SHEET.REASONS).get(1, 11) === 'clinic_ids',
  state.sheets.get(api.SHEET.REASONS).get(1, 1) + '…' + state.sheets.get(api.SHEET.REASONS).get(1, 11));
check('the admin code logs in as admin', api.adminLogin(ADMIN).role === 'admin');
check('the staff code no longer opens the settings page',
  api.adminLogin(CODE).ok === false && api.adminLogin(CODE).error === 'USE_ADMIN',
  JSON.stringify(api.adminLogin(CODE)));
check('a wrong code is rejected', api.adminLogin('nope').ok === false);

const adminView = api.adminGet(ADMIN);
const adminJson = JSON.stringify(adminView);
check('the admin payload never contains the staff code', adminJson.indexOf(CODE) === -1);
check('the admin payload never contains a PIN or its hash',
  adminJson.indexOf('pin_hash') === -1 && adminJson.indexOf('pin_salt') === -1 && adminJson.indexOf('123456') === -1);
check('the settings page receives doctor, branch and reason lists',
  adminView.clinics.length >= 2 && adminView.doctors.length >= 2 && adminView.reasons.length >= 3);
check('the overview receives a health report and an audit list',
  Array.isArray(adminView.health) && Array.isArray(adminView.audit));
check('the audit recorded the bootstrap', adminView.audit.length > 0 && adminView.audit[0].action.length > 0,
  JSON.stringify(adminView.audit.slice(0, 1)));

const newClinic = api.adminSave(ADMIN, 'clinic', {
  nameAr: 'فرع ثالث', addressAr: 'شارع ٣', mapLink: 'https://maps.example/3',
  phone: '0220000002', hoursAr: '٩–٥', active: true
});
check('a new branch gets the next stable id', newClinic.ok === true && newClinic.id === 'C3', JSON.stringify(newClinic));
check('a new branch is appended after the existing order, not put first',
  api.getBootstrap().clinics.map((c) => c.id).join(',') === 'C1,C3',
  api.getBootstrap().clinics.map((c) => c.id).join(','));

const newDoctor = api.adminSave(ADMIN, 'doctor', {
  nameAr: 'د. سارة', specialtyAr: 'جلدية', clinicIds: ['C1'], color: 'blue', active: true
});
check('a new doctor gets a stable id and a two-letter booking code',
  newDoctor.ok === true && newDoctor.id === 'D3' && /^[a-z]{2}$/.test(newDoctor.code),
  JSON.stringify(newDoctor));
const duplicateCode = api.adminSave(ADMIN, 'doctor', {
  nameAr: 'د. تجريبي', specialtyAr: 'عام', clinicIds: ['C1'], code: newDoctor.code, active: true
});
check('a duplicate booking code is refused', duplicateCode.ok === false && duplicateCode.error === 'CODE_TAKEN',
  JSON.stringify(duplicateCode));
check('a doctor must have at least one branch',
  api.adminSave(ADMIN, 'doctor', { nameAr: 'د. بلا فرع', specialtyAr: 'عام', clinicIds: [] }).error === 'BRANCH_REQUIRED');
check('a doctor cannot be given a nonexistent branch',
  api.adminSave(ADMIN, 'doctor', { nameAr: 'د. خطأ', specialtyAr: 'عام', clinicIds: ['C99'] }).error === 'BRANCH_NOT_FOUND');

const newReason = api.adminSave(ADMIN, 'reason', {
  doctorId: 'D1', clinicIds: ['C1'], nameAr: 'تطعيم', durationMin: 20,
  leadHours: 0, bookDaysAhead: 14, maxPerDay: 5, active: true
});
check('a new visit reason is accepted with a doctor and branch',
  newReason.ok === true && /^R\d+$/.test(newReason.id || ''), JSON.stringify(newReason));
check('a visit reason must have a doctor',
  api.adminSave(ADMIN, 'reason', { clinicIds: ['C1'], nameAr: 'بلا طبيب' }).error === 'DOCTOR_REQUIRED');
check('a reason branch must belong to the doctor',
  api.adminSave(ADMIN, 'reason', {
    doctorId: 'D1', clinicIds: ['C2'], nameAr: 'فرع غير مرتبط', active: true
  }).error === 'BRANCH_NOT_ASSIGNED');
check('a doctor-visible reason cannot be left with no branches',
  api.adminSave(ADMIN, 'reason', {
    doctorId: 'D1', clinicIds: [], nameAr: 'بلا فروع', active: true
  }).error === 'BRANCH_REQUIRED');

const avSaved = api.adminSave(ADMIN, 'availability', {
  doctorId: 'D1', clinicId: 'C1', reasonId: 'R2', weekdays: [1, 2],
  fromTime: '08:00', toTime: '10:00', slotMin: 30, maxPerDay: 5, active: true
});
check('a weekly block can span two days at once', avSaved.ok === true);
let avRows = api.Db.rows(api.SHEET.AVAILABILITY).filter((a) =>
  a.doctor_id === 'D1' && a.clinic_id === 'C1' && a.reason_id === 'R2');
check('one row was written per selected weekday',
  avRows.length === 2 && avRows.map((a) => Number(a.weekday)).sort().join(',') === '1,2',
  JSON.stringify(avRows.map((a) => a.weekday)));

const avIds = avRows.map((a) => a.availability_id);
const avEdited = api.adminSave(ADMIN, 'availability', {
  ids: avIds, doctorId: 'D1', clinicId: 'C1', reasonId: 'R2', weekdays: [2, 3],
  fromTime: '08:30', toTime: '10:30', slotMin: 20, maxPerDay: 0, active: true
});
avRows = api.Db.rows(api.SHEET.AVAILABILITY).filter((a) =>
  a.doctor_id === 'D1' && a.clinic_id === 'C1' && a.reason_id === 'R2');
check('editing a weekly block removes the unchecked day and adds the new one',
  avEdited.ok === true && avRows.length === 2 &&
  avRows.map((a) => Number(a.weekday)).sort().join(',') === '2,3',
  JSON.stringify(avRows.map((a) => a.weekday)));
check('the whole block moves to the new time and slot length',
  avRows.every((a) => a.from_time === '08:30' && a.to_time === '10:30' && Number(a.slot_min) === 20),
  JSON.stringify(avRows.map((a) => [a.from_time, a.to_time, a.slot_min])));
check('a backwards time range is refused',
  api.adminSave(ADMIN, 'availability', {
    doctorId: 'D1', clinicId: 'C1', reasonId: 'R2', weekdays: [1],
    fromTime: '10:00', toTime: '09:00', slotMin: 30, active: true
  }).error === 'BAD_TIME');
check('a doctor cannot be scheduled in a branch they are not assigned to',
  api.adminSave(ADMIN, 'availability', {
    doctorId: 'D2', clinicId: 'C2', reasonId: 'R2', weekdays: [1],
    fromTime: '09:00', toTime: '10:00', slotMin: 30, active: true
  }).error === 'CLINIC_NOT_FOUND');

check('a schedule block can be deleted',
  api.adminDelete(ADMIN, 'availability', avRows.map((a) => a.availability_id)).ok === true);
check('the deleted block no longer produces rows',
  api.Db.rows(api.SHEET.AVAILABILITY).filter((a) =>
    a.doctor_id === 'D1' && a.reason_id === 'R2' && a.clinic_id === 'C1').length === 0);

check('the admin can set a doctor PIN',
  api.adminSetDoctorPin(ADMIN, 'D1', '123456').ok === true);
check('an admin code cannot be changed to a doctor PIN',
  api.adminSave(ADMIN, 'settings', { values: { adminCode: '123456' } }).error === 'CODE_CONFLICT');
check('the staff code cannot be changed to a doctor PIN',
  api.adminSave(ADMIN, 'settings', { values: { staffCode: '123456' } }).error === 'CODE_CONFLICT');
const beforeColor = api.getPublicConfig().brandPrimary;
const rejectedSettings = api.adminSave(ADMIN, 'settings', {
  values: { clinicName: '', brandPrimary: '#123456' }
});
check('a rejected settings form changes nothing',
  rejectedSettings.error === 'NAME_REQUIRED' && api.getPublicConfig().brandPrimary === beforeColor,
  JSON.stringify(rejectedSettings));
const rejectedTimezone = api.adminSave(ADMIN, 'settings', {
  values: { clinicName: 'اسم تجريبي', timezone: 'Not/AZone' }
});
check('an invalid timezone is rejected before any change',
  rejectedTimezone.error === 'BAD_TIMEZONE' && api.getPublicConfig().clinicName !== 'اسم تجريبي',
  JSON.stringify(rejectedTimezone));
const foreignReason = api.adminSave(ADMIN, 'availability', {
  ids: [api.Db.rows(api.SHEET.AVAILABILITY).filter((a) => a.reason_id === 'R1')[0].availability_id],
  doctorId: 'D1', clinicId: 'C1', reasonId: 'R2', weekdays: [1],
  fromTime: '09:00', toTime: '10:00', slotMin: 30, active: true
});
check('mixing schedule ids from another visit reason is refused',
  foreignReason.error === 'NOT_FOUND', JSON.stringify(foreignReason));
const doctorLogin = api.adminLogin('123456');
check('the doctor PIN opens a doctor-scoped session',
  doctorLogin.ok === true && doctorLogin.role === 'doctor' && doctorLogin.doctorId === 'D1',
  JSON.stringify(doctorLogin));
const doctorView = api.adminGet('123456');
check('the doctor payload has only their own availability',
  doctorView.role === 'doctor' && doctorView.availability.every((a) => a.doctorId === 'D1'),
  JSON.stringify(doctorView.availability.map((a) => a.doctorId)));
check('the doctor payload has no other doctor and no patient data',
  JSON.stringify(doctorView).indexOf('D2') === -1 && JSON.stringify(doctorView).indexOf('pin_hash') === -1);
check('a doctor cannot edit branches',
  api.adminSave('123456', 'clinic', { nameAr: 'فرع الطبيب' }).error === 'ADMIN_ONLY');
const doctorBlock = api.adminSave('123456', 'availability', {
  doctorId: 'D2', clinicId: 'C1', reasonId: 'R2', weekdays: [5],
  fromTime: '09:00', toTime: '10:00', slotMin: 30, active: true
});
check('a doctor can add a block, and the server forces it to their own id',
  doctorBlock.ok === true &&
  api.Db.rows(api.SHEET.AVAILABILITY).filter((a) => Number(a.weekday) === 5 && a.reason_id === 'R2')
    .every((a) => a.doctor_id === 'D1'),
  JSON.stringify(doctorBlock));

/* ---- per-doctor reason ownership, copying and cleanup ---- */
const ownReason = api.adminSave('123456', 'reason', {
  doctorId: 'D2', clinicIds: ['C1'], nameAr: 'سبب خاص بالطبيب',
  durationMin: 20, leadHours: 0, bookDaysAhead: 14, maxPerDay: 5, active: true
});
const ownReasonRow = api.Db.findById(api.SHEET.REASONS, 'reason_id', ownReason.id);
check('a doctor can create a reason, and the server forces their own doctor id',
  ownReason.ok === true && ownReasonRow.doctor_id === 'D1' && ownReasonRow.clinic_ids === 'C1',
  JSON.stringify({ result: ownReason, row: ownReasonRow }));
check('a doctor cannot edit another doctor\'s reason',
  api.adminSave('123456', 'reason', {
    id: 'R4', doctorId: 'D2', clinicIds: ['C1'], nameAr: 'محاولة', active: true
  }).error === 'FORBIDDEN');
check('a doctor cannot put their reason in a branch they do not serve',
  api.adminSave('123456', 'reason', {
    clinicIds: ['C2'], nameAr: 'فرع ممنوع', active: true
  }).error === 'BRANCH_NOT_ASSIGNED');
check('a doctor cannot schedule another doctor\'s reason',
  api.adminSave('123456', 'availability', {
    doctorId: 'D1', clinicId: 'C1', reasonId: 'R4', weekdays: [1],
    fromTime: '09:00', toTime: '10:00', slotMin: 30, active: true
  }).error === 'REASON_NOT_OWNED');
check('the admin also cannot schedule a reason for the wrong doctor',
  api.adminSave(ADMIN, 'availability', {
    doctorId: 'D2', clinicId: 'C1', reasonId: 'R2', weekdays: [1],
    fromTime: '09:00', toTime: '10:00', slotMin: 30, active: true
  }).error === 'REASON_NOT_OWNED');

const ownBlock = api.adminSave(ADMIN, 'availability', {
  doctorId: 'D1', clinicId: 'C1', reasonId: ownReason.id, weekdays: [6],
  fromTime: '10:00', toTime: '11:00', slotMin: 20, active: true
});
check('a new reason becomes bookable only after a matching schedule block',
  ownBlock.ok === true &&
  api.getBootstrap().reasons.some((r) => r.id === ownReason.id),
  JSON.stringify(ownBlock));
check('archiving a reason deletes all of its schedule blocks',
  api.adminSave(ADMIN, 'reason', {
    id: ownReason.id, doctorId: 'D1', clinicIds: ['C1'], nameAr: 'سبب خاص بالطبيب',
    durationMin: 20, leadHours: 0, bookDaysAhead: 14, maxPerDay: 5, active: false
  }).ok === true &&
  api.Db.rows(api.SHEET.AVAILABILITY).filter((a) => a.reason_id === ownReason.id).length === 0 &&
  !api.getBootstrap().reasons.some((r) => r.id === ownReason.id));

const copied = api.adminCopyReason(ADMIN, 'R1', [{ doctorId: 'D2', clinicIds: ['C1'] }]);
const copiedRow = copied.ok && copied.copies.length
  ? api.Db.findById(api.SHEET.REASONS, 'reason_id', copied.copies[0].id) : null;
check('copying a reason creates an independent row for the target doctor',
  copied.ok === true && copiedRow && copiedRow.doctor_id === 'D2' &&
  copiedRow.clinic_ids === 'C1' && copiedRow.reason_id !== 'R1',
  JSON.stringify({ result: copied, row: copiedRow }));
check('a copy target branch must belong to the target doctor',
  api.adminCopyReason(ADMIN, 'R1', [{ doctorId: 'D2', clinicIds: ['C2'] }]).error === 'BRANCH_NOT_ASSIGNED');
if (copiedRow) {
  api.adminSave(ADMIN, 'reason', {
    id: copiedRow.reason_id, doctorId: 'D2', clinicIds: ['C1'], nameAr: 'اسم معدل',
    durationMin: 30, leadHours: 4, bookDaysAhead: 14, maxPerDay: 20, active: true
  });
  check('editing one copy never changes the source reason',
    api.Db.findById(api.SHEET.REASONS, 'reason_id', 'R1').name_ar !== 'اسم معدل');
  api.adminSave(ADMIN, 'reason', {
    id: copiedRow.reason_id, doctorId: 'D2', clinicIds: ['C1'], nameAr: 'اسم معدل',
    durationMin: 30, leadHours: 4, bookDaysAhead: 14, maxPerDay: 20, active: false
  });
}

const addC3 = api.adminSave(ADMIN, 'doctor', {
  id: 'D1', nameAr: 'د. أحمد', specialtyAr: 'باطنة', code: 'ah', clinicIds: ['C1', 'C3'], active: true
});
const branchReason = api.adminSave(ADMIN, 'reason', {
  doctorId: 'D1', clinicIds: ['C1', 'C3'], nameAr: 'سبب فرعين',
  durationMin: 20, leadHours: 0, bookDaysAhead: 14, maxPerDay: 5, active: true
});
const c3Block = api.adminSave(ADMIN, 'availability', {
  doctorId: 'D1', clinicId: 'C3', reasonId: branchReason.id, weekdays: [6],
  fromTime: '12:00', toTime: '13:00', slotMin: 20, active: true
});
const c1Block = api.adminSave(ADMIN, 'availability', {
  doctorId: 'D1', clinicId: 'C1', reasonId: branchReason.id, weekdays: [6],
  fromTime: '12:00', toTime: '13:00', slotMin: 20, active: true
});
check('a reason can start in two branches with separate schedule blocks',
  addC3.ok === true && branchReason.ok === true && c3Block.ok === true && c1Block.ok === true,
  JSON.stringify({ addC3, branchReason, c3Block, c1Block }));
const dropC3 = api.adminSave(ADMIN, 'reason', {
  id: branchReason.id, doctorId: 'D1', clinicIds: ['C1'], nameAr: 'سبب فرعين',
  durationMin: 20, leadHours: 0, bookDaysAhead: 14, maxPerDay: 5, active: true
});
const branchRows = api.Db.rows(api.SHEET.AVAILABILITY).filter((a) => a.reason_id === branchReason.id);
check('removing a branch from a reason deletes only that branch\'s blocks',
  dropC3.ok === true &&
  branchRows.length === 1 && branchRows[0].clinic_id === 'C1',
  JSON.stringify({ result: dropC3, rows: branchRows.map((a) => a.clinic_id) }));
check('removing a branch from a doctor strips it from their reasons and blocks',
  api.adminSave(ADMIN, 'doctor', {
    id: 'D1', nameAr: 'د. أحمد', specialtyAr: 'باطنة', code: 'ah', clinicIds: ['C1'], active: true
  }).ok === true &&
  api.reasonClinicIds(api.Db.findById(api.SHEET.REASONS, 'reason_id', branchReason.id)).indexOf('C3') === -1 &&
  api.Db.rows(api.SHEET.AVAILABILITY).filter((a) => a.clinic_id === 'C3').length === 0);

check('two doctors cannot share a PIN',
  api.adminSetDoctorPin(ADMIN, 'D2', '123456').error === 'PIN_CONFLICT');
check('a doctor can change their own PIN',
  api.adminChangePin('123456', '654321').ok === true);
check('the old PIN stops working and the new one works',
  api.adminLogin('123456').ok === false && api.adminLogin('654321').role === 'doctor');
check('the admin can disable a doctor PIN',
  api.adminSetDoctorPin(ADMIN, 'D2', '777777').ok === true &&
  api.adminSetDoctorPin(ADMIN, 'D2', '').ok === true &&
  api.adminLogin('777777').ok === false);

const orderSave = api.adminReorder(ADMIN, 'clinics', ['C3', 'C1', 'C2']);
check('the admin can reorder branches',
  orderSave.ok === true && api.getBootstrap().clinics.map((c) => c.id).join(',') === 'C3,C1',
  api.getBootstrap().clinics.map((c) => c.id).join(','));
check('archiving a branch removes it from the public booking catalogue',
  api.adminSave(ADMIN, 'clinic', {
    id: 'C3', nameAr: 'فرع ثالث', addressAr: 'شارع ٣', mapLink: '', phone: '', hoursAr: '٩–٥', active: false
  }).ok === true && api.getBootstrap().clinics.every((c) => c.id !== 'C3'));

check('stopping bookings writes the switch and the patient message',
  api.adminSave(ADMIN, 'pause', { paused: true, message: 'مغلق للعطلة' }).ok === true);
const pausedConfig = api.getPublicConfig();
check('the public config carries the pause and its message',
  pausedConfig.bookingsPaused === true && pausedConfig.pauseMessage === 'مغلق للعطلة',
  JSON.stringify({ paused: pausedConfig.bookingsPaused, message: pausedConfig.pauseMessage }));

const pausedSlot = firstFreeSlot(api.generateSlots({ clinicId: 'C1', doctorId: 'D2', reasonId: 'R4' }));
const pausedBooking = api.submitBooking({
  clinicId: 'C1', doctorId: 'D2', reasonId: 'R4',
  date: pausedSlot.date, start: pausedSlot.start,
  name: 'مريض الإيقاف', phone: '01055550000', phoneConfirm: '01055550000', consent: 'true'
});
check('a public booking is refused while paused, with the clinic message',
  pausedBooking.ok === false && pausedBooking.error === 'BOOKINGS_PAUSED' &&
  pausedBooking.messageAr === 'مغلق للعطلة', JSON.stringify(pausedBooking));
check('resuming bookings works',
  api.adminSave(ADMIN, 'pause', { paused: false, message: 'نعود قريباً' }).ok === true &&
  api.getPublicConfig().bookingsPaused === false);

check('key patient texts are editable',
  api.adminSave(ADMIN, 'texts', {
    texts: { subtitle: 'مرحباً بكم', slotTaken: 'هذا الموعد محجوز للتو', consentText: '' }
  }).ok === true);
const textConfig = api.getPublicConfig();
check('the edited subtitle reaches the public config',
  textConfig.texts.subtitle === 'مرحباً بكم', textConfig.texts.subtitle);
check('the edited slot-taken text reaches the error mapper',
  api.errorMessageAr('SLOT_TAKEN') === 'هذا الموعد محجوز للتو');
check('an empty consent field falls back to the built-in consent, never blank',
  !!textConfig.consentText && textConfig.consentText.length > 20);

const templateSave = api.adminSave(ADMIN, 'template', {
  key: 'confirm', text: 'أهلاً {name} — موعدك مع {doctor}'
});
check('a WhatsApp template override is saved', templateSave.ok === true);
check('the override is used by the effective templates',
  api.getWaTemplates().confirm.text === 'أهلاً {name} — موعدك مع {doctor}');
const templateBooking = api.submitBooking({
  clinicId: 'C1', doctorId: 'D2', reasonId: 'R4',
  date: pausedSlot.date, start: pausedSlot.start,
  name: 'مريض القالب', phone: '01055550001', phoneConfirm: '01055550001', consent: 'true'
});
const templateLinks = api.waLinksFor(api.Db.rows(api.SHEET.BOOKINGS)[0]);
check('the WhatsApp link is rendered with the patient name and doctor',
  templateBooking.ok === true && templateLinks[0].text.indexOf('مريض القالب') !== -1 &&
  templateLinks[0].text.indexOf('د.') !== -1, templateLinks[0].text);
check('resetting a template restores the built-in text',
  api.adminSave(ADMIN, 'template', { key: 'confirm', text: '' }).ok === true &&
  api.getWaTemplates().confirm.text.indexOf('مرحباً') !== -1);

const backup = api.adminBackup(ADMIN);
check('the backup button creates a Drive copy and returns its link',
  backup.ok === true && /drive\.google\.com/.test(backup.url), JSON.stringify(backup));
check('the audit log records the backup', api.adminGet(ADMIN).audit.some((a) => a.action.indexOf('نسخة') !== -1));

const newAdmin = api.adminSave(ADMIN, 'settings', { values: { adminCode: 'NEW-ADMIN' } });
check('the admin code can be changed separately from the staff code',
  newAdmin.ok === true && newAdmin.adminCodeChanged === true);
check('the old admin code stops working and the new one works',
  api.adminLogin(ADMIN).ok === false && api.adminLogin('NEW-ADMIN').role === 'admin');
const staffChange = api.adminSave('NEW-ADMIN', 'settings', { values: { staffCode: 'NEW-STAFF' } });
const staffLogin = api.adminLogin('NEW-STAFF');
check('the staff code can be changed without touching the admin code',
  staffChange.ok === true &&
  staffLogin.error === 'USE_ADMIN' &&
  api.getStaffBoard(api.todayStr(), 'NEW-STAFF').ok !== false &&
  api.adminLogin('NEW-ADMIN').role === 'admin',
  JSON.stringify({ change: staffChange, login: staffLogin }));
check('the admin code still works on the reception board',
  api.getStaffBoard(api.todayStr(), 'NEW-ADMIN').ok !== false);
check('a second bootstrap is refused once an admin code exists',
  api.adminBootstrap('NEW-STAFF', 'ANOTHER').error === 'ALREADY_SET');

/* ---- legacy global reasons become per-doctor copies ---- */
reset();
api.Db.rows(api.SHEET.REASONS).filter((r) => ['R1', 'R2', 'R3'].indexOf(r.reason_id) !== -1).forEach((r) => {
  api.Db.update(api.SHEET.REASONS, 'reason_id', r.reason_id, { doctor_id: '', clinic_ids: '' });
});
api.Db.update(api.SHEET.AVAILABILITY, 'availability_id', 'A4', { reason_id: 'R2' });
api.Db.update(api.SHEET.AVAILABILITY, 'availability_id', 'A5', { reason_id: 'R2' });
const legacyMigration = api.migrateReasonsToDoctors();
const migratedReasons = api.Db.rows(api.SHEET.REASONS);
const legacyOriginals = migratedReasons.filter((r) => ['R1', 'R2', 'R3'].indexOf(r.reason_id) !== -1);
const d1LegacyCopy = migratedReasons.filter((r) => r.doctor_id === 'D1' && r.name_ar === 'فحص أولي')[0];
const d2LegacyCopy = migratedReasons.filter((r) => r.doctor_id === 'D2' && r.name_ar === 'استشارة')[0];
check('legacy global reasons are archived after migration',
  legacyMigration.ok === true && legacyOriginals.every((r) => !api.isActive(r)),
  JSON.stringify(legacyMigration));
check('migration creates independent copies per doctor and repoints schedule rows',
  !!d1LegacyCopy && !!d2LegacyCopy && d1LegacyCopy.reason_id !== d2LegacyCopy.reason_id &&
  api.Db.rows(api.SHEET.AVAILABILITY).filter((a) => ['A1', 'A2'].indexOf(a.availability_id) !== -1)
    .every((a) => a.reason_id === d1LegacyCopy.reason_id) &&
  api.Db.rows(api.SHEET.AVAILABILITY).filter((a) => a.availability_id === 'A4')[0].reason_id === d2LegacyCopy.reason_id,
  JSON.stringify({ d1: d1LegacyCopy, d2: d2LegacyCopy, av: api.Db.rows(api.SHEET.AVAILABILITY) }));
check('migration is idempotent',
  api.migrateReasonsToDoctors().copies === 0);


// Production loads .gs files in its own order; an alphabetical pass is a useful
// proxy for "AdminApi.gs may run before Config.gs". Top-level initializers must
// not read constants from another file (that is how v5 crashed on the live URL).
const loadOrderFiles = fs.readdirSync(GS_DIR).filter((f) => f.endsWith('.gs')).sort();
let loadOrderError = null;
try {
  const loadOrderContext = vm.createContext({ Logger: { log() {} }, console });
  loadOrderFiles.forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(GS_DIR, f), 'utf8'), loadOrderContext, { filename: f });
  });
} catch (err) {
  loadOrderError = err;
}
check('every .gs file is safe to load in alphabetical order',
  !loadOrderError, loadOrderError && loadOrderError.message);

/* -------------------------------------------------- */

console.log(`\n${'-'.repeat(60)}`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
