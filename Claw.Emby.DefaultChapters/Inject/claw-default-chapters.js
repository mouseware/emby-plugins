/* Default Chapters (Claw.Emby.DefaultChapters) - web client inject, v__PLUGIN_VERSION__
 * Adds "Generate interval chapters" / "Restore original chapters" to the "..." menu of movies, for
 * administrators. Uses Emby's own extension point: itemmanager.registerCommandSource().
 * Written by the plugin at startup into dashboard-ui; plain ES5, no globals besides
 * window.__clawDefaultChapters. All changes go through the plugin's admin-only API. */
(function () {
  "use strict";

  if (window.__clawDefaultChapters) return;

  var CMD_GENERATE = "claw-dc-generate";
  var CMD_RESTORE = "claw-dc-restore";
  var STALE_MS = 30000;
  var WAIT_MS = 500;
  var WAIT_MAX = 240; // ~2 minutes for the app to boot

  var state = {
    ids: {},          // internal item id -> true (movies with an override, i.e. a stash exists)
    loadedAt: 0,
    loading: null,
    isAdmin: null,    // null = unknown yet
    registered: false
  };

  // ------------------------------------------------------------ helpers
  function api() { return window.ApiClient || null; }

  function unwrap(m) {
    // Emby.importModule already hands back the default export; unwrap raw ES-module namespaces too.
    return m && m.__esModule && ("default" in m) ? m["default"] : m;
  }

  function importModule(path) {
    if (!window.Emby || typeof window.Emby.importModule !== "function") return Promise.reject(new Error("no module loader"));
    return window.Emby.importModule(path).then(unwrap);
  }

  function url(path) { return api().getUrl("DefaultChapters/" + path); }

  function getJSON(path) { return api().getJSON(url(path)); }

  function post(path) {
    return api().ajax({ type: "POST", url: url(path), dataType: "json" });
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

  function toast(text) {
    return importModule("./modules/toast/toast.js").then(function (t) { return t({ text: text, icon: "bookmarks" }); },
      function () { /* toast is cosmetic */ });
  }

  function alertMsg(text, title) {
    return importModule("./modules/common/dialogs/alert.js").then(function (a) {
      return a({ title: title || "Default Chapters", text: text }).then(null, function () { });
    }, function () { window.alert(text); });
  }

  /** Resolves true when the user confirms, false when cancelled. */
  function confirmDlg(text) {
    return importModule("./modules/common/dialogs/confirm.js").then(function (confirm) {
      return confirm({ title: "Replace chapters?", text: text, confirmText: "Replace", primary: "cancel" })
        .then(function () { return true; }, function () { return false; });
    }, function () { return !!window.confirm(text); });
  }

  function refreshView() {
    return importModule("./modules/approuter.js").then(function (r) {
      if (r && typeof r.refreshCurrentView === "function") r.refreshCurrentView();
    }, function () { });
  }

  // ------------------------------------------------------------ state
  function loadUser() {
    var c = api();
    if (!c || typeof c.getCurrentUser !== "function") return Promise.resolve(null);
    return c.getCurrentUser().then(function (u) {
      state.isAdmin = !!(u && u.Policy && u.Policy.IsAdministrator);
      return u;
    }, function () { return null; });
  }

  function loadOverrides(force) {
    if (!api()) return Promise.resolve(state.ids);
    if (state.loading) return state.loading;
    if (!force && Date.now() - state.loadedAt < STALE_MS) return Promise.resolve(state.ids);
    state.loading = loadUser().then(function () {
      if (state.isAdmin === false) { state.ids = {}; return state.ids; }
      return getJSON("Overrides").then(function (res) {
        var ids = {};
        (res && res.Items || []).forEach(function (r) { ids[String(r.Id)] = true; });
        state.ids = ids;
        return ids;
      });
    }).then(function (ids) {
      state.loadedAt = Date.now(); state.loading = null; return ids;
    }, function () {
      state.loadedAt = Date.now(); state.loading = null; return state.ids;
    });
    return state.loading;
  }

  function userFrom(options) {
    if (!options) return null;
    if (options.user) return options.user;
    if (options.users && api() && typeof api().serverId === "function") return options.users[api().serverId()] || null;
    return null;
  }

  function isAdmin(options) {
    var u = userFrom(options);
    if (u && u.Policy) return !!u.Policy.IsAdministrator;
    return state.isAdmin === true;
  }

  // ------------------------------------------------------------ commands
  var source = {
    getCommands: function (options) {
      options = options || {};
      var items = options.items || (options.item ? [options.item] : []);
      if (items.length !== 1) return [];
      var item = items[0];
      if (!item || item.Type !== "Movie" || !item.Id || item.ExtraType) return [];
      loadOverrides(false); // background refresh, used by the next menu
      if (!isAdmin(options)) return [];

      var cmds = [{ name: "Generate interval chapters", id: CMD_GENERATE, icon: "bookmarks" }];
      if (state.ids[String(item.Id)]) cmds.push({ name: "Restore original chapters", id: CMD_RESTORE, icon: "restore" });
      return cmds;
    },

    executeCommand: function (command, items) {
      var item = items && items[0];
      if (!item) return Promise.reject("noitems");
      if (command === CMD_GENERATE) return generate(item);
      if (command === CMD_RESTORE) return restore(item);
      return Promise.reject("nocommands");
    }
  };

  function generate(item) {
    var id = String(item.Id);
    return getJSON("Items/" + encodeURIComponent(id) + "/Status").then(function (st) {
      if (!st || !st.IsMovie) {
        return alertMsg("Interval chapters are only available for movies in a Movies library.");
      }
      var ask = st.NeedsConfirm ? confirmDlg(st.ConfirmReason) : Promise.resolve(null);
      return ask.then(function (answer) {
        if (answer === false) return { cancelled: true };
        return post("Items/" + encodeURIComponent(id) + "/Generate?Confirmed=" + (answer === true));
      }).then(function (res) {
        // The server repeats the check; if something changed since the status call, ask now.
        if (res && res.NeedsConfirm) {
          return confirmDlg(res.ConfirmReason).then(function (ok) {
            return ok ? post("Items/" + encodeURIComponent(id) + "/Generate?Confirmed=true") : { cancelled: true };
          });
        }
        return res;
      }).then(function (res) {
        if (!res || res.cancelled) return { command: CMD_GENERATE, cancelled: true };
        state.ids[id] = true;
        var row = res.Row || {};
        toast("Interval chapters created: " + row.AfterCount + " chapters, every " + row.IntervalMinutes + " min");
        refreshView();
        return { command: CMD_GENERATE, updated: true, row: row };
      });
    }).then(null, function (err) {
      return errorText(err).then(function (t) { alertMsg(t, "Could not generate chapters"); return { command: CMD_GENERATE, error: t }; });
    });
  }

  function restore(item) {
    var id = String(item.Id);
    return post("Items/" + encodeURIComponent(id) + "/Restore").then(function (res) {
      delete state.ids[id];
      toast(res && res.Restored ? "Original chapters restored (" + res.ChapterCount + ")" : "Override removed");
      refreshView();
      return { command: CMD_RESTORE, updated: true };
    }, function (err) {
      return errorText(err).then(function (t) { alertMsg(t, "Could not restore chapters"); return { command: CMD_RESTORE, error: t }; });
    });
  }

  // ------------------------------------------------------------ boot
  function register() {
    return importModule("./modules/common/itemmanager/itemmanager.js").then(function (im) {
      if (!im || typeof im.registerCommandSource !== "function") throw new Error("itemmanager has no registerCommandSource");
      if (!state.registered) {
        im.registerCommandSource(source);
        state.registered = true;
      }
      loadOverrides(true);
      return true;
    });
  }

  function boot(tries) {
    if (window.Emby && typeof window.Emby.importModule === "function") {
      register().then(null, function (e) {
        if (window.console) console.warn("Default Chapters: menu not registered", e);
      });
      return;
    }
    if (tries >= WAIT_MAX) return;
    setTimeout(function () { boot(tries + 1); }, WAIT_MS);
  }

  window.__clawDefaultChapters = {
    version: "__PLUGIN_VERSION__",
    commands: { generate: CMD_GENERATE, restore: CMD_RESTORE },
    source: source,
    state: state,
    reload: function () { return loadOverrides(true); }
  };

  boot(0);
})();
