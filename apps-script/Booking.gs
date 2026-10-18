/**
 * Booking.gs — the only place a patient writes to the system.
 *
 * Every rule is re-checked here under a script lock, because the client is
 * public and untrusted. The browser's idea of "available" means nothing.
 */

const MAX_FUTURE_BOOKINGS_PER_PHONE = 3;
const MAX_NAME_LENGTH = 80;
const MAX_EXTRA_LENGTH = 600;

/**
 * Booking references the patient can read back over the phone:
 *
 *   ae-20261018-1   →  the doctor's first booking on 18 Oct 2026
 *   ae-20261018-2   →  the second
 *
 * The doctor part is the `code` column in the Doctors sheet when the clinic fills it.
 * Otherwise it is improvised from the name: the first letters of the first and last
 * name (Ashraf Elzamany → ae). The Arabic table below is only a fallback, because
 * 'ا' can be a, e or i — a clinic that cares about the letters should set the code.
 */
const AR_TO_LATIN = {
  'ا': 'a', 'أ': 'a', 'إ': 'e', 'آ': 'a', 'ٱ': 'a', 'ب': 'b', 'ت': 't', 'ث': 't',
  'ج': 'j', 'ح': 'h', 'خ': 'k', 'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z', 'س': 's',
  'ش': 's', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'g', 'ف': 'f',
  'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'و': 'w', 'ي': 'y',
  'ى': 'a', 'ة': 'a', 'ء': 'a', 'ئ': 'y', 'ؤ': 'w'
};

/** First Latin letters of a name word, e.g. 'أحمد' → 'ah', 'Ashraf' → 'as'. */
function latinLetters(word) {
  let out = '';
  const s = str(word);
  for (let i = 0; i < s.length && out.length < 2; i++) {
    const ch = s[i];
    if (/[A-Za-z]/.test(ch)) out += ch.toLowerCase();
    else if (AR_TO_LATIN[ch]) out += AR_TO_LATIN[ch];
  }
  return out;
}

/** Short, lowercase code used in booking references. Never returns empty. */
function doctorCode(doctor) {
  const explicit = str(doctor && doctor.code).replace(/[^A-Za-z0-9]/g, '');
  if (explicit) return explicit.toLowerCase().slice(0, 4);

  const words = str(doctor && doctor.name_ar)
    .split(/\s+/)
    .map(function (w) { return w.replace(/[^\u0621-\u064AA-Za-z]/g, ''); })
    .filter(function (w) { return w && !/^(د|dr|doctor)$/i.test(w); });

  let code = '';
  if (words.length > 1) {
    code = latinLetters(words[0]).slice(0, 1) + latinLetters(words[words.length - 1]).slice(0, 1);
  }
  if (code.length < 2 && words.length) code = latinLetters(words[0]);
  if (code.length < 2) code = str(doctor && doctor.doctor_id).toLowerCase().replace(/[^a-z0-9]/g, '');
  return code.slice(0, 4) || 'dr';
}

/**
 * <doctor code>-<yyyymmdd>-<n>, where n is this doctor's n-th booking that day.
 *
 * Call inside the script lock. Rows are never deleted, so the counter only moves
 * forward: a cancelled booking keeps its number and the next one takes the next
 * number — two live bookings can never share a reference.
 */
function bookingRefFor(doctor, date) {
  const doctorId = str(doctor && doctor.doctor_id);
  const day = str(date);
  const seq = Db.rows(SHEET.BOOKINGS).filter(function (b) {
    return str(b.doctor_id) === doctorId && str(b.date) === day;
  }).length + 1;
  return doctorCode(doctor) + '-' + day.replace(/-/g, '') + '-' + seq;
}

function submitBooking(input) {
  input = input || {};
  const settings = getSettings();
  const cc = settings[SETTING.COUNTRY_CODE];

  // Honeypot: a field real patients never fill. Bots happily do.
  if (str(input.trap)) {
    logWarn('submitBooking', 'Honeypot triggered from source=' + str(input.source));
    return { ok: false, error: 'REJECTED' };
  }

  const clinicId = str(input.clinicId);
  const doctorId = str(input.doctorId);
  const reasonId = str(input.reasonId);
  const date = str(input.date);
  const start = str(input.start);
  if (!clinicId || !doctorId || !reasonId || !date || !start) {
    return { ok: false, error: 'MISSING_FIELDS' };
  }
  if (str(input.consent) !== 'true' && str(input.consent) !== '1' && str(input.consent) !== 'on') {
    return { ok: false, error: 'CONSENT_REQUIRED' };
  }

  const name = str(input.name).slice(0, MAX_NAME_LENGTH); // optional by design
  const phoneRaw = str(input.phone).slice(0, 30);
  const phoneConfirm = str(input.phoneConfirm);
  if (!phoneRaw) return { ok: false, error: 'PHONE_REQUIRED' };
  if (phoneConfirm && normalizePhone(phoneRaw, cc) !== normalizePhone(phoneConfirm, cc)) {
    return { ok: false, error: 'PHONE_MISMATCH' };
  }
  if (!isPlausiblePhone(phoneRaw, cc)) return { ok: false, error: 'PHONE_INVALID' };
  const phoneNorm = normalizePhone(phoneRaw, cc);

  const extra = str(input.extra).slice(0, MAX_EXTRA_LENGTH);
  const source = str(input.source).slice(0, 60);

  const req = { clinicId: clinicId, doctorId: doctorId, reasonId: reasonId };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    logError('submitBooking', 'Could not get lock');
    return { ok: false, error: 'BUSY' };
  }

  try {
    // Idempotency: a double-tap on an impatient phone must not create two bookings.
    const existing = Db.rows(SHEET.BOOKINGS).filter(function (b) {
      return str(b.status) === STATUS.CONFIRMED &&
        str(b.phone_norm) === phoneNorm &&
        str(b.doctor_id) === doctorId &&
        str(b.date) === date &&
        str(b.start_time) === start;
    });
    if (existing.length) {
      return bookingConfirmation(existing[0], true);
    }

    // Guardrails against a bored teenager with the link.
    const today = todayStr();
    const activeCount = Db.rows(SHEET.BOOKINGS).filter(function (b) {
      return str(b.phone_norm) === phoneNorm &&
        str(b.status) === STATUS.CONFIRMED &&
        str(b.date) >= today;
    }).length;
    if (activeCount >= MAX_FUTURE_BOOKINGS_PER_PHONE) {
      return { ok: false, error: 'TOO_MANY_ACTIVE' };
    }

    const found = findSlot(req, date, start);
    if (!found) return { ok: false, error: 'SLOT_TAKEN' };

    const doctor = Db.findById(SHEET.DOCTORS, 'doctor_id', doctorId) || {};

    const booking = {
      booking_id: bookingRefFor(doctor, date),
      created_at: new Date().toISOString(),
      clinic_id: clinicId,
      doctor_id: doctorId,
      reason_id: reasonId,
      date: date,
      start_time: found.slot.start,
      end_time: found.slot.end,
      name: name,
      phone_raw: phoneRaw,
      phone_norm: phoneNorm,
      email: str(input.email).slice(0, 120),
      extra_json: extra,
      status: STATUS.CONFIRMED,
      status_at: new Date().toISOString(),
      status_by: 'patient',
      rescheduled_from: '',
      staff_note: '',
      wa_sent_at: '',
      wa_template: '',
      event_id: '',
      source: source
    };

    Db.append(SHEET.BOOKINGS, booking);

    const eventId = createEventForBooking(booking);
    if (eventId) {
      Db.update(SHEET.BOOKINGS, 'booking_id', booking.booking_id, { event_id: eventId });
      booking.event_id = eventId;
    }

    logInfo('submitBooking', 'Booked ' + booking.booking_id + ' ' + doctorId + ' ' + date + ' ' + start);
    return bookingConfirmation(booking, false);
  } finally {
    lock.releaseLock();
  }
}

/** Everything the patient (and the staff page) needs to display a finished booking. */
function bookingConfirmation(booking, wasDuplicate) {
  const settings = getSettings();
  const clinic = Db.findById(SHEET.CLINICS, 'clinic_id', str(booking.clinic_id)) || {};
  const doctor = Db.findById(SHEET.DOCTORS, 'doctor_id', str(booking.doctor_id)) || {};
  const reason = Db.findById(SHEET.REASONS, 'reason_id', str(booking.reason_id)) || {};
  const startMin = parseTimeToMin(booking.start_time);
  const links = calendarLinksFor(booking);
  return {
    ok: true,
    duplicate: !!wasDuplicate,
    calendarUrl: links.googleUrl,
    bookingId: str(booking.booking_id),
    name: str(booking.name),
    date: str(booking.date),
    dateAr: formatDateAr(str(booking.date)),
    weekdayAr: weekdayAr(str(booking.date)),
    startTime: str(booking.start_time),
    startTimeAr: startMin === null ? '' : minToTimeAr(startMin),
    endTimeAr: parseTimeToMin(booking.end_time) === null ? '' : minToTimeAr(parseTimeToMin(booking.end_time)),
    doctorAr: str(doctor.name_ar),
    clinicAr: str(clinic.name_ar),
    clinicAddressAr: str(clinic.address_ar),
    clinicPhone: str(clinic.phone),
    // What a patient should actually dial: the branch line when the clinic has filled
    // it in, otherwise the general support number. '' means neither is usable yet.
    contactPhone: callablePhone(clinic.phone) || callablePhone(settings[SETTING.SUPPORT_PHONE]),
    mapLink: str(clinic.map_link),
    reasonAr: str(reason.name_ar),
    whatsappNumber: settings[SETTING.WHATSAPP_NUMBER],
    supportPhone: settings[SETTING.SUPPORT_PHONE],
    successText: settings[SETTING.SUCCESS_TEXT_AR]
  };
}

function getBookingById(bookingId) {
  return Db.findById(SHEET.BOOKINGS, 'booking_id', bookingId);
}
