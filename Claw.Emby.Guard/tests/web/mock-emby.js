// Offline stand-in for Emby's web client + the Guard API (realistic shapes).
(function () {
  var now = Date.now(), m = 60000;
  function iso(min) { return new Date(now - min * m).toISOString(); }
  var id = 0;
  function ev(o) { o.Id = ++id; return o; }
  window.__srv = {
    cfg: { Enabled: true, SigninFailThreshold: 5, SigninWindowMinutes: 10, UnknownUserFailThreshold: 2, BanUnknownUsersInstantly: false, WatchApiFailures: true, ApiFailThreshold: 30, ApiWindowMinutes: 10,
      EscalationMinutes: [60, 1440, 43200, 0], EscalationResetDays: 30, InstantBanUsernames: ["root", "admin", "administrator", "emby", "test", "guest", "user", "sa"],
      Ipv6Prefix: 64, Whitelist: [], NotifyOnBan: true, MaxMindAccountId: "", MaxMindLicenseKey: "" },
    country: false, yourIp: "198.51.100.68", filterState: "enforcing", calls: [], saved: [],
    events: [
      ev({ Time: iso(240), Kind: "signin-ok", Ip: "192.168.1.40", Key: "192.168.1.40", Username: "alice", UserExists: true, Client: "Emby Web 4.10.1", Device: "Edge Windows", Note: "lan", Country: null }),
      ev({ Time: iso(200), Kind: "api-401", Ip: "203.0.113.92", Key: "203.0.113.92", Request: "GET /emby/System/Info", Count: 1, Country: "NL", Status: 401 }),
      ev({ Time: iso(64), Kind: "signin-failed", Ip: "203.0.113.34", Key: "203.0.113.34", Username: "root", UserExists: false, Client: "python-requests", Count: 1, Note: "banned", Rule: "instant-username", Country: "DE" }),
      ev({ Time: iso(64), Kind: "banned", Ip: "203.0.113.34", Key: "203.0.113.34", Username: "root", Note: "1 h", Rule: "instant-username", Country: "DE" }),
      ev({ Time: iso(30), Kind: "signin-ok", Ip: "198.51.100.68", Key: "198.51.100.68", Username: "carol", UserExists: true, Client: "Emby for Android", Device: "Smart TV Pro", Country: "US" }),
      ev({ Time: iso(12), Kind: "signin-failed", Ip: "203.0.113.92", Key: "203.0.113.92", Username: "bob", UserExists: true, Client: "Emby Web 4.10.1", Device: "Chrome Windows", Count: 3, Country: "NL" }),
      ev({ Time: iso(9), Kind: "signin-forbidden", Ip: "198.51.100.5", Key: "198.51.100.5", Username: null, Client: "POST /emby/Users/AuthenticateByName", Count: 2, Country: "VN" }),
      ev({ Time: iso(6), Kind: "signin-failed", Ip: "2001:db8:4:2::99", Key: "2001:db8:4:2::/64", Username: "ghostuser", UserExists: false, Client: "Infuse", Count: 1, Country: "LT" }),
      ev({ Time: iso(3), Kind: "api-403", Ip: "198.51.100.23", Key: "198.51.100.23", Request: "GET /emby/Plugins", Count: 7, Country: "US", Status: 403 })
    ],
    bans: [
      { Key: "203.0.113.34", Ip: "203.0.113.34", Created: iso(64), Expires: new Date(now - 64 * m + 120 * m).toISOString(), Reason: "Instant-ban username", Rule: "instant-username", Step: 0, Usernames: ["root"], Country: "DE", Hits: 4 },
      { Key: "198.51.100.0/24", Ip: "198.51.100.5", Created: iso(3000), Expires: null, Reason: "Manual", Rule: "manual", Manual: true, Usernames: [], Country: "VN", Hits: 31 },
      { Key: "203.0.113.233", Ip: "203.0.113.233", Created: iso(1500), Expires: new Date(now + 2 * 864e5).toISOString(), Reason: "Too many failed sign-ins", Rule: "signin-failures", Step: 2, Usernames: ["bob", "testuser"], Country: "RU", Hits: 0 }
    ],
    history: [{ Key: "203.0.113.233", Reason: "Too many failed sign-ins", Created: iso(5000), Ended: iso(3500), EndReason: "expired" }],
    push: function (o) { this.events.unshift(ev(o)); }
  };
  var S = window.__srv;
  function lan(ip) { return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$)/.test(ip); }
  function active() { return S.bans.filter(function (b) { return !b.Ended && (!b.Expires || new Date(b.Expires) > new Date()); }); }
  function parse(u) { var p = u.split("?"), q = {}; (p[1] || "").split("&").forEach(function (kv) { if (!kv) return; var a = kv.split("="); q[decodeURIComponent(a[0])] = decodeURIComponent(a[1] || ""); }); return { path: p[0], q: q }; }
  function api(method, u) {
    var r = parse(u); S.calls.push(method + " " + r.path); var q = r.q;
    switch (method + " " + r.path) {
      case "GET ClawGuard/Status": return { Enabled: S.cfg.Enabled, FilterState: S.cfg.Enabled ? S.filterState : "off", ManualFilterEntries: 1, ActiveBans: active().length,
        Failed24h: S.events.filter(function (e) { return /signin-(failed|forbidden)/.test(e.Kind); }).length, ApiFailures24h: S.events.filter(function (e) { return /^api/.test(e.Kind); }).length,
        DistinctIps24h: 6, Bans24h: 1, YourIp: S.yourIp, YourIpIsLan: false, RetentionText: "Forever (Emby keeps the activity log forever; no retention setting in this version)", RetentionDays: 0,
        LogFileRetentionDays: 3, CountryEnabled: S.country, GeoStatus: S.country ? "GeoLite2-Country loaded (build 2026-10-09). This product includes GeoLite Data created by MaxMind, available from https://www.maxmind.com" : "No MaxMind key: Country column hidden",
        TailStatus: "following <Emby logs>\\embyserver.txt", LanNote: "", Now: new Date().toISOString(), LastEventId: id };
      case "GET ClawGuard/Events":
        if (q.SinceId != null) return S.events.filter(function (e) { return e.Id > +q.SinceId; });
        return S.events.slice();
      case "GET ClawGuard/Bans": return { Active: active(), History: S.history, Now: new Date().toISOString() };
      case "POST ClawGuard/Bans": {
        var ip = q.Ip;
        if (lan(ip)) return { Ok: false, Error: ip + " is a LAN/private/loopback address. Emby never filters those, so Guard never bans them." };
        if (ip === S.yourIp && q.Confirm !== "true") return { Ok: false, NeedsConfirm: true, Error: "This is the address you are using right now (" + ip + "). Banning it will lock this browser out of Emby." };
        var mins = +q.Minutes;
        var b = { Key: ip, Ip: ip, Created: new Date().toISOString(), Expires: mins ? new Date(Date.now() + mins * m).toISOString() : null, Reason: q.Reason || "Manual", Rule: "manual", Manual: true, Usernames: [], Hits: 0 };
        S.bans.unshift(b); S.push({ Time: new Date().toISOString(), Kind: "banned", Ip: ip, Key: ip, Note: mins ? (mins >= 1440 ? mins / 1440 + " d" : mins / 60 + " h") : "permanent", Rule: "manual" });
        return { Ok: true, Ban: b };
      }
      case "POST ClawGuard/Bans/Unban": { var a = active().filter(function (b) { return b.Key === q.Key; })[0]; if (a) { a.Ended = new Date().toISOString(); a.EndReason = "unbanned"; S.history.unshift(a); } return { Ok: !!a }; }
      case "POST ClawGuard/Bans/Extend": { var x = active().filter(function (b) { return b.Key === q.Key; })[0]; if (x) { x.Expires = +q.Minutes === 0 ? null : new Date(new Date(x.Expires).getTime() + q.Minutes * m).toISOString(); } return { Ok: !!x }; }
      case "POST ClawGuard/Whitelist": S.cfg.Whitelist = S.cfg.Whitelist.concat([{ Cidr: q.Cidr, Note: q.Note }]); return { Ok: true };
      case "POST ClawGuard/InstantUsernames": S.cfg.InstantBanUsernames = S.cfg.InstantBanUsernames.concat([q.Username]); return { Ok: true };
      case "POST ClawGuard/Geo/Refresh": return { Ok: true };
      case "POST ClawGuard/Import": {
        S.importRuns = (S.importRuns || 0) + 1;
        if (S.importRuns > 1) return { Files: 9, LinesScanned: 418233, Found: 543, Imported: 0, AlreadyImported: 537, AlreadyLogged: 6, SigninFailures: 0, Forbidden: 0, ApiFailures: 0, LanOrWhitelisted: 0, NewBans: 0, StillActiveBans: 0, From: iso(4 * 1440), To: iso(1) };
        var t0 = now - 18 * 60 * m;
        [0, 1500, 3000].forEach(function (d) { S.push({ Time: new Date(t0 + d).toISOString(), Kind: "signin-failed", Ip: "203.0.113.110", Key: "203.0.113.110", Username: "admin", UserExists: false, Client: "imported from log", Count: 1, Note: d ? "banned, imported" : "banned, imported", Rule: d ? null : "instant-username" }); });
        S.push({ Time: new Date(t0 + 4000).toISOString(), Kind: "api-401", Ip: "::1", Key: "::1", Request: "GET /emby/System/ActivityLogEntries", Note: "lan, imported" });
        return { Files: 9, LinesScanned: 418233, Found: 543, Imported: 537, AlreadyImported: 0, AlreadyLogged: 6, SigninFailures: 61, Forbidden: 3, ApiFailures: 473, LanOrWhitelisted: 402, NewBans: 4, StillActiveBans: 1, From: iso(4 * 1440), To: iso(1) };
      }
    }
    throw new Error("unmocked " + method + " " + u);
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  window.ApiClient = {
    getUrl: function (p, q) { var s = Object.keys(q || {}).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(q[k]); }).join("&"); return p + (s ? "?" + s : ""); },
    getJSON: function (u) { try { return Promise.resolve(clone(api("GET", u))); } catch (e) { return Promise.reject(e); } },
    ajax: function (o) { try { return Promise.resolve(clone(api(o.type, o.url))); } catch (e) { return Promise.reject(e); } },
    getPluginConfiguration: function () { return Promise.resolve(clone(S.cfg)); }, getInstalledPlugins: function () { return Promise.resolve([{ Id: "07d4dd00-021a-4dc5-9964-837979319eca", Name: "Claw Guard", Version: "1.2.0.0" }]); },
    updatePluginConfiguration: function (pid, c) { S.cfg = clone(c); S.saved.push(clone(c)); return Promise.resolve({}); }
  };
  window.Dashboard = { showLoadingMsg: function () {}, hideLoadingMsg: function () {}, processPluginConfigurationUpdateResult: function () { window.__savedToast = true; } };
  window.require = function (deps, cb) { if (deps[0] === "toast") cb(function (msg) { window.__toasts = (window.__toasts || []).concat([msg]); }); };
  var factory;
  window.define = function (deps, f) { factory = f; };
  window.__boot = function () {
    var View = factory();
    var page = document.getElementById("clawGuardPage");
    window.__View = View;
    new View(page, {});
    page.dispatchEvent(new CustomEvent("viewshow"));
  };
})();
