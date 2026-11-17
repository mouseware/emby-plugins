/* Seerr Requests - Emby dashboard page controller.
 * Classic AMD module: Emby's viewmanager uses the returned constructor (do NOT use exports.default).
 * Plain ES5, no external libraries. */
define([], function () {
  "use strict";

  // ---- Claw column resize (shared by all Claw plugins; keep copies identical) ----
  // ClawColResize.attach(table, storageKey): drag handles on the right edge of every header cell; widths saved per table
  // in localStorage[storageKey] by column id (data-col, data-sort or header text). Double-click a handle to reset the table.
  // Until a column is resized the table keeps its normal automatic layout. Survives thead re-renders (MutationObserver).
  var ClawColResize = (function () {
    var CSS_ID = "claw-colresize-css-1";
    function css() {
      if (document.getElementById(CSS_ID)) return;
      var s = document.createElement("style"); s.id = CSS_ID;
      s.textContent =
                "table.cr-t .cr-h{position:absolute;top:0;right:0;width:8px;height:100%;cursor:col-resize;z-index:3;user-select:none;-webkit-user-select:none;touch-action:none}" +
        "table.cr-t .cr-h::after{content:'';position:absolute;right:0;top:22%;height:56%;width:2px;border-radius:1px;background:currentColor;opacity:0;transition:opacity .12s}" +
        "table.cr-t>thead>tr>th:hover .cr-h::after{opacity:.28}table.cr-t .cr-h.cr-drag::after{opacity:.6;background:#52b54b}" +
                "table.cr-fixed{table-layout:fixed}table.cr-fixed>thead>tr>th{box-sizing:border-box}table.cr-fixed>tbody>tr>td,table.cr-fixed>thead>tr>th{overflow:hidden;text-overflow:ellipsis}" +
        "html.cr-resizing,html.cr-resizing *{cursor:col-resize!important;user-select:none!important;-webkit-user-select:none!important}";
      document.head.appendChild(s);
    }
    function load(key) { try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch (e) { return {}; } }
    function save(key, o) { try { if (Object.keys(o).length) localStorage.setItem(key, JSON.stringify(o)); else localStorage.removeItem(key); } catch (e) { /* ignore */ } }
    function cells(table) {
      var h = table.tHead; if (!h || !h.rows.length) return [];
      return Array.prototype.slice.call(h.rows[h.rows.length - 1].cells);
    }
    function colId(th, i) {
      var id = th.getAttribute("data-col") || th.getAttribute("data-sort") || th.getAttribute("data-fsort");
      if (!id) id = (th.textContent || "").replace(/[\u25B2\u25BC\u2191\u2193]/g, "").replace(/\s+/g, " ").trim();
      return id || "#" + i;
    }
    function apply(table, key) {
      var w = load(key), list = cells(table), any = false, sum = 0, lastSet = false;
      list.forEach(function (th, i) {
        var v = w[colId(th, i)];
        if (v) { th.style.width = v + "px"; any = true; sum += v; if (i === list.length - 1) lastSet = true; }
        else th.style.width = "";
      });
      table.classList.toggle("cr-fixed", any);
      table.style.width = any && lastSet ? sum + "px" : "";
      table.style.minWidth = any && lastSet ? "0" : "";
    }
    function ensureHandles(table, key) {
      cells(table).forEach(function (th, i) {
        if (th.querySelector(":scope > .cr-h")) return;
        if (window.getComputedStyle && getComputedStyle(th).position === "static") th.style.position = "relative";
        var hd = document.createElement("span"); hd.className = "cr-h"; hd.setAttribute("aria-hidden", "true"); hd.title = "Drag to resize, double-click to reset";
        th.appendChild(hd);
      });
    }
    function attach(table, key) {
      if (!table || table.__crKey) { if (table) apply(table, key); return; }
      css(); table.__crKey = key; table.classList.add("cr-t");
      var busy = false;
      function refresh() { if (busy) return; busy = true; try { ensureHandles(table, key); apply(table, key); } finally { busy = false; } }
      refresh();
      if (window.MutationObserver) new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var t = muts[i].target;
          if (t === table || (t.closest && t.closest("thead") && t.closest("table") === table)) { refresh(); return; }
        }
      }).observe(table, { childList: true, subtree: true });
      table.addEventListener("click", function (e) { if (e.target.classList && e.target.classList.contains("cr-h") && cells(table).indexOf(e.target.parentNode) >= 0) { e.stopPropagation(); e.preventDefault(); } }, true);
      table.addEventListener("dblclick", function (e) {
        if (!(e.target.classList && e.target.classList.contains("cr-h")) || cells(table).indexOf(e.target.parentNode) < 0) return;
        e.stopPropagation(); e.preventDefault(); save(key, {}); apply(table, key);
      }, true);
      table.addEventListener("pointerdown", function (e) {
        var hd = e.target; if (!(hd.classList && hd.classList.contains("cr-h")) || e.button !== 0) return; if (cells(table).indexOf(hd.parentNode) < 0) return;
        e.preventDefault(); e.stopPropagation();
        var th = hd.parentNode, list = cells(table), idx = list.indexOf(th);
        var w = load(key);
        list.forEach(function (c, i) { var id = colId(c, i); if (!w[id] && i !== list.length - 1) w[id] = Math.round(c.getBoundingClientRect().width); });
        var id = colId(th, idx);
        w[id] = Math.round(th.getBoundingClientRect().width); save(key, w); apply(table, key);
        var start = e.clientX, startW = Math.round(th.getBoundingClientRect().width); w[id] = startW;
        hd.classList.add("cr-drag"); document.documentElement.classList.add("cr-resizing");
        try { hd.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
        function move(ev) { w[id] = Math.max(28, Math.round(startW + ev.clientX - start)); save(key, w); apply(table, key); }
        function up() {
          hd.classList.remove("cr-drag"); document.documentElement.classList.remove("cr-resizing");
          hd.removeEventListener("pointermove", move); hd.removeEventListener("pointerup", up); hd.removeEventListener("pointercancel", up);
        }
        hd.addEventListener("pointermove", move); hd.addEventListener("pointerup", up); hd.addEventListener("pointercancel", up);
      }, true);
    }
    return { attach: attach, reset: function (table, key) { save(key, {}); apply(table, key); } };
  })();
  // ---- end Claw column resize ----


  var TAB_KEY = "claw.seerrrequests.settingsTab";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function url(p, q) { return ApiClient.getUrl(p, q || {}); }
  function getJSON(p, q) { return ApiClient.getJSON(url(p, q)); }
  function post(p, data) {
    return ApiClient.ajax({ type: "POST", url: url(p), dataType: "json", data: JSON.stringify(data || {}), contentType: "application/json" });
  }
  function errorText(err) {
    if (!err) return Promise.resolve("Request failed.");
    if (typeof err === "string") return Promise.resolve(err);
    if (err.text && typeof err.text === "function") {
      return err.text().then(function (t) {
        t = String(t || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        return t || ("Request failed (" + (err.status || "?") + ").");
      }, function () { return "Request failed (" + (err.status || "?") + ")."; });
    }
    return Promise.resolve(err.message || "Request failed.");
  }
  function fmtTime(t) {
    var d = new Date(t); if (isNaN(d)) return "";
    var now = new Date(), same = d.toDateString() === now.toDateString();
    var tm = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return same ? tm : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + tm;
  }
  function pill(status) {
    var s = String(status || "");
    var cls = s === "Available" || s === "Requested" && false ? "ok" : s === "Available" ? "ok" : s === "Pending" ? "pending" : s === "Requested" ? "req" : s === "Declined" || s === "Failed" || s === "Blocked" || s === "Blocklisted" || s === "Unmatched" ? "bad" : "";
    if (s === "Requested") cls = "req";
    return '<span class="sr-pill ' + cls + '">' + esc(s || "—") + "</span>";
  }

  function View(view) {
    var S = { cfg: null, people: null, libs: [], activity: [], tab: "settings" };
    var q = function (s) { return view.querySelector(s); };
    ClawColResize.attach(q("table.sr-map-t"), "claw.seerrrequests.cols.map");
    ClawColResize.attach(q("table.sr-act-t"), "claw.seerrrequests.cols.activity");

    function showMsg(id, text, kind) {
      var el = q(id); if (!el) return;
      el.textContent = text || "";
      el.className = "sr-msg" + (text ? " sr-on " + (kind || "") : "");
    }

    function showTab(name) {
      S.tab = name === "activity" || name === "general" ? name : "settings";
      try { localStorage.setItem(TAB_KEY, S.tab); } catch (e) { /* ignore */ }
      Array.prototype.forEach.call(view.querySelectorAll(".sr-tab"), function (b) { b.classList.toggle("sr-on", b.getAttribute("data-tab") === S.tab); });
      Array.prototype.forEach.call(view.querySelectorAll(".sr-panel"), function (p) { p.classList.toggle("sr-on", p.getAttribute("data-panel") === S.tab); });
    }

    function applyCfg(c) {
      S.cfg = c || {};
      q("#srEnabled").checked = S.cfg.Enabled !== false;
      q("#srUrl").value = S.cfg.SeerrUrl || "http://192.168.1.237:5055";
      q("#srKey").value = S.cfg.ApiKey || "";
      q("#srKey").setAttribute("data-set", S.cfg.ApiKeySet ? "1" : "0");
      q("#srVis").value = S.cfg.VisibilityMode || "all";
      q("#srAllLibs").checked = !(S.cfg.AllowedLibraryIds && S.cfg.AllowedLibraryIds.length);
      q(".sr-version").textContent = S.cfg.Version || "—";
      q(".sr-script").textContent = S.cfg.Script ? (S.cfg.Script + " is injected into dashboard-ui on startup.") : "—";
      q("#srOffBanner").classList.toggle("sr-on", S.cfg.Enabled === false);
      visChanged();
      renderAllow();
      renderLibs();
      renderMap();
    }

    function visChanged() {
      q("#srAllowWrap").hidden = q("#srVis").value !== "allowlist";
    }

    function renderAllow() {
      var box = q("#srAllow"); box.innerHTML = "";
      var people = (S.people && S.people.EmbyUsers) || [];
      var allow = (S.cfg && S.cfg.AllowedUserIds) || [];
      if (!people.length) { box.innerHTML = '<div class="sr-empty">No Emby users loaded.</div>'; return; }
      people.forEach(function (u) {
        var id = "srU-" + u.Id;
        var lab = document.createElement("label");
        lab.innerHTML = '<input type="checkbox" class="sr-allow-u" data-id="' + esc(u.Id) + '" id="' + id + '"' + (allow.indexOf(u.Id) >= 0 ? " checked" : "") + " /> <span>" + esc(u.Name) + (u.IsAdmin ? " (admin)" : "") + "</span>";
        box.appendChild(lab);
      });
    }

    function renderLibs() {
      var box = q("#srLibs"); box.innerHTML = "";
      var all = q("#srAllLibs").checked;
      box.style.display = all ? "none" : "";
      var picked = (S.cfg && S.cfg.AllowedLibraryIds) || [];
      (S.libs || []).forEach(function (lib) {
        var lab = document.createElement("label");
        lab.innerHTML = '<input type="checkbox" class="sr-lib" data-id="' + esc(lib.Id) + '"' + (picked.indexOf(lib.Id) >= 0 ? " checked" : "") + " /> <span>" + esc(lib.Name) + (lib.Type ? " <span class=\"sr-dim\">(" + esc(lib.Type) + ")</span>" : "") + "</span>";
        box.appendChild(lab);
      });
    }

    function seerrOptions(selected) {
      var users = (S.people && S.people.SeerrUsers) || [];
      var html = '<option value="">(auto, or unmatched)</option>';
      users.forEach(function (u) {
        var label = u.DisplayName || u.JellyfinUsername || u.Email || ("User " + u.Id);
        html += '<option value="' + esc(u.Id) + '"' + (String(selected || "") === String(u.Id) ? " selected" : "") + ">" + esc(label) + "</option>";
      });
      return html;
    }

    function renderMap() {
      var body = q("#srMapBody");
      var people = (S.people && S.people.EmbyUsers) || [];
      if (S.people && S.people.Error) showMsg("#srPeopleMsg", S.people.Error, "err");
      else showMsg("#srPeopleMsg", "", "");
      if (!people.length) { body.innerHTML = '<tr><td colspan="3" class="sr-empty">No Emby users loaded.</td></tr>'; return; }
      body.innerHTML = people.map(function (u) {
        var how = u.How === "manual" ? "Manual override" : u.How === "auto" ? "Auto (Emby/Jellyfin id)" : "Unmatched";
        return "<tr data-emby=\"" + esc(u.Id) + "\" data-name=\"" + esc(u.Name) + "\"><td>" + esc(u.Name) + (u.IsAdmin ? " <span class=\"sr-pill\">admin</span>" : "") + "</td><td><select class=\"sr-map-seerr\">" + seerrOptions(u.SeerrUserId) + "</select></td><td class=\"sr-how\">" + esc(how) + "</td></tr>";
      }).join("");
    }

    function resultClass(s) {
      s = String(s || "");
      if (s === "Requested") return "req";
      if (s === "Available") return "ok";
      if (s === "Pending") return "pending";
      return "bad";
    }

    function renderActivity() {
      var qv = (q("#srActFilter").value || "").toLowerCase();
      var rows = (S.activity || []).filter(function (a) {
        if (!qv) return true;
        var blob = [a.EmbyUserName, a.SeerrUserName, a.Title, a.MediaType, a.Seasons, a.Result, a.Detail].join(" ").toLowerCase();
        return blob.indexOf(qv) >= 0;
      });
      var body = q("#srActBody");
      if (!rows.length) { body.innerHTML = '<tr><td colspan="8" class="sr-empty">' + (S.activity && S.activity.length ? "No matching rows." : "No requests yet.") + "</td></tr>"; return; }
      body.innerHTML = rows.map(function (a) {
        var title = esc(a.Title || "") + (a.Year ? " (" + a.Year + ")" : "");
        var who = esc(a.EmbyUserName || a.EmbyUserId || "");
        return "<tr><td class=\"sr-nowrap\">" + esc(fmtTime(a.WhenUtc)) + "</td><td>" + who + "</td><td>" + esc(a.SeerrUserName || a.SeerrUserId || "") + "</td><td>" + title + "</td><td>" + esc(a.MediaType || "") + "</td><td>" + esc(a.Seasons || "") + "</td><td>" + pill(a.Result) + "</td><td>" + esc(a.Detail || "") + "</td></tr>";
      }).join("");
    }

    function readMaps() {
      var maps = [];
      Array.prototype.forEach.call(view.querySelectorAll("#srMapBody tr[data-emby]"), function (tr) {
        var sel = tr.querySelector(".sr-map-seerr");
        var id = sel && sel.value;
        if (!id) return;
        var opt = sel.options[sel.selectedIndex];
        maps.push({ EmbyUserId: tr.getAttribute("data-emby"), EmbyUserName: tr.getAttribute("data-name"), SeerrUserId: id, SeerrUserName: opt ? opt.textContent : "", Mode: "manual" });
      });
      return maps;
    }
    function readAllow() {
      var ids = [];
      Array.prototype.forEach.call(view.querySelectorAll(".sr-allow-u:checked"), function (c) { ids.push(c.getAttribute("data-id")); });
      return ids;
    }
    function readLibs() {
      if (q("#srAllLibs").checked) return [];
      var ids = [];
      Array.prototype.forEach.call(view.querySelectorAll(".sr-lib:checked"), function (c) { ids.push(c.getAttribute("data-id")); });
      return ids;
    }

    function gatherSettings() {
      return {
        SeerrUrl: q("#srUrl").value.trim(),
        ApiKey: q("#srKey").value,
        VisibilityMode: q("#srVis").value,
        AllowedUserIds: readAllow(),
        AllowedUserNames: [],
        AllowedLibraryIds: readLibs(),
        UserMaps: readMaps()
      };
    }

    function saveSettings(e) {
      if (e) e.preventDefault();
      var body = gatherSettings();
      return post("ClawSeerrRequests/Settings", body).then(function (c) {
        applyCfg(c);
        showMsg("#srSaveMsg", "Saved.", "ok");
      }, function (err) {
        return errorText(err).then(function (t) { showMsg("#srSaveMsg", "Save failed: " + t, "err"); });
      });
    }

    function saveGeneral(e) {
      if (e) e.preventDefault();
      return post("ClawSeerrRequests/Settings", { Enabled: q("#srEnabled").checked }).then(function (c) {
        applyCfg(c);
        showMsg("#srGeneralMsg", c.Enabled ? "Saved. Seerr Requests is on." : "Saved. Seerr Requests is off.", "ok");
      }, function (err) {
        return errorText(err).then(function (t) { showMsg("#srGeneralMsg", "Save failed: " + t, "err"); });
      });
    }

    function testConnection() {
      showMsg("#srTestMsg", "Testing…", "");
      var body = { SeerrUrl: q("#srUrl").value.trim(), ApiKey: q("#srKey").value };
      return post("ClawSeerrRequests/TestConnection", body).then(function (r) {
        showMsg("#srTestMsg", (r && r.Message) || (r && r.Ok ? "OK" : "Failed"), r && r.Ok ? "ok" : "err");
      }, function (err) {
        return errorText(err).then(function (t) { showMsg("#srTestMsg", t, "err"); });
      });
    }

    function loadAll() {
      return Promise.all([
        getJSON("ClawSeerrRequests/Settings"),
        getJSON("ClawSeerrRequests/People").then(null, function () { return { EmbyUsers: [], SeerrUsers: [], Error: "Could not load users." }; }),
        getJSON("ClawSeerrRequests/Libraries").then(null, function () { return { Items: [] }; }),
        getJSON("ClawSeerrRequests/Activity").then(null, function () { return { Items: [] }; })
      ]).then(function (parts) {
        S.people = parts[1] || { EmbyUsers: [], SeerrUsers: [] };
        S.libs = (parts[2] && parts[2].Items) || [];
        S.activity = (parts[3] && parts[3].Items) || [];
        applyCfg(parts[0]);
        renderActivity();
      }, function (err) {
        return errorText(err).then(function (t) { showMsg("#srSaveMsg", t, "err"); });
      });
    }

    Array.prototype.forEach.call(view.querySelectorAll(".sr-tab"), function (b) {
      b.addEventListener("click", function () { showTab(b.getAttribute("data-tab")); });
    });
    q("#srVis").addEventListener("change", visChanged);
    q("#srAllLibs").addEventListener("change", renderLibs);
    q("#srActFilter").addEventListener("input", renderActivity);
    q("#srTest").addEventListener("click", testConnection);
    q(".sr-settings-form").addEventListener("submit", saveSettings);
    q(".sr-general-form").addEventListener("submit", saveGeneral);
    view.addEventListener("change", function (e) {
      var sel = e.target.closest && e.target.closest(".sr-map-seerr");
      if (!sel) return;
      var tr = sel.closest("tr");
      var how = tr.querySelector(".sr-how");
      if (how) how.textContent = sel.value ? "Manual override" : "Unmatched (will auto-match if Seerr has the Emby id)";
    });

    try { var saved = localStorage.getItem(TAB_KEY); if (saved) showTab(saved); } catch (e) { /* ignore */ }

    view.addEventListener("viewshow", function () { loadAll(); });

    view._seerrRequests = { state: S, showTab: showTab, applyCfg: applyCfg, renderActivity: renderActivity, renderMap: renderMap, gatherSettings: gatherSettings, saveSettings: saveSettings, saveGeneral: saveGeneral, testConnection: testConnection, loadAll: loadAll };
  }

  return View;
});
