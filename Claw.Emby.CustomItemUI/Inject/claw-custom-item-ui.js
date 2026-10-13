/**
 * Claw Emby Custom Item UI - injected by plugin (no browser extension needed)
 * Plugin id placeholder replaced at deploy time: __PLUGIN_ID__
 */
(function () {
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


  var PLUGIN_ID = "__PLUGIN_ID__";
  var MARK = "data-claw-ui";
  var HOST_CLASS = "claw-links-host";
  var cfg = null;
  var cfgTried = false;

  var defaults = {
    Enabled: true,
    EnableMoveLinksUp: true,
    LinksInsertAfter: "recordingEditor",
    LinksOrder: 8,
    HideLinksHeading: true,
    AlignLinksLeft: true,
    RemoveLinkCommas: true,
    LinksGap: ".5em",
    EnableVlcPathLinks: true,
    VlcUrlTemplate: "cvlc:///file:///{path}",
    ShowVlcIcon: true,
    EnableRaisedLinkButtons: true,
    ButtonBorderRadius: "1.5em",
    ButtonTextColor: "#ffffff",
    ButtonCustomCss: "",
    ApplyMode: "all",
    AllowedUserNames: "",
    AllowedUserIds: "",
    EnableDashboardLayout: true,
    DashboardSections: null,
    DashboardStackBelowPx: 960,
    DashboardFillRows: true,
    DashboardAlertsLimit: 4,
    DashboardActivityLimit: 10,
    DashboardNowPlayingPerRow: 0,
    DashboardActivityTable: true,
    DashboardAlertsTable: true
  };

  function mergeCfg(c) {
    var out = {};
    Object.keys(defaults).forEach(function (k) {
      out[k] = c && c[k] != null ? c[k] : defaults[k];
    });
    return out;
  }

  function splitList(s) {
    return String(s || "")
      .split(",")
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
  }

  function userAllowed(user) {
    var c = cfg || defaults;
    var mode = (c.ApplyMode || "all").toLowerCase();
    if (mode === "all") return true;
    if (!user) return false;
    if (mode === "admins") return !!(user.Policy && user.Policy.IsAdministrator);
    var names = splitList(c.AllowedUserNames).map(function (n) { return n.toLowerCase(); });
    var ids = splitList(c.AllowedUserIds).map(function (n) { return n.toLowerCase(); });
    var uname = (user.Name || "").toLowerCase();
    var uid = String(user.Id || "").toLowerCase();
    return names.indexOf(uname) >= 0 || ids.indexOf(uid) >= 0;
  }

  // One shared config fetch. force=true re-reads it (every item/dashboard show) so saved
  // settings apply without a page reload. A failed fetch keeps the last good config.
  var cfgPromise = null;
  function loadConfig(force) {
    if (cfgPromise && !force) return cfgPromise;
    if (typeof ApiClient === "undefined" || !ApiClient.getPluginConfiguration) {
      cfg = cfg || mergeCfg(null);
      cfgPromise = Promise.resolve(cfg);
      return cfgPromise;
    }
    cfgTried = true;
    var p = ApiClient.getPluginConfiguration(PLUGIN_ID).then(
      function (c) { cfg = mergeCfg(c); return cfg; },
      function () { cfg = cfg || mergeCfg(null); return cfg; }
    );
    cfgPromise = p;
    return p;
  }

  // ===================================================================
  // Item page (Links up, raised link buttons, VLC path links).
  //
  // Emby keeps up to 3 views in the DOM (hidden ones carry .page-hidden) and renders an
  // item asynchronously AFTER viewshow, again whenever metadata changes, and into a reused
  // view when you go back. So everything here is scoped to ONE item view, driven by a
  // debounced MutationObserver on that view while it is shown, and idempotent: each pass
  // re-checks the actual DOM instead of trusting a "done" flag.
  // ===================================================================
  var VLC_CLASS = "claw-vlc-link";
  var ITEM_MARKERS = ".linksSection, .mediaSources";
  var ITEM_WATCH = ".linksSection, .itemLinks, .mediaSources, .mediaSource, .verticalFieldItem.recordingEditor, .verticalFieldItem.directors, .verticalFieldItem.overview-container";
  var ITEM_DEBOUNCE_MS = 60;
  var ITEM_MAX_WAIT_MS = 300;

  function encodeVlcPath(path) {
    return encodeURIComponent(path).replace(/[!'()*]/g, function (c) {
      return escape(c);
    });
  }

  function looksLikePath(text) {
    if (!text) return false;
    var t = text.trim();
    if (t.length < 3) return false;
    return /^[A-Za-z]:[\\/]/.test(t) || /^\\\\[^\\]/.test(t) || /^\//.test(t);
  }

  function styleLinkAsRaisedButton(a) {
    if (!a || a.nodeType !== 1 || a.classList.contains(VLC_CLASS)) return;
    if (!a.classList.contains("claw-link-btn") || a.classList.contains("button-link")) {
      a.classList.remove(
        "button-link",
        "button-link-color-inherit",
        "button-link-fontweight-inherit",
        "nobackdropfilter"
      );
      a.classList.add("raised", "item-tag-button", "emby-button", "button-hoverable", "claw-link-btn");
      a.style.borderRadius = "";
    }
    var prev = a.previousSibling;
    if (prev && prev.nodeType === 3 && /^\s*,\s*$/.test(prev.textContent)) {
      prev.textContent = "";
    }
  }

  var LINK_CSS_ID = "claw-link-btn-css";

  function buildLinkCss(c) {
    var sel = ".itemLinks a.claw-link-btn";
    var out = sel + "{border-radius:" + (c.ButtonBorderRadius || "1.5em") + " !important;";
    var color = (c.ButtonTextColor == null ? "#ffffff" : String(c.ButtonTextColor)).trim();
    if (color) out += "color:" + color + " !important;";
    out += "}\n";
    var custom = (c.ButtonCustomCss || "").trim();
    if (custom) {
      if (custom.indexOf("{") >= 0) {
        out += custom + "\n";
      } else {
        var decls = custom.split(";").map(function (d) { return d.trim(); }).filter(Boolean).map(function (d) {
          return /!important\s*$/i.test(d) ? d : d + " !important";
        });
        out += sel + "{" + decls.join(";") + "}\n";
      }
    }
    return out;
  }

  function applyLinkCss(c) {
    var el = document.getElementById(LINK_CSS_ID);
    if (!c.EnableRaisedLinkButtons) {
      if (el) el.textContent = "";
      return;
    }
    var css = buildLinkCss(c);
    if (!el) {
      el = document.createElement("style");
      el.id = LINK_CSS_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
  }

  function styleItemLinks(view, c) {
    applyLinkCss(c);
    if (!c.EnableRaisedLinkButtons) return;
    view.querySelectorAll(".itemLinks a, .linksSection a").forEach(styleLinkAsRaisedButton);
  }

  function vlcHref(path, c) {
    return String(c.VlcUrlTemplate || "cvlc:///file:///{path}").split("{path}").join(encodeVlcPath(path));
  }

  function fillVlcAnchor(a, path, c) {
    a.textContent = "";
    if (c.ShowVlcIcon) {
      var i = document.createElement("i");
      i.className = "md-icon button-icon button-icon-left";
      i.textContent = "queue_play_next";
      a.appendChild(i);
    }
    a.appendChild(document.createTextNode(path));
    a.setAttribute("data-claw-icon", c.ShowVlcIcon ? "1" : "0");
  }

  // Idempotent: a path div is "done" only if its sole child is OUR anchor for its current
  // path. If Emby re-renders the div (new text, new node, new container) it is wrapped again.
  function wrapPathDiv(div, c) {
    if (!div || div.nodeType !== 1) return;
    if (div.classList.contains("mediaInfoItems") || div.classList.contains("itemsContainer") || div.classList.contains("emby-scroller")) return;
    var mine = null;
    for (var k = 0; k < div.children.length; k++) {
      if (div.children[k].classList.contains(VLC_CLASS)) { mine = div.children[k]; break; }
    }
    if (mine) {
      var p = mine.getAttribute("data-claw-path") || "";
      if (div.childNodes.length !== 1 || !p) return; // something else changed it; leave it alone
      var href = vlcHref(p, c);
      if (mine.getAttribute("href") !== href) mine.setAttribute("href", href);
      if (mine.getAttribute("data-claw-icon") !== (c.ShowVlcIcon ? "1" : "0")) fillVlcAnchor(mine, p, c);
      return;
    }
    if (div.children.length > 0) return; // not a leaf (wrappers, or a link someone else made)
    var path = (div.textContent || "").trim();
    if (!looksLikePath(path)) return;

    var a = document.createElement("a");
    a.setAttribute("is", "emby-linkbutton");
    a.className = "raised item-tag-button nobackdropfilter emby-button button-hoverable " + VLC_CLASS;
    a.style.color = "inherit";
    a.setAttribute("href", vlcHref(path, c));
    a.setAttribute("data-claw-path", path);
    fillVlcAnchor(a, path, c);
    div.textContent = "";
    div.appendChild(a);
    div.setAttribute(MARK, "vlc");
  }

  function unwrapVlcPaths(view) {
    view.querySelectorAll("a." + VLC_CLASS).forEach(function (a) {
      var div = a.parentElement;
      div.replaceChild(document.createTextNode(a.getAttribute("data-claw-path") || a.textContent), a);
      div.removeAttribute(MARK);
    });
  }

  function patchVlcPaths(view, c) {
    if (!c.EnableVlcPathLinks) { unwrapVlcPaths(view); return; }
    // Emby nests: .mediaSource > .padded-* > div > [path div] + .mediaInfoItems
    view.querySelectorAll(".mediaSources .mediaSource .mediaInfoItems").forEach(function (info) {
      var prev = info.previousElementSibling;
      if (prev) wrapPathDiv(prev, c);
    });
    // Fallback: any leaf div under .mediaSource whose text looks like a path
    view.querySelectorAll(".mediaSources .mediaSource div").forEach(function (div) {
      wrapPathDiv(div, c);
    });
  }

  function cleanLinks(view, c) {
    if (c.RemoveLinkCommas === false) return;
    view.querySelectorAll(".itemLinks a").forEach(function (a) {
      var last = a.lastChild;
      if (last && last.nodeType === 3 && /,\s*$/.test(last.textContent)) {
        last.textContent = last.textContent.replace(/,\s*$/, "");
      }
      var prev = a.previousSibling;
      if (prev && prev.nodeType === 3 && /^\s*,\s*$/.test(prev.textContent)) {
        prev.textContent = "";
      }
    });
  }

  function alignLinks(view, c) {
    if (c.AlignLinksLeft === false) return;
    var gap = c.LinksGap || ".5em";
    view.querySelectorAll(".linksSection." + HOST_CLASS).forEach(function (sec) {
      [sec].concat(Array.prototype.slice.call(sec.querySelectorAll(".itemLinks"))).forEach(function (el) {
        el.classList.remove("padded-left", "padded-left-page", "padded-right", "sectionTitle-cards");
        el.style.paddingLeft = "0";
        el.style.paddingRight = "0";
        el.style.marginLeft = "0";
        el.style.marginRight = "0";
        el.style.textAlign = "left";
      });
      sec.querySelectorAll(".itemLinks").forEach(function (el) {
        el.style.display = "flex";
        el.style.flexWrap = "wrap";
        el.style.justifyContent = "flex-start";
        el.style.alignItems = "center";
        el.style.gap = gap;
        el.style.marginBottom = "0";
      });
    });
  }

  function findDetailFieldsContainer(view) {
    var anchor =
      view.querySelector(".verticalFieldItem.recordingEditor") ||
      view.querySelector(".verticalFieldItem.directors") ||
      view.querySelector(".verticalFieldItem.overview-container");
    return anchor ? anchor.parentElement : null;
  }

  function insertPoint(fields, c) {
    var key = c.LinksInsertAfter || "recordingEditor";
    var map = {
      recordingEditor: ".verticalFieldItem.recordingEditor",
      directors: ".verticalFieldItem.directors",
      overview: ".verticalFieldItem.overview-container"
    };
    var sel = map[key] || map.recordingEditor;
    return fields.querySelector(sel) || fields.querySelector(".verticalFieldItem.directors");
  }

  // Moves THIS view's links section (the one Emby's item.js renders into: the first
  // .linksSection in the view) up into the details fields. Only moves when it isn't
  // already in place, so repeated passes cause no DOM churn.
  function moveLinksUp(view, c) {
    if (!c.EnableMoveLinksUp) return;
    var fields = findDetailFieldsContainer(view);
    var sec = view.querySelector(".linksSection");
    if (!fields || !sec) return;
    sec.classList.add(HOST_CLASS);
    var order = String(c.LinksOrder != null ? c.LinksOrder : 8);
    if (sec.style.order !== order) sec.style.order = order;
    if (c.HideLinksHeading) {
      var h = sec.querySelector("h4.sectionTitle, h2.sectionTitle");
      if (h && h.style.display !== "none") h.style.display = "none";
    }
    var after = insertPoint(fields, c);
    if (after && after.parentElement === fields) {
      if (after.nextElementSibling !== sec) after.insertAdjacentElement("afterend", sec);
    } else if (sec.parentElement !== fields) {
      fields.appendChild(sec);
    }
  }

  function processItemView(view, c, user) {
    if (!c.Enabled || !userAllowed(user)) return;
    moveLinksUp(view, c);
    cleanLinks(view, c);
    styleItemLinks(view, c);
    alignLinks(view, c);
    patchVlcPaths(view, c);
  }

  // ---- per-view observer lifecycle ----
  var watchedViews = [];

  function itemViewOf(el) {
    if (!el || !el.closest) return null;
    return el.closest(".view") || el.closest(".page") || document.body;
  }

  function isItemView(v) {
    return !!(v && v.querySelector && v.querySelector(ITEM_MARKERS));
  }

  function isViewShown(v) {
    return v.isConnected && !v.classList.contains("page-hidden") && !v.classList.contains("hide");
  }

  function itemState(view) {
    if (!view.__clawItem) view.__clawItem = { obs: null, on: false, timer: 0, first: 0, gen: 0, user: undefined, userP: null };
    return view.__clawItem;
  }

  function touchesItemParts(records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (t && t.closest && t.closest(".linksSection, .mediaSources")) return true;
      var lists = [r.addedNodes, r.removedNodes];
      for (var l = 0; l < 2; l++) {
        for (var j = 0; j < lists[l].length; j++) {
          var n = lists[l][j];
          if (n.nodeType === 1 && (n.matches(ITEM_WATCH) || n.querySelector(ITEM_WATCH))) return true;
        }
      }
    }
    return false;
  }

  function watchItemView(view) {
    var st = itemState(view);
    if (!st.obs) {
      st.obs = new MutationObserver(function (records) {
        if (st.on && touchesItemParts(records)) kickItemView(view, false);
      });
    }
    if (!st.on) {
      st.obs.observe(view, { childList: true, subtree: true, characterData: true });
      st.on = true;
      if (watchedViews.indexOf(view) < 0) watchedViews.push(view);
    }
    return st;
  }

  function unwatchItemView(view) {
    var st = view.__clawItem;
    var idx = watchedViews.indexOf(view);
    if (idx >= 0) watchedViews.splice(idx, 1);
    if (!st) return;
    if (st.obs) st.obs.disconnect();
    st.on = false;
    st.gen++;
    if (st.timer) clearTimeout(st.timer);
    st.timer = 0;
    st.first = 0;
  }

  // Trailing debounce with a max wait, so a burst of Emby renders costs one pass.
  function kickItemView(view, now) {
    var st = itemState(view);
    var t = Date.now();
    if (!st.first) st.first = t;
    if (st.timer) clearTimeout(st.timer);
    var wait = now ? 0 : Math.max(0, Math.min(ITEM_DEBOUNCE_MS, st.first + ITEM_MAX_WAIT_MS - t));
    st.timer = setTimeout(function () {
      st.timer = 0;
      st.first = 0;
      runItemView(view);
    }, wait);
  }

  function itemUser(st) {
    if (st.user !== undefined) return Promise.resolve(st.user);
    if (!st.userP) {
      st.userP = (typeof ApiClient !== "undefined" && ApiClient.getCurrentUser)
        ? ApiClient.getCurrentUser().then(function (u) { return u; }, function () { return null; })
        : Promise.resolve(null);
      st.userP.then(function (u) { st.user = u; st.userP = null; });
    }
    return st.userP;
  }

  function runItemView(view) {
    var st = itemState(view);
    if (!st.on) return;
    var gen = st.gen;
    loadConfig(false).then(function (c) {
      return itemUser(st).then(function (user) {
        if (gen !== st.gen || !st.on || !view.isConnected) return;
        st.passes = (st.passes || 0) + 1;
        try {
          processItemView(view, c, user);
        } catch (e) {
          console.warn("[claw-emby-ui] item page", e);
        }
        if (st.obs) st.obs.takeRecords(); // our own edits must not re-trigger a pass
      });
    });
  }

  function pruneWatched(keep) {
    watchedViews.slice().forEach(function (v) {
      if (v !== keep && (!v.isConnected || !isViewShown(v))) unwatchItemView(v);
    });
  }

  function onItemViewShow(view) {
    pruneWatched(view);
    var st = watchItemView(view);
    st.user = undefined; // user may have switched
    kickItemView(view, true);
    loadConfig(true).then(function () { if (st.on) kickItemView(view, true); });
  }

  // Safety net (script loaded after the first viewshow, or a view we never saw shown).
  function itemCheck() {
    pruneWatched(null);
    var seen = [];
    var marks = document.querySelectorAll(ITEM_MARKERS);
    for (var i = 0; i < marks.length; i++) {
      var v = itemViewOf(marks[i]);
      if (!v || seen.indexOf(v) >= 0) continue;
      seen.push(v);
      if (!isViewShown(v)) continue;
      var st = itemState(v);
      if (!st.on) { watchItemView(v); kickItemView(v, true); }
    }
  }

  window.__clawItem = {
    observing: function (v) { return !!(v && v.__clawItem && v.__clawItem.on); },
    passes: function (v) { return (v && v.__clawItem && v.__clawItem.passes) || 0; },
    watched: function () { return watchedViews.slice(); },
    process: function (v) { return loadConfig(false).then(function (c) { processItemView(v || document.body, c, null); }); }
  };

  // ===================================================================
  // Dashboard layout (v1.1): rearranges Emby's admin Dashboard home page.
  // No DOM moves: sections are tagged with data-claw-dash and laid out with
  // generated flexbox CSS (order + flex-basis in 12ths). Turning it off removes
  // every tag / break / style we added, which restores Emby's stock layout.
  // ===================================================================
  var DASH_SECTIONS = [
    { id: "maintenance", find: ".maintenanceModeSection", self: true },
    { id: "serverinfo", find: ".serverNameHeader" },
    { id: "alerts", find: ".serverActivityItems" },
    { id: "nowplaying", find: ".nowPlayingSessions" },
    { id: "runningtasks", find: ".runningTasksContainer", self: true },
    { id: "recordings", find: ".activeRecordingsSection", self: true },
    { id: "activity", find: ".userActivityItems" }
  ];
  var DASH_REQUIRED = ["serverinfo", "alerts", "nowplaying", "activity"];
  var DASH_PRESET = [
    { Id: "maintenance", Row: 1, Order: 1, Span: 12, Visible: true },
    { Id: "serverinfo", Row: 2, Order: 1, Span: 6, Visible: true },
    { Id: "alerts", Row: 2, Order: 2, Span: 6, Visible: true },
    { Id: "nowplaying", Row: 3, Order: 1, Span: 8, Visible: true },
    { Id: "runningtasks", Row: 3, Order: 2, Span: 4, Visible: true },
    { Id: "recordings", Row: 4, Order: 1, Span: 12, Visible: true },
    { Id: "activity", Row: 5, Order: 1, Span: 12, Visible: true }
  ];
  var DASH_ATTR = "data-claw-dash";
  var DASH_HOST_CLASS = "claw-dash";
  var DASH_BREAK_CLASS = "claw-dash-break";
  var DASH_CSS_ID = "claw-dash-css";
  var dashWarned = {};

  function dashInt(v, def, min, max) {
    var n = parseInt(v, 10);
    if (isNaN(n)) n = def;
    if (min != null && n < min) n = min;
    if (max != null && n > max) n = max;
    return n;
  }

  // Known ids only, first occurrence wins, missing sections appended as their own rows,
  // rows/orders renumbered 1..n. Same algorithm as the settings page.
  function dashNormalize(list) {
    var src = (list && list.length) ? list : DASH_PRESET;
    var known = {}, seen = {}, out = [];
    DASH_SECTIONS.forEach(function (s) { known[s.id] = true; });
    src.forEach(function (x, i) {
      if (!x) return;
      var id = String(x.Id || x.id || "").toLowerCase();
      if (!known[id] || seen[id]) return;
      seen[id] = true;
      out.push({
        Id: id,
        Row: dashInt(x.Row != null ? x.Row : x.row, 1, 1, 999),
        Order: dashInt(x.Order != null ? x.Order : x.order, i + 1, 0, 999),
        Span: dashInt(x.Span != null ? x.Span : x.span, 12, 1, 12),
        Visible: (x.Visible != null ? x.Visible : x.visible) !== false,
        _i: i
      });
    });
    var maxRow = out.reduce(function (m, x) { return Math.max(m, x.Row); }, 0);
    DASH_SECTIONS.forEach(function (s) {
      if (seen[s.id]) return;
      var p = DASH_PRESET.filter(function (x) { return x.Id === s.id; })[0];
      out.push({ Id: s.id, Row: ++maxRow, Order: 1, Span: p ? p.Span : 12, Visible: true, _i: 999 });
    });
    out.sort(function (a, b) { return a.Row - b.Row || a.Order - b.Order || a._i - b._i; });
    var row = 0, lastRow = null, ord = 0;
    out.forEach(function (x) {
      if (x.Row !== lastRow) { row++; lastRow = x.Row; ord = 0; }
      x.Row = row; x.Order = ++ord; delete x._i;
    });
    return out;
  }

  function dashFind(host) {
    var map = {}, missing = [];
    DASH_SECTIONS.forEach(function (s) {
      var m = host.querySelector(s.find);
      var sec = m ? (s.self ? m : m.closest(".dashboardSection")) : null;
      if (sec && sec.parentElement === host && sec.classList.contains("dashboardSection")) map[s.id] = sec;
    });
    DASH_REQUIRED.forEach(function (id) { if (!map[id]) missing.push(id); });
    return { map: map, missing: missing };
  }

  function dashCss(layout, c) {
    var P = ".dashboardSections." + DASH_HOST_CLASS;
    var gap = "var(--dashboardColumnGap, 3em)";
    var bp = dashInt(c.DashboardStackBelowPx, 960, 320, 4000);
    var fill = c.DashboardFillRows !== false;
    var perRow = dashInt(c.DashboardNowPlayingPerRow, 0, 0, 12);
    var rows = layout.reduce(function (m, x) { return Math.max(m, x.Row); }, 0);
    var o = "";
    o += P + ">.dashboardSection{min-width:0;max-width:100%;box-sizing:border-box}";
    o += P + ">[" + DASH_ATTR + "=spacer]{display:none!important}";
    o += P + ">." + DASH_BREAK_CLASS + "{display:none;margin:0;padding:0;border:0;height:0;min-height:0}";
    layout.forEach(function (x) {
      if (!x.Visible) o += P + ">[" + DASH_ATTR + "=" + x.Id + "]{display:none!important}";
    });
    // Wide: rows of 12ths. flex-grow = span so siblings share space left by a hidden section.
    o += "@media all and (min-width:" + bp + "px){";
    o += P + ">.dashboardSection{flex:1 1 100%;order:100000}"; // untagged / new Emby sections: full width at the end
    for (var r = 1; r < rows; r++) {
      o += P + ">." + DASH_BREAK_CLASS + "[data-claw-break=\"" + r + "\"]{display:block;flex:0 0 100%;order:" + (r * 100 + 99) + "}";
    }
    layout.forEach(function (x) {
      var pct = (x.Span * 100 / 12).toFixed(4).replace(/\.?0+$/, "");
      var gapFrac = ((12 - x.Span) / 12).toFixed(4).replace(/\.?0+$/, "");
      o += P + ">[" + DASH_ATTR + "=" + x.Id + "]{order:" + (x.Row * 100 + x.Order) +
        ";flex:" + (fill ? x.Span : 0) + " 1 calc(" + pct + "% - " + gapFrac + " * " + gap + ")!important}"; // !important beats Emby's inline flex-basis
    });
    if (perRow > 0) o += P + " .nowPlayingSessions{grid-template-columns:repeat(" + perRow + ",minmax(0,1fr))}";
    o += "}";
    // Narrow: one column in configured order.
    o += "@media all and (max-width:" + (bp - 0.02) + "px){";
    o += P + ">.dashboardSection{flex:1 1 100%!important;order:100000}";
    layout.forEach(function (x, i) {
      o += P + ">[" + DASH_ATTR + "=" + x.Id + "]{order:" + (i + 1) + "}";
    });
    o += "}";
    return o;
  }

  function dashSetLimit(el, n) {
    if (!el) return;
    if (!el.hasAttribute("data-claw-orig-limit")) el.setAttribute("data-claw-orig-limit", el.getAttribute("data-activitylimit") || "");
    var v = String(n);
    if (el.getAttribute("data-activitylimit") === v) return;
    el.setAttribute("data-activitylimit", v);
    dashRefreshList(el);
  }

  function dashRefreshList(el) {
    try { if (el.refreshItems) el.refreshItems(); } catch (e) { /* Emby refreshes on its own next update */ }
  }

  function dashRestoreLimit(el) {
    if (!el || !el.hasAttribute("data-claw-orig-limit")) return;
    var orig = el.getAttribute("data-claw-orig-limit");
    el.removeAttribute("data-claw-orig-limit");
    if (el.getAttribute("data-activitylimit") === orig) return;
    if (orig) el.setAttribute("data-activitylimit", orig); else el.removeAttribute("data-activitylimit");
    dashRefreshList(el);
  }

  function dashHostOf(scope) {
    if (!scope) return null;
    if (scope.classList && scope.classList.contains("dashboardSections")) return scope;
    return scope.querySelector ? scope.querySelector(".dashboardSections") : null;
  }

  // Undo everything we added. Leaves Emby's markup exactly as Emby rendered it.
  function dashRestore(host) {
    if (!host) return;
    host.__clawDashKey = null;
    host.classList.remove(DASH_HOST_CLASS);
    Array.prototype.slice.call(host.querySelectorAll(":scope > ." + DASH_BREAK_CLASS)).forEach(function (b) { b.remove(); });
    Array.prototype.forEach.call(host.children, function (ch) { ch.removeAttribute(DASH_ATTR); });
    Array.prototype.slice.call(host.querySelectorAll("[data-claw-orig-limit]")).forEach(dashRestoreLimit);
    if (!document.querySelector(".dashboardSections." + DASH_HOST_CLASS)) {
      var st = document.getElementById(DASH_CSS_ID);
      if (st) st.remove();
    }
  }

  function dashApply(scope, c) {
    var host = dashHostOf(scope);
    if (!host) return "nohost";
    if (!c || !c.Enabled || !c.EnableDashboardLayout) { dashRestore(host); return "off"; }
    var f = dashFind(host);
    if (f.missing.length) {
      dashRestore(host);
      var k = f.missing.join(",");
      if (!dashWarned[k]) { dashWarned[k] = true; console.warn("[claw-emby-ui] dashboard layout skipped, sections not found: " + k + " (stock layout kept)"); }
      return "missing:" + k;
    }
    var layout = dashNormalize(c.DashboardSections);
    var key = JSON.stringify([layout, c.DashboardStackBelowPx, c.DashboardFillRows, c.DashboardNowPlayingPerRow, c.DashboardAlertsLimit, c.DashboardActivityLimit]);
    if (host.__clawDashKey === key && host.classList.contains(DASH_HOST_CLASS) && document.getElementById(DASH_CSS_ID)) return "same";

    Array.prototype.forEach.call(host.children, function (ch) {
      if (ch.classList.contains(DASH_BREAK_CLASS)) return;
      ch.removeAttribute(DASH_ATTR);
    });
    Object.keys(f.map).forEach(function (id) { f.map[id].setAttribute(DASH_ATTR, id); });
    Array.prototype.forEach.call(host.children, function (ch) {
      // Emby's empty row-break spacer: <div class="dashboardSection" style="flex-basis:100%;"></div>
      if (!ch.hasAttribute(DASH_ATTR) && ch.classList.contains("dashboardSection") && !ch.children.length && !ch.textContent.trim()) ch.setAttribute(DASH_ATTR, "spacer");
    });
    Array.prototype.slice.call(host.querySelectorAll(":scope > ." + DASH_BREAK_CLASS)).forEach(function (b) { b.remove(); });
    var rows = layout.reduce(function (m, x) { return Math.max(m, x.Row); }, 0);
    for (var r = 1; r < rows; r++) {
      var b = document.createElement("div");
      b.className = DASH_BREAK_CLASS;
      b.setAttribute("data-claw-break", String(r));
      b.setAttribute("aria-hidden", "true");
      host.appendChild(b);
    }
    var st = document.getElementById(DASH_CSS_ID);
    if (!st) {
      st = document.createElement("style");
      st.id = DASH_CSS_ID;
      (document.head || document.documentElement).appendChild(st);
    }
    st.textContent = dashCss(layout, c);
    host.classList.add(DASH_HOST_CLASS);
    dashSetLimit(host.querySelector(".serverActivityItems"), dashInt(c.DashboardAlertsLimit, 4, 1, 100));
    dashSetLimit(host.querySelector(".userActivityItems"), dashInt(c.DashboardActivityLimit, 10, 1, 100));
    host.__clawDashKey = key;
    return "applied";
  }

  // Fetch the current config every time (settings saved elsewhere apply on the next dashboard show).
  function dashRefresh(scope) {
    var host = dashHostOf(scope);
    if (!host) return Promise.resolve("nohost");
    host.__clawDashSeen = true;
    if (typeof ApiClient === "undefined" || !ApiClient.getPluginConfiguration) return Promise.resolve("noapi");
    var seq = host.__clawDashSeq = (host.__clawDashSeq || 0) + 1; // per host: only the newest fetch applies
    return ApiClient.getPluginConfiguration(PLUGIN_ID).then(function (raw) {
      var c = mergeCfg(raw);
      cfg = c; cfgTried = true; cfgPromise = Promise.resolve(c);
      if (seq !== host.__clawDashSeq) return "stale";
      var r = dashApply(host, c); // first: it sets data-activitylimit the tables read
      try { tblApply(host, c); } catch (e) { console.warn("[claw-emby-ui] activity table", e); }
      return r;
    }, function () {
      // Config unreadable: never guess. Keep whatever is shown (stock on first load).
      return "noconfig";
    });
  }

  // Safety net for the first page load / views created without a viewshow we saw.
  function dashCheck() {
    var hosts = document.querySelectorAll(".dashboardSections");
    for (var i = 0; i < hosts.length; i++) {
      if (!hosts[i].__clawDashSeen) dashRefresh(hosts[i]);
    }
  }

  // ===================================================================
  // Dashboard Activity / Alerts as tables (v1.2.1).
  // Emby's own lists stay in the DOM and keep working (same ActivityLogEntry socket events,
  // same data-activitylimit). We render a table next to each list with the SAME query Emby
  // uses (last 7 days, hasUserId true/false, Limit = data-activitylimit) and hide Emby's list
  // only after our first successful render. Any failure leaves Emby's list visible.
  //
  // Real 4.10.1 entries (checked live): Type is dotted lower case ("playback.start",
  // "playback.stop", "user.authenticated", "system.backupcompleted", "plugins.pluginupdated",
  // "plugins.plugininstalled", "system.updated"); UserId is Emby's INTERNAL numeric id ("11"),
  // not the GUID /Users returns, so users are matched from the start of Name. Name ends with
  // " on <device>" (or " on <server name>" for system/auth entries); auth entries carry the
  // client in Overview ("Google Chrome Windows 1.2.3.4\n\nTime..."). Alerts carry no ItemId.
  // ===================================================================
  var TBL_CLASS = "claw-acttbl";
  var TBL_HIDE = "claw-acttbl-hidden";
  var TBL_CSS_ID = "claw-acttbl-css";
  var TBL_DEBOUNCE_MS = 1500;
  var usersCache = null, usersAt = 0;
  var tblEventsWired = false;

  function tblEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function tblCss() {
    if (document.getElementById(TBL_CSS_ID)) return;
    var st = document.createElement("style");
    st.id = TBL_CSS_ID;
    var T = "." + TBL_CLASS;
    st.textContent =
      "." + TBL_HIDE + "{display:none!important}" +
      T + "{width:100%;border-collapse:collapse;font-size:.92em;table-layout:auto}" +
      T + " th{text-align:left;font-weight:500;opacity:.7;padding:.45em .5em;border-bottom:1px solid rgba(128,128,128,.35);white-space:nowrap;cursor:pointer;user-select:none}" +
      T + " th.nosort{cursor:default}" +
      T + " th .claw-sort{font-size:.8em;opacity:.8;margin-left:.25em}" +
      T + " td{padding:.4em .5em;border-bottom:1px solid rgba(128,128,128,.15);vertical-align:middle}" +
      T + " td.ic{width:1.6em;padding-right:0}" +
      T + " td.ic .md-icon{font-size:1.3em;opacity:.85}" +
      T + " td.dt,"+ T + " td.dev{white-space:nowrap;opacity:.75}" +
      T + " td.usr{white-space:nowrap}" +
      T + " .sub{display:block;opacity:.55;font-size:.88em;margin-top:.1em}" +
      T + " a.claw-item{color:inherit;text-decoration:underline;text-decoration-color:rgba(128,128,128,.6)}" +
      T + " a.claw-item:hover{text-decoration-color:currentColor}" +
      T + " .sev-Error .md-icon," + T + " .sev-Fatal .md-icon{color:#e05050}" +
      T + " .sev-Warn .md-icon{color:#e0a030}" +
      T + " .ic-start .md-icon{color:#52b54b}" +
      T + "-empty{opacity:.6;padding:.6em .2em}";
    (document.head || document.documentElement).appendChild(st);
  }

  // Icon (Material Symbols ligature, rendered by Emby's own .md-icon class) from the real Type.
  function tblIcon(e) {
    var t = String(e.Type || "").toLowerCase(), sev = String(e.Severity || "");
    if (sev === "Error" || sev === "Fatal") return "error";
    if (/fail/.test(t)) return /auth|login/.test(t) ? "no_accounts" : "error";
    if (sev === "Warn") return "warning";
    if (/playback\.?stop|stopped/.test(t)) return "stop";
    if (/playback|playing/.test(t)) return "play_arrow";
    if (/authenticat|login|session\.?start/.test(t)) return "login";
    if (/session\.?end|logout|disconnect/.test(t)) return "logout";
    if (/backup/.test(t)) return "backup";
    if (/uninstall/.test(t)) return "delete";
    if (/plugin/.test(t)) return /install/.test(t) ? "add_box" : "extension";
    if (/system\.?updat|serverupdat/.test(t)) return "system_update_alt";
    if (/task/.test(t)) return "schedule";
    if (/subtitle/.test(t)) return "subtitles";
    if (/camera/.test(t)) return "photo_camera";
    if (/recording/.test(t)) return "fiber_smart_record";
    if (/user|password|policy/.test(t)) return "manage_accounts";
    if (/library|scan/.test(t)) return "video_library";
    return "info";
  }

  function tblDate(d) {
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return { txt: "", title: "", ms: 0 };
    var now = new Date(), same = dt.toDateString() === now.toDateString();
    var y = new Date(now.getTime() - 864e5).toDateString() === dt.toDateString();
    var time = dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    var txt = same ? time : (y ? "Yesterday " + time : dt.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time);
    return { txt: txt, title: dt.toLocaleString(), ms: dt.getTime() };
  }

  function tblItemUrl(id, api) {
    var sid = api && api.serverId ? api.serverId() : "";
    return "#!/item?id=" + encodeURIComponent(id) + (sid ? "&serverId=" + encodeURIComponent(sid) : "");
  }

  var TBL_VERBS = /^(is playing|has finished playing|has stopped playing|has paused|has resumed|is watching|is listening to|started playing|stopped playing|has started playing)\s+(.+)$/i;

  // Known user at the start of the text (longest name first, case-insensitive, whole word).
  function tblUserFromText(text, users) {
    var low = text.toLowerCase(), best = null;
    Object.keys(users).forEach(function (k) {
      var u = users[k], n = String(u.Name || "");
      if (!n || (best && best.Name.length >= n.length)) return;
      var ln = n.toLowerCase();
      if (low.indexOf(ln) === 0 && (low.length === ln.length || /[\s:,]/.test(low.charAt(ln.length)))) best = u;
      else if (low.indexOf("user " + ln) === 0 && /[\s:,]|$/.test(low.charAt(ln.length + 5) || " ")) best = Object.assign({ __prefix: 5 }, u);
    });
    return best;
  }

  // First Overview line minus a trailing IP: "Google Chrome Windows 1.2.3.4" -> "Google Chrome Windows".
  function tblClient(e) {
    var line = String(e.ShortOverview || e.Overview || "").split(/\r?\n/)[0].trim();
    return line.replace(/\s+(\d{1,3}(\.\d{1,3}){3}|[0-9a-f:]{6,})$/i, "").trim();
  }

  // "javid is playing Show - S3, Ep8 - Title on iPhone" -> user/action/item/device.
  function tblParse(e, users) {
    var text = String(e.Name || "").trim();
    var u = (e.UserId && users[e.UserId]) || tblUserFromText(text, users);
    if (u) {
      var cut = (u.__prefix || 0) + u.Name.length;
      text = text.substring(cut).replace(/^[\s:,]+/, "");
    }
    var res = { user: u, action: text, item: "", device: "" };
    var at = text.lastIndexOf(" on ");
    if (at > 0) {
      var dev = text.substring(at + 4).trim();
      text = text.substring(0, at).trim();
      // " on home.example.com" is the server, not a device: use the client from Overview instead.
      res.device = /^[^\s]+\.[^\s]+$/.test(dev) ? "" : dev;
    }
    if (!res.device) res.device = tblClient(e);
    var m = TBL_VERBS.exec(text);
    if (m) { res.action = m[1]; res.item = m[2]; }
    else res.action = text;
    return res;
  }

  function tblUsers(api) {
    if (usersCache && Date.now() - usersAt < 300000) return Promise.resolve(usersCache);
    if (!api.getUsers) return Promise.resolve({});
    return Promise.resolve(api.getUsers()).then(function (list) {
      var m = {};
      (list && list.Items ? list.Items : list || []).forEach(function (u) { if (u && u.Id) m[u.Id] = u; });
      usersCache = m; usersAt = Date.now();
      return m;
    }, function () { return usersCache || {}; });
  }

  function tblFetch(el, api) {
    var limit = parseInt(el.getAttribute("data-activitylimit") || "7", 10) || 7;
    var userAct = el.getAttribute("data-useractivity") !== "false";
    var minDate = new Date(Date.now() - 6048e5);
    return Promise.resolve(api.getActivityLog({ StartIndex: 0, Limit: limit, MinDate: minDate.toISOString(), hasUserId: userAct, EnableTotalRecordCount: false }))
      .then(function (r) {
        var entries = (r && r.Items) || [];
        return (userAct ? tblUsers(api) : Promise.resolve({})).then(function (users) {
          return { entries: entries, users: users, userAct: userAct };
        });
      });
  }

  function tblRows(data, api) {
    return data.entries.map(function (e) {
      var d = tblDate(e.Date);
      if (!data.userAct) {
        var ov = String(e.ShortOverview || e.Overview || "").split(/\r?\n/)[0].trim();
        return { e: e, uname: "", p: { action: e.Name || "", item: "", device: "", sub: ov && ov !== e.Name ? ov : "" }, d: d, api: api };
      }
      var p = tblParse(e, data.users);
      return { e: e, uname: p.user ? p.user.Name : (e.UserId ? "Unknown user" : "System"), p: p, d: d, api: api };
    });
  }

  var TBL_SORT = {
    user: function (r) { return r.uname.toLowerCase(); },
    action: function (r) { return String(r.p.action).toLowerCase(); },
    item: function (r) { return String(r.p.item || "").toLowerCase(); },
    device: function (r) { return String(r.p.device || "").toLowerCase(); },
    date: function (r) { return r.d.ms; }
  };

  function tblSort(rows, s) {
    var f = TBL_SORT[s.key] || TBL_SORT.date, dir = s.dir === "asc" ? 1 : -1;
    return rows.slice().sort(function (a, b) {
      var x = f(a), y = f(b);
      if (x < y) return -dir;
      if (x > y) return dir;
      return b.d.ms - a.d.ms;
    });
  }

  function tblRowHtml(r, alerts) {
    var e = r.e, icon = tblIcon(e);
    var h = '<tr data-id="' + tblEsc(e.Id) + '" class="sev-' + tblEsc(e.Severity || "Info") + (icon === "play_arrow" ? " ic-start" : "") + '">';
    h += '<td class="ic"><i class="md-icon" title="' + tblEsc(e.Type || "") + '">' + icon + "</i></td>";
    if (alerts) {
      h += '<td class="act">' + tblEsc(r.p.action) + (r.p.sub ? '<span class="sub">' + tblEsc(r.p.sub) + "</span>" : "") + "</td>";
    } else {
      h += '<td class="usr">' + tblEsc(r.uname) + "</td>";
      h += '<td class="act">' + tblEsc(r.p.action) + "</td>";
      var cell = "";
      if (e.ItemId) cell = '<a class="claw-item" data-item="' + tblEsc(e.ItemId) + '" href="' + tblEsc(tblItemUrl(e.ItemId, r.api)) + '">' + tblEsc(r.p.item || "Open item") + "</a>";
      else if (r.p.item) cell = tblEsc(r.p.item);
      h += '<td class="itm">' + cell + "</td>";
      h += '<td class="dev">' + tblEsc(r.p.device) + "</td>";
    }
    h += '<td class="dt" title="' + tblEsc(r.d.title) + '">' + tblEsc(r.d.txt) + "</td></tr>";
    return h;
  }

  function tblHead(alerts, s) {
    function th(key, label) {
      var arrow = s.key === key ? '<span class="claw-sort">' + (s.dir === "asc" ? "\u25B2" : "\u25BC") + "</span>" : "";
      return '<th data-sort="' + key + '">' + label + arrow + "</th>";
    }
    var h = '<thead><tr><th class="nosort"></th>';
    if (alerts) h += th("action", "Event");
    else h += th("user", "User") + th("action", "Action") + th("item", "Item") + th("device", "Device");
    return h + th("date", "Date") + "</tr></thead>";
  }

  function tblRender(box, data, api) {
    var s = box.__clawSort || (box.__clawSort = { key: "date", dir: "desc" });
    var rows = tblRows(data, api);
    if (!rows.length) {
      box.innerHTML = '<div class="' + TBL_CLASS + '-empty">No entries in the last 7 days.</div>';
      return;
    }
    var alerts = !data.userAct;
    var h = '<table class="' + TBL_CLASS + '">' + tblHead(alerts, s) + "<tbody>";
    tblSort(rows, s).forEach(function (r) { h += tblRowHtml(r, alerts); });
    box.innerHTML = h + "</tbody></table>";
    try { ClawColResize.attach(box.querySelector("table"), alerts ? "claw.customitemui.cols.alerts" : "claw.customitemui.cols.activity"); } catch (e) { /* never break the dashboard */ }
  }

  function tblOn(el, c) {
    if (!c || !c.Enabled) return false;
    return el.getAttribute("data-useractivity") === "false" ? c.DashboardAlertsTable !== false : c.DashboardActivityTable !== false;
  }

  function tblBoxOf(el) {
    var n = el.nextElementSibling;
    return n && n.classList.contains(TBL_CLASS + "-box") ? n : null;
  }

  function tblOff(el) {
    var box = tblBoxOf(el);
    if (box) box.remove();
    el.classList.remove(TBL_HIDE);
    if (el.__clawTblTimer) { clearTimeout(el.__clawTblTimer); el.__clawTblTimer = null; }
  }

  function tblLoad(el) {
    var box = tblBoxOf(el), c = el.__clawTblCfg;
    if (!box || !c || typeof ApiClient === "undefined" || !ApiClient.getActivityLog) return Promise.resolve("noapi");
    var api = ApiClient, seq = el.__clawTblSeq = (el.__clawTblSeq || 0) + 1;
    return tblFetch(el, api).then(function (data) {
      if (seq !== el.__clawTblSeq || !tblBoxOf(el)) return "stale";
      box.__clawData = data;
      tblRender(box, data, api);
      el.classList.add(TBL_HIDE); // only now: until here Emby's list stays visible
      return "rendered";
    }, function (err) {
      console.warn("[claw-emby-ui] activity table: fetch failed, Emby list kept", err);
      tblOff(el);
      return "failed";
    });
  }

  function tblSchedule(el, ms) {
    if (el.__clawTblTimer) return;
    el.__clawTblTimer = setTimeout(function () { el.__clawTblTimer = null; tblLoad(el); }, ms);
  }

  // Same socket event Emby's list refreshes on (Emby already started the listener).
  function tblWireEvents() {
    if (tblEventsWired || typeof Emby === "undefined" || !Emby.importModule) return;
    tblEventsWired = true;
    Promise.all([Emby.importModule("./modules/emby-apiclient/events.js"), Emby.importModule("./modules/common/input/api.js")]).then(function (m) {
      var events = m[0] && (m[0].default || m[0]), api = m[1] && (m[1].default || m[1]);
      if (!events || !events.on || !api) return;
      events.on(api, "ActivityLogEntry", function () {
        Array.prototype.forEach.call(document.querySelectorAll(".serverActivityItems, .userActivityItems"), function (el) {
          if (tblBoxOf(el) && !el.closest(".page-hidden")) tblSchedule(el, TBL_DEBOUNCE_MS);
        });
      });
    }, function () { tblEventsWired = false; });
  }

  function tblApplyOne(el, c) {
    if (!el) return "none";
    if (!tblOn(el, c) || typeof ApiClient === "undefined" || !ApiClient.getActivityLog) { tblOff(el); return "off"; }
    tblCss();
    var box = tblBoxOf(el);
    if (!box) {
      box = document.createElement("div");
      box.className = TBL_CLASS + "-box";
      el.parentNode.insertBefore(box, el.nextSibling);
      box.addEventListener("click", function (ev) {
        var a = ev.target.closest && ev.target.closest("a.claw-item");
        if (a && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && ev.button === 0 && typeof Emby !== "undefined" && Emby.importModule) {
          // Emby's router builds the right route for this version; the href stays as a fallback.
          ev.preventDefault();
          var id = a.getAttribute("data-item");
          var sid = ApiClient.serverId ? ApiClient.serverId() : "";
          Emby.importModule("./modules/approuter.js").then(function (m) {
            var r = m.default || m;
            r.show(r.getRouteUrl({ Id: id, ServerId: sid }));
          }, function () { location.href = a.href; });
          return;
        }
        var th = ev.target.closest && ev.target.closest("th[data-sort]");
        if (!th || !box.__clawData) return;
        var s = box.__clawSort || { key: "date", dir: "desc" }, k = th.getAttribute("data-sort");
        box.__clawSort = { key: k, dir: s.key === k ? (s.dir === "asc" ? "desc" : "asc") : (k === "date" ? "desc" : "asc") };
        tblRender(box, box.__clawData, ApiClient);
      });
    }
    el.__clawTblCfg = c;
    tblWireEvents();
    return tblLoad(el);
  }

  function tblApply(scope, c) {
    var host = dashHostOf(scope);
    if (!host) return Promise.resolve([]);
    return Promise.all([tblApplyOne(host.querySelector(".serverActivityItems"), c), tblApplyOne(host.querySelector(".userActivityItems"), c)]);
  }

  window.__clawActTable = { apply: tblApply, parse: tblParse, icon: tblIcon, load: tblLoad, off: tblOff, client: tblClient };

  window.__clawDash = { apply: dashApply, restore: dashRestore, refresh: dashRefresh, normalize: dashNormalize, css: dashCss, preset: DASH_PRESET };


  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try {
        itemCheck();
      } catch (e) {
        console.warn("[claw-emby-ui]", e);
      }
      try {
        dashCheck();
      } catch (e2) {
        console.warn("[claw-emby-ui] dashboard", e2);
      }
    });
  }

  // Emby dispatches a bubbling "viewshow" on the view element every time a page is shown
  // (also when a cached view is restored): re-read the config and (re)apply the dashboard layout.
  // Item pages get a per-view observer while shown; it is disconnected on viewhide.
  document.addEventListener("viewshow", function (e) {
    var v = e.target;
    if (!v || !v.querySelector) return;
    if (v.querySelector(".dashboardSections")) dashRefresh(v);
    if (isItemView(v)) onItemViewShow(v);
    else pruneWatched(null);
  }, true);
  document.addEventListener("viewhide", function (e) {
    var v = e.target;
    if (v && v.__clawItem) unwatchItemView(v);
  }, true);

  schedule();
  var obs = new MutationObserver(schedule);
  obs.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", schedule);
  window.addEventListener("hashchange", schedule);

  console.info("[claw-emby-ui] loaded (plugin inject)");
})();