/* =====================================================================
   Baby shower site — guest page logic
   - merges config.js with Settings from the Google Sheet (via Apps Script)
   - personalizes the page from an invite token (?g=TOKEN)
   - RSVP, wishes wall, guessing board
   ===================================================================== */
(function () {
  "use strict";

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const cfg = Object.assign({}, window.SHOWER_CONFIG || {});
  const STORAGE_TOKEN = "shower.token";

  /* ---------- small utils ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function firstName(n) {
    const name = String(n || "").trim(); const parts = name.split(/\s+/);
    if (!name) return "";
    if (/^the$/i.test(parts[0])) return name;
    if (/&|\band\b/i.test(name)) return (parts.length >= 4 && !/&|^and$/i.test(parts[parts.length - 1]) && !/&|^and$/i.test(parts[parts.length - 2])) ? parts.slice(0, -1).join(" ") : name;
    return parts[0];
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function randomToken(prefix) {
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    let s = "";
    const bytes = new Uint8Array(8);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(bytes) : bytes.forEach((_, i) => bytes[i] = Math.floor(Math.random() * 256));
    for (let i = 0; i < 8; i++) s += alphabet[bytes[i] % alphabet.length];
    return (prefix || "") + s;
  }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
  }

  /* ---------- dates ---------- */
  function parseDate(s) { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); }
  function fmtLongDate(s) { return parseDate(s).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }); }
  function fmtShortDate(s) { return parseDate(s).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }); }
  function fmtTime(t) { const [h, m] = String(t).split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; const hh = ((h + 11) % 12) + 1; return `${hh}:${pad(m)} ${ap}`; }
  function fmtTimeShort(t) { const [h, m] = String(t).split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; const hh = ((h + 11) % 12) + 1; return m ? `${hh}:${pad(m)} ${ap}` : `${hh} ${ap}`; }
  function zonedToUtc(date, time, tz) {
    const [y, mo, d] = String(date).split("-").map(Number);
    const [hh, mm] = String(time).split(":").map(Number);
    const want = Date.UTC(y, mo - 1, d, hh, mm);
    let guess = want;
    for (let i = 0; i < 2; i++) {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
      const g = t => Number(parts.find(p => p.type === t).value);
      const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
      guess += want - asUtc;
    }
    return new Date(guess);
  }
  function icsStamp(d) { return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
  function calendarBits() {
    const start = zonedToUtc(cfg.date, cfg.startTime, cfg.timeZone);
    const end = zonedToUtc(cfg.date, cfg.endTime, cfg.timeZone);
    const where = [cfg.venueName, cfg.venueAddress].filter(Boolean).join(", ");
    const site = cfg.siteUrl || (window.location.origin + window.location.pathname);
    const details = `${cfg.eventTitle}. Details, directions and RSVP: ${site}`;
    return { start, end, location: where, details, site };
  }
  function googleCalUrl() {
    const b = calendarBits();
    const p = new URLSearchParams({ action: "TEMPLATE", text: cfg.eventTitle, dates: `${icsStamp(b.start)}/${icsStamp(b.end)}`, details: b.details, location: b.location });
    return "https://calendar.google.com/calendar/render?" + p.toString();
  }
  function icsText() {
    const b = calendarBits();
    const escIcs = s => String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Rachana and Sahit//Baby Shower//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "BEGIN:VEVENT", `UID:baby-shower-${cfg.date}@${(cfg.siteUrl || location.host || "babyshower").replace(/https?:\/\//, "").replace(/\/.*$/, "")}`,
      `DTSTAMP:${icsStamp(new Date())}`, `DTSTART:${icsStamp(b.start)}`, `DTEND:${icsStamp(b.end)}`,
      `SUMMARY:${escIcs(cfg.eventTitle)}`, `DESCRIPTION:${escIcs(b.details)}`, `LOCATION:${escIcs(b.location)}`, `URL:${b.site}`,
      "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", "DESCRIPTION:Baby shower tomorrow", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  }
  function downloadIcs(e) {
    e.preventDefault();
    const blob = new Blob([icsText()], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "baby-shower.ics"; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /* ---------- API (Google Apps Script) ---------- */
  // Preview mode (window.SHOWER_PREVIEW = {...}) keeps everything in memory so the page can be tried without a backend.
  const preview = window.SHOWER_PREVIEW ? (function () {
    const db = Object.assign({ guests: [], rsvps: [], wishes: [], guesses: [] }, window.SHOWER_PREVIEW);
    const wait = v => new Promise(r => setTimeout(() => r(v), 350));
    return {
      get(action, p) {
        if (action === "settings") return wait({ ok: true, settings: db.settings || {} });
        if (action === "guest") { const g = db.guests.find(x => x.token === p.t); const r = db.rsvps.find(x => x.token === p.t); const q = db.guesses.find(x => x.token === p.t); return wait(g || r ? { ok: true, found: true, name: (g || r).name, email: (g || {}).email || "", phone: (g || {}).phone || "", rsvp: r || null, guess: q || null } : { ok: true, found: false }); }
        if (action === "wishes") return wait({ ok: true, wishes: db.wishes.slice().reverse() });
        if (action === "guesses") return wait({ ok: true, guesses: db.guesses.slice().reverse() });
        return wait({ ok: true });
      },
      post(b) {
        if (b.action === "rsvp") { const i = db.rsvps.findIndex(x => x.token === b.token); i >= 0 ? db.rsvps[i] = b : db.rsvps.push(b); return wait({ ok: true, token: b.token }); }
        if (b.action === "wish") { db.wishes.push({ name: b.name, message: b.message }); return wait({ ok: true }); }
        if (b.action === "guess") { const i = db.guesses.findIndex(x => x.token === b.token); i >= 0 ? db.guesses[i] = b : db.guesses.push(b); return wait({ ok: true }); }
        return wait({ ok: true });
      }
    };
  })() : null;
  const api = {
    get available() { return !!cfg.appsScriptUrl || !!preview; },
    async get(action, params) {
      if (preview) return preview.get(action, params || {});
      if (!cfg.appsScriptUrl) throw new Error("offline");
      const u = new URL(cfg.appsScriptUrl);
      u.searchParams.set("action", action);
      Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== "") u.searchParams.set(k, v); });
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
      try {
        const r = await fetch(u.toString(), { signal: ctl.signal, redirect: "follow" });
        const j = await r.json();
        if (j && j.ok === false) throw new Error(j.error || "Request failed");
        return j;
      } finally { clearTimeout(t); }
    },
    async post(payload) {
      if (preview) return preview.post(payload);
      if (!cfg.appsScriptUrl) throw new Error("offline");
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
      try {
        const r = await fetch(cfg.appsScriptUrl, { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "text/plain;charset=utf-8" }, signal: ctl.signal, redirect: "follow" });
        const j = await r.json();
        if (j && j.ok === false) throw new Error(j.error || "Request failed");
        return j;
      } finally { clearTimeout(t); }
    }
  };

  /* ---------- settings merge ---------- */
  function applySettings(flat) {
    if (!flat) return;
    const reg = [];
    for (let i = 1; i <= 4; i++) {
      const url = flat["registryUrl" + i];
      if (url) reg.push({ label: flat["registryLabel" + i] || "Our baby registry", url });
    }
    if (reg.length) cfg.registry = reg;
    if (flat.schedule) {
      const rows = String(flat.schedule).split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.match(/^([^|–-]+?)\s*[|–-]\s*(.+)$/); return m ? [m[1].trim(), m[2].trim()] : ["", l];
      });
      if (rows.length) cfg.schedule = rows;
    }
    ["eventTitle", "hostedBy", "date", "startTime", "endTime", "timeZone", "rsvpBy", "dueMonth", "babySex", "venueName", "venueAddress", "mapsUrl",
      "contactName", "contactEmail", "contactPhone", "parking", "dressCode", "kidsNote", "giftNote", "photoUrl", "siteUrl", "heroCaption", "registryNote"]
      .forEach(k => { if (flat[k] != null && String(flat[k]).trim() !== "") cfg[k] = String(flat[k]).trim(); });
    if (flat.showSex != null && String(flat.showSex).trim() !== "") cfg.showSex = /^(true|yes|1)$/i.test(String(flat.showSex).trim());
  }

  /* ---------- render config into the page ---------- */
  function renderConfig() {
    const dateLong = fmtLongDate(cfg.date);
    const timeRange = `${fmtTime(cfg.startTime)} – ${fmtTime(cfg.endTime)}`;
    $("#hero-date").textContent = dateLong;
    $("#hero-time").textContent = timeRange;
    $("#hero-place").textContent = cfg.venueName && !/to be announced|coming soon/i.test(cfg.venueName) ? `${cfg.venueName} · ${cfg.venueAddress}` : cfg.venueAddress;
    $("#d-date").textContent = dateLong;
    $("#d-time").textContent = `${timeRange} (Pacific). Drop in any time; lunch is served at 1.`;
    $("#d-venue").textContent = cfg.venueName;
    if (cfg.venueName && !/to be announced|coming soon/i.test(cfg.venueName)) {
      $("#d-address").textContent = cfg.venueAddress;
      const q = encodeURIComponent([cfg.venueName, cfg.venueAddress].filter(Boolean).join(", "));
      $("#map-google").href = cfg.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${q}`;
      $("#map-apple").href = `https://maps.apple.com/?q=${q}`;
      $("#d-maplinks").hidden = false;
    }
    $("#d-parking").textContent = cfg.parking;
    $("#d-kids").textContent = cfg.kidsNote;
    $("#d-dress").textContent = cfg.dressCode;
    $("#d-gifts").textContent = cfg.giftNote;
    const contactBits = [];
    if (cfg.contactPhone) contactBits.push(`text <a href="sms:${esc(cfg.contactPhone.replace(/[^\d+]/g, ""))}">${esc(cfg.contactPhone)}</a>`);
    if (cfg.contactEmail) contactBits.push(`email <a href="mailto:${esc(cfg.contactEmail)}">${esc(cfg.contactEmail)}</a>`);
    $("#d-contact").innerHTML = contactBits.length ? `Questions? Reach ${esc(cfg.contactName)}: ${contactBits.join(" or ")}.` : `Text or email ${esc(cfg.contactName)} any time.`;
    $("#faq-contact").textContent = cfg.contactName + (cfg.contactPhone ? ` at ${cfg.contactPhone}` : "");
    $("#rsvp-by").textContent = fmtShortDate(cfg.rsvpBy);
    $("#schedule").innerHTML = cfg.schedule.map(([t, w]) => `<li><time>${esc(t)}</time><span>${esc(w)}</span></li>`).join("");
    if (cfg.photoUrl) { const img = $("#arch-img"); img.src = cfg.photoUrl; img.alt = "Rachana and Sahit"; }
    if (cfg.heroCaption) $("#arch-caption").textContent = cfg.heroCaption;
    if (cfg.registryNote) $("#registry-note").textContent = cfg.registryNote;
    // registry links
    const list = $("#registry-links");
    const live = (cfg.registry || []).filter(r => r.url);
    if (live.length) {
      list.innerHTML = live.map((r, i) => `<a class="btn ${i === 0 ? "btn-blush" : ""} btn-lg" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(live.length > 1 ? (r.label || "View the registry") : "Open the registry")}</a>`).join("");
      $("#registry-heading").textContent = live.length > 1 ? "Our registries" : (live[0].label || "Our baby registry");
    } else {
      list.innerHTML = `<span class="btn btn-lg" aria-disabled="true">Registry link coming soon</span>`;
    }
    // calendar links (the .ics click handlers are attached once, in boot)
    $("#cal-google").href = googleCalUrl();
    $("#success-cal-google").href = googleCalUrl();
    // countdown
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((parseDate(cfg.date) - today) / 864e5);
    const c = $("#countdown");
    if (days > 1) {
      const w = Math.floor(days / 7), d = days % 7;
      c.innerHTML = `<b>${days} days</b> to go${w >= 1 ? ` <span class="muted">(${w} week${w > 1 ? "s" : ""}${d ? ` and ${d} day${d > 1 ? "s" : ""}` : ""})</span>` : ""}`;
    } else if (days === 1) c.innerHTML = `<b>Tomorrow!</b> See you at ${fmtTimeShort(cfg.startTime)}.`;
    else if (days === 0) c.innerHTML = `<b>It's today!</b> Doors open at ${fmtTimeShort(cfg.startTime)}.`;
    else c.innerHTML = `<b>Thank you</b> for celebrating with us.`;
    // guessing game sex question
    $("#g-sex-block").hidden = !!cfg.showSex;
    // past RSVP deadline hint
    const rb = parseDate(cfg.rsvpBy);
    if (today > rb && days >= 0) $("#rsvp-lede").innerHTML = `The RSVP date has passed, but late replies are still welcome. Send yours and we'll make room.`;
  }

  /* ---------- invite token & guest ---------- */
  const params = new URLSearchParams(location.search);
  let token = (params.get("g") || "").trim() || read(STORAGE_TOKEN) || "";
  let guest = null;      // { name, firstName, rsvp }
  let lastRsvp = null;

  function setToken(t) { token = t; store(STORAGE_TOKEN, t); if (!params.get("g")) { const u = new URL(location.href); u.searchParams.set("g", t); history.replaceState(null, "", u.toString()); } }

  async function loadGuest() {
    if (!token || !api.available) return;
    try {
      const r = await api.get("guest", { t: token });
      if (!r.found) { if (!params.get("g")) store(STORAGE_TOKEN, null); return; }
      guest = r;
      if (r.name) {
        const fn = firstName(r.name);
        $("#greeting-text").textContent = r.rsvp ? `Welcome back, ${fn}` : `${fn}, this one's for you`;
        $("#greeting").hidden = false;
        $("#f-name").value = r.name; $("#name-hint").hidden = false;
        if (!$("#w-name").value) $("#w-name").value = r.name;
        if (!$("#g-name").value) $("#g-name").value = r.name;
      }
      if (r.email && !$("#f-email").value) $("#f-email").value = r.email;
      if (r.phone && !$("#f-phone").value) $("#f-phone").value = r.phone;
      if (r.rsvp) { lastRsvp = r.rsvp; fillRsvp(r.rsvp); showSuccess(r.rsvp, true); }
      if (r.guess) fillGuess(r.guess);
    } catch (e) { /* personalization is optional */ }
  }
  function recordView() {
    if (!token || !api.available) return;
    try { if (sessionStorage.getItem("shower.viewed") === token) return; sessionStorage.setItem("shower.viewed", token); } catch (e) { }
    api.get("view", { t: token }).catch(() => { });
  }

  /* ---------- RSVP form: party builder ---------- */
  // party = everyone coming with the primary guest: [{ name, type: "adult" | "child", age }]
  let party = [];
  const AGES = ["Under 1", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17"];
  function partyCounts() { return { adults: 1 + party.filter(m => m.type === "adult").length, kids: party.filter(m => m.type === "child").length }; }
  function renderParty() {
    const list = $("#party-list"); if (!list) return;
    list.innerHTML = party.map((m, i) => `
      <div class="party-row" data-i="${i}">
        <input class="input" type="text" placeholder="${m.type === "child" ? "Child's name" : "Name"}" value="${esc(m.name)}" data-field="name" aria-label="${m.type === "child" ? "Child's name" : "Guest name"}" autocomplete="off">
        ${m.type === "child"
          ? `<select class="select num" data-field="age" aria-label="Age"><option value="">Age</option>${AGES.map(a => `<option value="${a}" ${m.age === a ? "selected" : ""}>${a}</option>`).join("")}</select>`
          : `<span class="party-type">Adult</span>`}
        <button class="party-remove" type="button" aria-label="Remove" data-remove="${i}">×</button>
      </div>`).join("");
    const c = partyCounts();
    const names = party.map(m => m.name.trim()).filter(Boolean);
    $("#party-summary").textContent = party.length === 0 ? "Just you so far."
      : `${c.adults} adult${c.adults === 1 ? "" : "s"}${c.kids ? ` and ${c.kids} ${c.kids === 1 ? "child" : "children"}` : ""} in your party${names.length ? `: you, ${names.join(", ")}` : ""}.`;
  }
  function addMember(type) { party.push({ name: "", type, age: "" }); renderParty(); const rows = $$(".party-row"); const last = rows[rows.length - 1]; if (last) $("input", last).focus(); }
  const on = (sel, evt, fn) => { const el = $(sel); if (el) el.addEventListener(evt, fn); };
  on("#party-add-adult", "click", () => addMember("adult"));
  on("#party-add-child", "click", () => addMember("child"));
  on("#party-list", "input", e => { const row = e.target.closest(".party-row"); if (!row) return; const m = party[Number(row.dataset.i)]; if (!m) return; if (e.target.dataset.field === "name") m.name = e.target.value; if (e.target.dataset.field === "age") m.age = e.target.value; const c = partyCounts(); const names = party.map(x => x.name.trim()).filter(Boolean); $("#party-summary").textContent = `${c.adults} adult${c.adults === 1 ? "" : "s"}${c.kids ? ` and ${c.kids} ${c.kids === 1 ? "child" : "children"}` : ""} in your party${names.length ? `: you, ${names.join(", ")}` : ""}.`; });
  on("#party-list", "change", e => { const row = e.target.closest(".party-row"); if (!row) return; const m = party[Number(row.dataset.i)]; if (m && e.target.dataset.field === "age") m.age = e.target.value; });
  on("#party-list", "click", e => { const b = e.target.closest("[data-remove]"); if (!b) return; party.splice(Number(b.dataset.remove), 1); renderParty(); });
  function partyLabel(list) { return (list || []).map(m => m.type === "child" ? `${m.name || "child"}${m.age ? ` (${/^\d+$/.test(m.age) ? m.age : m.age.toLowerCase()})` : ""}` : (m.name || "guest")).join(", "); }

  function attendingValue() { const r = $("input[name=attending]:checked"); return r ? r.value : ""; }
  $$("input[name=attending]").forEach(r => r.addEventListener("change", () => { $("#attending-fields").hidden = attendingValue() !== "yes"; }));
  $("#name-change").addEventListener("click", () => { const n = $("#f-name"); n.value = ""; n.focus(); $("#name-hint").hidden = true; });
  // "No restrictions" clears the others
  $("#diet-chips").addEventListener("change", e => {
    const t = e.target; if (!t.matches("input[name=diet]")) return;
    const none = $("input[name=diet][value='No restrictions']");
    if (t === none && t.checked) $$("input[name=diet]").forEach(i => { if (i !== none) i.checked = false; });
    else if (t.checked) none.checked = false;
  });

  function fillRsvp(r) {
    $("#f-name").value = r.name || $("#f-name").value;
    const att = $(`input[name=attending][value='${r.attending === "yes" ? "yes" : "no"}']`); if (att) { att.checked = true; $("#attending-fields").hidden = r.attending !== "yes"; }
    party = Array.isArray(r.party) ? r.party.map(m => ({ name: String(m.name || ""), type: m.type === "child" ? "child" : "adult", age: String(m.age || "") })) : [];
    if (!party.length) { for (let i = 1; i < (Number(r.adults) || 1); i++) party.push({ name: "", type: "adult", age: "" }); for (let i = 0; i < (Number(r.kids) || 0); i++) party.push({ name: "", type: "child", age: "" }); }
    renderParty();
    const diet = Array.isArray(r.diet) ? r.diet : String(r.diet || "").split(",").map(s => s.trim()).filter(Boolean);
    $$("input[name=diet]").forEach(i => i.checked = diet.includes(i.value));
    $("#f-dietnote").value = r.dietNote || "";
    $("#f-email").value = r.email || ""; $("#f-phone").value = r.phone || ""; $("#f-note").value = r.note || "";
  }
  function rsvpSummaryHtml(r) {
    const diet = (Array.isArray(r.diet) ? r.diet : String(r.diet || "").split(",").map(s => s.trim()).filter(Boolean));
    const bits = [];
    bits.push(`<span><b>${esc(r.name)}</b> · ${r.attending === "yes" ? "Attending" : "Not attending"}</span>`);
    if (r.attending === "yes") bits.push(`<span>${r.adults} adult${r.adults == 1 ? "" : "s"}${Number(r.kids) ? `, ${r.kids} ${r.kids == 1 ? "child" : "children"}` : ""}${Array.isArray(r.party) && r.party.length ? ` · you, ${esc(partyLabel(r.party))}` : ""}</span>`);
    if (r.attending === "yes" && (diet.length || r.dietNote)) bits.push(`<span>Food: ${esc([...diet, r.dietNote].filter(Boolean).join(", "))}</span>`);
    if (r.email) bits.push(`<span>Confirmation sent to ${esc(r.email)}</span>`);
    else if (r.phone && r.attending === "yes") bits.push(`<span>We'll text the details to ${esc(r.phone)} the day before</span>`);
    return bits.join("");
  }
  function showSuccess(r, returning) {
    const fn = firstName(r.name);
    $("#rsvp-form").hidden = true; $("#rsvp-success").hidden = false;
    if (r.attending === "yes") {
      $("#success-title").textContent = returning ? `You're on the list, ${fn}.` : `You're in, ${fn}. We can't wait.`;
      $("#success-text").textContent = returning ? "Here's what we have for you. Nothing to do unless something changes." : "Save the date in your calendar, and we'll send the address and parking details the day before.";
      $("#success-cal-google").hidden = false; $("#success-cal-ics").hidden = false;
    } else {
      $("#success-title").textContent = `We'll miss you, ${fn}.`;
      $("#success-text").textContent = "Thank you for letting us know. If you'd like, leave a wish for the baby below; we're printing those for the nursery.";
      $("#success-cal-google").hidden = true; $("#success-cal-ics").hidden = true;
    }
    $("#success-summary").innerHTML = rsvpSummaryHtml(r);
    $("#rsvp-title").textContent = r.attending === "yes" ? "See you there" : "Thank you";
    if (!returning) { $("#rsvp-card").scrollIntoView({ behavior: "smooth", block: "start" }); }
  }
  $("#rsvp-edit").addEventListener("click", e => { e.preventDefault(); $("#rsvp-success").hidden = true; $("#rsvp-form").hidden = false; $("#rsvp-title").textContent = "Update your RSVP"; $("#f-name").focus(); });

  $("#rsvp-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target; const status = $("#rsvp-status"); status.className = "status"; status.textContent = "";
    if (f.website.value) return; // honeypot
    const name = $("#f-name").value.trim();
    const attending = attendingValue();
    const email = $("#f-email").value.trim();
    const phone = $("#f-phone").value.trim();
    $("#f-name").removeAttribute("aria-invalid"); $("#f-email").removeAttribute("aria-invalid"); $("#f-phone").removeAttribute("aria-invalid");
    if (!name) { $("#f-name").setAttribute("aria-invalid", "true"); $("#f-name").focus(); status.className = "status err"; status.textContent = "Please add your name."; return; }
    if (!attending) { status.className = "status err"; status.textContent = "Let us know if you can make it."; $("input[name=attending]").focus(); return; }
    if (phone.replace(/\D/g, "").length < 10) { $("#f-phone").setAttribute("aria-invalid", "true"); $("#f-phone").focus(); status.className = "status err"; status.textContent = phone ? "That mobile number doesn't look complete." : "Please add your mobile number so we can text you the details."; return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $("#f-email").setAttribute("aria-invalid", "true"); $("#f-email").focus(); status.className = "status err"; status.textContent = "That email doesn't look right."; return; }
    if (!token) setToken(randomToken("w-"));
    const payload = {
      action: "rsvp", token, name, attending,
      adults: attending === "yes" ? partyCounts().adults : 0, kids: attending === "yes" ? partyCounts().kids : 0,
      party: attending === "yes" ? party.map(m => ({ name: m.name.trim(), type: m.type, age: m.age })) : [],
      diet: attending === "yes" ? $$("input[name=diet]:checked").map(i => i.value) : [],
      dietNote: attending === "yes" ? $("#f-dietnote").value.trim() : "",
      email, phone, note: $("#f-note").value.trim(), page: location.href
    };
    const btn = $("#rsvp-submit"); btn.disabled = true; btn.innerHTML = `<span class="spin"></span> Sending`;
    try {
      const r = await api.post(payload);
      if (r && r.token && r.token !== token) setToken(r.token);
      lastRsvp = payload; showSuccess(payload, false); toast(attending === "yes" ? "RSVP received. See you there!" : "Thanks for letting us know.");
    } catch (err) {
      status.className = "status err";
      status.textContent = api.available ? `We couldn't save that. Please try again, or text ${cfg.contactName}${cfg.contactPhone ? ` at ${cfg.contactPhone}` : ""}.` : "RSVPs open shortly. Please check back soon.";
    } finally { btn.disabled = false; btn.textContent = "Send my RSVP"; }
  });

  /* ---------- wishes ---------- */
  function renderWishes(list) {
    const wall = $("#wall"); const empty = $("#wall-empty");
    const items = (list || []).filter(w => w && w.message);
    wall.innerHTML = items.map(w => `<article class="note-card"><p>${esc(w.message)}</p><span class="by">— <b>${esc(w.name || "A friend")}</b></span></article>`).join("");
    empty.hidden = items.length > 0;
  }
  async function loadWishes() { if (!api.available) { renderWishes([]); return; } try { const r = await api.get("wishes"); renderWishes(r.wishes); } catch (e) { renderWishes([]); } }
  $("#w-text").addEventListener("input", e => { $("#w-count").textContent = e.target.value.length; });
  $("#wish-form").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target; if (f.website.value) return;
    const status = $("#wish-status"); status.className = "status"; status.textContent = "";
    const name = $("#w-name").value.trim(), message = $("#w-text").value.trim();
    if (!name || !message) { status.className = "status err"; status.textContent = "Add your name and a few words."; return; }
    const btn = $("#wish-submit"); btn.disabled = true; btn.innerHTML = `<span class="spin"></span> Adding`;
    try {
      await api.post({ action: "wish", token, name, message });
      // optimistic add at the front
      const wall = $("#wall"); wall.insertAdjacentHTML("afterbegin", `<article class="note-card"><p>${esc(message)}</p><span class="by">— <b>${esc(name)}</b></span></article>`); $("#wall-empty").hidden = true;
      $("#w-text").value = ""; $("#w-count").textContent = "0"; toast("Added to the wall. Thank you!");
    } catch (err) { status.className = "status err"; status.textContent = api.available ? "Couldn't add that just now. Please try again." : "The wall opens shortly."; }
    finally { btn.disabled = false; btn.textContent = "Add to the wall"; }
  });

  /* ---------- guessing board ---------- */
  function initGuessControls() {
    const lb = $("#g-lb"), oz = $("#g-oz"), len = $("#g-len");
    lb.innerHTML = Array.from({ length: 8 }, (_, i) => i + 4).map(v => `<option value="${v}" ${v === 7 ? "selected" : ""}>${v} lb</option>`).join("");
    oz.innerHTML = Array.from({ length: 16 }, (_, i) => i).map(v => `<option value="${v}" ${v === 6 ? "selected" : ""}>${v} oz</option>`).join("");
    const lens = []; for (let v = 16; v <= 24; v += 0.5) lens.push(v);
    len.innerHTML = lens.map(v => `<option value="${v}" ${v === 20 ? "selected" : ""}>${v} in</option>`).join("");
    const [y, m] = String(cfg.dueMonth).split("-").map(Number);
    const mid = new Date(y, m - 1, 15); const min = new Date(mid); min.setDate(mid.getDate() - 42); const max = new Date(mid); max.setDate(mid.getDate() + 42);
    const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const gd = $("#g-date"); gd.min = iso(min); gd.max = iso(max); if (!gd.value) gd.value = iso(mid);
  }
  let hasGuess = false;
  function fillGuess(g) {
    hasGuess = true;
    if (g.name) $("#g-name").value = g.name;
    if (g.date) $("#g-date").value = g.date;
    if (g.timeOfDay) $("#g-time").value = g.timeOfDay;
    if (g.weightOz) { $("#g-lb").value = Math.floor(g.weightOz / 16); $("#g-oz").value = g.weightOz % 16; }
    if (g.length) $("#g-len").value = g.length;
    const s = $(`input[name=sex][value='${g.sex || ""}']`); if (s) s.checked = true;
    $("#guess-submit").textContent = "Update my guess";
  }
  function fmtGuess(g) {
    const bits = [];
    if (g.date) bits.push(parseDate(g.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    if (g.weightOz) bits.push(`${Math.floor(g.weightOz / 16)} lb ${g.weightOz % 16} oz`);
    if (g.length) bits.push(`${g.length} in`);
    if (g.sex) bits.push(g.sex);
    return bits.join(" · ");
  }
  function renderGuesses(list) {
    const board = $("#guess-board"); const empty = $("#guess-empty"); const stat = $("#guess-stat");
    const items = (list || []).filter(g => g && g.name);
    board.innerHTML = items.map(g => `<div class="guess-row"><span class="who">${esc(g.name)}</span><span class="what">${esc(fmtGuess(g))}</span></div>`).join("");
    empty.hidden = items.length > 0;
    const dated = items.filter(g => g.date).map(g => parseDate(g.date).getTime()).sort((a, b) => a - b);
    if (dated.length >= 2) {
      const med = dated[Math.floor(dated.length / 2)];
      const w = items.filter(g => g.weightOz).map(g => Number(g.weightOz));
      const avgOz = w.length ? Math.round(w.reduce((a, b) => a + b, 0) / w.length) : 0;
      const girls = items.filter(g => g.sex === "girl").length, boys = items.filter(g => g.sex === "boy").length;
      $("#guess-stat-text").textContent = new Date(med).toLocaleDateString("en-US", { month: "long", day: "numeric" });
      $("#guess-stat-sub").textContent = [avgOz ? `about ${Math.floor(avgOz / 16)} lb ${avgOz % 16} oz` : "", (girls || boys) && !cfg.showSex ? `${girls} say girl, ${boys} say boy` : "", `${items.length} guesses`].filter(Boolean).join(" · ");
      stat.hidden = false;
    } else stat.hidden = true;
  }
  async function loadGuesses() { if (!api.available) { renderGuesses([]); return; } try { const r = await api.get("guesses"); renderGuesses(r.guesses); } catch (e) { renderGuesses([]); } }
  $("#guess-form").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target; if (f.website.value) return;
    const status = $("#guess-status"); status.className = "status"; status.textContent = "";
    const name = $("#g-name").value.trim(), date = $("#g-date").value;
    if (!name || !date) { status.className = "status err"; status.textContent = "Add your name and a date."; return; }
    if (!token) setToken(randomToken("w-"));
    const payload = { action: "guess", token, name, date, timeOfDay: $("#g-time").value, weightOz: Number($("#g-lb").value) * 16 + Number($("#g-oz").value), length: Number($("#g-len").value), sex: cfg.showSex ? "" : ($("input[name=sex]:checked") || {}).value || "" };
    const btn = $("#guess-submit"); btn.disabled = true; btn.innerHTML = `<span class="spin"></span> Saving`;
    try {
      await api.post(payload); hasGuess = true; toast("Guess locked in. Good luck!");
      loadGuesses();
    } catch (err) { status.className = "status err"; status.textContent = api.available ? "Couldn't save that just now. Please try again." : "The board opens shortly."; }
    finally { btn.disabled = false; btn.textContent = hasGuess ? "Update my guess" : "Lock in my guess"; }
  });

  /* ---------- boot ---------- */
  async function boot() {
    $("#cal-ics").addEventListener("click", downloadIcs);
    $("#success-cal-ics").addEventListener("click", downloadIcs);
    renderConfig(); initGuessControls();
    if (api.available) {
      try { const r = await api.get("settings"); applySettings(r.settings); renderConfig(); } catch (e) { /* keep defaults */ }
    }
    loadGuest(); recordView(); loadWishes(); loadGuesses();
    // deep links from invites: ?g=TOKEN#rsvp
    if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 50); }
  }
  boot();
})();
