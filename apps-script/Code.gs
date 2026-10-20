/**
 * Rachana & Sahit's baby shower — backend (Google Apps Script, bound to the Google Sheet)
 *
 * What it does
 *  - Stores guests, RSVPs, wishes and guesses in the Sheet's tabs
 *  - Serves the public site (settings, wishes, guesses, personalized guest lookups)
 *  - Serves the host dashboard (everything, behind the host key)
 *  - Sends emails from your Gmail: invitations, reminders, day-before details,
 *    RSVP confirmations (with a calendar file) and an RSVP notification to you
 *
 * One-time setup (about 3 minutes)
 *  1. In the Sheet: Extensions → Apps Script. Replace everything in Code.gs with this file. Save.
 *  2. Pick "setup" in the function dropdown and click Run. Approve the permissions
 *     (Advanced → Go to project → Allow). This creates the tabs and your host key.
 *  3. Deploy → New deployment → type "Web app" → Execute as: Me, Who has access: Anyone → Deploy.
 *     Copy the Web app URL into config.js (appsScriptUrl) on the site.
 *  After changing this code later: Deploy → Manage deployments → ✎ → Version: New version → Deploy.
 */

var VERSION = "1.1.0";

var SHEETS = {
  Settings: ["Key", "Value"],
  Guests:   ["Token", "Name", "Email", "Phone", "Group", "Added", "InvitedAt", "RemindedAt", "ViewedAt", "Notes"],
  RSVPs:    ["Token", "Name", "Attending", "Adults", "Kids", "Diet", "DietNote", "Email", "Phone", "Note", "CreatedAt", "UpdatedAt", "Party"],
  Wishes:   ["Id", "Token", "Name", "Message", "CreatedAt", "Visible"],
  Guesses:  ["Token", "Name", "Date", "TimeOfDay", "WeightOz", "Length", "Sex", "CreatedAt"],
  Log:      ["Time", "Action", "Detail"]
};

// Settings that must never be sent to the public site.
var PRIVATE_KEYS = ["hostKey", "notifyEmail"];

// Early placeholder values that setup() may overwrite with the real details below.
var PLACEHOLDERS = ["https://sahitg.github.io/baby-shower/", "16:00",
  "11:00 | Welcome drinks & snacks\n12:00 | Lunch\n1:00 | Games & the guessing board\n2:15 | Cake, wishes & a few words\n3:00 | Farewell",
  "Hi {first}, just a nudge: we're still hoping you can join us for the baby shower on Sat, Oct 31. Could you RSVP by Oct 24? {link}",
  "11:00 | Welcome drinks & snacks\n12:00 | Lunch\n1:00 | Games & the guessing board\n2:30 | Cake, wishes & a few words\n4:00 | Farewell",
  "Hi {first}! Rachana and I are hosting a baby shower on Sat, Oct 31 (11am–4pm) near Snoqualmie and would love for you to come. All the details + RSVP are here: {link}",
  "Hi {first}! See you tomorrow at the baby shower, 11am–4pm. Address and parking details are here: {link}",
  "Venue to be announced", "Near Snoqualmie, WA", "Our baby registry", "2026-10-24", "Free parking on site. Carpooling is welcome but not required.",
  "11:00 | Welcome, mimosas & mocktails\n12:00 | Lunch\n1:00 | Games & the guessing board\n2:30 | Cake, wishes & a few words\n4:00 | Farewell"];

// Mirrors config.js on the site. Edit values in the Settings tab (or from the host dashboard).
var DEFAULT_SETTINGS = [
  ["siteUrl", "https://sahitg.github.io/babyshower/"],
  ["eventTitle", "A baby shower for Rachana & Sahit"],
  ["signature", "Rachana & Sahit"],
  ["hostedBy", "Hosted by Sahit"],
  ["date", "2026-10-31"],
  ["startTime", "11:00"],
  ["endTime", "15:00"],
  ["timeZone", "America/Los_Angeles"],
  ["rsvpBy", "2026-10-27"],
  ["dueMonth", "2027-01"],
  ["showSex", "false"],
  ["babySex", "boy"],
  ["venueName", "The Club at Snoqualmie Ridge"],
  ["venueAddress", "36005 SE Ridge St, Snoqualmie, WA 98065"],
  ["mapsUrl", ""],
  ["registryLabel1", "Our Babylist registry"],
  ["registryUrl1", "https://my.babylist.com/rachana-mandru"],
  ["registryLabel2", ""],
  ["registryUrl2", ""],
  ["contactName", "Sahit"],
  ["contactEmail", ""],
  ["contactPhone", "(314) 814-3486"],
  ["parking", "Free parking in the club's lot. Carpooling is welcome but not required."],
  ["dressCode", "Autumn casual. We'll be indoors, but bring a layer for photos outside."],
  ["kidsNote", "Kids are very welcome. Let us know how many are coming so we can plan activities and seating."],
  ["giftNote", "Your presence is the real gift. If you'd like to bring something, the registry has everything we've been dreaming about. Items can ship straight to our home or come along with you."],
  ["schedule", "11:00 | Welcome drinks & snacks\n12:00 | Games & the guessing board\n1:00 | Lunch\n2:15 | Cake, wishes & a few words\n3:00 | Farewell"],
  ["heroCaption", "Baby Garapati arrives January 2027"],
  ["photoUrl", ""],
  ["emailSubject", "You're invited: a baby shower for Rachana & Sahit, Oct 31"],
  ["emailIntro", "We're expecting a little one in January, and we'd love to celebrate with you before the baby arrives. Join us for a relaxed afternoon of lunch, games and good company."],
  ["smsTemplate", "Hi {first}! Rachana and I are hosting a baby shower on Sat, Oct 31 (11am–3pm) at The Club at Snoqualmie Ridge and would love for you to come. All the details + RSVP are here: {link}"],
  ["reminderTemplate", "Hi {first}, just a nudge: we're still hoping you can join us for the baby shower on Sat, Oct 31. Could you RSVP by Oct 27? {link}"],
  ["dayBeforeTemplate", "Hi {first}! See you tomorrow at the baby shower, 11am–3pm. Address and parking details are here: {link}"],
  ["notifyEmail", ""],   // where RSVP notifications go; blank = the account that deployed the script
  ["hostKey", ""]        // generated by setup(); needed to open the host dashboard
];

/* =========================================================================
   Entry points
   ========================================================================= */

function setup() {
  ensureSheets_();
  normalizeSettingsSheet_();
  var s = getSettings_();
  var sh = sheet_("Settings");
  var existing = {};
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) existing[String(rows[i][0])] = true;
  DEFAULT_SETTINGS.forEach(function (kv) { if (!existing[kv[0]]) sh.appendRow([kv[0], kv[1]]); });
  // Replace early placeholders with the real details (only when the cell still holds the placeholder).
  var current = getSettings_();
  DEFAULT_SETTINGS.forEach(function (kv) {
    var cur = String(current[kv[0]] == null ? "" : current[kv[0]]).trim();
    if (kv[1] && (cur === "" || PLACEHOLDERS.indexOf(cur) >= 0) && cur !== kv[1]) setSetting_(kv[0], kv[1]);
  });
  if (!s.hostKey) setSetting_("hostKey", "shower-" + token_(10));
  if (!s.notifyEmail) setSetting_("notifyEmail", Session.getEffectiveUser().getEmail());
  s = getSettings_();
  log_("setup", "ok");
  var msg = "Setup complete. Your host key is: " + s.hostKey + " (also in the Settings tab).";
  Logger.log(msg);
  try { SpreadsheetApp.getActive().toast(msg, "Baby shower backend", 30); } catch (e) { }
  return msg;
}

function doGet(e) {
  try { return json_(handleGet_(e && e.parameter ? e.parameter : {})); }
  catch (err) { return json_({ ok: false, error: String(err && err.message || err) }); }
}

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
    return json_(handlePost_(body));
  } catch (err) { return json_({ ok: false, error: String(err && err.message || err) }); }
}

function handleGet_(p) {
  ensureSheets_();
  var action = String(p.action || "");
  var s = getSettings_();
  switch (action) {
    case "ping": return { ok: true, version: VERSION, time: new Date().toISOString() };
    case "settings": return { ok: true, settings: publicSettings_(s) };
    case "guest": return guestLookup_(String(p.t || ""));
    case "view": return { ok: true, viewed: markViewed_(String(p.t || "")) };
    case "wishes": return { ok: true, wishes: listWishes_(false) };
    case "guesses": return { ok: true, guesses: listGuesses_() };
    case "admin":
      requireKey_(p.key, s);
      return adminData_(s);
    case "preview":
      requireKey_(p.key, s);
      var sample = { token: "sample", name: (s.contactName || "Sahit") + " (sample)", email: s.notifyEmail };
      var m = buildEmail_(String(p.kind || "invite"), sample, s, null);
      return { ok: true, subject: m.subject, html: m.html, text: m.text };
    default: throw new Error("Unknown action: " + action);
  }
}

function handlePost_(b) {
  ensureSheets_();
  var action = String(b.action || "");
  var s = getSettings_();
  switch (action) {
    case "rsvp": return withLock_(function () { return saveRsvp_(b, s); });
    case "wish": return withLock_(function () { return addWish_(b); });
    case "guess": return withLock_(function () { return saveGuess_(b); });
    case "admin":
      requireKey_(b.key, s);
      return withLock_(function () { return adminOp_(b, s); });
    default: throw new Error("Unknown action: " + action);
  }
}

/* =========================================================================
   Public: guests, RSVPs, wishes, guesses
   ========================================================================= */

function guestLookup_(token) {
  if (!token) return { ok: true, found: false };
  var g = findByToken_("Guests", token);
  var r = findByToken_("RSVPs", token);
  var q = findByToken_("Guesses", token);
  if (!g && !r) return { ok: true, found: false };
  var name = (r && r.Name) || (g && g.Name) || "";
  return {
    ok: true, found: true, name: name,
    email: (g && g.Email) || (r && r.Email) || "",
    phone: (g && g.Phone) || (r && r.Phone) || "",
    rsvp: r ? rsvpOut_(r) : null,
    guess: q ? guessOut_(q) : null
  };
}

function markViewed_(token) {
  if (!token) return false;
  var sh = sheet_("Guests");
  var row = findRowIndex_(sh, 1, token);
  if (!row) return false;
  var col = SHEETS.Guests.indexOf("ViewedAt") + 1;
  if (!sh.getRange(row, col).getValue()) sh.getRange(row, col).setValue(now_());
  return true;
}

function saveRsvp_(b, s) {
  var token = clean_(b.token, 40) || ("w-" + token_(8));
  var name = clean_(b.name, 120);
  if (!name) throw new Error("Name is required");
  var attending = String(b.attending) === "yes" ? "yes" : "no";
  var party = attending === "yes" ? cleanParty_(b.party) : [];
  var adultsInParty = party.filter(function (m) { return m.type === "adult"; }).length;
  var kidsInParty = party.filter(function (m) { return m.type === "child"; }).length;
  var rec = {
    Token: token, Name: name, Attending: attending,
    Adults: attending === "yes" ? (party.length ? 1 + adultsInParty : clampInt_(b.adults, 1, 20, 1)) : 0,
    Kids: attending === "yes" ? (party.length ? kidsInParty : clampInt_(b.kids, 0, 20, 0)) : 0,
    Party: partyToString_(party),
    Diet: attending === "yes" ? (Array.isArray(b.diet) ? b.diet.map(function (d) { return clean_(d, 40); }).filter(Boolean).join(", ") : clean_(b.diet, 200)) : "",
    DietNote: attending === "yes" ? clean_(b.dietNote, 300) : "",
    Email: clean_(b.email, 120).toLowerCase(),
    Phone: clean_(b.phone, 40),
    Note: clean_(b.note, 600),
    UpdatedAt: now_()
  };
  var sh = sheet_("RSVPs");
  var row = findRowIndex_(sh, 1, token);
  var isNew = !row;
  if (row) {
    var created = sh.getRange(row, SHEETS.RSVPs.indexOf("CreatedAt") + 1).getValue();
    rec.CreatedAt = created || now_();
    writeRow_(sh, row, SHEETS.RSVPs, rec);
  } else {
    rec.CreatedAt = now_();
    appendRow_(sh, SHEETS.RSVPs, rec);
  }
  // Make sure every responder exists in Guests (so walk-ins show up on the dashboard).
  var gs = sheet_("Guests");
  var grow = findRowIndex_(gs, 1, token);
  if (!grow) appendRow_(gs, SHEETS.Guests, { Token: token, Name: name, Email: rec.Email, Phone: rec.Phone, Group: "Walk-in", Added: now_(), ViewedAt: now_() });
  else {
    // fill in contact details the guest gave us if we didn't have them
    var g = rowToObj_(gs, grow, SHEETS.Guests);
    var upd = {};
    if (!g.Email && rec.Email) upd.Email = rec.Email;
    if (!g.Phone && rec.Phone) upd.Phone = rec.Phone;
    if (Object.keys(upd).length) writeRow_(gs, grow, SHEETS.Guests, upd);
  }
  log_("rsvp", name + " → " + attending + " (" + rec.Adults + "a/" + rec.Kids + "k)");
  // Emails (best effort — never fail the RSVP because of mail)
  var mail = { confirmation: false, notified: false };
  try { if (rec.Email) { sendConfirmation_(rec, s); mail.confirmation = true; } } catch (e1) { log_("mail-error", "confirmation: " + e1); }
  try { notifyHost_(rec, s, isNew); mail.notified = true; } catch (e2) { log_("mail-error", "notify: " + e2); }
  return { ok: true, token: token, mail: mail };
}

function addWish_(b) {
  var name = clean_(b.name, 80), message = clean_(b.message, 400);
  if (!name || !message) throw new Error("Name and message are required");
  var id = "w" + Date.now().toString(36) + token_(4);
  appendRow_(sheet_("Wishes"), SHEETS.Wishes, { Id: id, Token: clean_(b.token, 40), Name: name, Message: message, CreatedAt: now_(), Visible: "TRUE" });
  log_("wish", name);
  return { ok: true, id: id };
}

function listWishes_(includeHidden) {
  var rows = readAll_("Wishes");
  var out = [];
  for (var i = rows.length - 1; i >= 0; i--) {
    var w = rows[i];
    var visible = String(w.Visible).toUpperCase() !== "FALSE";
    if (!includeHidden && !visible) continue;
    out.push({ id: w.Id, name: w.Name, message: w.Message, createdAt: w.CreatedAt, visible: visible, token: includeHidden ? w.Token : undefined });
  }
  return out.slice(0, 300);
}

function saveGuess_(b) {
  var name = clean_(b.name, 80), date = clean_(b.date, 10);
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Name and date are required");
  var token = clean_(b.token, 40);
  var rec = { Token: token, Name: name, Date: date, TimeOfDay: clean_(b.timeOfDay, 40), WeightOz: clampInt_(b.weightOz, 0, 400, 0), Length: Number(b.length) || "", Sex: /^(boy|girl)$/.test(String(b.sex)) ? String(b.sex) : "", CreatedAt: now_() };
  var sh = sheet_("Guesses");
  var row = token ? findRowIndex_(sh, 1, token) : 0;
  if (row) writeRow_(sh, row, SHEETS.Guesses, rec); else appendRow_(sh, SHEETS.Guesses, rec);
  log_("guess", name + " → " + date);
  return { ok: true };
}

function listGuesses_() {
  var rows = readAll_("Guesses");
  var out = [];
  for (var i = rows.length - 1; i >= 0; i--) out.push(guessOut_(rows[i]));
  return out.slice(0, 300);
}

function guessOut_(q) { return { name: q.Name, date: q.Date, timeOfDay: q.TimeOfDay, weightOz: Number(q.WeightOz) || 0, length: Number(q.Length) || 0, sex: q.Sex || "", createdAt: q.CreatedAt }; }
function rsvpOut_(r) {
  return { token: r.Token, name: r.Name, attending: r.Attending, adults: Number(r.Adults) || 0, kids: Number(r.Kids) || 0,
    diet: String(r.Diet || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean), dietNote: r.DietNote || "",
    email: r.Email || "", phone: r.Phone || "", note: r.Note || "", party: partyFromString_(r.Party), createdAt: r.CreatedAt, updatedAt: r.UpdatedAt };
}

/* Party helpers: "Meera (adult); Arjun (child, 6); Anika (child, under 1)" <-> [{name, type, age}] */
function cleanParty_(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 12).map(function (m) {
    m = m || {};
    var type = String(m.type) === "child" ? "child" : "adult";
    var age = clean_(m.age, 12);
    if (type !== "child") age = "";
    return { name: clean_(m.name, 60), type: type, age: age };
  });
}
function partyToString_(list) {
  return (list || []).map(function (m) {
    var label = (m.name || (m.type === "child" ? "child" : "guest")).replace(/[();]/g, "");
    return label + " (" + m.type + (m.age ? ", " + m.age.toLowerCase() : "") + ")";
  }).join("; ");
}
function partyFromString_(str) {
  var out = [];
  String(str || "").split(";").forEach(function (part) {
    var m = part.trim().match(/^(.*?)\s*\((adult|child)(?:,\s*(.+?))?\)$/i);
    if (!m) return;
    var age = m[3] ? m[3].trim() : "";
    if (/^under 1$/i.test(age)) age = "Under 1";
    out.push({ name: m[1].trim(), type: m[2].toLowerCase(), age: age });
  });
  return out;
}
function partyLabel_(list) {
  return (list || []).map(function (m) { return (m.name || (m.type === "child" ? "child" : "guest")) + (m.age ? " (" + m.age.toLowerCase() + ")" : ""); }).join(", ");
}

/* =========================================================================
   Host dashboard
   ========================================================================= */

function requireKey_(key, s) {
  if (!s.hostKey) throw new Error("Run setup() first to create a host key");
  if (!key || String(key) !== String(s.hostKey)) throw new Error("Wrong host key");
}

function adminData_(s) {
  var guests = readAll_("Guests").map(function (g) {
    return { token: g.Token, name: g.Name, email: g.Email, phone: g.Phone, group: g.Group, added: g.Added, invitedAt: g.InvitedAt, remindedAt: g.RemindedAt, viewedAt: g.ViewedAt, notes: g.Notes };
  });
  var rsvps = readAll_("RSVPs").map(rsvpOut_);
  var quota = -1; try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { }
  return { ok: true, version: VERSION, guests: guests, rsvps: rsvps, wishes: listWishes_(true), guesses: listGuesses_(), settings: s, quota: quota,
    sheetUrl: SpreadsheetApp.getActive().getUrl(), account: Session.getEffectiveUser().getEmail() };
}

function adminOp_(b, s) {
  var op = String(b.op || "");
  switch (op) {
    case "addGuests": return addGuests_(b.guests || []);
    case "updateGuest": return updateGuest_(b.token, b.fields || {});
    case "deleteGuest": return deleteGuest_(b.token);
    case "setWishVisible": return setWishVisible_(b.id, b.visible);
    case "updateSettings": return updateSettings_(b.settings || {});
    case "sendInvites": return sendBatch_("invite", b.tokens || [], s);
    case "sendReminders": return sendBatch_("reminder", b.tokens || [], s);
    case "sendDayBefore": return sendBatch_("dayBefore", b.tokens || [], s);
    case "markInvited": return markGuests_(b.tokens || [], "InvitedAt", now_());
    case "clearInvited": return markGuests_(b.tokens || [], "InvitedAt", "");
    case "sendTest": return sendTest_(String(b.kind || "invite"), s);
    default: throw new Error("Unknown op: " + op);
  }
}

function addGuests_(list) {
  var sh = sheet_("Guests");
  var existing = readAll_("Guests");
  var byEmail = {}; existing.forEach(function (g) { if (g.Email) byEmail[String(g.Email).toLowerCase()] = true; });
  var added = [], skipped = [];
  list.forEach(function (g) {
    var name = clean_(g.name, 120); if (!name) return;
    var email = clean_(g.email, 120).toLowerCase();
    if (email && byEmail[email]) { skipped.push(name); return; }
    var token = token_(8);
    appendRow_(sh, SHEETS.Guests, { Token: token, Name: name, Email: email, Phone: clean_(g.phone, 40), Group: clean_(g.group, 40), Added: now_(), Notes: clean_(g.notes, 200) });
    if (email) byEmail[email] = true;
    added.push({ token: token, name: name });
  });
  log_("addGuests", added.length + " added, " + skipped.length + " skipped");
  return { ok: true, added: added.length, skipped: skipped, guests: added };
}

function updateGuest_(token, fields) {
  var sh = sheet_("Guests");
  var row = findRowIndex_(sh, 1, clean_(token, 40));
  if (!row) throw new Error("Guest not found");
  var upd = {};
  ["Name", "Email", "Phone", "Group", "Notes"].forEach(function (k) {
    var lk = k.charAt(0).toLowerCase() + k.slice(1);
    if (fields[lk] != null) upd[k] = clean_(fields[lk], 200);
  });
  writeRow_(sh, row, SHEETS.Guests, upd);
  return { ok: true };
}

function deleteGuest_(token) {
  var sh = sheet_("Guests");
  var row = findRowIndex_(sh, 1, clean_(token, 40));
  if (!row) throw new Error("Guest not found");
  sh.deleteRow(row);
  log_("deleteGuest", token);
  return { ok: true };
}

function setWishVisible_(id, visible) {
  var sh = sheet_("Wishes");
  var row = findRowIndex_(sh, 1, clean_(id, 40));
  if (!row) throw new Error("Wish not found");
  sh.getRange(row, SHEETS.Wishes.indexOf("Visible") + 1).setValue(visible ? "TRUE" : "FALSE");
  return { ok: true };
}

function updateSettings_(obj) {
  var keys = Object.keys(obj);
  keys.forEach(function (k) {
    if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) return;
    if (k === "hostKey" && !String(obj[k] || "").trim()) return; // never blank the key
    setSetting_(k, String(obj[k] == null ? "" : obj[k]));
  });
  log_("updateSettings", keys.join(","));
  return { ok: true, settings: getSettings_() };
}

function markGuests_(tokens, col, value) {
  var sh = sheet_("Guests"), n = 0;
  tokens.forEach(function (t) {
    var row = findRowIndex_(sh, 1, clean_(t, 40));
    if (row) { sh.getRange(row, SHEETS.Guests.indexOf(col) + 1).setValue(value == null ? now_() : value); n++; }
  });
  return { ok: true, marked: n };
}

/* =========================================================================
   Email
   ========================================================================= */

function sendBatch_(kind, tokens, s) {
  var sh = sheet_("Guests");
  var rsvps = {}; readAll_("RSVPs").forEach(function (r) { rsvps[r.Token] = r; });
  var sent = [], skipped = [], errors = [];
  var remaining = MailApp.getRemainingDailyQuota();
  tokens.forEach(function (t) {
    t = clean_(t, 40);
    var row = findRowIndex_(sh, 1, t);
    if (!row) { skipped.push({ token: t, why: "not found" }); return; }
    var g = rowToObj_(sh, row, SHEETS.Guests);
    if (!g.Email) { skipped.push({ token: t, name: g.Name, why: "no email" }); return; }
    if (kind === "reminder" && rsvps[t]) { skipped.push({ token: t, name: g.Name, why: "already replied" }); return; }
    if (kind === "dayBefore" && !(rsvps[t] && rsvps[t].Attending === "yes")) { skipped.push({ token: t, name: g.Name, why: "not attending" }); return; }
    if (remaining <= 0) { skipped.push({ token: t, name: g.Name, why: "daily email quota reached" }); return; }
    try {
      var m = buildEmail_(kind, { token: g.Token, name: g.Name, email: g.Email }, s, rsvps[t] || null);
      sendMail_(g.Email, m, s, kind === "invite");
      remaining--;
      var col = kind === "invite" ? "InvitedAt" : "RemindedAt";
      sh.getRange(row, SHEETS.Guests.indexOf(col) + 1).setValue(now_());
      sent.push({ token: t, name: g.Name });
    } catch (e) { errors.push({ token: t, name: g.Name, error: String(e) }); }
  });
  log_("send-" + kind, sent.length + " sent, " + skipped.length + " skipped, " + errors.length + " errors");
  return { ok: true, sent: sent.length, skipped: skipped, errors: errors, quota: remaining };
}

function sendTest_(kind, s) {
  var to = s.notifyEmail || Session.getEffectiveUser().getEmail();
  var m = buildEmail_(kind, { token: "sample", name: "Sample Guest", email: to }, s, null);
  m.subject = "[Test] " + m.subject;
  sendMail_(to, m, s, kind === "invite");
  return { ok: true, sent: 1, to: to };
}

function sendMail_(to, m, s, attachIcs) {
  var opts = { htmlBody: m.html, name: s.signature || "Rachana & Sahit" };
  if (s.notifyEmail) opts.replyTo = s.notifyEmail;
  if (attachIcs) opts.attachments = [Utilities.newBlob(buildIcs_(s), "text/calendar", "baby-shower.ics")];
  MailApp.sendEmail(to, m.subject, m.text, opts);
}

function sendConfirmation_(rec, s) {
  var m = buildEmail_(rec.Attending === "yes" ? "confirmYes" : "confirmNo", { token: rec.Token, name: rec.Name, email: rec.Email }, s, rec);
  sendMail_(rec.Email, m, s, rec.Attending === "yes");
}

function notifyHost_(rec, s, isNew) {
  var to = s.notifyEmail || Session.getEffectiveUser().getEmail();
  var head = (isNew ? "New RSVP: " : "Updated RSVP: ") + rec.Name + " — " + (rec.Attending === "yes" ? "attending" : "not attending");
  var lines = [head, ""];
  if (rec.Attending === "yes") lines.push("Party: " + rec.Adults + " adult(s), " + rec.Kids + " kid(s)" + (rec.Party ? " — " + rec.Name + " + " + partyLabel_(partyFromString_(rec.Party)) : ""));
  if (rec.Diet || rec.DietNote) lines.push("Food: " + [rec.Diet, rec.DietNote].filter(Boolean).join(" — "));
  if (rec.Email) lines.push("Email: " + rec.Email);
  if (rec.Phone) lines.push("Phone: " + rec.Phone);
  if (rec.Note) lines.push("", "Note: " + rec.Note);
  var tally = tally_();
  lines.push("", "Running total: " + tally.yes + " yes (" + tally.adults + " adults, " + tally.kids + " kids), " + tally.no + " no, " + tally.awaiting + " awaiting.", "", "Dashboard: " + (s.siteUrl ? s.siteUrl.replace(/\/?$/, "/") + "host.html" : "(set siteUrl in Settings)"), "Sheet: " + SpreadsheetApp.getActive().getUrl());
  MailApp.sendEmail(to, head, lines.join("\n"), { name: "Baby shower RSVPs" });
}

function tally_() {
  var guests = readAll_("Guests"), rsvps = readAll_("RSVPs");
  var t = { yes: 0, no: 0, adults: 0, kids: 0, awaiting: 0 };
  var replied = {};
  rsvps.forEach(function (r) { replied[r.Token] = true; if (r.Attending === "yes") { t.yes++; t.adults += Number(r.Adults) || 0; t.kids += Number(r.Kids) || 0; } else t.no++; });
  guests.forEach(function (g) { if (!replied[g.Token]) t.awaiting++; });
  return t;
}

function buildEmail_(kind, guest, s, rsvp) {
  var first = firstName_(guest.name);
  var link = personalLink_(guest.token, s);
  var dateLong = fmtDate_(s.date, s.timeZone, "EEEE, MMMM d, yyyy");
  var timeRange = fmtTime_(s.startTime) + " – " + fmtTime_(s.endTime);
  var where = [s.venueName, s.venueAddress].filter(Boolean).join(", ");
  var venueKnown = s.venueName && !/to be announced|coming soon/i.test(s.venueName);
  var rsvpBy = fmtDate_(s.rsvpBy, s.timeZone, "EEEE, MMMM d");
  var registry = s.registryUrl1 ? { label: s.registryLabel1 || "Our baby registry", url: s.registryUrl1 } : null;
  var mapsUrl = s.mapsUrl || (venueKnown ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(where) : "");
  var subject, headline, intro, cta, ctaUrl, extra = "", textExtra = "";

  if (kind === "invite") {
    subject = s.emailSubject || ("You're invited: " + s.eventTitle);
    headline = s.eventTitle;
    intro = (first ? first + ", " + lc1_(s.emailIntro || "we'd love to celebrate with you before the baby arrives.") : (s.emailIntro || "We'd love to celebrate with you before the baby arrives."));
    cta = "RSVP"; ctaUrl = link + "#rsvp";
    extra = "<p style=\"margin:0 0 8px;color:#5E554E\">Please reply by <b>" + esc_(rsvpBy) + "</b>. Kids are welcome; just add them to your RSVP.</p>";
    textExtra = "Please reply by " + rsvpBy + ". Kids are welcome; just add them to your RSVP.";
  } else if (kind === "reminder") {
    subject = "A little nudge: RSVP for the baby shower by " + rsvpBy;
    headline = "We're hoping you can come";
    intro = (first ? first + ", " : "") + "we haven't heard from you yet and would love to know if you can make it. It takes about 30 seconds.";
    cta = "RSVP now"; ctaUrl = link + "#rsvp";
  } else if (kind === "dayBefore") {
    subject = "See you tomorrow at the baby shower";
    headline = "See you tomorrow";
    intro = (first ? first + ", " : "") + "here's everything for tomorrow: address, parking, and the plan for the afternoon.";
    cta = "Open the details"; ctaUrl = link + "#details";
    extra = "<p style=\"margin:0 0 8px;color:#5E554E\"><b>Parking:</b> " + esc_(s.parking || "") + "</p><p style=\"margin:0 0 8px;color:#5E554E\"><b>What to wear:</b> " + esc_(s.dressCode || "") + "</p>";
    textExtra = "Parking: " + (s.parking || "") + "\nWhat to wear: " + (s.dressCode || "");
  } else if (kind === "confirmYes") {
    subject = "You're in! " + s.eventTitle;
    headline = "You're on the list";
    intro = (first ? first + ", " : "") + "thank you for the RSVP. We can't wait to see you. A calendar file is attached, and we'll email the address and parking details the day before.";
    cta = "View or change your RSVP"; ctaUrl = link + "#rsvp";
    if (rsvp) {
      var who = rsvp.Party ? "you, " + partyLabel_(partyFromString_(rsvp.Party)) : rsvp.Adults + " adult(s)" + (Number(rsvp.Kids) ? ", " + rsvp.Kids + " kid(s)" : "");
      extra = "<p style=\"margin:0 0 8px;color:#5E554E\"><b>Your party:</b> " + esc_(who) + (rsvp.Diet || rsvp.DietNote ? "<br><b>Food:</b> " + esc_([rsvp.Diet, rsvp.DietNote].filter(Boolean).join(", ")) : "") + "</p>";
      textExtra = "Your party: " + who + (rsvp.Diet || rsvp.DietNote ? "\nFood: " + [rsvp.Diet, rsvp.DietNote].filter(Boolean).join(", ") : "");
    }
  } else if (kind === "confirmNo") {
    subject = "Thank you, " + (first || "friend");
    headline = "We'll miss you";
    intro = (first ? first + ", " : "") + "thank you for letting us know. If you'd like, leave a wish for the baby on the site; we're printing them for the nursery.";
    cta = "Leave a wish"; ctaUrl = link + "#wishes";
  } else throw new Error("Unknown email kind: " + kind);

  var sig = s.signature || "Rachana & Sahit";
  var html = emailHtml_({ headline: headline, intro: intro, dateLong: dateLong, timeRange: timeRange, where: venueKnown ? where : (s.venueAddress || "Address coming soon"), mapsUrl: mapsUrl, cta: cta, ctaUrl: ctaUrl, extra: extra, registry: registry, link: link, sig: sig, contact: [s.contactName, s.contactPhone, s.contactEmail].filter(Boolean).join(" · "), kind: kind, photoUrl: s.photoUrl });
  var text = [headline, "", intro, "", "When: " + dateLong + ", " + timeRange, "Where: " + (venueKnown ? where : (s.venueAddress || "Address coming soon")), "", textExtra, "", cta + ": " + ctaUrl, registry ? registry.label + ": " + registry.url : "", "", "With love,", sig].filter(function (l, i, a) { return !(l === "" && a[i - 1] === ""); }).join("\n");
  return { subject: subject, html: html, text: text };
}

function emailHtml_(v) {
  var btn = function (label, url, bg) {
    return "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"margin:8px 0\"><tr><td style=\"border-radius:999px;background:" + bg + "\"><a href=\"" + esc_(url) + "\" style=\"display:inline-block;padding:13px 26px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:999px\">" + esc_(label) + "</a></td></tr></table>";
  };
  var photo = v.photoUrl ? "<tr><td style=\"padding:0 0 20px\"><img src=\"" + esc_(v.photoUrl) + "\" width=\"520\" alt=\"\" style=\"display:block;width:100%;max-width:520px;border-radius:260px 260px 20px 20px\"></td></tr>" : "";
  return "<!doctype html><html><body style=\"margin:0;padding:0;background:#FAF6EF\">" +
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"background:#FAF6EF\"><tr><td align=\"center\" style=\"padding:28px 12px\">" +
    "<table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"max-width:600px;width:100%;background:#FFFDF9;border:1px solid #E3D6C4;border-radius:24px\">" +
    "<tr><td style=\"padding:40px 40px 8px;font-family:Georgia,'Times New Roman',serif;color:#2B2522\">" +
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\">" + photo + "</table>" +
    "<p style=\"margin:0 0 10px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#4C664B\">" + (v.kind === "invite" ? "Please join us" : "Baby shower") + "</p>" +
    "<h1 style=\"margin:0 0 18px;font-size:34px;line-height:1.15;font-weight:normal;font-style:italic;color:#2B2522\">" + esc_(v.headline) + "</h1>" +
    "<p style=\"margin:0 0 22px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#5E554E\">" + esc_(v.intro) + "</p>" +
    "</td></tr>" +
    "<tr><td style=\"padding:0 40px\"><table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"background:#F1E8DB;border-radius:16px\"><tr><td style=\"padding:18px 22px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#2B2522\">" +
    "<div style=\"font-family:Georgia,serif;font-size:20px;margin-bottom:2px\">" + esc_(v.dateLong) + "</div>" +
    "<div style=\"color:#5E554E\">" + esc_(v.timeRange) + "</div>" +
    "<div style=\"color:#5E554E\">" + esc_(v.where) + (v.mapsUrl ? " · <a href=\"" + esc_(v.mapsUrl) + "\" style=\"color:#4C664B\">Map</a>" : "") + "</div>" +
    "</td></tr></table></td></tr>" +
    "<tr><td style=\"padding:22px 40px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#2B2522\">" + v.extra + btn(v.cta, v.ctaUrl, "#6E8A6C") +
    (v.registry ? "<p style=\"margin:14px 0 4px;color:#5E554E\">If you'd like to bring a gift:</p>" + btn(v.registry.label, v.registry.url, "#B97E6D") : "") +
    "</td></tr>" +
    "<tr><td style=\"padding:26px 40px 36px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#8A8078\">" +
    "<p style=\"margin:0 0 6px;font-family:Georgia,serif;font-style:italic;font-size:16px;color:#2B2522\">With love, " + esc_(v.sig) + "</p>" +
    (v.contact ? "<p style=\"margin:0 0 6px\">Questions? " + esc_(v.contact) + "</p>" : "") +
    "<p style=\"margin:0\">Your personal link: <a href=\"" + esc_(v.link) + "\" style=\"color:#4C664B\">" + esc_(v.link) + "</a></p>" +
    "</td></tr></table></td></tr></table></body></html>";
}

function buildIcs_(s) {
  var start = zonedToUtc_(s.date, s.startTime, s.timeZone), end = zonedToUtc_(s.date, s.endTime, s.timeZone);
  var where = [s.venueName, s.venueAddress].filter(Boolean).join(", ");
  var e = function (t) { return String(t).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;"); };
  var host = String(s.siteUrl || "babyshower").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Rachana and Sahit//Baby Shower//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", "UID:baby-shower-" + s.date + "@" + host, "DTSTAMP:" + icsStamp_(new Date()), "DTSTART:" + icsStamp_(start), "DTEND:" + icsStamp_(end),
    "SUMMARY:" + e(s.eventTitle), "DESCRIPTION:" + e(s.eventTitle + ". Details, directions and RSVP: " + (s.siteUrl || "")), "LOCATION:" + e(where), "URL:" + (s.siteUrl || ""),
    "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", "DESCRIPTION:Baby shower tomorrow", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

/* =========================================================================
   Sheet plumbing
   ========================================================================= */

function ss_() { return SpreadsheetApp.getActive(); }

function ensureSheets_() {
  var ss = ss_();
  // A fresh spreadsheet made from a CSV may have the settings in "Sheet1": adopt it.
  if (!ss.getSheetByName("Settings")) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var hdr = sheets[i].getRange(1, 1, 1, 2).getValues()[0];
      if (String(hdr[0]).toLowerCase() === "key" && String(hdr[1]).toLowerCase() === "value") { sheets[i].setName("Settings"); break; }
    }
  }
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight("bold");
      sh.setFrozenRows(1);
      sh.getRange(1, 1, sh.getMaxRows(), SHEETS[name].length).setNumberFormat("@"); // keep phones, dates and tokens as text
    } else if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight("bold");
      sh.setFrozenRows(1);
      sh.getRange(1, 1, sh.getMaxRows(), SHEETS[name].length).setNumberFormat("@");
    } else if (name !== "Settings") {
      // Add any columns introduced after the tab was created (appended on the right; existing data is untouched).
      var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(function (h) { return String(h); });
      SHEETS[name].forEach(function (col, idx) {
        if (have.indexOf(col) < 0) {
          var c = Math.max(have.length, idx) + 1;
          sh.getRange(1, c).setValue(col).setFontWeight("bold");
          sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat("@");
          have[c - 1] = col;
        }
      });
    }
  });
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error("Missing sheet: " + name + " (run setup)");
  return sh;
}

function readAll_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var cols = SHEETS[name];
  var vals = sh.getRange(2, 1, last - 1, cols.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === "" && String(vals[i][1]) === "") continue;
    var o = { _row: i + 2 };
    for (var c = 0; c < cols.length; c++) o[cols[c]] = cell_(vals[i][c]);
    out.push(o);
  }
  return out;
}

function rowToObj_(sh, row, cols) {
  var vals = sh.getRange(row, 1, 1, cols.length).getValues()[0];
  var o = { _row: row };
  for (var c = 0; c < cols.length; c++) o[cols[c]] = cell_(vals[c]);
  return o;
}

function isDate_(v) { return Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime()); }
function cell_(v) {
  if (isDate_(v)) return v.toISOString();
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}

function findRowIndex_(sh, col, value) {
  if (!value) return 0;
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var vals = sh.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]) === String(value)) return i + 2;
  return 0;
}

function findByToken_(name, token) {
  if (!token) return null;
  var sh = sheet_(name);
  var row = findRowIndex_(sh, 1, token);
  return row ? rowToObj_(sh, row, SHEETS[name]) : null;
}

function appendRow_(sh, cols, obj) {
  var row = cols.map(function (c) { return obj[c] == null ? "" : obj[c]; });
  sh.appendRow(row);
  var r = sh.getLastRow();
  sh.getRange(r, 1, 1, cols.length).setNumberFormat("@");
}

function writeRow_(sh, row, cols, obj) {
  var cur = sh.getRange(row, 1, 1, cols.length).getValues()[0];
  for (var c = 0; c < cols.length; c++) if (obj[cols[c]] != null) cur[c] = obj[cols[c]];
  sh.getRange(row, 1, 1, cols.length).setValues([cur]);
}

function getSettings_() {
  var sh = ss_().getSheetByName("Settings");
  var o = {};
  if (!sh) return o;
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) { var k = String(vals[i][0] || "").trim(); if (k) o[k] = settingValue_(k, vals[i][1]); }
  return o;
}

// Sheets likes to turn "2026-10-31", "11:00" and "false" into dates, times and booleans. Undo that.
function settingValue_(key, v) {
  if (isDate_(v)) {
    var tz = ss_().getSpreadsheetTimeZone();
    return /time$/i.test(key) ? Utilities.formatDate(v, tz, "HH:mm") : Utilities.formatDate(v, tz, "yyyy-MM-dd");
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return cell_(v);
}

// Store every setting as plain text so values survive round trips through the Sheet.
function normalizeSettingsSheet_() {
  var sh = sheet_("Settings");
  var last = sh.getLastRow();
  if (last < 2) return;
  var rng = sh.getRange(2, 1, last - 1, 2);
  var vals = rng.getValues();
  var out = vals.map(function (r) { return [String(r[0] || ""), settingValue_(String(r[0] || ""), r[1])]; });
  sh.getRange(1, 2, sh.getMaxRows(), 1).setNumberFormat("@");
  rng.setValues(out);
}

function setSetting_(key, value) {
  var sh = sheet_("Settings");
  var row = findRowIndex_(sh, 1, key);
  if (row) sh.getRange(row, 2).setValue(value); else sh.appendRow([key, value]);
}

function publicSettings_(s) {
  var o = {};
  Object.keys(s).forEach(function (k) { if (PRIVATE_KEYS.indexOf(k) < 0) o[k] = s[k]; });
  return o;
}

function log_(action, detail) {
  try { sheet_("Log").appendRow([now_(), action, String(detail || "").slice(0, 500)]); } catch (e) { }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* =========================================================================
   Small helpers
   ========================================================================= */

function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function now_() { return new Date().toISOString(); }
function clean_(v, max) { return String(v == null ? "" : v).replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max || 200); }
function clampInt_(v, min, max, dflt) { var n = parseInt(v, 10); if (isNaN(n)) return dflt; return Math.max(min, Math.min(max, n)); }
function firstName_(n) {
  var name = String(n || "").trim(), parts = name.split(/\s+/);
  if (!name) return "";
  if (/^the$/i.test(parts[0])) return name;
  if (/&|\band\b/i.test(name)) return (parts.length >= 4 && !/&|^and$/i.test(parts[parts.length - 1]) && !/&|^and$/i.test(parts[parts.length - 2])) ? parts.slice(0, -1).join(" ") : name;
  return parts[0];
}
function lc1_(s) { s = String(s || ""); return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
function esc_(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; }); }
function token_(n) {
  var alphabet = "abcdefghjkmnpqrstuvwxyz23456789", s = "";
  for (var i = 0; i < n; i++) s += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return s;
}
function personalLink_(token, s) {
  var base = String(s.siteUrl || "").trim();
  if (!base) return "(set siteUrl in Settings)";
  if (!/\/$/.test(base) && !/\.html?$/.test(base)) base += "/";
  return base + "?g=" + encodeURIComponent(token);
}
function fmtDate_(iso, tz, pattern) {
  var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso || "");
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return Utilities.formatDate(d, tz || "America/Los_Angeles", pattern);
}
function fmtTime_(t) {
  var m = String(t || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return String(t || "");
  var h = Number(m[1]), mm = m[2], ap = h >= 12 ? "PM" : "AM", hh = ((h + 11) % 12) + 1;
  return hh + ":" + mm + " " + ap;
}
function zonedToUtc_(dateStr, timeStr, tz) {
  var naive = new Date(dateStr + "T" + timeStr + ":00Z");
  var guess = naive;
  for (var i = 0; i < 2; i++) {
    var off = Utilities.formatDate(guess, tz, "Z"); // e.g. -0700
    var sign = off.charAt(0) === "-" ? -1 : 1;
    var mins = sign * (Number(off.slice(1, 3)) * 60 + Number(off.slice(3, 5)));
    guess = new Date(naive.getTime() - mins * 60000);
  }
  return guess;
}
function icsStamp_(d) { return Utilities.formatDate(d, "UTC", "yyyyMMdd'T'HHmmss'Z'"); }
