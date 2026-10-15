/* Offline stand-in for the bits of the Emby 4.10 web client the plugin scripts touch.
 * Shared by test-menu.js and test-settings.js. Not shipped. */
(function () {
  "use strict";
  var log = window.__log = { requests: [], confirms: [], alerts: [], toasts: [], refreshes: 0 };
  var srv = window.__server = {
    admin: true,
    items: {
      "101": { Id: "101", Name: "Heat", Type: "Movie", ProductionYear: 1995, chapters: 7, interval: 0 },
      "102": { Id: "102", Name: "Alien", Type: "Movie", ProductionYear: 1979, chapters: 24, interval: 5 },
      "103": { Id: "103", Name: "Arrival", Type: "Movie", ProductionYear: 2016, chapters: 12, interval: 0 },
      "201": { Id: "201", Name: "Pilot", Type: "Episode", chapters: 2, interval: 0 },
      "301": { Id: "301", Name: "Recorded Movie", Type: "Movie", notEligible: true, chapters: 0, interval: 0 }
    },
    overrides: {},
    foundCalls: [],
    manyCalls: [],
    forceConfirmOnPost: false,
    failNext: null,
    configuredInterval: 5,
    pluginConfig: { IntervalMinutes: 5 }
  };

  function row(it) {
    return { Id: it.Id, ItemGuid: "guid" + it.Id, Name: it.Name, ProductionYear: it.ProductionYear, Path: "E:\\Movies\\" + it.Name + "\\" + it.Name + ".mkv",
      ChangedUtc: it.changed || "2026-10-05T19:00:00Z", BeforeCount: it.before, AfterCount: it.after, IntervalMinutes: it.ovInterval };
  }
  srv.addOverride = function (id, opts) {
    var it = srv.items[id];
    it.before = it.chapters; it.after = (opts && opts.after) || 25; it.ovInterval = (opts && opts.interval) || 5;
    it.changed = (opts && opts.changed) || "2026-10-05T19:00:00Z";
    srv.overrides[id] = true;
  };

  function status(it) {
    var s = { Id: it.Id, Name: it.Name, Type: it.Type, IsMovie: it.Type === "Movie" && !it.notEligible, HasOverride: !!srv.overrides[it.Id],
      ChapterCount: it.chapters, LooksInterval: it.interval > 0, DetectedIntervalMinutes: it.interval, IntervalMinutes: srv.configuredInterval };
    if (!s.IsMovie) { s.HasOverride = false; s.LooksInterval = false; }
    if (s.HasOverride) { s.NeedsConfirm = true; s.ConfirmReason = "This movie already has interval chapters from this plugin. Replace them?"; }
    else if (s.LooksInterval) { s.NeedsConfirm = true; s.ConfirmReason = "This movie's " + it.chapters + " chapters already look like a " + it.interval + "-minute interval set. Replace them anyway?"; }
    return s;
  }

  function fail(statusCode, text) {
    return Promise.reject({ status: statusCode, text: function () { return Promise.resolve(text); } });
  }

  function handle(method, url) {
    var m = url.replace(/^https?:\/\/[^/]+\/emby\//, "");
    log.requests.push(method + " " + m);
    if (srv.failNext) { var f = srv.failNext; srv.failNext = null; return fail(f.status, f.text); }
    if (method === "GET" && m === "DefaultChapters/Overrides") {
      if (!srv.admin) return fail(403, "Forbidden");
      return Promise.resolve({ Enabled: srv.pluginConfig.Enabled !== false, IntervalMinutes: srv.configuredInterval, Items: Object.keys(srv.overrides).map(function (id) { return row(srv.items[id]); }) });
    }
    if (method === "GET" && /^DefaultChapters\/Found\?/.test(m)) {
      var q = {}; m.split("?")[1].split("&").forEach(function (kv) { var p = kv.split("="); q[p[0]] = decodeURIComponent(p[1]); });
      srv.foundCalls.push(q);
      var min = +q.MinRuntimeMinutes, max = +q.MaxChapters, excl = q.ExcludeOverridden === "true";
      var scanned = 0, items = [];
      Object.keys(srv.items).forEach(function (id) {
        var it = srv.items[id];
        if (it.Type !== "Movie" || it.notEligible || !(it.runtime > min)) return;
        scanned++;
        if (excl && srv.overrides[id]) return;
        if (it.chapters > max) return;
        var st = status(it);
        items.push({ Id: id, Name: it.Name, ProductionYear: it.ProductionYear, Path: "E:\\Movies\\" + it.Name + "\\" + it.Name + ".mkv", RunTimeTicks: it.runtime * 600000000,
          ChapterCount: it.chapters, MarkerCount: it.markers || 0, HasOverride: !!srv.overrides[id], LooksInterval: it.interval > 0, DetectedIntervalMinutes: it.interval,
          NeedsConfirm: !!st.NeedsConfirm, ConfirmReason: st.ConfirmReason, CanGenerate: it.runtime >= srv.configuredInterval });
      });
      items.sort(function (a, b) { return a.Name.toLowerCase() < b.Name.toLowerCase() ? -1 : 1; });
      return Promise.resolve({ Criteria: { MinRuntimeMinutes: min, MaxChapters: max, ExcludeOverridden: excl }, IntervalMinutes: srv.configuredInterval,
        ScannedCount: scanned, MatchCount: items.length, Truncated: false, Items: items });
    }
    if (method === "POST" && /^DefaultChapters\/GenerateMany\?/.test(m)) {
      var qs = {}; m.split("?")[1].split("&").forEach(function (kv) { var p = kv.split("="); qs[p[0]] = decodeURIComponent(p[1]); });
      var ids = qs.Ids.split(","), conf = qs.Confirmed === "true";
      srv.manyCalls.push({ ids: ids, confirmed: conf });
      var results = ids.map(function (id) {
        var it = srv.items[id];
        if (!it) return { Id: id, Error: "Item not found." };
        if (it.failWith) return { Id: id, Name: it.Name, Error: it.failWith };
        var st = status(it);
        if (!st.IsMovie) return { Id: id, Name: it.Name, Error: "Interval chapters are only available for movies." };
        if (st.NeedsConfirm && !conf) return { Id: id, Name: it.Name, NeedsConfirm: true, ConfirmReason: st.ConfirmReason };
        if (!srv.overrides[id]) srv.addOverride(id, { after: Math.ceil((it.runtime || 100) / srv.configuredInterval), interval: srv.configuredInterval });
        it.interval = srv.configuredInterval;
        return { Id: id, Name: it.Name, Changed: true, Row: row(it) };
      });
      return Promise.resolve({ Results: results, ChangedCount: results.filter(function (x) { return x.Changed; }).length });
    }
    var r = /^DefaultChapters\/Items\/([^/]+)\/(Status|Generate|Restore)(\?Confirmed=(true|false))?$/.exec(m);
    if (!r) return fail(404, "no route " + m);
    var it = srv.items[decodeURIComponent(r[1])];
    if (!it) return fail(404, "Item not found.");
    if (r[2] === "Status" && method === "GET") return Promise.resolve(status(it));
    if (r[2] === "Generate" && method === "POST") {
      var st = status(it);
      if (!st.IsMovie) return fail(400, "Interval chapters are only available for movies.");
      var confirmed = r[4] === "true";
      if ((st.NeedsConfirm || srv.forceConfirmOnPost) && !confirmed) {
        srv.forceConfirmOnPost = false;
        return Promise.resolve({ Changed: false, NeedsConfirm: true, ConfirmReason: st.ConfirmReason || "Something changed since you opened the menu. Replace the chapters?" });
      }
      if (!srv.overrides[it.Id]) srv.addOverride(it.Id, { after: 25, interval: srv.configuredInterval });
      it.interval = srv.configuredInterval;
      return Promise.resolve({ Changed: true, Row: row(it) });
    }
    if (r[2] === "Restore" && method === "POST") {
      if (!srv.overrides[it.Id]) return fail(404, "No stashed chapters for this item.");
      delete srv.overrides[it.Id];
      it.interval = 0;
      return Promise.resolve({ Restored: true, Removed: true, ChapterCount: it.before });
    }
    return fail(405, "bad method");
  }

  window.ApiClient = {
    serverId: function () { return "srv1"; },
    getUrl: function (p) { return "http://emby.local/emby/" + p.replace(/^\//, ""); },
    getJSON: function (u) { return handle("GET", u); },
    ajax: function (o) { return handle(o.type || "GET", o.url); },
    getCurrentUser: function () { return Promise.resolve({ Id: "u1", Name: srv.admin ? "admin" : "kid", Policy: { IsAdministrator: srv.admin } }); },
    getImageUrl: function (id) { return "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60"><rect width="40" height="60" fill="hsl(' + (parseInt(id, 10) * 47 % 360) + ',35%,32%)"/></svg>'); },
    getInstalledPlugins: function () { return Promise.resolve([{ Id: "b5671c07-59f4-4bbd-924e-0b2483056350", Name: "Default Chapters", Version: "1.2.0.0" }]); },
      getPluginConfiguration: function () { return Promise.resolve(JSON.parse(JSON.stringify(srv.pluginConfig))); },
    updatePluginConfiguration: function (id, cfg) { log.requests.push("POST Plugins/" + id + "/Configuration " + JSON.stringify(cfg)); srv.pluginConfig = cfg; return Promise.resolve(); }
  };

  // ---- itemmanager with the same command-source semantics as Emby 4.10's itemmanager.js
  var sources = [];
  function baseCommands(o) {
    var item = (o.items || [o.item])[0];
    var c = [{ name: "Play", id: "resume", icon: "play_arrow" }, { name: "Add to collection", id: "addtocollection", icon: "playlist_add" },
      { name: "Add to playlist", id: "addtoplaylist", icon: "playlist_add" }, { name: "Mark played", id: "markplayed", icon: "check" }];
    if (item && o.user && o.user.Policy.IsAdministrator) c.push({ name: "Edit metadata", id: "edit", icon: "edit" }, { name: "Edit images", id: "editimages", icon: "image" }, { name: "Refresh metadata", id: "refresh", icon: "refresh" });
    return c;
  }
  var itemmanager = {
    registerCommandSource: function (s) { sources.push(s); },
    getCommands: function (options) {
      var items = options.items || (options.item ? [options.item] : []);
      if (!items.length) return [];
      var commands = baseCommands(options);
      for (var i = 0; i < sources.length; i++) commands = commands.concat(sources[i].getCommands(options));
      return commands;
    },
    executeCommand: function (command, items, options) {
      var o = Object.assign({}, options); o.items = items;
      for (var i = 0; i < sources.length; i++) {
        var cmds = sources[i].getCommands(o);
        for (var j = 0; j < cmds.length; j++) if (cmds[j].id === command) return sources[i].executeCommand(command, items, options);
      }
      return Promise.reject("nocommands");
    },
    _sources: sources
  };

  var confirmAnswer = { value: true };
  window.__confirmAnswer = confirmAnswer;
  function showDialog(kind, o) {
    var d = document.createElement("div");
    d.className = "mock-dialog";
    d.innerHTML = '<div class="mock-dialog-box"><h3></h3><p></p><div class="mock-dialog-btns">' +
      (kind === "confirm" ? '<button class="mock-cancel">' + (o.cancelText || "Cancel") + '</button>' : "") +
      '<button class="mock-ok">' + (o.confirmText || (kind === "confirm" ? "OK" : "Got It")) + "</button></div></div>";
    d.querySelector("h3").textContent = o.title || "";
    d.querySelector("p").textContent = o.text || "";
    document.body.appendChild(d);
    return d;
  }
  var modules = {
    "./modules/common/itemmanager/itemmanager.js": itemmanager,
    "./modules/common/dialogs/confirm.js": function (o) {
      log.confirms.push(o);
      var d = showDialog("confirm", o);
      if (window.__keepDialogs) return new Promise(function () { });
      d.remove();
      return confirmAnswer.value ? Promise.resolve() : Promise.reject();
    },
    "./modules/common/dialogs/alert.js": function (o) { log.alerts.push(o); return Promise.resolve(); },
    "./modules/toast/toast.js": function (o) { log.toasts.push(o.text || o); return Promise.resolve(); },
    "./modules/approuter.js": { refreshCurrentView: function () { log.refreshes++; } }
  };
  window.__installEmby = function () {
    window.Emby = { importModule: function (p) { return modules[p] ? Promise.resolve(modules[p]) : Promise.reject(new Error("unknown module " + p)); } };
  };
  window.__itemmanager = itemmanager;
  window.Dashboard = { showLoadingMsg: function () { }, hideLoadingMsg: function () { } };
})();
