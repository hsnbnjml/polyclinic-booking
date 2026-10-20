/**
 * Db.gs — a very small object layer over the spreadsheet.
 *
 * Deliberately dumb: every read pulls the whole sheet. At polyclinic scale
 * (hundreds to low thousands of rows) this is faster and far simpler than
 * index bookkeeping, and it keeps the slot engine pure and testable.
 */

const Db = (function () {
  let _ss = null;

  function ss() {
    if (!_ss) {
      _ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!_ss) throw new Error('No active spreadsheet. Bind the script to the clinic sheet.');
    }
    return _ss;
  }

  function sheet(name) {
    const sh = ss().getSheetByName(name);
    if (!sh) throw new Error('Missing sheet: ' + name + '. Run Setup.createAllSheets() first.');
    return sh;
  }

  function headers(name) {
    const sh = sheet(name);
    const width = Math.max(sh.getLastColumn(), 1);
    return sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h); });
  }

  /** All data rows of a sheet as plain objects keyed by header. Empty rows are skipped. */
  function rows(name) {
    const sh = sheet(name);
    const lastRow = sh.getLastRow();
    const hdr = headers(name);
    if (lastRow < 2) return [];
    const lastCol = Math.max(sh.getLastColumn(), hdr.length);
    const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const out = [];
    for (let i = 0; i < values.length; i++) {
      const raw = values[i];
      let blank = true;
      const obj = {};
      for (let c = 0; c < hdr.length; c++) {
        const v = raw[c];
        if (v !== '' && v !== null && v !== undefined) blank = false;
        obj[hdr[c]] = v === null || v === undefined ? '' : v;
      }
      if (!blank) {
        obj._row = i + 2; // 1-based physical row, handy for debugging
        out.push(obj);
      }
    }
    return out;
  }

  function findById(name, idField, idValue) {
    const hit = rows(name).filter(function (r) {
      return String(r[idField]) === String(idValue);
    });
    return hit.length ? hit[0] : null;
  }

  function append(name, obj) {
    const sh = sheet(name);
    const hdr = headers(name);
    const line = hdr.map(function (h) {
      const v = obj[h];
      return v === undefined || v === null ? '' : v;
    });
    sh.getRange(sh.getLastRow() + 1, 1, 1, hdr.length).setValues([line]);
    return line;
  }

  /** Patch one row, identified by a unique field. Returns true when a row was updated. */
  function update(name, idField, idValue, patch) {
    const sh = sheet(name);
    const hdr = headers(name);
    const all = rows(name);
    for (let i = 0; i < all.length; i++) {
      if (String(all[i][idField]) !== String(idValue)) continue;
      const line = hdr.map(function (h) {
        return Object.prototype.hasOwnProperty.call(patch, h)
          ? (patch[h] === undefined || patch[h] === null ? '' : patch[h])
          : (all[i][h] === undefined ? '' : all[i][h]);
      });
      sh.getRange(all[i]._row, 1, 1, hdr.length).setValues([line]);
      return true;
    }
    return false;
  }

  /** Append many rows at once (used by seeding and backups). */
  function appendMany(name, objects) {
    if (!objects || !objects.length) return 0;
    const sh = sheet(name);
    const hdr = headers(name);
    const block = objects.map(function (obj) {
      return hdr.map(function (h) {
        const v = obj[h];
        return v === undefined || v === null ? '' : v;
      });
    });
    sh.getRange(sh.getLastRow() + 1, 1, block.length, hdr.length).setValues(block);
    return block.length;
  }

  /**
   * Clear the rows whose idField is in idValues. The physical blank row stays,
   * which is harmless: rows() skips blanks, and it avoids shifting other rows.
   */
  function remove(name, idField, idValues) {
    const wanted = {};
    (Array.isArray(idValues) ? idValues : [idValues]).forEach(function (v) { wanted[String(v)] = true; });
    const sh = sheet(name);
    const hdr = headers(name);
    let removed = 0;
    rows(name).forEach(function (r) {
      if (!wanted[String(r[idField])]) return;
      sh.getRange(r._row, 1, 1, hdr.length).clearContent();
      removed++;
    });
    return removed;
  }

  /** Remove every row of a data sheet except the header (used only by seeding/backup tools). */
  function truncate(name) {
    const sh = sheet(name);
    const lastRow = sh.getLastRow();
    if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, Math.max(sh.getLastColumn(), 1)).clearContent();
  }

  function reset() { _ss = null; }

  return {
    rows: rows,
    headers: headers,
    findById: findById,
    append: append,
    appendMany: appendMany,
    update: update,
    remove: remove,
    truncate: truncate,
    sheet: sheet,
    reset: reset
  };
})();
