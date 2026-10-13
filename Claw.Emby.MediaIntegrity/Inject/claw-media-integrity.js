/* Media Integrity (Claw.Emby.MediaIntegrity) - web client inject, v__PLUGIN_VERSION__
 * Adds "Verify integrity" to the "..." menu of media items and folders (movies, episodes, series, seasons, folders,
 * libraries, music, videos ...) for administrators. Uses Emby's extension point itemmanager.registerCommandSource().
 * The check runs in the plugin's background queue; this script polls the job and shows the result in a toast that
 * links to the Media Integrity page. Plain ES5, one global: window.__clawMediaIntegrity. */
(function () {
  "use strict";
  if (window.__clawMediaIntegrity) return;

  var CMD = "claw-mi-verify";
  var PAGE = "configurationpage?name=ClawMediaIntegrity";
  var WAIT_MS = 500, WAIT_MAX = 240;
  var POLL_MS = 1500, POLL_MAX_MS = 10 * 60 * 1000;
  // things that are not media / have no files of their own
  var SKIP = { Person: 1, Genre: 1, MusicGenre: 1, GameGenre: 1, Studio: 1, Tag: 1, TvChannel: 1, Program: 1, Timer: 1, SeriesTimer: 1, Channel: 1, ChannelFolderItem: 0, UserView: 1, Device: 1, Plugin: 1, Server: 1, ActiveRecording: 1 };
  var state = { isAdmin: null, registered: false, toastEl: null, toastTimer: null };

  function api() { return window.ApiClient || null; }
  function unwrap(m) { return m && m.__esModule && ("default" in m) ? m["default"] : m; }
  function importModule(path) {
    if (!window.Emby || typeof window.Emby.importModule !== "function") return Promise.reject(new Error("no module loader"));
    return window.Emby.importModule(path).then(unwrap);
  }
  function url(path) { return api().getUrl("ClawMediaIntegrity/" + path); }
  function post(path) { return api().ajax({ type: "POST", url: url(path), dataType: "json" }); }
  function getJSON(path) { return api().getJSON(url(path)); }
  function errorText(err) {
    if (!err) return Promise.resolve("Request failed.");
    if (typeof err === "string") return Promise.resolve(err);
    if (err.text && typeof err.text === "function") {
      return err.text().then(function (t) { t = String(t || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); return t || ("Request failed (" + (err.status || "?") + ")."); },
        function () { return "Request failed (" + (err.status || "?") + ")."; });
    }
    return Promise.resolve(err.message || "Request failed.");
  }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function bytes(b) { var u = ["B", "KB", "MB", "GB", "TB"], i = 0; b = +b || 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return (i ? b.toFixed(b < 10 ? 2 : 1) : b) + " " + u[i]; }

  function openPage() {
    return importModule("./modules/approuter.js").then(function (r) {
      if (r && typeof r.show === "function") return r.show(PAGE);
      throw new Error("no router");
    }).then(null, function () {
      if (window.Dashboard && typeof window.Dashboard.navigate === "function") return window.Dashboard.navigate(PAGE);
      window.location.hash = "#!/" + PAGE;
    });
  }

  // ------------------------------------------------------------ toast with a link (Emby's toast has no actions)
  function css() {
    if (document.getElementById("claw-mi-toast-css")) return;
    var s = document.createElement("style"); s.id = "claw-mi-toast-css";
    s.textContent = ".claw-mi-toast{position:fixed;left:50%;bottom:1.5em;transform:translateX(-50%);z-index:99999;background:#303030;color:#fff;border-radius:.3em;box-shadow:0 .2em .8em rgba(0,0,0,.5);padding:.75em 1em;display:flex;align-items:center;gap:.8em;max-width:min(42em,92vw);font-size:.95em;line-height:1.35}" +
      ".claw-mi-toast .md-icon{font-size:1.5em;flex:none}.claw-mi-toast.ok .md-icon{color:#52b54b}.claw-mi-toast.warn .md-icon{color:#e8a33d}.claw-mi-toast.bad .md-icon{color:#e05252}" +
      ".claw-mi-toast .t{flex:1;min-width:0}.claw-mi-toast .s{opacity:.75;font-size:.88em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".claw-mi-toast a{color:#52b54b;font-weight:600;text-decoration:none;white-space:nowrap;cursor:pointer}.claw-mi-toast a:hover{text-decoration:underline}" +
      ".claw-mi-toast button{background:none;border:0;color:inherit;opacity:.6;cursor:pointer;font-size:1.1em;padding:0 .2em}";
    document.head.appendChild(s);
  }
  function showToast(kind, text, sub, sticky) {
    css();
    var el = state.toastEl;
    if (!el) {
      el = document.createElement("div"); el.className = "claw-mi-toast";
      el.innerHTML = '<i class="md-icon">health_and_safety</i><div class="t"><div class="m"></div><div class="s"></div></div><a class="claw-mi-open">Open Media Integrity</a><button type="button" class="claw-mi-x" title="Close">✕</button>';
      el.querySelector(".claw-mi-open").addEventListener("click", function (e) { e.preventDefault(); hideToast(); openPage(); });
      el.querySelector(".claw-mi-x").addEventListener("click", hideToast);
      document.body.appendChild(el); state.toastEl = el;
    }
    el.className = "claw-mi-toast " + (kind || "");
    el.querySelector(".md-icon").textContent = kind === "bad" ? "gpp_maybe" : kind === "warn" ? "hourglass_top" : "health_and_safety";
    el.querySelector(".m").textContent = text;
    el.querySelector(".s").textContent = sub || "";
    el.querySelector(".s").style.display = sub ? "" : "none";
    clearTimeout(state.toastTimer);
    if (!sticky) state.toastTimer = setTimeout(hideToast, 12000);
  }
  function hideToast() { clearTimeout(state.toastTimer); if (state.toastEl && state.toastEl.parentNode) state.toastEl.parentNode.removeChild(state.toastEl); state.toastEl = null; }

  /** Pure: toast text for a finished/running job. Exported for tests. */
  function summarize(job) {
    var probs = (job.Changed || 0) + (job.Modified || 0) + (job.Missing || 0) + (job.Unreadable || 0);
    var parts = [];
    if (job.Ok) parts.push(job.Ok + " OK");
    if (job.New) parts.push(job.New + " new");
    if (job.Changed) parts.push(job.Changed + " CHANGED");
    if (job.Modified) parts.push(job.Modified + " modified");
    if (job.Missing) parts.push(job.Missing + " missing");
    if (job.Unreadable) parts.push(job.Unreadable + " unreadable");
    var kind = probs ? "bad" : "ok";
    var head;
    if (job.State === "cancelled") { head = "Integrity check cancelled after " + job.Done + " of " + plural(job.Total, "file"); kind = "warn"; }
    else if (!job.Total) { head = "Verify integrity: no files found for " + (job.Label || "this item"); kind = "warn"; }
    else if (probs) head = "Integrity: " + plural(probs, "problem") + " in " + (job.Label || "item");
    else head = "Integrity OK: " + (job.Label || "item");
    var sub = parts.join(" · ") || "";
    if (job.Findings && job.Findings.length) sub += (sub ? " — " : "") + job.Findings[0].Result + ": " + job.Findings[0].Path.split(/[\\/]/).pop();
    return { kind: kind, text: head, sub: sub, problems: probs };
  }

  function watch(job) {
    var started = Date.now();
    function tick(j) {
      if (j.State === "done" || j.State === "cancelled") { var s = summarize(j); showToast(s.kind, s.text, s.sub, s.problems > 0); return j; }
      if (Date.now() - started > POLL_MAX_MS) { showToast("warn", "Still checking " + (j.Label || "") + " in the background", j.Done + " of " + plural(j.Total, "file") + " so far", true); return j; }
      showToast("warn", "Checking " + (j.Label || "item") + "…", (j.Done || 0) + " of " + plural(j.Total, "file") + " (" + bytes(j.BytesTotal) + ")", true);
      return new Promise(function (res) { setTimeout(res, POLL_MS); }).then(function () { return getJSON("Check/Jobs/" + j.Id); }).then(tick);
    }
    return tick(job);
  }

  function verify(items) {
    var ids = items.map(function (i) { return String(i.Id); }).join(",");
    showToast("warn", "Queueing integrity check…", "", true);
    return post("Check/Items?Ids=" + encodeURIComponent(ids)).then(watch).then(function (j) { return { command: CMD, job: j }; }, function (err) {
      return errorText(err).then(function (t) { showToast("bad", "Verify integrity failed", t, true); return { command: CMD, error: t }; });
    });
  }

  // ------------------------------------------------------------ menu
  function userFrom(o) {
    if (!o) return null;
    if (o.user) return o.user;
    if (o.users && api() && typeof api().serverId === "function") return o.users[api().serverId()] || null;
    return null;
  }
  function isAdmin(o) { var u = userFrom(o); if (u && u.Policy) return !!u.Policy.IsAdministrator; return state.isAdmin === true; }
  function eligible(item) { return !!(item && item.Id && item.Type && !SKIP[item.Type] && item.LocationType !== "Virtual"); }

  var source = {
    getCommands: function (options) {
      options = options || {};
      var items = options.items || (options.item ? [options.item] : []);
      if (!items.length || !isAdmin(options)) return [];
      for (var i = 0; i < items.length; i++) if (!eligible(items[i])) return [];
      return [{ name: "Verify integrity", id: CMD, icon: "health_and_safety" }];
    },
    executeCommand: function (command, items) {
      if (command !== CMD) return Promise.reject("nocommands");
      if (!items || !items.length) return Promise.reject("noitems");
      return verify(items);
    }
  };

  function loadUser() {
    var c = api();
    if (!c || typeof c.getCurrentUser !== "function") return Promise.resolve(null);
    return c.getCurrentUser().then(function (u) { state.isAdmin = !!(u && u.Policy && u.Policy.IsAdministrator); return u; }, function () { return null; });
  }

  function register() {
    return importModule("./modules/common/itemmanager/itemmanager.js").then(function (im) {
      if (!im || typeof im.registerCommandSource !== "function") throw new Error("itemmanager has no registerCommandSource");
      if (!state.registered) { im.registerCommandSource(source); state.registered = true; }
      loadUser();
      return true;
    });
  }
  function boot(tries) {
    if (window.Emby && typeof window.Emby.importModule === "function") {
      register().then(null, function (e) { if (window.console) console.warn("Media Integrity: menu not registered", e); });
      return;
    }
    if (tries >= WAIT_MAX) return;
    setTimeout(function () { boot(tries + 1); }, WAIT_MS);
  }

  window.__clawMediaIntegrity = { version: "__PLUGIN_VERSION__", command: CMD, source: source, state: state, summarize: summarize, verify: verify, openPage: openPage };
  boot(0);
})();
