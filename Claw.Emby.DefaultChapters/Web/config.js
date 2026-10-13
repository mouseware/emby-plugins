/* Default Chapters - Emby dashboard page controller.
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


  var PLUGIN_ID = "b5671c07-59f4-4bbd-924e-0b2483056350";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function showLoading() { try { Dashboard.showLoadingMsg(); } catch (e) { /* ignore */ } }
  function hideLoading() { try { Dashboard.hideLoadingMsg(); } catch (e) { /* ignore */ } }

  function importModule(path) {
    if (!window.Emby || typeof window.Emby.importModule !== "function") return Promise.reject(new Error("no module loader"));
    return window.Emby.importModule(path).then(function (m) { return m && m.__esModule && ("default" in m) ? m["default"] : m; });
  }

  /** Resolves true when confirmed. Emby's confirm dialog, window.confirm as fallback. */
  function confirmDlg(title, text, confirmText) {
    return importModule("./modules/common/dialogs/confirm.js").then(function (confirm) {
      return confirm({ title: title, text: text, confirmText: confirmText, primary: "cancel" })
        .then(function () { return true; }, function () { return false; });
    }, function () { return !!window.confirm(text); });
  }

  function errorText(err) {
    if (err && typeof err.text === "function") {
      return err.text().then(function (t) {
        t = String(t || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        return t || ("Request failed (" + (err.status || "?") + ").");
      }, function () { return "Request failed."; });
    }
    return Promise.resolve((err && err.message) || String(err || "Request failed."));
  }

  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    try {
      return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch (e) { return d.toLocaleString(); }
  }

  function fmtRuntime(ticks) {
    var mins = Math.round((ticks || 0) / 600000000);
    if (mins <= 0) return "";
    var h = Math.floor(mins / 60), m = mins % 60;
    return h ? h + "h " + (m < 10 ? "0" : "") + m + "m" : m + "m";
  }

  var FOUND_PAGE = 100;
  var BULK_CHUNK = 10;

  var FOUND_SORTERS = {
    name: function (r) { return (r.Name || "").toLowerCase(); },
    runtime: function (r) { return r.RunTimeTicks || 0; },
    chapters: function (r) { return r.ChapterCount || 0; },
    path: function (r) { return (r.Path || "").toLowerCase(); }
  };

  var SORTERS = {
    name: function (r) { return (r.Name || "").toLowerCase(); },
    id: function (r) { return parseInt(r.Id, 10) || 0; },
    changed: function (r) { return r.ChangedUtc ? new Date(r.ChangedUtc).getTime() : 0; },
    before: function (r) { return r.BeforeCount || 0; },
    after: function (r) { return r.AfterCount || 0; },
    interval: function (r) { return r.IntervalMinutes || 0; }
  };

  function View(view) {
    var S = { rows: [], filter: "", sort: "changed", dir: -1, loaded: false, busy: {}, tab: "changed", config: {} };
    var F = { items: null, byId: {}, filter: "", sort: "name", dir: 1, page: 0, selected: {}, busy: false, result: null };
    function $(sel) { return view.querySelector(sel); }

    function setMsg(sel, text, kind) {
      var el = $(sel);
      el.textContent = text || "";
      el.className = el.className.replace(/\s*dc-(ok|err)\b/g, "") + (kind ? " dc-" + kind : "");
    }

    function api(path) { return ApiClient.getUrl("DefaultChapters/" + path); }

    function visibleRows() {
      var f = S.filter.trim().toLowerCase();
      var rows = S.rows.filter(function (r) {
        if (!f) return true;
        return ((r.Name || "") + " " + (r.ProductionYear || "") + " " + (r.Path || "") + " " + r.Id + " " + (r.ItemGuid || "")).toLowerCase().indexOf(f) >= 0;
      });
      var key = SORTERS[S.sort] || SORTERS.changed;
      var dir = S.dir;
      rows.sort(function (a, b) {
        var x = key(a), y = key(b);
        if (x < y) return -1 * dir;
        if (x > y) return 1 * dir;
        return (a.Name || "").localeCompare(b.Name || "");
      });
      return rows;
    }

    function posterUrl(r) {
      try { return ApiClient.getImageUrl(r.Id, { type: "Primary", maxHeight: 96, quality: 80 }); } catch (e) { return ""; }
    }

    function itemHref(r) {
      var sid = "";
      try { sid = ApiClient.serverId(); } catch (e) { /* ignore */ }
      return "#!/item?id=" + encodeURIComponent(r.Id) + (sid ? "&serverId=" + encodeURIComponent(sid) : "");
    }

    function render() {
      var rows = visibleRows();
      updateBadges();
      var ths = view.querySelectorAll("th[data-sort]");
      for (var i = 0; i < ths.length; i++) {
        var k = ths[i].getAttribute("data-sort");
        ths[i].querySelector(".dc-arrow").textContent = k === S.sort ? (S.dir > 0 ? "\u25B2" : "\u25BC") : "";
        ths[i].setAttribute("aria-sort", k === S.sort ? (S.dir > 0 ? "ascending" : "descending") : "none");
      }
      $(".dc-count").textContent = S.rows.length
        ? (rows.length === S.rows.length ? S.rows.length + " changed movie" + (S.rows.length === 1 ? "" : "s") : rows.length + " of " + S.rows.length + " shown")
        : "";

      if (!rows.length) {
        $(".dc-rows").innerHTML = '<tr><td colspan="7" class="dc-empty">' +
          (S.rows.length ? "No movies match the filter." : (S.loaded ? "No movies have interval chapters from this plugin yet." : "Loading\u2026")) + "</td></tr>";
        return;
      }

      $(".dc-rows").innerHTML = rows.map(function (r) {
        var img = posterUrl(r);
        var updated = r.OriginalUpdatedUtc ? '<span class="dc-chip" title="A refresh found new chapters in the file on ' + esc(fmtDate(r.OriginalUpdatedUtc)) + '; Revert restores those.">file changed</span>' : "";
        return '<tr data-id="' + esc(r.Id) + '">' +
          '<td><div class="dc-movie"><span class="dc-poster"' + (img ? ' style="background-image:url(\'' + esc(img) + '\')"' : "") + '></span><div>' +
            '<a href="' + esc(itemHref(r)) + '" is="emby-linkbutton">' + esc(r.Name || "(unnamed)") + "</a>" +
            (r.ProductionYear ? ' <span class="dc-muted">(' + esc(r.ProductionYear) + ")</span>" : "") + updated +
            '<div class="dc-path">' + esc(r.Path || "") + "</div></div></div></td>" +
          '<td class="dc-id">' + esc(r.Id) + "</td>" +
          '<td title="' + esc(r.ChangedUtc) + '">' + esc(fmtDate(r.ChangedUtc)) + "</td>" +
          '<td class="dc-num">' + esc(r.BeforeCount) + "</td>" +
          '<td class="dc-num">' + esc(r.AfterCount) + "</td>" +
          '<td class="dc-num">' + esc(r.IntervalMinutes) + " min</td>" +
          '<td><button type="button" class="dc-btn dc-revert" data-id="' + esc(r.Id) + '"' + (S.busy[r.Id] ? " disabled" : "") + ">Revert</button></td>" +
          "</tr>";
      }).join("");
    }

    function loadRows() {
      setMsg(".dc-table-msg", "");
      return ApiClient.getJSON(api("Overrides")).then(function (res) {
        S.rows = (res && res.Items) || [];
        S.loaded = true;
        render();
      }, function (err) {
        S.loaded = true;
        render();
        return errorText(err).then(function (t) { setMsg(".dc-table-msg", "Could not load the list: " + t, "err"); });
      });
    }

    function loadConfig() {
      return ApiClient.getPluginConfiguration(PLUGIN_ID).then(function (cfg) {
        S.config = cfg || {};
        $("#dcInterval").value = S.config.IntervalMinutes || 5;
        fillCriteria();
      }, function () { $("#dcInterval").value = 5; S.config = {}; fillCriteria(); });
    }

    function loadAll() {
      showLoading();
      return Promise.all([loadConfig(), loadRows()]).then(hideLoading, hideLoading);
    }

    function saveConfig(e) {
      if (e) e.preventDefault();
      var v = parseInt($("#dcInterval").value, 10);
      if (!(v >= 1 && v <= 60)) { setMsg(".dc-save-msg", "Enter a whole number from 1 to 60.", "err"); return Promise.resolve(); }
      showLoading();
      return ApiClient.getPluginConfiguration(PLUGIN_ID).then(function (cfg) {
        cfg = cfg || {};
        cfg.IntervalMinutes = v;
        return ApiClient.updatePluginConfiguration(PLUGIN_ID, cfg).then(function () { S.config = cfg; });
      }).then(function () {
        hideLoading();
        setMsg(".dc-save-msg", "Saved.", "ok");
      }, function (err) {
        hideLoading();
        return errorText(err).then(function (t) { setMsg(".dc-save-msg", "Save failed: " + t, "err"); });
      });
    }

    function revert(id) {
      var row = null;
      for (var i = 0; i < S.rows.length; i++) if (String(S.rows[i].Id) === String(id)) row = S.rows[i];
      if (!row || S.busy[id]) return Promise.resolve();
      return confirmDlg("Revert chapters?",
        "Put back the " + row.BeforeCount + " original chapter" + (row.BeforeCount === 1 ? "" : "s") + " of \u201C" + (row.Name || id) + "\u201D and stop overriding it?",
        "Revert").then(function (ok) {
        if (!ok) return;
        S.busy[id] = true;
        render();
        return ApiClient.ajax({ type: "POST", url: api("Items/" + encodeURIComponent(id) + "/Restore"), dataType: "json" }).then(function () {
          delete S.busy[id];
          S.rows = S.rows.filter(function (r) { return String(r.Id) !== String(id); });
          if (window.__clawDefaultChapters && window.__clawDefaultChapters.state) delete window.__clawDefaultChapters.state.ids[String(id)];
          var fr = F.byId[String(id)];
          if (fr) { fr.status = null; fr.HasOverride = false; fr.NeedsConfirm = false; renderFound(); }
          render();
          setMsg(".dc-table-msg", "Restored the original chapters of \u201C" + (row.Name || id) + "\u201D.", "ok");
        }, function (err) {
          delete S.busy[id];
          render();
          return errorText(err).then(function (t) { setMsg(".dc-table-msg", "Revert failed: " + t, "err"); });
        });
      });
    }

    function wire() {
      $(".dc-form").addEventListener("submit", saveConfig);
      var t;
      $(".dc-panel-changed .dc-filter").addEventListener("input", function () {
        clearTimeout(t);
        var el = this;
        t = setTimeout(function () { S.filter = el.value || ""; render(); }, 120);
      });
      $(".dc-reload").addEventListener("click", function () { loadAll(); });
      ClawColResize.attach(view.querySelector(".dc-panel-changed table.dc-table"), "claw.defaultchapters.cols.changed");
      view.querySelector(".dc-panel-changed thead").addEventListener("click", function (e) {
        var th = e.target.closest && e.target.closest("th[data-sort]");
        if (!th) return;
        var k = th.getAttribute("data-sort");
        if (S.sort === k) S.dir = -S.dir;
        else { S.sort = k; S.dir = (k === "name" || k === "id") ? 1 : -1; }
        render();
      });
      $(".dc-rows").addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest(".dc-revert");
        if (b) revert(b.getAttribute("data-id"));
      });
    }


    // ------------------------------------------------------------ tabs
    function updateBadges() {
      $(".dc-badge-changed").textContent = S.loaded ? String(S.rows.length) : "";
      $(".dc-badge-found").textContent = F.items ? String(F.items.filter(function (r) { return r.status !== "done"; }).length) : "\u2013";
    }

    function showTab(name) {
      S.tab = name === "found" ? "found" : "changed";
      var tabs = view.querySelectorAll(".dc-tab");
      for (var i = 0; i < tabs.length; i++) {
        var on = tabs[i].getAttribute("data-tab") === S.tab;
        tabs[i].className = "dc-tab" + (on ? " dc-active" : "");
        tabs[i].setAttribute("aria-selected", on ? "true" : "false");
      }
      $(".dc-panel-changed").hidden = S.tab !== "changed";
      $(".dc-panel-found").hidden = S.tab !== "found";
    }

    // ------------------------------------------------------------ found movies
    function fillCriteria() {
      var c = S.config || {};
      $("#dcMinRuntime").value = c.MinRuntimeMinutes != null ? c.MinRuntimeMinutes : 60;
      $("#dcMaxChapters").value = c.MaxChapters != null ? c.MaxChapters : 3;
      $("#dcExcludeOverridden").checked = c.ExcludeOverridden !== false;
    }

    function readCriteria() {
      var min = parseInt($("#dcMinRuntime").value, 10);
      var max = parseInt($("#dcMaxChapters").value, 10);
      if (!(min >= 0 && min <= 1440)) return { error: "Runtime must be a whole number of minutes from 0 to 1440." };
      if (!(max >= 0 && max <= 999)) return { error: "Chapters must be a whole number from 0 to 999." };
      return { MinRuntimeMinutes: min, MaxChapters: max, ExcludeOverridden: !!$("#dcExcludeOverridden").checked };
    }

    function saveCriteria(c) {
      return ApiClient.getPluginConfiguration(PLUGIN_ID).then(function (cfg) {
        cfg = cfg || {};
        if (cfg.MinRuntimeMinutes === c.MinRuntimeMinutes && cfg.MaxChapters === c.MaxChapters && cfg.ExcludeOverridden === c.ExcludeOverridden) { S.config = cfg; return; }
        cfg.MinRuntimeMinutes = c.MinRuntimeMinutes;
        cfg.MaxChapters = c.MaxChapters;
        cfg.ExcludeOverridden = c.ExcludeOverridden;
        return ApiClient.updatePluginConfiguration(PLUGIN_ID, cfg).then(function () { S.config = cfg; });
      });
    }

    function findMatches(e) {
      if (e) e.preventDefault();
      if (F.busy) return Promise.resolve();
      var c = readCriteria();
      if (c.error) { setMsg(".dc-found-msg", c.error, "err"); return Promise.resolve(); }
      F.busy = true;
      setMsg(".dc-found-msg", "Searching the library\u2026");
      syncFoundButtons();
      showLoading();
      var saved = saveCriteria(c).then(null, function () { return "unsaved"; });
      var url = api("Found?MinRuntimeMinutes=" + c.MinRuntimeMinutes + "&MaxChapters=" + c.MaxChapters + "&ExcludeOverridden=" + c.ExcludeOverridden);
      return Promise.all([saved, ApiClient.getJSON(url)]).then(function (res) {
        var r = res[1] || {};
        F.result = r;
        F.items = r.Items || [];
        F.byId = {};
        F.items.forEach(function (it) { F.byId[String(it.Id)] = it; });
        F.selected = {};
        F.page = 0;
        F.busy = false;
        hideLoading();
        var msg = F.items.length
          ? r.MatchCount + " movie" + (r.MatchCount === 1 ? "" : "s") + " match (" + r.ScannedCount + " checked)." + (r.Truncated ? " Showing the first " + F.items.length + "." : "")
          : "No movies match (" + (r.ScannedCount || 0) + " checked).";
        setMsg(".dc-found-msg", msg + (res[0] === "unsaved" ? " (Criteria could not be saved.)" : ""), F.items.length ? "ok" : null);
        renderFound();
      }, function (err) {
        F.busy = false;
        hideLoading();
        syncFoundButtons();
        return errorText(err).then(function (t) { setMsg(".dc-found-msg", "Search failed: " + t, "err"); });
      });
    }

    function foundVisible() {
      if (!F.items) return [];
      var f = F.filter.trim().toLowerCase();
      var rows = F.items.filter(function (r) {
        if (!f) return true;
        return ((r.Name || "") + " " + (r.ProductionYear || "") + " " + (r.Path || "") + " " + r.Id).toLowerCase().indexOf(f) >= 0;
      });
      var key = FOUND_SORTERS[F.sort] || FOUND_SORTERS.name, dir = F.dir;
      rows.sort(function (a, b) {
        var x = key(a), y = key(b);
        if (x < y) return -1 * dir;
        if (x > y) return 1 * dir;
        return (a.Name || "").localeCompare(b.Name || "");
      });
      return rows;
    }

    function selectable(r) { return r.status !== "done" && r.status !== "busy" && r.CanGenerate !== false; }

    function selectedIds() {
      return Object.keys(F.selected).filter(function (id) { return F.selected[id] && F.byId[id] && selectable(F.byId[id]); });
    }

    function pageRows(rows) {
      var pages = Math.max(1, Math.ceil(rows.length / FOUND_PAGE));
      if (F.page >= pages) F.page = pages - 1;
      if (F.page < 0) F.page = 0;
      return { rows: rows.slice(F.page * FOUND_PAGE, (F.page + 1) * FOUND_PAGE), pages: pages };
    }

    function syncFoundButtons() {
      var n = selectedIds().length;
      var all = foundVisible().filter(selectable).length;
      $(".dc-bulk").textContent = n ? "Generate for selected (" + n + ")\u2026" : "Generate for selected\u2026";
      $(".dc-bulk").disabled = F.busy || !n;
      $(".dc-select-none").disabled = F.busy || !n;
      $(".dc-select-all").disabled = F.busy || !all;
      $(".dc-select-all").textContent = all ? "Select all matching (" + all + ")" : "Select all matching";
      $(".dc-find").disabled = F.busy;
    }

    function renderFound() {
      updateBadges();
      var ths = view.querySelectorAll("th[data-fsort]");
      for (var i = 0; i < ths.length; i++) {
        var k = ths[i].getAttribute("data-fsort");
        ths[i].querySelector(".dc-arrow").textContent = k === F.sort ? (F.dir > 0 ? "\u25B2" : "\u25BC") : "";
        ths[i].setAttribute("aria-sort", k === F.sort ? (F.dir > 0 ? "ascending" : "descending") : "none");
      }
      var all = foundVisible();
      var pg = pageRows(all);
      var cb = $(".dc-page-cb");
      var sel = pg.rows.filter(selectable);
      var nsel = sel.filter(function (r) { return F.selected[String(r.Id)]; }).length;
      cb.checked = sel.length > 0 && nsel === sel.length;
      cb.indeterminate = nsel > 0 && nsel < sel.length;
      cb.disabled = !sel.length || F.busy;

      var count = "";
      if (F.items) {
        count = all.length === F.items.length ? F.items.length + " found" : all.length + " of " + F.items.length + " shown";
        var ns = selectedIds().length;
        if (ns) count += " \u00B7 " + ns + " selected";
      }
      $(".dc-found-count").textContent = count;
      $(".dc-pager").hidden = pg.pages <= 1;
      $(".dc-page-info").textContent = "Page " + (F.page + 1) + " of " + pg.pages;
      $(".dc-prev").disabled = F.page <= 0;
      $(".dc-next").disabled = F.page >= pg.pages - 1;

      if (!pg.rows.length) {
        $(".dc-found-rows").innerHTML = '<tr><td colspan="6" class="dc-empty">' +
          (F.items == null ? "Set the criteria and press <b>Find matches</b>. Nothing is scanned automatically."
            : (F.items.length ? "No movies match the filter." : "No movies match these criteria.")) + "</td></tr>";
        syncFoundButtons();
        return;
      }

      $(".dc-found-rows").innerHTML = pg.rows.map(function (r) {
        var id = String(r.Id), img = posterUrl(r), can = selectable(r);
        var flags = "";
        if (r.HasOverride) flags += '<span class="dc-warn" title="Already has interval chapters from this plugin">changed</span>';
        else if (r.LooksInterval) flags += '<span class="dc-warn" title="Chapters are already evenly spaced every ' + esc(r.DetectedIntervalMinutes) + ' min">evenly spaced</span>';
        var act;
        if (r.status === "done") act = '<span class="dc-status-done">\u2713 Done</span> <button type="button" class="dc-linkbtn dc-goto-changed">Changed tab</button>';
        else if (r.status === "busy") act = '<span class="dc-muted">Working\u2026</span>';
        else if (r.CanGenerate === false) act = '<span class="dc-muted dc-small">shorter than one interval</span>';
        else act = '<button type="button" class="dc-btn dc-gen-one" data-id="' + esc(id) + '"' + (F.busy ? " disabled" : "") + ">Generate</button>" +
          (r.status === "error" ? '<div class="dc-status-err">' + esc(r.error) + "</div>" : "");
        return '<tr data-id="' + esc(id) + '" class="' + (F.selected[id] && can ? "dc-sel" : "") + (r.status === "done" ? " dc-done" : "") + '">' +
          '<td class="dc-cb"><input type="checkbox" class="dc-row-cb" data-id="' + esc(id) + '"' + (F.selected[id] && can ? " checked" : "") + (can && !F.busy ? "" : " disabled") + ' aria-label="Select ' + esc(r.Name) + '" /></td>' +
          '<td><div class="dc-movie"><span class="dc-poster"' + (img ? ' style="background-image:url(\'' + esc(img) + '\')"' : "") + '></span><div>' +
            '<a href="' + esc(itemHref(r)) + '" is="emby-linkbutton">' + esc(r.Name || "(unnamed)") + "</a>" +
            (r.ProductionYear ? ' <span class="dc-muted">(' + esc(r.ProductionYear) + ")</span>" : "") + flags + "</div></div></td>" +
          '<td class="dc-num">' + esc(fmtRuntime(r.RunTimeTicks)) + "</td>" +
          '<td class="dc-num">' + esc(r.ChapterCount) + (r.MarkerCount ? ' <span class="dc-muted dc-small" title="intro/credits markers (not counted)">+' + esc(r.MarkerCount) + "m</span>" : "") + "</td>" +
          '<td class="dc-pathcell">' + esc(r.Path || "") + "</td>" +
          '<td class="dc-act">' + act + "</td></tr>";
      }).join("");
      syncFoundButtons();
    }

    function postMany(ids, confirmed) {
      return ApiClient.ajax({ type: "POST", url: api("GenerateMany?Ids=" + ids.map(encodeURIComponent).join(",") + "&Confirmed=" + (confirmed ? "true" : "false")), dataType: "json" });
    }

    function applyResults(res) {
      var changed = 0, failed = 0, ask = [];
      ((res && res.Results) || []).forEach(function (x) {
        var r = F.byId[String(x.Id)];
        if (x.Changed) {
          changed++;
          if (r) { r.status = "done"; r.error = null; r.HasOverride = true; }
          delete F.selected[String(x.Id)];
          if (window.__clawDefaultChapters && window.__clawDefaultChapters.state) window.__clawDefaultChapters.state.ids[String(x.Id)] = true;
        } else if (x.NeedsConfirm) {
          ask.push(x);
          if (r) r.status = null;
        } else {
          failed++;
          if (r) { r.status = "error"; r.error = x.Error || "Failed."; }
        }
      });
      return { changed: changed, failed: failed, ask: ask };
    }

    function intervalText() {
      var v = (S.config && S.config.IntervalMinutes) || (F.result && F.result.IntervalMinutes) || 5;
      return v + " minute" + (v === 1 ? "" : "s");
    }

    function bulkGenerate() {
      var ids = selectedIds();
      if (!ids.length || F.busy) return Promise.resolve();
      var flagged = ids.filter(function (id) { return F.byId[id].NeedsConfirm; }).length;
      var text = "Generate a chapter every " + intervalText() + " for " + ids.length + " selected movie" + (ids.length === 1 ? "" : "s") +
        "? Their current chapters are stashed and can be restored from the Changed tab." +
        (flagged ? " " + flagged + " of them already " + (flagged === 1 ? "has" : "have") + " evenly spaced chapters or an override; " + (flagged === 1 ? "it" : "those") + " will be replaced too." : "");
      return confirmDlg("Generate interval chapters?", text, "Generate").then(function (ok) {
        if (!ok) return;
        F.busy = true;
        ids.forEach(function (id) { F.byId[id].status = "busy"; F.byId[id].error = null; });
        renderFound();
        var total = ids.length, done = 0, changed = 0, failed = 0;
        var chunks = [];
        for (var i = 0; i < ids.length; i += BULK_CHUNK) chunks.push(ids.slice(i, i + BULK_CHUNK));
        function next() {
          if (!chunks.length) return Promise.resolve();
          var chunk = chunks.shift();
          setMsg(".dc-found-msg", "Generating\u2026 " + done + " of " + total);
          return postMany(chunk, true).then(function (res) {
            var a = applyResults(res);
            changed += a.changed; failed += a.failed + a.ask.length;
          }, function (err) {
            return errorText(err).then(function (t) {
              chunk.forEach(function (id) { var r = F.byId[id]; if (r) { r.status = "error"; r.error = t; } });
              failed += chunk.length;
            });
          }).then(function () { done += chunk.length; renderFound(); return next(); });
        }
        return next().then(function () {
          F.busy = false;
          renderFound();
          setMsg(".dc-found-msg", "Generated interval chapters for " + changed + " movie" + (changed === 1 ? "" : "s") + "." +
            (changed ? " They are now listed on the Changed tab." : "") + (failed ? " " + failed + " failed (see the rows)." : ""), failed ? "err" : "ok");
          return loadRows();
        });
      });
    }

    function generateOne(id) {
      var r = F.byId[String(id)];
      if (!r || F.busy || !selectable(r)) return Promise.resolve();
      var ask = r.NeedsConfirm ? confirmDlg("Replace chapters?", r.ConfirmReason || "Replace this movie's chapters?", "Replace") : Promise.resolve(null);
      return ask.then(function (answer) {
        if (answer === false) return;
        r.status = "busy"; r.error = null;
        renderFound();
        return postMany([String(id)], answer === true).then(function (res) {
          var a = applyResults(res);
          if (a.ask.length) {
            return confirmDlg("Replace chapters?", a.ask[0].ConfirmReason, "Replace").then(function (ok) {
              if (!ok) { r.status = null; return; }
              return postMany([String(id)], true).then(applyResults);
            });
          }
        }, function (err) {
          return errorText(err).then(function (t) { r.status = "error"; r.error = t; });
        }).then(function () {
          renderFound();
          if (r.status === "done") {
            setMsg(".dc-found-msg", "Generated interval chapters for \u201C" + (r.Name || id) + "\u201D. It is now listed on the Changed tab.", "ok");
            return loadRows();
          }
        });
      });
    }

    function wireFound() {
      var tabs = view.querySelectorAll(".dc-tab");
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].addEventListener("click", function () { showTab(this.getAttribute("data-tab")); });
      }
      $(".dc-find-form").addEventListener("submit", findMatches);
      var presets = view.querySelectorAll(".dc-preset");
      for (var j = 0; j < presets.length; j++) {
        presets[j].addEventListener("click", function () { $("#dcMinRuntime").value = this.getAttribute("data-min"); });
      }
      var t;
      $(".dc-found-filter").addEventListener("input", function () {
        clearTimeout(t);
        var el = this;
        t = setTimeout(function () { F.filter = el.value || ""; F.page = 0; renderFound(); }, 120);
      });
      ClawColResize.attach(view.querySelector(".dc-found-table"), "claw.defaultchapters.cols.found");
      view.querySelector(".dc-found-table thead").addEventListener("click", function (e) {
        var th = e.target.closest && e.target.closest("th[data-fsort]");
        if (!th) return;
        var k = th.getAttribute("data-fsort");
        if (F.sort === k) F.dir = -F.dir;
        else { F.sort = k; F.dir = (k === "name" || k === "path") ? 1 : -1; }
        renderFound();
      });
      $(".dc-page-cb").addEventListener("change", function () {
        var on = this.checked;
        pageRows(foundVisible()).rows.filter(selectable).forEach(function (r) { if (on) F.selected[String(r.Id)] = true; else delete F.selected[String(r.Id)]; });
        renderFound();
      });
      $(".dc-found-rows").addEventListener("change", function (e) {
        var c = e.target.closest && e.target.closest(".dc-row-cb");
        if (!c) return;
        var id = c.getAttribute("data-id");
        if (c.checked) F.selected[id] = true; else delete F.selected[id];
        renderFound();
      });
      $(".dc-found-rows").addEventListener("click", function (e) {
        var g = e.target.closest && e.target.closest(".dc-gen-one");
        if (g) { generateOne(g.getAttribute("data-id")); return; }
        if (e.target.closest && e.target.closest(".dc-goto-changed")) showTab("changed");
      });
      $(".dc-select-all").addEventListener("click", function () {
        foundVisible().filter(selectable).forEach(function (r) { F.selected[String(r.Id)] = true; });
        renderFound();
      });
      $(".dc-select-none").addEventListener("click", function () { F.selected = {}; renderFound(); });
      $(".dc-bulk").addEventListener("click", bulkGenerate);
      $(".dc-prev").addEventListener("click", function () { F.page--; renderFound(); });
      $(".dc-next").addEventListener("click", function () { F.page++; renderFound(); });
    }

    wire();
    wireFound();
    render();
    renderFound();
    view.addEventListener("viewshow", function () { loadAll(); });

    // Exposed for offline testing only.
    view._defaultChapters = { state: S, found: F, render: render, renderFound: renderFound, revert: revert, loadAll: loadAll, saveConfig: saveConfig,
      visibleRows: visibleRows, foundVisible: foundVisible, findMatches: findMatches, bulkGenerate: bulkGenerate, generateOne: generateOne, showTab: showTab };
  }

  return View;
});
