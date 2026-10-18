/**
 * Calendar.gs — the shared clinic calendar is a *mirror* of the Bookings sheet.
 *
 * The sheet is authoritative. The calendar exists so the reception sees a
 * normal agenda and so the doctor's day is visible at a glance.
 *
 * Unavailability therefore has two supported routes:
 *   - add a row to the Blackouts sheet (precise, per doctor/clinic/day)
 *   - create a calendar event whose title starts with BLOCK, and the nightly
 *     syncBlockEvents() turns it into a Blackout row automatically
 */

const BLOCK_PREFIX = 'BLOCK';

function ensureSharedCalendar() {
  const settings = getSettings();
  const existingId = str(settings[SETTING.CALENDAR_ID]);
  if (existingId) {
    try {
      const cal = CalendarApp.getCalendarById(existingId);
      if (cal) return cal;
    } catch (err) {
      logWarn('ensureSharedCalendar', 'Stored calendar id unusable: ' + err);
    }
  }
  const name = str(settings[SETTING.CALENDAR_NAME]) || 'Clinic appointments';
  const cal = CalendarApp.createCalendar(name, {
    summary: 'مواعيد ' + str(settings[SETTING.CLINIC_NAME]),
    timeZone: str(settings[SETTING.TIMEZONE]) || 'Africa/Cairo'
  });
  setSetting(SETTING.CALENDAR_ID, cal.getId());
  logInfo('ensureSharedCalendar', 'Created calendar ' + cal.getId());
  return cal;
}

function calendarEventTimes(booking) {
  const startMin = parseTimeToMin(booking.start_time);
  const endMin = parseTimeToMin(booking.end_time);
  const base = parseDateStr(str(booking.date));
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(startMin / 60), startMin % 60);
  const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(endMin / 60), endMin % 60);
  return { start: start, end: end };
}

function eventTitle(booking, doctor, reason, clinic) {
  const who = str(booking.name) || str(booking.phone_norm) || 'مريض';
  return '[' + str(doctor.name_ar) + '] ' + str(reason.name_ar) + ' — ' + who;
}

function eventDescription(booking, doctor, reason, clinic) {
  return [
    'رقم الحجز: ' + str(booking.booking_id),
    'الطبيب: ' + str(doctor.name_ar),
    'سبب الزيارة: ' + str(reason.name_ar),
    'الفرع: ' + str(clinic.name_ar),
    'الجوال: ' + str(booking.phone_norm),
    'الاسم: ' + (str(booking.name) || '—'),
    str(booking.extra_json) ? 'ملاحظات: ' + str(booking.extra_json) : ''
  ].filter(String).join('\n');
}

function colorForDoctor(colorName) {
  const map = {
    red: CalendarApp.Color.RED,
    orange: CalendarApp.Color.ORANGE,
    yellow: CalendarApp.Color.YELLOW,
    green: CalendarApp.Color.GREEN,
    teal: CalendarApp.Color.TEAL,
    blue: CalendarApp.Color.BLUE,
    purple: CalendarApp.Color.PURPLE,
    gray: CalendarApp.Color.GRAY
  };
  return map[str(colorName).toLowerCase()] || null;
}

/** Returns the event id, or '' when the calendar step failed (the booking still stands). */
function createEventForBooking(booking) {
  try {
    const cal = ensureSharedCalendar();
    const doctor = Db.findById(SHEET.DOCTORS, 'doctor_id', str(booking.doctor_id)) || {};
    const reason = Db.findById(SHEET.REASONS, 'reason_id', str(booking.reason_id)) || {};
    const clinic = Db.findById(SHEET.CLINICS, 'clinic_id', str(booking.clinic_id)) || {};
    const t = calendarEventTimes(booking);
    const event = cal.createEvent(eventTitle(booking, doctor, reason, clinic), t.start, t.end, {
      description: eventDescription(booking, doctor, reason, clinic),
      location: str(clinic.address_ar)
    });
    const color = colorForDoctor(doctor.color);
    if (color) {
      try { event.setColor(color); } catch (e) { /* color is cosmetic */ }
    }
    return event.getId();
  } catch (err) {
    logError('createEventForBooking', 'Calendar event failed for ' + str(booking.booking_id) + ': ' + err);
    return '';
  }
}

function deleteEventForBooking(booking) {
  const eventId = str(booking.event_id);
  if (!eventId) return false;
  try {
    const event = CalendarApp.getEventById(eventId);
    if (!event) return false;
    event.deleteEvent();
    return true;
  } catch (err) {
    logError('deleteEventForBooking', 'Could not delete event ' + eventId + ': ' + err);
    return false;
  }
}

function moveEventForBooking(booking) {
  const eventId = str(booking.event_id);
  if (!eventId) return false;
  try {
    const event = CalendarApp.getEventById(eventId);
    if (!event) return false;
    const t = calendarEventTimes(booking);
    event.setTime(t.start, t.end);
    return true;
  } catch (err) {
    logError('moveEventForBooking', 'Could not move event ' + eventId + ': ' + err);
    return false;
  }
}

function annotateEvent(booking, suffix) {
  const eventId = str(booking.event_id);
  if (!eventId) return false;
  try {
    const event = CalendarApp.getEventById(eventId);
    if (!event) return false;
    const title = event.getTitle();
    if (title.indexOf(suffix) === -1) event.setTitle(title + ' ' + suffix);
    return true;
  } catch (err) {
    logWarn('annotateEvent', 'Could not annotate event ' + eventId + ': ' + err);
    return false;
  }
}

/**
 * Nightly job: calendar events titled "BLOCK …" become Blackout rows, so
 * reception can block a doctor's day without touching the spreadsheet.
 * Idempotent — one blackout row per event, keyed by the event id.
 */
function syncBlockEvents(daysAhead) {
  const horizon = daysAhead || 60;
  const cal = ensureSharedCalendar();
  const from = new Date();
  const to = new Date(from.getTime() + horizon * 86400000);
  const existing = Db.rows(SHEET.BLACKOUTS).map(function (b) { return str(b.blackout_id); });
  const known = {};
  existing.forEach(function (id) { known[id] = true; });
  Db.rows(SHEET.AVAILABILITY); // no-op read keeps row order warm; harmless

  let created = 0;
  const events = cal.getEvents(from, to);
  events.forEach(function (event) {
    const title = str(event.getTitle());
    if (title.toUpperCase().indexOf(BLOCK_PREFIX) !== 0) return;
    const id = 'BLK-EVT-' + event.getId();
    if (known[id]) return;

    const scopeMatch = title.match(/\[([^\]]+)\]/); // BLOCK [doctor:D1] …
    const allDoctors = Db.rows(SHEET.DOCTORS);
    let scopeType = 'all';
    let scopeId = '';
    if (scopeMatch) {
      const parts = str(scopeMatch[1]).split(':');
      const key = str(parts[0]).toLowerCase();
      const val = str(parts[1]);
      const doc = allDoctors.filter(function (d) {
        return str(d.doctor_id) === val || str(d.name_ar) === val;
      })[0];
      const clinic = Db.rows(SHEET.CLINICS).filter(function (c) {
        return str(c.clinic_id) === val || str(c.name_ar) === val;
      })[0];
      if (key === 'doctor' && doc) { scopeType = 'doctor'; scopeId = str(doc.doctor_id); }
      if (key === 'clinic' && clinic) { scopeType = 'clinic'; scopeId = str(clinic.clinic_id); }
    }

    const start = event.getStartTime();
    const end = event.getEndTime();
    const dateStr = formatDateStr(start);
    const sameDay = formatDateStr(end) === dateStr;
    Db.append(SHEET.BLACKOUTS, {
      blackout_id: id,
      date: dateStr,
      scope_type: scopeType,
      scope_id: scopeId,
      from_time: sameDay ? minToTime(start.getHours() * 60 + start.getMinutes()) : '',
      to_time: sameDay ? minToTime(end.getHours() * 60 + end.getMinutes()) : '',
      note: title + ' (من التقويم)'
    });
    created++;
  });
  if (created) logInfo('syncBlockEvents', 'Created ' + created + ' blackout rows from calendar');
  return created;
}
