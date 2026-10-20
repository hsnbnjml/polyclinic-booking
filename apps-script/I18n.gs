/**
 * I18n.gs — every Arabic string in one place.
 *
 * The clinic will want to change wording. That must be a copy edit here (or in
 * the Settings sheet) and never a code change. Get a native review pass before
 * launch: especially the consent line and the WhatsApp templates.
 */

const AR = {
  pageTitle: 'حجز موعد',
  step: 'خطوة',
  of: 'من',
  chooseClinic: 'اختر الفرع',
  chooseDoctor: 'اختر الطبيب',
  chooseReason: 'سبب الزيارة',
  chooseTime: 'اختر الموعد المناسب',
  yourDetails: 'بياناتك',
  name: 'الاسم',
  nameHint: 'اختياري — يساعد الطاقم على تنظيم الاستقبال',
  phone: 'رقم الجوال',
  phoneHint: 'مطلوب — سنتواصل معك على واتساب على هذا الرقم',
  phoneConfirm: 'تأكيد رقم الجوال',
  phoneConfirmHint: 'أعد كتابة الرقم للتأكد',
  extra: 'ملاحظة للطبيب (اختياري)',
  consent: 'الموافقة',
  submit: 'تأكيد الحجز',
  next: 'التالي',
  back: 'رجوع',
  loading: 'جاري التحميل…',
  noSlots: 'لا توجد مواعيد متاحة حالياً لهذا الاختيار. جرّب طبيباً آخر أو عد لاحقاً.',
  slotTaken: 'للأسف تم حجز هذا الموعد للتو. اختر موعداً آخر من القائمة.',
  summary: 'ملخص الموعد',
  doctor: 'الطبيب',
  clinic: 'الفرع',
  reason: 'سبب الزيارة',
  date: 'التاريخ',
  time: 'الوقت',
  duration: 'المدة',
  minutes: 'دقيقة',
  address: 'العنوان',
  openMap: 'افتح الموقع على الخريطة',
  callClinic: 'اتصل بالاستقبال',
  whatsappClinic: 'تواصل واتساب',
  bookingRef: 'رقم الحجز',
  addToCalendar: 'أضف الموعد إلى تقويمك',
  errors: {
    MISSING_FIELDS: 'من فضلك أكمل كل الخطوات.',
    CONSENT_REQUIRED: 'لا يمكن إتمام الحجز بدون الموافقة.',
    PHONE_REQUIRED: 'رقم الجوال مطلوب.',
    PHONE_INVALID: 'رقم الجوال غير صحيح. اكتبه بالصيغة 01xxxxxxxxx.',
    PHONE_MISMATCH: 'رقم الجوال وتأكيده غير متطابقين.',
    SLOT_TAKEN: 'للأسف تم حجز هذا الموعد للتو. اختر موعداً آخر.',
    TOO_MANY_ACTIVE: 'لديك الحد الأقصى من المواعيد المحجوزة. تواصل مع الاستقبال.',
    BUSY: 'النظام مشغول، حاول مرة أخرى بعد لحظات.',
    REJECTED: 'تعذّر إتمام الحجز. تواصل مع الاستقبال.',
    DOCTOR_NOT_IN_CLINIC: 'هذا الطبيب لا يعمل في الفرع المختار.',
    NOT_FOUND: 'لم يتم العثور على البيانات.',
    STAFF_CODE: 'كود الاستقبال غير صحيح.',
    STAFF_ONLY: 'هذه العملية متاحة للاستقبال فقط.',
    BOOKINGS_PAUSED: 'الحجز متوقف مؤقتاً. تواصل مع الاستقبال.',
    GENERIC: 'حدث خطأ غير متوقع. حاول مرة أخرى أو اتصل بالاستقبال.'
  }
};

/** WhatsApp templates. {placeholders} are filled by renderTemplate(). */
const WA_TEMPLATES = {
  confirm: {
    labelAr: 'تأكيد الحجز',
    text:
      'مرحباً {name} 👋\n' +
      'تم تأكيد موعدك في {clinic}.\n\n' +
      '👨‍⚕️ الطبيب: {doctor}\n' +
      '🗓️ {dateAr}\n' +
      '⏰ {timeAr}\n' +
      '📋 {reason}\n\n' +
      'لتعديل أو إلغاء الموعد، ردّ على هذه الرسالة.\n' +
      'رقم الحجز: {bookingId}'
  },
  /**
   * One message, one tap: the reminder the reception sends the day before now carries
   * the clinic's address and the map link too, so a patient asking "where exactly are
   * you?" gets the same button. {addressBlock} disappears entirely when the clinic has
   * not filled its address in — no dangling "📍" line.
   */
  remind24: {
    labelAr: 'تذكير بالموعد والموقع',
    text:
      'تذكير بموعدك {whenAr} في {clinic} 🌟\n\n' +
      '🗓️ {dateAr}\n' +
      '⏰ {timeAr}\n' +
      '👨‍⚕️ {doctor}\n\n' +
      '{addressBlock}' +
      'برجاء الوصول قبل الموعد بعشر دقائق. لو مش هتقدر تجي، بلّغنا من فضلك.'
  },
  reschedule: {
    labelAr: 'تغيير الموعد',
    text:
      'مرحباً {name}، تم تغيير موعدك في {clinic} 🔁\n\n' +
      'الموعد الجديد:\n🗓️ {dateAr}\n⏰ {timeAr}\n👨‍⚕️ {doctor}\n\n' +
      'رقم الحجز: {bookingId}'
  },
  cancel: {
    labelAr: 'إلغاء الموعد',
    text:
      'مرحباً {name}، تم إلغاء موعدك في {clinic} بتاريخ {dateAr} ⏰ {timeAr}.\n\n' +
      'لو تحب تحجز موعداً آخر، تفضل بالدخول على رابط الحجز أو كلّمنا على هذا الرقم.\n\n' +
      'رقم الحجز: {bookingId}'
  }
};

function renderTemplate(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, function (match, key) {
    return vars[key] === undefined || vars[key] === null ? '' : String(vars[key]);
  });
}

/**
 * Arabic label for a stored `wa_template` key, so the reception and the doctor read
 * "تذكير بالموعد والموقع" instead of a code. Unknown keys (an older row) are shown
 * unchanged rather than blanked out.
 */
function waTemplateLabelAr(key) {
  const k = str(key);
  if (!k) return '';
  return WA_TEMPLATES[k] ? WA_TEMPLATES[k].labelAr : k;
}

function errorMessageAr(code) {
  if (code === 'SLOT_TAKEN') {
    const custom = str(getSettings()[SETTING.SLOT_TAKEN_TEXT_AR]);
    if (custom) return custom;
  }
  return AR.errors[code] || AR.errors.GENERIC;
}
