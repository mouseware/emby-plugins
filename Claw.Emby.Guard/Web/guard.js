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


  var PLUGIN_ID = "07d4dd00-021a-4dc5-9964-837979319eca";
  var POLL_MS = 4000, STATUS_MS = 15000, MAX_ROWS = 2000;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function url(p, q) { return ApiClient.getUrl(p, q || {}); }
  function getJSON(p, q) { return ApiClient.getJSON(url(p, q)); }
  function post(p, q) {
    return ApiClient.ajax({ type: "POST", url: url(p, q), dataType: "json" });
  }
  function fmtTime(t) {
    var d = new Date(t); if (isNaN(d)) return "";
    var now = new Date(), same = d.toDateString() === now.toDateString();
    var tm = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
    return same ? tm : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + tm;
  }
  function fmtDur(min) {
    if (!min) return "permanent";
    if (min % 1440 === 0) return (min / 1440) + (min === 1440 ? " day" : " days");
    if (min % 60 === 0) return (min / 60) + (min === 60 ? " hour" : " hours");
    return min + " min";
  }
  function fmtLeft(exp, now) {
    if (!exp) return "never";
    var ms = new Date(exp) - now; if (ms <= 0) return "expiring";
    var m = Math.round(ms / 60000);
    if (m < 60) return m + " min";
    if (m < 2880) return Math.round(m / 60) + " h";
    return Math.round(m / 1440) + " d";
  }
  function isLanText(ip) {
    // Display hint only; the server decides.
    return /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|f[cd]|fe[89ab])/i.test(ip || "");
  }

  var KIND = {
    "signin-failed": { icon: "no_accounts", cls: "cg-f", label: "Failed sign-in" },
    "signin-forbidden": { icon: "person_off", cls: "cg-f", label: "Forbidden sign-in" },
    "signin-ok": { icon: "login", cls: "cg-ok", label: "Signed in" },
    "api-401": { icon: "lock", cls: "cg-w", label: "API 401" },
    "api-403": { icon: "lock", cls: "cg-w", label: "API 403" },
    "banned": { icon: "gpp_bad", cls: "cg-f", label: "Banned" },
    "unbanned": { icon: "gpp_good", cls: "cg-ok", label: "Unbanned" },
    "blocked": { icon: "block", cls: "cg-f", label: "Blocked (banned)" }
  };
  var KIND_GROUP = { fail: ["signin-failed", "signin-forbidden"], ok: ["signin-ok"], api: ["api-401", "api-403"], ban: ["banned", "unbanned", "blocked"] };

  function View(view) {
    var S = { events: [], lastId: 0, status: null, bans: null, cfg: null, sort: { key: "time", dir: -1 }, ipOnly: "", tab: "live", timer: null, stimer: null, wl: [] };
    var q = function (s) { return view.querySelector(s); };
    [["cg-live-t", "live"], ["cg-bans-t", "bans"], ["cg-hist-t", "history"], ["cg-wl-t", "whitelist"]].forEach(function (t) {
      ClawColResize.attach(q("table." + t[0]), "claw.guard.cols." + t[1]);
    });

    // ---------------- modal + menu ----------------
    function dialog(title, html, okText, danger) {
      return new Promise(function (resolve) {
        var m = q(".cg-modal");
        q(".cg-dlg-title").textContent = title;
        q(".cg-dlg-body").innerHTML = html;
        var yes = q(".cg-dlg-yes"), no = q(".cg-dlg-no");
        yes.textContent = okText || "OK";
        yes.className = "cg-btn cg-dlg-yes " + (danger ? "cg-dan" : "cg-pri");
        function done(v) { m.classList.remove("cg-on"); yes.onclick = no.onclick = null; resolve(v); }
        yes.onclick = function () { done(true); };
        no.onclick = function () { done(false); };
        m.classList.add("cg-on");
      });
    }
    function toast(msg) {
      try { require(["toast"], function (t) { t(msg); }); } catch (e) { /* ignore */ }
    }
    function hideMenu() { q(".cg-menu").style.display = "none"; }

    // ---------------- tabs ----------------
    function showTab(t) {
      S.tab = t;
      Array.prototype.forEach.call(view.querySelectorAll(".cg-tab"), function (b) { b.classList.toggle("cg-on", b.getAttribute("data-tab") === t); });
      Array.prototype.forEach.call(view.querySelectorAll(".cg-panel"), function (p) { p.classList.toggle("cg-on", p.getAttribute("data-panel") === t); });
      hideMenu();
      if (t === "bans") loadBans();
    }

    // ---------------- status ----------------
    function loadStatus() {
      return getJSON("ClawGuard/Status").then(function (st) {
        S.status = st;
        q(".cg-c-failed").textContent = st.Failed24h;
        q(".cg-c-api").textContent = st.ApiFailures24h;
        q(".cg-c-bans").textContent = st.ActiveBans;
        q(".cg-c-ips").textContent = st.DistinctIps24h;
        q(".cg-bans-count").textContent = st.ActiveBans;
        var stEl = q(".cg-c-state"), stTxt = q(".cg-c-statetext");
        var map = { enforcing: ["On", "cg-ok", "enforcing: Emby IP blacklist"], off: ["Off", "cg-w", "master switch off"], "conflict-whitelist": ["Not enforcing", "cg-f", "Emby filter is an allow-list"] };
        var m = map[st.FilterState] || [st.FilterState || "-", "cg-w", "enforcement"];
        stEl.textContent = m[0]; stEl.className = m[1] + " cg-c-state"; stTxt.textContent = m[2];
        q(".cg-retention").textContent = "Guard keeps its security log: " + st.RetentionText + ". Emby keeps its text log files for " + st.LogFileRetentionDays + " days.";
        q(".cg-tail").textContent = "Log watcher: " + (st.TailStatus || "");
        q(".cg-geo-status").textContent = st.GeoStatus || "";
        var fn = q(".cg-filter-note");
        var txt = st.FilterState === "conflict-whitelist"
          ? "Emby's Remote IP filter is set to WHITELIST and has " + st.ManualFilterEntries + " entries you added. Guard will not flip it (that would ban your allowed addresses). Clear it or switch it to blacklist under Settings → Network to let Guard enforce bans."
          : "Emby's Remote IP filter is in blacklist mode and managed by Guard (" + st.ActiveBans + " active bans). " + (st.ManualFilterEntries ? st.ManualFilterEntries + " entries you typed there yourself are kept." : "Anything you add there by hand is kept.");
        fn.textContent = txt;
        fn.classList.toggle("cg-warn", st.FilterState !== "enforcing");
        renderLive();
      });
    }

    // ---------------- live log ----------------
    function loadEvents(full) {
      var hours = parseInt(q(".cg-range").value, 10);
      var p = full ? getJSON("ClawGuard/Events", { Hours: hours, Limit: MAX_ROWS }) : getJSON("ClawGuard/Events", { SinceId: S.lastId, Limit: 500 });
      return p.then(function (list) {
        list = list || [];
        if (full) S.events = list;
        else if (list.length) S.events = list.concat(S.events).slice(0, MAX_ROWS);
        S.events.forEach(function (e) { if (e.Id > S.lastId) S.lastId = e.Id; });
        if (full || list.length) renderLive();
        if (!full && list.some(function (e) { return e.Kind === "banned" || e.Kind === "unbanned"; })) { loadStatus(); if (S.tab === "bans") loadBans(); }
      });
    }

    function visibleEvents() {
      var f = q(".cg-filter").value.trim().toLowerCase(), kind = q(".cg-kind").value;
      var kinds = kind ? KIND_GROUP[kind] : null;
      return S.events.filter(function (e) {
        if (kinds && kinds.indexOf(e.Kind) < 0) return false;
        if (S.ipOnly && e.Ip !== S.ipOnly && e.Key !== S.ipOnly) return false;
        if (!f) return true;
        return [e.Ip, e.Username, e.Client, e.Device, e.Request, e.Country, e.Note, e.Rule].join(" ").toLowerCase().indexOf(f) >= 0;
      });
    }

    var SORTERS = {
      time: function (e) { return e.Id; }, ip: function (e) { return e.Ip || ""; }, country: function (e) { return e.Country || ""; },
      user: function (e) { return (e.Username || "").toLowerCase(); }, kind: function (e) { return e.Kind; },
      client: function (e) { return ((e.Request || "") + (e.Client || "") + (e.Device || "")).toLowerCase(); },
      count: function (e) { return e.Count || 0; }, status: function (e) { return e.Note || ""; }
    };
    function sortRows(rows, s, sorters) {
      var f = sorters[s.key] || sorters.time;
      return rows.slice().sort(function (a, b) { var x = f(a), y = f(b); return x < y ? -s.dir : x > y ? s.dir : (b.Id || 0) - (a.Id || 0); });
    }
    function th(key, label, s) {
      return '<th data-sort="' + key + '">' + label + (s.key === key ? (s.dir > 0 ? " ▲" : " ▼") : "") + "</th>";
    }

    // Note may carry ", imported" (event replayed from Emby's logs).
    function noteBase(e) { return (e.Note || "").replace(/(^|, )imported$/, ""); }
    function statusPill(e) {
      var imp = /(^|, )imported$/.test(e.Note || "") ? ' <span class="cg-pill cg-n" title="Imported from Emby\u2019s log files">imported</span>' : "";
      return statusPill0(e) + imp;
    }
    function statusPill0(e) {
      var n = noteBase(e);
      if (n === "lan") return '<span class="cg-pill cg-g">LAN</span>';
      if (n === "whitelisted") return '<span class="cg-pill cg-g">whitelisted</span>';
      if (e.Kind === "banned") return '<span class="cg-pill">banned ' + esc(n) + "</span>";
      if (e.Kind === "unbanned") return '<span class="cg-pill cg-g">' + esc(n || "unbanned") + "</span>";
      if (n === "banned" || n === "blocked") return '<span class="cg-pill">' + n + "</span>";
      return "";
    }

    function renderLive() {
      var country = !!(S.status && S.status.CountryEnabled);
      var s = S.sort;
      q(".cg-live-t thead").innerHTML = "<tr><th class=\"cg-ns\"></th>" + th("time", "Time", s) + th("ip", "IP", s) + (country ? th("country", "Country", s) : "") +
        th("user", "Username", s) + th("kind", "Event", s) + th("client", "Client / request", s) + th("count", "Fails", s) + th("status", "Status", s) + "</tr>";
      var rows = sortRows(visibleEvents(), s, SORTERS);
      var h = "";
      rows.forEach(function (e) {
        var k = KIND[e.Kind] || { icon: "info", cls: "", label: e.Kind };
        var user = e.Username ? esc(e.Username) + (e.UserExists === false ? ' <span class="cg-pill cg-n">no such user</span>' : "") : '<span class="cg-dim">-</span>';
        var client = e.Request ? '<span class="cg-dim">' + esc(e.Request) + "</span>" : esc([e.Client, e.Device].filter(Boolean).join(" · "));
        var cnt = e.Count ? '<span class="' + (noteBase(e) === "banned" ? "cg-f" : "") + '">' + e.Count + "</span>" : "";
        h += '<tr data-id="' + e.Id + '" class="cg-k-' + esc(e.Kind) + '"><td class="cg-ic"><i class="md-icon ' + k.cls + '">' + k.icon + "</i></td>" +
          '<td class="cg-nowrap" title="' + esc(new Date(e.Time).toLocaleString()) + '">' + esc(fmtTime(e.Time)) + "</td>" +
          '<td class="cg-nowrap">' + esc(e.Ip) + "</td>" + (country ? "<td>" + esc(e.Country || "") + "</td>" : "") +
          "<td>" + user + '</td><td class="cg-nowrap ' + k.cls + '">' + esc(k.label) + (e.Status && e.Kind.indexOf("api") !== 0 && e.Kind.indexOf("signin") === 0 ? "" : "") + "</td>" +
          "<td>" + client + "</td><td>" + cnt + "</td><td>" + statusPill(e) + "</td></tr>";
      });
      q(".cg-live-t tbody").innerHTML = h;
      q(".cg-live-empty").style.display = rows.length ? "none" : "";
      var ipf = q(".cg-ipfilter");
      ipf.style.display = S.ipOnly ? "" : "none";
      ipf.querySelector(".cg-pill").textContent = "IP " + S.ipOnly;
    }

    function rowMenu(ev, e) {
      var m = q(".cg-menu");
      var lan = noteBase(e) === "lan" || isLanText(e.Ip);
      var wl = noteBase(e) === "whitelisted";
      var target = e.Key || e.Ip;
      var dis = lan || wl || !target ? " disabled" : "";
      var why = lan ? "LAN address: Emby never filters it" : (wl ? "whitelisted" : "");
      var mine = S.status && S.status.YourIp && (S.status.YourIp === e.Ip);
      var h = '<div class="cg-mh">' + esc(target || "no address") + (why ? " · " + why : "") + (mine ? " · this is you" : "") + "</div>";
      [[60, "Ban 1 hour"], [1440, "Ban 1 day"], [43200, "Ban 30 days"], [0, "Ban permanently"]].forEach(function (x) {
        h += '<button type="button" data-act="ban" data-min="' + x[0] + '"' + dis + '><i class="md-icon ' + (x[0] === 0 ? "cg-f" : "") + '">' + (x[0] === 0 ? "gpp_bad" : "block") + "</i>" + x[1] + "</button>";
      });
      h += '<button type="button" data-act="wl"' + (lan || wl || !e.Ip ? " disabled" : "") + '><i class="md-icon cg-ok">verified_user</i>Whitelist this IP</button>';
      h += '<button type="button" data-act="watch"' + (e.Username ? "" : " disabled") + '><i class="md-icon">person_off</i>Watch username' + (e.Username ? " \u201C" + esc(e.Username) + "\u201D" : "") + "</button>";
      h += '<button type="button" data-act="only"' + (e.Ip ? "" : " disabled") + '><i class="md-icon">filter_alt</i>Show only this IP</button>';
      m.innerHTML = h;
      m.style.display = "block";
      var x = Math.min(ev.clientX, window.innerWidth - m.offsetWidth - 8), y = Math.min(ev.clientY, window.innerHeight - m.offsetHeight - 8);
      m.style.left = Math.max(4, x) + "px"; m.style.top = Math.max(4, y) + "px";
      m.onclick = function (ce) {
        var b = ce.target.closest("button"); if (!b || b.disabled) return;
        hideMenu();
        var act = b.getAttribute("data-act");
        if (act === "ban") ban(target, parseInt(b.getAttribute("data-min"), 10), "From live log" + (e.Username ? " (" + e.Username + ")" : ""));
        else if (act === "wl") whitelistIp(e.Ip);
        else if (act === "watch") watchUser(e.Username);
        else if (act === "only") { S.ipOnly = e.Key || e.Ip; renderLive(); }
      };
    }

    function ban(ip, minutes, reason, confirmed) {
      var go = confirmed ? Promise.resolve(true) : dialog("Ban " + ip + "?", "Ban <b>" + esc(ip) + "</b> " + (minutes ? "for " + fmtDur(minutes) : "<b>permanently</b>") + ". It is added to Emby's Remote IP filter right away.", "Ban", true);
      return go.then(function (ok) {
        if (!ok) return null;
        return post("ClawGuard/Bans", { Ip: ip, Minutes: minutes, Reason: reason || "", Confirm: !!confirmed }).then(function (r) {
          if (r && r.NeedsConfirm) {
            return dialog("This is your own address", esc(r.Error) + "<br><br>Ban it anyway?", "Ban my address", true).then(function (yes) {
              return yes ? ban(ip, minutes, reason, true) : null;
            });
          }
          if (r && !r.Ok) { dialog("Not banned", esc(r.Error || "Failed"), "OK"); return null; }
          toast("Banned " + ip);
          loadStatus(); loadBans(); loadEvents(false);
          return r;
        });
      });
    }

    function whitelistIp(ip) {
      return dialog("Whitelist " + ip + "?", "Addresses on the whitelist are never banned, and any active ban for it is lifted now.", "Whitelist").then(function (ok) {
        if (!ok) return;
        return post("ClawGuard/Whitelist", { Cidr: ip, Note: "added from live log" }).then(function () { toast("Whitelisted " + ip); loadConfig(); loadStatus(); loadBans(); });
      });
    }

    function watchUser(u) {
      return dialog("Watch username \u201C" + u + "\u201D?", "Adds it to the instant-ban list: the next failed sign-in with this name bans that address immediately (unless it is a real Emby user).", "Add").then(function (ok) {
        if (!ok) return;
        return post("ClawGuard/InstantUsernames", { Username: u }).then(function () { toast("Watching " + u); loadConfig(); });
      });
    }

    // ---------------- bans ----------------
    var BAN_SORT = { key: "created", dir: -1 };
    var BAN_SORTERS = {
      key: function (b) { return b.Key; }, country: function (b) { return b.Country || ""; }, reason: function (b) { return b.Reason || ""; },
      created: function (b) { return new Date(b.Created).getTime(); }, expires: function (b) { return b.Expires ? new Date(b.Expires).getTime() : 9e15; },
      hits: function (b) { return b.Hits || 0; }, time: function (b) { return new Date(b.Created).getTime(); }
    };
    function loadBans() {
      return getJSON("ClawGuard/Bans").then(function (r) { S.bans = r; renderBans(); });
    }
    function renderBans() {
      var r = S.bans; if (!r) return;
      var now = new Date(r.Now), country = !!(S.status && S.status.CountryEnabled), s = BAN_SORT;
      q(".cg-bans-t thead").innerHTML = "<tr>" + th("key", "Address", s) + (country ? th("country", "Country", s) : "") + th("reason", "Reason", s) +
        '<th class="cg-ns">Usernames tried</th>' + th("created", "Banned", s) + th("expires", "Expires", s) + th("hits", "Hits", s) + '<th class="cg-ns"></th></tr>';
      var rows = sortRows(r.Active || [], s, BAN_SORTERS), h = "";
      rows.forEach(function (b) {
        h += '<tr data-key="' + esc(b.Key) + '"><td class="cg-nowrap"><b>' + esc(b.Key) + "</b></td>" + (country ? "<td>" + esc(b.Country || "") + "</td>" : "") +
          "<td>" + esc(b.Reason) + (b.Manual ? "" : ' <span class="cg-dim">(step ' + (b.Step + 1) + ")</span>") + "</td><td>" + esc((b.Usernames || []).join(", ")) + "</td>" +
          '<td class="cg-nowrap">' + esc(fmtTime(b.Created)) + '</td><td class="cg-nowrap">' + (b.Expires ? esc(fmtTime(b.Expires)) + ' <span class="cg-dim">(' + fmtLeft(b.Expires, now) + ")</span>" : '<span class="cg-pill">permanent</span>') + "</td>" +
          "<td>" + (b.Hits || 0) + '</td><td class="cg-nowrap"><button type="button" class="cg-btn cg-mini" data-act="unban">Unban</button> ' +
          '<button type="button" class="cg-btn cg-mini" data-act="extend">+1 day</button> ' +
          (b.Expires ? '<button type="button" class="cg-btn cg-mini" data-act="perm">Make permanent</button>' : "") + "</td></tr>";
      });
      q(".cg-bans-t tbody").innerHTML = h;
      q(".cg-bans-empty").style.display = rows.length ? "none" : "";
      q(".cg-bans-count").textContent = rows.length;
      q(".cg-hist-t thead").innerHTML = '<tr><th class="cg-ns">Address</th><th class="cg-ns">Reason</th><th class="cg-ns">Banned</th><th class="cg-ns">Ended</th><th class="cg-ns">How</th></tr>';
      q(".cg-hist-t tbody").innerHTML = (r.History || []).slice(0, 50).map(function (b) {
        return '<tr class="cg-dim"><td>' + esc(b.Key) + "</td><td>" + esc(b.Reason) + "</td><td>" + esc(fmtTime(b.Created)) + "</td><td>" + esc(fmtTime(b.Ended || b.Expires)) + "</td><td>" + esc(b.EndReason || "") + "</td></tr>";
      }).join("");
    }

    // ---------------- config (rules / whitelist / settings) ----------------
    function loadConfig() {
      return ApiClient.getPluginConfiguration(PLUGIN_ID).then(function (c) { S.cfg = c || {}; fillConfig(); });
    }
    function val(id, v) { var el = q("#" + id); if (el) el.value = v == null ? "" : v; }
    function num(id, def, lo, hi) { var n = parseInt(q("#" + id).value, 10); if (isNaN(n)) n = def; return Math.max(lo, Math.min(hi, n)); }
    var UNITS = [[1, "minutes"], [60, "hours"], [1440, "days"]];
    function stepRow(min) {
      var perm = min === 0, unit = 1, n = min;
      if (!perm) { if (min % 1440 === 0) unit = 1440; else if (min % 60 === 0) unit = 60; n = min / unit; }
      return '<tr><td class="cg-dim">Offence <span class="cg-stepno"></span></td><td><input type="number" class="cg-in cg-step-n" min="1" value="' + (perm ? 1 : n) + '"' + (perm ? " disabled" : "") + "></td>" +
        '<td><select class="cg-in cg-step-u">' + UNITS.map(function (u) { return '<option value="' + u[0] + '"' + (!perm && u[0] === unit ? " selected" : "") + ">" + u[1] + "</option>"; }).join("") +
        '<option value="0"' + (perm ? " selected" : "") + '>permanent</option></select></td><td><button type="button" class="cg-btn cg-mini cg-step-del">Remove</button></td></tr>';
    }
    function numberSteps() {
      Array.prototype.forEach.call(view.querySelectorAll(".cg-steps-body tr"), function (tr, i, all) { tr.querySelector(".cg-stepno").textContent = (i + 1) + (i === all.length - 1 ? "+" : ""); });
    }
    function readSteps() {
      return Array.prototype.map.call(view.querySelectorAll(".cg-steps-body tr"), function (tr) {
        var u = parseInt(tr.querySelector(".cg-step-u").value, 10), n = parseInt(tr.querySelector(".cg-step-n").value, 10) || 1;
        return u === 0 ? 0 : Math.max(1, n) * u;
      });
    }
    function fillConfig() {
      var c = S.cfg;
      val("cgSigninN", c.SigninFailThreshold); val("cgSigninW", c.SigninWindowMinutes); val("cgUnknownN", c.UnknownUserFailThreshold); q("#cgUnknownInstant").checked = !!c.BanUnknownUsersInstantly;
      q("#cgInstant").value = (c.InstantBanUsernames || []).join("\n");
      q("#cgApiOn").checked = c.WatchApiFailures !== false; val("cgApiN", c.ApiFailThreshold); val("cgApiW", c.ApiWindowMinutes);
      q(".cg-steps-body").innerHTML = (c.EscalationMinutes && c.EscalationMinutes.length ? c.EscalationMinutes : [60, 1440, 43200, 0]).map(stepRow).join("");
      numberSteps();
      val("cgReset", c.EscalationResetDays); val("cgV6", c.Ipv6Prefix); q("#cgNotify").checked = c.NotifyOnBan !== false;
      q("#cgEnabled").checked = c.Enabled !== false; val("cgMmId", c.MaxMindAccountId); val("cgMmKey", c.MaxMindLicenseKey);
      S.wl = (c.Whitelist || []).map(function (w) { return { Cidr: w.Cidr, Note: w.Note || "" }; });
      renderWl();
    }
    function saveConfig(mut) {
      return ApiClient.getPluginConfiguration(PLUGIN_ID).then(function (c) {
        mut(c);
        return ApiClient.updatePluginConfiguration(PLUGIN_ID, c).then(function (r) {
          S.cfg = c;
          if (typeof Dashboard !== "undefined" && Dashboard.processPluginConfigurationUpdateResult) Dashboard.processPluginConfigurationUpdateResult(r);
          else toast("Saved");
          setTimeout(loadStatus, 500);
        });
      });
    }
    function saveRules(e) {
      e.preventDefault();
      var steps = readSteps();
      var err = q(".cg-rules-err");
      if (!steps.length) { err.textContent = "Add at least one ban length."; err.classList.add("cg-on"); return false; }
      var permAt = steps.indexOf(0);
      if (permAt >= 0 && permAt < steps.length - 1) { err.textContent = "\u201Cpermanent\u201D can only be the last step."; err.classList.add("cg-on"); return false; }
      err.classList.remove("cg-on");
      var names = q("#cgInstant").value.split(/[\n,]/).map(function (x) { return x.trim(); }).filter(Boolean);
      saveConfig(function (c) {
        c.SigninFailThreshold = num("cgSigninN", 5, 1, 1000); c.SigninWindowMinutes = num("cgSigninW", 10, 1, 10080);
        c.UnknownUserFailThreshold = num("cgUnknownN", 2, 0, 1000); c.BanUnknownUsersInstantly = q("#cgUnknownInstant").checked; c.InstantBanUsernames = names;
        c.WatchApiFailures = q("#cgApiOn").checked; c.ApiFailThreshold = num("cgApiN", 30, 1, 100000); c.ApiWindowMinutes = num("cgApiW", 10, 1, 10080);
        c.EscalationMinutes = steps; c.EscalationResetDays = num("cgReset", 30, 0, 3650); c.Ipv6Prefix = num("cgV6", 64, 16, 128);
        c.NotifyOnBan = q("#cgNotify").checked;
      });
      return false;
    }
    function validCidr(s) {
      s = (s || "").trim();
      return /^(\d{1,3}\.){3}\d{1,3}(\/(\d|[12]\d|3[0-2]))?$/.test(s) || /^[0-9a-f:]+(\/\d{1,3})?$/i.test(s) && s.indexOf(":") >= 0;
    }
    function renderWl() {
      q(".cg-wl-t tbody").innerHTML = S.wl.map(function (w, i) {
        return '<tr data-i="' + i + '"><td><b>' + esc(w.Cidr) + "</b></td><td>" + esc(w.Note) + '</td><td><button type="button" class="cg-btn cg-mini cg-wl-del">Remove</button></td></tr>';
      }).join("");
      q(".cg-wl-empty").style.display = S.wl.length ? "none" : "";
      q(".cg-wl-count").textContent = S.wl.length;
    }
    function addWl(cidr, note) {
      var err = q(".cg-wl-err");
      if (!validCidr(cidr)) { err.textContent = "Not an IP address or CIDR: " + cidr; err.classList.add("cg-on"); return; }
      err.classList.remove("cg-on");
      if (!S.wl.some(function (w) { return w.Cidr.toLowerCase() === cidr.trim().toLowerCase(); })) S.wl.push({ Cidr: cidr.trim(), Note: note || "" });
      renderWl();
    }
    function saveSettings(e) {
      e.preventDefault();
      var on = q("#cgEnabled").checked;
      var go = (!on && (S.cfg.Enabled !== false)) ? dialog("Switch Guard off?", "All of Guard's entries are removed from Emby's Remote IP filter now (entries you typed there yourself stay). Bans are kept and return when you switch it back on.", "Switch off", true) : Promise.resolve(true);
      go.then(function (ok) {
        if (!ok) { q("#cgEnabled").checked = true; return; }
        saveConfig(function (c) {
          c.Enabled = on; c.MaxMindAccountId = q("#cgMmId").value.trim(); c.MaxMindLicenseKey = q("#cgMmKey").value.trim();
        });
      });
      return false;
    }

    // ---------------- wiring ----------------
    // ---------------- import from Emby logs ----------------
    function importLogs() {
      return dialog("Import from Emby logs?",
        "Guard reads Emby\u2019s log files (embyserver.txt and the rotated embyserver-*.txt, kept " + ((S.status && S.status.LogFileRetentionDays) || 3) + " days) for failed sign-ins, forbidden sign-ins and 401/403 API calls, " +
        "adds them to its log with their original times and applies the ban rules to them. Items already in Guard\u2019s log are skipped, so it is safe to run again. LAN addresses are never banned; no notifications are sent for historical bans.",
        "Import").then(function (ok) {
        if (!ok) return;
        var b = q(".cg-import"); b.disabled = true; b.querySelector("span").textContent = "Importing\u2026";
        return post("ClawGuard/Import").then(function (r) {
          r = r || {};
          if (r.Error) return dialog("Import failed", esc(r.Error), "OK");
          S.lastImport = r;
          var range = r.From ? esc(new Date(r.From).toLocaleString()) + " \u2013 " + esc(new Date(r.To).toLocaleString()) : "-";
          var html = '<div class="cg-imp-big"><b class="cg-imp-n">' + r.Imported + "</b> items imported</div>" +
            '<table class="cg-imp-t"><tbody>' +
            "<tr><td>Failed sign-ins</td><td>" + r.SigninFailures + "</td></tr>" +
            "<tr><td>Forbidden sign-ins</td><td>" + r.Forbidden + "</td></tr>" +
            "<tr><td>Failed API calls (401/403)</td><td>" + r.ApiFailures + "</td></tr>" +
            "<tr><td>From LAN / whitelisted (never banned)</td><td>" + r.LanOrWhitelisted + "</td></tr>" +
            "<tr><td>Skipped: already in Guard\u2019s log</td><td>" + (r.AlreadyImported + r.AlreadyLogged) + "</td></tr>" +
            "<tr><td>Bans created by the rules</td><td>" + r.NewBans + (r.NewBans ? " (" + r.StillActiveBans + " still active)" : "") + "</td></tr>" +
            "<tr><td>Log files / lines read</td><td>" + r.Files + " / " + Number(r.LinesScanned).toLocaleString() + "</td></tr>" +
            "<tr><td>Period</td><td>" + range + "</td></tr></tbody></table>";
          q(".cg-import-last").textContent = "Last import: " + r.Imported + " imported, " + (r.AlreadyImported + r.AlreadyLogged) + " already logged.";
          if (r.Imported && parseInt(q(".cg-range").value, 10) === 24) q(".cg-range").value = "168";
          loadEvents(true); loadStatus(); loadBans();
          return dialog("Import finished", html, "OK");
        }, function (err) { return dialog("Import failed", esc(String(err && (err.statusText || err.message) || err)), "OK"); })
          .then(function () { b.disabled = false; b.querySelector("span").textContent = "Import from Emby logs"; });
      });
    }

    view.addEventListener("click", function (e) {
      var t = e.target;
      if (t.closest(".cg-import")) { importLogs(); return; }
      var tab = t.closest(".cg-tab"); if (tab) { showTab(tab.getAttribute("data-tab")); return; }
      if (!t.closest(".cg-menu") && !t.closest(".cg-live-t tbody tr")) hideMenu();
      var h = t.closest(".cg-live-t th[data-sort]");
      if (h) { var k = h.getAttribute("data-sort"); S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : (k === "time" || k === "count" ? -1 : 1) }; renderLive(); return; }
      var bh = t.closest(".cg-bans-t th[data-sort]");
      if (bh) { var bk = bh.getAttribute("data-sort"); BAN_SORT = { key: bk, dir: BAN_SORT.key === bk ? -BAN_SORT.dir : 1 }; renderBans(); return; }
      var row = t.closest(".cg-live-t tbody tr");
      if (row) {
        var id = parseInt(row.getAttribute("data-id"), 10);
        var ev = S.events.filter(function (x) { return x.Id === id; })[0];
        if (ev) rowMenu(e, ev);
        return;
      }
      var bb = t.closest(".cg-bans-t button[data-act]");
      if (bb) {
        var key = bb.closest("tr").getAttribute("data-key"), act = bb.getAttribute("data-act");
        var p = act === "unban" ? dialog("Unban " + key + "?", "Removes it from Emby's Remote IP filter now. The ban stays in history (escalation).", "Unban").then(function (ok) { return ok && post("ClawGuard/Bans/Unban", { Key: key }); })
          : act === "extend" ? post("ClawGuard/Bans/Extend", { Key: key, Minutes: 1440 })
          : dialog("Make the ban on " + key + " permanent?", "", "Make permanent", true).then(function (ok) { return ok && post("ClawGuard/Bans/Extend", { Key: key, Minutes: 0 }); });
        p.then(function () { loadBans(); loadStatus(); loadEvents(false); });
        return;
      }
      if (t.closest(".cg-ban-add")) {
        var ip = q(".cg-ban-ip").value.trim(), be = q(".cg-ban-err");
        if (!validCidr(ip)) { be.textContent = "Enter an IP address or CIDR."; be.classList.add("cg-on"); return; }
        be.classList.remove("cg-on");
        ban(ip, parseInt(q(".cg-ban-dur").value, 10), q(".cg-ban-reason").value).then(function (r) { if (r && r.Ok) { q(".cg-ban-ip").value = ""; q(".cg-ban-reason").value = ""; } });
        return;
      }
      if (t.closest(".cg-clear-ip")) { S.ipOnly = ""; renderLive(); return; }
      if (t.closest(".cg-step-add")) {
        var body = q(".cg-steps-body"), steps = readSteps();
        var last = steps.length ? steps[steps.length - 1] : 60;
        body.insertAdjacentHTML(last === 0 ? "beforeend" : "beforeend", stepRow(last === 0 ? 0 : last * 2));
        numberSteps(); return;
      }
      if (t.closest(".cg-step-del")) { t.closest("tr").remove(); numberSteps(); return; }
      if (t.closest(".cg-wl-add")) { addWl(q(".cg-wl-cidr").value, q(".cg-wl-note").value); q(".cg-wl-cidr").value = ""; q(".cg-wl-note").value = ""; return; }
      if (t.closest(".cg-wl-mine")) { if (S.status && S.status.YourIp) addWl(S.status.YourIp, "my address"); return; }
      if (t.closest(".cg-wl-del")) { S.wl.splice(parseInt(t.closest("tr").getAttribute("data-i"), 10), 1); renderWl(); return; }
      if (t.closest(".cg-wl-save")) { saveConfig(function (c) { c.Whitelist = S.wl.slice(); }); return; }
      if (t.closest(".cg-geo-now")) { post("ClawGuard/Geo/Refresh").then(function () { toast("Downloading GeoLite2-Country…"); setTimeout(loadStatus, 4000); }); return; }
    });
    view.addEventListener("change", function (e) {
      var t = e.target;
      if (t.classList.contains("cg-step-u")) { t.closest("tr").querySelector(".cg-step-n").disabled = t.value === "0"; return; }
      if (t.classList.contains("cg-range")) { loadEvents(true); return; }
      if (t.classList.contains("cg-kind")) { renderLive(); return; }
      if (t.classList.contains("cg-pause")) { var l = q(".cg-live"); l.classList.toggle("cg-paused", t.checked); l.innerHTML = t.checked ? "&#10074;&#10074; paused" : "&#9679; live (4 s)"; if (!t.checked) loadEvents(false); }
    });
    q(".cg-filter").addEventListener("input", renderLive);
    q(".cg-rules-form").addEventListener("submit", saveRules);
    q(".cg-settings-form").addEventListener("submit", saveSettings);

    function startPolling() {
      stopPolling();
      S.timer = setInterval(function () { if (!q(".cg-pause").checked && !document.hidden) loadEvents(false); }, POLL_MS);
      S.stimer = setInterval(function () { if (!document.hidden) loadStatus(); if (S.tab === "bans") loadBans(); }, STATUS_MS);
    }
    function stopPolling() { if (S.timer) clearInterval(S.timer); if (S.stimer) clearInterval(S.stimer); S.timer = S.stimer = null; }

    view.addEventListener("viewshow", function () {
      if (typeof Dashboard !== "undefined" && Dashboard.showLoadingMsg) Dashboard.showLoadingMsg();
      Promise.all([loadConfig(), loadStatus(), loadEvents(true), loadBans()]).then(function () {
        if (typeof Dashboard !== "undefined" && Dashboard.hideLoadingMsg) Dashboard.hideLoadingMsg();
      }, function () { if (typeof Dashboard !== "undefined" && Dashboard.hideLoadingMsg) Dashboard.hideLoadingMsg(); });
      startPolling();
    });
    view.addEventListener("viewhide", function () { stopPolling(); hideMenu(); });
    view.addEventListener("viewdestroy", stopPolling);

    View.__state = S;
  }
  return View;
});
