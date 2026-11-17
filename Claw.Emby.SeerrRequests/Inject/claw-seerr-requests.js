/* Seerr Requests (Claw.Emby.SeerrRequests) - web client inject, v__PLUGIN_VERSION__
 * Adds "Request this now" to the "..." menu of trailers and of movies/shows that are not already in this library.
 * Uses Emby's extension point itemmanager.registerCommandSource(). Plain ES5, one global: window.__clawSeerrRequests. */
(function () {
  "use strict";
  if (window.__clawSeerrRequests) return;

  var CMD = "claw-seerr-request";
  var WAIT_MS = 500, WAIT_MAX = 240;
  var state = { enabled: true, canRequest: true, infoAt: 0, registered: false };

  function api() { return window.ApiClient || null; }
  function unwrap(m) { return m && m.__esModule && ("default" in m) ? m["default"] : m; }
  function importModule(path) {
    if (!window.Emby || typeof window.Emby.importModule !== "function") return Promise.reject(new Error("no module loader"));
    return window.Emby.importModule(path).then(unwrap);
  }
  function url(path, q) { return api().getUrl("ClawSeerrRequests/" + path, q || {}); }
  function getJSON(path, q) { return api().getJSON(url(path, q)); }
  function post(path, data) {
    return api().ajax({ type: "POST", url: url(path, data || {}), dataType: "json" });
  }
  function errorText(err) {
    if (!err) return Promise.resolve("Request failed.");
    if (typeof err === "string") return Promise.resolve(err);
    if (err.text && typeof err.text === "function") {
      return err.text().then(function (t) { t = String(t || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); return t || ("Request failed (" + (err.status || "?") + ")."); },
        function () { return "Request failed (" + (err.status || "?") + ")."; });
    }
    return Promise.resolve(err.message || "Request failed.");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function isTrailer(item) {
    if (!item) return false;
    if (item.Type === "Trailer") return true;
    var ex = item.ExtraType || item.extraType;
    return ex === "Trailer" || ex === "TrailerOf";
  }
  function isMovieOrShow(item) {
    return item && (item.Type === "Movie" || item.Type === "Series" || item.Type === "Season");
  }
  function hasLocalMedia(item) {
    if (!item) return false;
    if (item.LocationType === "Virtual") return false;
    if (item.Path || item.path) return true;
    if (item.MediaSourceCount > 0) return true;
    if (item.MediaSources && item.MediaSources.length) return true;
    return false;
  }
  function isUnownedMovieOrShow(item) {
    return isMovieOrShow(item) && !isTrailer(item) && !hasLocalMedia(item);
  }
  function itemEligible(item) {
    return !!(item && item.Id && (isTrailer(item) || isUnownedMovieOrShow(item)));
  }

  function css() {
    if (document.getElementById("claw-sr-css")) return;
    var s = document.createElement("style"); s.id = "claw-sr-css";
    s.textContent =
      ".claw-sr-modal{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10001;display:flex;align-items:center;justify-content:center}" +
      ".claw-sr-dlg{background:#202020;color:#eee;border-radius:.5em;padding:1.2em 1.4em;max-width:28em;width:92vw;box-shadow:0 1em 3em rgba(0,0,0,.6)}" +
      ".claw-sr-dlg h3{margin:.1em 0 .35em;font-size:1.15em}.claw-sr-dlg .sub{opacity:.7;margin:0 0 .8em;font-size:.92em}" +
      ".claw-sr-pill{display:inline-block;font-size:.8em;padding:.08em .5em;border-radius:.3em;background:rgba(128,128,128,.22);margin-left:.4em}" +
      ".claw-sr-pill.ok{background:rgba(82,181,75,.2);color:#9ad895}.claw-sr-pill.pending{background:rgba(224,160,48,.2);color:#e0a030}" +
      ".claw-sr-pill.req{background:rgba(80,140,224,.2);color:#8cb4f0}.claw-sr-pill.bad{background:rgba(224,80,80,.2);color:#f0a0a0}" +
      ".claw-sr-msg{margin:.4em 0 .7em;font-size:.92em}.claw-sr-msg.err{color:#e05050}.claw-sr-msg.ok{color:#52b54b}" +
      ".claw-sr-seasons{margin:.4em 0 .8em;max-height:14em;overflow:auto;border:1px solid rgba(128,128,128,.25);border-radius:.35em;padding:.4em .6em}" +
      ".claw-sr-seasons label{display:flex;gap:.5em;align-items:center;padding:.2em 0}" +
      ".claw-sr-mode{margin:.3em 0 .5em;display:flex;gap:1em;flex-wrap:wrap}" +
      ".claw-sr-btns{display:flex;justify-content:flex-end;gap:.5em;margin-top:1em}" +
      ".claw-sr-btn{font:inherit;color:inherit;cursor:pointer;background:rgba(128,128,128,.2);border:1px solid rgba(128,128,128,.4);border-radius:.3em;padding:.4em .9em}" +
      ".claw-sr-btn.pri{background:#52b54b;border-color:#52b54b;color:#fff}.claw-sr-btn[disabled]{opacity:.45;cursor:default}";
    document.head.appendChild(s);
  }
  function pillClass(st) {
    if (st === "Available") return "ok";
    if (st === "Pending") return "pending";
    if (st === "Requested" || st === "Partially available") return "req";
    if (st === "Declined" || st === "Blocklisted") return "bad";
    return "";
  }
  function closeModal() {
    var m = document.querySelector(".claw-sr-modal");
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  function chosenSeasons(dlg, status) {
    if (!status || status.MediaType !== "tv") return "";
    var all = dlg.querySelector('input[name="claw-sr-mode"][value="all"]');
    if (all && all.checked) return "all";
    var nums = [];
    Array.prototype.forEach.call(dlg.querySelectorAll(".claw-sr-season:checked"), function (c) { nums.push(c.value); });
    return nums.join(",");
  }

  function renderDialog(status) {
    css();
    closeModal();
    var title = (status.Title || "This title") + (status.Year ? " (" + status.Year + ")" : "");
    var st = status.Status && status.Status !== "None" ? status.Status : "";
    var html = '<div class="claw-sr-dlg" role="dialog" aria-label="Request this now"><h3>Request this now</h3>' +
      '<div class="sub">' + esc(title) + (st ? ' <span class="claw-sr-pill ' + pillClass(st) + '">' + esc(st) + "</span>" : "") + "</div>";
    if (status.Message) html += '<div class="claw-sr-msg ' + (status.CanRequest ? "" : "err") + '">' + esc(status.Message) + "</div>";
    if (status.MediaType === "tv" && status.Seasons && status.Seasons.length) {
      var suggest = status.SuggestedSeason;
      html += '<div class="claw-sr-mode">' +
        '<label><input type="radio" name="claw-sr-mode" value="all"' + (!suggest ? " checked" : "") + " /> All seasons</label>" +
        '<label><input type="radio" name="claw-sr-mode" value="pick"' + (suggest ? " checked" : "") + " /> Choose seasons</label></div>";
      html += '<div class="claw-sr-seasons">';
      status.Seasons.forEach(function (s) {
        var disabled = !s.CanRequest;
        var checked = !disabled && (suggest ? s.SeasonNumber === suggest : false);
        html += '<label><input type="checkbox" class="claw-sr-season" value="' + s.SeasonNumber + '"' + (disabled ? " disabled" : "") + (checked ? " checked" : "") + " /> " +
          esc(s.Name || ("Season " + s.SeasonNumber)) +
          (s.Status && s.Status !== "None" ? ' <span class="claw-sr-pill ' + pillClass(s.Status) + '">' + esc(s.Status) + "</span>" : "") +
          "</label>";
      });
      html += "</div>";
    }
    html += '<div class="claw-sr-btns"><button type="button" class="claw-sr-btn claw-sr-cancel">Cancel</button>' +
      '<button type="button" class="claw-sr-btn pri claw-sr-send"' + (status.CanRequest ? "" : " disabled") + ">Request</button></div></div>";
    var modal = document.createElement("div");
    modal.className = "claw-sr-modal";
    modal.innerHTML = html;
    document.body.appendChild(modal);
    var dlg = modal.querySelector(".claw-sr-dlg");
    function setMode() {
      var pick = dlg.querySelector('input[name="claw-sr-mode"][value="pick"]');
      var box = dlg.querySelector(".claw-sr-seasons");
      if (box) box.style.opacity = pick && pick.checked ? "1" : ".55";
    }
    Array.prototype.forEach.call(dlg.querySelectorAll('input[name="claw-sr-mode"]'), function (r) { r.addEventListener("change", setMode); });
    setMode();
    dlg.querySelector(".claw-sr-cancel").addEventListener("click", closeModal);
    modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
    dlg.querySelector(".claw-sr-send").addEventListener("click", function () {
      if (!status.CanRequest) return;
      var btn = dlg.querySelector(".claw-sr-send");
      btn.disabled = true;
      var seasons = chosenSeasons(dlg, status);
      post("Request", { Id: status._itemId, Seasons: seasons }).then(function (res) {
        var msg = dlg.querySelector(".claw-sr-msg");
        if (!msg) { msg = document.createElement("div"); msg.className = "claw-sr-msg"; dlg.insertBefore(msg, dlg.querySelector(".claw-sr-btns")); }
        msg.textContent = (res && res.Detail) || (res && res.Ok ? "Requested." : "Request failed.");
        msg.className = "claw-sr-msg " + (res && res.Ok ? "ok" : "err");
        if (res && res.Ok) setTimeout(closeModal, 1200);
        else btn.disabled = false;
      }, function (err) {
        return errorText(err).then(function (t) {
          var msg = dlg.querySelector(".claw-sr-msg");
          if (!msg) { msg = document.createElement("div"); msg.className = "claw-sr-msg err"; dlg.insertBefore(msg, dlg.querySelector(".claw-sr-btns")); }
          msg.textContent = t; msg.className = "claw-sr-msg err"; btn.disabled = false;
        });
      });
    });
    return modal;
  }

  function openRequest(items) {
    var item = items && items[0];
    if (!item) return Promise.reject("noitems");
    return getJSON("ItemStatus", { Id: item.Id }).then(function (st) {
      st = st || {};
      st._itemId = item.Id;
      renderDialog(st);
      return { command: CMD, status: st };
    }, function (err) {
      return errorText(err).then(function (t) {
        renderDialog({ Title: item.Name, CanRequest: false, Message: t, _itemId: item.Id });
        return { command: CMD, error: t };
      });
    });
  }

  var source = {
    getCommands: function (options) {
      options = options || {};
      var items = options.items || (options.item ? [options.item] : []);
      loadInfo(false);
      if (!state.enabled || !state.canRequest || !items.length) return [];
      for (var i = 0; i < items.length; i++) if (!itemEligible(items[i])) return [];
      return [{ name: "Request this now", id: CMD, icon: "add_to_queue" }];
    },
    executeCommand: function (command, items) {
      if (command !== CMD) return Promise.reject("nocommands");
      return openRequest(items);
    }
  };

  function loadInfo(force) {
    if (!api() || (!force && Date.now() - state.infoAt < 30000)) return Promise.resolve(state.enabled);
    state.infoAt = Date.now();
    return getJSON("Info").then(function (r) {
      state.enabled = !(r && r.Enabled === false);
      state.canRequest = !r || r.CanRequest !== false;
      return state.enabled;
    }, function () { return state.enabled; });
  }

  function register() {
    return importModule("./modules/common/itemmanager/itemmanager.js").then(function (im) {
      if (!im || typeof im.registerCommandSource !== "function") throw new Error("itemmanager has no registerCommandSource");
      if (!state.registered) { im.registerCommandSource(source); state.registered = true; }
      loadInfo(true);
      return true;
    });
  }
  function boot(tries) {
    if (window.Emby && typeof window.Emby.importModule === "function") {
      register().then(null, function (e) { if (window.console) console.warn("Seerr Requests: menu not registered", e); });
      return;
    }
    if (tries >= WAIT_MAX) return;
    setTimeout(function () { boot(tries + 1); }, WAIT_MS);
  }

  window.__clawSeerrRequests = {
    version: "__PLUGIN_VERSION__",
    command: CMD,
    source: source,
    state: state,
    itemEligible: itemEligible,
    isTrailer: isTrailer,
    isUnownedMovieOrShow: isUnownedMovieOrShow,
    hasLocalMedia: hasLocalMedia,
    openRequest: openRequest,
    renderDialog: renderDialog,
    chosenSeasons: chosenSeasons,
    loadInfo: loadInfo
  };
  boot(0);
})();
