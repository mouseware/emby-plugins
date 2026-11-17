const fs = require("fs");
const path = require("path");

const FAKE = {
  settings: {
    Enabled: true,
    SeerrUrl: "http://192.168.1.237:5055",
    ApiKey: "••••••••f6a4",
    ApiKeySet: true,
    VisibilityMode: "all",
    AllowedUserIds: [],
    AllowedUserNames: [],
    AllowedLibraryIds: [],
    UserMaps: [],
    Version: "1.0.1.0",
    Script: "claw-seerr-requests.js"
  },
  people: {
    EmbyUsers: [
      { Id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", Name: "Admin Fay", IsAdmin: true, SeerrUserId: "1", SeerrUserName: "Admin Fay", How: "auto" },
      { Id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", Name: "Riley Rivera", IsAdmin: false, SeerrUserId: "7", SeerrUserName: "Riley Rivera", How: "auto" },
      { Id: "cccccccc-cccc-cccc-cccc-cccccccccccc", Name: "Sam Patel", IsAdmin: false, SeerrUserId: "8", SeerrUserName: "Sam Patel", How: "manual" }
    ],
    SeerrUsers: [
      { Id: "1", DisplayName: "Admin Fay", Email: "admin@example.test" },
      { Id: "7", DisplayName: "Riley Rivera", Email: "riley@example.test" },
      { Id: "8", DisplayName: "Sam Patel", Email: "sam@example.test" }
    ]
  },
  libraries: { Items: [
    { Id: "lib-movies", Name: "Movies", Type: "movies" },
    { Id: "lib-tv", Name: "TV Shows", Type: "tvshows" },
    { Id: "chan-trailers", Name: "Trailers", Type: "Channel" }
  ]},
  activity: { Items: [
    { WhenUtc: "2026-11-16T20:12:00Z", EmbyUserName: "Riley Rivera", SeerrUserName: "Riley Rivera", Title: "Blade Sample", Year: 1982, MediaType: "movie", Seasons: "", Result: "Requested", Detail: "Sent as Riley Rivera (auto)." },
    { WhenUtc: "2026-11-16T19:40:00Z", EmbyUserName: "Sam Patel", SeerrUserName: "Sam Patel", Title: "Chemistry Set", Year: 2008, MediaType: "tv", Seasons: "2", Result: "Requested", Detail: "Sent as Sam Patel (manual)." },
    { WhenUtc: "2026-11-16T18:05:00Z", EmbyUserName: "Alex Kim", SeerrUserName: "", Title: "Star Voyage", Year: 1977, MediaType: "movie", Seasons: "", Result: "Unmatched", Detail: "Your Emby account is not linked to a Seerr user. Ask an administrator to add a mapping under Seerr Requests → Settings. Requests are never sent as the Seerr admin." },
    { WhenUtc: "2026-11-15T23:11:00Z", EmbyUserName: "Riley Rivera", SeerrUserName: "Riley Rivera", Title: "The Sample Club", Year: 1999, MediaType: "movie", Seasons: "", Result: "Blocked", Detail: "This title is already available in Seerr." }
  ]}
};

function build(root, tag) {
  const html = fs.readFileSync(path.join(root, "Web/config.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "Web/config.js"), "utf8");
  const fake = JSON.stringify(FAKE);
  const page = `<!doctype html>
<html><head><meta charset="utf-8">
<title>Seerr Requests settings</title>
<style>
  html,body{background:#1b1b1b;color:#eaeaea;font-family:"Segoe UI",Arial,sans-serif;margin:0}
  body{padding:18px 28px 40px}
  a{color:#52b54b}
  .raised{background:#52b54b;color:#fff;border:0;border-radius:.3em;padding:.45em 1em;font:inherit}
  .button-submit{margin-right:.6em}
  .fieldDescription,.secondaryText,.checkboxFieldDescription{opacity:.7;font-size:.92em}
  .sectionTitle{margin:.2em 0 .4em}.sectionTitle .md-icon{display:none}
</style>
</head><body>
${html}
<script>
window.__fake = ${fake};
window.__saved = null;
window.__posts = [];
function route(p){
  p = String(p||"");
  if(p.indexOf("Settings")>=0) return window.__fake.settings;
  if(p.indexOf("People")>=0) return window.__fake.people;
  if(p.indexOf("Libraries")>=0) return window.__fake.libraries;
  if(p.indexOf("Activity")>=0) return window.__fake.activity;
  if(p.indexOf("TestConnection")>=0) return { Ok:true, KeyOk:true, Version:"2.5.0-fake", Message:"Reached Seerr 2.5.0-fake. API key is valid (Admin Fay)." };
  return {};
}
window.ApiClient = {
  getUrl: function(p){ return "/emby/"+p; },
  getJSON: function(u){ return Promise.resolve(JSON.parse(JSON.stringify(route(u)))); },
  ajax: function(opts){
    window.__posts.push(opts);
    var body = {};
    try { body = typeof opts.data === "string" ? JSON.parse(opts.data) : (opts.data||{}); } catch(e) { body = opts.data||{}; }
    if ((opts.url||"").indexOf("TestConnection")>=0) return Promise.resolve(route("TestConnection"));
    if ((opts.url||"").indexOf("Settings")>=0) {
      var s = window.__fake.settings;
      Object.keys(body||{}).forEach(function(k){ if(body[k]!==undefined) s[k]=body[k]; });
      if (body && body.ApiKey && (String(body.ApiKey).indexOf("•")>=0 || !body.ApiKey)) s.ApiKey = "••••••••f6a4";
      window.__saved = JSON.parse(JSON.stringify(s));
      return Promise.resolve(JSON.parse(JSON.stringify(s)));
    }
    return Promise.resolve(route(opts.url));
  }
};
window.define = function(deps, factory){ window.__ViewCtor = factory(); };
</script>
<script>${js}</script>
<script>
(function(){
  var view = document.getElementById("clawSeerrRequestsPage");
  window.__page = new window.__ViewCtor(view);
  // viewshow is not fired in the file harness; load the fake data now.
  return view._seerrRequests.loadAll();
})();
</script>
</body></html>`;
  const out = path.join(__dirname, "seerr-page-" + (tag || "new") + ".html");
  fs.writeFileSync(out, page);
  return out;
}

module.exports = build;
module.exports.FAKE = FAKE;
