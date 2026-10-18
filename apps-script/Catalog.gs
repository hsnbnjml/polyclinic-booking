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
    windowDays: Number(s[SETTING.BOOKING_WINDOW_DAYS]) || 14
  };
}

function getBootstrap() {
  const config = getPublicConfig();
  const clinics = Db.rows(SHEET.CLINICS)
    .filter(isActive)
    .map(function (c) {
      return { id: str(c.clinic_id), nameAr: str(c.name_ar), addressAr: str(c.address_ar) };
    });

  const doctors = Db.rows(SHEET.DOCTORS).filter(isActive).map(function (d) {
    return {
      id: str(d.doctor_id),
      nameAr: str(d.name_ar),
      specialtyAr: str(d.specialty_ar),
      clinicIds: str(d.clinic_ids).split(',').map(function (s) { return s.trim(); }).filter(Boolean)
    };
  });

  const availability = Db.rows(SHEET.AVAILABILITY).filter(isActive);
  const reasons = Db.rows(SHEET.REASONS).filter(isActive)
    .sort(function (a, b) { return (Number(a.sort_order) || 99) - (Number(b.sort_order) || 99); })
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
