/**
 * demo-runtime.js — the offline demo's browser runtime.
 *
 * This file is inlined into demo/patient.html and demo/reception.html by
 * tools/build-demo.mjs, with three tokens substituted:
 *
 *   /*__SERVER_SOURCE__*\/  →  every real .gs file, concatenated
 *   /*__XLSX_WRITER__*\/    →  tools/xlsx-writer.js, for the Excel export
 *   /*__PAGE__*\/           →  'patient' or 'reception'
 *
 * The point: the demo runs the *actual* slot engine, booking rules, staff
 * actions and reports. Only Google's storage layer is faked (spreadsheet,
 * calendar, lock, mail, drive). So the demo cannot disagree with the product.
 */

(function () {
  /*__XLSX_WRITER__*/

  var PAGE = /*__PAGE__*/;
  var STORE_KEY = 'polyclinic_demo_v4';
  var STAFF_CODE = '1234';
  var ADMIN_CODE = 'admin123';

  /* ------------------------------------------------------------------ *
   * Storage: localStorage when available, memory when it is not
   * ------------------------------------------------------------------ */

  var memory = {};
  function readRaw(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return memory[key] || null; }
  }
  function writeRaw(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { memory[key] = value; }
  }
  function dropRaw(key) {
    try { window.localStorage.removeItem(key); } catch (e) { delete memory[key]; }
  }

  var persisted = null;
  try { persisted = JSON.parse(readRaw(STORE_KEY) || 'null'); } catch (e) { persisted = null; }

  /* ------------------------------------------------------------------ *
   * Demo clock
   *
   * The clinic's real rule is "examinations on Sundays and Wednesdays". A demo
   * on a Thursday would show an empty calendar, so the demo pins "now" to the
   * next Sunday at 08:00 unless the presenter picks another date.
   * ------------------------------------------------------------------ */

  var RealDate = window.Date;

  /**
   * Pin "now" to the next Sunday 08:00 — the demo's "today".
   *
   * Why Sunday: the seeded clinic rule makes Sundays and Wednesdays bookable for
   * examinations, so a demo on any other day would open with an empty calendar.
   * bootstrapDemo() also zeroes the seeded minimum-notice values (demo data only),
   * otherwise a 12-hour lead time would hide today's own slots and the reception
   * board would look empty in front of the doctor.
   */
  function demoStart() {
    var d = new RealDate();
    var add = (7 - d.getDay()) % 7;
    d.setDate(d.getDate() + add);
    d.setHours(8, 0, 0, 0);
    return d.getTime();
  }

  var mockNow = Number(persisted && persisted.mockNow) || demoStart();

  function DemoDate() {
    if (arguments.length === 0) return new RealDate(mockNow);
    return new (Function.prototype.bind.apply(
      RealDate, [null].concat(Array.prototype.slice.call(arguments))
    ))();
  }
  DemoDate.now = function () { return mockNow; };
  DemoDate.parse = RealDate.parse;
  DemoDate.UTC = RealDate.UTC;
  DemoDate.prototype = RealDate.prototype;
  window.Date = DemoDate;

  function mockNowLabel() {
    var d = new RealDate(mockNow);
    var days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    var months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    var h = d.getHours();
    var suffix = h < 12 ? 'ص' : 'م';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() +
      ' — ' + h12 + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes() + ' ' + suffix;
  }

  /* ------------------------------------------------------------------ *
   * Fake spreadsheet, modelled on the Range/Sheet calls Db.gs actually makes
   * ------------------------------------------------------------------ */

  function FakeRange(sheet, row, col, numRows, numCols) {
    this.sheet = sheet; this.row = row; this.col = col;
    this.numRows = numRows; this.numCols = numCols;
  }
  FakeRange.prototype.getValues = function () {
    var out = [];
    for (var r = 0; r < this.numRows; r++) {
      var line = [];
      for (var c = 0; c < this.numCols; c++) line.push(this.sheet.get(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  };
  FakeRange.prototype.setValues = function (values) {
    for (var r = 0; r < values.length; r++) {
      for (var c = 0; c < values[r].length; c++) this.sheet.set(this.row + r, this.col + c, values[r][c]);
    }
    return this;
  };
  FakeRange.prototype.getValue = function () { return this.getValues()[0][0]; };
  FakeRange.prototype.setValue = function (v) { this.sheet.set(this.row, this.col, v); return this; };
  FakeRange.prototype.clearContent = function () { return this.fill(''); };
  FakeRange.prototype.clear = function () { return this.fill(''); };
  FakeRange.prototype.fill = function (v) {
    for (var r = 0; r < this.numRows; r++) {
      for (var c = 0; c < this.numCols; c++) this.sheet.set(this.row + r, this.col + c, v);
    }
    return this;
  };
  FakeRange.prototype.setNumberFormat = function () { return this; };
  FakeRange.prototype.setFontWeight = function () { return this; };
  FakeRange.prototype.setNote = function () { return this; };
  FakeRange.prototype.autoResizeColumns = function () { return this; };

  function FakeSheet(name, rows) {
    this.name = name;
    this.grid = [];
    if (rows) {
      for (var r = 0; r < rows.length; r++) {
        for (var c = 0; c < rows[r].length; c++) this.set(r + 1, c + 1, rows[r][c]);
      }
    }
  }
  FakeSheet.prototype.grow = function (r, c) {
    while (this.grid.length < r) this.grid.push([]);
    for (var i = 0; i < this.grid.length; i++) {
      while (this.grid[i].length < c) this.grid[i].push('');
    }
  };
  FakeSheet.prototype.get = function (r, c) {
    this.grow(r, c);
    var v = this.grid[r - 1][c - 1];
    return v === undefined || v === null ? '' : v;
  };
  FakeSheet.prototype.set = function (r, c, v) {
    this.grow(r, c);
    this.grid[r - 1][c - 1] = v === undefined || v === null ? '' : v;
  };
  FakeSheet.prototype.getLastRow = function () {
    for (var r = this.grid.length; r >= 1; r--) {
      var row = this.grid[r - 1];
      for (var c = 0; c < row.length; c++) {
        if (row[c] !== '' && row[c] !== undefined && row[c] !== null) return r;
      }
    }
    return 0;
  };
  FakeSheet.prototype.getLastColumn = function () {
    var max = 0;
    this.grid.forEach(function (row) { if (row.length > max) max = row.length; });
    return max;
  };
  FakeSheet.prototype.getMaxRows = function () { return Math.max(this.grid.length, 50); };
  FakeSheet.prototype.getMaxColumns = function () { return Math.max(this.getLastColumn(), 20); };
  FakeSheet.prototype.getName = function () { return this.name; };
  FakeSheet.prototype.setFrozenRows = function () { return this; };
  FakeSheet.prototype.setColumnWidth = function () { return this; };
  FakeSheet.prototype.autoResizeColumns = function () { return this; };
  FakeSheet.prototype.getRange = function (row, col, nRows, nCols) {
    return new FakeRange(this, row, col, nRows === undefined ? 1 : nRows, nCols === undefined ? 1 : nCols);
  };
  FakeSheet.prototype.copy = function () { return new FakeSheet(this.name, this.grid); };

  var sheets = {};
  var events = [];
  var mail = [];
  var eventSeq = 0;
  var calendar = null;

  function activeSheet(name) { return sheets[name] || null; }

  var spreadsheet = {
    getId: function () { return 'demo-sheet'; },
    getUrl: function () { return 'about:blank#demo-sheet'; },
    getName: function () { return 'PolyClinic — عرض تجريبي'; },
    getSheetByName: activeSheet,
    insertSheet: function (name) {
      var sh = new FakeSheet(name);
      sheets[name] = sh;
      return sh;
    },
    getSheets: function () { return Object.keys(sheets).map(function (k) { return sheets[k]; }); }
  };

  /* ------------------------------------------------------------------ *
   * Fake calendar
   * ------------------------------------------------------------------ */

  function makeEvent(title, start, end, opts) {
    eventSeq++;
    var ev = {
      id: 'evt-' + eventSeq,
      title: title,
      start: start,
      end: end,
      color: (opts && opts.color) || 'teal',
      description: (opts && opts.description) || '',
      location: (opts && opts.location) || ''
    };
    return {
      getId: function () { return ev.id; },
      getTitle: function () { return ev.title; },
      setTitle: function (t) { ev.title = t; },
      setTime: function (s, e) { ev.start = s; ev.end = e; },
      setColor: function (c) { ev.color = c; },
      deleteEvent: function () {
        for (var i = 0; i < events.length; i++) if (events[i].id === ev.id) { events.splice(i, 1); return; }
      },
      getStartTime: function () { return ev.start; },
      getEndTime: function () { return ev.end; },
      _demo: ev
    };
  }

  var CalendarApp = {
    Color: {
      RED: 'red', ORANGE: 'orange', YELLOW: 'yellow', GREEN: 'green',
      TEAL: 'teal', BLUE: 'blue', PURPLE: 'purple', GRAY: 'gray'
    },
    getCalendarById: function (id) {
      return calendar && calendar.id === id ? calendar : null;
    },
    createCalendar: function (name) {
      calendar = buildCalendar(name);
      return calendar;
    },
    getEventById: function (id) {
      for (var i = 0; i < events.length; i++) {
        if (events[i].id !== id) continue;
        var e = events[i];
        return {
          getTitle: function () { return e.title; },
          setTitle: function (t) { e.title = t; },
          setTime: function (s, en) { e.start = s; e.end = en; },
          setColor: function (c) { e.color = c; },
          deleteEvent: function () { events.splice(events.indexOf(e), 1); },
          getStartTime: function () { return e.start; },
          getEndTime: function () { return e.end; }
        };
      }
      return null;
    }
  };

  /** Also used when restoring a persisted world, so booking keeps working. */
  function buildCalendar(name) {
    return {
      id: 'demo-calendar',
      getName: function () { return name; },
      getId: function () { return 'demo-calendar'; },
      createEvent: function (title, start, end, opts) {
        var ev = makeEvent(title, start, end, opts);
        events.push(ev._demo);
        return ev;
      },
      getEvents: function () {
        return events.map(function (e) {
          return {
            getTitle: function () { return e.title; },
            getId: function () { return e.id; },
            getStartTime: function () { return e.start; },
            getEndTime: function () { return e.end; }
          };
        });
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * The other Google services the server code touches
   * ------------------------------------------------------------------ */

  window.SpreadsheetApp = {
    getActiveSpreadsheet: function () { return spreadsheet; },
    create: function (name) {
      var one = new FakeSheet('Sheet1');
      return {
        getId: function () { return 'demo-temp'; },
        getUrl: function () { return 'about:blank#export'; },
        getSheets: function () { return [one]; },
        getSheetByName: function (n) { return n === 'Sheet1' ? one : null; },
        insertSheet: function () { return one; }
      };
    }
  };
  window.CalendarApp = CalendarApp;
  window.LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } };
  window.MailApp = { sendEmail: function (msg) { mail.push(msg); } };
  window.DriveApp = {
    createFolder: function (name) { return { getId: function () { return 'demo-folder'; }, getName: function () { return name; } }; },
    createFile: function () { return { getUrl: function () { return 'about:blank#drive'; } }; },
    getFolderById: function () {
      return {
        createFile: function () { return { getUrl: function () { return 'about:blank#drive'; } }; },
        getFilesByName: function () { return { hasNext: function () { return true; } }; }
      };
    },
    getFileById: function () { return { makeCopy: function () { return { getUrl: function () { return 'about:blank#master'; }, getName: function () { return 'PolyClinic-MASTER-demo'; } }; }, setTrashed: function () {} }; }
  };
  window.ScriptApp = {
    getOAuthToken: function () { return 'demo'; },
    getService: function () { return { getUrl: function () { return 'demo://export'; } }; },
    getProjectTriggers: function () { return []; },
    deleteTrigger: function () {},
    newTrigger: function () { return { timeBased: function () { return { atHour: function () { return { everyDays: function () { return { create: function () {} }; } }; }, onWeekDay: function () { return { atHour: function () { return { create: function () {} }; } }; } }; } }; }
  };
  window.UrlFetchApp = { fetch: function () { return { getBlob: function () { return { setName: function () { return {}; } }; } }; } };
  window.PropertiesService = {
    getScriptProperties: function () {
      var store = {};
      return { getProperty: function (k) { return store[k] || null; }, setProperty: function (k, v) { store[k] = v; } };
    }
  };
  window.Logger = { log: function () { /* quiet in the demo */ } };
  window.Utilities = { getUuid: function () { return 'demo-' + Math.random().toString(36).slice(2); } };

  /* ------------------------------------------------------------------ *
   * The real server code
   * ------------------------------------------------------------------ */

  var SERVER = (function () {
/*__SERVER_SOURCE__*/
    return {
      HEADERS: HEADERS, SHEET: SHEET, STATUS: STATUS, SETTING: SETTING,
      SETTING_DEFAULTS: SETTING_DEFAULTS, WA_TEMPLATES: WA_TEMPLATES,
      Db: Db,
      createAllSheets: createAllSheets,
      seedPlaceholders: seedPlaceholders,
      ensureSharedCalendar: ensureSharedCalendar,
      invalidateSettingsCache: invalidateSettingsCache,
      getSettings: getSettings,
      setSetting: setSetting,
      setSetting: setSetting,
      generateSlots: generateSlots,
      getBootstrap: getBootstrap,
      submitBooking: submitBooking,
      getStaffBoard: getStaffBoard,
      setBookingStatus: setBookingStatus,
      rescheduleBooking: rescheduleBooking,
      blockTime: blockTime,
      lookupPatient: lookupPatient,
      getStaffSlots: getStaffSlots,
      getStaffCatalog: getStaffCatalog,
      markWhatsAppSent: markWhatsAppSent,
      kpiSummary: kpiSummary,
      reportRows: reportRows,
      filterBookings: filterBookings,
      exportCsv: exportCsv,
      // The settings page runs exactly the same admin API as live.
      adminMigrateSchema: adminMigrateSchema,
      adminLogin: adminLogin,
      adminBootstrap: adminBootstrap,
      adminGet: adminGet,
      adminSave: adminSave,
      adminDelete: adminDelete,
      adminReorder: adminReorder,
      adminSetDoctorPin: adminSetDoctorPin,
      adminChangePin: adminChangePin,
      adminBackup: adminBackup,
      // Naming and scope: the same functions the live export uses, so an offline demo
      // file and a live Drive file are named identically.
      REPORT_HEADER_AR: REPORT_HEADER_AR,
      exportBaseName: exportBaseName,
      exportScopeSlug: exportScopeSlug,
      scopeLabelAr: scopeLabelAr,
      // The production API surface itself, from Code.gs — same names, same
      // signatures, same validation. The demo calls exactly what the web app calls.
      apiBootstrap: apiBootstrap,
      apiSlots: apiSlots,
      apiSubmit: apiSubmit,
      apiStaffBoard: apiStaffBoard,
      apiStaffStatus: apiStaffStatus,
      apiStaffReschedule: apiStaffReschedule,
      apiStaffBlock: apiStaffBlock,
      apiStaffLookup: apiStaffLookup,
      apiStaffSlots: apiStaffSlots,
      apiStaffCatalog: apiStaffCatalog,
      apiStaffWaMark: apiStaffWaMark,
      apiStaffKpis: apiStaffKpis
    };
  })();

  /* ------------------------------------------------------------------ *
   * Persistence of the fake world
   * ------------------------------------------------------------------ */

  function serialize() {
    var plain = {};
    Object.keys(sheets).forEach(function (name) {
      var sh = sheets[name];
      var rows = [];
      for (var r = 0; r < sh.grid.length; r++) rows.push(sh.grid[r].slice());
      plain[name] = rows;
    });
    return {
      mockNow: mockNow,
      savedAt: RealDate.now(),
      sheets: plain,
      events: events.map(function (e) {
        return {
          id: e.id, title: e.title, color: e.color, description: e.description, location: e.location,
          start: new RealDate(e.start.getTime()).toISOString(),
          end: new RealDate(e.end.getTime()).toISOString()
        };
      })
    };
  }

  function save() { writeRaw(STORE_KEY, JSON.stringify(serialize())); }

  function restore(saved) {
    Object.keys(saved.sheets).forEach(function (name) {
      sheets[name] = new FakeSheet(name, saved.sheets[name]);
    });
    events = (saved.events || []).map(function (e) {
      eventSeq++;
      return {
        id: e.id || 'evt-' + eventSeq,
        title: e.title, color: e.color, description: e.description, location: e.location,
        start: new RealDate(e.start),
        end: new RealDate(e.end)
      };
    });
    calendar = buildCalendar('demo');
  }

  function bootstrapDemo() {
    var mode = 'seeded';
    if (persisted && persisted.sheets && Object.keys(persisted.sheets).length) {
      restore(persisted);
      // An older demo may predate the Access sheet or the new sort columns.
      SERVER.createAllSheets();
      mode = 'restored';
    } else {
      SERVER.createAllSheets();
      SERVER.seedPlaceholders();
      SERVER.ensureSharedCalendar();
    }
    // Applied on both paths: a browser that kept yesterday's demo data must still get
    // today's demo data, or the presenter sees a half-configured board.
    applyDemoData();
    save();
    return mode;
  }

  /**
   * Demo data only — every line here is something the real clinic would set in its
   * own sheets. Nothing here changes a product rule.
   */
  function applyDemoData() {
    // The seeded reasons ask for 4–24 hours' notice, which would hide the pinned
    // "today" and leave the reception board empty on stage. Zeroing the notice keeps
    // the real engine and the real lead-time check intact.
    SERVER.Db.rows(SERVER.SHEET.REASONS).forEach(function (reason) {
      SERVER.Db.update(SERVER.SHEET.REASONS, 'reason_id', reason.reason_id, { lead_hours: 0 });
    });

    // Real-looking initials, because the placeholder names are Arabic brackets and
    // would both derive to "aa". Makes the confirmation read ae-20261018-1.
    SERVER.Db.update(SERVER.SHEET.DOCTORS, 'doctor_id', 'D1', { code: 'ae' });
    SERVER.Db.update(SERVER.SHEET.DOCTORS, 'doctor_id', 'D2', { code: 'ms' });

    // The placeholder clinic works Dr. 1 on Sun/Wed and Dr. 2 on Mon/Tue, so no single
    // day ever showed two doctors and the reception's per-doctor filter had nothing to
    // filter. A Sunday afternoon window for Dr. 2 gives the shared schedule two columns.
    var hasA8 = SERVER.Db.rows(SERVER.SHEET.AVAILABILITY).some(function (a) {
      return String(a.availability_id || '').trim() === 'A8';
    });
    if (!hasA8) {
      SERVER.Db.append(SERVER.SHEET.AVAILABILITY, {
        availability_id: 'A8', doctor_id: 'D2', clinic_id: 'C1', reason_id: 'R2',
        weekday: 0, from_time: '14:00', to_time: '17:00', slot_min: 30,
        max_per_day_override: 8, valid_from: '', valid_to: '', active: 'TRUE'
      });
    }

    SERVER.setSetting(SERVER.SETTING.STAFF_CODE, STAFF_CODE);
    SERVER.setSetting(SERVER.SETTING.ADMIN_CODE, ADMIN_CODE);
    try {
      SERVER.adminSetDoctorPin(ADMIN_CODE, 'D1', '123456');
    } catch (adminErr) {
      window.console && window.console.warn('demo doctor PIN seed skipped', adminErr);
    }
    SERVER.setSetting(SERVER.SETTING.REPORT_EMAIL, 'demo@polyclinic.example');
    SERVER.setSetting(SERVER.SETTING.WHATSAPP_NUMBER, '+201000000000');
    SERVER.setSetting(SERVER.SETTING.SUPPORT_PHONE, '0220000000');
    SERVER.invalidateSettingsCache();
  }

  var bootMode = bootstrapDemo();

  /* ------------------------------------------------------------------ *
   * google.script.run shim
   * ------------------------------------------------------------------ */

  function makeRunner() {
    var onSuccess = function () {};
    var onFailure = function (err) { window.console && window.console.error(err); };

    var proxy = null;

    // Note: the handler functions must return the *proxy*, not the target, or the
    // chained call google.script.run.withSuccessHandler(cb).withFailureHandler(cb)[fn]
    // would fall through to an object with no server functions on it.
    var handler = {
      get: function (target, prop) {
        if (prop === 'withSuccessHandler') {
          return function (cb) { onSuccess = cb; return proxy; };
        }
        if (prop === 'withFailureHandler') {
          return function (cb) { onFailure = cb; return proxy; };
        }
        if (typeof prop !== 'string') return undefined;
        return function () {
          var args = Array.prototype.slice.call(arguments);
          setTimeout(function () {
            try {
              if (typeof SERVER[prop] !== 'function') throw new Error('لا توجد دالة باسم ' + prop);
              var result = SERVER[prop].apply(SERVER, args);
              save();
              onSuccess(result);
            } catch (err) {
              onFailure(err);
            }
          }, 120);
        };
      }
    };

    proxy = new Proxy({}, handler);
    return proxy;
  }

  // google.script.run must hand out a *fresh* chain per access, exactly like Apps
  // Script does. If the handlers were shared, two calls in flight at once (the
  // reception board loads bookings and the catalogue together) would overwrite each
  // other's callbacks and one promise would never settle.
  window.google = { script: {} };
  Object.defineProperty(window.google.script, 'run', {
    get: function () { return makeRunner(); },
    configurable: true
  });

  /* ------------------------------------------------------------------ *
   * Exports: the reception screen opens ?page=export; the demo turns that
   * into a real CSV download so the flow is visible without Drive.
   * ------------------------------------------------------------------ */

  window.POLYCLINIC_DEMO = {
    page: PAGE,
    bootMode: bootMode,
    staffCode: STAFF_CODE,
    storeKey: STORE_KEY,
    mockNow: mockNow,
    mockNowLabel: mockNowLabel,
    reset: function () { dropRaw(STORE_KEY); dropRaw('polyclinic_staff_code'); window.location.reload(); },
    events: function () { return events.map(function (e) { return e; }); },
    save: save
  };

  var realOpen = window.open;
  window.open = function (url, name, features) {
    if (typeof url === 'string' && url.indexOf('page=export') !== -1) {
      demoDownload(url);
      return null;
    }
    return realOpen.call(window, url, name, features);
  };

  function demoDownload(url) {
    var query = url.split('?')[1] || '';
    var params = {};
    query.split('&').forEach(function (pair) {
      var p = pair.split('=');
      params[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
    });
    var filters = {
      from: params.from, to: params.to,
      doctorId: params.doctor, clinicId: params.clinic,
      reasonId: params.reason, status: params.status
    };
    var base = SERVER.exportBaseName(filters);
    var scope = SERVER.scopeLabelAr(filters);

    // The real thing: a genuine .xlsx built in the browser. Live, Drive converts a
    // temporary Sheet; offline there is no Drive, so tools/xlsx-writer.js writes the
    // same five OOXML parts Excel expects. Same name, same columns, same filter.
    if (params.type !== 'csv' && window.POLYCLINIC_XLSX) {
      var rows = [SERVER.REPORT_HEADER_AR].concat(SERVER.reportRows(filters));
      saveBlobFile(
        new Blob([window.POLYCLINIC_XLSX.build(rows, 'Bookings')],
          { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        base + '.xlsx'
      );
      demoToast('تم إنشاء ملف Excel — ' + (rows.length - 1) + ' حجز (' + scope + ')');
      return;
    }

    saveBlobFile(new Blob([SERVER.exportCsv(filters)], { type: 'text/csv;charset=utf-8;' }), base + '.csv');
    demoToast('تم إنشاء ملف CSV — ' + scope);
  }

  function saveBlobFile(blob, fileName) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function demoToast(message) {
    var t = document.getElementById('toast');
    if (t) { t.textContent = message; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 4000); }
    else window.console.log(message);
  }

  function refreshCalendarHint() { /* index.html reads storage directly */ }

  /* ------------------------------------------------------------------ *
   * The demo strip, so nobody mistakes this for the live system
   * ------------------------------------------------------------------ */

  function injectStrip() {
    var style = document.createElement('style');
    style.textContent =
      '#demo-strip{position:fixed;bottom:0;right:0;left:0;background:#101828;color:#fff;font:13px/1.6 "Segoe UI",Tahoma,Arial;' +
      'padding:7px 14px;z-index:99;display:flex;gap:14px;align-items:center;justify-content:space-between;direction:rtl}' +
      '#demo-strip b{color:#7dd3c0}' +
      '#demo-strip button{background:#7dd3c0;border:0;border-radius:7px;padding:4px 10px;font:inherit;cursor:pointer;color:#04312b}' +
      '#demo-strip .d{margin-left:auto}' +
      'body{padding-bottom:46px}';
    document.head.appendChild(style);

    var strip = document.createElement('div');
    strip.id = 'demo-strip';
    strip.innerHTML =
      '<span>عرض تجريبي — البيانات وهمية. ساعة العرض: <b>' + mockNowLabel() + '</b></span>' +
      (PAGE === 'reception' ? '<span>كود الاستقبال: <b>' + STAFF_CODE + '</b></span>' : '') +
      '<span class="d"><button onclick="window.POLYCLINIC_DEMO.reset()">إعادة تعيين البيانات</button></span>';
    document.body.appendChild(strip);
  }

  /* ------------------------------------------------------------------ *
   * Reception: skip the code gate, this is a demo
   * ------------------------------------------------------------------ */

  if (PAGE === 'reception') {
    if (!readRaw('polyclinic_staff_code')) writeRaw('polyclinic_staff_code', STAFF_CODE);
  }

  if (document.body) injectStrip();
  else document.addEventListener('DOMContentLoaded', injectStrip);

  // Let the launcher know the world is ready.
  writeRaw('polyclinic_demo_ready', String(RealDate.now()));
})();
