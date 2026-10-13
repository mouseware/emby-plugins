/* IPTV Channel Mapper - Emby dashboard page controller.
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


  var PLUGIN_ID = "e5b612ae-cad5-47e9-8fb3-27a029c220d3";
  var MAX_SNAPSHOTS = 10;
  var MAX_UNDO = 500;
  var MAX_COMBO_RESULTS = 150;
  var FIELDS = ["number", "name", "group", "logo", "guide", "enabled"];
  var FIELD_LABELS = { number: "channel number", name: "name", group: "group", logo: "logo", guide: "guide mapping", enabled: "enabled" };
  var COPY_PREFIX = "copy:"; // logo value "copy:<itemId>" = copy that channel's Primary image
  var DUMMY_TYPE = "clawdummy";   // "Channel Name Guide" listings provider shipped in this plugin (v1.3)
  var DUMMY_NAME = "Channel Name Guide";
  var DUMMY_PREFIX = "cng_";      // its guide channel id = "cng_" + tuner channel management id
  var UPLOAD_PREFIX = "upload:"; // logo value "upload:<uploadId>" = image file from this browser (data kept in memory only)
  var UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
  var UPLOAD_MAX_DIM = 2048;   // larger images are downscaled (longest edge)
  var SVG_MIN_DIM = 512;       // vector images are rasterized to at least this size (longest edge)
  var UPLOAD_TYPES = { "image/png": 1, "image/jpeg": 1, "image/webp": 1, "image/gif": 1, "image/svg+xml": 1 };
  var EXT_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };

  // ---------------------------------------------------------------- utilities
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function str(v) { return v == null ? "" : String(v); }
  var LETTER_RE = null;
  try { LETTER_RE = new RegExp("[^\\p{L}\\p{Nd}]+", "gu"); } catch (e) { LETTER_RE = /[^a-z0-9\u00c0-\uffff]+/g; }
  function normName(s) {
    s = str(s);
    try { s = s.normalize("NFKC"); } catch (e) { /* old browser */ }
    return s.toLowerCase().replace(LETTER_RE, "");
  }
  function buildKey(tunerHostId, tvgId, name) {
    if (tvgId && String(tvgId).trim()) return tunerHostId + "|tvg:" + String(tvgId).trim().toLowerCase();
    return tunerHostId + "|name:" + normName(name);
  }
  function naturalCompare(a, b) {
    a = str(a); b = str(b);
    if (a === b) return 0;
    if (a === "") return 1;
    if (b === "") return -1;
    var na = parseFloat(a), nb = parseFloat(b);
    var ia = !isNaN(na) && /^\s*[\d.]/.test(a), ib = !isNaN(nb) && /^\s*[\d.]/.test(b);
    if (ia && ib && na !== nb) return na - nb;
    if (ia !== ib) return ia ? -1 : 1;
    return a.toLowerCase() < b.toLowerCase() ? -1 : (a.toLowerCase() > b.toLowerCase() ? 1 : 0);
  }
  function guideEq(a, b) { return str(a && a.p) === str(b && b.p) && str(a && a.c) === str(b && b.c); }
  function valEq(field, a, b) { return field === "guide" ? guideEq(a, b) : (field === "enabled" ? !!a === !!b : str(a) === str(b)); }
  function cloneVal(field, v) { return field === "guide" ? { p: str(v && v.p), c: str(v && v.c) } : v; }
  function encodeVal(field, v) {
    if (field === "guide") return str(v && v.p) + "|" + str(v && v.c);
    if (field === "enabled") return v ? "true" : "false";
    return str(v);
  }
  function decodeVal(field, s) {
    if (field === "guide") { s = str(s); var i = s.indexOf("|"); return i < 0 ? { p: s, c: "" } : { p: s.substring(0, i), c: s.substring(i + 1) }; }
    if (field === "enabled") return s === true || s === "true";
    return str(s);
  }
  function isHttpUrl(u) { return /^https?:\/\/[^\s]+$/i.test(str(u).trim()); }
  function nowIso() { return new Date().toISOString(); }

  /** Fuzzy score: every query token must match as substring (strong) or subsequence (weak). -1 = no match. */
  function fuzzyScore(tokens, text) {
    var total = 0;
    for (var t = 0; t < tokens.length; t++) {
      var tok = tokens[t];
      var i = text.indexOf(tok);
      if (i >= 0) {
        var s = 100 - Math.min(i, 60);
        if (i === 0 || /[^a-z0-9]/.test(text.charAt(i - 1))) s += 60;
        if (text.length === tok.length) s += 80;
        total += s;
        continue;
      }
      var pos = -1, gaps = 0;
      for (var k = 0; k < tok.length; k++) {
        var n = text.indexOf(tok.charAt(k), pos + 1);
        if (n < 0) return -1;
        if (pos >= 0) gaps += n - pos - 1;
        pos = n;
      }
      if (gaps > tok.length * 4 + 6) return -1;
      total += Math.max(2, 40 - gaps * 2);
    }
    return total;
  }
  function highlight(text, tokens) {
    if (!tokens.length) return esc(text);
    var lower = text.toLowerCase(), marks = [];
    tokens.forEach(function (tok) {
      var i = lower.indexOf(tok);
      if (i >= 0) marks.push([i, i + tok.length]);
    });
    if (!marks.length) return esc(text);
    marks.sort(function (a, b) { return a[0] - b[0]; });
    var out = "", last = 0;
    marks.forEach(function (m) {
      if (m[0] < last) return;
      out += esc(text.substring(last, m[0])) + "<mark>" + esc(text.substring(m[0], m[1])) + "</mark>";
      last = m[1];
    });
    return out + esc(text.substring(last));
  }

  // ---------------------------------------------------------------- Emby glue
  function showLoading() { try { Dashboard.showLoadingMsg(); } catch (e) { /* ignore */ } }
  function hideLoading() { try { Dashboard.hideLoadingMsg(); } catch (e) { /* ignore */ } }
  function toast(msg) {
    try {
      require(["toast"], function (t) {
        try { var fn = (t && t.default) || t; fn({ text: msg }); } catch (e2) { try { ((t && t.default) || t)(msg); } catch (e3) { console.log("[IptvMapper] " + msg); } }
      }, function () { console.log("[IptvMapper] " + msg); });
    } catch (e) { console.log("[IptvMapper] " + msg); }
  }
  function apiUrl(path, query) { return ApiClient.getUrl(path, query || {}); }
  function apiGet(path, query) { return ApiClient.getJSON(apiUrl(path, query)); }
  function apiPost(path, query, body, contentType) {
    var req = { type: "POST", url: apiUrl(path, query) };
    if (body != null) { req.data = body; req.contentType = contentType || "application/json"; }
    else { req.contentType = "application/json"; }
    return ApiClient.ajax(req);
  }
  function formEncode(obj) {
    return Object.keys(obj).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(str(obj[k])); }).join("&");
  }
  /** Turns a rejected fetch/ajax value into a readable message (never includes tokens). */
  function errorText(err) {
    return new Promise(function (resolve) {
      if (!err) return resolve("Unknown error");
      if (typeof err === "string") return resolve(err);
      if (err.message && !err.status) return resolve(err.message);
      var base = "HTTP " + (err.status || "?") + (err.statusText ? " " + err.statusText : "");
      if (typeof err.text === "function") {
        try {
          err.text().then(function (t) { resolve(base + (t ? ": " + String(t).substring(0, 200) : "")); }, function () { resolve(base); });
        } catch (e) { resolve(base); }
      } else resolve(base);
    });
  }
  function currentUserId() {
    try { if (ApiClient.getCurrentUserId) return ApiClient.getCurrentUserId(); } catch (e) { /* ignore */ }
    try { return ApiClient._currentUser && ApiClient._currentUser.Id; } catch (e2) { return null; }
  }

  // ---------------------------------------------------------------- controller
  function View(view, params) {
    var $ = function (sel) { return view.querySelector(sel); };
    var S = {
      mode: "server",          // "server" = plugin REST endpoint; "fallback" = official LiveTv endpoints only
      rows: [], byKey: {},
      providers: [], providerById: {},
      options: {},             // providerId -> { state: loading|ready|error, list, byId, error, promise }
      config: null,
      undo: [], redo: [],
      sort: { col: "", dir: 1 },
      saving: false,
      loaded: false,
      tunerNames: {},
      visible: [],
      selected: {},            // key -> true (row checkboxes for bulk actions; not part of undo)
      byItemId: {},
      uploads: {},             // uploadId -> { name, type, b64, url, w, h, bytes, note } (memory only, never stored in the plugin config)
      uploadSeq: 0,
      dummyPid: "",            // configured Channel Name Guide provider id ("" = not configured)
      dummyAvailable: false    // provider type registered on the server (plugin >= 1.3 loaded)
    };
    var combo = { open: false, mode: "guide", row: null, providerId: "", active: 0, results: [], onPick: null, exclude: {} };
    var logoDlg = { row: null, copySrc: null, upload: "" };

    // ------------------------------------------------------------ data load
    function loadAll(reapply) {
      showLoading();
      S.loaded = false;
      var pServer = apiGet("IptvMapper/Channels").then(function (r) { return r; }, function () { return null; });
      var pManage = apiGet("LiveTv/Manage/Channels", { SortBy: "DefaultChannelOrder" });
      var pProviders = apiGet("LiveTv/ListingProviders").then(null, function () { return []; });
      var pConfig = ApiClient.getPluginConfiguration(PLUGIN_ID).then(null, function () { return {}; });
      // Current item Tags (= effective group). Works with every server version and in fallback mode.
      var pTags = apiGet("Items", { IncludeItemTypes: "TvChannel", Recursive: true, Fields: "Tags" }) /* ItemFields.Tags -> TagItems */.then(null, function () { return null; });
      var pTypes = apiGet("LiveTv/ListingProviders/Available").then(null, function () { return []; });
      return Promise.all([pServer, pManage, pProviders, pConfig, pTags, pTypes]).then(function (res) {
        S.dummyAvailable = (res[5] || []).some(function (t) { return t && str(t.Id).toLowerCase() === DUMMY_TYPE; });
        S.config = normalizeConfig(res[3]);
        setProviders(res[2] || []);
        var tagMap = null;
        if (res[4] && res[4].Items) {
          tagMap = {};
          res[4].Items.forEach(function (it) { tagMap[it.Id] = (it.TagItems || []).map(function (t) { return t.Name; }).filter(Boolean); });
        }
        buildRows(res[0], res[1], tagMap);
        S.undo = []; S.redo = [];
        if (reapply && reapply.length) reapplyEdits(reapply);
        S.loaded = true;
        renderFilterOptions();
        renderAll();
        preloadOptions();
        hideLoading();
      }, function (err) {
        hideLoading();
        errorText(err).then(function (msg) {
          $(".iptvm-tbody").innerHTML = '<tr><td colspan="11" class="iptvm-empty">Failed to load channels: ' + esc(msg) + "</td></tr>";
        });
      });
    }

    function normalizeConfig(c) {
      c = c || {};
      c.Overrides = c.Overrides || [];
      c.Snapshots = c.Snapshots || [];
      c.MaxSnapshots = c.MaxSnapshots || MAX_SNAPSHOTS;
      c.SchemaVersion = c.SchemaVersion || 1;
      return c;
    }

    function setProviders(list) {
      S.providers = [];
      S.providerById = {};
      var nameCount = {};
      list.forEach(function (p) { nameCount[p.Name] = (nameCount[p.Name] || 0) + 1; });
      list.forEach(function (p) {
        var label = p.Name || p.Type || p.Id;
        var extra = p.ListingsId || (p.Path ? String(p.Path).split(/[\\/]/).pop() : "") || "";
        // Several "Emby Guide Data" providers: lead with the lineup so it stays visible in narrow dropdowns.
        if (extra && nameCount[p.Name] > 1) label = extra + " \u00b7 " + label;
        else if (extra) label += " (" + extra + ")";
        var info = { id: p.Id, type: p.Type, label: label, short: p.ListingsId || label, dummy: str(p.Type).toLowerCase() === DUMMY_TYPE };
        if (info.dummy) { info.label = DUMMY_NAME; info.short = "Name guide"; }
        S.providers.push(info);
        S.providerById[p.Id] = info;
      });
      var d = S.providers.filter(function (x) { return x.dummy; })[0];
      S.dummyPid = d ? d.id : "";
    }

    function buildRows(server, manage, tagMap) {
      var manageItems = (manage && manage.Items) || [];
      var byMgmt = {};
      manageItems.forEach(function (m, idx) { m._idx = idx; if (m.ManagementId) byMgmt[m.ManagementId] = m; });
      var rows = [];
      if (server && server.Rows && server.Rows.length) {
        S.mode = "server";
        S.serverWarnings = (server.Warnings || []).concat((server.Tuners || []).filter(function (t) { return t.CacheError; }).map(function (t) { return t.Name + ": " + t.CacheError; }));
        server.Rows.forEach(function (r) {
          var m = byMgmt[r.ManagementId] || null;
          rows.push(makeRow({
            key: r.Key, itemId: (m && m.Id) || r.ItemId, managementId: r.ManagementId, tunerHostId: r.TunerHostId,
            tunerName: r.TunerName || (m && m.TunerName), tvgId: r.TvgId, m3uName: r.M3uName, m3uNumber: r.M3uNumber,
            m3uGroup: r.M3uGroup, m3uLogoUrl: r.M3uLogoUrl, name: r.Name, number: r.ChannelNumber,
            m3uTags: r.M3uTags || (r.M3uGroup ? String(r.M3uGroup).split(", ") : []),
            itemTags: r.ItemTags || (tagMap && tagMap[(m && m.Id) || r.ItemId]) || null,
            lockedFields: r.LockedFields || [], primaryTag: (m && m.ImageTags && m.ImageTags.Primary) || r.PrimaryImageTag,
            disabled: m ? !!m.Disabled : !!r.Disabled, sortIndex: m && m.SortIndexNumber != null ? m.SortIndexNumber : r.SortIndex,
            inLibrary: m ? !m.Disabled : !!r.InLibrary,
            explicitKnown: true, hasOptions: !!r.HasChannelOptions,
            explicitP: r.ListingsProviderId, explicitC: r.ListingsChannelId, manage: m
          }));
        });
      } else {
        S.mode = "fallback";
        S.serverWarnings = [];
        var counts = {};
        manageItems.forEach(function (m) {
          var tid = str(m.ManagementId).split("_")[0];
          var key = buildKey(tid, null, m.Name);
          counts[key] = (counts[key] || 0) + 1;
          if (counts[key] > 1) key += "#" + counts[key];
          rows.push(makeRow({
            key: key, itemId: m.Id, managementId: m.ManagementId, tunerHostId: tid, tunerName: m.TunerName,
            tvgId: "", m3uName: "", m3uNumber: "", m3uGroup: "", m3uLogoUrl: "", name: m.Name, number: m.ChannelNumber,
            m3uTags: [], itemTags: (tagMap && tagMap[m.Id]) || null,
            lockedFields: null, primaryTag: m.ImageTags && m.ImageTags.Primary, disabled: !!m.Disabled,
            sortIndex: m.SortIndexNumber != null ? m.SortIndexNumber : m._idx, inLibrary: !m.Disabled,
            explicitKnown: false, manage: m
          }));
        });
      }
      // Disambiguate identical tuner names ("M3U", "M3U") with a short id.
      var tn = {};
      rows.forEach(function (r) { tn[r.tunerName] = tn[r.tunerName] || {}; tn[r.tunerName][r.tunerHostId] = 1; });
      rows.forEach(function (r) {
        if (Object.keys(tn[r.tunerName] || {}).length > 1) r.tunerName = r.tunerName + " \u00b7 " + str(r.tunerHostId).substring(0, 4);
        S.tunerNames[r.tunerHostId] = r.tunerName;
      });
      S.rows = rows;
      S.byKey = {};
      S.byItemId = {};
      rows.forEach(function (r) { S.byKey[r.key] = r; if (r.itemId) S.byItemId[r.itemId] = r; });
      Object.keys(S.selected).forEach(function (k) { if (!S.byKey[k]) delete S.selected[k]; });
      var ov = {};
      S.config.Overrides.forEach(function (o) { if (o && o.Key) ov[o.Key] = o; });
      rows.forEach(function (r) { r.override = ov[r.key] || null; });
      renderBanners();
    }

    function makeRow(d) {
      var m = d.manage;
      var r = {
        key: d.key, itemId: str(d.itemId), managementId: str(d.managementId), tunerHostId: str(d.tunerHostId),
        tunerName: str(d.tunerName) || "Tuner", tvgId: str(d.tvgId), m3uName: str(d.m3uName), m3uNumber: str(d.m3uNumber),
        m3uGroup: str(d.m3uGroup), m3uLogoUrl: str(d.m3uLogoUrl), lockedFields: d.lockedFields,
        m3uTags: d.m3uTags || [], itemTags: d.itemTags,
        primaryTag: d.primaryTag || "", sortIndex: d.sortIndex || 0, inLibrary: !!d.inLibrary,
        effP: (m && m.ListingsProviderId) || "", effC: (m && m.ListingsChannelId) || "",
        effName: m ? [m.ListingsChannelNumber, m.ListingsChannelName].filter(Boolean).join(" ") : "",
        errors: {}
      };
      var guide;
      if (d.explicitKnown) {
        guide = d.explicitP != null && d.explicitP !== "" ? { p: str(d.explicitP), c: str(d.explicitC) } : { p: "", c: "" };
      } else {
        guide = r.effP ? { p: r.effP, c: r.effC } : { p: "", c: "" };
      }
      // Effective group = the item's current Tags (custom or from M3U group-title); M3U value when the item is missing.
      var group = d.itemTags && (d.itemTags.length || r.inLibrary) ? d.itemTags.join(", ") : str(d.m3uGroup);
      r.orig = { number: str(d.number), name: str(d.name), group: group, logo: "", guide: guide, enabled: !d.disabled };
      r.cur = { number: r.orig.number, name: r.orig.name, group: group, logo: "", guide: cloneVal("guide", guide), enabled: r.orig.enabled };
      return r;
    }

    function renderBanners() {
      var b = $(".iptvm-mode-banner");
      var msgs = [];
      if (S.mode === "fallback") {
        msgs.push("Server endpoint <code>IptvMapper/Channels</code> is not available, so this page uses Emby's built-in endpoints only. " +
          "tvg-id, the original M3U group, M3U name/number and M3U logos are missing, and overrides are keyed by channel name.");
      }
      (S.serverWarnings || []).forEach(function (w) { msgs.push(esc(w)); });
      b.innerHTML = msgs.join("<br/>");
      b.classList.toggle("iptvm-show", msgs.length > 0);
    }

    // ------------------------------------------------------------ guide options cache
    function loadOptions(pid) {
      if (!pid || pid === "none") return Promise.resolve(null);
      var o = S.options[pid];
      if (o && o.promise) return o.promise;
      o = S.options[pid] = { state: "loading", list: [], byId: {}, error: "" };
      o.promise = apiGet("LiveTv/ChannelMappingOptions", { ProviderId: pid }).then(function (res) {
        var list = (res && res.ProviderChannels) || [];
        o.list = list.map(function (x) { return { id: str(x.Id), name: str(x.Name) || str(x.Id), lc: (str(x.Name) + " " + str(x.Id)).toLowerCase() }; });
        o.list.forEach(function (x) { o.byId[x.id] = x; });
        o.state = "ready";
        return o;
      }, function (err) {
        o.state = "error";
        return errorText(err).then(function (msg) { o.error = msg; renderProviderErrors(); return o; });
      });
      return o.promise;
    }
    function preloadOptions() {
      var ids = S.providers.map(function (p) { return p.id; });
      ids.reduce(function (chain, pid) {
        return chain.then(function () { return loadOptions(pid).then(function () { refreshAllRowsLight(); }); });
      }, Promise.resolve());
    }
    function renderProviderErrors() {
      var errs = [];
      Object.keys(S.options).forEach(function (pid) {
        var o = S.options[pid];
        if (o.state === "error") errs.push(esc(providerLabel(pid)) + ": " + esc(o.error));
      });
      var b = $(".iptvm-provider-banner");
      b.innerHTML = errs.length ? "Guide provider errors (other providers still work):<br/>" + errs.join("<br/>") : "";
      b.classList.toggle("iptvm-show", errs.length > 0);
    }
    function isDummyPid(pid) { return !!pid && !!S.providerById[pid] && S.providerById[pid].dummy; }
    function dummyChannelId(r) { return r.managementId ? DUMMY_PREFIX + r.managementId : ""; }
    function dummyLabel(r) { return "Name guide \u00b7 " + (r.m3uName || r.cur.name || r.orig.name); }
    function providerLabel(pid) {
      if (!pid) return "Auto";
      if (pid === "none") return "None";
      return (S.providerById[pid] && S.providerById[pid].label) || ("Unknown provider " + pid.substring(0, 6));
    }

    // ------------------------------------------------------------ derived state
    /** Effective guide identity "pid|cid" used for conflict detection, or "" when unmapped. */
    function mapIdentity(r) {
      if (!r.cur.enabled) return "";
      var g = r.cur.guide;
      if (guideEq(g, r.orig.guide)) {
        if (g.p === "none") return "";
        return r.effP && r.effC ? r.effP + "|" + r.effC : "";
      }
      return g.p && g.p !== "none" && g.c ? g.p + "|" + g.c : "";
    }
    function guidePendingAuto(r) { return r.cur.guide.p === "" && !guideEq(r.cur.guide, r.orig.guide); }

    function computeStatuses() {
      var ident = {}, nums = {};
      S.rows.forEach(function (r) {
        r._id = mapIdentity(r);
        if (r._id) (ident[r._id] = ident[r._id] || []).push(r);
        var n = str(r.cur.number).trim();
        if (r.cur.enabled && n) (nums[n] = nums[n] || []).push(r);
      });
      S.identUse = ident;
      S.rows.forEach(function (r) {
        var st = [];
        if (!r.cur.enabled) st.push("disabled");
        else {
          if (r._id && ident[r._id].length > 1) st.push("conflict");
          var n = str(r.cur.number).trim();
          if (n && nums[n].length > 1) st.push("dupnum");
          if (r._id) st.push("mapped"); else st.push(guidePendingAuto(r) ? "auto" : "unmapped");
        }
        if (Object.keys(r.errors).length) st.push("error");
        r.status = st;
        r.statusRank = st.indexOf("conflict") >= 0 ? 0 : st.indexOf("dupnum") >= 0 ? 1 : st.indexOf("unmapped") >= 0 ? 2 : st.indexOf("auto") >= 0 ? 3 : st.indexOf("mapped") >= 0 ? 4 : 5;
      });
    }

    function changedFields(r) {
      var out = [];
      FIELDS.forEach(function (f) { if (!valEq(f, r.cur[f], r.orig[f])) out.push(f); });
      return out;
    }
    function pendingCount() {
      var n = 0;
      S.rows.forEach(function (r) { n += changedFields(r).length; });
      return n;
    }

    function guideChannelLabel(r) {
      var g = r.cur.guide;
      if (g.p === "none") return "\u2014 no guide \u2014";
      var unchanged = guideEq(g, r.orig.guide);
      if (g.p && g.c && isDummyPid(g.p)) return dummyLabel(r);
      if (g.p && g.c) {
        var o = S.options[g.p];
        if (o && o.byId[g.c]) return o.byId[g.c].name;
        if (unchanged && r.effC === g.c && r.effName) return r.effName;
        return g.c;
      }
      if (unchanged && r.effC && isDummyPid(r.effP)) return dummyLabel(r);
      if (unchanged && r.effC) {
        var o2 = S.options[r.effP];
        return (o2 && o2.byId[r.effC] && o2.byId[r.effC].name) || r.effName || r.effC;
      }
      if (g.p === "" && !unchanged) return "auto-match after refresh";
      return "";
    }
    function sourceHint(r) {
      var g = r.cur.guide;
      if (g.p === "" && guideEq(g, r.orig.guide) && r.effP) return "auto \u2192 " + ((S.providerById[r.effP] && S.providerById[r.effP].short) || "?");
      return "";
    }

    // ------------------------------------------------------------ filters / sort
    function renderFilterOptions() {
      var tunerSel = $(".iptvm-f-tuner"), groupSel = $(".iptvm-f-group"), srcSel = $(".iptvm-f-source");
      var keepT = tunerSel.value, keepG = groupSel.value, keepS = srcSel.value;
      var tuners = {}, groups = {};
      S.rows.forEach(function (r) { tuners[r.tunerHostId] = r.tunerName; if (r.cur.group) groups[r.cur.group] = (groups[r.cur.group] || 0) + 1; });
      tunerSel.innerHTML = '<option value="">All tuners</option>' + Object.keys(tuners).map(function (id) {
        return '<option value="' + esc(id) + '">' + esc(tuners[id]) + "</option>";
      }).join("");
      var gk = Object.keys(groups).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
      groupSel.innerHTML = '<option value="">All groups</option><option value="__none__">(no group)</option>' +
        gk.map(function (g) { return '<option value="' + esc(g) + '">' + esc(g) + " (" + groups[g] + ")</option>"; }).join("");
      srcSel.innerHTML = '<option value="">All guide sources</option><option value="__auto__">Auto</option><option value="none">None</option>' +
        S.providers.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.label) + "</option>"; }).join("");
      tunerSel.value = keepT; groupSel.value = keepG; srcSel.value = keepS;
      if (tunerSel.value !== keepT) tunerSel.value = "";
      if (groupSel.value !== keepG) groupSel.value = "";
      if (srcSel.value !== keepS) srcSel.value = "";
    }

    function getFilters() {
      return {
        q: $(".iptvm-f-search").value.trim().toLowerCase(),
        tuner: $(".iptvm-f-tuner").value,
        group: $(".iptvm-f-group").value,
        source: $(".iptvm-f-source").value,
        status: $(".iptvm-f-status").value
      };
    }
    function rowMatches(r, f) {
      if (f.tuner && r.tunerHostId !== f.tuner) return false;
      if (f.group) { if (f.group === "__none__" ? !!r.cur.group : r.cur.group !== f.group) return false; }
      if (f.source) {
        var g = r.cur.guide;
        if (f.source === "__auto__") { if (g.p !== "") return false; }
        else if (f.source === "none") { if (g.p !== "none") return false; }
        else if (!(g.p === f.source || (g.p === "" && guideEq(g, r.orig.guide) && r.effP === f.source))) return false;
      }
      if (f.status) {
        if (f.status === "changed") { if (!changedFields(r).length) return false; }
        else if (f.status === "unmapped") { if (r.status.indexOf("unmapped") < 0 && r.status.indexOf("auto") < 0) return false; }
        // Logo filters use the CURRENT Emby state (Primary image tag), so rows don't vanish while logo edits are pending.
        else if (f.status === "nologo") { if (!r.inLibrary || r.primaryTag) return false; }
        else if (f.status === "haslogo") { if (!r.inLibrary || !r.primaryTag) return false; }
        else if (r.status.indexOf(f.status) < 0) return false;
      }
      if (f.q) {
        var hay = [r.cur.name, r.orig.name, r.m3uName, r.cur.number, r.m3uNumber, r.tvgId, r.cur.group, r.m3uGroup, r.tunerName, guideChannelLabel(r)].join(" \u0001 ").toLowerCase();
        var toks = f.q.split(/\s+/);
        for (var i = 0; i < toks.length; i++) if (hay.indexOf(toks[i]) < 0) return false;
      }
      return true;
    }
    function sortValue(r, col) {
      switch (col) {
        case "number": return r.cur.number;
        case "name": return r.cur.name;
        case "tuner": return r.tunerName;
        case "group": return r.cur.group;
        case "source": return r.cur.guide.p === "" ? "~auto " + sourceHint(r) : providerLabel(r.cur.guide.p);
        case "channel": return guideChannelLabel(r);
        case "status": return r.statusRank;
        case "enabled": return r.cur.enabled ? 0 : 1;
        default: return r.sortIndex;
      }
    }
    function visibleRows() {
      var f = getFilters();
      var list = S.rows.filter(function (r) { return rowMatches(r, f); });
      var col = S.sort.col, dir = S.sort.dir;
      list.sort(function (a, b) {
        var c;
        if (!col) c = a.sortIndex - b.sortIndex;
        else {
          var va = sortValue(a, col), vb = sortValue(b, col);
          var ea = va === "" || va == null, eb = vb === "" || vb == null;
          if (ea !== eb) return ea ? 1 : -1; // blanks always last
          c = typeof va === "number" && typeof vb === "number" ? va - vb : naturalCompare(va, vb);
          if (c === 0) return a.sortIndex - b.sortIndex;
        }
        return c * (col ? dir : 1);
      });
      return list;
    }

    // ------------------------------------------------------------ rendering
    function uploadOf(v) {
      return v && v.indexOf(UPLOAD_PREFIX) === 0 ? (S.uploads[v.substring(UPLOAD_PREFIX.length)] || null) : null;
    }
    function isPendingImageValue(v) { return !!v && (v.indexOf(COPY_PREFIX) === 0 || v.indexOf(UPLOAD_PREFIX) === 0); }
    function logoCopySource(v) {
      return v && v.indexOf(COPY_PREFIX) === 0 ? (S.byItemId[v.substring(COPY_PREFIX.length)] || null) : null;
    }
    function primaryUrl(r, maxHeight) {
      return r && r.inLibrary && r.primaryTag && r.itemId ? apiUrl("Items/" + r.itemId + "/Images/Primary", maxHeight ? { maxHeight: maxHeight, tag: r.primaryTag } : { tag: r.primaryTag }) : "";
    }
    function logoValueLabel(v) {
      if (!v) return "";
      var src = logoCopySource(v);
      if (v.indexOf(COPY_PREFIX) === 0) return "copy from " + (src ? rowLabel(src) : "item " + v.substring(COPY_PREFIX.length));
      if (v.indexOf(UPLOAD_PREFIX) === 0) { var u = uploadOf(v); return "upload " + (u ? u.name + " (" + u.w + "\u00d7" + u.h + ")" : "(file no longer in memory)"); }
      return v;
    }
    function imageUrlFor(r) {
      if (r.cur.logo && r.cur.logo.indexOf(COPY_PREFIX) === 0) return primaryUrl(logoCopySource(r.cur.logo), 40);
      if (r.cur.logo && r.cur.logo.indexOf(UPLOAD_PREFIX) === 0) { var up = uploadOf(r.cur.logo); return up ? up.url : ""; }
      if (r.cur.logo) return r.cur.logo;
      if (r.inLibrary && r.primaryTag && r.itemId) return apiUrl("Items/" + r.itemId + "/Images/Primary", { maxHeight: 40, tag: r.primaryTag });
      return r.m3uLogoUrl || "";
    }
    function rowHtml(r) {
      var ch = {};
      changedFields(r).forEach(function (f) { ch[f] = 1; });
      var dis = !r.cur.enabled || !r.inLibrary;
      var disTitle = dis ? ' title="Channel is disabled in Emby; enable it, save, and wait for the channel refresh before editing."' : "";
      var img = imageUrlFor(r);
      var initials = esc((r.cur.name || "?").substring(0, 10));
      var logoHtml = img ? '<img loading="lazy" alt="" src="' + esc(img) + '" data-fallback="' + esc(r.cur.logo ? "" : r.m3uLogoUrl) + '"/>' : "<span>" + initials + "</span>";
      var logoTitle = dis ? "Disabled" : (r.cur.logo ? "Pending: " + logoValueLabel(r.cur.logo) : "Click to set a logo URL, upload an image or copy another channel's logo");
      var groupSub = r.m3uGroup && r.m3uGroup !== r.cur.group ? '<div class="iptvm-sub" title="M3U group-title">' + esc(r.m3uGroup) + "</div>" : "";
      var groupLabel = r.cur.group ? esc(r.cur.group) : '<span class="iptvm-muted">(no group)</span>';
      var sub = r.m3uName && r.m3uName !== r.cur.name ? '<div class="iptvm-sub" title="M3U name">' + esc(r.m3uName) + "</div>" : "";
      var numSub = r.m3uNumber && r.m3uNumber !== r.cur.number ? '<div class="iptvm-sub" title="M3U number">' + esc(r.m3uNumber) + "</div>" : "";
      var g = r.cur.guide;
      var srcOpts = '<option value="">Auto</option><option value="none">None</option>';
      var known = g.p === "" || g.p === "none";
      S.providers.forEach(function (p) {
        if (p.id === g.p) known = true;
        srcOpts += '<option value="' + esc(p.id) + '"' + (p.id === g.p ? " selected" : "") + ">" + esc(p.label) + "</option>";
      });
      if (!known) srcOpts += '<option value="' + esc(g.p) + '" selected>' + esc(providerLabel(g.p)) + "</option>";
      if (g.p === "") srcOpts = srcOpts.replace('<option value="">', '<option value="" selected>');
      else if (g.p === "none") srcOpts = srcOpts.replace('<option value="none">', '<option value="none" selected>');
      var hint = sourceHint(r);
      var chLabel = guideChannelLabel(r);
      var chProvider = g.p && g.p !== "none" ? g.p : (g.p === "" ? r.effP : "");
      var chDisabled = !chProvider || !r.cur.enabled;
      var autoMuted = g.p === "" && chLabel ? " iptvm-muted" : "";
      var chips = r.status.map(function (s) {
        var t = { mapped: "Mapped", unmapped: "Unmapped", conflict: "Conflict", dupnum: "Duplicate #", disabled: "Disabled", auto: "Auto (pending)", error: "Save error" }[s];
        var title = s === "conflict" ? ' title="Another enabled channel is mapped to the same guide channel"' : s === "error" ? ' title="' + esc(Object.keys(r.errors).map(function (k) { return FIELD_LABELS[k] + ": " + r.errors[k]; }).join("; ")) + '"' : "";
        return '<span class="iptvm-chip iptvm-chip-' + s + '"' + title + ">" + t + "</span>";
      }).join("");
      var ovTitle = r.override ? " \u00b7 saved override " + str(r.override.UpdatedUtc).substring(0, 10) : "";
      var cls = (ch.number || ch.name || ch.group || ch.logo || ch.guide || ch.enabled ? " iptvm-row-changed" : "") + (!r.cur.enabled ? " iptvm-row-disabled" : "") + (Object.keys(r.errors).length ? " iptvm-row-error" : "");
      return '<tr data-key="' + esc(r.key) + '" class="' + cls + (S.selected[r.key] ? " iptvm-row-selected" : "") + '">' +
        '<td class="iptvm-c-sel"><input type="checkbox" data-act="select" title="Select for bulk actions"' + (S.selected[r.key] ? " checked" : "") + "/></td>" +
        '<td class="iptvm-c-logo' + (ch.logo ? " iptvm-changed" : "") + '"><div class="iptvm-logo" data-act="logo" title="' + esc(logoTitle) + '">' + logoHtml + "</div></td>" +
        '<td class="iptvm-c-num' + (ch.number ? " iptvm-changed" : "") + '"><input class="iptvm-in" data-field="number" value="' + esc(r.cur.number) + '" data-committed="' + esc(r.cur.number) + '"' + (dis ? " readonly" + disTitle : "") + "/>" + numSub + "</td>" +
        '<td class="iptvm-c-name' + (ch.name ? " iptvm-changed" : "") + '"><input class="iptvm-in" data-field="name" value="' + esc(r.cur.name) + '" data-committed="' + esc(r.cur.name) + '"' + (dis ? " readonly" + disTitle : "") + "/>" + sub + "</td>" +
        '<td class="iptvm-c-tuner" title="' + esc(r.tunerHostId) + ovTitle + '">' + esc(r.tunerName) + (r.tvgId ? '<div class="iptvm-sub" title="tvg-id">' + esc(r.tvgId) + "</div>" : "") + "</td>" +
        '<td class="iptvm-c-group' + (ch.group ? " iptvm-changed" : "") + '"><button type="button" class="iptvm-chbtn iptvm-grpbtn" data-act="group"' + (dis ? " disabled" + disTitle : "") + ' title="' + esc(r.cur.group) + '">' + groupLabel + "</button>" + groupSub + "</td>" +
        '<td class="iptvm-c-src' + (ch.guide ? " iptvm-changed" : "") + '"><select data-field="source"' + (!r.cur.enabled ? " disabled" : "") + ">" + srcOpts + "</select>" + (hint ? '<div class="iptvm-sub">' + esc(hint) + "</div>" : "") + "</td>" +
        '<td class="iptvm-c-ch' + (ch.guide ? " iptvm-changed" : "") + '"><button type="button" class="iptvm-chbtn iptvm-guidebtn' + autoMuted + '" data-act="channel"' + (chDisabled ? " disabled" : "") + ' title="' + esc(chLabel) + '">' + (chLabel ? esc(chLabel) : '<span class="iptvm-muted">' + (g.p === "none" ? "" : "Choose guide channel\u2026") + "</span>") + "</button></td>" +
        '<td class="iptvm-c-status">' + chips + "</td>" +
        '<td class="iptvm-c-en' + (ch.enabled ? " iptvm-changed" : "") + '"><label class="iptvm-switch" title="Enabled in Emby"><input type="checkbox" data-field="enabled"' + (r.cur.enabled ? " checked" : "") + "/><span></span></label></td>" +
        '<td class="iptvm-c-act"><button type="button" class="iptvm-btn iptvm-revert" data-act="revert" title="Revert this row">&#x21BA;</button></td>' +
        "</tr>";
    }

    function renderAll() {
      computeStatuses();
      var list = visibleRows();
      S.visible = list;
      var tbody = $(".iptvm-tbody");
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="11" class="iptvm-empty">' + (S.rows.length ? "No channels match the filters." : "No channels found.") + "</td></tr>";
      } else {
        var html = new Array(list.length);
        for (var i = 0; i < list.length; i++) html[i] = rowHtml(list[i]);
        tbody.innerHTML = html.join("");
      }
      wireImages(tbody);
      renderHeader();
      renderCounters();
    }

    function wireImages(root) {
      var imgs = root.querySelectorAll("img[data-fallback]");
      for (var i = 0; i < imgs.length; i++) {
        if (imgs[i]._wired) continue;
        imgs[i]._wired = true;
        imgs[i].addEventListener("error", onImgError);
      }
    }
    function onImgError(e) {
      var img = e.target, fb = img.getAttribute("data-fallback");
      if (fb && img.getAttribute("src") !== fb) { img.setAttribute("data-fallback", ""); img.src = fb; return; }
      var tr = img.closest("tr"), r = tr && S.byKey[tr.getAttribute("data-key")];
      var span = document.createElement("span");
      span.textContent = r ? (r.cur.name || "?").substring(0, 10) : "?";
      img.parentNode.replaceChild(span, img);
    }

    /** Re-render specific rows in place (keeps focus on the same field), then refresh status chips everywhere. */
    function refreshRows(rows) {
      computeStatuses();
      var tbody = $(".iptvm-tbody");
      var active = document.activeElement, activeKey = null, activeField = null, selStart = null;
      if (active && tbody.contains(active)) {
        var atr = active.closest("tr");
        activeKey = atr && atr.getAttribute("data-key");
        activeField = active.getAttribute("data-field") || active.getAttribute("data-act");
        try { selStart = active.selectionStart; } catch (e) { selStart = null; }
      }
      var set = {};
      (rows || []).forEach(function (r) { set[r.key] = r; });
      var trs = tbody.querySelectorAll("tr[data-key]");
      for (var i = 0; i < trs.length; i++) {
        var key = trs[i].getAttribute("data-key");
        var r = S.byKey[key];
        if (!r) continue;
        if (set[key]) {
          var tmp = document.createElement("tbody");
          tmp.innerHTML = rowHtml(r);
          var nt = tmp.firstChild;
          trs[i].parentNode.replaceChild(nt, trs[i]);
          wireImages(nt);
          if (key === activeKey && activeField) {
            var el = nt.querySelector('[data-field="' + activeField + '"],[data-act="' + activeField + '"]');
            if (el) { try { el.focus(); if (selStart != null && el.setSelectionRange) el.setSelectionRange(selStart, selStart); } catch (e2) { /* ignore */ } }
          }
        } else {
          updateStatusCell(trs[i], r);
        }
      }
      renderCounters();
    }
    function updateStatusCell(tr, r) {
      var tmp = document.createElement("tbody");
      tmp.innerHTML = rowHtml(r);
      var fresh = tmp.firstChild.querySelector(".iptvm-c-status");
      var cell = tr.querySelector(".iptvm-c-status");
      if (cell && fresh && cell.innerHTML !== fresh.innerHTML) cell.innerHTML = fresh.innerHTML;
    }
    /** After guide options load: refresh labels without disturbing focus. */
    function refreshAllRowsLight() {
      if (!S.loaded) return;
      var tbody = $(".iptvm-tbody");
      var trs = tbody.querySelectorAll("tr[data-key]");
      for (var i = 0; i < trs.length; i++) {
        var r = S.byKey[trs[i].getAttribute("data-key")];
        if (!r) continue;
        var btn = trs[i].querySelector(".iptvm-guidebtn");
        var label = guideChannelLabel(r);
        if (btn && label && btn.getAttribute("title") !== label) { btn.textContent = label; btn.setAttribute("title", label); }
      }
    }

    function renderHeader() {
      var ths = view.querySelectorAll(".iptvm-table th[data-sort]");
      for (var i = 0; i < ths.length; i++) {
        var th = ths[i], col = th.getAttribute("data-sort");
        var a = th.querySelector(".iptvm-arrow");
        if (!a) { a = document.createElement("span"); a.className = "iptvm-arrow"; th.appendChild(a); }
        a.textContent = S.sort.col === col ? (S.sort.dir > 0 ? "\u25B2" : "\u25BC") : "";
      }
    }
    function renderCounters() {
      var n = pendingCount();
      var p = $(".iptvm-pending");
      p.textContent = n + " pending";
      p.classList.toggle("iptvm-has", n > 0);
      $(".iptvm-act-undo").disabled = !S.undo.length || S.saving;
      $(".iptvm-act-redo").disabled = !S.redo.length || S.saving;
      $(".iptvm-act-discard").disabled = !n || S.saving;
      $(".iptvm-act-save").disabled = !n || S.saving;
      $(".iptvm-act-reload").disabled = S.saving;
      var en = $(".iptvm-act-enabledummy");
      en.style.display = S.dummyAvailable && !S.dummyPid ? "" : "none";
      en.disabled = S.saving || S.enablingDummy;
      $(".iptvm-count").textContent = "Showing " + S.visible.length + " of " + S.rows.length;
      var nSel = Object.keys(S.selected).length;
      $(".iptvm-act-bulklogo").disabled = !nSel || S.saving;
      $(".iptvm-act-bulklogo").textContent = "Copy logo from\u2026" + (nSel ? " (" + nSel + ")" : "");
      $(".iptvm-act-bulkupload").disabled = !nSel || S.saving;
      $(".iptvm-act-bulkupload").textContent = "Upload logo for selected\u2026" + (nSel ? " (" + nSel + ")" : "");
      $(".iptvm-act-bulksrc").disabled = !nSel || S.saving;
      $(".iptvm-act-bulksrc").textContent = "Set guide source\u2026" + (nSel ? " (" + nSel + ")" : "");
      $(".iptvm-act-clearsel").style.display = nSel ? "" : "none";
      $(".iptvm-sel-count").textContent = nSel ? nSel + " selected" : "";
      var allSel = S.visible.length > 0 && S.visible.every(function (r) { return S.selected[r.key]; });
      $(".iptvm-sel-all").checked = allSel;
      $(".iptvm-sel-all").indeterminate = !allSel && S.visible.some(function (r) { return S.selected[r.key]; });
      var mapped = 0, conflicts = 0, dups = 0, dis = 0;
      S.rows.forEach(function (r) {
        if (r.status.indexOf("mapped") >= 0) mapped++;
        if (r.status.indexOf("conflict") >= 0) conflicts++;
        if (r.status.indexOf("dupnum") >= 0) dups++;
        if (r.status.indexOf("disabled") >= 0) dis++;
      });
      $(".iptvm-summary").textContent = S.rows.length + " channels \u00b7 " + mapped + " mapped \u00b7 " + (S.rows.length - mapped - dis) + " unmapped \u00b7 " +
        conflicts + " in conflict \u00b7 " + dups + " duplicate numbers \u00b7 " + dis + " disabled" + (S.mode === "fallback" ? " \u00b7 fallback mode" : "");
    }

    // ------------------------------------------------------------ editing + undo/redo
    /** changes: [{ key, field, value }] applied as ONE undoable action. */
    function applyEdit(changes, opts) {
      var action = [];
      changes.forEach(function (c) {
        var r = S.byKey[c.key];
        if (!r) return;
        var before = cloneVal(c.field, r.cur[c.field]);
        var after = cloneVal(c.field, c.value);
        if (valEq(c.field, before, after)) return;
        r.cur[c.field] = after;
        delete r.errors[c.field];
        action.push({ key: c.key, field: c.field, before: before, after: cloneVal(c.field, after) });
      });
      if (!action.length) { if (!(opts && opts.silent)) refreshRows(changes.map(function (c) { return S.byKey[c.key]; }).filter(Boolean)); return 0; }
      S.undo.push(action);
      if (S.undo.length > MAX_UNDO) S.undo.shift();
      S.redo = [];
      afterChange(action, opts);
      return action.length;
    }
    function afterChange(action, opts) {
      if (action.some(function (a) { return a.field === "group"; })) renderFilterOptions();
      var rows = [], seen = {};
      action.forEach(function (a) { if (!seen[a.key]) { seen[a.key] = 1; rows.push(S.byKey[a.key]); } });
      if (opts && opts.full) renderAll(); else refreshRows(rows.filter(Boolean));
    }
    function undo() {
      if (!S.undo.length || S.saving) return;
      var action = S.undo.pop();
      for (var i = action.length - 1; i >= 0; i--) { var a = action[i], r = S.byKey[a.key]; if (r) r.cur[a.field] = cloneVal(a.field, a.before); }
      S.redo.push(action);
      afterChange(action, { full: action.length > 20 });
    }
    function redo() {
      if (!S.redo.length || S.saving) return;
      var action = S.redo.pop();
      action.forEach(function (a) { var r = S.byKey[a.key]; if (r) r.cur[a.field] = cloneVal(a.field, a.after); });
      S.undo.push(action);
      afterChange(action, { full: action.length > 20 });
    }
    function revertRow(r) {
      applyEdit(changedFields(r).map(function (f) { return { key: r.key, field: f, value: r.orig[f] }; }));
    }
    function discardAll() {
      var changes = [];
      S.rows.forEach(function (r) { changedFields(r).forEach(function (f) { changes.push({ key: r.key, field: f, value: r.orig[f] }); }); });
      if (changes.length) applyEdit(changes, { full: true });
      toast(changes.length + " change(s) discarded. Use Undo to bring them back.");
    }
    /** Re-applies edits (e.g. failed saves) after a reload, matched by stable key. Not added to undo. */
    function reapplyEdits(list) {
      list.forEach(function (c) {
        var r = S.byKey[c.key];
        if (!r) return;
        r.cur[c.field] = cloneVal(c.field, c.value);
        if (c.error) r.errors[c.field] = c.error;
      });
    }

    // ------------------------------------------------------------ shared combobox (guide channel | group | logo source)
    function showCombo(mode, anchor, placeholder) {
      combo.mode = mode; combo.open = true; combo.active = 0; combo.results = [];
      var box = $(".iptvm-combo"), input = $(".iptvm-combo-input");
      input.value = "";
      input.placeholder = placeholder;
      box.classList.toggle("iptvm-combo-wide", mode === "logosrc" || mode === "gsrc");
      box.classList.add("iptvm-show");
      positionCombo(anchor);
      input.focus();
    }
    function openCombo(r, anchor) {
      var g = r.cur.guide;
      var pid = g.p && g.p !== "none" ? g.p : r.effP;
      if (!pid) return;
      combo.row = r; combo.providerId = pid;
      showCombo("guide", anchor, "Type to search guide channels...");
      $(".iptvm-combo-list").innerHTML = '<div class="iptvm-opt iptvm-muted">Loading ' + esc(providerLabel(pid)) + " channels\u2026</div>";
      $(".iptvm-combo-foot").textContent = providerLabel(pid);
      loadOptions(pid).then(function () { if (combo.open && combo.mode === "guide" && combo.row === r) renderCombo(); });
    }
    function openGroupCombo(r, anchor) {
      combo.row = r;
      showCombo("group", anchor, "Type a new group or pick an existing one...");
      renderCombo();
    }
    /** Picker over channels that have a Primary image. onPick(sourceRow). exclude: key -> true. */
    function openLogoSrcCombo(anchor, onPick, exclude) {
      combo.row = null; combo.onPick = onPick; combo.exclude = exclude || {};
      showCombo("logosrc", anchor, "Search channels with a logo (name, number, group)...");
      renderCombo();
    }
    function positionCombo(anchor) {
      var box = $(".iptvm-combo");
      var rect = anchor.getBoundingClientRect();
      var h = 360, w = Math.min(box.offsetWidth || 420, window.innerWidth - 16);
      var top = rect.bottom + 2;
      if (top + h > window.innerHeight && rect.top - h > 0) top = rect.top - h - 2;
      var left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
      box.style.top = top + "px";
      box.style.left = left + "px";
    }
    function closeCombo() {
      combo.open = false; combo.row = null; combo.onPick = null;
      $(".iptvm-combo").classList.remove("iptvm-show");
    }
    function comboSearch(o, q) {
      var tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
      var res = [];
      if (!tokens.length) {
        res = o.list.slice(0, MAX_COMBO_RESULTS);
        return { tokens: tokens, items: res, total: o.list.length };
      }
      for (var i = 0; i < o.list.length; i++) {
        var s = fuzzyScore(tokens, o.list[i].lc);
        if (s >= 0) res.push({ s: s, x: o.list[i] });
      }
      res.sort(function (a, b) { return b.s - a.s || naturalCompare(a.x.name, b.x.name); });
      var total = res.length;
      return { tokens: tokens, items: res.slice(0, MAX_COMBO_RESULTS).map(function (e) { return e.x; }), total: total };
    }
    function renderCombo() {
      if (!combo.open) return;
      if (combo.mode === "group") renderGroupCombo();
      else if (combo.mode === "logosrc") renderLogoSrcCombo();
      else if (combo.mode === "gsrc") renderGsrcCombo();
      else renderGuideCombo();
    }
    function chooseCombo(idx) {
      if (combo.mode === "group") chooseGroup(idx);
      else if (combo.mode === "logosrc") chooseLogoSrc(idx);
      else if (combo.mode === "gsrc") chooseGsrc(idx);
      else chooseGuide(idx);
    }
    function clampActive() {
      if (combo.active >= combo.results.length) combo.active = combo.results.length - 1;
      if (combo.active < 0) combo.active = 0;
    }
    function renderGuideCombo() {
      var r = combo.row, pid = combo.providerId, o = S.options[pid];
      var list = $(".iptvm-combo-list"), foot = $(".iptvm-combo-foot");
      if (!o || o.state === "loading") return;
      if (o.state === "error") {
        list.innerHTML = '<div class="iptvm-opt iptvm-muted">Guide data unavailable: ' + esc(o.error) + "</div>";
        foot.textContent = providerLabel(pid);
        combo.results = [];
        return;
      }
      var q = $(".iptvm-combo-input").value;
      var found = comboSearch(o, q);
      var curId = guideEq(r.cur.guide, r.orig.guide) && r.cur.guide.p === "" ? (r.effP === pid ? r.effC : "") : (r.cur.guide.p === pid ? r.cur.guide.c : "");
      var results = [{ id: "", name: "(clear guide channel)", special: true }].concat(found.items);
      combo.results = results;
      clampActive();
      var html = results.map(function (x, i) {
        var used = "";
        if (x.id) {
          var users = (S.identUse[pid + "|" + x.id] || []).filter(function (u) { return u !== r; });
          if (users.length) used = '<span class="iptvm-used" title="Already mapped">\u2190 ' + esc(users[0].cur.number ? users[0].cur.number + " " : "") + esc(users[0].cur.name) + (users.length > 1 ? " +" + (users.length - 1) : "") + "</span>";
        }
        return '<div class="iptvm-opt' + (i === combo.active ? " iptvm-active" : "") + (x.id && x.id === curId ? " iptvm-current" : "") + '" data-idx="' + i + '">' +
          "<span>" + (x.special ? '<span class="iptvm-muted">' + esc(x.name) + "</span>" : highlight(x.name, found.tokens)) + "</span>" +
          (x.special ? "" : '<span>' + used + ' <span class="iptvm-oid">' + esc(x.id) + "</span></span>") + "</div>";
      }).join("");
      list.innerHTML = html;
      foot.textContent = providerLabel(pid) + " \u00b7 " + (found.total > found.items.length ? "showing " + found.items.length + " of " + found.total + " matches, keep typing" : found.total + (found.tokens.length ? " matches" : " channels")) + " \u00b7 \u2191\u2193 Enter Esc";
      scrollActive();
    }
    function scrollActive() {
      var el = $(".iptvm-combo-list").querySelector(".iptvm-active");
      if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: "nearest" }); } catch (e) { el.scrollIntoView(false); } }
    }
    function chooseGuide(idx) {
      var x = combo.results[idx], r = combo.row, pid = combo.providerId;
      if (!x || !r) return;
      closeCombo();
      applyEdit([{ key: r.key, field: "guide", value: x.id ? { p: pid, c: x.id } : { p: pid, c: "" } }]);
    }

    // ---- group combobox: existing effective groups + M3U groups; free text creates a new group
    function groupCatalog() {
      var counts = {}, m3u = {};
      S.rows.forEach(function (row) {
        if (row.cur.group) counts[row.cur.group] = (counts[row.cur.group] || 0) + 1;
        if (row.m3uGroup) m3u[row.m3uGroup] = 1;
      });
      Object.keys(m3u).forEach(function (g) { if (!counts[g]) counts[g] = 0; });
      return Object.keys(counts).map(function (g) { return { name: g, count: counts[g], m3u: !!m3u[g], lc: g.toLowerCase() }; });
    }
    function renderGroupCombo() {
      var r = combo.row, list = $(".iptvm-combo-list"), foot = $(".iptvm-combo-foot");
      var q = $(".iptvm-combo-input").value.trim();
      var tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
      var cat = groupCatalog(), matches = [];
      cat.forEach(function (g) {
        var s = tokens.length ? fuzzyScore(tokens, g.lc) : 0;
        if (s >= 0) matches.push({ s: s, g: g });
      });
      matches.sort(function (a, b) { return b.s - a.s || b.g.count - a.g.count || naturalCompare(a.g.name, b.g.name); });
      var results = [];
      var exact = cat.some(function (g) { return g.name === q; });
      if (q && !exact) results.push({ kind: "new", value: q, label: "Use new group \u201c" + q + "\u201d" });
      if (r.m3uGroup && r.cur.group !== r.m3uGroup && (!tokens.length || fuzzyScore(tokens, r.m3uGroup.toLowerCase()) >= 0)) {
        results.push({ kind: "reset", value: r.m3uGroup, label: "Reset to M3U group: " + r.m3uGroup });
      }
      if (!q && r.cur.group) results.push({ kind: "none", value: "", label: "(no group)" });
      matches.slice(0, MAX_COMBO_RESULTS).forEach(function (m) { results.push({ kind: "group", value: m.g.name, label: m.g.name, count: m.g.count, m3u: m.g.m3u }); });
      combo.results = results;
      clampActive();
      list.innerHTML = results.length ? results.map(function (x, i) {
        var main = x.kind === "group" ? highlight(x.label, tokens) : '<span class="iptvm-muted">' + esc(x.label) + "</span>";
        if (x.kind === "new") main = "<b>" + esc(x.label) + "</b>";
        var side = x.kind === "group" ? '<span class="iptvm-oid">' + (x.m3u ? "M3U \u00b7 " : "") + x.count + " ch</span>" : "";
        return '<div class="iptvm-opt' + (i === combo.active ? " iptvm-active" : "") + (x.kind === "group" && x.value === r.cur.group ? " iptvm-current" : "") + '" data-idx="' + i + '"><span>' + main + "</span>" + side + "</div>";
      }).join("") : '<div class="iptvm-opt iptvm-muted">No groups</div>';
      foot.textContent = cat.length + " groups \u00b7 Enter = first option \u00b7 Esc";
      scrollActive();
    }
    function chooseGroup(idx) {
      var x = combo.results[idx], r = combo.row;
      if (!x || !r) return;
      closeCombo();
      applyEdit([{ key: r.key, field: "group", value: String(x.value).trim() }]);
    }

    // ---- logo source picker (channels with a Primary image, with thumbnails)
    function logoSourceCandidates() {
      return S.rows.filter(function (row) {
        return row.inLibrary && row.cur.enabled && (row.primaryTag || isPendingImageValue(row.cur.logo)) && !combo.exclude[row.key];
      });
    }
    function renderLogoSrcCombo() {
      var list = $(".iptvm-combo-list"), foot = $(".iptvm-combo-foot");
      var q = $(".iptvm-combo-input").value.trim();
      var tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
      var cands = logoSourceCandidates(), found = [];
      cands.forEach(function (row) {
        var hay = (row.cur.number + " " + row.cur.name + " " + row.m3uName + " " + row.cur.group + " " + row.tunerName).toLowerCase();
        var s = tokens.length ? fuzzyScore(tokens, hay) : 0;
        if (s >= 0) found.push({ s: s, r: row });
      });
      found.sort(function (a, b) { return b.s - a.s || naturalCompare(a.r.cur.number, b.r.cur.number) || naturalCompare(a.r.cur.name, b.r.cur.name); });
      var total = found.length;
      combo.results = found.slice(0, MAX_COMBO_RESULTS).map(function (f) { return f.r; });
      clampActive();
      list.innerHTML = combo.results.length ? combo.results.map(function (row, i) {
        return '<div class="iptvm-opt iptvm-opt-thumb' + (i === combo.active ? " iptvm-active" : "") + '" data-idx="' + i + '">' +
          '<span class="iptvm-thumb"><img loading="lazy" alt="" src="' + esc(isPendingImageValue(row.cur.logo) ? imageUrlFor(row) : primaryUrl(row, 40)) + '"/></span>' +
          '<span class="iptvm-thumb-text">' + highlight((row.cur.number ? row.cur.number + " " : "") + row.cur.name, tokens) +
          '<span class="iptvm-oid">' + esc(row.tunerName) + (row.cur.group ? " \u00b7 " + esc(row.cur.group) : "") + (isPendingImageValue(row.cur.logo) ? " \u00b7 pending logo" : "") + "</span></span></div>";
      }).join("") : '<div class="iptvm-opt iptvm-muted">No channel with a logo matches.</div>';
      foot.textContent = (total > combo.results.length ? "showing " + combo.results.length + " of " + total : total) + " channels with a logo \u00b7 \u2191\u2193 Enter Esc";
      scrollActive();
    }
    function chooseLogoSrc(idx) {
      var src = combo.results[idx], cb = combo.onPick;
      if (!src) return;
      closeCombo();
      if (cb) cb(src);
    }
    /** Logo value meaning "copy src's Primary image"; follows a pending copy/upload on the source to its origin. */
    function copyValueFor(src) {
      var v = src.cur.logo;
      if (isPendingImageValue(v)) return v;
      return COPY_PREFIX + src.itemId;
    }
    function bulkCopyLogo(src) {
      var val = copyValueFor(src), changes = [], skipped = 0;
      Object.keys(S.selected).forEach(function (k) {
        var row = S.byKey[k];
        if (!row) return;
        if (row === src || !row.inLibrary || !row.cur.enabled) { if (row !== src) skipped++; return; }
        changes.push({ key: k, field: "logo", value: val });
      });
      var n = applyEdit(changes, { full: true });
      toast("Logo of " + rowLabel(src) + " queued for " + n + " channel(s)" + (skipped ? "; " + skipped + " disabled channel(s) skipped" : "") + ". Save to apply.");
    }

    /** One undoable action: logo value for every selected, editable row. */
    function bulkSetLogoValue(val, what) {
      var changes = [], skipped = 0;
      Object.keys(S.selected).forEach(function (k) {
        var row = S.byKey[k];
        if (!row) return;
        if (!row.inLibrary || !row.cur.enabled) { skipped++; return; }
        changes.push({ key: k, field: "logo", value: val });
      });
      var n = applyEdit(changes, { full: true });
      toast(what + " queued for " + n + " channel(s)" + (skipped ? "; " + skipped + " disabled channel(s) skipped" : "") + ". Save to apply.");
      return n;
    }
    function bulkUploadFile(file) {
      return processUpload(file).then(function (u) {
        return bulkSetLogoValue(UPLOAD_PREFIX + u.id, "Uploaded " + u.name);
      }, function (err) { toast("Upload: " + (err && err.message || err)); return 0; });
    }

    // ---- bulk guide source
    function currentGuideChannelId(r) {
      if (guideEq(r.cur.guide, r.orig.guide) && r.cur.guide.p === "") return r.effC;
      return r.cur.guide.p && r.cur.guide.p !== "none" ? r.cur.guide.c : "";
    }
    /** Guide value when the source is switched to v ("" = Auto, "none", or a provider id).
     *  A provider keeps the current guide channel only if that channel exists in it (same provider,
     *  or the id is in its loaded channel list); otherwise the channel is cleared for the user to choose. */
    function guideForSource(r, v) {
      if (v === "") return { p: "", c: "" };
      if (v === "none") return { p: "none", c: "" };
      // Channel Name Guide: every tuner channel has its own guide channel -> no manual pick needed.
      if (isDummyPid(v)) return { p: v, c: dummyChannelId(r) };
      if (v === r.cur.guide.p) return cloneVal("guide", r.cur.guide);
      if (v === r.effP && guideEq(r.cur.guide, r.orig.guide) && r.effC) return { p: v, c: r.effC };
      var c = currentGuideChannelId(r), o = S.options[v];
      if (c && o && o.state === "ready" && o.byId[c]) return { p: v, c: c };
      return { p: v, c: "" };
    }
    function gsrcOptions() {
      var list = [{ id: "", label: "Auto", note: "restore auto-match" }, { id: "none", label: "None", note: "no guide" }];
      S.providers.forEach(function (p) { list.push({ id: p.id, label: p.label, note: p.dummy ? "24h tile titled with the channel name" : "keeps channel if it exists there" }); });
      return list;
    }
    function openGsrcCombo(anchor) {
      combo.row = null;
      showCombo("gsrc", anchor, "Guide source for the selected rows...");
      renderCombo();
    }
    function renderGsrcCombo() {
      var q = $(".iptvm-combo-input").value.trim().toLowerCase();
      combo.results = gsrcOptions().filter(function (x) { return !q || x.label.toLowerCase().indexOf(q) >= 0; });
      clampActive();
      $(".iptvm-combo-list").innerHTML = combo.results.length ? combo.results.map(function (x, i) {
        return '<div class="iptvm-opt' + (i === combo.active ? " iptvm-active" : "") + '" data-idx="' + i + '"><span>' + esc(x.label) + '</span><span class="iptvm-oid">' + esc(x.note) + "</span></div>";
      }).join("") : '<div class="iptvm-opt iptvm-muted">No matching source.</div>';
      $(".iptvm-combo-foot").textContent = Object.keys(S.selected).length + " selected row(s) \u00b7 one undo step \u00b7 \u2191\u2193 Enter Esc";
      scrollActive();
    }
    function chooseGsrc(idx) {
      var x = combo.results[idx];
      if (!x) return;
      closeCombo();
      bulkSetSource(x.id);
    }
    function bulkSetSource(v) {
      var go = function () {
        var changes = [], kept = 0, cleared = 0, skipped = 0;
        Object.keys(S.selected).forEach(function (k) {
          var r = S.byKey[k];
          if (!r) return;
          if (!r.cur.enabled) { skipped++; return; }
          var g = guideForSource(r, v);
          if (g.p && g.p !== "none") { if (g.c) kept++; else cleared++; }
          changes.push({ key: k, field: "guide", value: g });
        });
        var n = applyEdit(changes, { full: true });
        toast("Guide source " + providerLabel(v) + " set on " + n + " channel(s)" +
          (v && v !== "none" ? " (" + kept + " kept their channel, " + cleared + " need a guide channel)" : "") +
          (skipped ? "; " + skipped + " disabled skipped" : "") + ". Save to apply.");
        return n;
      };
      return v && v !== "none" ? loadOptions(v).then(go, go) : Promise.resolve(go());
    }

    // ------------------------------------------------------------ logo upload (browser file -> base64, memory only)
    function uploadFileType(file) {
      var t = str(file && file.type).toLowerCase();
      if (t === "image/jpg" || t === "image/pjpeg") t = "image/jpeg";
      if (!t || t === "application/octet-stream") {
        var m = /\.([a-z0-9]+)$/i.exec(str(file && file.name));
        t = (m && EXT_TYPES[m[1].toLowerCase()]) || t;
      }
      return t;
    }
    function decodeImage(blob) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(blob), img = new Image();
        img.onload = function () { resolve({ img: img, url: url }); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("The browser cannot decode this image")); };
        img.src = url;
      });
    }
    function canvasBlob(img, w, h, type) {
      return new Promise(function (resolve, reject) {
        try {
          var c = document.createElement("canvas");
          c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          c.toBlob(function (b) { if (b) resolve(b); else reject(new Error("Image conversion failed")); }, type, type === "image/jpeg" ? 0.92 : undefined);
        } catch (e) { reject(e); }
      });
    }
    /** Validates + normalizes a local image file. PNG/JPEG are kept byte-for-byte unless larger than UPLOAD_MAX_DIM;
     *  WebP/GIF/SVG are re-encoded to PNG via canvas. Resolves to an S.uploads record. */
    function processUpload(file) {
      if (!file) return Promise.reject(new Error("No file selected."));
      var name = str(file.name) || "pasted-image";
      var type = uploadFileType(file);
      if (!UPLOAD_TYPES[type]) return Promise.reject(new Error("Unsupported file type (" + (file.type || name) + "). Use PNG, JPEG, WebP, GIF or SVG."));
      if (!file.size) return Promise.reject(new Error("The file is empty."));
      if (file.size > UPLOAD_MAX_BYTES) return Promise.reject(new Error("The file is " + (file.size / 1048576).toFixed(1) + " MB; the limit is 5 MB."));
      return Promise.all([decodeImage(file), sniffImageType(file)]).then(function (res) {
        var img = res[0].img, sniffed = res[1];
        var isSvg = type === "image/svg+xml";
        var w = img.naturalWidth || (isSvg ? SVG_MIN_DIM : 0), h = img.naturalHeight || (isSvg ? SVG_MIN_DIM : 0);
        if (!w || !h) { URL.revokeObjectURL(res[0].url); throw new Error("The image has no size."); }
        var longest = Math.max(w, h), scale = 1;
        if (longest > UPLOAD_MAX_DIM) scale = UPLOAD_MAX_DIM / longest;
        else if (isSvg && longest < SVG_MIN_DIM) scale = SVG_MIN_DIM / longest;
        var tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
        var keep = (sniffed === "image/png" || sniffed === "image/jpeg") && !isSvg && scale === 1;
        var outType = keep ? sniffed : (sniffed === "image/jpeg" ? "image/jpeg" : "image/png");
        var p = keep ? Promise.resolve(file) : canvasBlob(img, tw, th, outType);
        return p.then(function (blob) {
          URL.revokeObjectURL(res[0].url);
          return blobToDataUrl(blob).then(function (dataUrl) {
            var notes = [];
            if (!keep && outType === "image/png" && sniffed !== "image/png") notes.push("converted to PNG");
            if (scale < 1) notes.push("downscaled from " + w + "\u00d7" + h);
            if (isSvg) notes.push("rasterized");
            var id = "u" + (++S.uploadSeq);
            var rec = {
              id: id, name: name, type: outType, b64: String(dataUrl).split(",")[1], url: URL.createObjectURL(blob),
              w: keep ? w : tw, h: keep ? h : th, bytes: blob.size, note: notes.join(", ")
            };
            S.uploads[id] = rec;
            return rec;
          });
        });
      });
    }
    function uploadSummary(u) {
      return u.name + " \u2014 " + u.w + "\u00d7" + u.h + ", " + Math.max(1, Math.round(u.bytes / 1024)) + " KB " + u.type.replace("image/", "").toUpperCase() + (u.note ? " (" + u.note + ")" : "");
    }
    function logoDlgUseFile(file) {
      if (!logoDlg.row || !file) return;
      var msg = $(".iptvm-logo-msg");
      msg.textContent = "Reading " + (file.name || "image") + "\u2026";
      processUpload(file).then(function (u) {
        if (!logoDlg.row) return;
        logoDlg.upload = u.id; logoDlg.copySrc = null;
        $(".iptvm-logo-url").value = "";
        previewLogo();
      }, function (err) { msg.textContent = "Upload rejected: " + (err && err.message || err); });
    }
    function onDlgDragOver(e) {
      if (!logoDlg.row) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = "copy"; } catch (x) { /* ignore */ }
      $(".iptvm-logo-overlay .iptvm-dlg").classList.add("iptvm-drop");
    }
    function onDlgDragLeave(e) {
      var dlg = $(".iptvm-logo-overlay .iptvm-dlg");
      if (!e.relatedTarget || !dlg.contains(e.relatedTarget)) dlg.classList.remove("iptvm-drop");
    }
    function onDlgDrop(e) {
      e.preventDefault();
      $(".iptvm-logo-overlay .iptvm-dlg").classList.remove("iptvm-drop");
      if (!logoDlg.row) return;
      var dt = e.dataTransfer, f = dt && dt.files && dt.files[0];
      if (f) { logoDlgUseFile(f); return; }
      var uri = "";
      try { uri = (dt.getData("text/uri-list") || dt.getData("text/plain") || "").split(/\r?\n/)[0].trim(); } catch (x) { uri = ""; }
      if (isHttpUrl(uri)) { $(".iptvm-logo-url").value = uri; logoDlg.copySrc = null; logoDlg.upload = ""; previewLogo(); }
      else $(".iptvm-logo-msg").textContent = "Drop an image file (or an image link).";
    }
    function onDocPaste(e) {
      if (!logoDlg.row || !$(".iptvm-logo-overlay").classList.contains("iptvm-show")) return;
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === "file" && /^image\//.test(items[i].type)) {
          var f = items[i].getAsFile();
          if (f) { e.preventDefault(); logoDlgUseFile(f); return; }
        }
      }
    }

    // ------------------------------------------------------------ logo dialog
    function openLogo(r) {
      if (!r.cur.enabled || !r.inLibrary) { toast("Enable the channel and save first; logos can only be set on channels that exist in Emby."); return; }
      logoDlg.row = r;
      logoDlg.copySrc = logoCopySource(r.cur.logo);
      logoDlg.upload = uploadOf(r.cur.logo) ? r.cur.logo.substring(UPLOAD_PREFIX.length) : "";
      $(".iptvm-logo-title").textContent = (r.cur.number ? r.cur.number + " \u00b7 " : "") + r.cur.name + " \u00b7 " + r.tunerName;
      setImg($(".iptvm-logo-cur"), primaryUrl(r, 90));
      setImg($(".iptvm-logo-m3u"), r.m3uLogoUrl);
      $(".iptvm-logo-usem3u").disabled = !r.m3uLogoUrl;
      $(".iptvm-logo-url").value = r.cur.logo && !isPendingImageValue(r.cur.logo) ? r.cur.logo : "";
      previewLogo();
      $(".iptvm-logo-overlay").classList.add("iptvm-show");
      setTimeout(function () { $(".iptvm-logo-url").focus(); }, 30);
    }
    function setImg(img, src) {
      img.style.visibility = src ? "visible" : "hidden";
      if (src) img.src = src; else img.removeAttribute("src");
    }
    function previewLogo() {
      var u = $(".iptvm-logo-url").value.trim(), msg = $(".iptvm-logo-msg"), img = $(".iptvm-logo-new");
      img.onload = null; img.onerror = null;
      var up = !u && logoDlg.upload ? S.uploads[logoDlg.upload] : null;
      if (up) {
        setImg(img, up.url);
        msg.textContent = "Will upload " + uploadSummary(up) + ".";
        return;
      }
      if (logoDlg.copySrc && !u) {
        setImg(img, primaryUrl(logoDlg.copySrc, 90));
        msg.textContent = "Will copy the Primary image of " + rowLabel(logoDlg.copySrc) + " (" + logoDlg.copySrc.tunerName + ").";
        return;
      }
      if (!u) { setImg(img, ""); msg.textContent = "Empty = no logo override."; return; }
      if (!isHttpUrl(u)) { setImg(img, ""); msg.textContent = "Enter an http(s) URL."; return; }
      msg.textContent = "Loading preview\u2026";
      img.onload = function () { msg.textContent = "Preview OK (" + img.naturalWidth + "\u00d7" + img.naturalHeight + ")."; };
      img.onerror = function () { msg.textContent = "Browser could not load this image (Emby may still be able to)."; };
      setImg(img, u);
    }
    function closeLogo() {
      closeCombo();
      $(".iptvm-logo-overlay").classList.remove("iptvm-show");
      $(".iptvm-logo-overlay .iptvm-dlg").classList.remove("iptvm-drop");
      logoDlg.row = null; logoDlg.copySrc = null; logoDlg.upload = "";
    }
    function applyLogo() {
      var r = logoDlg.row, u = $(".iptvm-logo-url").value.trim(), src = logoDlg.copySrc;
      if (!r) return closeLogo();
      if (u && !isHttpUrl(u)) { $(".iptvm-logo-msg").textContent = "Enter an http(s) URL."; return; }
      var val = u ? u : (logoDlg.upload && S.uploads[logoDlg.upload] ? UPLOAD_PREFIX + logoDlg.upload : (src ? copyValueFor(src) : ""));
      closeLogo();
      applyEdit([{ key: r.key, field: "logo", value: val }]);
    }

    // ------------------------------------------------------------ snapshots
    function openSnapshots() {
      var list = $(".iptvm-snap-list"), snaps = (S.config && S.config.Snapshots) || [];
      list.innerHTML = snaps.length ? snaps.map(function (s, i) {
        var d = new Date(s.DateUtc);
        return '<div class="iptvm-snap"><div><b>' + esc(isNaN(d) ? s.DateUtc : d.toLocaleString()) + "</b><br/><span class=\"iptvm-small iptvm-muted\">" + esc(s.Summary || "") + " \u00b7 " + (s.Changes || []).length + " change(s)</span></div>" +
          '<button type="button" class="iptvm-btn" data-snap="' + i + '">Load before-values</button></div>';
      }).join("") : '<div class="iptvm-empty">No snapshots yet. One is stored on every successful Save (last ' + MAX_SNAPSHOTS + " kept).</div>";
      $(".iptvm-snap-overlay").classList.add("iptvm-show");
    }
    function loadSnapshot(i) {
      var s = S.config.Snapshots[i];
      if (!s) return;
      var byMgmt = {};
      S.rows.forEach(function (r) { byMgmt[r.managementId] = r; });
      var changes = [], missing = 0;
      (s.Changes || []).forEach(function (c) {
        var r = S.byKey[c.Key] || byMgmt[c.ManagementId];
        if (!r) { missing++; return; }
        if (c.Field === "logo" && str(c.Before).indexOf(UPLOAD_PREFIX) === 0) return;
        changes.push({ key: r.key, field: c.Field, value: decodeVal(c.Field, c.Before) });
      });
      $(".iptvm-snap-overlay").classList.remove("iptvm-show");
      var n = applyEdit(changes, { full: true });
      toast(n + " pending change(s) from snapshot" + (missing ? ", " + missing + " channel(s) no longer found" : "") + ". Review and Save.");
    }

    // ------------------------------------------------------------ Channel Name Guide provider setup
    /** Creates the provider instance through Emby's own endpoint (same request as the XmlTV setup page). */
    function enableDummyGuide() {
      if (S.dummyPid || S.enablingDummy) return Promise.resolve(S.dummyPid);
      if (!window.confirm("Add the \"" + DUMMY_NAME + "\" guide provider to Emby (all tuners)?\n\n" +
        "It gives a channel one all-day guide block per day, titled with the channel's current M3U name. " +
        "Only channels whose guide source you set to it are affected. Emby queues a Refresh Guide afterwards.")) return Promise.resolve("");
      S.enablingDummy = true;
      renderCounters();
      return ApiClient.ajax({
        type: "POST",
        url: apiUrl("LiveTv/ListingProviders", { ValidateListings: true }),
        data: JSON.stringify({ Type: DUMMY_TYPE, Name: DUMMY_NAME, EnableAllTuners: true, EnabledTuners: [] }),
        contentType: "application/json"
      }).then(function () {
        return apiGet("LiveTv/ListingProviders");
      }).then(function (list) {
        S.enablingDummy = false;
        setProviders(list || []);
        renderFilterOptions();
        renderAll();
        if (S.dummyPid) loadOptions(S.dummyPid);
        toast(DUMMY_NAME + " enabled. Set a channel's guide source to it (or use Set guide source\u2026), then Save.");
        return S.dummyPid;
      }, function (err) {
        S.enablingDummy = false;
        renderCounters();
        return errorText(err).then(function (m) { toast("Could not add " + DUMMY_NAME + ": " + m); return ""; });
      });
    }

    // ------------------------------------------------------------ save pipeline
    function setProgress(done, total, text) {
      var p = $(".iptvm-progress");
      p.classList.toggle("iptvm-show", total > 0);
      $(".iptvm-progress-text").textContent = text || "";
      p.querySelector(".iptvm-bar>div").style.width = (total ? Math.round(done * 100 / total) : 0) + "%";
    }
    function showResults(html, ok) {
      var el = $(".iptvm-results");
      el.innerHTML = html || "";
      el.classList.toggle("iptvm-show", !!html);
      el.classList.toggle("iptvm-ok", !!ok);
    }
    function rowLabel(r) { return (r.cur.number ? r.cur.number + " " : "") + (r.cur.name || r.orig.name); }

    /** Builds the ordered task list. Order: item number/name/group -> logo URL -> logo upload -> logo copy -> guide mapping -> enabled
     *  (item writes first because disabling a channel deletes its library item). */
    function buildTasks(preErrors) {
      var phases = { item: [], logo: [], logoUpload: [], logoCopy: [], guide: [], enabled: [] };
      S.rows.forEach(function (r) {
        var ch = changedFields(r);
        if (!ch.length) return;
        var itemFields = ch.filter(function (f) { return f === "number" || f === "name" || f === "group"; });
        if (itemFields.length) {
          if (!r.inLibrary || !r.orig.enabled) itemFields.forEach(function (f) { preErrors.push({ r: r, field: f, error: "Channel is disabled/not in the library yet; enable, save, wait for the refresh, then edit." }); });
          else phases.item.push({ type: "item", r: r, fields: itemFields });
        }
        if (ch.indexOf("logo") >= 0 && r.cur.logo) {
          if (!r.inLibrary || !r.orig.enabled) preErrors.push({ r: r, field: "logo", error: "Channel is disabled/not in the library yet." });
          else if (r.cur.logo.indexOf(COPY_PREFIX) === 0) phases.logoCopy.push({ type: "logocopy", r: r, fields: ["logo"] });
          else if (r.cur.logo.indexOf(UPLOAD_PREFIX) === 0) {
            if (!uploadOf(r.cur.logo)) preErrors.push({ r: r, field: "logo", error: "Uploaded image is no longer in memory; choose the file again." });
            else phases.logoUpload.push({ type: "logoupload", r: r, fields: ["logo"] });
          }
          else phases.logo.push({ type: "logo", r: r, fields: ["logo"] });
        }
        if (ch.indexOf("guide") >= 0) phases.guide.push({ type: "guide", r: r, fields: ["guide"] });
        if (ch.indexOf("enabled") >= 0) phases.enabled.push({ type: "enabled", r: r, fields: ["enabled"] });
      });
      // URL downloads run before copies, so a copy picks up a source's freshly downloaded logo.
      return phases.item.concat(phases.logo, phases.logoUpload, phases.logoCopy, phases.guide, phases.enabled);
    }

    function runTask(t, uid) {
      var r = t.r;
      if (t.type === "item") {
        return apiGet("Users/" + uid + "/Items/" + r.itemId).then(function (item) {
          var locked = (item.LockedFields || []).slice();
          if (t.fields.indexOf("name") >= 0) { item.Name = r.cur.name; if (locked.indexOf("Name") < 0) locked.push("Name"); }
          if (t.fields.indexOf("number") >= 0) { item.ChannelNumber = r.cur.number; if (locked.indexOf("ChannelNumber") < 0) locked.push("ChannelNumber"); }
          if (t.fields.indexOf("group") >= 0) {
            // Group = TvChannel Tags. Emby's item update prefers TagItems over Tags; refresh skips Tags while "Tags" is locked.
            var reset = isM3uGroup(r, r.cur.group);
            var names = reset ? r.m3uTags.slice() : (r.cur.group ? [r.cur.group] : []);
            var existing = {};
            (item.TagItems || []).forEach(function (ti) { if (ti && ti.Name) existing[ti.Name.toLowerCase()] = ti; });
            item.TagItems = names.map(function (n) { var e = existing[n.toLowerCase()]; return e && e.Id ? { Name: n, Id: e.Id } : { Name: n }; });
            item.Tags = names.slice();
            if (reset) locked = locked.filter(function (f) { return f !== "Tags"; });
            else if (locked.indexOf("Tags") < 0) locked.push("Tags");
          }
          item.LockedFields = locked;
          return apiPost("Items/" + r.itemId, null, JSON.stringify(item), "application/json");
        });
      }
      if (t.type === "logo") {
        return apiPost("Items/" + r.itemId + "/RemoteImages/Download", { Type: "Primary", ImageUrl: r.cur.logo });
      }
      if (t.type === "logoupload") {
        var up = uploadOf(r.cur.logo);
        if (!up) return Promise.reject(new Error("Uploaded image is no longer in memory"));
        // Same request as Emby's web client image uploader: base64 body, Content-Type = image type.
        return apiPost("Items/" + r.itemId + "/Images/Primary", null, up.b64, up.type);
      }
      if (t.type === "logocopy") {
        return copyPrimaryImage(r.cur.logo.substring(COPY_PREFIX.length), r.itemId);
      }
      if (t.type === "guide") {
        var g = r.cur.guide;
        // Same request shape as Emby's own metadata editor (form body; providerId "" = auto, "none" = no guide).
        return apiPost("LiveTv/ChannelMappings", null,
          formEncode({ providerId: g.p, tunerChannelId: r.managementId, providerChannelId: g.p && g.p !== "none" ? g.c : "" }),
          "application/x-www-form-urlencoded; charset=UTF-8");
      }
      if (t.type === "enabled") {
        return apiPost("LiveTv/Manage/Channels/" + encodeURIComponent(r.itemId || r.managementId) + "/Disabled",
          { ManagementId: r.managementId, Disabled: r.cur.enabled ? "false" : "true" });
      }
      return Promise.reject(new Error("unknown task " + t.type));
    }

    function isM3uGroup(r, value) {
      return !!(r.m3uTags && r.m3uTags.length) && value === r.m3uTags.join(", ");
    }

    // ---- image copy (same upload format as Emby's web client: base64 body, image/png or image/jpeg)
    function blobToDataUrl(blob) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = function () { reject(new Error("Cannot read image data")); };
        fr.readAsDataURL(blob);
      });
    }
    function sniffImageType(blob) {
      return new Promise(function (resolve) {
        var fr = new FileReader();
        fr.onload = function () {
          var b = new Uint8Array(fr.result);
          if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) resolve("image/png");
          else if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) resolve("image/jpeg");
          else resolve("");
        };
        fr.onerror = function () { resolve(""); };
        fr.readAsArrayBuffer(blob.slice(0, 8));
      });
    }
    /** Re-encodes any browser-decodable image (webp, gif, svg...) to PNG via canvas. */
    function convertToPng(blob) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(blob), img = new Image();
        img.onload = function () {
          try {
            var c = document.createElement("canvas");
            c.width = img.naturalWidth || 1; c.height = img.naturalHeight || 1;
            c.getContext("2d").drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            c.toBlob(function (b) { if (b) resolve(b); else reject(new Error("PNG conversion failed")); }, "image/png");
          } catch (e) { URL.revokeObjectURL(url); reject(e); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Source image could not be decoded")); };
        img.src = url;
      });
    }
    function copyPrimaryImage(srcItemId, targetItemId) {
      var headers = {};
      try { var tok = ApiClient.accessToken(); if (tok) headers["X-Emby-Token"] = tok; } catch (e) { /* ignore */ }
      var src = S.byItemId[srcItemId];
      var q = src && src.primaryTag ? { tag: src.primaryTag } : {}; // original size (no maxHeight)
      return fetch(apiUrl("Items/" + srcItemId + "/Images/Primary", q), { headers: headers, cache: "no-store" }).then(function (res) {
        if (!res.ok) { var err = new Error("Source image: HTTP " + res.status); throw err; }
        return res.blob();
      }).then(function (blob) {
        return sniffImageType(blob).then(function (type) {
          if (type) return { blob: blob, type: type };
          return convertToPng(blob).then(function (png) { return { blob: png, type: "image/png" }; });
        });
      }).then(function (img) {
        return blobToDataUrl(img.blob).then(function (dataUrl) {
          return apiPost("Items/" + targetItemId + "/Images/Primary", null, String(dataUrl).split(",")[1], img.type);
        });
      });
    }

    function save() {
      if (S.saving) return;
      closeCombo();
      try { if (document.activeElement && view.contains(document.activeElement)) document.activeElement.blur(); } catch (e) { /* commit pending input */ }
      var preErrors = [];
      var tasks = buildTasks(preErrors);
      if (!tasks.length && !preErrors.length) return;
      var nGuide = tasks.filter(function (t) { return t.type === "guide" || t.type === "enabled"; }).length;
      var msg = "Apply " + tasks.length + " change(s) to Emby?" + (nGuide ? "\n\n" + nGuide + " guide/enable change(s) each queue Emby's channel refresh task." : "") +
        (preErrors.length ? "\n\n" + preErrors.length + " change(s) cannot be applied yet and will stay pending." : "");
      if (!window.confirm(msg)) return;
      var uid = currentUserId();
      if (!uid && tasks.some(function (t) { return t.type === "item"; })) { toast("Cannot determine the current user id."); return; }

      S.saving = true;
      renderCounters();
      var ok = [], failed = preErrors.slice();
      var done = 0;
      var chain = tasks.reduce(function (p, t) {
        return p.then(function () {
          setProgress(done, tasks.length, "Saving " + (done + 1) + " / " + tasks.length + ": " + rowLabel(t.r) + " \u2014 " + t.fields.map(function (f) { return FIELD_LABELS[f]; }).join(" + "));
          return runTask(t, uid).then(function () {
            t.fields.forEach(function (f) { ok.push({ r: t.r, field: f, before: cloneVal(f, t.r.orig[f]), after: cloneVal(f, t.r.cur[f]) }); });
          }, function (err) {
            return errorText(err).then(function (m) { t.fields.forEach(function (f) { failed.push({ r: t.r, field: f, error: m }); }); });
          }).then(function () { done++; setProgress(done, tasks.length, ""); });
        });
      }, Promise.resolve());

      chain.then(function () {
        setProgress(tasks.length, tasks.length, "Storing overrides and snapshot\u2026");
        return ok.length ? storeConfig(ok).then(null, function (err) {
          return errorText(err).then(function (m) { failed.push({ r: null, field: "config", error: "Plugin configuration not saved: " + m }); });
        }) : null;
      }).then(function () {
        S.saving = false;
        setProgress(0, 0, "");
        var reapply = failed.filter(function (f) { return f.r; }).map(function (f) { return { key: f.r.key, field: f.field, value: cloneVal(f.field, f.r.cur[f.field]), error: f.error }; });
        var html = "";
        if (failed.length) {
          html = "<b>" + ok.length + " change(s) saved, " + failed.length + " failed</b> (failed edits stay pending):<br/>" + failed.map(function (f) {
            return esc(f.r ? rowLabel(f.r) : "Plugin") + " \u2014 " + esc(FIELD_LABELS[f.field] || f.field) + ": " + esc(f.error);
          }).join("<br/>");
        } else {
          html = "<b>" + ok.length + " change(s) saved.</b>" + (nGuide ? " Emby queued a channel refresh; re-enabled channels appear after it finishes (use Reload)." : "");
        }
        showResults(html, !failed.length);
        return loadAll(reapply);
      });
    }

    /** Snapshot encoding; uploads are recorded by file name only ("upload:<filename>"). */
    function snapVal(field, v) {
      if (field === "logo" && v && v.indexOf(UPLOAD_PREFIX) === 0) { var up = uploadOf(v); return UPLOAD_PREFIX + (up ? up.name : "?"); }
      return encodeVal(field, v);
    }
    function storeConfig(ok) {
      return ApiClient.getPluginConfiguration(PLUGIN_ID).then(null, function () { return {}; }).then(function (cfg) {
        cfg = normalizeConfig(cfg);
        var byKey = {};
        cfg.Overrides.forEach(function (o) { if (o && o.Key) byKey[o.Key] = o; });
        var stamp = nowIso();
        var changes = [];
        ok.forEach(function (c) {
          var r = c.r;
          var o = byKey[r.key];
          if (!o) { o = byKey[r.key] = { Key: r.key, HasGuideOverride: false }; cfg.Overrides.push(o); }
          o.TunerHostId = r.tunerHostId;
          o.ManagementId = r.managementId;
          o.ItemId = r.itemId;
          o.SeenTvgId = r.tvgId || null;
          o.SeenM3uName = r.m3uName || null;
          o.SeenM3uNumber = r.m3uNumber || null;
          o.SeenM3uGroup = r.m3uGroup || null;
          o.SeenM3uLogoUrl = r.m3uLogoUrl || null;
          o.UpdatedUtc = stamp;
          if (c.field === "number") o.Number = c.after;
          else if (c.field === "name") o.Name = c.after;
          else if (c.field === "group") o.Group = isM3uGroup(r, c.after) ? null : c.after;
          else if (c.field === "logo") {
            o.LogoFileName = null;
            if (c.after && c.after.indexOf(COPY_PREFIX) === 0) {
              var srcRow = logoCopySource(c.after);
              o.LogoUrl = null;
              o.LogoSource = "copy";
              o.LogoSourceItemId = c.after.substring(COPY_PREFIX.length);
              o.LogoSourceKey = srcRow ? srcRow.key : null;
            } else if (c.after && c.after.indexOf(UPLOAD_PREFIX) === 0) {
              var up = uploadOf(c.after);
              o.LogoUrl = null; o.LogoSourceItemId = null; o.LogoSourceKey = null;
              o.LogoSource = "upload";
              o.LogoFileName = up ? up.name : null; // image bytes are never stored in the config
            } else { o.LogoUrl = c.after || null; o.LogoSource = c.after ? "url" : null; o.LogoSourceItemId = null; o.LogoSourceKey = null; }
          }
          else if (c.field === "guide") { o.HasGuideOverride = true; o.ListingsProviderId = c.after.p; o.ListingsChannelId = c.after.c || null; }
          else if (c.field === "enabled") o.Disabled = !c.after;
          changes.push({ Key: r.key, Label: rowLabel(r), ItemId: r.itemId, ManagementId: r.managementId, Field: c.field, Before: snapVal(c.field, c.before), After: snapVal(c.field, c.after) });
        });
        var rowsTouched = {};
        ok.forEach(function (c) { rowsTouched[c.r.key] = 1; });
        cfg.Snapshots.unshift({
          Id: String(Date.now()), DateUtc: stamp,
          Summary: changes.length + " change(s) on " + Object.keys(rowsTouched).length + " channel(s)",
          Changes: changes
        });
        cfg.Snapshots = cfg.Snapshots.slice(0, cfg.MaxSnapshots || MAX_SNAPSHOTS);
        return ApiClient.updatePluginConfiguration(PLUGIN_ID, cfg).then(function () { S.config = cfg; });
      });
    }

    // ------------------------------------------------------------ events
    function rowFromEvent(e) {
      var tr = e.target.closest && e.target.closest("tr[data-key]");
      return tr ? S.byKey[tr.getAttribute("data-key")] : null;
    }
    function onTbodyChange(e) {
      var t = e.target, r = rowFromEvent(e);
      if (!r || S.saving) return;
      var f = t.getAttribute("data-field");
      if (f === "number" || f === "name") {
        if (t.readOnly) return;
        applyEdit([{ key: r.key, field: f, value: f === "number" ? t.value.trim() : t.value.replace(/\s+$/, "") }]);
      } else if (f === "enabled") {
        applyEdit([{ key: r.key, field: "enabled", value: t.checked }]);
      } else if (f === "source") {
        var g = guideForSource(r, t.value);
        applyEdit([{ key: r.key, field: "guide", value: g }]);
        if (g.p && g.p !== "none" && !g.c) {
          var tr = $(".iptvm-tbody").querySelector('tr[data-key="' + cssEsc(r.key) + '"]');
          var btn = tr && tr.querySelector(".iptvm-guidebtn");
          if (btn && !btn.disabled) openCombo(r, btn);
        }
      }
    }
    function cssEsc(s) { try { return CSS.escape(s); } catch (e) { return String(s).replace(/["\\]/g, "\\$&"); } }
    function onTbodyClick(e) {
      var actEl = e.target.closest && e.target.closest("[data-act]");
      if (!actEl || S.saving) return;
      var r = rowFromEvent(e);
      if (!r) return;
      var act = actEl.getAttribute("data-act");
      if (act === "select") { toggleSelect(r, actEl.checked, e.shiftKey); return; }
      if (act === "group") { if (combo.open && combo.mode === "group" && combo.row === r) closeCombo(); else openGroupCombo(r, actEl); return; }
      if (act === "logo") openLogo(r);
      else if (act === "channel") { if (combo.open && combo.mode === "guide" && combo.row === r) closeCombo(); else openCombo(r, actEl); }
      else if (act === "revert") revertRow(r);
    }
    function toggleSelect(r, checked, range) {
      var idx = S.visible.indexOf(r);
      if (range && S.lastSelIdx != null && idx >= 0) {
        var a = Math.min(S.lastSelIdx, idx), b = Math.max(S.lastSelIdx, idx);
        for (var i = a; i <= b; i++) { if (checked) S.selected[S.visible[i].key] = true; else delete S.selected[S.visible[i].key]; }
      } else if (checked) S.selected[r.key] = true;
      else delete S.selected[r.key];
      S.lastSelIdx = idx;
      syncSelectionUi();
    }
    function syncSelectionUi() {
      var trs = $(".iptvm-tbody").querySelectorAll("tr[data-key]");
      for (var i = 0; i < trs.length; i++) {
        var on = !!S.selected[trs[i].getAttribute("data-key")];
        trs[i].classList.toggle("iptvm-row-selected", on);
        var cb = trs[i].querySelector('input[data-act="select"]');
        if (cb) cb.checked = on;
      }
      renderCounters();
    }
    function selectAllVisible(on) {
      S.visible.forEach(function (r) { if (on) S.selected[r.key] = true; else delete S.selected[r.key]; });
      syncSelectionUi();
    }
    function onTbodyKeydown(e) {
      var t = e.target;
      if (!t.classList || !t.classList.contains("iptvm-in")) return;
      if (e.key === "Enter") { e.preventDefault(); t.blur(); }
      else if (e.key === "Escape") { t.value = t.getAttribute("data-committed") || ""; t.blur(); }
    }
    function onHeaderClick(e) {
      if (e.target.classList && e.target.classList.contains("iptvm-sel-all")) return;
      var th = e.target.closest && e.target.closest("th[data-sort]");
      if (!th) return;
      var col = th.getAttribute("data-sort");
      if (S.sort.col !== col) S.sort = { col: col, dir: 1 };
      else if (S.sort.dir === 1) S.sort.dir = -1;
      else S.sort = { col: "", dir: 1 };
      renderAll();
    }
    function onComboKey(e) {
      if (e.key === "ArrowDown") { e.preventDefault(); combo.active = Math.min(combo.results.length - 1, combo.active + 1); markActive(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); combo.active = Math.max(0, combo.active - 1); markActive(); }
      else if (e.key === "PageDown") { e.preventDefault(); combo.active = Math.min(combo.results.length - 1, combo.active + 10); markActive(); }
      else if (e.key === "PageUp") { e.preventDefault(); combo.active = Math.max(0, combo.active - 10); markActive(); }
      else if (e.key === "Enter") { e.preventDefault(); chooseCombo(combo.active); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeCombo(); }   // Esc closes only the picker, not the dialog under it
    }
    function markActive() {
      var opts = $(".iptvm-combo-list").querySelectorAll(".iptvm-opt");
      for (var i = 0; i < opts.length; i++) opts[i].classList.toggle("iptvm-active", i === combo.active);
      scrollActive();
    }
    function onDocMouseDown(e) {
      if (combo.open && !$(".iptvm-combo").contains(e.target) && !(e.target.closest && e.target.closest(".iptvm-chbtn,.iptvm-act-bulklogo,.iptvm-act-bulksrc,.iptvm-logo-copy"))) closeCombo();
    }
    function isEditingText(t) {
      if (!t) return false;
      var tag = (t.tagName || "").toLowerCase();
      if (tag === "textarea") return true;
      if (tag !== "input") return false;
      var type = (t.type || "text").toLowerCase();
      if (type !== "text" && type !== "search" && type !== "url") return false;
      // Let native undo work while the user has uncommitted typing in a cell / filter box.
      if (t.classList.contains("iptvm-in")) return t.value !== (t.getAttribute("data-committed") || "");
      return true;
    }
    function onDocKeydown(e) {
      if (!view.isConnected || view.classList.contains("hide") || !S.loaded) return;
      if ($(".iptvm-logo-overlay").classList.contains("iptvm-show") || $(".iptvm-snap-overlay").classList.contains("iptvm-show")) {
        if (e.key === "Escape") { if (combo.open) closeCombo(); else { closeLogo(); $(".iptvm-snap-overlay").classList.remove("iptvm-show"); } }
        return;
      }
      var mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      var k = (e.key || "").toLowerCase();
      if (k !== "z" && k !== "y") return;
      if (isEditingText(e.target)) return;
      e.preventDefault();
      if (k === "y" || (k === "z" && e.shiftKey)) redo(); else undo();
    }
    function onBeforeUnload(e) {
      if (S.loaded && pendingCount() > 0) { e.preventDefault(); e.returnValue = ""; return ""; }
    }
    function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

    function wire() {
      var tbody = $(".iptvm-tbody");
      tbody.addEventListener("change", onTbodyChange);
      tbody.addEventListener("click", onTbodyClick);
      tbody.addEventListener("keydown", onTbodyKeydown);
      view.querySelector(".iptvm-table thead").addEventListener("click", onHeaderClick);
      ClawColResize.attach(view.querySelector(".iptvm-table"), "claw.iptvmapper.cols.channels");
      $(".iptvm-f-search").addEventListener("input", debounce(renderAll, 120));
      [".iptvm-f-tuner", ".iptvm-f-group", ".iptvm-f-source", ".iptvm-f-status"].forEach(function (s) { $(s).addEventListener("change", renderAll); });
      $(".iptvm-act-clearfilters").addEventListener("click", function () {
        $(".iptvm-f-search").value = ""; $(".iptvm-f-tuner").value = ""; $(".iptvm-f-group").value = ""; $(".iptvm-f-source").value = ""; $(".iptvm-f-status").value = "";
        renderAll();
      });
      $(".iptvm-act-undo").addEventListener("click", undo);
      $(".iptvm-act-redo").addEventListener("click", redo);
      $(".iptvm-act-discard").addEventListener("click", discardAll);
      $(".iptvm-act-save").addEventListener("click", save);
      $(".iptvm-act-reload").addEventListener("click", function () {
        if (pendingCount() && !window.confirm("Discard " + pendingCount() + " pending change(s) and reload?")) return;
        showResults("");
        loadAll();
      });
      $(".iptvm-act-snapshots").addEventListener("click", openSnapshots);
      $(".iptvm-act-enabledummy").addEventListener("click", function () { enableDummyGuide(); });
      $(".iptvm-sel-all").addEventListener("change", function (e) { selectAllVisible(e.target.checked); });
      $(".iptvm-act-clearsel").addEventListener("click", function () { S.selected = {}; syncSelectionUi(); });
      $(".iptvm-act-bulklogo").addEventListener("click", function (e) {
        if (combo.open && combo.mode === "logosrc") { closeCombo(); return; }
        openLogoSrcCombo(e.currentTarget, bulkCopyLogo, {});
      });
      $(".iptvm-act-bulksrc").addEventListener("click", function (e) {
        if (combo.open && combo.mode === "gsrc") { closeCombo(); return; }
        openGsrcCombo(e.currentTarget);
      });
      $(".iptvm-act-bulkupload").addEventListener("click", function () { closeCombo(); $(".iptvm-bulk-file").click(); });
      $(".iptvm-bulk-file").addEventListener("change", function (e) {
        var f = e.target.files && e.target.files[0];
        e.target.value = "";
        if (f) bulkUploadFile(f);
      });
      $(".iptvm-logo-upload").addEventListener("click", function () { closeCombo(); $(".iptvm-logo-file").click(); });
      $(".iptvm-logo-file").addEventListener("change", function (e) {
        var f = e.target.files && e.target.files[0];
        e.target.value = "";
        if (f) logoDlgUseFile(f);
      });
      var dlg = $(".iptvm-logo-overlay .iptvm-dlg");
      dlg.addEventListener("dragenter", onDlgDragOver);
      dlg.addEventListener("dragover", onDlgDragOver);
      dlg.addEventListener("dragleave", onDlgDragLeave);
      dlg.addEventListener("drop", onDlgDrop);
      // A file dropped next to the dialog must not navigate the browser away.
      $(".iptvm-logo-overlay").addEventListener("dragover", function (e) { e.preventDefault(); });
      $(".iptvm-logo-overlay").addEventListener("drop", function (e) { if (!dlg.contains(e.target)) e.preventDefault(); });
      $(".iptvm-logo-copy").addEventListener("click", function (e) {
        var r = logoDlg.row;
        if (!r) return;
        var ex = {}; ex[r.key] = true;
        openLogoSrcCombo(e.currentTarget, function (src) {
          logoDlg.copySrc = src; logoDlg.upload = "";
          $(".iptvm-logo-url").value = "";
          previewLogo();
        }, ex);
      });
      $(".iptvm-combo-input").addEventListener("input", function () { combo.active = 0; renderCombo(); });
      $(".iptvm-combo-input").addEventListener("keydown", onComboKey);
      $(".iptvm-combo-list").addEventListener("mousedown", function (e) {
        var opt = e.target.closest && e.target.closest(".iptvm-opt[data-idx]");
        if (!opt) return;
        e.preventDefault();
        chooseCombo(parseInt(opt.getAttribute("data-idx"), 10));
      });
      $(".iptvm-wrap").addEventListener("scroll", function () { if (combo.open) closeCombo(); });
      $(".iptvm-logo-url").addEventListener("input", debounce(function () { if ($(".iptvm-logo-url").value.trim()) { logoDlg.copySrc = null; logoDlg.upload = ""; } previewLogo(); }, 300));
      $(".iptvm-logo-url").addEventListener("keydown", function (e) { if (e.key === "Enter") applyLogo(); });
      $(".iptvm-logo-apply").addEventListener("click", applyLogo);
      $(".iptvm-logo-cancel").addEventListener("click", closeLogo);
      $(".iptvm-logo-clear").addEventListener("click", function () { $(".iptvm-logo-url").value = ""; logoDlg.copySrc = null; logoDlg.upload = ""; previewLogo(); });
      $(".iptvm-logo-usem3u").addEventListener("click", function () { if (logoDlg.row) { $(".iptvm-logo-url").value = logoDlg.row.m3uLogoUrl; logoDlg.copySrc = null; logoDlg.upload = ""; previewLogo(); } });
      $(".iptvm-snap-close").addEventListener("click", function () { $(".iptvm-snap-overlay").classList.remove("iptvm-show"); });
      $(".iptvm-snap-list").addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("[data-snap]");
        if (b) loadSnapshot(parseInt(b.getAttribute("data-snap"), 10));
      });
    }

    wire();
    view.addEventListener("viewshow", function () {
      document.addEventListener("keydown", onDocKeydown);
      document.addEventListener("mousedown", onDocMouseDown, true);
      document.addEventListener("paste", onDocPaste);
      window.addEventListener("beforeunload", onBeforeUnload);
      if (!S.loaded || !pendingCount()) loadAll();
    });
    view.addEventListener("viewhide", function () {
      closeCombo();
      document.removeEventListener("keydown", onDocKeydown);
      document.removeEventListener("mousedown", onDocMouseDown, true);
      document.removeEventListener("paste", onDocPaste);
      window.removeEventListener("beforeunload", onBeforeUnload);
    });

    // Exposed for offline testing only (no secrets in here).
    view._iptvMapper = { state: S, combo: combo, undo: undo, redo: redo, applyEdit: applyEdit, renderAll: renderAll, fuzzyScore: fuzzyScore, comboSearch: comboSearch, loadOptions: loadOptions, buildTasks: buildTasks, bulkCopyLogo: bulkCopyLogo, copyPrimaryImage: copyPrimaryImage, processUpload: processUpload, bulkSetSource: bulkSetSource, guideForSource: guideForSource, bulkUploadFile: bulkUploadFile, enableDummyGuide: enableDummyGuide };
  }

  return View;
});
