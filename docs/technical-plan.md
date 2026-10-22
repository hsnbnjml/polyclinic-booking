# Technical plan

## Architecture

```
                 patient's phone                      reception PC / tablet
                        │                                      │
                        ▼                                      ▼
              ┌─────────────────────────┐          ┌────────────────────────┐
              │  Web app  /exec         │          │  Web app  ?page=staff  │
              │  (public, Arabic RTL)   │          │  (staff code required) │
              └────────────┬────────────┘          └───────────┬────────────┘
                           │  google.script.run                 │
                           ▼                                    ▼
              ┌─────────────────────────────────────────────────────────────┐
              │                    Apps Script (server)                     │
              │  Catalog · Availability (slot engine) · Booking · Staff      │
              │  Calendar · WhatsApp · Reports · Notify · Setup              │
              └──────────┬───────────────────────────┬──────────────────────┘
                         │                           │
                         ▼                           ▼
              ┌────────────────────┐      ┌──────────────────────────┐
              │  Google Sheet      │      │  Shared clinic calendar  │
              │  = source of truth │─────▶│  = mirror (output only)  │
              └────────────────────┘      └──────────────────────────┘
                         │
                         ▼
              weekly .xlsx backup in Drive + by email
```

Key consequence: **the sheet decides, the calendar displays.** A doctor blocking his own Google
calendar does not stop bookings. Unavailability is expressed either as a `Blackouts` row or as a
calendar event titled `BLOCK [doctor:D1]`, which the nightly job converts into a `Blackouts` row.

## Files

| File | Responsibility |
|------|----------------|
| `Config.gs` | sheet names, column orders, statuses, settings keys and defaults |
| `Db.gs` | the only code that touches the spreadsheet (read all / append / update) |
| `Util.gs` | dates, times, weekdays, phone normalisation, CSV, logging |
| `I18n.gs` | every Arabic string, including the four WhatsApp templates |
| `Catalog.gs` | the public, patient-safe view of the config (no patient data) |
| `Availability.gs` | the slot engine — pure, no writes |
| `BookingApi.gs` | the only patient write path: validate, lock, insert, event |
| `Calendar.gs` | event create/move/delete, `BLOCK` → blackout sync |
| `StaffApi.gs` | staff-code-gated actions: board, status, reschedule, block, lookup |
| `AdminApi.gs` | admin/doctor access, config CRUD, weekly blocks, blackouts, texts, pause, PINs, backup, audit |
| `WhatsApp.gs` | wa.me links, template variables, add-to-calendar link |
| `Reports.gs` | report rows, KPIs, CSV, real .xlsx via Drive export |
| `Notify.gs` | internal only: daily agenda, weekly backup, trigger entry points |
| `Setup.gs` | provisioning, seeding, triggers, spreadsheet menu, config check |
| `Code.gs` | `doGet` routing, public + staff API surface, exports |
| `Booking.html` | the 5-step patient page |
| `Staff.html` | reception screen |
| `Admin.html` | Arabic settings page; admin tabs plus the doctor-scoped schedule view |
| `Styles.html`, `ClientJs.html` | shared CSS and helpers |

## Data model

Dates are `yyyy-MM-dd` strings, times are `HH:mm` strings, and both are stored as **plain text**
(`setNumberFormat('@')` at setup) so Sheets can never reinterpret them. Times are compared as
minutes-since-midnight, which also makes the engine deterministic in tests.

| Sheet | Columns |
|-------|---------|
| `Clinics` | clinic_id, name_ar, address_ar, map_link, phone, working_hours_ar, active, sort_order |
| `Doctors` | doctor_id, name_ar, specialty_ar, clinic_ids, color, active, code, sort_order |
| `Reasons` | reason_id, name_ar, description_ar, duration_min, lead_hours, book_days_ahead, max_per_day, active, sort_order, doctor_id, clinic_ids |
| `Availability` | availability_id, doctor_id, clinic_id, reason_id, weekday, from_time, to_time, slot_min, max_per_day_override, valid_from, valid_to, active |
| `Blackouts` | blackout_id, date, scope_type, scope_id, from_time, to_time, note |
| `Bookings` | booking_id, created_at, clinic_id, doctor_id, reason_id, date, start_time, end_time, name, phone_raw, phone_norm, email, extra_json, status, status_at, status_by, rescheduled_from, staff_note, wa_sent_at, wa_template, event_id, source |
| `Settings` | key, value, note |
| `Access` | doctor_id, pin_hash, pin_salt, updated_at — hashed doctor PINs, never exposed publicly |
| `Log` | timestamp, level, context, message |

`weekday`: 0 = Sunday … 6 = Saturday. `Blackouts.date` accepts a single date or a range
(`2026-10-30..2026-11-01`); an empty `from_time`/`to_time` means the whole day.
`scope_type`: `all` | `clinic` | `doctor`.

`Doctors.code` is appended **last** on purpose: inserting a column anywhere else would shift the
data in an existing sheet. It holds the two Latin letters used in the patient's booking reference
(`AE` → `ae-20261018-1`). Left empty, the letters are guessed from the name (first and last word);
`checkConfiguration()` warns when two active doctors end up with the same code.

Each `Reasons` row belongs to exactly one doctor (`doctor_id`) and lists one or more of that doctor's
branches in `clinic_ids` (comma-separated IDs, like `Doctors.clinic_ids`). A reason is never shared:
copying creates independent rows, each with its own doctor and branch list. The doctor on an existing
reason is immutable; move a reason by copying it and archiving the old row. `sort_order` is global
across all reasons, not per doctor.

The settings page archives branches/doctors/reasons (`active = FALSE`) instead of deleting rows.
Archiving a reason also deletes all of its `Availability` rows. Removing a branch from a reason deletes
that reason's blocks in that branch. Removing a branch from a doctor strips it from the doctor's reasons,
deletes the affected blocks, and archives any reason left with no branch. Schedule rows can be deleted;
old bookings remain readable through the archived reason row. `sort_order` is appended last; blank
values fall back to sheet order, so an upgraded sheet keeps its current order until the clinic reorders
it. `adminMigrateSchema()` adds missing `Access`, `code`, `sort_order`, `doctor_id` and `clinic_ids`
columns on the first settings visit — additively, without moving existing data.

`migrateReasonsToDoctors()` runs during setup, when an older settings page is first opened, and on
admin login after the upgrade. For each
active legacy reason (blank `doctor_id`), it groups active availability by doctor, creates one
independent copy per doctor, repoints those availability rows to the copy, and archives the original.
Legacy reasons with no active schedule are archived rather than guessed onto a doctor. It is
idempotent: only active rows with a blank `doctor_id` are migrated.

Settings keys added for the admin page include `admin_code`, `bookings_paused`, `pause_message_ar`,
the patient-page text overrides (`booking_subtitle_ar`, `name_hint_ar`, `phone_hint_ar`,
`extra_label_ar`, `consent_text_ar`, `success_text_ar`, `no_slots_text_ar`, `slot_taken_text_ar`),
and the `wa_template_*` overrides. A blank text override means the built-in default.
`annual_export_year` records the last year for which a full all-bookings Excel export was made;
when it is older than the current year, the admin overview and staff board show a reminder. The
export never deletes booking rows.

## Slot engine rules (in order)

1. Doctor must be active and serve the chosen clinic. The reason must be active, owned by that doctor, and list that clinic in `clinic_ids`; a reason owned by another doctor or offered elsewhere is rejected, not treated as an empty day.
2. The doctor must have a matching `Availability` row for this reason and branch. No matching block means an empty list, not an error.
3. Date must be inside the window: `min(reason.book_days_ahead, settings.booking_window_days)`, capped at 90 days.
4. Slot must clear the lead time: `reason.lead_hours` else `settings.min_lead_hours`.
5. Slot must not touch a `Blackouts` row (overlap, or whole-day).
6. Slot must not already be held by a booking with status `confirmed` or `attended` — one patient per slot.
7. The day must respect the cap: `availability.max_per_day_override` else `reason.max_per_day`, counted against bookings for that doctor+date with an occupying status, plus slots already found in this pass.
8. Slot length = `availability.slot_min` else `reason.duration_min`.

## Booking

`submitBooking` runs under a `LockService` script lock and re-derives availability itself.
Client-side state is never trusted; if the slot is gone the patient gets `SLOT_TAKEN` and is sent
back to the slot list.

Validation: honeypot rejection, required fields, consent, phone plausibility, phone/confirm match,
idempotency (same phone + doctor + date + time returns the existing booking instead of duplicating),
and a cap of 3 future confirmed bookings per phone.

The calendar event is best-effort: if Google Calendar fails, the booking still stands and the
failure is logged.

## Booking reference

Every booking gets a reference a patient can read back over the phone:

```
<doctor code>-<yyyymmdd>-<n>        ae-20261018-1
```

- `<doctor code>` — `Doctors.code` when the clinic has filled it in, otherwise the first letters of
  the doctor's first and last name (`د. Ashraf Elzamany` → `ae`; a single-word Arabic name gives its
  first two letters, `د. أحمد` → `ah`).
- `<n>` — that doctor's n-th booking **for that day**. Rows are never deleted, so the counter only
  moves forward: cancelling keeps the number, and the next booking takes the following one. Two live
  bookings can never share a reference.

The number is computed inside the same `LockService` lock as the insert, so two patients tapping
"confirm" at the same second cannot collide. `checkConfiguration()` warns when two active doctors
would produce the same code.

## Reception screen

`getStaffBoard(date, code)` returns one day, ready to render with no formatting left for the browser:

| Field | Purpose |
|-------|---------|
| `bookings[]` | the day's agenda; each item carries `doctorColor`, `doctorCode`, status, WhatsApp links |
| `doctors[]` | the day's roster: `id`, `nameAr`, `color`, `code`, availability windows, booking count |
| `counts` | total / confirmed / attended / no-show / cancelled / reminded |
| `upcoming[]` | the next 7 days with booking counts |

`doctors[]` includes anyone who works that weekday, plus anyone with a booking that day (so cancelling
a doctor from next week's rota does not hide their existing appointments). It drives the shared
schedule panel: one colour-coded column per doctor, with clickable labels above it that show or hide
one or several doctors. The filter is client-side and remembered in `localStorage`
(`polyclinic_board_hidden_doctors`), so it survives a reload and needs no round trip. Hiding every
doctor resets to showing all, so the board can never look empty.

## Reports and exports

One filter shape is shared by the KPI panel, the CSV and the `.xlsx`: `doctorIds` accepts
`''` (every doctor), one id, a comma-separated list (`D1,D2,D3`), or an array. `doctorId` is kept as
the older single-name alias, and an empty list always means *all* doctors — never *none* — because
that is the safer reading of a half-filled URL.

| Call | What it produces |
|------|------------------|
| `filterBookings(filters)` | the filtered `Bookings` rows, sorted by date and time |
| `reportRows(filters)` | the 16 Arabic-labelled columns; with several doctors selected the rows are grouped per doctor so a comparison reads side by side |
| `kpiSummary(from, to, extra)` | totals, no-show and repeat rates, and `byDoctor` / `byClinic` / `byReason` / `byHour` breakdowns for the same scope, plus `scopeLabelAr` |
| `exportCsv(filters)` | the same rows as UTF-8 CSV with a BOM |
| `exportXlsx(filters, label)` | a real `.xlsx` through Drive's export endpoint |
| `exportBaseName(filters, label)` | the file name, e.g. `تقرير-الحجوزات-مقارنة-2-أطباء-2026-10-18-0800`, built in one place so the live, CSV and offline-demo files all agree |

The reception screen renders the doctor chips in التقارير → الأطباء, keeps the choice in
`localStorage` (`polyclinic_report_doctors`) and sends it as `&doctor=D1,D2` on the export URL and as
`doctorIds` to `apiStaffKpis`. Changing the scope or the dates marks the on-screen KPIs as stale
instead of leaving numbers that no longer match the selection.

The offline demo has no Drive, so `tools/xlsx-writer.js` writes the same five OOXML parts in the
browser (stored ZIP, inline strings, `rightToLeft="1"`, sheet named `Bookings`). `node
tools/check-xlsx.mjs` validates the bytes with its own ZIP reader and with .NET's, so the demo file
cannot quietly degrade into a renamed CSV.

## Status model

| Status | Set by | Effect |
|--------|--------|--------|
| `confirmed` | system / staff | holds the slot, shown on the calendar |
| `attended` | staff | closes the loop; event titled with ✓ |
| `no_show` | staff | drives the no-show KPI; event titled with ✗ |
| `cancelled` | staff | frees the slot, deletes the event |
| `rescheduled` | staff | old row closed, `rescheduled_from` links to the new row, one calendar event moved |

Rows are never deleted. A reschedule leaves three rows in the ledger (original, rescheduled
marker could be one, new booking) — by design, so "she moved twice" stays answerable.

## Security model

- The web app is deployed as *execute as owner, accessible to anyone*, because patients have no accounts.
- Therefore: every server function is reachable by anyone who has the URL. Nothing is protected by obscurity.
- Patient data is never returned by any unauthenticated function. `getBootstrap` and `generateSlots` return names, hours and slot times only.
- Every staff action takes a `code` argument compared against `settings.staff_code`, and fails closed when the code is missing.
- The settings page uses a separate `settings.admin_code`; the first one is bootstrapped from the staff code, then the staff code is refused there. Both codes are refused if they equal a doctor PIN, so one credential can never silently grant a higher role.
- Doctor PINs are 4–8 digits, hashed with a per-doctor salt in the separate `Access` sheet. The admin payload exposes only `hasPin`; hashes and salts never leave the server. A doctor session is scoped to that doctor's own reasons and availability; the server forces `doctor_id` on writes and refuses another doctor's reason, branch or schedule. Only the admin can copy a reason to another doctor.
- Pausing bookings is checked in both `apiSlots` and `submitBooking`; it never blocks the staff reschedule/cancel paths.
- Every admin write is validated server-side under a script lock and recorded in the `Log` sheet; the browser is never trusted.
- Anti-abuse: slot locking, per-phone booking cap, honeypot field, server-side validation of every field.
- The spreadsheet itself is not shared publicly; access is per-account. The settings page never returns patient rows, only aggregate counts.

## Free-tier reality check

| Limit | Value | Impact |
|-------|-------|--------|
| Apps Script runtime | ~90 min/day (consumer account) | irrelevant at this volume; the slot engine runs in milliseconds |
| Apps Script email | 100 recipients/day (consumer Gmail) | only internal mails (~2/day) |
| Google Calendar booking pages | 1 per free account | avoided entirely — we do not use them |
| Single account ownership | 1 | mitigated by two admins, weekly .xlsx backup, and a master copy in Drive |

## Phases

1. **Config freeze** — real clinics, doctors, reasons, availability, wording. (blocked on the clinic)
2. **Provisioning** — run `setupEverything()`, deploy, then fill the config from the admin settings page and set the staff/admin codes.
3. **Internal trial** — dummy bookings, verify the staff screen, settings page, exports and calendar events.
4. **Pilot** — one doctor, one visit reason, two weeks. Measure no-shows and phone-call volume.
5. **Rollout** — remaining doctors and reasons.
6. **Optional** — legacy history import, Looker Studio dashboard, automated WhatsApp.

## Test coverage

`tools/local-test.mjs` runs the actual `.gs` source against an in-memory fake of the Google
services and asserts 201 behaviours, including: phone normalisation (local, international, 00-prefix,
Arabic-Indic digits), Sunday/Wednesday-only availability, 45-minute grid boundaries, inactive
rows being ignored, one-patient-per-slot, idempotent double-tap, consent/phone/mismatch/honeypot
rejection, the 3-booking cap, cancel freeing a slot and deleting its event, reschedule keeping all
rows, no-show not freeing a slot, partial and whole-day blackouts, blackout scoping by clinic,
daily caps, patient history by phone, KPIs, WhatsApp template contents and number formatting,
booking references (one per doctor per day, explicit code wins, duplicate codes warned about), the
reception roster the scheduler filters by, report scoping (one doctor, a comma list, an array, all,
and the file names they produce), the admin/doctor access split, PIN hashing and conflicts, settings
validation, schedule block editing, pause gating, backups, archive/reorder, that every `.gs` file is
safe to load in alphabetical order (Apps Script may load `AdminApi.gs` before `Config.gs`), and that
the public catalogue leaks nothing patient-related.

```
node tools/local-test.mjs      →   201 passed, 0 failed
node tools/check-html.mjs      →   front-end checks passed
node tools/check-xlsx.mjs      →   30 passed, 0 failed   (the demo's .xlsx, via .NET's ZIP reader)
```

## Known limitations (state these before launch)

- Node test coverage is not a substitute for one live end-to-end run on the deployed web app.
- Slot availability depends on the `Availability` and `Blackouts` sheets being kept current; the nightly job syncs `BLOCK` events but the sheet remains the source of truth.
- A family sharing one phone number collapses into one patient record.
- WhatsApp reminders are manual; a patient is only as reminded as the staff are diligent, though `wa_sent_at` makes omissions visible.
- Reports are empty until the first real booking; reason-mix trends need ~4 weeks, no-show rate ~8 weeks.
- The public link is a long `script.google.com` URL; a short link or Google Sites wrapper is cosmetic only.
