# Setup guide

Everything here happens once, inside the clinic's own Google account. No server, no hosting, no card.

## 0. Before you start

- A **dedicated Google account for the clinic** (e.g. `bookings@…`). Not a personal Gmail, and not
  someone's phone account. Register two admins on it.
- A computer (the Apps Script editor does not work on the mobile app).

## 1. Create the spreadsheet

1. Sign in to the clinic Google account.
2. Go to <https://sheets.new> and rename the file to `PolyClinic — [clinic name]`.

## 2. Add the script

1. In the sheet: **Extensions → Apps Script**.
2. Delete the default `Code.gs` content and recreate this exact file list, pasting the contents of
   each file from the `apps-script/` folder of this repo:

```
Code.gs          Catalog.gs       StaffApi.gs      Setup.gs
Config.gs        Availability.gs  WhatsApp.gs     Notify.gs
Db.gs            BookingApi.gs    Reports.gs      AdminApi.gs
Util.gs          Calendar.gs      I18n.gs
```

3. Add the HTML files too (**+ → HTML**), using these exact names, including the `.html`
   extension shown by the dialog:

```
Booking        Staff        Admin        Styles        ClientJs
```

4. Open **Project Settings** and:
   - confirm the time zone is the clinic's time zone,
   - tick **Show `appsscript.json` manifest file in editor**, then open it and paste
     `apps-script/appsscript.json` from this repo.
5. Save (Ctrl+S).

## 3. Provision

1. In the editor's function dropdown choose **`setupEverything`** and click **Run**.
2. Approve the permission screen (Google will warn that the app is unverified — it is your own
   script acting on your own sheet, so continue via *Advanced → Go to project*).
3. Open the **Execution log**. You should see a JSON summary with `ok: true`, the calendar name,
   `bookingUrl`, and a `warnings` list.

This creates: all sheets with headers, placeholder config, the shared calendar, the backup folder,
a master backup copy, the three triggers, and it prints what is still a placeholder.

## 4. Enter the clinic's real data

After deployment, the clinic can do this from **`/exec?page=admin`** — branches, doctors, reasons,
weekly hours, holidays, texts and codes — with no code editor and no redeploy. The sheets remain the
source of truth, so the same data can be edited directly if you prefer. In the spreadsheet, in this
order (IDs must match across sheets — keep `C1`, `D1`, `R1` style):

1. **Clinics** — one row per branch. Set `active` to `FALSE` for branches not launched yet.
2. **Doctors** — `clinic_ids` is a comma-separated list (`C1,C2`). `color` is one of
   `red, orange, yellow, green, teal, blue, purple, gray`. Keep the IDs consistent.
   `code` is optional: two Latin letters used in the patient's booking reference
   (`AE` → `ae-20261018-1`). Leave it empty to guess the letters from the doctor's name; the
   configuration check warns if two doctors end up with the same letters.
3. **Reasons** — the visit types. `duration_min` is the slot length, `lead_hours` the minimum notice,
   `book_days_ahead` how far ahead patients may book, `max_per_day` the daily cap.
4. **Availability** — the actual rule. One row per doctor × clinic × reason × weekday:
   - `weekday`: `0`=Sunday, `1`=Monday, `2`=Tuesday, `3`=Wednesday, `4`=Thursday, `5`=Friday, `6`=Saturday
   - `from_time` / `to_time`: `HH:mm` (24-hour), e.g. `09:00` and `16:00`
   - leave `slot_min` empty to use the reason's duration; use `max_per_day_override` only when a
     specific weekday differs from the reason default.
5. **Settings** — see the checklist. **Change `staff_code` immediately.** It is the only thing
   protecting the reception screen. Do not set it to the same value as a doctor PIN or the admin code.
6. **Blackouts** — holidays. `date` may be one day or a range (`2026-10-30..2026-11-01`).
7. Delete the placeholder rows you did not overwrite (for example the `FALSE` doctor / clinic seeds).

Then run the menu item **العيادة → فحص الإعدادات** and fix whatever it reports.

## 5. Verify

- **العيادة → عرض رابط الحجز** gives you the URL — but only after step 6.
- **العيادة → تحديث أوراق التقارير** builds `Report_Data` and `Report_KPIs`.

## 6. Deploy the web app

1. **Deploy → New deployment → Web app**.
2. Description: `v1`.
3. **Execute as: Me.**
4. **Who has access: Anyone** (patients have no Google account — this is required).
5. **Deploy**, then copy the **Web app URL**: `https://script.google.com/macros/s/…/exec`.
6. Open it. You should see the Arabic booking page.

Staff screen: append `?page=staff` to that URL, e.g.
`https://script.google.com/macros/s/…/exec?page=staff`. Bookmark it on the reception device.

Settings page: append `?page=admin` (or press **الإعدادات** on the staff screen). The first visit
asks for the current staff code, then creates a **separate admin code** (6+ characters). After that,
the staff code no longer opens settings. Each doctor can be given a 4–8 digit PIN from **الأطباء →
كود الدخول**; it opens only that doctor's own schedule. The full Arabic walkthrough is
`docs/admin-guide-ar.md`.

Campaign links: `…/exec?src=instagram&clinic=C1&doctor=D1&reason=R1` pre-selects and jumps ahead —
useful for a doctor-specific or reason-specific post. `src` is stored per booking so you can see
which channel produced bookings.

> Re-deploying: after any code change use **Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy**.
> The URL stays the same. If you create a *New deployment* instead, the URL changes and every
> printed/QR link breaks.
>
> Deploying with `clasp`? The command line can create the project, push every file and add versions —
> but Google's API refuses to set a web app's **Who has access** ([google/clasp#1115](https://github.com/google/clasp/issues/1115)).
> After a command-line deploy, open **Manage deployments**, edit that deployment and set **Anyone**
> once. Version bumps through the same edit dialog keep both the URL and the access setting.

## 7. Test the whole loop

1. Book a real appointment through the patient page with your own phone number.
2. Check the shared clinic calendar — the event should be there, colour-coded.
3. Open the staff screen, enter the code, confirm the booking appears.
4. Tap a WhatsApp button — WhatsApp should open with the Arabic message pre-filled.
5. Mark it **حضر**. Run **العيادة → تحديث أوراق التقارير**, then open `Report_KPIs`.
6. Export Excel from the staff screen and open the file.
7. Cancel the test booking from the staff screen and confirm the slot reappears on the booking page.
8. Open **الإعدادات** → **الأطباء** → set a test doctor PIN. Log out, enter the PIN, and confirm the
   doctor sees only **مواعيدي** and **كود الدخول** — no branches, no patient data.
9. From **نظرة عامة**, pause bookings and confirm the patient page shows the pause message; resume.
   Then make a small text change under **النصوص** and confirm it appears on a fresh patient load.
10. Press **نسخة احتياطية الآن** and confirm a Drive copy is created.

## 8. Going live

- Put the link in the Instagram/Facebook bio, and as a WhatsApp quick reply for the clinic number.
- Print a QR code of the link for the reception desk.
- Train reception on: the daily board, the six statuses, rescheduling, blocking time, and the reminder buttons.
- Decide who reads the 07:00 agenda email and who exports the monthly report.
- Optional: **العيادة → نسخة احتياطية الآن** once, to confirm backups work.

## 9. Maintenance

| Task | When | How |
|------|------|-----|
| Holiday / leave | as needed | **الإعدادات → الإجازات**, or a calendar event titled `BLOCK [doctor:D1]` |
| Add a doctor / reason / hours | as needed | **الإعدادات → الأطباء / أسباب الزيارة / الجدول** (or a new row in the relevant sheet) |
| Doctor changes their hours | as needed | the doctor opens **الإعدادات** with their PIN → **مواعيدي**; or the admin edits **الجدول** |
| Reset a forgotten doctor PIN | as needed | **الإعدادات → الأطباء → كود الدخول** |
| Stop new bookings temporarily | as needed | **الإعدادات → نظرة عامة → إيقاف الحجز مؤقتاً** |
| Reports | monthly | staff screen → تصدير Excel (a Drive file — the clinic's Google account must be signed in on that device; CSV downloads directly), or `Report_KPIs` |
| Backups | automatic | Sunday 22:00 — verify the email arrives; **نسخة احتياطية الآن** runs one on demand |
| Staff code rotation | quarterly, or when staff leave | **الإعدادات → الإعدادات → كود الاستقبال**, tell reception |
| Admin code rotation | when the admin leaves | **الإعدادات → الإعدادات → كود الإدارة**; it must differ from staff and doctor PINs |
| Check logs | when something looks wrong | **الإعدادات → السجل**, the `Log` sheet, or Executions in the Apps Script editor |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Patient page shows no slots | no `Availability` row matches, or a blackout, or the window is too short | run **فحص الإعدادات** |
| Staff screen rejects the code | code in `Settings` differs from what was typed | re-check `staff_code`; clear the browser's saved code by opening the URL in a private window |
| Settings page asks for a code, but the admin code was forgotten | only the staff code is known | open the `Settings` sheet and read/reset `admin_code` from the clinic's Google account |
| Settings page says the staff code cannot open it | the separate admin code already exists | use the admin code, or read/reset `admin_code` in the `Settings` sheet |
| A doctor PIN does not open settings | the doctor is archived, or the PIN was cleared | reactivate the doctor and set a new PIN under **الأطباء**; PINs must be 4–8 digits |
| Admin code / staff code rejected as a conflict | it matches a doctor PIN | choose a different code; the server refuses ambiguous logins |
| Calendar events missing | permission was revoked, or `shared_calendar_id` points at a deleted calendar | re-run `setupEverything`; check `Log` for `createEventForBooking` errors |
| Excel export returns a Google Sheet link instead | Drive export permission missing | re-authorise the script (Run any function and approve) |
| Emails never arrive | `report_email` is still a placeholder | set it in `Settings` |
