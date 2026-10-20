/* Host dashboard logic */
(function () {
  "use strict";
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const cfg = window.SHOWER_CONFIG || {};
  const KEY_STORE = "shower.hostKey";
  let key = "";
  let data = null;          // admin payload
  let selected = new Set();

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function store(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { } }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function firstName(n) {
    const name = String(n || "").trim(); const parts = name.split(/\s+/);
    if (!name) return "";
    if (/^the$/i.test(parts[0])) return name;
    if (/&|\band\b/i.test(name)) return (parts.length >= 4 && !/&|^and$/i.test(parts[parts.length - 1]) && !/&|^and$/i.test(parts[parts.length - 2])) ? parts.slice(0, -1).join(" ") : name;
    return parts[0];
  }
  let toastTimer;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3200); }
  function fmtWhen(iso) { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  function digits(p) { return String(p || "").replace(/[^\d+]/g, ""); }
  function waNumber(p) { let d = String(p || "").replace(/\D/g, ""); if (d.length === 10) d = "1" + d; return d; }
  async function copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch (e) { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e2) { } ta.remove(); return true; } }

  /* ---------- API ---------- */
  const api = {
    get available() { return !!cfg.appsScriptUrl; },
    async get(action, params) {
      const u = new URL(cfg.appsScriptUrl); u.searchParams.set("action", action);
      Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== "") u.searchParams.set(k, v); });
      const r = await fetch(u.toString(), { redirect: "follow" }); const j = await r.json();
      if (!j || j.ok === false) throw new Error((j && j.error) || "Request failed"); return j;
    },
    async post(payload) {
      const r = await fetch(cfg.appsScriptUrl, { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow" });
      const j = await r.json(); if (!j || j.ok === false) throw new Error((j && j.error) || "Request failed"); return j;
    },
    admin(op, extra) { return api.post(Object.assign({ action: "admin", key, op }, extra || {})); }
  };

  /* ---------- derived ---------- */
  function siteUrl() { const s = (data && data.settings && data.settings.siteUrl) || cfg.siteUrl || (location.origin + location.pathname.replace(/host\.html$/, "")); return s.replace(/\/?$/, "/"); }
  function linkFor(g) { return siteUrl() + "?g=" + encodeURIComponent(g.token); }
  function rsvpOf(g) { return (data.rsvps || []).find(r => r.token === g.token) || null; }
  function statusOf(g) { const r = rsvpOf(g); if (r) return r.attending === "yes" ? "yes" : "no"; if (g.viewedAt) return "opened"; return "awaiting"; }
  function tmpl(kind, g) {
    const s = data.settings || {};
    const t = kind === "reminder" ? (s.reminderTemplate || cfg.reminderTemplate) : kind === "dayBefore" ? (s.dayBeforeTemplate || cfg.dayBeforeTemplate) : (s.smsTemplate || cfg.smsTemplate);
    return String(t || "").replace(/\{first\}/g, firstName(g.name)).replace(/\{name\}/g, g.name).replace(/\{link\}/g, linkFor(g));
  }
  function messageKindFor(g) { const st = statusOf(g); return st === "yes" ? "dayBefore" : (g.invitedAt ? "reminder" : "invite"); }

  /* ---------- rendering ---------- */
  function render() {
    renderTiles(); renderDiet(); renderGuests(); renderWishes(); renderGuesses(); fillSettings();
    $("#link-sheet").href = data.sheetUrl || "#";
    $("#quota-note").textContent = data.quota >= 0 ? `${data.quota} emails left today` : "";
  }

  function renderTiles() {
    const guests = data.guests || [], rsvps = data.rsvps || [];
    const yes = rsvps.filter(r => r.attending === "yes"), no = rsvps.filter(r => r.attending !== "yes");
    const adults = yes.reduce((a, r) => a + (Number(r.adults) || 0), 0), kids = yes.reduce((a, r) => a + (Number(r.kids) || 0), 0);
    const replied = new Set(rsvps.map(r => r.token));
    const awaiting = guests.filter(g => !replied.has(g.token));
    const opened = awaiting.filter(g => g.viewedAt);
    const invited = guests.filter(g => g.invitedAt).length;
    const tiles = [
      { cls: "yes", n: adults + kids, l: "Coming", s: `${adults} adult${adults === 1 ? "" : "s"} · ${kids} kid${kids === 1 ? "" : "s"} · ${yes.length} households` },
      { cls: "no", n: no.length, l: "Declined", s: no.length ? "Sending love from afar" : "No regrets yet" },
      { cls: "open", n: awaiting.length, l: "Awaiting", s: `${opened.length} opened the invite` },
      { cls: "", n: guests.length, l: "On the list", s: `${invited} invited · ${guests.filter(g => g.email).length} with email` }
    ];
    $("#tiles").innerHTML = tiles.map(t => `<div class="tile ${t.cls}"><span class="n">${t.n}</span><span class="l">${t.l}</span><span class="s">${esc(t.s)}</span></div>`).join("");
    const days = Math.round((new Date((data.settings.date || cfg.date) + "T12:00:00") - new Date()) / 864e5);
    $("#guests-sub").textContent = `${days > 0 ? days + " days to go · " : ""}RSVP by ${new Date((data.settings.rsvpBy || cfg.rsvpBy) + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`;
  }

  function renderDiet() {
    const yes = (data.rsvps || []).filter(r => r.attending === "yes");
    const counts = {}; const notes = [];
    yes.forEach(r => { (r.diet || []).forEach(d => { counts[d] = (counts[d] || 0) + 1; }); if (r.dietNote) notes.push(`${r.name}: ${r.dietNote}`); });
    const entries = Object.entries(counts).filter(([k]) => k !== "No restrictions").sort((a, b) => b[1] - a[1]);
    $("#diet-chips-sum").innerHTML = entries.length ? entries.map(([k, v]) => `<span class="chip"><b>${v}</b> ${esc(k)}</span>`).join("") : `<span class="small muted">No restrictions reported yet.</span>`;
    $("#diet-notes").innerHTML = notes.map(n => `<li>${esc(n)}</li>`).join("");
    $("#diet-sub").textContent = `${yes.length} attending household${yes.length === 1 ? "" : "s"} · counts are households`;
  }

  function guestRows() {
    const q = ($("#search").value || "").trim().toLowerCase();
    const f = ($("input[name=filter]:checked") || {}).value || "all";
    return (data.guests || []).filter(g => {
      const st = statusOf(g);
      if (f === "awaiting" && !(st === "awaiting" || st === "opened")) return false;
      if (f === "opened" && st !== "opened") return false;
      if (f === "yes" && st !== "yes") return false;
      if (f === "no" && st !== "no") return false;
      if (f === "uninvited" && (g.invitedAt || st === "yes" || st === "no")) return false;
      if (f === "noemail" && g.email) return false;
      if (q && !`${g.name} ${g.email} ${g.phone} ${g.group}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  function renderGuests() {
    const rows = guestRows();
    const pill = { yes: `<span class="pill pill-yes">Attending</span>`, no: `<span class="pill pill-no">Declined</span>`, opened: `<span class="pill pill-open">Opened</span>`, awaiting: `<span class="pill pill-wait">Awaiting</span>` };
    $("#guest-rows").innerHTML = rows.map(g => {
      const r = rsvpOf(g), st = statusOf(g);
      const party = r && r.attending === "yes" ? `${r.adults}${Number(r.kids) ? ` + ${r.kids}k` : ""}` : "—";
      const food = r && r.attending === "yes" ? [...(r.diet || []), r.dietNote].filter(Boolean).join(", ") : "";
      const sent = [g.invitedAt ? `Invited ${fmtWhen(g.invitedAt)}` : (st === "awaiting" || st === "opened" ? `<span class="pill pill-plain" style="background:var(--blush-tint);color:var(--blush-deep)">Not invited</span>` : ""), g.remindedAt ? `Reminded ${fmtWhen(g.remindedAt)}` : ""].filter(Boolean).join("<br>");
      const kind = messageKindFor(g);
      const msg = encodeURIComponent(tmpl(kind, g));
      const smsHref = g.phone ? `sms:${digits(g.phone)}?&body=${msg}` : "";
      const waHref = g.phone ? `https://wa.me/${waNumber(g.phone)}?text=${msg}` : "";
      const subject = encodeURIComponent(kind === "invite" ? (data.settings.emailSubject || "You're invited") : kind === "reminder" ? "RSVP for the baby shower?" : "See you tomorrow at the baby shower");
      const mailHref = g.email ? `mailto:${encodeURIComponent(g.email)}?subject=${subject}&body=${msg}` : "";
      return `<tr data-token="${esc(g.token)}" class="${selected.has(g.token) ? "sel" : ""}">
        <td class="chk"><input type="checkbox" class="sel-row" ${selected.has(g.token) ? "checked" : ""} aria-label="Select ${esc(g.name)}"></td>
        <td><span class="name">${esc(g.name)}</span><span class="sub">${esc(g.group || "")}${g.group === "Walk-in" ? " · not on your list" : ""}</span>${r && r.note ? `<span class="note">“${esc(r.note)}”</span>` : ""}</td>
        <td>${pill[st]}</td>
        <td class="num">${party}</td>
        <td class="food">${esc(food)}</td>
        <td class="contact">${esc(g.email || "")}${g.email && g.phone ? "<br>" : ""}${esc(g.phone || "")}</td>
        <td class="sent">${sent}</td>
        <td><div class="actions">
          <button class="btn" type="button" data-act="copy" title="Copy personal link">Link</button>
          <button class="btn" type="button" data-act="copymsg" title="Copy ${kind} message">Msg</button>
          <a class="btn" href="${esc(smsHref)}" ${smsHref ? "" : 'aria-disabled="true"'}>Text</a>
          <a class="btn" href="${esc(waHref)}" ${waHref ? 'target="_blank" rel="noopener"' : 'aria-disabled="true"'}>WhatsApp</a>
          <a class="btn" href="${esc(mailHref)}" ${mailHref ? "" : 'aria-disabled="true"'}>Email</a>
          <button class="btn" type="button" data-act="edit">Edit</button>
        </div></td></tr>`;
    }).join("");
    $("#guests-empty").hidden = rows.length > 0;
    $("#sel-count").textContent = selected.size;
    $("#bulkbar").dataset.empty = selected.size === 0 ? "true" : "false";
    $("#sel-all").checked = rows.length > 0 && rows.every(g => selected.has(g.token));
  }

  function renderWishes() {
    const list = data.wishes || [];
    $("#host-wall").innerHTML = list.map(w => `<article class="note-card ${w.visible ? "" : "hidden-wish"}" data-id="${esc(w.id)}"><p>${esc(w.message)}</p><div class="tools"><span class="by">— <b>${esc(w.name)}</b></span><button class="btn btn-sm" type="button" data-vis="${w.visible ? "0" : "1"}">${w.visible ? "Hide" : "Show"}</button></div></article>`).join("");
    $("#host-wall-empty").hidden = list.length > 0;
    $("#wishes-sub").textContent = `${list.filter(w => w.visible).length} on the wall · ${list.filter(w => !w.visible).length} hidden`;
  }

  function renderGuesses() {
    const list = (data.guesses || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    $("#guess-rows").innerHTML = list.map(g => `<tr><td class="name">${esc(g.name)}</td><td>${esc(g.date)}</td><td>${esc(g.timeOfDay || "")}</td><td class="num">${g.weightOz ? `${Math.floor(g.weightOz / 16)} lb ${g.weightOz % 16} oz` : ""}</td><td class="num">${g.length ? g.length + " in" : ""}</td><td>${esc(g.sex || "")}</td></tr>`).join("");
    $("#guesses-empty").hidden = list.length > 0;
    $("#guesses-sub").textContent = `${list.length} guess${list.length === 1 ? "" : "es"}`;
  }

  function fillSettings() {
    $$("[data-setting]").forEach(el => { const k = el.dataset.setting; const v = data.settings[k]; el.value = v != null ? v : (cfg[k] != null ? String(cfg[k]) : ""); });
  }

  /* ---------- actions ---------- */
  async function refresh(silent) {
    try { data = await api.get("admin", { key }); render(); if (!silent) toast("Refreshed"); return true; }
    catch (e) { toast(e.message || "Couldn't load"); return false; }
  }

  $("#login-form").addEventListener("submit", async e => {
    e.preventDefault(); const k = $("#host-key").value.trim(); const st = $("#login-status"); st.className = "status"; st.textContent = "";
    if (!k) { st.className = "status err"; st.textContent = "Enter the host key."; return; }
    $("#login-btn").disabled = true;
    try { data = await api.get("admin", { key: k }); key = k; store(KEY_STORE, k); showDash(); render(); }
    catch (err) { st.className = "status err"; st.textContent = err.message === "Wrong host key" ? "That key doesn't match the Settings tab." : `Couldn't reach the backend: ${err.message}`; }
    finally { $("#login-btn").disabled = false; }
  });
  function showDash() { $("#login").hidden = true; $("#dash").hidden = false; $("#host-nav").hidden = false; }

  $("#btn-refresh").addEventListener("click", () => refresh(false));
  $("#search").addEventListener("input", renderGuests);
  $("#filters").addEventListener("change", renderGuests);
  $("#sel-all").addEventListener("change", e => { const rows = guestRows(); rows.forEach(g => e.target.checked ? selected.add(g.token) : selected.delete(g.token)); renderGuests(); });

  $("#guest-rows").addEventListener("change", e => { if (!e.target.classList.contains("sel-row")) return; const t = e.target.closest("tr").dataset.token; e.target.checked ? selected.add(t) : selected.delete(t); renderGuests(); });
  $("#guest-rows").addEventListener("click", async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const token = b.closest("tr").dataset.token; const g = data.guests.find(x => x.token === token); if (!g) return;
    if (b.dataset.act === "copy") { await copy(linkFor(g)); toast(`Link for ${firstName(g.name)} copied`); }
    if (b.dataset.act === "copymsg") { await copy(tmpl(messageKindFor(g), g)); toast(`Message for ${firstName(g.name)} copied`); }
    if (b.dataset.act === "edit") openEdit(g);
  });

  $("#bulkbar").addEventListener("click", async e => {
    const b = e.target.closest("[data-bulk]"); if (!b || selected.size === 0) return;
    const tokens = Array.from(selected); const op = b.dataset.bulk;
    if (op === "copylinks") { const txt = tokens.map(t => data.guests.find(g => g.token === t)).filter(Boolean).map(g => `${g.name}: ${linkFor(g)}`).join("\n"); await copy(txt); toast(`${tokens.length} links copied`); return; }
    if (op === "markInvited") { await run(() => api.admin("markInvited", { tokens }), "Marked as invited"); return; }
    const label = { invite: "invitation", reminder: "reminder", dayBefore: "day-before details" }[op];
    const withEmail = tokens.filter(t => (data.guests.find(g => g.token === t) || {}).email).length;
    if (!withEmail) { toast("None of the selected guests have an email address"); return; }
    if (!confirm(`Email the ${label} to ${withEmail} guest${withEmail === 1 ? "" : "s"} now, from your Gmail?`)) return;
    const opName = { invite: "sendInvites", reminder: "sendReminders", dayBefore: "sendDayBefore" }[op];
    await run(async () => {
      const r = await api.admin(opName, { tokens });
      const skipped = Array.isArray(r.skipped) ? r.skipped : []; const errs = Array.isArray(r.errors) ? r.errors : [];
      const why = skipped.map(s => `${s.name || s.token}: ${s.why}`).join("\n");
      toast(`${r.sent} sent${skipped.length ? `, ${skipped.length} skipped` : ""}${errs.length ? `, ${errs.length} failed` : ""}`);
      if (why) console.info("Skipped:\n" + why);
      return r;
    }, null);
    selected.clear();
  });

  async function run(fn, successMsg) {
    try { const r = await fn(); if (successMsg) toast(successMsg); await refresh(true); return r; }
    catch (e) { toast(e.message || "Something went wrong"); return null; }
  }

  // export CSV
  $("#btn-export").addEventListener("click", () => {
    const head = ["Name", "Group", "Status", "Adults", "Kids", "Food", "Email", "Phone", "Note", "Invited", "Reminded", "Opened", "Link"];
    const lines = [head.join(",")].concat((data.guests || []).map(g => {
      const r = rsvpOf(g); const st = statusOf(g);
      return [g.name, g.group, st, r && r.attending === "yes" ? r.adults : "", r && r.attending === "yes" ? r.kids : "", r ? [...(r.diet || []), r.dietNote].filter(Boolean).join("; ") : "", g.email, g.phone, r ? r.note : "", g.invitedAt, g.remindedAt, g.viewedAt, linkFor(g)]
        .map(v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`).join(",");
    }));
    download("baby-shower-guests.csv", lines.join("\n"), "text/csv");
  });
  function download(name, text, type) { const b = new Blob([text], { type }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(u); a.remove(); }, 800); }

  // wishes
  $("#host-wall").addEventListener("click", async e => {
    const b = e.target.closest("[data-vis]"); if (!b) return;
    const id = b.closest(".note-card").dataset.id;
    await run(() => api.admin("setWishVisible", { id, visible: b.dataset.vis === "1" }), b.dataset.vis === "1" ? "Shown on the wall" : "Hidden from the wall");
  });
  $("#btn-export-wishes").addEventListener("click", () => {
    const list = (data.wishes || []).filter(w => w.visible);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Wishes for the baby</title><style>body{font-family:Georgia,serif;color:#2B2522;padding:40px;max-width:720px;margin:auto}h1{font-weight:normal;font-style:italic}article{padding:18px 0;border-top:1px solid #E3D6C4}p{font-size:19px;line-height:1.5;margin:0 0 6px}small{color:#8A8078}@media print{body{padding:0}}</style></head><body><h1>Wishes &amp; advice for Baby Garapati</h1>${list.map(w => `<article><p>${esc(w.message)}</p><small>— ${esc(w.name)}</small></article>`).join("")}<script>window.print()<\/script></body></html>`;
    const w = window.open("", "_blank"); if (w) { w.document.write(html); w.document.close(); } else download("wishes.html", html, "text/html");
  });

  // settings & templates
  $("#settings-form").addEventListener("submit", async e => {
    e.preventDefault(); const st = $("#settings-status"); st.textContent = "Saving…";
    const settings = {}; $$("#settings-form [data-setting]").forEach(el => settings[el.dataset.setting] = el.value.trim());
    try { const r = await api.admin("updateSettings", { settings }); data.settings = r.settings || Object.assign(data.settings, settings); if (settings.hostKey && settings.hostKey !== key) { key = settings.hostKey; store(KEY_STORE, key); } st.textContent = "Saved. The site updates on its next load."; render(); }
    catch (err) { st.textContent = "Couldn't save: " + err.message; }
  });
  $("#btn-save-templates").addEventListener("click", async () => {
    const st = $("#templates-status"); st.textContent = "Saving…";
    const settings = {}; $$('[data-panel="messages"] [data-setting]').forEach(el => settings[el.dataset.setting] = el.value.trim());
    try { const r = await api.admin("updateSettings", { settings }); data.settings = r.settings || Object.assign(data.settings, settings); st.textContent = "Saved."; renderGuests(); loadPreview(); }
    catch (err) { st.textContent = "Couldn't save: " + err.message; }
  });
  async function loadPreview() {
    const kind = ($("input[name=pv]:checked") || {}).value || "invite";
    try { const r = await api.get("preview", { key, kind }); $("#email-preview").srcdoc = r.html; } catch (e) { $("#email-preview").srcdoc = `<p style="font-family:sans-serif;padding:20px">${esc(e.message)}</p>`; }
  }
  $$("input[name=pv]").forEach(i => i.addEventListener("change", loadPreview));
  $("#btn-test-email").addEventListener("click", async () => {
    await run(async () => { const r = await api.admin("sendTest", { kind: ($("input[name=pv]:checked") || {}).value || "invite" }); toast(`Test sent to ${r.to}`); return r; }, null);
  });

  // add guests
  const modalAdd = $("#modal-add");
  $("#btn-add").addEventListener("click", () => { modalAdd.hidden = false; $("#add-text").focus(); parseAdd(); });
  $$("[data-close]").forEach(b => b.addEventListener("click", () => { b.closest(".modal").hidden = true; }));
  function parseAdd() {
    const lines = $("#add-text").value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const out = lines.map(l => {
      const parts = l.split(/\t|,/).map(p => p.trim());
      const g = { name: parts.shift() || "", email: "", phone: "", group: "" };
      parts.forEach(p => { if (!p) return; if (/@/.test(p)) g.email = p; else if ((p.match(/\d/g) || []).length >= 7) g.phone = p; else if (!g.group) g.group = p; });
      return g;
    }).filter(g => g.name);
    $("#add-preview").innerHTML = out.map(g => `<tr><td>${esc(g.name)}</td><td>${esc(g.email)}</td><td>${esc(g.phone)}</td><td>${esc(g.group)}</td></tr>`).join("");
    $("#add-count").textContent = out.length;
    return out;
  }
  $("#add-text").addEventListener("input", parseAdd);
  $("#add-confirm").addEventListener("click", async () => {
    const guests = parseAdd(); if (!guests.length) return;
    const st = $("#add-status"); st.textContent = "Adding…";
    try { const r = await api.admin("addGuests", { guests }); const sk = Array.isArray(r.skipped) ? r.skipped : []; st.textContent = `${r.added} added${sk.length ? `, ${sk.length} already on the list (${sk.join(", ")})` : ""}.`; $("#add-text").value = ""; parseAdd(); await refresh(true); }
    catch (e) { st.textContent = "Couldn't add: " + e.message; }
  });

  // edit guest
  const modalEdit = $("#modal-edit");
  function openEdit(g) { $("#e-token").value = g.token; $("#e-name").value = g.name || ""; $("#e-email").value = g.email || ""; $("#e-phone").value = g.phone || ""; $("#e-group").value = g.group || ""; $("#e-notes").value = g.notes || ""; $("#edit-status").textContent = ""; modalEdit.hidden = false; }
  $("#edit-form").addEventListener("submit", async e => {
    e.preventDefault(); const st = $("#edit-status"); st.textContent = "Saving…";
    try { await api.admin("updateGuest", { token: $("#e-token").value, fields: { name: $("#e-name").value, email: $("#e-email").value, phone: $("#e-phone").value, group: $("#e-group").value, notes: $("#e-notes").value } }); modalEdit.hidden = true; toast("Guest updated"); await refresh(true); }
    catch (err) { st.textContent = "Couldn't save: " + err.message; }
  });
  $("#e-delete").addEventListener("click", async () => {
    const name = $("#e-name").value; if (!confirm(`Remove ${name} from the list? Their RSVP (if any) stays in the sheet.`)) return;
    try { await api.admin("deleteGuest", { token: $("#e-token").value }); modalEdit.hidden = true; toast("Removed"); await refresh(true); } catch (err) { $("#edit-status").textContent = err.message; }
  });

  // tabs
  function showTab(name) {
    $$(".panel").forEach(p => p.hidden = p.dataset.panel !== name);
    $$("#host-nav .tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    if (name === "messages") loadPreview();
  }
  $$("#host-nav .tab").forEach(t => t.addEventListener("click", e => { e.preventDefault(); history.replaceState(null, "", "#" + t.dataset.tab); showTab(t.dataset.tab); }));

  /* ---------- boot ---------- */
  (async function boot() {
    if (!api.available) { $("#login-setup").hidden = false; $("#login-btn").disabled = true; return; }
    const saved = read(KEY_STORE);
    if (saved) { key = saved; $("#host-key").value = saved; if (await refresh(true)) { showDash(); } else { key = ""; } }
    const tab = location.hash.replace("#", ""); if (["guests", "messages", "wishes", "guesses", "settings"].includes(tab)) showTab(tab);
  })();
})();
