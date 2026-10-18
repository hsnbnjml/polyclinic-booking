/**
 * Notify.gs — internal mail only.
 *
 * Nothing here is sent to patients: reminders reach patients as manual WhatsApp
 * messages from the staff page. These jobs go to the clinic's own inbox.
 *
 * Consumer Gmail allows 100 recipients/day through Apps Script. One clinic
 * inbox receives ~2 mails a day from this file, so the quota is irrelevant.
 */

function looksLikeRealEmail(value) {
  const v = str(value);
  return v.indexOf('@') > 0 && v.indexOf('[') === -1;
}

/** Morning agenda for reception: who is coming today, and who still needs a reminder. */
function sendDailyAgenda(dateStr) {
  const settings = getSettings();
  const to = str(settings[SETTING.REPORT_EMAIL]);
  if (!looksLikeRealEmail(to)) {
    logWarn('sendDailyAgenda', 'report_email is not set; skipping');
    return { ok: false, error: 'NO_RECIPIENT' };
  }

  const day = str(dateStr) || todayStr();
  const board = getStaffBoard(day, str(settings[SETTING.STAFF_CODE]));
  if (!board.ok) return board;

  const rows = board.bookings.map(function (b) {
    const flag = b.status === STATUS.CONFIRMED && !b.waSentAt ? ' ⚠️ لم يتم التذكير' : '';
    return '<tr>' +
      '<td>' + escapeHtml(b.timeAr) + '</td>' +
      '<td>' + escapeHtml(b.doctorAr) + '</td>' +
      '<td>' + escapeHtml(b.reasonAr) + '</td>' +
      '<td>' + escapeHtml(b.name || '—') + '</td>' +
      '<td dir="ltr">' + escapeHtml(b.phoneNorm) + '</td>' +
      '<td>' + escapeHtml(statusLabelAr(b.status)) + flag + '</td>' +
      '</tr>';
  }).join('');

  const html = '<div dir="rtl" style="font-family:system-ui,Segoe UI,Arial;direction:rtl">' +
    '<h2>مواعيد ' + escapeHtml(board.dateAr) + ' — ' + escapeHtml(str(settings[SETTING.CLINIC_NAME])) + '</h2>' +
    '<p>إجمالي: ' + board.counts.total + ' | مؤكد: ' + board.counts.confirmed +
    ' | حضر: ' + board.counts.attended + ' | لم يحضر: ' + board.counts.no_show +
    ' | ملغي: ' + board.counts.cancelled + '</p>' +
    (rows
      ? '<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:14px">' +
        '<thead style="background:#eee"><tr><th>الوقت</th><th>الطبيب</th><th>سبب الزيارة</th><th>الاسم</th><th>الجوال</th><th>الحالة</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>'
      : '<p>لا توجد مواعيد في هذا اليوم.</p>') +
    '<p style="color:#666;font-size:12px">تذكيرات المرضى تُرسل يدوياً من شاشة الاستقبال.</p>' +
    '</div>';

  MailApp.sendEmail({
    to: to,
    subject: 'مواعيد اليوم ' + board.dateAr + ' (' + board.counts.total + ')',
    htmlBody: html
  });
  logInfo('sendDailyAgenda', 'Agenda sent for ' + day + ' (' + board.counts.total + ' bookings)');
  return { ok: true, sent: to, total: board.counts.total };
}

/** Weekly: a real .xlsx of everything, plus the KPI summary, mailed to the clinic. */
function sendWeeklyBackup() {
  const settings = getSettings();
  const exported = exportXlsx({}, 'نسخة-احتياطية-الحجوزات');
  const kpi = kpiSummary('', '');

  const to = str(settings[SETTING.REPORT_EMAIL]);
  const lines = [
    'إجمالي الحجوزات: ' + kpi.totalBookings,
    'حضر: ' + kpi.attended + ' | لم يحضر: ' + kpi.noShow + ' | ملغي: ' + kpi.cancelled,
    'نسبة عدم الحضور: ' + kpi.noShowRate + '%',
    'مرضى مختلفون: ' + kpi.uniquePatients + ' | مكررون: ' + kpi.repeatPatients,
    '',
    'الأطباء:',
  ].concat(kpi.byDoctor.map(function (d) { return '  - ' + d.labelAr + ': ' + d.count; }))
    .concat(['', 'الأسباب:'])
    .concat(kpi.byReason.map(function (d) { return '  - ' + d.labelAr + ': ' + d.count; }));

  if (looksLikeRealEmail(to)) {
    MailApp.sendEmail({
      to: to,
      subject: 'نسخة احتياطية أسبوعية — ' + str(settings[SETTING.CLINIC_NAME]),
      body: 'ملف الإكسل:\n' + exported.url + '\n\n' + lines.join('\n')
    });
  } else {
    logWarn('sendWeeklyBackup', 'report_email is not set; backup file only');
  }

  // Keep a rolling master copy in Drive as well, in case the sheet itself is lost.
  try {
    const folderId = str(settings[SETTING.BACKUP_FOLDER_ID]);
    if (folderId) {
      const master = 'PolyClinic-MASTER-' + formatDateStr(new Date());
      const already = DriveApp.getFolderById(folderId).getFilesByName(master).hasNext();
      if (!already) {
        DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId())
          .makeCopy(master, DriveApp.getFolderById(folderId));
      }
    }
  } catch (err) {
    logWarn('sendWeeklyBackup', 'Master copy failed: ' + err);
  }

  logInfo('sendWeeklyBackup', 'Backup done: ' + exported.url);
  return { ok: true, url: exported.url, emailed: looksLikeRealEmail(to), kpi: kpi };
}

/* Trigger entry points. Each one swallows its own error so one bad night does
   not disable the schedule. */

function jobDailyAgenda() {
  try { sendDailyAgenda(todayStr()); } catch (err) { logError('jobDailyAgenda', err); }
}

function jobSyncBlocks() {
  try { syncBlockEvents(); } catch (err) { logError('jobSyncBlocks', err); }
}

function jobWeeklyBackup() {
  try { sendWeeklyBackup(); } catch (err) { logError('jobWeeklyBackup', err); }
}
