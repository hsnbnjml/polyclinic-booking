/**
 * xlsx-writer.js — a tiny, dependency-free .xlsx writer for the offline demo.
 *
 * The live system builds its Excel file with Drive's export endpoint (Reports.gs →
 * exportXlsx). Offline there is no Drive, so the demo used to hand the patient a CSV
 * and apologise for it. This writes the real thing in the browser instead: an
 * uncompressed (stored) ZIP containing the same five parts Excel expects, with the
 * rows as inline strings, so Arabic survives without a font or a code page.
 *
 * Deliberately minimal — no sharedStrings, no styles, no docProps. The live export is
 * a converted Google Sheet, and the parts Excel actually needs are exactly these.
 *
 * Usable from the browser (window.POLYCLINIC_XLSX) and from Node (module.exports),
 * which is what tools/check-xlsx.mjs uses to validate the bytes with a real ZIP reader.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (root) root.POLYCLINIC_XLSX = factory();
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Bytes
   * ------------------------------------------------------------------ */

  var encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

  /** UTF-8 bytes of a string. */
  function utf8(text) {
    var s = String(text === null || text === undefined ? '' : text);
    if (encoder) return encoder.encode(s);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var next = s.charCodeAt(i + 1);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        i++;
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return new Uint8Array(out);
  }

  function u16(v) { return [v & 0xff, (v >>> 8) & 0xff]; }
  function u32(v) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }

  function concat(parts) {
    var total = 0;
    parts.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total);
    var at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * CRC-32 (the ZIP checksum)
   * ------------------------------------------------------------------ */

  var CRC_TABLE = (function () {
    var table = new Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /* ------------------------------------------------------------------ *
   * ZIP (stored, no compression — the files are tiny)
   * ------------------------------------------------------------------ */

  function dosStamp(date) {
    var time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
    var day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
    return { time: time, day: day };
  }

  function zip(entries, now) {
    var stamp = dosStamp(now || new Date());
    var parts = [];
    var central = [];
    var offset = 0;

    entries.forEach(function (entry) {
      var nameBytes = utf8(entry.name);
      var data = entry.data;
      var crc = crc32(data);

      var local = [].concat(
        u32(0x04034b50), u16(20), u16(0), u16(0),
        u16(stamp.time), u16(stamp.day),
        u32(crc), u32(data.length), u32(data.length),
        u16(nameBytes.length), u16(0)
      );

      parts.push(new Uint8Array(local), nameBytes, data);
      central.push({ nameBytes: nameBytes, crc: crc, size: data.length, offset: offset });
      offset += local.length + nameBytes.length + data.length;
    });

    var centralStart = offset;
    var centralParts = [];

    central.forEach(function (e) {
      var header = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0),
        u16(stamp.time), u16(stamp.day),
        u32(e.crc), u32(e.size), u32(e.size),
        u16(e.nameBytes.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(e.offset)
      );
      centralParts.push(new Uint8Array(header), e.nameBytes);
      offset += header.length + e.nameBytes.length;
    });

    var end = [].concat(
      u32(0x06054b50), u16(0), u16(0),
      u16(central.length), u16(central.length),
      u32(offset - centralStart), u32(centralStart), u16(0)
    );

    return concat(parts.concat(centralParts, [new Uint8Array(end)]));
  }

  /* ------------------------------------------------------------------ *
   * The XLSX parts
   * ------------------------------------------------------------------ */

  function xmlEscape(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Control characters are illegal in XML and would make Excel refuse the file.
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  }

  var XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  /** 0 -> A, 25 -> Z, 26 -> AA */
  function columnName(index) {
    var name = '';
    var n = index;
    while (n >= 0) {
      name = String.fromCharCode(65 + (n % 26)) + name;
      n = Math.floor(n / 26) - 1;
    }
    return name;
  }

  function isNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function sheetXml(rows) {
    var out = [XML_HEAD,
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'];

    var lastCol = 0;
    rows.forEach(function (r) { lastCol = Math.max(lastCol, (r || []).length); });
    var dimension = 'A1:' + columnName(Math.max(lastCol - 1, 0)) + Math.max(rows.length, 1);
    out.push('<dimension ref="' + dimension + '"/>');
    // rightToLeft so the doctor opens a file that reads the Arabic way round.
    out.push('<sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>');
    out.push('<sheetFormatPr defaultRowHeight="15"/>');
    out.push('<sheetData>');

    rows.forEach(function (row, r) {
      var cells = row || [];
      var line = '<row r="' + (r + 1) + '">';
      cells.forEach(function (value, c) {
        if (value === null || value === undefined || value === '') return;
        var ref = columnName(c) + (r + 1);
        if (isNumber(value)) line += '<c r="' + ref + '"><v>' + value + '</v></c>';
        else line += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(value) + '</t></is></c>';
      });
      out.push(line + '</row>');
    });

    out.push('</sheetData></worksheet>');
    return out.join('');
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  /**
   * @param {Array<Array<string|number>>} rows  first row = the header
   * @param {string} [sheetName]
   * @returns {Uint8Array} the bytes of a real .xlsx
   */
  function build(rows, sheetName) {
    var name = String(sheetName || 'Bookings').replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31) || 'Bookings';

    var contentTypes = XML_HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>';

    var rootRels = XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    var workbook = XML_HEAD +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + xmlEscape(name) + '" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>';

    var workbookRels = XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>';

    return zip([
      { name: '[Content_Types].xml', data: utf8(contentTypes) },
      { name: '_rels/.rels', data: utf8(rootRels) },
      { name: 'xl/workbook.xml', data: utf8(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: utf8(workbookRels) },
      { name: 'xl/worksheets/sheet1.xml', data: utf8(sheetXml(rows || [])) }
    ]);
  }

  return { build: build, utf8: utf8, crc32: crc32, columnName: columnName, zip: zip };
});
