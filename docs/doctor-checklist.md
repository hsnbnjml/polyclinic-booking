# What we need from the clinic (placeholders to replace)

Every `[bracket]` value below is a placeholder currently sitting in the code or the seed data.
Nothing else needs to be invented by the clinic — only these. All of them can be entered from the
**الإعدادات** page after the first deployment; the sheet and column names below say where the value
actually lives.

## The meeting checklist

| # | Item | Where it goes | Example | Owner |
|---|------|---------------|---------|-------|
| 1 | Clinic/brand name as patients should see it | Settings → `clinic_name` (currently `[اسم المجمع الطبي]`) | مجمع الشفاء الطبي | Management |
| 2 | Branch name(s) | Clinics → `name_ar` (`C1`, `C2`) | فرع المعادي | Management |
| 3 | Branch address as a full line | Clinics → `address_ar` | ١٢ شارع ٩، المعادي، القاهرة | Management |
| 4 | Google Maps link per branch | Clinics → `map_link` | `https://maps.google.com/?q=…` | Management |
| 5 | Branch phone | Clinics → `phone` | 02xxxxxxxx | Management |
| 6 | Reception hours as text | Clinics → `working_hours_ar` | يومياً 9ص – 9م | Management |
| 7 | Doctor full name + title | Doctors → `name_ar` | د. أحمد سمير | Management |
| 8 | Doctor specialty | Doctors → `specialty_ar` | باطنة وأمراض القلب | Management |
| 9 | Which branch each doctor serves | Doctors → `clinic_ids` | `C1,C2` | Management |
| 10 | Colour per doctor on the calendar | Doctors → `color` | teal / blue / purple | Us |
| 11 | Approved visit reasons | Reasons → `name_ar` | فحص أولي / استشارة / متابعة | **Doctor** |
| 12 | Duration of each visit type | Reasons → `duration_min` | 45 / 30 / 15 | **Doctor** |
| 13 | Minimum notice before booking | Reasons → `lead_hours` | 12 ساعة للفحص | **Doctor** |
| 14 | How far ahead patients may book | Reasons → `book_days_ahead` | 21 يوماً | **Doctor** |
| 15 | Daily cap per visit type | Reasons → `max_per_day` | 8 مرضى | **Doctor** |
| 16 | Each doctor's hours per visit reason | Availability rows | الأحد والأربعاء 09:00–16:00 | **Doctor** |
| 17 | Any weekday overrides | Availability → `max_per_day_override` | الأحد 6 فقط | **Doctor** |
| 18 | Holidays and closures | Blackouts → `date` | `2026-10-30..2026-11-01` | Management |
| 19 | Who maintains holidays/blocks | process, not data | الاستقبال | Management |
| 20 | Clinic WhatsApp number (patients reply to it) | **الإعدادات → الإعدادات → رقم واتساب** | +20…| Management |
| 21 | Reception phone for calls | **الإعدادات → الإعدادات → رقم الاستقبال** | 02xxxxxxxx | Management |
| 22 | Reports email address | **الإعدادات → الإعدادات → بريد التقارير** | reports@… | Management |
| 23 | Staff code (reception screen password) | **الإعدادات → الإعدادات → كود الاستقبال** | 6+ characters, not the default | Us + Management |
| 24 | Consent wording shown to patients | **الإعدادات → النصوص → نص الموافقة** | (see below) | Management + legal |
| 25 | Success message after booking | **الإعدادات → النصوص → رسالة النجاح** | تم حجز موعدك… | Management |
| 26 | Arabic wording of the WhatsApp messages | **الإعدادات → رسائل واتساب** | (see below) | **Native reviewer** |
| 27 | Remaining questionnaire labels and hints | **الإعدادات → النصوص** where available; the rest `I18n.gs` → `AR` | (see below) | **Native reviewer** |
| 28 | Logo image URL (optional) | **الإعدادات → الإعدادات → رابط الشعار** | Drive/Sheets image link | Management |
| 29 | Brand colours | **الإعدادات → الإعدادات** | `#0f6f6c` / `#f4f7f7` | Management |
| 30 | Reception staff who will run the daily screen | process, not data | 1–2 names | Management |
| 31 | Booking-reference initials per doctor (optional, 2 Latin letters) | **الإعدادات → الأطباء → كود الحجز** | `AE` for د. أشرف الزماني → رقم الحجز `ae-20261018-1` | Us + Management |
| 32 | Separate admin code for the settings page | **الإعدادات** first visit (bootstrap from the staff code) | 6+ characters, different from staff code and doctor PINs | Us + Management |
| 33 | Which doctors get a self-service PIN | **الإعدادات → الأطباء → كود الدخول** | 4–8 digits per doctor; optional | Management |
| 34 | Wording shown while bookings are paused | **الإعدادات → نظرة عامة → إيقاف الحجز مؤقتاً** | «الحجز متوقف مؤقتاً…» | Management |
| 35 | Who verifies the weekly backup and the on-demand copy | process, not data | one named person | Management |
| 36 | Review of the Arabic admin guide | `docs/admin-guide-ar.md` | mark unclear steps | Us + Management |

The four WhatsApp templates currently seeded, to be reviewed and reworded:

1. **تأكيد الحجز** — patient, doctor, date, time, reason, booking reference.
2. **تذكير بالموعد والموقع** — the day-before reminder (the wording adapts: اليوم / غداً / بعد غد), the
   appointment details, the branch address and the map link, plus "come 10 minutes early".
3. **تغيير الموعد** — new date and time.
4. **إلغاء الموعد** — cancelled appointment plus an invitation to rebook.

There is no separate "العنوان والموقع" message any more: it was merged into the reminder, so the
reception sends one message for both. Both the address and the map link come from the Clinics sheet;
if a branch has neither, the location lines disappear from the message entirely.

## What the clinic can change without a developer

After the first setup, **الإعدادات** (`/exec?page=admin`) covers:

- branches, doctors, visit reasons and their order;
- weekly availability per doctor × branch × reason, including multiple weekdays at once;
- holidays / closures, whole-day or partial, for the clinic, a branch or one doctor;
- WhatsApp message wording, patient-page text, brand name/colours/logo, contact numbers and
  booking window;
- pausing new bookings with a custom patient message (reception can still manage existing ones);
- staff/admin codes, and resetting a doctor's PIN;
- on-demand backup and the audit log.

Archiving hides a branch, doctor or reason from new bookings without deleting history. The settings
page never shows patient data. See `docs/admin-guide-ar.md` for the click-by-click guide.

## Questions that decide behaviour (not just data)

| Question | Options | Who decides |
|----------|---------|-------------|
| Can a patient book two appointment types on the same day? | allowed / blocked | Doctor |
| Do we accept a booking when the phone number belongs to a family member? | separate records / one record | Management |
| Maximum future bookings per phone number (currently 3) | 1–5 | Management |
| Do we call to confirm new bookings, or accept them as final? | instant (current) / call-back | Management |
| What counts as "late" before a slot is released? | policy only, not enforced | Doctor |
| Is a walk-in allowed to occupy a slot? | policy only | Management |

## Decisions already locked with the clinic's technical side

| Decision | Choice |
|----------|--------|
| Platform | Google Sheet + Apps Script web app (no paid tier) |
| Patient identity | phone number mandatory; name optional |
| Confirmation | instant, reception may cancel or reschedule afterwards |
| Reminders | manual WhatsApp templates fired by staff |
| Calendars | one shared clinic calendar, colour-coded per doctor |
| Language | Arabic only, RTL |
| Slot capacity | one patient per slot per doctor |
| Legacy history | not imported; reports start from launch |

## Ready to launch, with placeholders still in place?

Yes — the system is walkable end-to-end with placeholder data, which is exactly how the internal
trial (technical plan, phase 3) should run. Items **11–17** (the doctor's own rules) and **26–27**
(native Arabic copy review) are the content blockers for the public link. Item **32** (the separate
admin code) is not a patient blocker, but set it before handing the settings page to the clinic.

Item **31** is optional: without it the booking reference is guessed from the doctor's name
(`د. أشرف الزماني` → `aa-20261018-1`, because Arabic 'ا' can be a, e or i). Write the two letters
the clinic actually uses and the reference matches what patients read back over the phone.
