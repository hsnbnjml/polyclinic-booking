/**
 * Setup.gs — one-time provisioning and the spreadsheet menu.
 *
 * Run setupEverything() once, from the Apps Script editor. It is safe to re-run:
 * existing sheets and existing config rows are never overwritten.
 */

/**
 * Creates any missing sheet, writes its header row, and forces plain-text
 * formatting so 'yyyy-MM-dd' and 'HH:mm' can never be reinterpreted by Sheets.
 */
function createAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const created = [];
  Object.keys(HEADERS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      created.push(name);
    }
    const header = HEADERS[name];
    const current = sh.getLastRow() >= 1 && sh.getLastColumn() >= 1
      ? sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String)
      : [];
    const matches = current.length === header.length && header.every(function (h, i) { return current[i] === h; });
    if (!matches) {
      sh.getRange(1, 1, 1, header.length).setValues([header]);
    }
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), header.length).setNumberFormat('@');
    sh.setFrozenRows(1);
    if (name !== SHEET.SETTINGS) sh.setColumnWidth(1, 150);
  });
  invalidateSettingsCache();
  logInfo('createAllSheets', 'Created: ' + (created.join(', ') || 'none') + ' | verified: ' + Object.keys(HEADERS).length);
  return { ok: true, created: created };
}

/** Seeds placeholder config so the app is walkable before the clinic's real data arrives. */
function seedPlaceholders() {
  const blocked = Db.rows(SHEET.CLINICS).length || Db.rows(SHEET.DOCTORS).length ||
    Db.rows(SHEET.REASONS).length || Db.rows(SHEET.AVAILABILITY).length;
  if (blocked) {
    logInfo('seedPlaceholders', 'Config already present, skipping seed');
    return { ok: true, seeded: false, reason: 'CONFIG_EXISTS' };
  }

  Db.appendMany(SHEET.CLINICS, [
    { clinic_id: 'C1', name_ar: '[اسم الفرع الأول]', address_ar: '[العنوان الأول]', map_link: 'https://maps.google.com/?q=[رابط الخريطة]', phone: '[هاتف الفرع]', working_hours_ar: 'يومياً 9:00 ص – 9:00 م', active: 'TRUE' },
    { clinic_id: 'C2', name_ar: '[اسم الفرع الثاني]', address_ar: '[العنوان الثاني]', map_link: 'https://maps.google.com/?q=[رابط الخريطة]', phone: '[هاتف الفرع]', working_hours_ar: 'يومياً 10:00 ص – 6:00 م', active: 'FALSE' }
  ]);

  Db.appendMany(SHEET.DOCTORS, [
    { doctor_id: 'D1', name_ar: 'د. [الطبيب الأول]', specialty_ar: '[التخصص]', clinic_ids: 'C1,C2', color: 'teal', active: 'TRUE' },
    { doctor_id: 'D2', name_ar: 'د. [الطبيب الثاني]', specialty_ar: '[التخصص]', clinic_ids: 'C1', color: 'blue', active: 'TRUE' },
    { doctor_id: 'D3', name_ar: 'د. [الطبيب الثالث]', specialty_ar: '[التخصص]', clinic_ids: 'C1', color: 'purple', active: 'FALSE' }
  ]);

  Db.appendMany(SHEET.REASONS, [
    { reason_id: 'R1', name_ar: 'فحص أولي', description_ar: 'زيارة أولى للفحص والتشخيص', duration_min: 45, lead_hours: 12, book_days_ahead: 21, max_per_day: 10, active: 'TRUE', sort_order: 1 },
    { reason_id: 'R2', name_ar: 'استشارة', description_ar: 'استشارة طبية عامة', duration_min: 30, lead_hours: 4, book_days_ahead: 14, max_per_day: 12, active: 'TRUE', sort_order: 2 },
    { reason_id: 'R3', name_ar: 'متابعة', description_ar: 'متابعة بعد زيارة سابقة', duration_min: 15, lead_hours: 4, book_days_ahead: 14, max_per_day: 16, active: 'TRUE', sort_order: 3 },
    { reason_id: 'R4', name_ar: 'إجراء / جلسة', description_ar: 'إجراء بسيط أو جلسة علاجية', duration_min: 30, lead_hours: 24, book_days_ahead: 30, max_per_day: 6, active: 'FALSE', sort_order: 4 }
  ]);

  // weekday: 0 = الأحد … 6 = السبت. The doctor's rule from the brief:
  // examinations on Sundays and Wednesdays, 9:00 to 16:00.
  Db.appendMany(SHEET.AVAILABILITY, [
    { availability_id: 'A1', doctor_id: 'D1', clinic_id: 'C1', reason_id: 'R1', weekday: 0, from_time: '09:00', to_time: '16:00', slot_min: 45, max_per_day_override: 8, valid_from: '', valid_to: '', active: 'TRUE' },
    { availability_id: 'A2', doctor_id: 'D1', clinic_id: 'C1', reason_id: 'R1', weekday: 3, from_time: '09:00', to_time: '16:00', slot_min: 45, max_per_day_override: 8, valid_from: '', valid_to: '', active: 'TRUE' },
    { availability_id: 'A3', doctor_id: 'D1', clinic_id: 'C1', reason_id: 'R3', weekday: 0, from_time: '16:00', to_time: '19:00', slot_min: 15, max_per_day_override: 12, valid_from: '', valid_to: '', active: 'TRUE' },
    { availability_id: 'A4', doctor_id: 'D1', clinic_id: 'C1', reason_id: 'R3', weekday: 3, from_time: '16:00', to_time: '19:00', slot_min: 15, max_per_day_override: 12, valid_from: '', valid_to: '', active: 'TRUE' },
    { availability_id: 'A5', doctor_id: 'D2', clinic_id: 'C1', reason_id: 'R2', weekday: 1, from_time: '10:00', to_time: '14:00', slot_min: 30, max_per_day_override: 8, valid_from: '', valid_to: '', active: 'TRUE' },
    { availability_id: 'A6', doctor_id: 'D2', clinic_id: 'C1', reason_id: 'R2', weekday: 2, from_time: '10:00', to_time: '14:00', slot_min: 30, max_per_day_override: 8, valid_from: '', valid_to: '', active: 'TRUE' },
    { availability_id: 'A7', doctor_id: 'D2', clinic_id: 'C1', reason_id: 'R3', weekday: 1, from_time: '14:00', to_time: '17:00', slot_min: 15, max_per_day_override: 12, valid_from: '', valid_to: '', active: 'TRUE' }
  ]);

  Db.appendMany(SHEET.BLACKOUTS, [
    { blackout_id: 'B1', date: addDaysStr(todayStr(), 30) + '..' + addDaysStr(todayStr(), 32), scope_type: 'all', scope_id: '', from_time: '', to_time: '', note: '[عطلة رسمية — مثال]' }
  ]);

  Object.keys(SETTING_DEFAULTS).forEach(function (key) {
    if (key === SETTING.CALENDAR_ID || key === SETTING.BACKUP_FOLDER_ID) return;
    Db.append(SHEET.SETTINGS, { key: key, value: SETTING_DEFAULTS[key], note: SETTING_NOTES[key] || '' });
  });

  invalidateSettingsCache();
  logInfo('seedPlaceholders', 'Seeded placeholder config');
  return { ok: true, seeded: true };
}

/** Creates the shared calendar and the backup folder if they do not exist yet. */
function ensureCalendarAndFolder() {
  const settings = getSettings();
  const cal = ensureSharedCalendar();

  let folderId = str(settings[SETTING.BACKUP_FOLDER_ID]);
  if (!folderId) {
    const folder = DriveApp.createFolder('PolyClinic Backups — ' + str(settings[SETTING.CLINIC_NAME]));
    folderId = folder.getId();
    setSetting(SETTING.BACKUP_FOLDER_ID, folderId);
  }

  // Safety net: the clinic account is a single point of failure. A weekly copy
  // of the whole spreadsheet lives in Drive regardless of what happens to it.
  try {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFilesByName('PolyClinic-MASTER-backup');
    if (!files.hasNext()) {
      DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).makeCopy('PolyClinic-MASTER-backup', folder);
    }
  } catch (err) {
    logWarn('ensureCalendarAndFolder', 'Initial master backup failed: ' + err);
  }

  return { ok: true, calendarId: cal.getId(), calendarName: cal.getName(), backupFolderId: folderId };
}

/** Runs on a schedule (see installTriggers). */
function installTriggers() {
  const handlers = ['jobDailyAgenda', 'jobSyncBlocks', 'jobWeeklyBackup'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('jobDailyAgenda').timeBased().atHour(7).everyDays(1).create();
  ScriptApp.newTrigger('jobSyncBlocks').timeBased().atHour(5).everyDays(1).create();
  ScriptApp.newTrigger('jobWeeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(22).create();

  logInfo('installTriggers', 'Installed daily agenda, nightly block sync, weekly backup');
  return { ok: true, triggers: ScriptApp.getProjectTriggers().length };
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  return { ok: true };
}

/** The full first-run sequence. */
function setupEverything() {
  const sheetResult = createAllSheets();
  const seedResult = seedPlaceholders();
  const infra = ensureCalendarAndFolder();
  const triggers = installTriggers();
  const check = checkConfiguration();
  const summary = {
    ok: true,
    sheetsCreated: sheetResult.created,
    seeded: seedResult.seeded,
    calendar: infra.calendarName,
    triggers: triggers.triggers,
    warnings: check.warnings,
    bookingUrl: getBookingUrl(),
    nextStepsAr: [
      'املأ أسماء الفروع والأطباء والأسباب في أوراق Clinics / Doctors / Reasons.',
      'اضبط المواعيد المتاحة في ورقة Availability (0 = الأحد … 6 = السبت).',
      'غيّر كود الاستقبال في ورقة Settings (staff_code).',
      'انشر التطبيق: Deploy → New deployment → Web app → Execute as me → Anyone.',
      'اختبر الحجز من رابط الحجز ثم افتح شاشة الاستقبال.'
    ]
  };
  logInfo('setupEverything', JSON.stringify({ sheets: summary.sheetsCreated, seeded: summary.seeded }));
  Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}

function getBookingUrl() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (err) {
    return '';
  }
}

/** What is still a placeholder, what is missing, what looks broken. */
function checkConfiguration() {
  const warnings = [];
  const settings = getSettings();

  Db.rows(SHEET.CLINICS).forEach(function (c) {
    if (str(c.name_ar).indexOf('[') !== -1) warnings.push('الفرع ' + str(c.clinic_id) + ': الاسم لم يُعدّل بعد (' + str(c.name_ar) + ')');
  });
  Db.rows(SHEET.DOCTORS).forEach(function (d) {
    if (str(d.name_ar).indexOf('[') !== -1) warnings.push('الطبيب ' + str(d.doctor_id) + ': الاسم لم يُعدّل بعد (' + str(d.name_ar) + ')');
  });
  if (str(settings[SETTING.STAFF_CODE]) === SETTING_DEFAULTS[SETTING.STAFF_CODE]) {
    warnings.push('كود الاستقبال ما زال الافتراضي — غيّره فوراً.');
  }
  if (!str(settings[SETTING.REPORT_EMAIL]).match(/@/)) {
    warnings.push('بريد التقارير غير مضبوط، لن تصل النسخ الاحتياطية.');
  }
  if (!Db.rows(SHEET.AVAILABILITY).filter(isActive).length) {
    warnings.push('لا توجد أي مواعيد متاحة — المرضى لن يجدوا أي وقت.');
  }

  const doctorIds = {};
  Db.rows(SHEET.DOCTORS).forEach(function (d) { doctorIds[str(d.doctor_id)] = true; });
  const clinicIds = {};
  Db.rows(SHEET.CLINICS).forEach(function (c) { clinicIds[str(c.clinic_id)] = true; });
  const reasonIds = {};
  Db.rows(SHEET.REASONS).forEach(function (r) { reasonIds[str(r.reason_id)] = true; });
  Db.rows(SHEET.AVAILABILITY).forEach(function (a) {
    if (!doctorIds[str(a.doctor_id)]) warnings.push('Availability ' + str(a.availability_id) + ': طبيب غير موجود (' + str(a.doctor_id) + ')');
    if (!clinicIds[str(a.clinic_id)]) warnings.push('Availability ' + str(a.availability_id) + ': فرع غير موجود (' + str(a.clinic_id) + ')');
    if (!reasonIds[str(a.reason_id)]) warnings.push('Availability ' + str(a.availability_id) + ': سبب زيارة غير موجود (' + str(a.reason_id) + ')');
    if (parseTimeToMin(a.from_time) === null || parseTimeToMin(a.to_time) === null) {
      warnings.push('Availability ' + str(a.availability_id) + ': وقت غير صالح، يجب أن يكون HH:mm');
    }
  });

  // Two doctors with the same code would produce the same booking reference,
  // which defeats the point of reading it back over the phone.
  const codeOwner = {};
  Db.rows(SHEET.DOCTORS).filter(isActive).forEach(function (d) {
    const code = doctorCode(d);
    if (codeOwner[code]) {
      warnings.push('الطبيب ' + str(d.doctor_id) + ': كود الحجز "' + code + '" مستخدم أيضاً للطبيب ' + codeOwner[code] +
        ' — اكتب كوداً مختلفاً (حرفان لاتينيان) في عمود code بورقة Doctors.');
    } else {
      codeOwner[code] = str(d.doctor_id);
    }
  });

  const result = { ok: warnings.length === 0, warnings: warnings, bookingUrl: getBookingUrl() };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('العيادة')
    .addItem('تهيئة النظام', 'menuSetup')
    .addItem('فحص الإعدادات', 'menuCheck')
    .addItem('تحديث أوراق التقارير', 'menuReports')
    .addItem('نسخة احتياطية الآن', 'menuBackup')
    .addItem('مزامنة أوقات الإيقاف', 'menuSyncBlocks')
    .addItem('عرض رابط الحجز', 'menuBookingUrl')
    .addToUi();
}

function menuSetup() { showAlert('تهيئة النظام', JSON.stringify(setupEverything(), null, 2)); }
function menuCheck() { showAlert('فحص الإعدادات', JSON.stringify(checkConfiguration(), null, 2)); }
function menuReports() { const r = buildReportsSheets(); showAlert('التقارير', 'تم تحديث الأوراق: ' + r.rows + ' صف'); }
function menuBackup() { showAlert('نسخة احتياطية', JSON.stringify(sendWeeklyBackup(), null, 2)); }
function menuSyncBlocks() { showAlert('مزامنة الإيقاف', 'تم إنشاء ' + syncBlockEvents() + ' سجل إيقاف من التقويم'); }
function menuBookingUrl() { showAlert('رابط الحجز', getBookingUrl() || 'انشر التطبيق أولاً (Deploy → Web app)'); }

function showAlert(title, text) {
  SpreadsheetApp.getUi().alert(title, String(text), SpreadsheetApp.getUi().ButtonSet.OK);
}
