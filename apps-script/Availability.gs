/**
 * Availability.gs — the slot engine.
 *
 * Pure function of the spreadsheet's contents. It never writes anything, which
 * is what makes it safe to call from the public booking page and easy to test
 * locally (see tools/local-test.mjs).
 *
 * Rules, in order:
 *   1. the doctor must handle this clinic, and have an Availability row for this reason
 *   2. the date must be inside the doctor's booking window (book_days_ahead)
 *   3. the slot must respect the minimum lead time
 *   4. the slot must not fall inside a Blackout
 *   5. the slot must not already be taken (one patient per slot)
 *   6. the day must not exceed max_per_day (reason level, or the Availability override)
 */

const MAX_SLOT_DAYS = 90;

function generateSlots(req) {
  req = req || {};
  const settings = getSettings();
  const clinicId = str(req.clinicId);
  const doctorId = str(req.doctorId);
  const reasonId = str(req.reasonId);

  const windowDays = Math.min(
    Math.max(Number(req.days) || Number(settings[SETTING.BOOKING_WINDOW_DAYS]) || 14, 1),
    MAX_SLOT_DAYS
  );

  const clinic = Db.findById(SHEET.CLINICS, 'clinic_id', clinicId);
  const doctor = Db.findById(SHEET.DOCTORS, 'doctor_id', doctorId);
  const reason = Db.findById(SHEET.REASONS, 'reason_id', reasonId);

  if (!clinic || !isActive(clinic)) return { ok: false, error: 'CLINIC_NOT_FOUND' };
  if (!doctor || !isActive(doctor)) return { ok: false, error: 'DOCTOR_NOT_FOUND' };
  if (!reason || !isActive(reason)) return { ok: false, error: 'REASON_NOT_FOUND' };
  if (str(reason.doctor_id) !== doctorId) return { ok: false, error: 'REASON_NOT_FOUND' };
  if (!reasonServesClinic(reason, clinicId)) return { ok: false, error: 'REASON_NOT_IN_CLINIC' };

  const clinicIds = splitIds(doctor.clinic_ids);
  if (clinicIds.indexOf(clinicId) === -1) return { ok: false, error: 'DOCTOR_NOT_IN_CLINIC' };

  const slotLen = Number(reason.duration_min) || 30;
  const reasonMaxPerDay = Number(reason.max_per_day) || 0; // 0 = unlimited
  const leadMinutes = Math.max(
    Number(reason.lead_hours) >= 0 && str(reason.lead_hours) !== ''
      ? Number(reason.lead_hours) * 60
      : Number(settings[SETTING.MIN_LEAD_HOURS]) * 60,
    0
  );
  const reasonDaysAhead = Number(reason.book_days_ahead) || windowDays;
  const horizon = Math.min(windowDays, reasonDaysAhead);

  const avail = Db.rows(SHEET.AVAILABILITY).filter(function (a) {
    return isActive(a) &&
      str(a.doctor_id) === doctorId &&
      str(a.clinic_id) === clinicId &&
      str(a.reason_id) === reasonId;
  });

  if (!avail.length) {
    return {
      ok: true,
      empty: true,
      reason: reasonPublic(reason, slotLen),
      doctor: doctorPublic(doctor),
      clinic: clinicPublic(clinic),
      days: []
    };
  }

  const blackouts = Db.rows(SHEET.BLACKOUTS);
  const occupancy = buildOccupancy(doctorId);
  const today = todayStr();
  const nowMin = nowMinutes();
  const cutoffMin = nowMin + leadMinutes;

  const days = [];
  for (let i = 0; i < horizon; i++) {
    const date = addDaysStr(today, i);
    if (date < today) continue;
    const wd = weekdayIndex(date);

    const dayRows = avail.filter(function (a) {
      return Number(a.weekday) === wd && withinValidRange(a, date);
    });
    if (!dayRows.length) continue;

    const dayCount = (occupancy.byDoctorDate[doctorId + '|' + date] || 0);
    const reasonCount = (occupancy.byDoctorDateReason[doctorId + '|' + date + '|' + reasonId] || 0);
    const slots = [];

    dayRows.forEach(function (a) {
      const maxPerDay = Number(a.max_per_day_override) || reasonMaxPerDay;
      const from = parseTimeToMin(a.from_time);
      const to = parseTimeToMin(a.to_time);
      if (from === null || to === null || to <= from) {
        logWarn('generateSlots', 'Bad availability window ignored: ' + JSON.stringify(a));
        return;
      }
      const step = Number(a.slot_min) || slotLen;

      for (let start = from; start + step <= to; start += step) {
        const end = start + step;
        if (date === today && start < cutoffMin) continue;
        if (isBlackedOut(blackouts, date, start, end, clinicId, doctorId)) continue;
        const taken = occupancy.byDoctorDateStart[doctorId + '|' + date + '|' + minToTime(start)];
        if (taken) continue;
        if (maxPerDay > 0 && (dayCount + slots.length) >= maxPerDay) continue;
        if (reasonMaxPerDay > 0 && (reasonCount + slots.length) >= reasonMaxPerDay) continue;
        slots.push({
          start: minToTime(start),
          end: minToTime(end),
          labelAr: minToTimeAr(start)
        });
      }
    });

    if (slots.length) {
      days.push({
        date: date,
        weekdayAr: weekdayAr(date),
        labelAr: formatDateAr(date),
        isToday: date === today,
        slots: slots
      });
    }
  }

  return {
    ok: true,
    empty: days.length === 0,
    reason: reasonPublic(reason, slotLen),
    doctor: doctorPublic(doctor),
    clinic: clinicPublic(clinic),
    days: days
  };
}

/** Collect the occupancy data the engine needs, in one pass. */
function buildOccupancy(doctorId) {
  const out = { byDoctorDate: {}, byDoctorDateReason: {}, byDoctorDateStart: {} };
  Db.rows(SHEET.BOOKINGS).forEach(function (b) {
    if (str(b.doctor_id) !== doctorId) return;
    if (OCCUPYING_STATUSES.indexOf(str(b.status)) === -1) return;
    const date = str(b.date);
    const start = str(b.start_time);
    if (!date || !start) return;
    const dKey = doctorId + '|' + date;
    out.byDoctorDate[dKey] = (out.byDoctorDate[dKey] || 0) + 1;
    const rKey = dKey + '|' + str(b.reason_id);
    out.byDoctorDateReason[rKey] = (out.byDoctorDateReason[rKey] || 0) + 1;
    out.byDoctorDateStart[dKey + '|' + start] = true;
  });
  return out;
}

/** Blackout.scope_type is 'all', 'clinic' or 'doctor'. date may be 'YYYY-MM-DD' or 'start..end'. */
function isBlackedOut(blackouts, dateStr, startMin, endMin, clinicId, doctorId) {
  for (let i = 0; i < blackouts.length; i++) {
    const b = blackouts[i];
    const scope = str(b.scope_type) || 'all';
    if (scope === 'clinic' && str(b.scope_id) !== clinicId) continue;
    if (scope === 'doctor' && str(b.scope_id) !== doctorId) continue;
    if (!dateMatches(b.date, dateStr)) continue;
    const bf = parseTimeToMin(b.from_time);
    const bt = parseTimeToMin(b.to_time);
    if (bf === null || bt === null) return true; // whole day
    if (overlaps(startMin, endMin, bf, bt)) return true;
  }
  return false;
}

function dateMatches(spec, dateStr) {
  const s = str(spec);
  if (!s) return false;
  const idx = s.indexOf('..');
  if (idx === -1) return s === dateStr;
  const from = s.slice(0, idx).trim();
  const to = s.slice(idx + 2).trim();
  return dateStr >= from && dateStr <= to;
}

function withinValidRange(availabilityRow, dateStr) {
  const from = str(availabilityRow.valid_from);
  const to = str(availabilityRow.valid_to);
  if (from && dateStr < from) return false;
  if (to && dateStr > to) return false;
  return true;
}

function isActive(row) {
  return isTrue(row.active) || (str(row.active) === '' && row.active !== false);
}

function doctorPublic(doctor) {
  return { id: str(doctor.doctor_id), nameAr: str(doctor.name_ar), specialtyAr: str(doctor.specialty_ar) };
}

function clinicPublic(clinic) {
  return {
    id: str(clinic.clinic_id),
    nameAr: str(clinic.name_ar),
    addressAr: str(clinic.address_ar),
    mapLink: str(clinic.map_link),
    phone: str(clinic.phone),
    workingHoursAr: str(clinic.working_hours_ar)
  };
}

function reasonPublic(reason, slotLen) {
  return {
    id: str(reason.reason_id),
    nameAr: str(reason.name_ar),
    descriptionAr: str(reason.description_ar),
    durationMin: slotLen
  };
}

/** Authoritative yes/no for one exact slot. Used by BookingApi.gs under lock. */
function findSlot(req, date, start) {
  const res = generateSlots(req);
  if (!res.ok) return null;
  for (let i = 0; i < res.days.length; i++) {
    const day = res.days[i];
    if (day.date !== date) continue;
    for (let j = 0; j < day.slots.length; j++) {
      if (day.slots[j].start === start) return { day: day, slot: day.slots[j], context: res };
    }
  }
  return null;
}
