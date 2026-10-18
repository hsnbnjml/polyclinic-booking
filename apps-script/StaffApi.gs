/**
 * StaffApi.gs — the reception desk.
 *
 * Every function here requires the staff code from Settings. The web app is
 * deployed anonymously so patients can book without accounts, which also means
 * these functions are reachable by anyone who knows the URL. The code is the
 * only gate, so it must be changed at setup and treated as a password.
 */

function assertStaff(code) {
  const expected = str(getSettings()[SETTING.STAFF_CODE]);
  const given = str(code);
  if (!expected || given !== expected) {
    logWarn('assertStaff', 'Rejected staff call with a wrong code');
    return false;
  }
  return true;
}

function staffError(message) {
  return { ok: false, error: 'STAFF_CODE', messageAr: message };
}

/** One day's agenda, ready to render: no formatting work left for the browser. */
function getStaffBoard(dateStr, code) {
  if (!assertStaff(code)) return staffError(errorMessageAr('STAFF_CODE'));
  const date = str(dateStr) || todayStr();
  const bookings = Db.rows(SHEET.BOOKINGS)
    .filter(function (b) { return str(b.date) === date; })
    .sort(function (a, b) { return str(a.start_time).localeCompare(str(b.start_time)); })
    .map(function (b) { return boardItem(b); });

  const counts = { total: bookings.length, confirmed: 0, attended: 0, no_show: 0, cancelled: 0, reminded: 0 };
  bookings.forEach(function (b) {
    if (b.status === STATUS.CONFIRMED) counts.confirmed++;
    if (b.status === STATUS.ATTENDED) counts.attended++;
    if (b.status === STATUS.NO_SHOW) counts.no_show++;
    if (b.status === STATUS.CANCELLED || b.status === STATUS.RESCHEDULED) counts.cancelled++;
    if (b.waSentAt) counts.reminded++;
  });

  const upcoming = [];
  for (let i = 1; i <= 7; i++) {
    const d = addDaysStr(todayStr(), i);
    const n = Db.rows(SHEET.BOOKINGS).filter(function (b) {
      return str(b.date) === d &&
        OCCUPYING_STATUSES.indexOf(str(b.status)) !== -1;
    }).length;
    upcoming.push({ date: d, labelAr: formatDateAr(d), count: n });
  }

  return {
    ok: true,
    date: date,
    dateAr: formatDateAr(date),
    weekdayAr: weekdayAr(date),
    bookings: bookings,
    doctors: dayDoctors(date),
    counts: counts,
    upcoming: upcoming
  };
}

/**
 * Who is on duty this day, and when — the labels the reception filters the shared
 * schedule by, plus the columns it draws. A doctor appears if they work that weekday
 * or already have a booking then (even a cancelled one, so nothing goes missing).
 */
function dayDoctors(date) {
  const wd = weekdayIndex(date);
  const availability = Db.rows(SHEET.AVAILABILITY).filter(isActive);
  const bookings = Db.rows(SHEET.BOOKINGS).filter(function (b) { return str(b.date) === date; });

  const out = [];
  Db.rows(SHEET.DOCTORS).forEach(function (d) {
    const doctorId = str(d.doctor_id);
    const dayBookings = bookings.filter(function (b) { return str(b.doctor_id) === doctorId; });
    const windows = availability.filter(function (a) {
      return str(a.doctor_id) === doctorId && Number(a.weekday) === wd && withinValidRange(a, date);
    }).map(function (a) {
      const from = parseTimeToMin(a.from_time);
      const to = parseTimeToMin(a.to_time);
      const reason = Db.findById(SHEET.REASONS, 'reason_id', str(a.reason_id)) || {};
      const clinic = Db.findById(SHEET.CLINICS, 'clinic_id', str(a.clinic_id)) || {};
      return {
        fromAr: from === null ? '' : minToTimeAr(from),
        toAr: to === null ? '' : minToTimeAr(to),
        reasonAr: str(reason.name_ar),
        clinicAr: str(clinic.name_ar)
      };
    });

    if (!windows.length && !dayBookings.length) return;
    if (!isActive(d) && !dayBookings.length) return;

    const times = dayBookings.map(function (b) { return str(b.start_time); }).filter(Boolean).sort();
    const labels = [];
    windows.forEach(function (w) {
      const label = w.fromAr + ' – ' + w.toAr;
      if (labels.indexOf(label) === -1) labels.push(label);
    });

    out.push({
      id: doctorId,
      nameAr: str(d.name_ar),
      specialtyAr: str(d.specialty_ar),
      code: doctorCode(d),
      color: doctorColorHex(d.color),
      active: isActive(d),
      windows: windows,
      windowsAr: labels.join(' / '),
      bookings: dayBookings.length,
      confirmed: dayBookings.filter(function (b) { return str(b.status) === STATUS.CONFIRMED; }).length,
      firstTime: times.length ? times[0] : ''
    });
  });

  // Earliest appointment first (doctors with no bookings last), then by name.
  out.sort(function (a, b) {
    const at = a.firstTime || '99:99';
    const bt = b.firstTime || '99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.nameAr.localeCompare(b.nameAr);
  });
  return out;
}

function boardItem(b) {
  const doctor = Db.findById(SHEET.DOCTORS, 'doctor_id', str(b.doctor_id)) || {};
  const clinic = Db.findById(SHEET.CLINICS, 'clinic_id', str(b.clinic_id)) || {};
  const reason = Db.findById(SHEET.REASONS, 'reason_id', str(b.reason_id)) || {};
  const startMin = parseTimeToMin(b.start_time);
  return {
    bookingId: str(b.booking_id),
    name: str(b.name),
    phoneNorm: str(b.phone_norm),
    phoneRaw: str(b.phone_raw),
    time: str(b.start_time),
    timeAr: startMin === null ? '' : minToTimeAr(startMin),
    doctorId: str(b.doctor_id),
    doctorAr: str(doctor.name_ar),
    doctorColor: doctorColorHex(doctor.color),
    doctorCode: doctorCode(doctor),
    clinicId: str(b.clinic_id),
    clinicAr: str(clinic.name_ar),
    reasonId: str(b.reason_id),
    reasonAr: str(reason.name_ar),
    status: str(b.status),
    staffNote: str(b.staff_note),
    waSentAt: str(b.wa_sent_at),
    waTemplate: waTemplateLabelAr(b.wa_template),
    rescheduledFrom: str(b.rescheduled_from),
    source: str(b.source),
    canReschedule: str(b.status) === STATUS.CONFIRMED,
    waLinks: waLinksFor(b)
  };
}

/** attended / no_show / cancelled. Cancelling frees the slot and drops the calendar event. */
function setBookingStatus(bookingId, status, code, note) {
  if (!assertStaff(code)) return staffError(errorMessageAr('STAFF_CODE'));
  const next = str(status);
  if (STAFF_STATUS_CHOICES.indexOf(next) === -1) {
    return { ok: false, error: 'BAD_STATUS', messageAr: 'حالة غير معروفة.' };
  }
  const booking = Db.findById(SHEET.BOOKINGS, 'booking_id', str(bookingId));
  if (!booking) return { ok: false, error: 'NOT_FOUND', messageAr: errorMessageAr('NOT_FOUND') };
  if (str(booking.status) === STATUS.RESCHEDULED) {
    return { ok: false, error: 'ALREADY_RESCHEDULED', messageAr: 'هذا الموعد تم تغييره بالفعل.' };
  }

  Db.update(SHEET.BOOKINGS, 'booking_id', str(bookingId), {
    status: next,
    status_at: new Date().toISOString(),
    status_by: 'staff',
    staff_note: note === undefined ? str(booking.staff_note) : str(note)
  });

  if (next === STATUS.CANCELLED) {
    deleteEventForBooking(booking);
    Db.update(SHEET.BOOKINGS, 'booking_id', str(bookingId), { event_id: '' });
  } else if (next === STATUS.NO_SHOW) {
    annotateEvent(booking, '✗ لم يحضر');
  } else if (next === STATUS.ATTENDED) {
    annotateEvent(booking, '✓ حضر');
  }

  logInfo('setBookingStatus', str(bookingId) + ' -> ' + next);
  return { ok: true, bookingId: str(bookingId), status: next };
}

/**
 * Reschedule = close the old row, open a new one, keep one calendar event.
 * Nothing is deleted, so "she moved twice" stays visible in history.
 */
function rescheduleBooking(bookingId, newDate, newStart, code, note) {
  if (!assertStaff(code)) return staffError(errorMessageAr('STAFF_CODE'));
  const booking = Db.findById(SHEET.BOOKINGS, 'booking_id', str(bookingId));
  if (!booking) return { ok: false, error: 'NOT_FOUND', messageAr: errorMessageAr('NOT_FOUND') };
  if (str(booking.status) !== STATUS.CONFIRMED) {
    return { ok: false, error: 'NOT_CONFIRMED', messageAr: 'لا يمكن تغيير موعد غير مؤكد.' };
  }

  const req = {
    clinicId: str(booking.clinic_id),
    doctorId: str(booking.doctor_id),
    reasonId: str(booking.reason_id)
  };
  const found = findSlot(req, str(newDate), str(newStart));
  if (!found) return { ok: false, error: 'SLOT_TAKEN', messageAr: errorMessageAr('SLOT_TAKEN') };

  const now = new Date().toISOString();
  const fresh = {
    booking_id: bookingRefFor(Db.findById(SHEET.DOCTORS, 'doctor_id', str(booking.doctor_id)) || {}, str(newDate)),
    created_at: now,
    clinic_id: str(booking.clinic_id),
    doctor_id: str(booking.doctor_id),
    reason_id: str(booking.reason_id),
    date: str(newDate),
    start_time: found.slot.start,
    end_time: found.slot.end,
    name: str(booking.name),
    phone_raw: str(booking.phone_raw),
    phone_norm: str(booking.phone_norm),
    email: str(booking.email),
    extra_json: str(booking.extra_json),
    status: STATUS.CONFIRMED,
    status_at: now,
    status_by: 'staff',
    rescheduled_from: str(bookingId),
    staff_note: str(note),
    wa_sent_at: '',
    wa_template: '',
    event_id: str(booking.event_id),
    source: 'staff:reschedule'
  };

  Db.append(SHEET.BOOKINGS, fresh);

  if (fresh.event_id) {
    const moved = moveEventForBooking(fresh);
    if (!moved) {
      deleteEventForBooking(booking);
      const newEventId = createEventForBooking(fresh);
      Db.update(SHEET.BOOKINGS, 'booking_id', fresh.booking_id, { event_id: newEventId });
      fresh.event_id = newEventId;
    }
  } else {
    const newEventId = createEventForBooking(fresh);
    Db.update(SHEET.BOOKINGS, 'booking_id', fresh.booking_id, { event_id: newEventId });
    fresh.event_id = newEventId;
  }

  Db.update(SHEET.BOOKINGS, 'booking_id', str(bookingId), {
    status: STATUS.RESCHEDULED,
    status_at: now,
    status_by: 'staff',
    event_id: '',
    staff_note: str(note)
  });

  logInfo('rescheduleBooking', str(bookingId) + ' -> ' + fresh.booking_id + ' ' + newDate + ' ' + newStart);
  return { ok: true, oldBookingId: str(bookingId), booking: bookingConfirmation(fresh, false) };
}

/** Block a doctor's or a clinic's time, from the staff page. Also mirrored to the calendar. */
function blockTime(payload, code) {
  if (!assertStaff(code)) return staffError(errorMessageAr('STAFF_CODE'));
  payload = payload || {};
  const date = str(payload.date);
  if (!date) return { ok: false, error: 'MISSING_FIELDS', messageAr: 'اختر التاريخ.' };
  const scopeType = str(payload.scopeType) || 'all';
  const scopeId = str(payload.scopeId);
  const fromTime = str(payload.fromTime);
  const toTime = str(payload.toTime);
  const note = str(payload.note);
  const blackoutId = newId('BLK');

  Db.append(SHEET.BLACKOUTS, {
    blackout_id: blackoutId,
    date: date,
    scope_type: scopeType,
    scope_id: scopeId,
    from_time: fromTime,
    to_time: toTime,
    note: note || 'إيقاف من شاشة الاستقبال'
  });

  // Mirror to the calendar so the doctors can see the block where they look.
  try {
    const cal = ensureSharedCalendar();
    const from = parseDateTime(date, fromTime || '00:00');
    const to = parseDateTime(date, toTime || '23:59');
    cal.createEvent(BLOCK_PREFIX + (scopeType !== 'all' ? ' [' + scopeType + ':' + scopeId + '] ' : ' ') + (note || ''), from, to);
  } catch (err) {
    logWarn('blockTime', 'Calendar mirror failed: ' + err);
  }

  return { ok: true, blackoutId: blackoutId };
}

function parseDateTime(dateStr, timeStr) {
  const d = parseDateStr(dateStr);
  const min = parseTimeToMin(timeStr);
  const m = min === null ? 0 : min;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(m / 60), m % 60);
}

/** Patient history by phone — the report the doctor described, for one person. */
function lookupPatient(phone, code) {
  if (!assertStaff(code)) return staffError(errorMessageAr('STAFF_CODE'));
  const cc = getSettings()[SETTING.COUNTRY_CODE];
  const norm = normalizePhone(phone, cc);
  if (!norm) return { ok: false, error: 'NOT_FOUND', messageAr: errorMessageAr('NOT_FOUND') };

  const rows = Db.rows(SHEET.BOOKINGS)
    .filter(function (b) { return str(b.phone_norm) === norm; })
    .sort(function (a, b) { return str(b.date).localeCompare(str(a.date)); });

  if (!rows.length) return { ok: false, error: 'NOT_FOUND', messageAr: 'لا يوجد سجل بهذا الرقم.' };

  const items = rows.map(function (b) {
    const doctor = Db.findById(SHEET.DOCTORS, 'doctor_id', str(b.doctor_id)) || {};
    const clinic = Db.findById(SHEET.CLINICS, 'clinic_id', str(b.clinic_id)) || {};
    const reason = Db.findById(SHEET.REASONS, 'reason_id', str(b.reason_id)) || {};
    return {
      bookingId: str(b.booking_id),
      dateAr: formatDateAr(str(b.date)),
      date: str(b.date),
      timeAr: timeToAr(b.start_time),
      doctorAr: str(doctor.name_ar),
      clinicAr: str(clinic.name_ar),
      reasonAr: str(reason.name_ar),
      status: str(b.status),
      statusAr: statusLabelAr(str(b.status))
    };
  });

  return {
    ok: true,
    phoneNorm: norm,
    name: str(rows[0].name),
    total: items.length,
    attended: items.filter(function (i) { return i.status === STATUS.ATTENDED; }).length,
    noShow: items.filter(function (i) { return i.status === STATUS.NO_SHOW; }).length,
    items: items
  };
}

function statusLabelAr(status) {
  const map = {};
  map[STATUS.CONFIRMED] = 'مؤكد';
  map[STATUS.ATTENDED] = 'حضر';
  map[STATUS.NO_SHOW] = 'لم يحضر';
  map[STATUS.CANCELLED] = 'ملغي';
  map[STATUS.RESCHEDULED] = 'تم تغييره';
  return map[str(status)] || str(status);
}

/** Free slots the staff can offer while moving an existing booking. */
function getStaffSlots(payload, code) {
  if (!assertStaff(code)) return staffError(errorMessageAr('STAFF_CODE'));
  payload = payload || {};
  return generateSlots({
    clinicId: str(payload.clinicId),
    doctorId: str(payload.doctorId),
    reasonId: str(payload.reasonId),
    days: Number(payload.days) || 21
  });
}

/**
 * The full active catalogue, for the staff screen's dropdowns. Needed because
 * "block Dr. X's morning" must work on a day where Dr. X has no bookings yet.
 */
function getStaffCatalog(code) {
  if (!assertStaff(code)) return staffError(errorMessageAr('STAFF_CODE'));
  return {
    ok: true,
    doctors: Db.rows(SHEET.DOCTORS).filter(isActive).map(function (d) {
      return {
        id: str(d.doctor_id),
        nameAr: str(d.name_ar),
        specialtyAr: str(d.specialty_ar),
        code: str(d.code),
        color: doctorColorHex(str(d.doctor_id))
      };
    }),
    clinics: Db.rows(SHEET.CLINICS).filter(isActive).map(function (c) {
      return { id: str(c.clinic_id), nameAr: str(c.name_ar) };
    }),
    reasons: Db.rows(SHEET.REASONS).filter(isActive).map(function (r) {
      return { id: str(r.reason_id), nameAr: str(r.name_ar) };
    })
  };
}
