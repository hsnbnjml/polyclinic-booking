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
    { clinic_id: 'C1', name_ar: '[اسم الفرع الأول]', address_ar: '[العنوان الأول]', map_link: 'https://maps.google.com/?q=[رابط الخريطة]', phone: '[هاتف الفرع]', working_hours_ar: 'يومياً 9:00 ص – 9:00 م', active: 'TRUE', sort_order: 1 },
    { clinic_id: 'C2', name_ar: '[اسم الفرع الثاني]', address_ar: '[العنوان الثاني]', map_link: 'https://maps.google.com/?q=[رابط الخريطة]', phone: '[هاتف الفرع]', working_hours_ar: 'يومياً 10:00 ص – 6:00 م', active: 'FALSE', sort_order: 2 }
  ]);

  Db.appendMany(SHEET.DOCTORS, [
    { doctor_id: 'D1', name_ar: 'د. [الطبيب الأول]', specialty_ar: '[التخصص]', clinic_ids: 'C1,C2', color: 'teal', active: 'TRUE', sort_order: 1, code: '' },
    { doctor_id: 'D2', name_ar: 'د. [الطبيب الثاني]', specialty_ar: '[التخصص]', clinic_ids: 'C1', color: 'blue', active: 'TRUE', sort_order: 2, code: '' },
    { doctor_id: 'D3', name_ar: 'د. [الطبيب الثالث]', specialty_ar: '[التخصص]', clinic_ids: 'C1', color: 'purple', active: 'FALSE', sort_order: 3, code: '' }
  ]);

  Db.appendMany(SHEET.REASONS, [
    { reason_id: 'R1', doctor_id: 'D1', clinic_ids: 'C1', name_ar: 'فحص أولي', description_ar: 'زيارة أولى للفحص والتشخيص', duration_min: 45, lead_hours: 12, book_days_ahead: 21, max_per_day: 10, active: 'TRUE', sort_order: 1 },
    { reason_id: 'R2', doctor_id: 'D1', clinic_ids: 'C1', name_ar: 'استشارة', description_ar: 'استشارة طبية عامة', duration_min: 30, lead_hours: 4, book_days_ahead: 14, max_per_day: 12, active: 'TRUE', sort_order: 2 },
    { reason_id: 'R3', doctor_id: 'D1', clinic_ids: 'C1', name_ar: 'متابعة', description_ar: 'متابعة بعد زيارة سابقة', duration_min: 15, lead_hours: 4, book_days_ahead: 14, max_per_day: 16, active: 'TRUE', sort_order: 3 },
    { reason_id: 'R4', doctor_id: 'D2', clinic_ids: 'C1', name_ar: 'استشارة', description_ar: 'استشارة طبية عامة', duration_min: 30, lead_hours: 4, book_days_ahead: 14, max_per_day: 12, active: 'TRUE', sort_order: 2 },
    { reason_id: 'R5', doctor_id: 'D2', clinic_ids: 'C1', name_ar: 'متابعة', description_ar: 'متابعة بعد زيارة سابقة', duration_min: 15, lead_hours: 4, book_days_ahead: 14, max_per_day: 16, active: 'TRUE', sort_order: 3 },
    { reason_id: 'R6', doctor_id: 'D2', clinic_ids: 'C1', name_ar: 'إجراء / جلسة', description_ar: 'إجراء بسيط أو جلسة علاجية', duration_min: 30, lead_hours: 24, book_days_ahead: 30, max_per_day: 6, active: 'FALSE', sort_order: 4 }
  ]);

  // weekday: 0 = الأحد … 6 = السبت. The doctor's rule from the brief:
  // examinations on Sundays and Wednesdays, 9:00 to 16:00.
  Db.appendMany(SHEET.AVAILABILITY, [
    { availability_id: 'A1', doctor_id: 'D1', clinic_id: 'C1', reason_id: 'R1', weekday: 0, from_time: '09:00', to_time: '16:00', slot_min: 45, max_per_day_override: 8, valid_from: '', valid_to: '', active: 'TRUE' },
    { availability_id: 'A2', doctor_id: 'D1', clinic_id: 'C1', reason_id: 'R1', weekday: 3, from_time: '09:00', to_time: '16:00', slot_min: 45, max_per_day_override: 8, valid_from: '', valid_to: '', active: 'TRUE' },
    { availability_id: 'A3', doctor_id: 'D1', clinic_id: 'C1', reason_id: 'R3', weekday: 0, from_time: '16:00', to_time: '19:00', slot_min: 15, max_per_day_override: 12, valid_from: '', valid_to: '', active: 'TRUE' },
    { availability_id: 'A4', doctor_id: 'D1', clinic_id: 'C1', reason_id: 'R3', weekday: 3, from_time: '16:00', to_time: '19:00', slot_min: 15, max_per_day_override: 12, valid_from: '', valid_to: '', active: 'TRUE' },
    { availability_id: 'A5', doctor_id: 'D2', clinic_id: 'C1', reason_id: 'R4', weekday: 1, from_time: '10:00', to_time: '14:00', slot_min: 30, max_per_day_override: 8, valid_from: '', valid_to: '', active: 'TRUE' },
    { availability_id: 'A6', doctor_id: 'D2', clinic_id: 'C1', reason_id: 'R4', weekday: 2, from_time: '10:00', to_time: '14:00', slot_min: 30, max_per_day_override: 8, valid_from: '', valid_to: '', active: 'TRUE' },
    { availability_id: 'A7', doctor_id: 'D2', clinic_id: 'C1', reason_id: 'R5', weekday: 1, from_time: '14:00', to_time: '17:00', slot_min: 15, max_per_day_override: 12, valid_from: '', valid_to: '', active: 'TRUE' },
    { availability_id: 'A8', doctor_id: 'D2', clinic_id: 'C1', reason_id: 'R4', weekday: 0, from_time: '14:00', to_time: '17:00', slot_min: 30, max_per_day_override: 8, valid_from: '', valid_to: '', active: 'TRUE' }
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

/**
 * Upgrade old global reasons into independent per-doctor rows.
 *
 * A reason used to belong to no doctor; the doctor+branch link lived only in the
 * Availability sheet. The new model requires every active reason to have exactly
 * one doctor and an explicit branch list. For each legacy reason we keep one copy
 * for every doctor who actually had a schedule for it, repoint those schedule rows,
 * and archive the original row so old bookings keep their readable reason name.
 * Legacy reasons with no schedule are archived instead of guessed into a doctor.
 *
 * Safe to run repeatedly: only active rows with a blank doctor_id are migrated.
 */
function migrateReasonsToDoctors() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEET.REASONS)) return { ok: true, copies: 0, archived: 0 };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'BUSY' };
  try {
    const doctors = Db.rows(SHEET.DOCTORS);
    const doctorById = {};
    doctors.forEach(function (d) { doctorById[str(d.doctor_id)] = d; });
    const availability = Db.rows(SHEET.AVAILABILITY);
    const allReasons = Db.rows(SHEET.REASONS);
    let nextReason = 0;
    allReasons.forEach(function (r) {
      const m = str(r.reason_id).match(/^R(\d+)$/i);
      if (m) nextReason = Math.max(nextReason, Number(m[1]));
    });

    const legacy = allReasons.filter(function (r) {
      return isActive(r) && !str(r.doctor_id);
    });
    let copies = 0;
    let archived = 0;

    legacy.forEach(function (old) {
      const oldId = str(old.reason_id);
      const groups = {};
      availability.filter(function (a) {
        return isActive(a) && str(a.reason_id) === oldId && str(a.doctor_id);
      }).forEach(function (a) {
        const doctorId = str(a.doctor_id);
        if (!groups[doctorId]) groups[doctorId] = [];
        groups[doctorId].push(a);
      });

      Object.keys(groups).forEach(function (doctorId) {
        const doctor = doctorById[doctorId];
        if (!doctor) return;
        const doctorBranches = splitIds(doctor.clinic_ids);
        const usedBranches = [];
        groups[doctorId].forEach(function (a) {
          const c = str(a.clinic_id);
          if (c && usedBranches.indexOf(c) === -1) usedBranches.push(c);
        });
        let branchIds = usedBranches.filter(function (c) { return doctorBranches.indexOf(c) !== -1; });
        if (!branchIds.length) branchIds = doctorBranches.slice();
        if (!branchIds.length) return;

        nextReason += 1;
        const newId = 'R' + nextReason;
        Db.append(SHEET.REASONS, {
          reason_id: newId,
          name_ar: str(old.name_ar),
          description_ar: str(old.description_ar),
          duration_min: Number(old.duration_min) || 30,
          lead_hours: str(old.lead_hours) === '' ? 4 : Number(old.lead_hours),
          book_days_ahead: Number(old.book_days_ahead) || 14,
          max_per_day: Number(old.max_per_day) || 0,
          active: 'TRUE',
          sort_order: Number(old.sort_order) || nextReason,
          doctor_id: doctorId,
          clinic_ids: branchIds.join(',')
        });
        groups[doctorId].forEach(function (a) {
          Db.update(SHEET.AVAILABILITY, 'availability_id', str(a.availability_id), { reason_id: newId });
        });
        copies += 1;
      });

      // Keep the old row as an archived history entry. Bookings still point at it.
      Db.update(SHEET.REASONS, 'reason_id', oldId, { active: 'FALSE' });
      archived += 1;
    });

    if (copies || archived) {
      logInfo('migrateReasonsToDoctors', 'Legacy reasons: ' + archived + ' archived, ' + copies + ' doctor copies created');
    }
    return { ok: true, copies: copies, archived: archived };
  } finally {
    lock.releaseLock();
  }
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
  const reasonMigration = migrateReasonsToDoctors();
  const infra = ensureCalendarAndFolder();
  const triggers = installTriggers();
  const check = checkConfiguration();
  const summary = {
    ok: true,
    sheetsCreated: sheetResult.created,
    seeded: seedResult.seeded,
    reasonCopiesCreated: reasonMigration.copies || 0,
    calendar: infra.calendarName,
    triggers: triggers.triggers,
    warnings: check.warnings,
    bookingUrl: getBookingUrl(),
    nextStepsAr: [
      'افتح صفحة الإعدادات (?page=admin) وأنشئ كود الإدارة، ثم أضف الفروع والأطباء والأسباب من الواجهة.',
      'اضبط المواعيد المتاحة لكل طبيب من قسم الجدول (0 = الأحد … 6 = السبت).',
      'غيّر كود الاستقبال وكود الإدارة من قسم الإعدادات.',
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
  if (!str(settings[SETTING.ADMIN_CODE])) {
    warnings.push('كود الإدارة غير مضبوط بعد — افتح صفحة الإعدادات (?page=admin) وأنشئه.');
  }
  if (isTrue(settings[SETTING.BOOKINGS_PAUSED])) {
    warnings.push('استقبال الحجوزات متوقف مؤقتاً — المرضى لا يستطيعون الحجز الآن.');
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
  const reasonRows = Db.rows(SHEET.REASONS);
  reasonRows.forEach(function (r) { reasonIds[str(r.reason_id)] = true; });

  reasonRows.filter(isActive).forEach(function (r) {
    const doctorId = str(r.doctor_id);
    if (!doctorId) {
      warnings.push('سبب الزيارة «' + str(r.name_ar) + '» نشط لكنه غير مرتبط بطبيب.');
      return;
    }
    const d = Db.rows(SHEET.DOCTORS).filter(function (x) { return str(x.doctor_id) === doctorId; })[0];
    if (!d) {
      warnings.push('سبب الزيارة «' + str(r.name_ar) + '» مرتبط بطبيب غير موجود (' + doctorId + ').');
      return;
    }
    const allowed = splitIds(d.clinic_ids);
    const used = reasonClinicIds(r);
    if (!used.length) {
      warnings.push('سبب الزيارة «' + str(r.name_ar) + '» نشط لكنه غير مرتبط بأي فرع.');
    } else {
      used.forEach(function (c) {
        if (allowed.indexOf(c) === -1) {
          warnings.push('سبب الزيارة «' + str(r.name_ar) + '» مرتبط بفرع غير مرتبط بالطبيب (' + c + ').');
        }
      });
    }
  });

  Db.rows(SHEET.AVAILABILITY).forEach(function (a) {
    if (!doctorIds[str(a.doctor_id)]) warnings.push('Availability ' + str(a.availability_id) + ': طبيب غير موجود (' + str(a.doctor_id) + ')');
    if (!clinicIds[str(a.clinic_id)]) warnings.push('Availability ' + str(a.availability_id) + ': فرع غير موجود (' + str(a.clinic_id) + ')');
    if (!reasonIds[str(a.reason_id)]) warnings.push('Availability ' + str(a.availability_id) + ': سبب زيارة غير موجود (' + str(a.reason_id) + ')');
    if (parseTimeToMin(a.from_time) === null || parseTimeToMin(a.to_time) === null) {
      warnings.push('Availability ' + str(a.availability_id) + ': وقت غير صالح، يجب أن يكون HH:mm');
    }
    const doctor = Db.rows(SHEET.DOCTORS).filter(function (d) { return str(d.doctor_id) === str(a.doctor_id); })[0];
    const reason = reasonRows.filter(function (r) { return str(r.reason_id) === str(a.reason_id); })[0];
    if (doctor && splitIds(doctor.clinic_ids).indexOf(str(a.clinic_id)) === -1) {
      warnings.push('Availability ' + str(a.availability_id) + ': الطبيب غير مرتبط بهذا الفرع.');
    }
    if (reason && str(reason.doctor_id) !== str(a.doctor_id)) {
      warnings.push('Availability ' + str(a.availability_id) + ': سبب الزيارة يخص طبيباً آخر.');
    }
    if (reason && !reasonServesClinic(reason, a.clinic_id)) {
      warnings.push('Availability ' + str(a.availability_id) + ': سبب الزيارة غير متاح في هذا الفرع.');
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
