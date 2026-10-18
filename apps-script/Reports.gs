/**
 * Reports.gs — the doctor's data questions, answered from the Bookings sheet.
 *
 * Three outputs:
 *   - buildReportsSheets(): in-spreadsheet report tabs the clinic can pivot themselves
 *   - exportCsv(): a UTF-8 CSV that Excel opens correctly in Arabic
 *   - exportXlsx(): a real .xlsx produced through Drive's export endpoint
 *
 * Every output takes the same filter object and can be narrowed to one doctor, any
 * handful of them (for comparison) or all of them — see doctorIdList().
 */

const REPORT_HEADER_AR = [
  'رقم الحجز', 'تاريخ الحجز', 'الفرع', 'الطبيب', 'سبب الزيارة',
  'تاريخ الموعد', 'اليوم', 'الوقت', 'الاسم', 'الجوال',
  'الحالة', 'آخر تحديث', 'تم التواصل واتساب', 'قالب الرسالة',
  'ملاحظة الطاقم', 'مصدر الحجز'
];

/**
 * The doctor filter, in every shape the callers use:
 *   ''            → all doctors
 *   'D1'          → one doctor
 *   'D1,D2,D3'    → several (what the export URL and the staff panel send)
 *   ['D1','D2']   → the same, from a JSON payload or a test
 * An empty array means "all doctors", never "none" — that is the safer default.
 */
function doctorIdList(value) {
  if (Object.prototype.toString.call(value) === '[object Array]') {
    return value.map(function (v) { return str(v); }).filter(function (v) { return !!v; });
  }
  return str(value).split(',').map(function (v) { return str(v); }).filter(function (v) { return !!v; });
}

/** Read the doctor selection whichever name the caller used. */
function doctorFilterValue(filters) {
  if (!filters) return '';
  return filters.doctorIds !== undefined ? filters.doctorIds : filters.doctorId;
}

function filterBookings(filters) {
  filters = filters || {};
  const from = str(filters.from);
  const to = str(filters.to);
  const doctorIds = doctorIdList(doctorFilterValue(filters));
  const clinicId = str(filters.clinicId);
  const reasonId = str(filters.reasonId);
  const status = str(filters.status);

  return Db.rows(SHEET.BOOKINGS).filter(function (b) {
    const d = str(b.date);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (doctorIds.length && doctorIds.indexOf(str(b.doctor_id)) === -1) return false;
    if (clinicId && str(b.clinic_id) !== clinicId) return false;
    if (reasonId && str(b.reason_id) !== reasonId) return false;
    if (status && str(b.status) !== status) return false;
    return true;
  }).sort(function (a, b) {
    return (str(a.date) + str(a.start_time)).localeCompare(str(b.date) + str(b.start_time));
  });
}

function reportRows(filters) {
  filters = filters || {};
  const doctorIds = doctorIdList(doctorFilterValue(filters));
  const doctors = indexBy(Db.rows(SHEET.DOCTORS), 'doctor_id');
  const clinics = indexBy(Db.rows(SHEET.CLINICS), 'clinic_id');
  const reasons = indexBy(Db.rows(SHEET.REASONS), 'reason_id');

  const bookings = filterBookings(filters);
  // A file with several doctors in it is a comparison, so group it by doctor instead of
  // interleaving everyone by date. Within one doctor the date order is unchanged.
  if (doctorIds.length > 1) {
    bookings.sort(function (a, b) {
      return (str(a.doctor_id) + str(a.date) + str(a.start_time))
        .localeCompare(str(b.doctor_id) + str(b.date) + str(b.start_time));
    });
  }

  return bookings.map(function (b) {
    const date = str(b.date);
    const startMin = parseTimeToMin(b.start_time);
    return [
      str(b.booking_id),
      str(b.created_at),
      nameOf(clinics, str(b.clinic_id), 'name_ar'),
      nameOf(doctors, str(b.doctor_id), 'name_ar'),
      nameOf(reasons, str(b.reason_id), 'name_ar'),
      date,
      weekdayAr(date),
      startMin === null ? str(b.start_time) : minToTimeAr(startMin),
      str(b.name),
      str(b.phone_norm),
      statusLabelAr(str(b.status)),
      str(b.status_at),
      str(b.wa_sent_at),
      waTemplateLabelAr(b.wa_template),
      str(b.staff_note),
      str(b.source)
    ];
  });
}

function indexBy(rows, field) {
  const out = {};
  rows.forEach(function (r) { out[str(r[field])] = r; });
  return out;
}

function nameOf(index, id, field) {
  return index[id] ? str(index[id][field]) : id;
}

/** The doctors a filter selects, as Arabic names — for a KPI header or a screen label. */
function scopeLabelAr(filters) {
  const ids = doctorIdList(doctorFilterValue(filters));
  if (!ids.length) return 'كل الأطباء';
  const doctors = indexBy(Db.rows(SHEET.DOCTORS), 'doctor_id');
  return ids.map(function (id) { return nameOf(doctors, id, 'name_ar'); }).join(' + ');
}

/** Filesystem-friendly text: no spaces, no characters Windows or Drive dislike. */
function fileSafeAr(text) {
  return str(text).replace(/\s+/g, '-').replace(/[\\\/:*?"<>|]/g, '').replace(/-+/g, '-').slice(0, 60);
}

/** Part of the file name that says who is in the file: one name, a count, or all. */
function exportScopeSlug(filters) {
  const ids = doctorIdList(doctorFilterValue(filters));
  if (!ids.length) return 'كل-الأطباء';
  if (ids.length === 1) {
    const doctors = indexBy(Db.rows(SHEET.DOCTORS), 'doctor_id');
    return fileSafeAr(nameOf(doctors, ids[0], 'name_ar'));
  }
  return 'مقارنة-' + ids.length + '-أطباء';
}

/**
 * 'تقرير-الحجوزات-د.-أحمد-سمير-2026-10-17-1430' (no extension).
 * One place builds the name so every export path — Drive, CSV in the browser, the
 * offline demo — produces a file the clinic can tell apart from the next one.
 */
function exportBaseName(filters, label) {
  const now = new Date();
  const stamp = formatDateStr(now) + '-' + pad2(now.getHours()) + pad2(now.getMinutes());
  return fileSafeAr(label || 'تقرير-الحجوزات') + '-' + exportScopeSlug(filters) + '-' + stamp;
}

/**
 * KPIs the doctor will actually ask about at the end of month one.
 * `extra` accepts the same filters as the exports, so the numbers on screen match the
 * numbers in the file the clinic just downloaded.
 */
function kpiSummary(from, to, extra) {
  extra = extra || {};
  const filters = {
    from: str(from) || str(extra.from),
    to: str(to) || str(extra.to),
    doctorId: extra.doctorId,
    doctorIds: extra.doctorIds,
    clinicId: extra.clinicId,
    reasonId: extra.reasonId,
    status: extra.status
  };
  const rows = filterBookings(filters);
  const started = rows.filter(function (r) { return OCCUPYING_STATUSES.indexOf(str(r.status)) !== -1; });
  const attended = rows.filter(function (r) { return str(r.status) === STATUS.ATTENDED; });
  const noShow = rows.filter(function (r) { return str(r.status) === STATUS.NO_SHOW; });
  const cancelled = rows.filter(function (r) { return str(r.status) === STATUS.CANCELLED; });
  const rescheduled = rows.filter(function (r) { return str(r.status) === STATUS.RESCHEDULED; });

  const finished = attended.length + noShow.length;
  const phoneCounts = {};
  rows.forEach(function (r) {
    const p = str(r.phone_norm);
    if (!p) return;
    phoneCounts[p] = (phoneCounts[p] || 0) + 1;
  });
  const phones = Object.keys(phoneCounts);
  const repeat = phones.filter(function (p) { return phoneCounts[p] > 1; }).length;

  return {
    from: filters.from, to: filters.to,
    scopeLabelAr: scopeLabelAr(filters),
    doctorIds: doctorIdList(doctorFilterValue(filters)),
    totalBookings: rows.length,
    activeBookings: started.length,
    attended: attended.length,
    noShow: noShow.length,
    cancelled: cancelled.length,
    rescheduled: rescheduled.length,
    noShowRate: finished ? Math.round((noShow.length / finished) * 1000) / 10 : 0,
    uniquePatients: phones.length,
    repeatPatients: repeat,
    repeatRate: phones.length ? Math.round((repeat / phones.length) * 1000) / 10 : 0,
    byDoctor: groupCount(rows, 'doctor_id', 'name_ar', 'doctor_id'),
    byClinic: groupCount(rows, 'clinic_id', 'name_ar', 'clinic_id'),
    byReason: groupCount(rows, 'reason_id', 'name_ar', 'reason_id'),
    byHour: hourHistogram(rows),
    topPatients: topPatients(phoneCounts, rows)
  };
}

function groupCount(rows, idField, labelField, sourceSheetIdField) {
  const labels = {};
  const sheet = sourceSheetIdField === 'doctor_id' ? SHEET.DOCTORS
    : sourceSheetIdField === 'clinic_id' ? SHEET.CLINICS : SHEET.REASONS;
  const idFieldInSheet = sourceSheetIdField;
  Db.rows(sheet).forEach(function (r) { labels[str(r[idFieldInSheet])] = str(r[labelField]); });

  const counts = {};
  rows.forEach(function (r) {
    const k = str(r[idField]);
    counts[k] = (counts[k] || 0) + 1;
  });
  return Object.keys(counts).map(function (k) {
    return { id: k, labelAr: labels[k] || k, count: counts[k] };
  }).sort(function (a, b) { return b.count - a.count; });
}

function hourHistogram(rows) {
  const counts = {};
  rows.forEach(function (r) {
    const min = parseTimeToMin(r.start_time);
    if (min === null) return;
    const hour = Math.floor(min / 60);
    counts[hour] = (counts[hour] || 0) + 1;
  });
  return Object.keys(counts).map(function (h) {
    return { hour: Number(h), labelAr: minToTimeAr(Number(h) * 60), count: counts[h] };
  }).sort(function (a, b) { return a.hour - b.hour; });
}

function topPatients(phoneCounts, rows) {
  const names = {};
  rows.forEach(function (r) {
    const p = str(r.phone_norm);
    if (p && str(r.name) && !names[p]) names[p] = str(r.name);
  });
  return Object.keys(phoneCounts).map(function (p) {
    return { phone: p, name: names[p] || '', count: phoneCounts[p] };
  }).sort(function (a, b) { return b.count - a.count; }).slice(0, 20);
}

/** Rebuild the in-spreadsheet report tabs. Called from the menu. */
function buildReportsSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = reportRows({});
  writeTab(ss, 'Report_Data', REPORT_HEADER_AR, data);

  const kpi = kpiSummary('', '');
  const kpiRows = [
    ['الفترة', (kpi.from || 'البداية') + ' → ' + (kpi.to || 'النهاية')],
    ['النطاق', kpi.scopeLabelAr],
    ['إجمالي الحجوزات', kpi.totalBookings],
    ['حجوزات قائمة', kpi.activeBookings],
    ['حضر', kpi.attended],
    ['لم يحضر', kpi.noShow],
    ['ملغي', kpi.cancelled],
    ['تم تغييره', kpi.rescheduled],
    ['نسبة عدم الحضور %', kpi.noShowRate],
    ['مرضى مختلفون', kpi.uniquePatients],
    ['مرضى مكررون', kpi.repeatPatients],
    ['نسبة التكرار %', kpi.repeatRate],
    ['', ''],
    ['الطبيب', 'عدد الحجوزات']
  ].concat(kpi.byDoctor.map(function (d) { return [d.labelAr, d.count]; }))
    .concat([['', ''], ['الفرع', 'عدد الحجوزات']])
    .concat(kpi.byClinic.map(function (d) { return [d.labelAr, d.count]; }))
    .concat([['', ''], ['سبب الزيارة', 'عدد الحجوزات']])
    .concat(kpi.byReason.map(function (d) { return [d.labelAr, d.count]; }))
    .concat([['', ''], ['الساعة', 'عدد الحجوزات']])
    .concat(kpi.byHour.map(function (h) { return [h.labelAr, h.count]; }));

  writeTab(ss, 'Report_KPIs', ['البند', 'القيمة'], kpiRows);
  logInfo('buildReportsSheets', 'Rebuilt report tabs with ' + data.length + ' rows');
  return { ok: true, rows: data.length, kpis: kpi };
}

function writeTab(ss, name, header, rows) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clear();
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, header.length).setValues(rows);
    sh.autoResizeColumns(1, header.length);
  }
  return sh;
}

function exportCsv(filters) {
  const rows = reportRows(filters);
  return csvFromRows(REPORT_HEADER_AR, rows);
}

/**
 * A genuine .xlsx, via the temp-sheet + Drive export trick. Returns a Drive link
 * because ContentService cannot stream binary downloads. `label` overrides the
 * leading part of the file name (the nightly backup does); the selected doctors and
 * the timestamp are always appended, so two exports never collide.
 */
function exportXlsx(filters, label) {
  const rows = reportRows(filters);
  const name = exportBaseName(filters, label);

  const temp = SpreadsheetApp.create(name + ' (temp)');
  const header = REPORT_HEADER_AR;
  const sh = temp.getSheets()[0];
  sh.setName('Bookings');
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, header.length).setValues(rows);

  let link = '';
  try {
    const url = 'https://www.googleapis.com/drive/v3/files/' + temp.getId() +
      '/export?mimeType=' + encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') +
      '&alt=media';
    const response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    const blob = response.getBlob().setName(name + '.xlsx');
    const folderId = str(getSettings()[SETTING.BACKUP_FOLDER_ID]);
    const file = folderId
      ? DriveApp.getFolderById(folderId).createFile(blob)
      : DriveApp.createFile(blob);
    link = file.getUrl();
  } catch (err) {
    logError('exportXlsx', 'Drive export failed, falling back to a Google Sheet: ' + err);
    link = temp.getUrl();
  }

  try {
    DriveApp.getFileById(temp.getId()).setTrashed(true);
  } catch (err) {
    logWarn('exportXlsx', 'Could not trash the temp sheet: ' + err);
  }

  logInfo('exportXlsx', 'Exported ' + rows.length + ' rows to ' + link);
  return { ok: true, rows: rows.length, url: link, fileName: name + '.xlsx' };
}
