# PolyClinic — حجز وإدارة مواعيد العيادات

[![CI](https://github.com/hsnbnjml/polyclinic-booking/actions/workflows/ci.yml/badge.svg)](https://github.com/hsnbnjml/polyclinic-booking/actions/workflows/ci.yml)
[![Demo](https://img.shields.io/badge/demo-open%20the%20offline%20copy-2f855a)](https://hsnbnjml.github.io/polyclinic-booking/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Appointment booking, scheduling and patient history for a polyclinic, with **no server and no
subscription**: a Google Sheet is the database and an Apps Script web app is the product. There is
no per-booking fee and no third-party scheduler in the middle — the clinic's rules are the code.

<div dir="rtl">

**بالعربي:** نظام حجز وإدارة مواعيد لعيادة متعددة التخصصات، مبني على Google Sheets + Apps Script — بلا سيرفر وبلا اشتراك وبلا رسوم على كل حجز.

- **المريض**: رابط واحد → الفرع → الطبيب → سبب الزيارة → المواعيد المتاحة فعلياً من جدول ذلك الطبيب → الاسم والجوال → تأكيد فوري برقم حجز مقروء مثل `ae-20261018-1`.
- **الاستقبال**: شاشة اليوم، تقويم مشترك لكل الأطباء بألوان، تصفية بطبيب أو أكثر بضغطة، حضور / لم يحضر / إلغاء / تغيير موعد، إغلاق أوقات أو أيام، بحث عن أي مريض برقم الجوال، وتصدير Excel حقيقي.
- **الطبيب**: تقرير مصفّى بطبيب واحد أو عدة أطباء للمقارنة، مؤشرات أداء، ونسخة احتياطية أسبوعية تلقائية على Drive.
- **الإدارة**: صفحة إعدادات عربية داخل نفس التطبيق: الفروع، الأطباء، أسباب الزيارة، الجدول الأسبوعي، الإجازات، نصوص الرسائل وصفحة المريض، إيقاف الحجز مؤقتاً، النسخ الاحتياطي، وسجل التعديلات — بلا مطوّر. لكل طبيب كود دخول يعدّل به جدوله فقط.
- **كتطبيق**: يُضاف إلى شاشة الجوال الرئيسية بأيقونة العيادة ويفتح كتطبيق كامل الشاشة بلا شريط متصفح (صفحة `pwa/`) — وبلا شريط Google التعريفي «أنشأ هذا التطبيق أحد مستخدمي Apps Script» الظاهر على الرابط المباشر.

عرض توضيحي ببيانات وهمية (بلا حساب Google): <https://hsnbnjml.github.io/polyclinic-booking/>

</div>

```
patient link  →  clinic → doctor → reason → the doctor's real free times → phone → confirmation
                                      │
                                      ▼
                        Bookings sheet  ──▶  shared clinic calendar
                                      │
                                      ▼
                     Excel / CSV reports + KPIs + weekly Drive backup
```

## What it does

| Area | Details |
|---|---|
| Booking | 5 steps, Arabic RTL, phone typed twice, consent, honeypot; **one patient per slot**, enforced under a script lock |
| Rules | Availability windows per doctor × clinic × reason, per-reason duration, minimum notice, blackouts (one date or `start..end`), daily caps, booking horizon |
| Reference | Doctor initials + date + the day's running number — `ae-20261018-1` — computed inside the lock so two patients never share one |
| Reception | Day board, shared colour-coded doctor schedule with per-doctor filters (one or several), statuses, reschedule, block time, patient lookup by phone, audit trail of who changed what |
| WhatsApp | Four ready Arabic templates sent with one tap; the reminder carries the branch address and map link and says اليوم / غداً / بعد غد by itself; the wording is editable from the settings page |
| Reports | Real `.xlsx` and CSV, KPI summary, in-sheet report tabs; scoped to one doctor, any few of them for comparison, or all |
| Admin | Arabic settings page for branches, doctors, reasons, weekly hours, holidays, WhatsApp copy, patient-page copy, pause, backup, audit; archive instead of delete; separate staff/admin codes; per-doctor PINs scope a doctor to their own schedule |
| Design | One colour in the sheet drives the whole palette (derived darks, tints, press states, focus rings); Cairo type, thumb-first targets, 150–220 ms motion that honours reduced-motion |
| Automation | Shared Google Calendar mirror, `BLOCK` event → blackout sync, daily agenda e-mail, weekly backup (dated master copy + exported file) |
| Privacy | The spreadsheet stays private; the public web app never returns patient data — the catalogue endpoint is patient-free by construction. Doctor PINs are hashed in a separate `Access` sheet; the admin payload never returns a hash or salt |

## Try the demo

The demo runs the **real** system code in the browser — the same slot engine, the same staff
actions, the same report columns — with only Google's storage faked. No account, no deployment.

- Online (fake data, published from this repo): <https://hsnbnjml.github.io/polyclinic-booking/>
- Locally (recommended when presenting — all four pages share one storage, so a booking made in
  the patient page appears on the reception screen and in the settings page):

```
node tools/serve-demo.mjs      # then open http://localhost:8787/demo/
```

The launcher carries the *what is real vs simulated* table. `docs/demo-script.md` is the click
order, the talking points, the doctor's likely questions and the traps. Demo credentials:
staff `1234`, admin `admin123`, doctor PIN `123456`.

The demo pages are generated from `apps-script/`, so regenerate them after any change:

```
node tools/build-demo.mjs
```

It compiles every `.gs` file as part of the build, so a syntax error fails the build instead of the
demo. CI fails too if the committed demo no longer matches the sources.

## Install it as an app (optional)

Google serves the app from its own page, so the tab icon and the browser bars are Google's, not the
clinic's. `pwa/` is a small page the clinic owns: it frames the live app full-screen and carries the
web-app manifest and the icons — which is exactly what a phone installs.

```
node tools/build-pwa.mjs      # bakes the live URL in; writes dist/pwa/ (git-ignored)
```

Upload `dist/pwa/` to any static host (Cloudflare Pages recommended: free, no card, commercial use
allowed). The shell forwards `?page=staff` and `?page=admin`, so the installed app opens the
reception screen and the settings page too. Android: open the link → ⋮ → *Add to Home screen*.
iPhone: open in **Safari** → Share → *Add to Home Screen*. The icon is a placeholder medical plus in
the brand teal (`pwa/icons/icon.svg`) until the clinic's real logo replaces it. Full walkthrough:
`pwa/README.md`.

## Repository layout

| Path | What it is |
|---|---|
| `apps-script/` | the whole application — 15 `.gs` files + 5 HTML views + `appsscript.json` |
| `pwa/` | installable app shell + clinic icons — the page a phone installs, so the icon and the standalone window are the clinic's, not Google's |
| `docs/` | proposal (Arabic and English), technical plan, setup guide, doctor checklist, demo script |
| `demo/` | the offline demo: launcher, patient page, reception screen, settings page (generated, committed so Pages can publish it) |
| `tools/local-test.mjs` | runs the real `.gs` source against an in-memory fake of Google's services |
| `tools/check-html.mjs` | front-end wiring: script parsing, includes, server-function names, Arabic template placeholders |
| `tools/check-xlsx.mjs` | proves the Excel export is a real `.xlsx` (own ZIP reader **and** .NET's, every CRC and XML part) |
| `tools/build-demo.mjs` | builds the demo from the real sources |
| `tools/build-pwa.mjs` | fills the live URL into the installable app shell and writes `dist/pwa/` for upload (never committed — it carries the live URL) |
| `tools/xlsx-writer.js` | dependency-free OOXML writer — no npm packages anywhere in this repo |
| `tools/demo-runtime.js` | the browser runtime that fakes Google's storage for the demo |
| `tools/serve-demo.mjs` | tiny static server (optional; the pages also work from `file://`) |

## Run the checks

```
node tools/local-test.mjs     # 200 behavioural assertions
node tools/check-html.mjs     # front-end and wiring checks
node tools/check-xlsx.mjs     # the Excel export is a real .xlsx (needs PowerShell)
```

There are no dependencies and nothing to install. The suite loads the actual Apps Script files
(nothing is mocked at the logic level) and fakes only the Google services: spreadsheets, calendar,
mail, drive, locks. It covers what would hurt in production — one patient per slot, double-tap
idempotency, cancel freeing a slot, reschedule preserving history, blackout scoping, daily caps,
phone normalisation of Arabic-Indic digits, the admin/doctor access split, settings validation,
schedule blocks, pause, backups, and that the public catalogue never leaks patient data.

Because those rules depend on "now", CI runs the same suite in three time zones spanning the whole
day (UTC−12, UTC, UTC+14), so an assertion that only holds at one time of day fails the build.

## Deploy for a real clinic

`docs/setup-guide.md` has every step and the verification pass. The short version:

1. The clinic's Google account → new Sheet → **Extensions → Apps Script** → paste all files
   (or `clasp push`).
2. Paste `appsscript.json` from this repo (Project Settings → show manifest).
3. Run `setupEverything()` once and approve permissions — it creates the sheets, seeds the
   configuration, makes the calendar and the backup folder, and installs the triggers.
4. Fill the clinic data from `/exec?page=admin` (or the sheets directly), and change
   `staff_code`.
5. **Deploy → New deployment → Web app** → *Execute as me*, *Anyone*.
6. Patients use the `/exec` URL; reception uses `/exec?page=staff`; the clinic team manages
   everything from `/exec?page=admin` (the first visit creates the separate admin code).

> `clasp` can push the files but cannot set a web app's *Who has access* — the Apps Script API
> refuses it ([google/clasp#1115](https://github.com/google/clasp/issues/1115)). Set it once in
> **Manage deployments**; that deployment then keeps its URL and access setting across version bumps.

The runtime lives in the clinic's own Google account, so the data is theirs. This repository holds
the code only — no patient data, no credentials.

## Scaling: what holds and what to watch

| Limit | Reality for one clinic |
|---|---|
| Sheet capacity (10M cells) | ~650,000 bookings ≈ decades at 30–100 bookings/day |
| Drive storage | not a factor — no files are stored; exports are generated in memory |
| Apps Script runtime | bookings stay fast forever; only full-history reports grow with row count |
| Concurrency | bookings are serialised by `LockService`, so two patients cannot take one slot |

Reports default to a date range, so the practical limit is a report over *everything*. When the
Bookings sheet passes roughly 10–20k rows, the planned (v1.1) work is: yearly archive sheets
(rows are never deleted), a phone-keyed `Patients` index for instant history, and range-limited
reports. If this ever grows into **many clinics on one system**, the database is behind a thin
seam — `Db.rows / findById / append / update` — so swapping the Sheet for SQL (Supabase, D1) is a
database adapter, not a rewrite. Details and risks: `docs/technical-plan.md`.

## Roadmap

- [x] Slot engine driven entirely by spreadsheet rules
- [x] Patient booking with instant confirmation and a readable reference
- [x] Reception screen: board, shared schedule with per-doctor filters, statuses, lookup, blackouts
- [x] One-tap WhatsApp templates; the reminder doubles as the location message
- [x] Real `.xlsx` / CSV reports, KPI summary, per-doctor or multi-doctor scope
- [x] Shared calendar mirror, daily agenda e-mail, weekly backup
- [x] Test suite, front-end checks, `.xlsx` validator, offline demo
- [x] Phone-first layout: thumb-sized controls, Cairo Arabic font, and demo pages that open at phone width
- [x] Installable app shell with a branded icon (`pwa/`)
- [x] Arabic admin settings page: branches, doctors, reasons, hours, holidays, texts, pause, backup, audit
- [x] Doctor self-service schedule with per-doctor PINs
- [ ] Fill the real clinic data (see `docs/doctor-checklist.md`)
- [x] One live end-to-end run on a deployed web app: book → reception board → cancel released the slot
- [ ] A two-week pilot with one doctor
- [ ] v1.1: yearly archive, `Patients` index sheet, range-limited reports

## Documents

| File | For whom |
|---|---|
| `docs/proposal-ar.md` | the proposal to hand the doctor (Arabic) |
| `docs/proposal-en.md` | the same, in English |
| `docs/technical-plan.md` | architecture, data model, rules, security, limits |
| `docs/setup-guide.md` | step-by-step provisioning and deployment |
| `docs/admin-guide-ar.md` | the clinic team's guide to the settings page, PINs, pause and backup (Arabic) |
| `docs/doctor-checklist.md` | every placeholder, who fills it, and the open decisions |
| `docs/demo-script.md` | the 15-minute walkthrough to present with the demo |

## Known limits

Stated plainly in `docs/technical-plan.md`: one patient per slot, the phone number is the patient
key, WhatsApp messages are sent manually with one tap (no paid API), no clinical data is stored,
and reports stay empty until the first real booking.

## License

MIT — see [LICENSE](LICENSE).
