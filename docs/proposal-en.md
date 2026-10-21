# Proposal: Appointment Booking + Patient History System

**Prepared for:** [Clinic name] management
**Subject:** Organising booking, scheduling and historical data for the new polyclinic
**Cost:** zero monthly — no subscription, no per-booking fee

---

## 1. The problem today

- Booking happens by phone and WhatsApp, so reception spends the day coordinating instead of serving.
- There is no single view of a doctor's real availability.
- Appointments live in paper and chat threads, and cannot be queried later.
- Nothing links a name and a phone number to a visit reason, a doctor, a clinic and a date.
- No reporting: how many came, how many didn't show, which doctor is overloaded, which visit reason repeats?
- Double-booking risk: two patients on the same time slot.

## 2. The proposal in one sentence

**One link posted on social media walks the patient through five steps; the appointment lands on the doctor's calendar automatically and is recorded in a dataset that answers every question management will ask.**

## 3. The patient journey

| # | Step | What happens |
|---|------|--------------|
| 1 | The link | Tapped from Facebook / WhatsApp / Instagram — a different link per campaign if wanted |
| 2 | Clinic | Patient picks the branch |
| 3 | Doctor | Only doctors who actually serve that branch are shown |
| 4 | Visit reason | First examination / consultation / follow-up … |
| 5 | Time | Only **real** free times appear, driven by that doctor's rules for that visit type |
| 6 | Details | Name (optional) + phone typed twice + consent |
| 7 | Confirmation | Booking card: doctor, date, time, address, booking reference |

The rule the system runs on, as an example: *first examinations with Dr [name] on Sundays and Wednesdays, 9am–4pm, 45-minute slots, maximum 8 patients a day.* Changing that rule takes two taps in the Arabic settings page — no cost, no developer. Each doctor can also add their own visit reasons and change their own hours with a personal PIN, scoped to their reasons and schedule only.

## 4. What the clinic gets

**Organisation**
- Every booking is written to the shared clinic calendar instantly, colour-coded per doctor. Double-booking becomes impossible.
- Free times are computed: booked slots, holidays and the minimum lead time are all excluded automatically.
- Reception can block a doctor's time (leave, emergency) and patients stop seeing those slots immediately.
- The reception screen shows the whole day as a shared schedule, one colour-coded column per doctor, with clickable doctor labels that show or hide one or several of them at once.
- Each booking carries a reference the patient can read back over the phone: doctor letters + date + the day's running number (`ae-20261018-1`).
- Visit reasons are owned by one doctor and offered at one or more of that doctor's branches. They are never shared: the admin can copy a reason to another doctor with a separate branch choice, and editing one copy never changes the source.

**Historical record**
- One row per booking: reference, booking date, branch, doctor, visit reason, appointment date, time, name, phone, status.
- Search by phone number: the patient's whole history — how many times they booked, with whom, whether they attended.
- Status is maintained: confirmed / attended / no-show / cancelled / rescheduled. **No row is ever deleted** — the clinic's history stays complete.

**Reporting**
- Excel export for any period, filterable by doctor, branch, reason and status — pick one doctor,
  several to compare, or all of them.
- Ready KPIs that follow the same selection: bookings, no-show rate, repeat patients, bookings by
  doctor, by reason, by hour.
- Automatic weekly backup.

**Communication**
- Four ready Arabic WhatsApp messages that reception sends with one tap: confirmation, a reminder that
  carries the address and map link, reschedule, cancellation.
- The system records that a message was sent, so "who hasn't been reminded yet" is visible at a glance.

## 5. What the system deliberately does not do

- **It stores no diagnoses or medical records.** Only booking data: name, phone, visit reason.
- **It does not send WhatsApp automatically.** Sending is one staff tap. Fully automatic messaging requires a paid provider.
- **No mobile app** — it runs in any browser on the reception PC or a tablet.
- **No import of legacy records** at this stage (available later as a separate step).

## 6. Cost and limits

| Item | Cost |
|------|------|
| Online booking | Free, no cap on bookings |
| Excel export + KPIs | Free |
| Calendar integration | Free |
| Manual WhatsApp messages | Free |
| Weekly backup | Free |

**Where paid options might appear later (entirely optional):** automated WhatsApp, a custom domain, a separate Google calendar per doctor, or vendor support.

## 7. Privacy

- Data lives in a Google account owned by the clinic; only people we grant access can read it.
- Reception works from a screen protected by a staff code.
- The booking page is public but exposes no information about any other patient.
- A clear consent line sits under the booking form.
- A weekly backup protects against loss.

## 8. Delivery plan

| Phase | Content | Duration |
|-------|---------|----------|
| 1 | Collect the missing clinic data (names, hours, message wording) | 2 days |
| 2 | Configure the system with the clinic's data | 2 days |
| 3 | Internal trial on dummy bookings | 2 days |
| 4 | **Pilot:** one doctor, one visit reason | 2 weeks |
| 5 | Roll out to the remaining doctors and reasons | — |
| 6 | Final Arabic copy review | at launch |

## 9. What we need from the clinic

Ten items, itemised in `docs/doctor-checklist.md`:

1. Branch names, addresses and phone numbers.
2. Doctor names, specialties and which branch each works in.
3. The agreed visit reasons per doctor, the branches where each is offered, and its duration.
4. Each doctor's hours per visit reason and branch (e.g. examinations Sunday and Wednesday, 9–4).
5. Holidays, and who keeps them updated.
6. The clinic WhatsApp number and the reception phone number.
7. The clinic email address for reports.
8. Approval of the consent wording shown to patients.
9. One or two reception staff who will run the daily screen.
10. Logo and brand colours, if available.

## 10. How success is measured

- After two weeks: share of bookings made online versus by phone.
- After one month: calls avoided, and booking distribution across doctors.
- After two months: no-show rate and repeat-patient rate.

**Decision requested:** approve the pilot (one doctor, two weeks) and name the person responsible for supplying the data in section 9.
