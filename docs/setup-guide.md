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
Db.gs            BookingApi.gs    Reports.gs
Util.gs          Calendar.gs      I18n.gs
```

3. Add the HTML files too (**+ → HTML**), using these exact names, including the `.html`
   extension shown by the dialog:

```
Booking        Staff        Styles        ClientJs
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

In the spreadsheet, in this order (IDs must match across sheets — keep `C1`, `D1`, `R1` style):

1. **Clinics** — one row per branch. Set `active` to `FALSE` for branches not launched yet.
2. **Doctors** — `clinic_ids` is a comma-separated list (`C1,C2`). `color` is one of
   `red, orange, yellow, green, teal, blue, purple, gray`. Keep the IDs consistent.
   `code` (the last column) is optional: two Latin letters used in the patient's booking reference
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
   protecting the reception screen.
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

Campaign links: `…/exec?src=instagram&clinic=C1&doctor=D1&reason=R1` pre-selects and jumps ahead —
useful for a doctor-specific or reason-specific post. `src` is stored per booking so you can see
which channel produced bookings.

> Re-deploying: after any code change use **Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy**.
> The URL stays the same. If you create a *New deployment* instead, the URL changes and every
> printed/QR link breaks.

## 7. Test the whole loop

1. Book a real appointment through the patient page with your own phone number.
2. Check the shared clinic calendar — the event should be there, colour-coded.
3. Open the staff screen, enter the code, confirm the booking appears.
4. Tap a WhatsApp button — WhatsApp should open with the Arabic message pre-filled.
5. Mark it **حضر**. Run **العيادة → تحديث أوراق التقارير**, then open `Report_KPIs`.
6. Export Excel from the staff screen and open the file.
7. Cancel the test booking from the staff screen and confirm the slot reappears on the booking page.

## 8. Going live

- Put the link in the Instagram/Facebook bio, and as a WhatsApp quick reply for the clinic number.
- Print a QR code of the link for the reception desk.
- Train reception on: the daily board, the six statuses, rescheduling, blocking time, and the reminder buttons.
- Decide who reads the 07:00 agenda email and who exports the monthly report.
- Optional: **العيادة → نسخة احتياطية الآن** once, to confirm backups work.

## 9. Maintenance

| Task | When | How |
|------|------|-----|
| Holiday / leave | as needed | `Blackouts` row, or a calendar event titled `BLOCK [doctor:D1]` |
| Add a doctor / reason / hours | as needed | new row in the relevant sheet |
| Reports | monthly | staff screen → تصدير Excel, or `Report_KPIs` |
| Backups | automatic | Sunday 22:00 — verify the email arrives |
| Staff code rotation | quarterly, or when staff leave | `Settings` → `staff_code`, tell reception |
| Check logs | when something looks wrong | `Log` sheet, or Executions in the Apps Script editor |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Patient page shows no slots | no `Availability` row matches, or a blackout, or the window is too short | run **فحص الإعدادات** |
| Staff screen rejects the code | code in `Settings` differs from what was typed | re-check `staff_code`; clear the browser's saved code by opening the URL in a private window |
| Calendar events missing | permission was revoked, or `shared_calendar_id` points at a deleted calendar | re-run `setupEverything`; check `Log` for `createEventForBooking` errors |
| Excel export returns a Google Sheet link instead | Drive export permission missing | re-authorise the script (Run any function and approve) |
| Emails never arrive | `report_email` is still a placeholder | set it in `Settings` |
