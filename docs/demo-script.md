# Demo script — 15 minutes, offline, no Google account

This is the walkthrough to run in front of the doctor. It uses `demo/patient.html`,
`demo/reception.html`, `demo/admin.html` and `demo/index.html`, which run the **real** system code
with only Google's storage faked. Nothing here needs the internet, an account, or a payment.

Read [Before you open your mouth](#before-you-open-your-mouth) once, then follow the run sheet.

---

## Before you open your mouth (5 minutes, once)

1. **Start it.**
   ```
   node tools/serve-demo.mjs
   ```
   Then open <http://localhost:8787/demo/>.

   Double-clicking `demo/patient.html` also works in Chrome/Edge. The server is recommended
   because it guarantees all demo pages share their data — that is what makes a booking appear on
   the reception screen. (I could not verify the double-click path in this environment.)

2. **Reset to a clean world.** On the launcher: **إعادة تعيين بيانات العرض**. Then open
   **صفحة المريض** once — that seeds the demo data.

3. **Open four tabs and leave them open:** the launcher, the patient page, the reception page, and
   the settings page. Demo credentials: staff **1234**, admin **admin123**, doctor PIN **123456**.

4. **Zoom the browser to 110–125%** so the Arabic is readable when the doctor stands behind you.

5. **Do one dry run** of the whole sheet below, then reset again. You want the clicks in your hands.

6. Know these two facts cold, because they explain half the demo:
   - The clock is **pinned** to the next Sunday 08:00 so a Thursday meeting still shows a live week.
   - The demo zeroes the **minimum notice** so today itself is bookable. Both are demo-data
     settings, not product rules — the launcher's *what is real vs simulated* table says so.
   - The demo also gives **Dr. 2 a Sunday afternoon window** (the placeholder rota has Dr. 1 on
     Sun/Wed and Dr. 2 on Mon/Tue, so no day would otherwise show two doctors to filter).

---

## The run sheet

| Clock | Screen | Clicks | Say (Arabic) | The point |
|---|---|---|---|---|
| 0:00 | Launcher | — | «ده النظام شغّال على اللابتوب ده دلوقتي. مفيش إنترنت، مفيش حساب، مفيش اشتراك.» | It exists and it costs nothing to run. |
| 0:30 | Launcher → بيانات العرض | scroll the four lists | «دي بيانات مبدئية مكانها في جدول عند المجمع، والقيم اللي بين قوسين هتتحوّل لبياناتكم بعد الاجتماع.» | Nothing is hard-coded; the clinic owns the settings. |
| 1:00 | Launcher → ما هو حقيقي وما هو محاكاة | read two rows only | «الكود اللي بيحدد المواعيد حقيقي. المخزّن بس اللي هنا محاكاة.» | Honesty up front; it protects the whole meeting. |
| 1:30 | Patient tab | الفرع → الطبيب → سبب الزيارة | «ده نفس اللينك اللي يتحط في البايو. المريض مش بيعمل حساب ومش بينزّل تطبيق.» | Zero friction for the patient. |
| 2:30 | Patient tab | the day strip (الأحد) then a time | «المواعيد المعروضة هي نوافذ الطبيب بس: الأحد والأربعاء من ٩ لـ ٤، و٨ مرضى في اليوم كحد أقصى.» | The doctor's rules are enforced, not suggested. |
| 3:30 | Patient tab | name → phone → confirm phone → consent → تأكيد | «رقم الجوال هو مفتاح المريض، وبيتأكد مرتين عشان ما يغلطش.» | The identity is the phone number. |
| 4:30 | Patient tab | read the confirmation card | «رقم الحجز بيبدأ بحروف الطبيب والتاريخ ورقمه في اليوم: `ae-20261018-1` يعني أول حجز للطبيب ده يوم ١٨ أكتوبر. وتحتيه زر كبير للاتصال بالاستقبال لو محتاج يعدّل، وبعده الموقع وإضافة للتقويم وزر واتساب.» | Instant confirmation, the reference is readable over the phone, and changing the appointment is one tap. |
| 5:30 | Reception tab | **reload**, then الأحد chip | «الموعد ظهر في شاشة الاستقبال بنفس اللحظة، بالرقم اللي المريض كتبه.» | No re-typing, no double entry. |
| 6:00 | Reception → التقويم المشترك | click a doctor label, then both | «الجدول ده يعرض كل الأطباء في نفس اليوم، ولون كل طبيب زي لونه في تقويم Google. اضغط على اسم أي طبيب لعرض مواعيده أو إخفائها — واحد أو أكثر — والاستقبال يركّز على طبيب واحد بضغطة.» | The shared schedule is filterable per doctor. |
| 6:30 | Reception card | **حضر** (accept the note prompt) | «حضر / لم يحضر / إلغاء / تغيير موعد — وكل تغيير بيتسجّل مين عمله وامتى.» | The daily reality of a clinic. |
| 7:30 | Reception → reports → search by phone | lunch the phone → بحث | «أي مريض يشيل تليفونه، تشوف تاريخه كامل: حضر كام مرة، ولم يحضر كام مرة.» | The history the doctor asked for. |
| 8:30 | Reception card | **تذكير بالموعد والموقع** (WhatsApp tap) | «الرسالة جاهزة بالعربي على رقم المريض — ومعاها عنوان الفرع ورابط الخريطة، فمفيش رسالتين: تذكير واحد بالمكان. الاستقبال بيدوس إرسال — مفيش ربط مدفوع بالواتساب.» | One tap = reminder + directions; no API, no separate message. |
| 9:30 | Reception → التقارير | **عرض المؤشرات** | «إجمالي الحجوزات، نسبة عدم الحضور، الأطباء، أسباب الزيارة، والساعات.» | The report the doctor actually reads. |
| 10:30 | Reception → التقارير → الأطباء | click **د. فلان**، then **عرض المؤشرات** again | «أقدر أطلّع تقرير طبيب واحد، أو اثنين أو ثلاثة مع بعض للمقارنة، أو كل الأطباء.» | The report is scoped to any set of doctors. |
| 11:00 | Reception → التقارير | **تصدير Excel** | «الملف بينزل xlsx حقيقي يفتح في Excel على طول، واسمه فيه أسماء الأطباء المختارين والتاريخ، فمفيش ملفين بيتلخبطوا.» | A real Excel file, named for what is inside it. |
| 12:00 | Reception → التقارير | **تصدير CSV** | «وفيه CSV كمان لو حد بيحب يفتحه بأي برنامج.» | Both formats exist; neither is a fudge. |
| 12:30 | Settings tab | **الجدول** → change a time → save; **الأطباء** → show the PIN control | «كل ده الفريق يغيّره من الموبايل: الفرع، الطبيب، مواعيده الأسبوعية، الإجازات، ونصوص الرسائل. مفيش كود ومفيش رجوع للمطوّر.» | The clinic owns the configuration after handover. |
| 13:15 | Settings → نظرة عامة | pause bookings, reload patient tab, show the pause screen, resume | «لو العيادة قافلة أو الطبيب مسافر، نوقف الحجز بزرار — والاستقبال يظل يعدّل المواعيد القائمة.» | Pause protects patients without freezing reception. |
| 13:45 | Launcher | scroll the calendar | «كل حجز بيدخل تقويم Google بلون الطبيب، والحجب والإجازات كمان بتظهر عليه.» | The doctor's own calendar stays the truth. |
| 14:15 | — | stop | «النظام ده كامل وعملي ومجاني. اللي محتاج قراركم هو الثلاثين بند في الورقة دي.» | Close on a decision, not on admiration. |

---

## Questions the doctor will ask

**How much does this cost?**
Nothing recurring: one free Google account, Google Sheets, Apps Script, Google Calendar.
No per-booking fee, no licence, no card. The web app is free at consumer limits.

**Where does the patient data live?**
In the clinic's own Google account, in a Sheet it owns — not with me, not with a vendor.
It can be exported to Excel at any time and the account can be handed over.

**What if Google or the internet is down?**
The reception screen stops updating and patients cannot book for that window; the bookings
already taken are still in the Sheet, and the phone still works. It is a hosted dependency —
say it plainly.

**Can patients book on WhatsApp directly?**
Not automatically — WhatsApp's business API is paid, and that is exactly the subscription we
avoided. The link goes in the WhatsApp business profile, and the clinic sends the confirmation
with one tap. That is why the message templates are built in. The reminder doubles as the
directions message: it carries the branch address, the map link and the ten-minutes-early note,
and it says اليوم / غداً / بعد غد by itself instead of assuming "tomorrow".

**Two patients tap the same slot at the same moment?**
Impossible: the final check runs inside a script lock, and the second booking is refused and
offered the next free slot.

**How is the booking number built?**
Doctor's letters, the appointment date, and the patient's number for that day: `ae-20261018-1` is
Dr. A.E.'s first booking on 18 October. The letters come from the `code` column in the Doctors
sheet, so the clinic chooses them; left empty, they are taken from the doctor's name.

**Can we import our old records?**
Not in this build — reports start from day one. If the clinic can produce an old list as a
Sheet, it can be pasted into the Bookings sheet in one pass; I would need a sample first.

**Can I get a report for one doctor, or compare two of them?**
Yes. In التقارير → الأطباء, tick one doctor, several, or leave «كل الأطباء», then تصدير Excel.
The indicators on screen follow the same selection, so the numbers and the file always agree.
With several doctors ticked the rows are grouped per doctor, and the file name states the scope
and the minute it was made (`تقرير-الحجوزات-مقارنة-2-أطباء-2026-10-18-0800.xlsx`), so two exports
never overwrite or confuse each other.

**Do we need new devices?**
No. Any browser. The reception screen works on a phone; only the initial setup needs a computer.

**What if the doctor changes his hours or adds a branch?**
Open **الإعدادات** (`?page=admin`) → **الجدول** or **الفروع**. The change is live immediately; no
deploy and no code. A doctor can also change their own hours with their PIN, scoped to their
schedule only.

**Who can see the patient list?**
Anyone with the reception link plus the staff code. The settings page does not show patient data;
doctors see only their own availability, not bookings. Keep all three codes private — staff, admin,
and each doctor PIN — change them from the defaults, and treat the Sheet like the appointments book
it replaces.

---

## Traps that would make this demo look bad

- **Do not demo the live Google version on a weekday with no availability.** The seeded rule is
  *Sunday + Wednesday*; on a Thursday the doctor sees "no slots". Use the offline demo, whose
  clock is pinned.
- **Reception does not auto-refresh.** Book first, then reload the reception tab. In the real
  system staff press **اليوم**. Do not let the doctor see an empty board right after a booking.
- **Reset before you start.** Leftover test bookings from your rehearsal will show up.
- **The demo's doctor codes are demo data.** The seeded doctors are placeholders, so their booking
  letters are set to `ae` and `ms` in the runtime. In the real system they come from the `code`
  column — say that, or the doctor may think his own initials are wrong.
- **Excel export is real in both places now.** The offline demo builds a genuine `.xlsx` in the
  browser; the live system builds it in the clinic's Drive. Neither is a CSV with an `.xlsx` name —
  `node tools/check-xlsx.mjs` proves it against a real ZIP reader. The download lands in the
  browser's downloads folder; on the launcher's table this is listed as *simulated* only because
  Drive is simulated.
- **The admin and doctor codes are demo-only.** Settings demo code `admin123`, doctor PIN `123456`.
  In the real clinic the first settings visit creates a separate admin code from the staff code, and
  each doctor PIN is set by the admin. Do not read either code aloud as if it were live.
- **A comparison export needs two doctors ticked, or the URL.** Ticking every doctor collapses back
  to «كل الأطباء» on purpose — it is the same scope, and the file name says `كل-الأطباء`. With only
  two demo doctors, use the URL form (`&doctor=D1,D2`) if you want to show a `مقارنة-2-أطباء` file.
- **The reminder button carries the location.** There is no separate "العنوان والموقع" button any more:
  تذكير بالموعد والموقع sends the appointment details, the branch address and the map link in one
  message. If the placeholders `[العنوان الأول]` / `[رابط الخريطة]` are still in the Clinics sheet,
  the demo shows exactly that text — real values come from the doctor meeting (checklist items 5–6).
- **Do not promise** automatic WhatsApp, SMS reminders, online payment, or importing the old
  archive. None of them are in this build.
- **Do not use real patient data** in this offline demo.

---

## The close (what you ask for)

1. Approval of a **two-week pilot** on real hours, with one branch and the clinics' real reasons.
2. The doctor-only values: checklist items **11–17** (reasons, durations, hours per reason, caps,
   overrides) and a native review of **26–27** (the WhatsApp wording and the questionnaire text).
3. One name as the **reception owner** for the daily screen.
4. The clinic **WhatsApp number** the patients will reply to, and the staff code owner.
5. Who holds the **admin code** and which doctors get self-service PINs (checklist 32–33).
6. Who creates the **clinic Google account** — this is the only step that must happen before
   anything is live; `docs/setup-guide.md` walks through it.

Then go live in this order: create the account → paste the files → run `setupEverything()` →
fill the config sheets → change the staff code → deploy → the end-to-end check in the setup guide
→ print the `/exec` link as a QR for the desk.

---

## Start over

Launcher → **إعادة تعيين بيانات العرض** → open **صفحة المريض**. The world reseeds itself.
