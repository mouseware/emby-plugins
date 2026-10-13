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
      // The last column normally absorbs the rest of the width; once it is sized too, the table is exactly the sum.
      table.style.width = any && lastSet ? sum + "px" : "";
      table.style.minWidth = any && lastSet ? "0" : "";
    }
    function ensureHandles(table, key) {
      cells(table).forEach(function (th, i) {
        if (th.querySelector(":scope > .cr-h")) return;
        if (window.getComputedStyle && getComputedStyle(th).position === "static") th.style.position = "relative"; // keeps sticky headers sticky
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
      table.addEventListener("click", function (e) { if (e.target.classList && e.target.classList.contains("cr-h")) { e.stopPropagation(); e.preventDefault(); } }, true);
      table.addEventListener("dblclick", function (e) {
        if (!(e.target.classList && e.target.classList.contains("cr-h"))) return;
        e.stopPropagation(); e.preventDefault(); save(key, {}); apply(table, key);
      }, true);
      table.addEventListener("pointerdown", function (e) {
        var hd = e.target; if (!(hd.classList && hd.classList.contains("cr-h")) || e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        var th = hd.parentNode, list = cells(table), idx = list.indexOf(th);
        // Freeze every other column at its current width (except the last, which keeps absorbing the remainder).
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

  var PLUGIN_ID = "5b0c7f3e-2d4a-4e61-9a8b-6c1f0e7d3a52";
  var API = "ClawMediaIntegrity/";
  var TAB_KEY = "claw.mediaintegrity.tab", GROUP_KEY = "claw.mediaintegrity.groupBy";
  var PAGE = 100;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function url(p, q) { return ApiClient.getUrl(API + p, q || {}); }
  function getJSON(p, q) { return ApiClient.getJSON(url(p, q)); }
  function post(p, q) { return ApiClient.ajax({ type: "POST", url: url(p, q), dataType: "json" }); }
  function fmtBytes(b) {
    if (b == null) return "";
    var u = ["B", "KB", "MB", "GB", "TB", "PB"], i = 0; b = +b;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i === 0 ? b.toFixed(0) : b.toFixed(b >= 100 ? 0 : b >= 10 ? 1 : 2)) + " " + u[i];
  }
  function fmtNum(n) { return n == null ? "" : Number(n).toLocaleString(); }
  function fmtTime(t) {
    if (!t) return "";
    var d = new Date(t); if (isNaN(d)) return "";
    var now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString([], { year: d.getFullYear() === now.getFullYear() ? undefined : "numeric", month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  function fmtDate(t) { if (!t) return ""; var d = new Date(t); return isNaN(d) ? "" : d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }); }
  function fmtDur(s) {
    if (s == null || !isFinite(s)) return "";
    s = Math.max(0, Math.round(s));
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    if (d) return d + "d " + h + "h";
    if (h) return h + "h " + m + "m";
    if (m) return m + "m " + (s % 60) + "s";
    return (s % 60) + "s";
  }
  function ago(t, now) {
    if (!t) return "never";
    var days = (now - new Date(t)) / 864e5;
    if (days < 1) return "today"; if (days < 2) return "yesterday";
    if (days < 60) return Math.round(days) + " days ago";
    return Math.round(days / 30.4) + " months ago";
  }
  function shortHash(h) { return h ? h.substr(0, 8) + "…" : "–"; }

  var STATUS = {
    ok: { label: "OK", icon: "check_circle", cls: "mi-ok" },
    changed: { label: "Changed", icon: "report", cls: "mi-f" },
    modified: { label: "Modified", icon: "edit_document", cls: "mi-w" },
    missing: { label: "Missing", icon: "help", cls: "mi-w" },
    unreadable: { label: "Unreadable", icon: "block", cls: "mi-f" },
    pending: { label: "Queued", icon: "schedule", cls: "" },
    never_hashed: { label: "Never verified", icon: "schedule", cls: "" }
  };
  var RESULT = {
    baseline: "Baseline stored", match: "Matched", changed: "Changed", modified: "Modified", "modified-accepted": "Rewritten, accepted (metadata)",
    missing: "Missing", unreadable: "Unreadable", accepted: "New hash accepted", "legacy-match": "Matched (old script)", "legacy-differs": "Differed (old script)"
  };
  function pill(s, ignored) {
    var st = STATUS[s] || { label: s };
    return '<span class="mi-pill mi-p-' + esc(s) + '">' + esc(st.label) + "</span>" + (ignored ? ' <span class="mi-pill" title="Ignored">ignored</span>' : "");
  }

  function View(view) {
    var S = { status: null, problems: [], probSort: { key: "status", dir: 1 }, sel: {}, groupBy: "library", groups: [], open: {}, cfg: null, libs: [], tab: "problems", timer: null, scans: [] };
    var q = function (s) { return view.querySelector(s); };
    var qa = function (s) { return Array.prototype.slice.call(view.querySelectorAll(s)); };
    try { S.groupBy = localStorage.getItem(GROUP_KEY) === "folder" ? "folder" : "library"; } catch (e) { }
    [["mi-prob-t", "problems"], ["mi-grp-t", "groups"], ["mi-scans-t", "scans"]].forEach(function (t) { ClawColResize.attach(q("table." + t[0]), "claw.mediaintegrity.cols." + t[1]); });

    function toast(msg) { try { require(["toast"], function (t) { t(msg); }); } catch (e) { } }
    function modal(title, html) {
      q(".mi-dlg-title").textContent = title; q(".mi-dlg-body").innerHTML = html; q(".mi-modal").classList.add("mi-on");
      var t = q(".mi-dlg-body table.mi-t"); if (t) ClawColResize.attach(t, "claw.mediaintegrity.cols.history");
    }
    q(".mi-dlg-no").addEventListener("click", function () { q(".mi-modal").classList.remove("mi-on"); });
    q(".mi-modal").addEventListener("click", function (e) { if (e.target === q(".mi-modal")) q(".mi-modal").classList.remove("mi-on"); });

    // ---------------- tabs ----------------
    function showTab(t) {
      if (!q('.mi-tab[data-tab="' + t + '"]')) t = "problems";
      S.tab = t;
      qa(".mi-tab").forEach(function (b) { b.classList.toggle("mi-on", b.getAttribute("data-tab") === t); });
      qa(".mi-panel").forEach(function (p) { p.classList.toggle("mi-on", p.getAttribute("data-panel") === t); });
      try { localStorage.setItem(TAB_KEY, t); } catch (e) { }
      if (t === "problems") loadProblems();
      else if (t === "browse") loadGroups();
      else if (t === "activity") loadScans();
      else if (t === "settings") loadSettings();
    }
    qa(".mi-tab").forEach(function (b) { b.addEventListener("click", function () { showTab(b.getAttribute("data-tab")); }); });

    // ---------------- status + scan controls ----------------
    function loadStatus() {
      return getJSON("Status").then(function (s) { S.status = s; renderStatus(); return s; }, function () { });
    }
    function renderStatus() {
      var s = S.status; if (!s) return;
      var now = new Date(s.Now || Date.now()), c = s.Counts || {};
      q(".mi-c-files").textContent = fmtNum(s.Files);
      q(".mi-c-size").textContent = s.RootCount + " folder" + (s.RootCount === 1 ? "" : "s") + " in scope";
      q(".mi-c-problems").textContent = fmtNum(s.Problems);
      q(".mi-c-problems").className = "mi-c-problems" + (s.Problems ? " mi-f" : " mi-ok");
      q(".mi-c-problems-sub").textContent = ["changed", "modified", "missing", "unreadable"].filter(function (k) { return c[k]; }).map(function (k) { return fmtNum(c[k]) + " " + k; }).join(", ") || "all good";
      q(".mi-c-last").textContent = s.LastCompleteVerification ? ago(s.LastCompleteVerification, now) : "never";
      q(".mi-c-last-sub").textContent = s.LastCompleteVerification ? fmtDate(s.LastCompleteVerification) : "";
      q(".mi-c-pending").textContent = fmtNum((c.pending || 0) + (c.never_hashed || 0));
      q(".mi-c-queue").textContent = s.QueueLength ? s.QueueLength + " in background queue" + (s.QueueCurrent ? " (hashing)" : "") : (c.never_hashed ? fmtNum(c.never_hashed) + " never verified (old database)" : "background queue empty");
      var badge = q(".mi-prob-count"); badge.textContent = fmtNum(s.Problems); badge.style.display = s.Problems ? "" : "none";

      var running = s.State && s.State !== "idle", paused = s.State === "paused";
      var show = function (sel, on) { q(sel).style.display = on ? "" : "none"; };
      show(".mi-act-start", !running); show(".mi-act-fresh", !running && !!s.Resumable);
      show(".mi-act-pause", running && !s.UserPaused); show(".mi-act-resume", running && s.UserPaused); show(".mi-act-stop", running);
      q(".mi-act-start span").textContent = s.Resumable ? "Resume scan (" + fmtNum(s.Resumable.Done) + " of " + fmtNum(s.Resumable.Total) + " done)" : "Start scan";
      show(".mi-scan-live", running); show(".mi-scan-idle", !running);
      var title = "Full integrity scan", icon = "radar";
      if (running) {
        if (paused) { title = s.PauseReason === "playback" ? "Paused while something is playing" : "Paused"; icon = "pause_circle"; }
        else if (s.State === "enumerating") { title = "Listing files…"; icon = "manage_search"; }
        else if (s.State === "finishing") { title = "Checking for missing files…"; icon = "manage_search"; }
        else { title = "Scanning"; icon = "radar"; }
        q(".mi-bar").classList.toggle("mi-paused", paused);
        q(".mi-bar i").style.width = (s.Percent || 0).toFixed(2) + "%";
        q(".mi-m-pct").textContent = (s.Percent || 0).toFixed(1) + "%";
        q(".mi-m-files").textContent = "File " + fmtNum(s.FileIndex) + " of " + fmtNum(s.FileCount);
        q(".mi-m-bytes").textContent = fmtBytes(s.BytesDone) + " of " + fmtBytes(s.BytesTotal);
        q(".mi-m-speed").textContent = s.BytesPerSecond ? fmtBytes(s.BytesPerSecond) + "/s" : "";
        q(".mi-m-left").textContent = s.SecondsLeft != null ? "about " + fmtDur(s.SecondsLeft) + " left" : "";
        q(".mi-cur").textContent = s.CurrentFile ? s.CurrentFile + (s.CurrentSize ? "  (" + Math.floor(100 * s.CurrentDone / s.CurrentSize) + "% of " + fmtBytes(s.CurrentSize) + ")" : "") : "";
        q(".mi-cur").title = s.CurrentFile || "";
      } else {
        var l = s.LastScan, txt = "";
        if (s.Resumable) txt = "Unfinished scan from " + fmtTime(s.Resumable.Started) + " (" + s.Resumable.State + "), stopped at " + fmtNum(s.Resumable.Done) + " of " + fmtNum(s.Resumable.Total) + " files. Start resumes it.";
        else if (l) txt = "Last scan " + fmtTime(l.Started) + ": " + l.State + (l.Ended ? ", took " + fmtDur((new Date(l.Ended) - new Date(l.Started)) / 1000) : "") + ".";
        else txt = "No full scan yet." + (s.Import && s.Import.FilesImported ? " " + fmtNum(s.Import.FilesImported) + " files were imported from the old database." : "");
        if (s.LastSkipReason) txt += " " + s.LastSkipReason;
        q(".mi-scan-idle").textContent = txt + " Runs on Emby's schedule (Scheduled tasks), at low priority, one file at a time.";
      }
      q(".mi-scan-state").textContent = title; q(".mi-scan-icon").textContent = icon;
      var src = running ? s : (s.Resumable || s.LastScan);
      var chips = [["Matched", "Matched", "mi-ok"], ["New", "New", ""], ["Changed", "Changed", "mi-f"], ["Modified", "Modified", "mi-w"], ["Missing", "Missing", "mi-w"], ["Unreadable", "Unreadable", "mi-f"]];
      q(".mi-chips").innerHTML = src ? chips.map(function (x) { var n = src[x[1]] || 0; return '<span class="mi-chip">' + x[0] + '<b class="' + (n ? x[2] : "") + '">' + fmtNum(n) + "</b></span>"; }).join("") : "";
      schedule();
    }
    function scanAct(a) {
      return post("Scan/" + a).then(function (r) { if (r && r.Error) toast(r.Error); setTimeout(loadStatus, 600); });
    }
    q(".mi-act-start").addEventListener("click", function () { scanAct("Start"); toast(S.status && S.status.Resumable ? "Resuming the scan…" : "Scan queued"); });
    q(".mi-act-fresh").addEventListener("click", function () { if (confirm("Discard the unfinished scan and start from the first file?")) scanAct("StartFresh"); });
    q(".mi-act-pause").addEventListener("click", function () { scanAct("Pause"); });
    q(".mi-act-resume").addEventListener("click", function () { scanAct("Resume"); });
    q(".mi-act-stop").addEventListener("click", function () { if (confirm("Stop the scan? It resumes from this file next time.")) scanAct("Stop"); });

    function schedule() {
      if (S.timer) clearTimeout(S.timer);
      var running = S.status && S.status.State && S.status.State !== "idle";
      S.timer = setTimeout(function () { if (!document.hidden) loadStatus(); else schedule(); }, running ? 2000 : 15000);
    }

    // ---------------- problems ----------------
    function loadProblems() {
      return getJSON("Problems", { IncludeIgnored: q(".mi-prob-ign").checked }).then(function (list) { S.problems = list || []; renderProblems(); });
    }
    function probVal(f, k) {
      switch (k) {
        case "status": return ["changed", "unreadable", "missing", "modified"].indexOf(f.Status);
        case "name": return (f.Name || "").toLowerCase();
        case "folder": return (f.Folder || "").toLowerCase();
        case "size": return f.Size || 0;
        case "checked": return f.LastChecked || "";
      }
      return "";
    }
    function renderProblems() {
      var kind = q(".mi-prob-kind").value, filt = q(".mi-prob-filter").value.trim().toLowerCase();
      var list = S.problems.filter(function (f) { return (!kind || f.Status === kind) && (!filt || (f.Path || "").toLowerCase().indexOf(filt) >= 0); });
      var k = S.probSort.key, d = S.probSort.dir;
      list.sort(function (a, b) { var x = probVal(a, k), y = probVal(b, k); return (x < y ? -1 : x > y ? 1 : 0) * d || (a.Path < b.Path ? -1 : 1); });
      qa(".mi-prob-t th[data-sort]").forEach(function (th) { var s = th.getAttribute("data-sort"); th.innerHTML = th.innerHTML.replace(/ [▲▼]$/, "") + (s === k ? (d > 0 ? " ▲" : " ▼") : ""); });
      q(".mi-prob-t tbody").innerHTML = list.map(function (f) {
        var st = STATUS[f.Status] || {};
        var hashes = f.Status === "missing" ? '<span class="mi-dim">file not found</span>' : f.Status === "unreadable" ? '<span class="mi-f mi-ell mi-err" title="' + esc(f.Error) + '">' + esc(f.Error || "read error") + "</span>"
          : '<span class="mi-mono">' + esc(shortHash(f.Hash)) + ' → <span class="' + (st.cls || "") + '">' + esc(shortHash(f.LastHash)) + "</span></span>";
        var acts = (f.Status === "changed" || f.Status === "modified" ? '<button type="button" class="mi-btn mi-mini mi-row-act" data-act="accept" title="Use the current hash as the new baseline">Accept</button>' : "")
          + '<button type="button" class="mi-btn mi-mini mi-row-act" data-act="recheck" title="Hash again in the background">Re-check</button>'
          + (f.Ignored ? '<button type="button" class="mi-btn mi-mini mi-row-act" data-act="unignore">Unignore</button>' : '<button type="button" class="mi-btn mi-mini mi-row-act" data-act="ignore" title="Hide from Problems">Ignore</button>')
          + (f.Status === "missing" ? '<button type="button" class="mi-btn mi-mini mi-row-act" data-act="forget" title="Stop tracking (deletes its history)">Forget</button>' : "");
        return '<tr data-id="' + f.Id + '"><td><input type="checkbox" class="mi-sel"' + (S.sel[f.Id] ? " checked" : "") + "></td>" +
          '<td class="mi-nowrap"><i class="md-icon ' + (st.cls || "") + '">' + (st.icon || "") + "</i> " + pill(f.Status, f.Ignored) + "</td>" +
          '<td class="mi-ell" title="' + esc(f.Name) + '">' + esc(f.Name) + '</td><td class="mi-ell mi-dim" title="' + esc(f.Folder) + '">' + esc(f.Folder) + "</td>" +
          '<td class="mi-num mi-nowrap">' + fmtBytes(f.Size) + '</td><td class="mi-nowrap">' + fmtTime(f.LastChecked) + "</td><td>" + hashes + '</td><td><div class="mi-acts">' + acts + "</div></td></tr>";
      }).join("");
      q(".mi-prob-empty").style.display = list.length ? "none" : "";
      q(".mi-prob-t").style.display = list.length ? "" : "none";
      q(".mi-prob-empty").textContent = S.problems.length ? "Nothing matches the filter." : "No problems. Every checked file matches its baseline.";
      updateBulk();
    }
    function selectedIds() { return Object.keys(S.sel).filter(function (k) { return S.sel[k]; }); }
    function updateBulk() {
      var n = selectedIds().length;
      q(".mi-prob-bulk").textContent = n + " selected";
      qa(".mi-bulk").forEach(function (b) { b.disabled = !n; });
    }
    function fileAction(ids, act) {
      if (!ids.length) return Promise.resolve();
      if (act === "forget" && !confirm("Stop tracking this missing file? Its history is deleted.")) return Promise.resolve();
      return post("Files/Action", { Ids: ids.join(","), Action: act }).then(function (r) {
        var msg = { accept: "accepted", recheck: "queued for re-check", ignore: "ignored", unignore: "no longer ignored", forget: "forgotten" }[act];
        toast((r.Done || 0) + " file" + (r.Done === 1 ? "" : "s") + " " + msg + (r.Skipped ? " (" + r.Skipped + " skipped)" : ""));
        ids.forEach(function (i) { delete S.sel[i]; });
        return Promise.all([loadProblems(), loadStatus()]);
      });
    }
    q(".mi-prob-t tbody").addEventListener("click", function (e) {
      var tr = e.target.closest("tr"); if (!tr) return;
      var id = tr.getAttribute("data-id");
      var b = e.target.closest(".mi-row-act");
      if (b) { e.stopPropagation(); fileAction([id], b.getAttribute("data-act")); return; }
      if (e.target.classList.contains("mi-sel")) { S.sel[id] = e.target.checked; updateBulk(); return; }
      showHistory(id);
    });
    q(".mi-sel-all").addEventListener("change", function (e) {
      qa(".mi-prob-t tbody tr").forEach(function (tr) { S.sel[tr.getAttribute("data-id")] = e.target.checked; tr.querySelector(".mi-sel").checked = e.target.checked; });
      updateBulk();
    });
    qa(".mi-bulk").forEach(function (b) { b.addEventListener("click", function () { fileAction(selectedIds(), b.getAttribute("data-act")); }); });
    q(".mi-prob-t thead").addEventListener("click", function (e) {
      var th = e.target.closest("th[data-sort]"); if (!th || e.target.classList.contains("cr-h")) return;
      var k = th.getAttribute("data-sort"); S.probSort = { key: k, dir: S.probSort.key === k ? -S.probSort.dir : 1 }; renderProblems();
    });
    q(".mi-prob-kind").addEventListener("change", renderProblems);
    q(".mi-prob-filter").addEventListener("input", renderProblems);
    q(".mi-prob-ign").addEventListener("change", loadProblems);

    // ---------------- history ----------------
    function showHistory(id) {
      getJSON("Files/" + id + "/History").then(function (h) {
        var f = h.File; if (!f) return;
        var kv = [["Status", pill(f.Status, f.Ignored)], ["Folder", esc(f.Folder)], ["Size", fmtBytes(f.Size) + (f.Size ? ' <span class="mi-dim">(' + fmtNum(f.Size) + " bytes)</span>" : "")],
          ["Modified", fmtTime(f.Mtime)], ["Baseline MD5", '<span class="mi-mono">' + esc(f.Hash || "–") + "</span>" + (f.BaselineDate ? ' <span class="mi-dim">since ' + fmtDate(f.BaselineDate) + "</span>" : "")],
          ["Last MD5", '<span class="mi-mono">' + esc(f.LastHash || "–") + "</span>"], ["Last checked", fmtTime(f.LastChecked) || "never"]];
        if (f.Error) kv.push(["Error", '<span class="mi-f">' + esc(f.Error) + "</span>"]);
        var rows = (h.Checks || []).map(function (c) {
          var bad = /changed|modified|missing|unreadable|differs/.test(c.Result);
          return "<tr><td class=\"mi-nowrap\">" + fmtTime(c.Time) + '</td><td class="' + (bad ? "mi-f" : c.Result === "match" || c.Result === "legacy-match" ? "mi-ok" : "") + '">' + esc(RESULT[c.Result] || c.Result) +
            '</td><td class="mi-mono">' + esc(c.Md5 || "") + '</td><td class="mi-num mi-nowrap">' + fmtBytes(c.Size) + '</td><td class="mi-num">' + (c.Seconds != null ? c.Seconds.toFixed(c.Seconds < 10 ? 1 : 0) + " s" : "") +
            "</td><td>" + esc({ scan: "Full scan", added: "New item", recheck: "Re-check", legacy: "Old script", user: "You" }[c.Source] || c.Source) + '</td><td class="mi-dim">' + esc(c.Note || "") + "</td></tr>";
        }).join("");
        modal(f.Name, '<table class="mi-kv"><tbody>' + kv.map(function (x) { return "<tr><td>" + x[0] + "</td><td>" + x[1] + "</td></tr>"; }).join("") + "</tbody></table>" +
          '<h3 class="mi-h">History (' + (h.Checks || []).length + ")</h3>" +
          (rows ? '<table class="mi-t mi-hist-t"><thead><tr><th class="mi-ns" data-col="time">Time</th><th class="mi-ns" data-col="result">Result</th><th class="mi-ns" data-col="md5">MD5</th><th class="mi-ns mi-num" data-col="size">Size</th><th class="mi-ns mi-num" data-col="secs">Took</th><th class="mi-ns" data-col="source">By</th><th class="mi-ns" data-col="note">Note</th></tr></thead><tbody>' + rows + "</tbody></table>" : '<div class="mi-empty">Never hashed.</div>') +
          '<div class="fieldDescription">"Took" for old-script rows is unreliable (the script stored only the seconds part).</div>');
      });
    }

    // ---------------- browse ----------------
    function loadGroups() {
      qa(".mi-seg button").forEach(function (b) { b.classList.toggle("mi-on", b.getAttribute("data-group") === S.groupBy); });
      return getJSON("Groups", { GroupBy: S.groupBy }).then(function (g) { S.groups = g || []; renderGroups(); });
    }
    function renderGroups() {
      var tb = q(".mi-grp-t tbody");
      tb.innerHTML = S.groups.map(function (g) {
        var open = !!S.open[S.groupBy + "|" + g.Key];
        var range = g.OldestCheck ? (fmtDate(g.OldestCheck) === fmtDate(g.NewestCheck) ? fmtDate(g.NewestCheck) : fmtDate(g.OldestCheck) + " – " + fmtDate(g.NewestCheck)) : "never";
        return '<tr class="mi-grp' + (open ? " mi-open" : "") + '" data-key="' + esc(g.Key) + '"><td><span class="mi-caret">▶</span> <b>' + esc(g.Label) + "</b>" +
          (g.Paths && g.Paths.length && S.groupBy === "library" ? ' <span class="mi-dim">' + esc(g.Paths.join(", ")) + "</span>" : "") + '</td><td class="mi-num">' + fmtNum(g.Files) + '</td><td class="mi-num mi-nowrap">' + fmtBytes(g.Bytes) +
          '</td><td class="mi-num mi-ok">' + fmtNum(g.Ok) + '</td><td class="mi-num ' + (g.Problems ? "mi-f" : "mi-dim") + '">' + fmtNum(g.Problems) + '</td><td class="mi-num ' + (g.Pending ? "" : "mi-dim") + '">' + fmtNum(g.Pending) +
          '</td><td class="mi-nowrap mi-dim">' + range + "</td></tr>" + (open ? '<tr class="mi-sub" data-for="' + esc(g.Key) + '"><td colspan="7"></td></tr>' : "");
      }).join("") || '<tr><td colspan="7" class="mi-empty">No files yet.</td></tr>';
      qa(".mi-grp-t tr.mi-sub").forEach(function (tr) { renderSub(tr); });
    }
    function subState(key) {
      var k = S.groupBy + "|" + key;
      return S.open[k] || (S.open[k] = { search: "", status: "", sort: "name", desc: false, start: 0 });
    }
    function renderSub(tr) {
      var key = tr.getAttribute("data-for"), st = subState(key), td = tr.cells[0];
      td.innerHTML = '<div class="mi-bar2"><input type="text" class="mi-f-search" placeholder="Search in this group" value="' + esc(st.search) + '" style="min-width:20em" />' +
        '<select class="mi-f-status">' + [["", "All statuses"], ["ok", "OK"], ["problems", "Problems"], ["changed", "Changed"], ["modified", "Modified"], ["missing", "Missing"], ["unreadable", "Unreadable"], ["pending", "Not yet hashed"], ["ignored", "Ignored"]]
          .map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === st.status ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>" +
        '<span class="mi-dim mi-f-count"></span></div>' +
        '<table class="mi-t mi-files-t"><thead><tr><th data-sort="name">Name</th><th data-sort="size" class="mi-num">Size</th><th data-sort="hash">MD5</th><th data-sort="checked">Last checked</th><th data-sort="status">Status</th></tr></thead><tbody class="mi-click"></tbody></table>' +
        '<div class="mi-pager"><button type="button" class="mi-btn mi-mini mi-f-prev">‹ Previous</button><span class="mi-f-page"></span><button type="button" class="mi-btn mi-mini mi-f-next">Next ›</button></div>';
      ClawColResize.attach(td.querySelector("table"), "claw.mediaintegrity.cols.files");
      var timer = null;
      td.querySelector(".mi-f-search").addEventListener("input", function (e) { clearTimeout(timer); timer = setTimeout(function () { st.search = e.target.value; st.start = 0; loadFiles(tr); }, 300); });
      td.querySelector(".mi-f-status").addEventListener("change", function (e) { st.status = e.target.value; st.start = 0; loadFiles(tr); });
      td.querySelector(".mi-f-prev").addEventListener("click", function () { st.start = Math.max(0, st.start - PAGE); loadFiles(tr); });
      td.querySelector(".mi-f-next").addEventListener("click", function () { st.start += PAGE; loadFiles(tr); });
      td.querySelector("thead").addEventListener("click", function (e) {
        var th = e.target.closest("th[data-sort]"); if (!th || e.target.classList.contains("cr-h")) return;
        var k = th.getAttribute("data-sort"); st.desc = st.sort === k ? !st.desc : (k === "size" || k === "checked"); st.sort = k; st.start = 0; loadFiles(tr);
      });
      td.querySelector("tbody").addEventListener("click", function (e) { var r = e.target.closest("tr[data-id]"); if (r) showHistory(r.getAttribute("data-id")); });
      loadFiles(tr);
    }
    function loadFiles(tr) {
      var key = tr.getAttribute("data-for"), st = subState(key), td = tr.cells[0];
      return getJSON("Files", { GroupBy: S.groupBy, Group: key, Search: st.search, Status: st.status, Sort: st.sort, Desc: st.desc, StartIndex: st.start, Limit: PAGE }).then(function (r) {
        var items = r.Items || [];
        td.querySelectorAll(".mi-files-t th[data-sort]").forEach(function (th) {
          var s = th.getAttribute("data-sort"); th.innerHTML = th.innerHTML.replace(/ [▲▼]$/, "") + (s === st.sort ? (st.desc ? " ▼" : " ▲") : "");
        });
        td.querySelector("tbody").innerHTML = items.map(function (f) {
          return '<tr data-id="' + f.Id + '"><td class="mi-ell" title="' + esc(f.Path) + '">' + esc(f.Name) + ' <span class="mi-dim">' + esc(rel(f.Folder, key)) + "</span>" +
            '</td><td class="mi-num mi-nowrap">' + fmtBytes(f.Size) + '</td><td class="mi-mono">' + esc(f.Hash || "–") + '</td><td class="mi-nowrap">' + fmtTime(f.LastChecked) + "</td><td>" + pill(f.Status, f.Ignored) + "</td></tr>";
        }).join("") || '<tr><td colspan="5" class="mi-empty">No files match.</td></tr>';
        var from = r.Total ? r.StartIndex + 1 : 0, to = r.StartIndex + items.length;
        td.querySelector(".mi-f-count").textContent = fmtNum(r.Total) + " file" + (r.Total === 1 ? "" : "s");
        td.querySelector(".mi-f-page").textContent = fmtNum(from) + "–" + fmtNum(to) + " of " + fmtNum(r.Total);
        td.querySelector(".mi-f-prev").disabled = r.StartIndex <= 0;
        td.querySelector(".mi-f-next").disabled = to >= r.Total;
      });
    }
    function rel(folder, key) {
      var g = S.groups.filter(function (x) { return x.Key === key; })[0];
      var p = (g && g.Paths || []).filter(function (x) { return folder && folder.toLowerCase().indexOf(x.toLowerCase()) === 0; })[0];
      var r = p ? folder.substr(p.length).replace(/^[\\\/]/, "") : folder;
      return r ? "· " + r : "";
    }
    q(".mi-grp-t tbody").addEventListener("click", function (e) {
      var tr = e.target.closest("tr.mi-grp"); if (!tr) return;
      var k = S.groupBy + "|" + tr.getAttribute("data-key");
      if (S.open[k]) delete S.open[k]; else subState(tr.getAttribute("data-key"));
      renderGroups();
    });
    qa(".mi-seg button").forEach(function (b) {
      b.addEventListener("click", function () { S.groupBy = b.getAttribute("data-group"); try { localStorage.setItem(GROUP_KEY, S.groupBy); } catch (e) { } loadGroups(); });
    });

    // ---------------- activity ----------------
    function loadScans() {
      return Promise.all([getJSON("Scans"), S.status ? Promise.resolve(S.status) : loadStatus()]).then(function (r) { S.scans = r[0] || []; renderScans(); });
    }
    function renderScans() {
      var imp = S.status && S.status.Import;
      q(".mi-import-note").innerHTML = imp && imp.Ran && !imp.Error ? '<div class="mi-note">Imported from the old database (' + esc(imp.Source) + ") on " + fmtDate(imp.Time) + ": <b>" + fmtNum(imp.FilesImported) + "</b> files (" +
        fmtNum(imp.Ok) + " OK, " + fmtNum(imp.Changed) + " changed, " + fmtNum(imp.NeverHashed) + " never verified), " + fmtNum(imp.ChecksImported) + " past checks from " + fmtDate(imp.OldestCheck) + " to " + fmtDate(imp.NewestCheck) +
        (imp.CaseDuplicatesMerged ? ", " + imp.CaseDuplicatesMerged + " duplicate paths merged" : "") + ".</div>" : "";
      var cls = { completed: "mi-ok", failed: "mi-f", stopped: "mi-w", interrupted: "mi-w", running: "", paused: "mi-w", abandoned: "mi-dim" };
      q(".mi-scans-t tbody").innerHTML = S.scans.map(function (s) {
        var end = s.Ended ? new Date(s.Ended) : null;
        var n = function (v, c) { return '<td class="mi-num ' + (v ? c || "" : "mi-dim") + '">' + fmtNum(v) + "</td>"; };
        return '<tr><td class="mi-nowrap">' + fmtTime(s.Started) + '</td><td class="' + (cls[s.State] || "") + '">' + esc(s.State) + (s.State !== "completed" && s.Total ? " at " + fmtNum(s.Done) + "/" + fmtNum(s.Total) : "") +
          '</td><td class="mi-nowrap">' + (end ? fmtDur((end - new Date(s.Started)) / 1000) : s.ActiveSeconds ? fmtDur(s.ActiveSeconds) + " so far" : "") + '</td><td class="mi-num">' + fmtNum(s.Total) + '</td><td class="mi-num mi-nowrap">' + fmtBytes(s.BytesTotal) +
          "</td>" + n(s.Matched, "mi-ok") + n(s.New) + n(s.Changed, "mi-f") + n(s.Modified, "mi-w") + n(s.Missing, "mi-w") + n(s.Unreadable, "mi-f") + '<td class="mi-dim mi-ell" title="' + esc(s.Note) + '">' + esc(s.Note || "") + "</td></tr>";
      }).join("");
      q(".mi-scans-empty").style.display = S.scans.length ? "none" : "";
    }

    // ---------------- settings ----------------
    function lines(a) { return (a || []).join("\n"); }
    function unlines(s) { return s.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(function (x) { return x; }); }
    function loadSettings() {
      return Promise.all([ApiClient.getPluginConfiguration(PLUGIN_ID), getJSON("Libraries")]).then(function (r) {
        var c = S.cfg = r[0], libs = S.libs = r[1] || [];
        var ex = (c.ExcludedLibraryIds || []).map(function (x) { return String(x).toLowerCase(); });
        q(".mi-libs").innerHTML = libs.map(function (l) {
          return '<label><input type="checkbox" class="mi-s-lib" data-id="' + esc(l.Id) + '"' + (ex.indexOf(String(l.Id).toLowerCase()) < 0 ? " checked" : "") + "> <span><b>" + esc(l.Name) + "</b> <small>" + esc((l.Locations || []).join(", ")) + "</small></span></label>";
        }).join("") || '<div class="mi-dim">No libraries.</div>';
        q(".mi-s-extra").value = lines(c.ExtraFolders);
        q(".mi-s-exclude").value = lines(c.Exclude);
        q(".mi-s-auto").value = lines(c.AutoAcceptModifiedExtensions);
        q(".mi-s-new").checked = c.HashNewItems !== false;
        q(".mi-s-throttle").value = c.ThrottleMBps || 0;
        q(".mi-s-mindays").value = c.MinDaysBetweenScheduledScans != null ? c.MinDaysBetweenScheduledScans : 150;
        q(".mi-s-play").checked = c.PauseDuringPlayback !== false;
        q(".mi-s-nsum").checked = c.NotifyScanSummary !== false;
        q(".mi-s-nprob").checked = c.NotifyProblems !== false;
        q(".mi-s-legacy").value = c.LegacyDbPath || "";
        renderImport(S.status && S.status.Import);
      });
    }
    function renderImport(imp) {
      var el = q(".mi-imp-res");
      if (!imp) { el.innerHTML = ""; return; }
      el.innerHTML = '<div class="mi-note' + (imp.Error ? " mi-warn" : "") + '">' + (imp.Error ? "Not imported: " + esc(imp.Error) :
        fmtDate(imp.Time) + ": " + fmtNum(imp.FilesImported) + " files, " + fmtNum(imp.ChecksImported) + " checks" + (imp.AlreadyPresent ? ", " + fmtNum(imp.AlreadyPresent) + " already known" : "") + " (" + (imp.Seconds || 0).toFixed(1) + " s).") + "</div>";
    }
    q(".mi-imp-now").addEventListener("click", function () {
      post("Import").then(function (r) { renderImport(r); if (S.status) S.status.Import = r; toast(r.Error ? "Import: " + r.Error : "Imported " + fmtNum(r.FilesImported) + " files"); loadStatus(); });
    });
    q(".mi-settings-form").addEventListener("submit", function (e) {
      e.preventDefault();
      ApiClient.getPluginConfiguration(PLUGIN_ID).then(function (c) {
        c.ExcludedLibraryIds = qa(".mi-s-lib").filter(function (x) { return !x.checked; }).map(function (x) { return x.getAttribute("data-id"); });
        c.ExtraFolders = unlines(q(".mi-s-extra").value);
        c.Exclude = unlines(q(".mi-s-exclude").value);
        c.AutoAcceptModifiedExtensions = unlines(q(".mi-s-auto").value);
        c.HashNewItems = q(".mi-s-new").checked;
        c.ThrottleMBps = Math.max(0, parseInt(q(".mi-s-throttle").value, 10) || 0);
        c.MinDaysBetweenScheduledScans = Math.max(0, parseInt(q(".mi-s-mindays").value, 10) || 0);
        c.PauseDuringPlayback = q(".mi-s-play").checked;
        c.NotifyScanSummary = q(".mi-s-nsum").checked;
        c.NotifyProblems = q(".mi-s-nprob").checked;
        c.LegacyDbPath = q(".mi-s-legacy").value.trim();
        return ApiClient.updatePluginConfiguration(PLUGIN_ID, c).then(function (r) {
          if (typeof Dashboard !== "undefined" && Dashboard.processPluginConfigurationUpdateResult) Dashboard.processPluginConfigurationUpdateResult(r);
          S.cfg = c; loadStatus();
        });
      });
      return false;
    });

    // ---------------- lifecycle ----------------
    view.addEventListener("viewshow", function () {
      var t = "problems"; try { t = localStorage.getItem(TAB_KEY) || "problems"; } catch (e) { }
      loadStatus().then(function () { showTab(t); });
    });
    view.addEventListener("viewhide", function () { if (S.timer) clearTimeout(S.timer); S.timer = null; });
    view.addEventListener("viewdestroy", function () { if (S.timer) clearTimeout(S.timer); });
    View.__state = S;
  }
  return View;
});
