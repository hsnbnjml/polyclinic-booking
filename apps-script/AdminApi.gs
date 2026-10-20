/**
 * AdminApi.gs — the settings page and doctor self-service.
 *
 * Access model:
 *   - admin_code  → full settings (separate from the reception staff_code)
 *   - doctor PIN  → only that doctor's own availability
 *
 * The first admin code is created from the staff code, so the clinic can set it
 * without touching the script editor. Every write is validated here and logged
 * to the Log sheet under context "admin"; the browser is never trusted.
 */

const ADMIN_WA_PLACEHOLDERS = [
  'name', 'bookingId', 'doctor', 'clinic', 'address', 'mapLink', 'addressBlock',
  'reason', 'dateAr', 'whenAr', 'timeAr', 'phone'
];

// A function, not a top-level object: Apps Script may load AdminApi.gs before
// Config.gs, and a top-level initializer that reads SETTING would crash the page
// with "SETTING is not defined". Everything here runs after all files are loaded.
function adminTextKeys() {
  return {
    consentText: SETTING.CONSENT_TEXT_AR,
    successText: SETTING.SUCCESS_TEXT_AR,
    subtitle: SETTING.BOOKING_SUBTITLE_AR,
    nameHint: SETTING.NAME_HINT_AR,
    phoneHint: SETTING.PHONE_HINT_AR,
    extraLabel: SETTING.EXTRA_LABEL_AR,
    noSlots: SETTING.NO_SLOTS_TEXT_AR,
    slotTaken: SETTING.SLOT_TAKEN_TEXT_AR
  };
}

function adminError(code, messageAr) {
  return { ok: false, error: code || 'ADMIN_ERROR', messageAr: messageAr || 'تعذّر إتمام العملية.' };
}

function adminIsDate(value) {
  const s = str(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  try {
    return formatDateStr(parseDateStr(s)) === s;
  } catch (err) {
    return false;
  }
}

function adminBool(value, fallback) {
  if (value === undefined || value === null || value === '') return !!fallback;
  return isTrue(value);
}

function adminInt(value, min, max, fallback) {
  const n = Number(value);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function adminNextId(prefix, sheetName, field) {
  let max = 0;
  Db.rows(sheetName).forEach(function (r) {
    const m = str(r[field]).match(new RegExp('^' + prefix + '(\\d+)$', 'i'));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return prefix + (max + 1);
}

function adminParseIds(value) {
  if (Object.prototype.toString.call(value) === '[object Array]') {
    return value.map(function (v) { return str(v); }).filter(Boolean);
  }
  return str(value).split(',').map(function (v) { return str(v); }).filter(Boolean);
}

function adminParseClinicIds(value) {
  return adminParseIds(value);
}

function adminActorName(actor) {
  if (!actor) return '';
  if (actor.role === 'admin') return 'الإدارة';
  if (actor.role === 'doctor') return str(actor.doctor && actor.doctor.name_ar) || str(actor.doctorId);
  return '';
}

/* ------------------------------------------------------------------ *
 * Passwords: SHA-256 in Apps Script, a deterministic fallback in the
 * offline demo/test harness (where Utilities.computeDigest does not exist).
 * ------------------------------------------------------------------ */

function adminPinSalt() {
  try {
    if (typeof Utilities !== 'undefined' && Utilities.getUuid) return Utilities.getUuid();
  } catch (err) { /* fall through */ }
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function adminPinHash(pin, salt) {
  const input = 'polyclinic:' + str(salt) + ':' + str(pin);
  try {
    if (typeof Utilities !== 'undefined' && Utilities.computeDigest && Utilities.DigestAlgorithm) {
      const bytes = Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        input,
        Utilities.Charset ? Utilities.Charset.UTF_8 : undefined
      );
      return bytes.map(function (b) {
        return ('0' + ((b + 256) % 256).toString(16)).slice(-2);
      }).join('');
    }
  } catch (err) {
    logWarn('adminPinHash', 'SHA-256 unavailable, using fallback: ' + err);
  }
  // FNV-1a x2 — only a non-reversible deterrent for the demo/tests. Production
  // Apps Script takes the SHA-256 branch above.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = ((h2 ^ c) * 2166136261) >>> 0;
  }
  return 'fnv' + h1.toString(16) + h2.toString(16);
}

function adminAccessRows() {
  try {
    return Db.rows(SHEET.ACCESS);
  } catch (err) {
    // A page saved before an upgrade can ask for a session before the first login
    // created the Access sheet. Repair the schema once, then read it.
    adminMigrateSchema();
    return Db.rows(SHEET.ACCESS);
  }
}

function adminAccessFor(doctorId, accessRows) {
  const rows = accessRows || adminAccessRows();
  for (let i = 0; i < rows.length; i++) {
    if (str(rows[i].doctor_id) === str(doctorId)) return rows[i];
  }
  return null;
}

function adminPinMatches(pin, salt, hash) {
  return !!str(hash) && adminPinHash(pin, salt) === str(hash);
}

/** True when a proposed admin/staff code would also open a doctor's schedule. */
function adminPinConflict(code, excludeDoctorId) {
  const value = str(code);
  if (!value) return false;
  try {
    return adminAccessRows().some(function (a) {
      return str(a.doctor_id) !== str(excludeDoctorId) &&
        adminPinMatches(value, a.pin_salt, a.pin_hash);
    });
  } catch (err) {
    return false;
  }
}

/** Verify an admin code or a doctor PIN. Returns a role object or null. */
function adminRoleFor(code) {
  const given = str(code);
  if (!given) return null;
  const settings = getSettings();
  const adminCode = str(settings[SETTING.ADMIN_CODE]);
  const staffCode = str(settings[SETTING.STAFF_CODE]);

  if (adminCode && given === adminCode) {
    return { role: 'admin', actor: 'admin' };
  }
  // First run: the staff code bootstraps the admin code, then stops working here.
  if (!adminCode && given === staffCode) {
    return { role: 'bootstrap', actor: 'setup' };
  }
  if (given === staffCode) return { role: 'staff', actor: 'staff' };

  const access = adminAccessRows();
  const doctors = Db.rows(SHEET.DOCTORS).filter(isActive);
  for (let i = 0; i < doctors.length; i++) {
    const d = doctors[i];
    const row = adminAccessFor(d.doctor_id, access);
    if (row && adminPinMatches(given, row.pin_salt, row.pin_hash)) {
      return {
        role: 'doctor',
        actor: 'doctor:' + str(d.doctor_id),
        doctorId: str(d.doctor_id),
        doctor: d
      };
    }
  }
  return null;
}

/** Create missing sheets/columns on the first settings visit after an upgrade. */
function adminMigrateSchema() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let needed = !ss.getSheetByName(SHEET.ACCESS);
  if (!needed) {
    Object.keys(HEADERS).forEach(function (name) {
      if (needed) return;
      const sh = ss.getSheetByName(name);
      if (!sh) { needed = true; return; }
      const header = HEADERS[name];
      const current = sh.getLastRow() >= 1 && sh.getLastColumn() >= 1
        ? sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String)
        : [];
      if (current.length < header.length || header.some(function (h, i) { return current[i] !== h; })) {
        needed = true;
      }
    });
  }
  if (needed) createAllSheets();
}

function adminAudit(actor, action, detail) {
  try {
    logInfo('admin', JSON.stringify({
      actor: adminActorName(actor) || 'الإدارة',
      actorId: actor && actor.role === 'doctor' ? actor.doctorId : 'admin',
      action: str(action),
      detail: str(detail).slice(0, 500)
    }));
  } catch (err) {
    logWarn('adminAudit', err);
  }
}

function adminLogin(code) {
  adminMigrateSchema();
  const actor = adminRoleFor(code);
  if (!actor) {
    logWarn('adminLogin', 'Rejected admin/doctor login');
    return adminError('ADMIN_CODE', 'كود الدخول غير صحيح.');
  }
  if (actor.role === 'bootstrap') {
    return {
      ok: false,
      needSetup: true,
      messageAr: 'لم يتم تعيين كود الإدارة بعد. أنشئه الآن باستخدام كود الاستقبال.'
    };
  }
  if (actor.role === 'staff') {
    return adminError('USE_ADMIN', 'هذا كود الاستقبال. استخدم كود الإدارة أو كود الطبيب.');
  }
  if (actor.role === 'doctor') {
    return {
      ok: true,
      role: 'doctor',
      doctorId: str(actor.doctor.doctor_id),
      doctorNameAr: str(actor.doctor.name_ar),
      messageAr: 'مرحباً ' + str(actor.doctor.name_ar)
    };
  }
  return { ok: true, role: 'admin', messageAr: 'مرحباً بك في إعدادات العيادة' };
}

function adminBootstrap(staffCode, newCode) {
  adminMigrateSchema();
  const settings = getSettings();
  if (str(settings[SETTING.ADMIN_CODE])) {
    return adminError('ALREADY_SET', 'كود الإدارة مضبوط بالفعل. استخدمه للدخول.');
  }
  if (str(staffCode) !== str(settings[SETTING.STAFF_CODE])) {
    return adminError('STAFF_CODE', 'كود الاستقبال غير صحيح.');
  }
  const code = str(newCode);
  if (code.length < 6) {
    return adminError('WEAK_CODE', 'اجعل كود الإدارة 6 أحرف أو أرقام على الأقل.');
  }
  if (code === str(settings[SETTING.STAFF_CODE])) {
    return adminError('SAME_CODE', 'كود الإدارة يجب أن يختلف عن كود الاستقبال.');
  }
  if (adminPinConflict(code)) {
    return adminError('CODE_CONFLICT', 'كود الإدارة يطابق كود دخول طبيب. اختر كوداً آخر.');
  }
  setSetting(SETTING.ADMIN_CODE, code);
  adminAudit({ role: 'admin', actor: 'setup' }, 'إنشاء كود الإدارة', 'أول مرة');
  return { ok: true, role: 'admin', messageAr: 'تم إنشاء كود الإدارة.' };
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

function adminGet(code) {
  const actor = adminRoleFor(code);
  if (!actor) return adminError('ADMIN_CODE', 'انتهت الجلسة أو الكود غير صحيح. سجّل الدخول من جديد.');
  if (actor.role === 'staff') return adminError('USE_ADMIN', 'هذه الصفحة للإدارة أو الطبيب فقط.');
  if (actor.role === 'bootstrap') return { ok: false, needSetup: true };
  if (actor.role === 'doctor') return adminDoctorPayload(actor);
  return adminAdminPayload();
}

function adminAdminPayload() {
  const settings = getSettings();
  const access = adminAccessRows();
  const clinics = Db.rows(SHEET.CLINICS);
  const doctors = Db.rows(SHEET.DOCTORS);
  const reasons = Db.rows(SHEET.REASONS);
  const availability = Db.rows(SHEET.AVAILABILITY);
  const blackouts = Db.rows(SHEET.BLACKOUTS);
  const bookings = Db.rows(SHEET.BOOKINGS);

  const templates = getWaTemplates();
  const health = adminHealthWarnings();
  const today = todayStr();

  return {
    ok: true,
    role: 'admin',
    actorName: 'الإدارة',
    clinics: sortRowsByOrder(clinics).map(adminClinicOut),
    doctors: sortRowsByOrder(doctors).map(function (d) { return adminDoctorOut(d, access); }),
    reasons: sortRowsByOrder(reasons).map(adminReasonOut),
    availability: availability.map(adminAvailabilityOut),
    blackouts: blackouts.slice().sort(function (a, b) {
      return (str(b.date) + str(b.blackout_id)).localeCompare(str(a.date) + str(a.blackout_id));
    }).map(adminBlackoutOut),
    settings: {
      clinicName: str(settings[SETTING.CLINIC_NAME]),
      brandPrimary: str(settings[SETTING.BRAND_PRIMARY]),
      brandSecondary: str(settings[SETTING.BRAND_SECONDARY]),
      logoUrl: str(settings[SETTING.LOGO_URL]),
      whatsappNumber: str(settings[SETTING.WHATSAPP_NUMBER]),
      supportPhone: str(settings[SETTING.SUPPORT_PHONE]),
      countryCode: str(settings[SETTING.COUNTRY_CODE]),
      timezone: str(settings[SETTING.TIMEZONE]),
      reportEmail: str(settings[SETTING.REPORT_EMAIL]),
      bookingWindowDays: Number(settings[SETTING.BOOKING_WINDOW_DAYS]) || 14,
      minLeadHours: Number(settings[SETTING.MIN_LEAD_HOURS]) || 0,
      staffCodeSet: !!str(settings[SETTING.STAFF_CODE]),
      adminCodeSet: !!str(settings[SETTING.ADMIN_CODE]),
      bookingsPaused: isTrue(settings[SETTING.BOOKINGS_PAUSED]),
      pauseMessage: str(settings[SETTING.PAUSE_MESSAGE_AR]) ||
        SETTING_DEFAULTS[SETTING.PAUSE_MESSAGE_AR],
      texts: adminTextValues(settings),
      textDefaults: adminTextDefaults()
    },
    templates: Object.keys(templates).map(function (key) {
      return {
        key: key,
        labelAr: templates[key].labelAr,
        text: templates[key].text,
        defaultText: templates[key].defaultText,
        isCustom: templates[key].isCustom
      };
    }),
    meta: {
      today: today,
      colors: DOCTOR_COLOR_CHOICES,
      colorHex: DOCTOR_COLOR_HEX,
      waPlaceholders: ADMIN_WA_PLACEHOLDERS,
      weekdays: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
    },
    audit: adminAuditRows(),
    health: health,
    counts: {
      totalBookings: bookings.length,
      upcomingBookings: bookings.filter(function (b) {
        return str(b.status) === STATUS.CONFIRMED && str(b.date) >= today;
      }).length,
      activeClinics: clinics.filter(isActive).length,
      activeDoctors: doctors.filter(isActive).length,
      activeReasons: reasons.filter(isActive).length,
      activeBlocks: availability.filter(isActive).length
    }
  };
}

function adminDoctorPayload(actor) {
  const doctor = actor.doctor || Db.findById(SHEET.DOCTORS, 'doctor_id', actor.doctorId) || {};
  const settings = getSettings();
  const clinicIds = adminParseClinicIds(doctor.clinic_ids);
  const branches = sortRowsByOrder(Db.rows(SHEET.CLINICS).filter(function (c) {
    return isActive(c) && clinicIds.indexOf(str(c.clinic_id)) !== -1;
  })).map(adminClinicOut);
  const reasons = sortRowsByOrder(Db.rows(SHEET.REASONS).filter(isActive)).map(adminReasonOut);
  const availability = Db.rows(SHEET.AVAILABILITY).filter(function (a) {
    return str(a.doctor_id) === str(doctor.doctor_id);
  }).map(adminAvailabilityOut);
  const access = adminAccessRows();
  const pinRow = adminAccessFor(doctor.doctor_id, access);
  const warnings = [];
  if (!availability.filter(isActive).length) {
    warnings.push({ level: 'warn', text: 'لا توجد لديك مواعيد نشطة. أضف وقتاً ليظهر حجزك للمرضى.' });
  }
  if (!branches.length) {
    warnings.push({ level: 'warn', text: 'لم يتم ربطك بأي فرع. راجع الإدارة.' });
  }
  return {
    ok: true,
    role: 'doctor',
    actorName: str(doctor.name_ar),
    doctor: {
      id: str(doctor.doctor_id),
      nameAr: str(doctor.name_ar),
      specialtyAr: str(doctor.specialty_ar),
      code: str(doctor.code) || doctorCode(doctor),
      pinSet: !!pinRow
    },
    branches: branches,
    reasons: reasons,
    availability: availability,
    health: warnings,
    meta: {
      today: todayStr(),
      colors: DOCTOR_COLOR_CHOICES,
      colorHex: DOCTOR_COLOR_HEX,
      weekdays: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
    },
    settings: {
      clinicName: str(settings[SETTING.CLINIC_NAME])
    }
  };
}

function adminClinicOut(c) {
  return {
    id: str(c.clinic_id),
    nameAr: str(c.name_ar),
    addressAr: str(c.address_ar),
    mapLink: str(c.map_link),
    phone: str(c.phone),
    hoursAr: str(c.working_hours_ar),
    active: isActive(c),
    sortOrder: Number(c.sort_order) || 0
  };
}

function adminDoctorOut(d, access) {
  return {
    id: str(d.doctor_id),
    nameAr: str(d.name_ar),
    specialtyAr: str(d.specialty_ar),
    clinicIds: adminParseClinicIds(d.clinic_ids),
    color: str(d.color) || 'teal',
    code: str(d.code),
    active: isActive(d),
    sortOrder: Number(d.sort_order) || 0,
    hasPin: !!adminAccessFor(d.doctor_id, access)
  };
}

function adminReasonOut(r) {
  return {
    id: str(r.reason_id),
    nameAr: str(r.name_ar),
    descriptionAr: str(r.description_ar),
    durationMin: Number(r.duration_min) || 30,
    leadHours: str(r.lead_hours) === '' ? 0 : Number(r.lead_hours),
    bookDaysAhead: Number(r.book_days_ahead) || 0,
    maxPerDay: Number(r.max_per_day) || 0,
    active: isActive(r),
    sortOrder: Number(r.sort_order) || 0
  };
}

function adminAvailabilityOut(a) {
  return {
    id: str(a.availability_id),
    doctorId: str(a.doctor_id),
    clinicId: str(a.clinic_id),
    reasonId: str(a.reason_id),
    weekday: Number(a.weekday),
    fromTime: str(a.from_time),
    toTime: str(a.to_time),
    slotMin: Number(a.slot_min) || 0,
    maxPerDay: Number(a.max_per_day_override) || 0,
    validFrom: str(a.valid_from),
    validTo: str(a.valid_to),
    active: isActive(a)
  };
}

function adminBlackoutOut(b) {
  return {
    id: str(b.blackout_id),
    date: str(b.date),
    scopeType: str(b.scope_type) || 'all',
    scopeId: str(b.scope_id),
    fromTime: str(b.from_time),
    toTime: str(b.to_time),
    note: str(b.note)
  };
}

function adminTextValues(settings) {
  const out = {};
  Object.keys(adminTextKeys()).forEach(function (publicKey) {
    const settingKey = adminTextKeys()[publicKey];
    out[publicKey] = str(settings[settingKey]) || SETTING_DEFAULTS[settingKey];
  });
  return out;
}

function adminTextDefaults() {
  const out = {};
  Object.keys(adminTextKeys()).forEach(function (publicKey) {
    out[publicKey] = SETTING_DEFAULTS[adminTextKeys()[publicKey]];
  });
  return out;
}

function adminAuditRows() {
  let rows = [];
  try {
    rows = Db.rows(SHEET.LOG).filter(function (r) { return str(r.context) === 'admin'; });
  } catch (err) {
    return [];
  }
  return rows.slice(-80).reverse().map(function (r) {
    let parsed = {};
    try { parsed = JSON.parse(str(r.message)) || {}; } catch (err) { parsed = { detail: str(r.message) }; }
    return {
      at: str(r.timestamp),
      actor: str(parsed.actor) || 'الإدارة',
      action: str(parsed.action),
      detail: str(parsed.detail)
    };
  });
}

function adminHealthWarnings() {
  const base = [];
  try {
    checkConfiguration().warnings.forEach(function (text) {
      base.push({ level: 'warn', text: text });
    });
  } catch (err) {
    base.push({ level: 'warn', text: 'تعذّر فحص الإعدادات: ' + err });
  }

  const clinics = Db.rows(SHEET.CLINICS);
  const doctors = Db.rows(SHEET.DOCTORS);
  const reasons = Db.rows(SHEET.REASONS);
  const availability = Db.rows(SHEET.AVAILABILITY);
  const activeClinics = clinics.filter(isActive);
  const activeDoctors = doctors.filter(isActive);
  const activeReasons = reasons.filter(isActive);
  const activeAvailability = availability.filter(isActive);

  activeDoctors.forEach(function (d) {
    if (!activeAvailability.some(function (a) { return str(a.doctor_id) === str(d.doctor_id); })) {
      base.push({ level: 'warn', text: 'الطبيب ' + str(d.name_ar) + ' نشط لكن ليس له أي موعد أسبوعي. أضف له جدولاً.' });
    }
    const assigned = adminParseClinicIds(d.clinic_ids);
    if (!assigned.length) {
      base.push({ level: 'warn', text: 'الطبيب ' + str(d.name_ar) + ' غير مرتبط بأي فرع.' });
    } else if (!assigned.some(function (id) { return activeClinics.some(function (c) { return str(c.clinic_id) === id; }); })) {
      base.push({ level: 'warn', text: 'الطبيب ' + str(d.name_ar) + ' مرتبط بفروع غير نشطة فقط.' });
    }
  });

  activeReasons.forEach(function (r) {
    if (!activeAvailability.some(function (a) { return str(a.reason_id) === str(r.reason_id); })) {
      base.push({ level: 'warn', text: 'سبب الزيارة «' + str(r.name_ar) + '» نشط لكن لا يوجد طبيب يقدمه.' });
    }
  });

  activeClinics.forEach(function (c) {
    if (!activeDoctors.some(function (d) {
      return adminParseClinicIds(d.clinic_ids).indexOf(str(c.clinic_id)) !== -1;
    })) {
      base.push({ level: 'warn', text: 'الفرع «' + str(c.name_ar) + '» نشط لكن لا يوجد طبيب مرتبط به.' });
    }
  });

  availability.forEach(function (a) {
    const d = doctors.filter(function (x) { return str(x.doctor_id) === str(a.doctor_id); })[0];
    if (!d || !isActive(d)) base.push({ level: 'warn', text: 'يوجد جدول مرتبط بطبيب غير نشط (' + str(a.doctor_id) + ').' });
    const c = clinics.filter(function (x) { return str(x.clinic_id) === str(a.clinic_id); })[0];
    if (!c || !isActive(c)) base.push({ level: 'warn', text: 'يوجد جدول مرتبط بفرع غير نشط (' + str(a.clinic_id) + ').' });
    if (d && adminParseClinicIds(d.clinic_ids).indexOf(str(a.clinic_id)) === -1) {
      base.push({ level: 'warn', text: 'جدول للطبيب ' + str(d.name_ar) + ' في فرع غير مرتبط به.' });
    }
    const r = reasons.filter(function (x) { return str(x.reason_id) === str(a.reason_id); })[0];
    if (!r || !isActive(r)) {
      base.push({ level: 'warn', text: 'يوجد جدول مرتبط بسبب زيارة غير نشط (' + str(a.reason_id) + ').' });
    }
  });

  const seen = {};
  base.forEach(function (w) {
    const k = str(w.level) + '|' + str(w.text);
    seen[k] = (seen[k] || 0) + 1;
  });
  return base.filter(function (w, i) {
    const k = str(w.level) + '|' + str(w.text);
    return base.findIndex(function (x) { return str(x.level) + '|' + str(x.text) === k; }) === i;
  });
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

function adminSave(code, section, payload) {
  const actor = adminRoleFor(code);
  if (!actor || actor.role === 'staff' || actor.role === 'bootstrap') {
    return adminError('ADMIN_CODE', 'كود الإدارة غير صحيح.');
  }
  payload = payload || {};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return adminError('BUSY', 'النظام مشغول، حاول بعد لحظات.');
  try {
    switch (str(section)) {
      case 'clinic': return adminSaveClinic(actor, payload);
      case 'doctor': return adminSaveDoctor(actor, payload);
      case 'reason': return adminSaveReason(actor, payload);
      case 'availability': return adminSaveAvailability(actor, payload);
      case 'blackout': return adminSaveBlackout(actor, payload);
      case 'settings': return adminSaveSettings(actor, payload);
      case 'texts': return adminSaveTexts(actor, payload);
      case 'template': return adminSaveTemplate(actor, payload);
      case 'pause': return adminSavePause(actor, payload);
      default: return adminError('UNKNOWN_SECTION', 'قسم غير معروف.');
    }
  } finally {
    lock.releaseLock();
  }
}

function adminSaveClinic(actor, payload) {
  if (actor.role !== 'admin') return adminError('ADMIN_ONLY', 'تعديل الفروع متاح للإدارة فقط.');
  const name = str(payload.nameAr).slice(0, 120);
  if (!name) return adminError('NAME_REQUIRED', 'اكتب اسم الفرع.');
  const id = str(payload.id);
  const existing = id ? Db.findById(SHEET.CLINICS, 'clinic_id', id) : null;
  if (id && !existing) return adminError('NOT_FOUND', 'الفرع غير موجود.');
  const fields = {
    name_ar: name,
    address_ar: str(payload.addressAr).slice(0, 220),
    map_link: str(payload.mapLink).slice(0, 500),
    phone: str(payload.phone).slice(0, 40),
    working_hours_ar: str(payload.hoursAr).slice(0, 160),
    active: adminBool(payload.active, true) ? 'TRUE' : 'FALSE'
  };
  let savedId = id;
  if (existing) {
    Db.update(SHEET.CLINICS, 'clinic_id', id, fields);
  } else {
    savedId = adminNextId('C', SHEET.CLINICS, 'clinic_id');
    const cRows = Db.rows(SHEET.CLINICS);
    const max = Math.max(cRows.length, cRows.reduce(function (m, r) { return Math.max(m, Number(r.sort_order) || 0); }, 0));
    Db.append(SHEET.CLINICS, Object.assign({ clinic_id: savedId, sort_order: max + 1 }, fields));
  }
  adminAudit(actor, existing ? 'تعديل فرع' : 'إضافة فرع', name);
  return { ok: true, id: savedId };
}

function adminSaveDoctor(actor, payload) {
  if (actor.role !== 'admin') return adminError('ADMIN_ONLY', 'تعديل الأطباء متاح للإدارة فقط.');
  const name = str(payload.nameAr).slice(0, 120);
  if (!name) return adminError('NAME_REQUIRED', 'اكتب اسم الطبيب.');
  const specialty = str(payload.specialtyAr).slice(0, 160);
  if (!specialty) return adminError('SPECIALTY_REQUIRED', 'اكتب تخصص الطبيب.');
  const clinicIds = adminParseClinicIds(payload.clinicIds);
  if (!clinicIds.length) return adminError('BRANCH_REQUIRED', 'اختر فرعاً واحداً على الأقل للطبيب.');
  const allClinics = Db.rows(SHEET.CLINICS).map(function (c) { return str(c.clinic_id); });
  for (let i = 0; i < clinicIds.length; i++) {
    if (allClinics.indexOf(clinicIds[i]) === -1) return adminError('BRANCH_NOT_FOUND', 'أحد الفروع غير موجود.');
  }

  const id = str(payload.id);
  const existing = id ? Db.findById(SHEET.DOCTORS, 'doctor_id', id) : null;
  if (id && !existing) return adminError('NOT_FOUND', 'الطبيب غير موجود.');

  const others = Db.rows(SHEET.DOCTORS).filter(function (d) { return str(d.doctor_id) !== id; });
  let code = str(payload.code).toLowerCase();
  if (code && !/^[a-z]{2}$/.test(code)) {
    return adminError('BAD_CODE', 'كود الطبيب يجب أن يكون حرفين لاتينيين (مثل ae).');
  }
  if (!code) code = adminSuggestDoctorCode(name, others);
  const codeTaken = others.some(function (d) { return doctorCode(d) === code; });
  if (codeTaken) return adminError('CODE_TAKEN', 'هذا الكود مستخدم لطبيب آخر. اختر كوداً مختلفاً.');

  const color = DOCTOR_COLOR_CHOICES.indexOf(str(payload.color)) !== -1 ? str(payload.color) : 'teal';
  const fields = {
    name_ar: name,
    specialty_ar: specialty,
    clinic_ids: clinicIds.join(','),
    color: color,
    active: adminBool(payload.active, true) ? 'TRUE' : 'FALSE',
    code: code
  };
  const oldClinicIds = existing ? adminParseClinicIds(existing.clinic_ids) : [];
  let savedId = id;
  if (existing) {
    Db.update(SHEET.DOCTORS, 'doctor_id', id, fields);
  } else {
    savedId = adminNextId('D', SHEET.DOCTORS, 'doctor_id');
    const dRows = Db.rows(SHEET.DOCTORS);
    const max = Math.max(dRows.length, dRows.reduce(function (m, r) { return Math.max(m, Number(r.sort_order) || 0); }, 0));
    Db.append(SHEET.DOCTORS, Object.assign({ doctor_id: savedId, sort_order: max + 1 }, fields));
  }

  // Removing a branch should also stop its orphan schedule blocks from hanging
  // around invisibly. Turning them off is reversible from the schedule section.
  if (existing) {
    const removed = oldClinicIds.filter(function (c) { return clinicIds.indexOf(c) === -1; });
    if (removed.length) {
      Db.rows(SHEET.AVAILABILITY).forEach(function (a) {
        if (str(a.doctor_id) === id && removed.indexOf(str(a.clinic_id)) !== -1 && isActive(a)) {
          Db.update(SHEET.AVAILABILITY, 'availability_id', str(a.availability_id), { active: 'FALSE' });
        }
      });
    }
  }

  adminAudit(actor, existing ? 'تعديل طبيب' : 'إضافة طبيب', name + ' (' + code + ')');
  return { ok: true, id: savedId, code: code };
}

function adminSuggestDoctorCode(nameAr, others) {
  const used = {};
  (others || []).forEach(function (d) { used[doctorCode(d)] = true; });
  let letters = '';
  try {
    letters = latinLetters(str(nameAr)).replace(/[^a-z]/g, '');
  } catch (err) { letters = ''; }
  let base = (letters.slice(0, 2) || 'dr').toLowerCase();
  while (base.length < 2) base += 'r';
  base = base.slice(0, 2);
  if (!used[base]) return base;
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const candidate = String.fromCharCode(97 + i) + String.fromCharCode(97 + j);
      if (!used[candidate]) return candidate;
    }
  }
  return 'zz';
}

function adminSaveReason(actor, payload) {
  if (actor.role !== 'admin') return adminError('ADMIN_ONLY', 'تعديل أسباب الزيارة متاح للإدارة فقط.');
  const name = str(payload.nameAr).slice(0, 120);
  if (!name) return adminError('NAME_REQUIRED', 'اكتب اسم سبب الزيارة.');
  const id = str(payload.id);
  const existing = id ? Db.findById(SHEET.REASONS, 'reason_id', id) : null;
  if (id && !existing) return adminError('NOT_FOUND', 'سبب الزيارة غير موجود.');
  const fields = {
    name_ar: name,
    description_ar: str(payload.descriptionAr).slice(0, 220),
    duration_min: adminInt(payload.durationMin, 5, 240, 30),
    lead_hours: adminInt(payload.leadHours, 0, 168, 4),
    book_days_ahead: adminInt(payload.bookDaysAhead, 1, 90, 14),
    max_per_day: adminInt(payload.maxPerDay, 0, 100, 0),
    active: adminBool(payload.active, true) ? 'TRUE' : 'FALSE'
  };
  if (existing) {
    Db.update(SHEET.REASONS, 'reason_id', id, fields);
  } else {
    const newId = adminNextId('R', SHEET.REASONS, 'reason_id');
    const rRows = Db.rows(SHEET.REASONS);
    const max = Math.max(rRows.length, rRows.reduce(function (m, r) { return Math.max(m, Number(r.sort_order) || 0); }, 0));
    Db.append(SHEET.REASONS, Object.assign({ reason_id: newId, sort_order: max + 1 }, fields));
  }
  adminAudit(actor, existing ? 'تعديل سبب زيارة' : 'إضافة سبب زيارة', name);
  return { ok: true };
}

function adminSaveAvailability(actor, payload) {
  const isDoctor = actor.role === 'doctor';
  const doctorId = isDoctor ? str(actor.doctorId) : str(payload.doctorId);
  const clinicId = str(payload.clinicId);
  const reasonId = str(payload.reasonId);
  const doctor = Db.findById(SHEET.DOCTORS, 'doctor_id', doctorId);
  if (!doctor || !isActive(doctor)) return adminError('DOCTOR_NOT_FOUND', 'الطبيب غير موجود أو غير نشط.');
  if (isDoctor && str(doctor.doctor_id) !== str(actor.doctorId)) {
    return adminError('FORBIDDEN', 'يمكنك تعديل جدولك فقط.');
  }
  const clinic = Db.findById(SHEET.CLINICS, 'clinic_id', clinicId);
  if (!clinic || !isActive(clinic)) return adminError('CLINIC_NOT_FOUND', 'الفرع غير موجود أو غير نشط.');
  const reason = Db.findById(SHEET.REASONS, 'reason_id', reasonId);
  if (!reason || !isActive(reason)) return adminError('REASON_NOT_FOUND', 'سبب الزيارة غير موجود أو غير نشط.');
  if (adminParseClinicIds(doctor.clinic_ids).indexOf(clinicId) === -1) {
    return adminError('DOCTOR_NOT_IN_CLINIC', 'هذا الطبيب غير مرتبط بهذا الفرع.');
  }

  const weekdays = [];
  (Object.prototype.toString.call(payload.weekdays) === '[object Array]' ? payload.weekdays : []).forEach(function (d) {
    const n = Number(d);
    if (n >= 0 && n <= 6 && weekdays.indexOf(n) === -1) weekdays.push(n);
  });
  if (!weekdays.length) return adminError('WEEKDAY_REQUIRED', 'اختر يوماً واحداً على الأقل.');

  const fromMin = parseTimeToMin(payload.fromTime);
  const toMin = parseTimeToMin(payload.toTime);
  if (fromMin === null || toMin === null || toMin <= fromMin) {
    return adminError('BAD_TIME', 'وقت البداية يجب أن يكون قبل وقت النهاية.');
  }
  const slotMin = adminInt(payload.slotMin, 0, 240, 0);
  if (slotMin !== 0 && slotMin < 5) return adminError('BAD_SLOT', 'مدة الموعد يجب أن تكون 5 دقائق أو أكثر، أو صفراً لاستخدام مدة سبب الزيارة.');
  const maxPerDay = adminInt(payload.maxPerDay, 0, 100, 0);
  const validFrom = str(payload.validFrom);
  const validTo = str(payload.validTo);
  if (validFrom && !adminIsDate(validFrom)) return adminError('BAD_DATE', 'تاريخ البداية غير صحيح.');
  if (validTo && !adminIsDate(validTo)) return adminError('BAD_DATE', 'تاريخ النهاية غير صحيح.');
  if (validFrom && validTo && validFrom > validTo) return adminError('BAD_DATE', 'تاريخ البداية بعد تاريخ النهاية.');
  const active = adminBool(payload.active, true) ? 'TRUE' : 'FALSE';

  const ids = adminParseIds(payload.ids);
  const existing = [];
  if (ids.length) {
    ids.forEach(function (id) {
      const row = Db.findById(SHEET.AVAILABILITY, 'availability_id', id);
      if (!row) return;
      if (isDoctor && str(row.doctor_id) !== str(actor.doctorId)) return;
      if (str(row.doctor_id) !== doctorId || str(row.clinic_id) !== clinicId ||
          str(row.reason_id) !== reasonId) return;
      existing.push(row);
    });
    if (!existing.length || existing.length !== ids.length) {
      return adminError('NOT_FOUND', 'أحد صفوف الجدول لم يعد موجوداً أو لا يخص هذا الطبيب. حدّث الصفحة.');
    }
  }

  const fields = {
    doctor_id: doctorId,
    clinic_id: clinicId,
    reason_id: reasonId,
    from_time: minToTime(fromMin),
    to_time: minToTime(toMin),
    slot_min: slotMin,
    max_per_day_override: maxPerDay,
    valid_from: validFrom,
    valid_to: validTo,
    active: active
  };

  const keptByWeekday = {};
  existing.forEach(function (row) {
    const wd = Number(row.weekday);
    if (weekdays.indexOf(wd) === -1 || keptByWeekday[wd]) {
      Db.remove(SHEET.AVAILABILITY, 'availability_id', str(row.availability_id));
      return;
    }
    keptByWeekday[wd] = true;
    Db.update(SHEET.AVAILABILITY, 'availability_id', str(row.availability_id),
      Object.assign({ weekday: wd }, fields));
  });

  const resultIds = [];
  weekdays.forEach(function (wd) {
    if (keptByWeekday[wd]) return;
    const id = adminNextId('A', SHEET.AVAILABILITY, 'availability_id');
    Db.append(SHEET.AVAILABILITY, Object.assign({
      availability_id: id,
      weekday: wd
    }, fields));
    resultIds.push(id);
  });

  adminAudit(actor, isDoctor ? 'تعديل جدول الطبيب' : 'تعديل جدول',
    str(doctor.name_ar) + ' — ' + str(reason.name_ar) + ' — ' + weekdays.join(','));
  return { ok: true, ids: resultIds };
}

function adminSaveBlackout(actor, payload) {
  if (actor.role !== 'admin') return adminError('ADMIN_ONLY', 'الإجازات والإغلاقات متاحة للإدارة فقط.');
  let from = str(payload.dateFrom);
  let to = str(payload.dateTo) || from;
  if (!adminIsDate(from) || !adminIsDate(to) || from > to) {
    return adminError('BAD_DATE', 'اختر تاريخاً صحيحاً (من – إلى).');
  }
  const date = from === to ? from : from + '..' + to;
  const scopeType = str(payload.scopeType) || 'all';
  const scopeId = str(payload.scopeId);
  if (['all', 'clinic', 'doctor'].indexOf(scopeType) === -1) {
    return adminError('BAD_SCOPE', 'نطاق الإغلاق غير صحيح.');
  }
  if (scopeType === 'clinic' && !Db.findById(SHEET.CLINICS, 'clinic_id', scopeId)) {
    return adminError('CLINIC_NOT_FOUND', 'اختر الفرع.');
  }
  if (scopeType === 'doctor' && !Db.findById(SHEET.DOCTORS, 'doctor_id', scopeId)) {
    return adminError('DOCTOR_NOT_FOUND', 'اختر الطبيب.');
  }
  const fromTime = str(payload.fromTime);
  const toTime = str(payload.toTime);
  if ((fromTime && !toTime) || (!fromTime && toTime)) {
    return adminError('BAD_TIME', 'حدد وقت البداية والنهاية معاً، أو اتركهما فارغين ليوم كامل.');
  }
  if (fromTime) {
    const a = parseTimeToMin(fromTime);
    const b = parseTimeToMin(toTime);
    if (a === null || b === null || b <= a) return adminError('BAD_TIME', 'وقت الإغلاق غير صحيح.');
  }
  const id = adminNextId('B', SHEET.BLACKOUTS, 'blackout_id');
  Db.append(SHEET.BLACKOUTS, {
    blackout_id: id,
    date: date,
    scope_type: scopeType,
    scope_id: scopeType === 'all' ? '' : scopeId,
    from_time: fromTime,
    to_time: toTime,
    note: str(payload.note).slice(0, 220) || 'إغلاق من الإعدادات'
  });
  adminAudit(actor, 'إضافة إغلاق', date + ' — ' + scopeType + (scopeId ? ':' + scopeId : ''));
  return { ok: true, id: id };
}

function adminSaveSettings(actor, payload) {
  if (actor.role !== 'admin') return adminError('ADMIN_ONLY', 'الإعدادات العامة متاحة للإدارة فقط.');
  const values = payload.values || {};
  const settings = getSettings();
  const plan = [];
  const changes = [];

  // Validate the whole form first, then write. A bad timezone must not leave the
  // clinic name changed behind it.
  function planSet(key, value, label) {
    if (value === undefined || value === null) return;
    const v = str(value);
    if (v === str(settings[key])) return;
    plan.push({ key: key, value: v, label: label });
    changes.push(label);
  }

  if (values.clinicName !== undefined) {
    const name = str(values.clinicName).trim().slice(0, 120);
    if (!name) return adminError('NAME_REQUIRED', 'اكتب اسم العيادة.');
    planSet(SETTING.CLINIC_NAME, name, 'اسم العيادة');
  }
  if (values.brandPrimary !== undefined) {
    const color = str(values.brandPrimary).trim();
    if (!/^#[0-9a-f]{6}$/i.test(color)) return adminError('BAD_COLOR', 'اللون الأساسي غير صحيح.');
    planSet(SETTING.BRAND_PRIMARY, color, 'اللون الأساسي');
  }
  if (values.brandSecondary !== undefined) {
    const color = str(values.brandSecondary).trim();
    if (!/^#[0-9a-f]{6}$/i.test(color)) return adminError('BAD_COLOR', 'اللون الثانوي غير صحيح.');
    planSet(SETTING.BRAND_SECONDARY, color, 'اللون الثانوي');
  }
  if (values.logoUrl !== undefined) planSet(SETTING.LOGO_URL, str(values.logoUrl).trim().slice(0, 500), 'رابط الشعار');
  if (values.whatsappNumber !== undefined) planSet(SETTING.WHATSAPP_NUMBER, str(values.whatsappNumber).trim().slice(0, 40), 'رقم واتساب');
  if (values.supportPhone !== undefined) planSet(SETTING.SUPPORT_PHONE, str(values.supportPhone).trim().slice(0, 40), 'رقم الاستقبال');
  if (values.countryCode !== undefined) {
    const cc = str(values.countryCode).replace(/\s+/g, '').slice(0, 8);
    if (cc && !/^\+?\d{1,4}$/.test(cc)) {
      return adminError('BAD_COUNTRY_CODE', 'كود الدولة يجب أن يكون أرقاماً، مثل +20.');
    }
    planSet(SETTING.COUNTRY_CODE, cc, 'كود الدولة');
  }
  if (values.timezone !== undefined) {
    const tz = str(values.timezone).trim().slice(0, 80);
    if (tz) {
      try {
        if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
          Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
        }
      } catch (err) {
        return adminError('BAD_TIMEZONE', 'المنطقة الزمنية غير صحيحة. استخدم اسماً مثل Africa/Cairo.');
      }
    }
    planSet(SETTING.TIMEZONE, tz, 'المنطقة الزمنية');
  }
  if (values.reportEmail !== undefined) {
    const email = str(values.reportEmail).trim().slice(0, 160);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return adminError('BAD_EMAIL', 'بريد التقارير غير صحيح.');
    }
    planSet(SETTING.REPORT_EMAIL, email, 'بريد التقارير');
  }
  if (values.bookingWindowDays !== undefined) {
    planSet(SETTING.BOOKING_WINDOW_DAYS, String(adminInt(values.bookingWindowDays, 1, 90, 14)), 'نافذة الحجز');
  }
  if (values.minLeadHours !== undefined) {
    planSet(SETTING.MIN_LEAD_HOURS, String(adminInt(values.minLeadHours, 0, 168, 4)), 'أقل مهلة');
  }

  const oldStaff = str(settings[SETTING.STAFF_CODE]);
  const oldAdmin = str(settings[SETTING.ADMIN_CODE]);
  let newStaff = '';
  let newAdmin = '';
  if (values.staffCode !== undefined && str(values.staffCode).trim() !== '') {
    newStaff = str(values.staffCode).trim();
    if (newStaff.length < 4) return adminError('WEAK_CODE', 'كود الاستقبال يجب أن يكون 4 أحرف على الأقل.');
    planSet(SETTING.STAFF_CODE, newStaff, 'كود الاستقبال');
  }
  if (values.adminCode !== undefined && str(values.adminCode).trim() !== '') {
    newAdmin = str(values.adminCode).trim();
    if (newAdmin.length < 6) return adminError('WEAK_CODE', 'كود الإدارة يجب أن يكون 6 أحرف على الأقل.');
    planSet(SETTING.ADMIN_CODE, newAdmin, 'كود الإدارة');
  }

  const finalStaff = newStaff || oldStaff;
  const finalAdmin = newAdmin || oldAdmin;
  const codesChanged = (!!newAdmin && newAdmin !== oldAdmin) || (!!newStaff && newStaff !== oldStaff);
  if (codesChanged && finalAdmin && finalStaff && finalAdmin === finalStaff) {
    return adminError('SAME_CODE', 'كود الإدارة يجب أن يختلف عن كود الاستقبال.');
  }
  if (newAdmin && newAdmin !== oldAdmin && adminPinConflict(newAdmin)) {
    return adminError('CODE_CONFLICT', 'كود الإدارة يطابق كود دخول طبيب. اختر كوداً آخر.');
  }
  if (newStaff && newStaff !== oldStaff && adminPinConflict(newStaff)) {
    return adminError('CODE_CONFLICT', 'كود الاستقبال يطابق كود دخول طبيب. اختر كوداً آخر.');
  }

  plan.forEach(function (item) { setSetting(item.key, item.value); });
  if (changes.length) adminAudit(actor, 'تعديل الإعدادات', changes.join('، '));
  return { ok: true, adminCodeChanged: !!newAdmin && newAdmin !== oldAdmin };
}

function adminSaveTexts(actor, payload) {
  if (actor.role !== 'admin') return adminError('ADMIN_ONLY', 'النصوص متاحة للإدارة فقط.');
  const values = payload.texts || {};
  const changed = [];
  Object.keys(adminTextKeys()).forEach(function (publicKey) {
    if (values[publicKey] === undefined) return;
    const key = adminTextKeys()[publicKey];
    let value = str(values[publicKey]).slice(0, 1200);
    if (!value && (publicKey === 'consentText' || publicKey === 'successText')) {
      value = SETTING_DEFAULTS[key];
    }
    setSetting(key, value);
    changed.push(publicKey);
  });
  if (changed.length) adminAudit(actor, 'تعديل نصوص صفحة الحجز', changed.join('، '));
  return { ok: true };
}

function adminSaveTemplate(actor, payload) {
  if (actor.role !== 'admin') return adminError('ADMIN_ONLY', 'رسائل واتساب متاحة للإدارة فقط.');
  const key = str(payload.key);
  if (!WA_TEMPLATES[key]) return adminError('BAD_TEMPLATE', 'قالب الرسالة غير معروف.');
  const text = str(payload.text).slice(0, 1500);
  setSetting(waTemplateSettingKey(key), text);
  adminAudit(actor, 'تعديل رسالة واتساب', WA_TEMPLATES[key].labelAr);
  return { ok: true, reset: !text };
}

function adminSavePause(actor, payload) {
  if (actor.role !== 'admin') return adminError('ADMIN_ONLY', 'إيقاف الحجز متاح للإدارة فقط.');
  const paused = adminBool(payload.paused, false);
  const message = str(payload.message).slice(0, 300) ||
    SETTING_DEFAULTS[SETTING.PAUSE_MESSAGE_AR];
  setSetting(SETTING.BOOKINGS_PAUSED, paused ? 'TRUE' : 'FALSE');
  setSetting(SETTING.PAUSE_MESSAGE_AR, message);
  adminAudit(actor, paused ? 'إيقاف استقبال الحجوزات' : 'استئناف استقبال الحجوزات', message);
  return { ok: true, paused: paused };
}

function adminDelete(code, section, ids) {
  const actor = adminRoleFor(code);
  if (!actor || actor.role === 'staff' || actor.role === 'bootstrap') {
    return adminError('ADMIN_CODE', 'كود الإدارة غير صحيح.');
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return adminError('BUSY', 'النظام مشغول، حاول بعد لحظات.');
  try {
    const list = adminParseIds(ids);
    if (!list.length) return adminError('MISSING_FIELDS', 'لا يوجد ما يُحذف.');
    if (str(section) === 'availability') {
      const rows = Db.rows(SHEET.AVAILABILITY).filter(function (a) { return list.indexOf(str(a.availability_id)) !== -1; });
      if (actor.role === 'doctor' && rows.some(function (a) { return str(a.doctor_id) !== str(actor.doctorId); })) {
        return adminError('FORBIDDEN', 'يمكنك حذف مواعيدك فقط.');
      }
      Db.remove(SHEET.AVAILABILITY, 'availability_id', list);
      adminAudit(actor, 'حذف مواعيد', list.join(','));
      return { ok: true, removed: rows.length };
    }
    if (str(section) === 'blackout') {
      if (actor.role !== 'admin') return adminError('ADMIN_ONLY', 'حذف الإغلاقات متاح للإدارة فقط.');
      const removed = Db.remove(SHEET.BLACKOUTS, 'blackout_id', list);
      adminAudit(actor, 'حذف إغلاق', list.join(','));
      return { ok: true, removed: removed };
    }
    return adminError('USE_ARCHIVE', 'استخدم الأرشفة بدلاً من الحذف.');
  } finally {
    lock.releaseLock();
  }
}

function adminReorder(code, section, ids) {
  const actor = adminRoleFor(code);
  if (!actor || actor.role !== 'admin') return adminError('ADMIN_ONLY', 'الترتيب متاح للإدارة فقط.');
  const list = adminParseIds(ids);
  if (!list.length) return adminError('MISSING_FIELDS', 'لا يوجد ترتيب.');
  const map = {
    clinics: { sheet: SHEET.CLINICS, field: 'clinic_id' },
    doctors: { sheet: SHEET.DOCTORS, field: 'doctor_id' },
    reasons: { sheet: SHEET.REASONS, field: 'reason_id' }
  };
  const target = map[str(section)];
  if (!target) return adminError('UNKNOWN_SECTION', 'قسم غير معروف.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return adminError('BUSY', 'النظام مشغول، حاول بعد لحظات.');
  try {
    const order = list.slice();
    Db.rows(target.sheet).forEach(function (r) {
      if (order.indexOf(str(r[target.field])) === -1) order.push(str(r[target.field]));
    });
    order.forEach(function (id, i) {
      Db.update(target.sheet, target.field, id, { sort_order: i + 1 });
    });
    adminAudit(actor, 'ترتيب ' + section, order.join(','));
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function adminSetDoctorPin(code, doctorId, pin) {
  const actor = adminRoleFor(code);
  if (!actor || actor.role !== 'admin') return adminError('ADMIN_ONLY', 'ضبط كود الطبيب متاح للإدارة فقط.');
  const doctor = Db.findById(SHEET.DOCTORS, 'doctor_id', str(doctorId));
  if (!doctor) return adminError('NOT_FOUND', 'الطبيب غير موجود.');
  const value = str(pin);
  if (!value) {
    Db.remove(SHEET.ACCESS, 'doctor_id', str(doctorId));
    adminAudit(actor, 'إيقاف دخول طبيب', str(doctor.name_ar));
    return { ok: true, cleared: true };
  }
  if (!/^\d{4,8}$/.test(value)) return adminError('BAD_PIN', 'كود الطبيب يجب أن يكون من 4 إلى 8 أرقام.');
  const settings = getSettings();
  if (value === str(settings[SETTING.ADMIN_CODE]) || value === str(settings[SETTING.STAFF_CODE])) {
    return adminError('PIN_CONFLICT', 'هذا الكود مستخدم للإدارة. اختر كوداً آخر.');
  }
  const access = adminAccessRows();
  const conflict = access.some(function (a) {
    return str(a.doctor_id) !== str(doctorId) &&
      adminPinMatches(value, a.pin_salt, a.pin_hash);
  });
  if (conflict) return adminError('PIN_CONFLICT', 'هذا الكود مستخدم لطبيب آخر. اختر كوداً مختلفاً.');
  const salt = adminPinSalt();
  const hash = adminPinHash(value, salt);
  const existing = adminAccessFor(doctorId, access);
  const row = {
    doctor_id: str(doctorId),
    pin_hash: hash,
    pin_salt: salt,
    updated_at: new Date().toISOString()
  };
  if (existing) Db.update(SHEET.ACCESS, 'doctor_id', str(doctorId), row);
  else Db.append(SHEET.ACCESS, row);
  adminAudit(actor, 'ضبط كود دخول طبيب', str(doctor.name_ar));
  return { ok: true };
}

function adminChangePin(code, newPin) {
  const actor = adminRoleFor(code);
  if (!actor || actor.role !== 'doctor') return adminError('DOCTOR_ONLY', 'تغيير الكود متاح للطبيب فقط.');
  const value = str(newPin);
  if (!/^\d{4,8}$/.test(value)) return adminError('BAD_PIN', 'الكود يجب أن يكون من 4 إلى 8 أرقام.');
  const settings = getSettings();
  if (value === str(settings[SETTING.ADMIN_CODE]) || value === str(settings[SETTING.STAFF_CODE])) {
    return adminError('PIN_CONFLICT', 'هذا الكود مستخدم للإدارة. اختر كوداً آخر.');
  }
  const access = adminAccessRows();
  const conflict = access.some(function (a) {
    return str(a.doctor_id) !== str(actor.doctorId) && adminPinMatches(value, a.pin_salt, a.pin_hash);
  });
  if (conflict) return adminError('PIN_CONFLICT', 'هذا الكود مستخدم لطبيب آخر. اختر كوداً مختلفاً.');
  const salt = adminPinSalt();
  const row = {
    doctor_id: str(actor.doctorId),
    pin_hash: adminPinHash(value, salt),
    pin_salt: salt,
    updated_at: new Date().toISOString()
  };
  const existing = adminAccessFor(actor.doctorId, access);
  if (existing) Db.update(SHEET.ACCESS, 'doctor_id', str(actor.doctorId), row);
  else Db.append(SHEET.ACCESS, row);
  adminAudit(actor, 'تغيير كود الطبيب', str(actor.doctor.name_ar));
  return { ok: true };
}

function adminBackup(code) {
  const actor = adminRoleFor(code);
  if (!actor || actor.role !== 'admin') return adminError('ADMIN_ONLY', 'النسخ الاحتياطي متاح للإدارة فقط.');
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const name = 'PolyClinic-MASTER-' + formatDateStr(new Date()) + '-' + pad2(new Date().getHours()) + pad2(new Date().getMinutes());
    const folderId = str(getSettings()[SETTING.BACKUP_FOLDER_ID]);
    let file;
    if (folderId) {
      try { file = DriveApp.getFileById(ss.getId()).makeCopy(name, DriveApp.getFolderById(folderId)); }
      catch (folderErr) { file = DriveApp.getFileById(ss.getId()).makeCopy(name); }
    } else {
      file = DriveApp.getFileById(ss.getId()).makeCopy(name);
    }
    adminAudit(actor, 'نسخة احتياطية', file.getName());
    return { ok: true, url: file.getUrl(), name: file.getName() };
  } catch (err) {
    logError('adminBackup', err);
    return adminError('BACKUP_FAILED', 'تعذّر إنشاء النسخة الاحتياطية الآن. حاول لاحقاً أو نزّل الملف من Google Sheets.');
  }
}
