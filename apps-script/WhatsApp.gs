/**
 * WhatsApp.gs — manual WhatsApp, by design.
 *
 * No API, no cost. Staff tap a link; WhatsApp opens with the Arabic message
 * pre-filled to that patient's number. Every tap is stamped on the booking row
 * (wa_sent_at / wa_template) so "did anyone remind this patient?" is answerable.
 */

/** wa.me needs digits only, country code included, no plus sign. */
function waNumberFrom(phoneNorm) {
  return String(phoneNorm || '').replace(/\D/g, '');
}

function waLink(phoneNorm, text) {
  const num = waNumberFrom(phoneNorm);
  if (!num) return '';
  return 'https://wa.me/' + num + '?text=' + encodeURIComponent(text);
}

/** Variables available to every template for one booking. */
function templateVars(booking) {
  const doctor = Db.findById(SHEET.DOCTORS, 'doctor_id', str(booking.doctor_id)) || {};
  const clinic = Db.findById(SHEET.CLINICS, 'clinic_id', str(booking.clinic_id)) || {};
  const reason = Db.findById(SHEET.REASONS, 'reason_id', str(booking.reason_id)) || {};
  const startMin = parseTimeToMin(booking.start_time);
  const dateStr = str(booking.date);

  // The location part of a message, ready to drop in: gone completely when the clinic
  // has not filled its address and map link yet, so no template ever shows a bare "📍".
  const addressBlock =
    (str(clinic.address_ar) ? '📍 ' + str(clinic.address_ar) + '\n' : '') +
    (str(clinic.map_link) ? 'الموقع على الخريطة:\n' + str(clinic.map_link) + '\n\n' : '');

  return {
    name: str(booking.name) || 'عميلنا',
    bookingId: str(booking.booking_id),
    doctor: str(doctor.name_ar),
    clinic: str(clinic.name_ar),
    address: str(clinic.address_ar),
    mapLink: str(clinic.map_link),
    addressBlock: addressBlock,
    reason: str(reason.name_ar),
    dateAr: formatDateAr(dateStr),
    whenAr: relativeDayAr(dateStr),
    timeAr: startMin === null ? '' : minToTimeAr(startMin),
    phone: str(booking.phone_norm)
  };
}

/** Every ready-to-tap link for one booking, in the order staff needs them. */
function waLinksFor(booking) {
  const vars = templateVars(booking);
  const phone = str(booking.phone_norm);
  const order = ['confirm', 'remind24', 'reschedule', 'cancel'];
  return order.map(function (key) {
    const tpl = WA_TEMPLATES[key];
    return {
      key: key,
      labelAr: tpl.labelAr,
      text: renderTemplate(tpl.text, vars),
      url: waLink(phone, renderTemplate(tpl.text, vars))
    };
  });
}

/** Text a patient can paste into any calendar app, plus a Google Calendar link. */
function calendarLinksFor(booking) {
  const startMin = parseTimeToMin(booking.start_time);
  const endMin = parseTimeToMin(booking.end_time);
  if (startMin === null || endMin === null) return { googleUrl: '', text: '' };
  const base = parseDateStr(str(booking.date));
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(startMin / 60), startMin % 60);
  const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(endMin / 60), endMin % 60);
  const stamp = function (d) {
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
      'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + '00Z';
  };
  const doctor = Db.findById(SHEET.DOCTORS, 'doctor_id', str(booking.doctor_id)) || {};
  const clinic = Db.findById(SHEET.CLINICS, 'clinic_id', str(booking.clinic_id)) || {};
  const reason = Db.findById(SHEET.REASONS, 'reason_id', str(booking.reason_id)) || {};
  const title = 'موعد ' + str(reason.name_ar) + ' — ' + str(doctor.name_ar);
  const params = [
    'action=TEMPLATE',
    'text=' + encodeURIComponent(title),
    'dates=' + stamp(start) + '/' + stamp(end),
    'details=' + encodeURIComponent('رقم الحجز: ' + str(booking.booking_id)),
    'location=' + encodeURIComponent(str(clinic.address_ar))
  ].join('&');
  return {
    googleUrl: 'https://calendar.google.com/calendar/render?' + params,
    text: title + '\n' + formatDateAr(str(booking.date)) + ' ' + minToTimeAr(startMin)
  };
}

function markWhatsAppSent(bookingId, templateKey) {
  const booking = Db.findById(SHEET.BOOKINGS, 'booking_id', bookingId);
  if (!booking) return { ok: false, error: 'NOT_FOUND' };
  Db.update(SHEET.BOOKINGS, 'booking_id', bookingId, {
    wa_sent_at: new Date().toISOString(),
    wa_template: str(templateKey)
  });
  return { ok: true };
}
