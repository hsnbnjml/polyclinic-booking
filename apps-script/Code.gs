/**
 * Code.gs — the web endpoints.
 *
 * Three pages and one export route:
 *   /exec                      → the public booking page (what patients see)
 *   /exec?page=staff           → the reception screen (asks for the staff code)
 *   /exec?page=admin           → clinic settings (admin code, or a doctor's own PIN)
 *   /exec?page=export&type=... → CSV / XLSX download (needs the staff code)
 *
 * All interactive data goes over google.script.run, so nothing patient-related
 * is ever readable by URL guessing.
 */

function doGet(e) {
  const params = (e && e.parameter) || {};
  const page = str(params.page);

  if (page === 'export') return handleExport(params);
  if (page === 'staff') return renderStaffPage(params);
  if (page === 'admin') return renderAdminPage(params);
  return renderBookingPage(params);
}

function renderBookingPage(params) {
  const t = HtmlService.createTemplateFromFile('Booking');
  t.config = getPublicConfig();
  t.source = str(params.src || params.source || 'link');
  // Optional pre-filter from a campaign link: /exec?doctor=D1&reason=R1&clinic=C1
  t.preset = {
    clinicId: str(params.clinic),
    doctorId: str(params.doctor),
    reasonId: str(params.reason)
  };
  return t.evaluate()
    .setTitle(getPublicConfig().clinicName + ' — حجز موعد')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function renderStaffPage() {
  const t = HtmlService.createTemplateFromFile('Staff');
  t.config = getPublicConfig();
  t.webAppUrl = getBookingUrl();
  return t.evaluate()
    .setTitle('شاشة الاستقبال — ' + getPublicConfig().clinicName)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function renderAdminPage() {
  // Opening the settings URL is enough to upgrade an older sheet: add the new
  // reason columns and migrate legacy global reasons before the login form.
  // This keeps the patient catalogue working immediately after a deploy, even
  // before the clinic has chosen a permanent admin code.
  try {
    adminMigrateSchema();
  } catch (err) {
    logWarn('renderAdminPage', 'Schema upgrade skipped: ' + err);
  }
  const url = getBookingUrl();
  const t = HtmlService.createTemplateFromFile('Admin');
  t.config = getPublicConfig();
  t.links = {
    booking: url,
    staff: url ? url + (url.indexOf('?') === -1 ? '?' : '&') + 'page=staff' : ''
  };
  return t.evaluate()
    .setTitle('إعدادات العيادة — ' + getPublicConfig().clinicName)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ------------------------------------------------------------------ *
 * Patient-facing API (public — no staff code, no patient data returned)
 * ------------------------------------------------------------------ */

function apiBootstrap() {
  return getBootstrap();
}

function apiSlots(payload) {
  const settings = getSettings();
  if (isTrue(settings[SETTING.BOOKINGS_PAUSED])) {
    return {
      ok: false,
      error: 'BOOKINGS_PAUSED',
      messageAr: str(settings[SETTING.PAUSE_MESSAGE_AR]) || errorMessageAr('BOOKINGS_PAUSED')
    };
  }
  const res = generateSlots({
    clinicId: str((payload || {}).clinicId),
    doctorId: str((payload || {}).doctorId),
    reasonId: str((payload || {}).reasonId),
    days: Number((payload || {}).days) || 0
  });
  if (res && !res.ok) res.messageAr = 'تعذّر عرض المواعيد. حاول مرة أخرى.';
  if (res && res.ok && !res.days.length) {
    res.emptyText = str(settings[SETTING.NO_SLOTS_TEXT_AR]) ||
      'لا توجد مواعيد متاحة لهذا الاختيار حالياً. جرّب طبيباً آخر أو عد لاحقاً.';
  }
  return res;
}

/** Translates an error code into the Arabic sentence the patient should read. */
function apiSubmit(payload) {
  const res = submitBooking(payload || {});
  if (res && !res.ok && !res.messageAr) res.messageAr = errorMessageAr(res.error);
  return res;
}

/* ------------------------------------------------------------------ *
 * Staff API (every one of these requires the staff code)
 * ------------------------------------------------------------------ */

function apiStaffBoard(dateStr, code) {
  return getStaffBoard(dateStr, code);
}

function apiStaffStatus(bookingId, status, code, note) {
  return setBookingStatus(bookingId, status, code, note);
}

function apiStaffReschedule(bookingId, newDate, newStart, code, note) {
  return rescheduleBooking(bookingId, newDate, newStart, code, note);
}

function apiStaffBlock(payload, code) {
  return blockTime(payload, code);
}

function apiStaffLookup(phone, code) {
  return lookupPatient(phone, code);
}

function apiStaffSlots(payload, code) {
  return getStaffSlots(payload, code);
}

function apiStaffCatalog(code) {
  return getStaffCatalog(code);
}

function apiStaffWaMark(bookingId, templateKey, code) {
  if (!assertStaff(code)) return staffError(errorMessageAr('STAFF_CODE'));
  return markWhatsAppSent(bookingId, templateKey);
}

/**
 * `filters` may carry doctorIds (one id, 'D1,D2', or an array) so the KPI cards match
 * whatever the clinic selected in the report panel.
 */
function apiStaffKpis(from, to, code, filters) {
  if (!assertStaff(code)) return staffError(errorMessageAr('STAFF_CODE'));
  return { ok: true, kpi: kpiSummary(from, to, filters) };
}

/* ------------------------------------------------------------------ *
 * Exports
 * ------------------------------------------------------------------ */

function handleExport(params) {
  const code = str(params.code);
  if (!assertStaff(code)) {
    return HtmlService.createHtmlOutput(
      '<div dir="rtl" style="font-family:Arial;padding:24px">كود الاستقبال غير صحيح.</div>'
    );
  }

  // `doctor` takes '' (every doctor), one id, or a comma-separated list for a
  // comparison export — the same shape filterBookings understands.
  const filters = {
    from: str(params.from),
    to: str(params.to),
    doctorId: str(params.doctor),
    clinicId: str(params.clinic),
    reasonId: str(params.reason),
    status: str(params.status)
  };
  const type = str(params.type) || 'xlsx';

  if (type === 'csv') {
    const csv = exportCsv(filters);
    return ContentService.createTextOutput(csv).setMimeType(ContentService.MimeType.CSV);
  }

  const result = exportXlsx(filters);
  const safeUrl = escapeHtml(result.url);
  return HtmlService.createHtmlOutput(
    '<div dir="rtl" style="font-family:Arial;padding:24px">' +
    '<meta http-equiv="refresh" content="0;url=' + safeUrl + '">' +
    '<p>تم إنشاء التقرير (' + result.rows + ' صف).</p>' +
    '<p><a href="' + safeUrl + '" target="_blank" style="font-size:18px">اضغط هنا للتحميل</a></p>' +
    '</div>'
  );
}

/* ------------------------------------------------------------------ *
 * Handy for testing in the editor
 * ------------------------------------------------------------------ */

/** Logs a preview of the next few available slots for the first active configuration. */
function previewSlots() {
  const clinic = Db.rows(SHEET.CLINICS).filter(isActive)[0];
  if (!clinic) { Logger.log('No active clinic configured'); return; }
  const avail = Db.rows(SHEET.AVAILABILITY).filter(isActive)[0];
  if (!avail) { Logger.log('No availability configured'); return; }
  const res = generateSlots({
    clinicId: str(avail.clinic_id),
    doctorId: str(avail.doctor_id),
    reasonId: str(avail.reason_id)
  });
  Logger.log(JSON.stringify(res, null, 2));
  return res;
}
