/**
 * Saintpaulia Ancestry: submission receiver (Google Apps Script, bound to the review Sheet).
 * See apps_script/README.md for setup and notes/submission-form-plan.md for the design.
 *
 * The #/submit form POSTs one JSON batch (text/plain, so no CORS preflight):
 *   { v: 1, sid, hp, rows: [ {submission_id, entry_no, ... one object per cultivar} ],
 *     photos: [ {name, data (base64 JPEG)} ] }
 * Each row is appended to the Inbox tab (matched to columns by header name). Photos are saved to Drive in
 * "AV Submissions photos/<sid>/". The owner gets an email. Re-sending the same submission_id refreshes rows
 * that have no decision yet and leaves rows the reviewer already decided on alone.
 *
 * Everything above the "Google services" line is pure JavaScript (no Google APIs) so it can be tested.
 * COLUMNS must match SHEET_COLUMNS in scripts/submissions_lib.py (the header row is built from it).
 */

var COLUMNS = [
  // from the form
  'submission_id', 'entry_no', 'received_at', 'submitter_name', 'contact', 'agreed_license',
  'action', 'existing_id', 'name', 'kind', 'hybridizers', 'year_introduced', 'seed_parent', 'pollen_parent',
  'parent_certainty', 'sport_of', 'parentage_note', 'registration_no', 'registered_date', 'size_class', 'color',
  'bloom_description', 'foliage_description', 'description', 'notes', 'links', 'photo_files', 'photo_captions',
  'photo_credits', 'photo_permission',
  // filled in by the reviewer
  'decision', 'join_id', 'overwrite_fields', 'admin_note', 'reply_note', 'flag_name_match', 'flag_parents', 'flag_other',
  'corrected_name', 'corrected_kind', 'corrected_hybridizers', 'corrected_year_introduced', 'corrected_seed_parent',
  'corrected_pollen_parent', 'corrected_parent_certainty', 'corrected_sport_of', 'corrected_parentage_note',
  'corrected_registration_no', 'corrected_registered_date', 'corrected_size_class', 'corrected_color',
  'corrected_bloom_description', 'corrected_foliage_description', 'corrected_description', 'corrected_notes',
  'corrected_links', 'corrected_photo_files', 'corrected_photo_captions', 'corrected_photo_credits',
  'corrected_photo_permission'
];
var FORM_COLUMNS = COLUMNS.slice(0, COLUMNS.indexOf('decision'));
var DECISIONS = ['accept', 'join', 'different', 'reject', 'hold'];
var LIMITS = { rows: 100, photos: 40, photoBytes: 4 * 1024 * 1024, totalBytes: 20 * 1024 * 1024, dayRows: 300, field: 5000 };
var SID_RE = /^[A-Za-z0-9_-]{3,60}$/;

/** Trim, drop control characters and cap the length of one submitted value. */
function cleanValue_(v) {
  var s = (v === null || v === undefined) ? '' : String(v);
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return s.length > LIMITS.field ? s.slice(0, LIMITS.field) : s;
}

/** A safe file name for a photo: letters, digits, dot, dash, underscore, space; must end in .jpg. */
function safePhotoName_(name) {
  var n = String(name || '').replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^\.+/, '').slice(0, 100);
  return /\.jpe?g$/i.test(n) ? n : n + '.jpg';
}

/** True when the base64 text decodes to something starting like a JPEG (FF D8 FF). */
function looksLikeJpegBase64_(b64) {
  return typeof b64 === 'string' && b64.slice(0, 4) === '/9j/';
}

/**
 * Check a parsed payload. Returns { ok: true, rows: [clean row objects], photos: [{name, data, bytes}] }
 * or { ok: false, error: 'text for the contributor' }.
 */
function validatePayload_(p) {
  if (!p || typeof p !== 'object') return { ok: false, error: 'Empty or unreadable submission.' };
  if (p.hp) return { ok: false, error: 'Rejected.' };                      // honeypot field was filled in
  if (p.v !== 1) return { ok: false, error: 'This form is out of date. Reload the page and try again.' };
  if (!Array.isArray(p.rows) || !p.rows.length) return { ok: false, error: 'No cultivars in the submission.' };
  if (p.rows.length > LIMITS.rows) return { ok: false, error: 'Too many cultivars in one submission (limit ' + LIMITS.rows + ').' };
  var sid = cleanValue_(p.sid);
  if (!SID_RE.test(sid)) return { ok: false, error: 'Missing or invalid submission id.' };
  var rows = [], seen = {};
  for (var i = 0; i < p.rows.length; i++) {
    var src = p.rows[i] || {}, row = {};
    for (var c = 0; c < FORM_COLUMNS.length; c++) row[FORM_COLUMNS[c]] = cleanValue_(src[FORM_COLUMNS[c]]).trim();
    row.submission_id = sid;
    row.entry_no = String(i + 1);
    row.received_at = '';
    if (!row.name) return { ok: false, error: 'Entry ' + (i + 1) + ' has no name.' };
    if (row.agreed_license.toLowerCase() !== 'yes') return { ok: false, error: 'The license agreement must be ticked.' };
    if (!row.submitter_name) return { ok: false, error: 'Your name is required.' };
    if (seen[row.name.toLowerCase()]) return { ok: false, error: 'The name "' + row.name + '" appears more than once.' };
    seen[row.name.toLowerCase()] = true;
    rows.push(row);
  }
  var photos = [], total = 0, names = {};
  var ph = Array.isArray(p.photos) ? p.photos : [];
  if (ph.length > LIMITS.photos) return { ok: false, error: 'Too many photos in one submission (limit ' + LIMITS.photos + ').' };
  for (var k = 0; k < ph.length; k++) {
    var name = safePhotoName_(ph[k] && ph[k].name), data = ph[k] && ph[k].data;
    if (!looksLikeJpegBase64_(data)) return { ok: false, error: 'Photo ' + name + ' is not a JPEG image.' };
    var bytes = Math.floor(data.length * 3 / 4);
    if (bytes > LIMITS.photoBytes) return { ok: false, error: 'Photo ' + name + ' is too large.' };
    total += bytes;
    if (total > LIMITS.totalBytes) return { ok: false, error: 'The photos are too large to send together.' };
    if (names[name]) return { ok: false, error: 'Two photos are named ' + name + '.' };
    names[name] = true;
    photos.push({ name: name, data: data, bytes: bytes });
  }
  return { ok: true, sid: sid, rows: rows, photos: photos };
}

/** Row object -> array in sheet column order (header names -> values; unknown headers stay blank). */
function rowToArray_(row, headers) {
  return headers.map(function (h) { return row[h] === undefined ? '' : row[h]; });
}

// ======================================================================== Google services below this line

var TAB = 'Inbox';

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return jsonOut_({ ok: true, service: 'Saintpaulia Ancestry submission receiver', version: 1 });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var payload;
    try { payload = JSON.parse(e.postData.contents); } catch (err) { return jsonOut_({ ok: false, error: 'Unreadable submission.' }); }
    var v = validatePayload_(payload);
    if (!v.ok) return jsonOut_(v);

    var props = PropertiesService.getScriptProperties();
    var day = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
    var used = Number(props.getProperty('rows_' + day) || 0);
    if (used + v.rows.length > LIMITS.dayRows) return jsonOut_({ ok: false, error: 'The inbox is full for today. Please try again tomorrow, or email the file.' });

    var sheet = inbox_();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var last = sheet.getLastRow();
    var existing = {};   // "sid|entry" -> sheet row number
    if (last > 1) {
      var sidCol = headers.indexOf('submission_id'), entCol = headers.indexOf('entry_no'), decCol = headers.indexOf('decision');
      var vals = sheet.getRange(2, 1, last - 1, headers.length).getValues();
      for (var i = 0; i < vals.length; i++) {
        if (vals[i][sidCol] === v.sid) existing[String(vals[i][entCol])] = { row: i + 2, decided: String(vals[i][decCol]).trim() !== '' };
      }
    }
    var now = new Date(), added = 0, refreshed = 0, kept = 0;
    v.rows.forEach(function (row) {
      var hit = existing[row.entry_no];
      if (hit && hit.decided) { kept++; return; }          // the reviewer already worked on it: leave it
      if (hit) {                                           // resend of an undecided row: refresh the form columns
        row.received_at = Utilities.formatDate(now, 'UTC', 'yyyy-MM-dd HH:mm:ss');
        var range = sheet.getRange(hit.row, 1, 1, FORM_COLUMNS.length);
        range.setNumberFormat('@');
        range.setValues([rowToArray_(row, headers).slice(0, FORM_COLUMNS.length)]);
        refreshed++;
        return;
      }
      row.received_at = Utilities.formatDate(now, 'UTC', 'yyyy-MM-dd HH:mm:ss');
      var target = sheet.getLastRow() + 1;
      var r = sheet.getRange(target, 1, 1, headers.length);
      r.setNumberFormat('@');                              // text only: nothing is read as a formula, number or date
      r.setValues([rowToArray_(row, headers)]);
      added++;
    });

    var saved = 0;
    if (v.photos.length) {
      var folder = photoFolder_(v.sid);
      v.photos.forEach(function (p) {
        var old = folder.getFilesByName(p.name);
        while (old.hasNext()) old.next().setTrashed(true);   // a resend replaces the earlier copy
        folder.createFile(Utilities.newBlob(Utilities.base64Decode(p.data), 'image/jpeg', p.name));
        saved++;
      });
    }
    props.setProperty('rows_' + day, String(used + added));
    notify_(v, added, refreshed, saved);
    return jsonOut_({ ok: true, received: added + refreshed, kept: kept, photos: saved, sid: v.sid });
  } catch (err) {
    return jsonOut_({ ok: false, error: 'The receiver had a problem. Please download the file and email it instead.' });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* not held */ }
  }
}

function inbox_() {
  var id = PropertiesService.getScriptProperties().getProperty('sheet_id');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Run setupSheet from the Sheet first.');
  var sheet = ss.getSheetByName(TAB) || ss.insertSheet(TAB, 0);
  // self-healing: make sure the header row exists, so a first submission works even if setupSheet was skipped
  if (sheet.getMaxColumns() < COLUMNS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), COLUMNS.length - sheet.getMaxColumns());
  if (sheet.getRange(1, 1).getValue() !== COLUMNS[0]) {
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function photoFolder_(sid) {
  var props = PropertiesService.getScriptProperties();
  var rootId = props.getProperty('photo_root');
  var root;
  try { root = rootId ? DriveApp.getFolderById(rootId) : null; } catch (err) { root = null; }
  if (!root) {
    root = DriveApp.createFolder('AV Submissions photos');
    props.setProperty('photo_root', root.getId());
  }
  var it = root.getFoldersByName(sid);
  return it.hasNext() ? it.next() : root.createFolder(sid);
}

function notify_(v, added, refreshed, photos) {
  try {
    var who = v.rows[0].submitter_name;
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
      'New cultivar submission from ' + who + ' (' + v.rows.length + ')',
      who + ' sent ' + v.rows.length + ' cultivar(s): ' + v.rows.map(function (r) { return r.name; }).join(', ') + '.\n' +
      'New rows: ' + added + ', refreshed: ' + refreshed + ', photos: ' + photos + '.\nSubmission id: ' + v.sid + '\n');
  } catch (err) { /* email is a courtesy; the rows are already saved */ }
}

/**
 * Run once from the editor (Run > setupSheet) after pasting this file into the Sheet's Apps Script project
 * (open the project from the Sheet: Extensions > Apps Script). Builds the Inbox tab: header row, decision
 * dropdowns, colors, frozen header and a Help tab. Safe to re-run: it never deletes rows.
 * The header row and the stored Sheet id are essential; every formatting step is optional, and a step that fails
 * is reported at the end instead of stopping the setup.
 */
function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('This script is not attached to a Sheet. Close it, open your Google Sheet, and use Extensions > Apps Script there.');
  }
  PropertiesService.getScriptProperties().setProperty('sheet_id', ss.getId());
  var sheet = ss.getSheetByName(TAB) || ss.insertSheet(TAB, 0);
  var n = COLUMNS.length;
  if (sheet.getMaxColumns() < n) sheet.insertColumnsAfter(sheet.getMaxColumns(), n - sheet.getMaxColumns());
  if (sheet.getMaxRows() < 2001) sheet.insertRowsAfter(sheet.getMaxRows(), 2001 - sheet.getMaxRows());
  sheet.getRange(1, 1, 1, n).setValues([COLUMNS]);                     // essential: the receiver reads this header
  SpreadsheetApp.flush();

  var formEnd = FORM_COLUMNS.length, adminEnd = COLUMNS.indexOf('corrected_name');
  var dec = COLUMNS.indexOf('decision') + 1;
  var failed = [];
  function step(label, fn) {
    try { fn(); } catch (err) { failed.push(label + ': ' + err.message); Logger.log('setupSheet step "' + label + '" failed: ' + err); }
  }
  step('header style', function () {
    sheet.getRange(1, 1, 1, n).setFontWeight('bold').setWrap(true);
    sheet.getRange(1, 1, 1, formEnd).setBackground('#e8dcf4');                       // submitted
    sheet.getRange(1, formEnd + 1, 1, adminEnd - formEnd).setBackground('#fff2cc');  // reviewer
    sheet.getRange(1, adminEnd + 1, 1, n - adminEnd).setBackground('#d9ead3');       // corrected_*
  });
  step('freeze', function () { sheet.setFrozenRows(1); sheet.setFrozenColumns(3); });
  step('column widths', function () {
    for (var c = 1; c <= n; c++) sheet.setColumnWidth(c, 130);
    ['description', 'notes', 'corrected_description', 'corrected_notes', 'flag_name_match', 'flag_parents', 'flag_other']
      .forEach(function (h) { sheet.setColumnWidth(COLUMNS.indexOf(h) + 1, 320); });
  });
  step('decision dropdown', function () {
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(DECISIONS, true).setAllowInvalid(false).build();
    sheet.getRange(2, dec, 2000, 1).setDataValidation(rule);
  });
  step('action dropdown', function () {
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(['new', 'update'], true).setAllowInvalid(true).build();
    sheet.getRange(2, COLUMNS.indexOf('action') + 1, 2000, 1).setDataValidation(rule);
  });
  step('decision colors', function () {
    var colors = { accept: '#b7e1cd', join: '#cfe2f3', different: '#cfe2f3', reject: '#d9d9d9', hold: '#fce5cd' };
    var decRange = sheet.getRange(2, dec, 2000, 1);
    sheet.setConditionalFormatRules(Object.keys(colors).map(function (k) {
      return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(k).setBackground(colors[k]).setRanges([decRange]).build();
    }));
  });
  step('filter', function () {
    if (!sheet.getFilter()) sheet.getRange(1, 1, 2000, n).createFilter();
  });
  step('column group', function () {                                   // corrected_* columns: group and collapse
    var cols = sheet.getRange(1, adminEnd + 1, 1, n - adminEnd);
    cols.shiftColumnGroupDepth(1);
    sheet.getColumnGroup(adminEnd + 1, 1).collapse();
  });
  step('help tab', function () { helpTab_(ss); });

  var NL = String.fromCharCode(10);
  var msg = failed.length
    ? 'Inbox is ready, but these optional formatting steps failed (the receiver does not need them):' + NL + NL + failed.join(NL)
    : 'Inbox is ready. Next: Deploy > New deployment > Web app (see apps_script/README.md).';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (err) { /* no UI when run from a trigger */ }
}

function helpTab_(ss) {
  var help = ss.getSheetByName('Help') || ss.insertSheet('Help');
  help.clear();
  var lines = [
    ['How to review a submission'],
    ['1. One row per cultivar. Purple headings were sent by the contributor; yellow are yours; green (grouped, click + above the headings) hold corrected values.'],
    ['2. Download the Inbox tab as CSV (File > Download) into submissions/inbox/ and run: python scripts/check_submissions.py <file>. Paste the three flag_* columns of the result back here.'],
    ['3. Set decision for each row: accept (new cultivar), join (same cultivar as an existing one: also fill join_id), different (a new cultivar although the name exists), reject, or hold.'],
    ['4. To change what is imported, type the corrected value in the matching corrected_* column. To replace an existing value on a join, list the field in overwrite_fields (for example: description; parents).'],
    ['5. A parent name shared by several cultivars: write id:<slug> in corrected_seed_parent, corrected_pollen_parent or corrected_sport_of.'],
    ['6. Put a note for the contributor in reply_note. Contact details are in the contact column: never copy them into the repository.'],
    ['7. Download the Inbox as CSV again and run: python scripts/import_submissions.py ingest <file>, then apply, build_db.py and the export.'],
    ['Photos are in Drive: "AV Submissions photos/<submission_id>/". Download that folder and use: python scripts/import_submissions.py apply --photos-dir <folder>.']
  ];
  help.getRange(1, 1, lines.length, 1).setValues(lines).setWrap(true);
  help.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  help.setColumnWidth(1, 900);
}
