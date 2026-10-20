/**
 * Catalog.gs — the public data the booking page is allowed to see.
 *
 * Nothing here is patient data. This is what a stranger with the link can read,
 * so keep it to names, hours and colors.
 */

function getPublicConfig() {
  const s = getSettings();
  return {
    clinicName: s[SETTING.CLINIC_NAME],
    brandPrimary: s[SETTING.BRAND_PRIMARY],
    brandSecondary: s[SETTING.BRAND_SECONDARY],
    logoUrl: s[SETTING.LOGO_URL],
    whatsappNumber: s[SETTING.WHATSAPP_NUMBER],
    supportPhone: s[SETTING.SUPPORT_PHONE],
    consentText: s[SETTING.CONSENT_TEXT_AR],
    successText: s[SETTING.SUCCESS_TEXT_AR],
    bookingsPaused: isTrue(s[SETTING.BOOKINGS_PAUSED]),
    pauseMessage: str(s[SETTING.PAUSE_MESSAGE_AR]) || SETTING_DEFAULTS[SETTING.PAUSE_MESSAGE_AR],
    texts: {
      subtitle: str(s[SETTING.BOOKING_SUBTITLE_AR]) || SETTING_DEFAULTS[SETTING.BOOKING_SUBTITLE_AR],
      nameHint: str(s[SETTING.NAME_HINT_AR]) || SETTING_DEFAULTS[SETTING.NAME_HINT_AR],
      phoneHint: str(s[SETTING.PHONE_HINT_AR]) || SETTING_DEFAULTS[SETTING.PHONE_HINT_AR],
      extraLabel: str(s[SETTING.EXTRA_LABEL_AR]) || SETTING_DEFAULTS[SETTING.EXTRA_LABEL_AR],
      noSlots: str(s[SETTING.NO_SLOTS_TEXT_AR]) || SETTING_DEFAULTS[SETTING.NO_SLOTS_TEXT_AR],
      slotTaken: str(s[SETTING.SLOT_TAKEN_TEXT_AR]) || SETTING_DEFAULTS[SETTING.SLOT_TAKEN_TEXT_AR]
    },
    windowDays: Number(s[SETTING.BOOKING_WINDOW_DAYS]) || 14
  };
}

function getBootstrap() {
  const config = getPublicConfig();
  const clinics = sortRowsByOrder(Db.rows(SHEET.CLINICS).filter(isActive))
    .map(function (c) {
      return { id: str(c.clinic_id), nameAr: str(c.name_ar), addressAr: str(c.address_ar) };
    });

  const doctors = sortRowsByOrder(Db.rows(SHEET.DOCTORS).filter(isActive)).map(function (d) {
    return {
      id: str(d.doctor_id),
      nameAr: str(d.name_ar),
      specialtyAr: str(d.specialty_ar),
      clinicIds: str(d.clinic_ids).split(',').map(function (s) { return s.trim(); }).filter(Boolean)
    };
  });

  const availability = Db.rows(SHEET.AVAILABILITY).filter(isActive);
  const reasons = sortRowsByOrder(Db.rows(SHEET.REASONS).filter(isActive))
    .map(function (r) {
      return {
        id: str(r.reason_id),
        nameAr: str(r.name_ar),
        descriptionAr: str(r.description_ar),
        durationMin: Number(r.duration_min) || 30,
        // which doctors can serve this reason, and where
        links: availability
          .filter(function (a) { return str(a.reason_id) === str(r.reason_id); })
          .map(function (a) { return { doctorId: str(a.doctor_id), clinicId: str(a.clinic_id) }; })
          .filter(function (v, i, arr) {
            return arr.findIndex(function (x) {
              return x.doctorId === v.doctorId && x.clinicId === v.clinicId;
            }) === i;
          })
      };
    });

  return { ok: true, config: config, clinics: clinics, doctors: doctors, reasons: reasons };
}
