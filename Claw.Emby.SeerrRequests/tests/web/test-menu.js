const puppeteer = require("/workspace/jstest/node_modules/puppeteer-core");
const fs = require("fs");
const path = require("path");
let P = 0, F = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? P++ : F++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = process.env.NEW || path.resolve(__dirname, "../..");

const inject = fs.readFileSync(path.join(ROOT, "Inject/claw-seerr-requests.js"), "utf8").replace(/__PLUGIN_VERSION__/g, "1.0.1.0");

const statuses = {
  trailerOwned: { Title: "The Sample Club", Year: 1999, MediaType: "movie", Status: "Available", CanRequest: false, Visible: true, Message: "This title is already available in Seerr.", Seasons: [] },
  trailerOpen: { Title: "Blade Sample", Year: 1982, MediaType: "movie", Status: "None", CanRequest: true, Visible: true, Message: "", Seasons: [] },
  pending: { Title: "The Matrix Sample", Year: 1999, MediaType: "movie", Status: "Pending", CanRequest: false, Visible: true, Message: "A request is already pending approval in Seerr.", Seasons: [] },
  unmatched: { Title: "Star Voyage", Year: 1977, MediaType: "movie", Status: "None", CanRequest: false, Visible: true, Message: "Your Emby account is not linked to a Seerr user. Ask an administrator to add a mapping under Seerr Requests → Settings. Requests are never sent as the Seerr admin.", Seasons: [] },
  tv: { Title: "Chemistry Set", Year: 2008, MediaType: "tv", Status: "Partially available", CanRequest: true, Visible: true, SuggestedSeason: 2, Seasons: [
    { SeasonNumber: 1, Name: "Season 1", Status: "Available", CanRequest: false },
    { SeasonNumber: 2, Name: "Season 2", Status: "None", CanRequest: true },
    { SeasonNumber: 3, Name: "Season 3", Status: "Pending", CanRequest: false }
  ]},
  unconfigured: { Title: "Blade Sample", Year: 1982, MediaType: "movie", Status: "None", CanRequest: false, Visible: true, Message: "Seerr isn't set up yet. An administrator needs to set the Seerr URL and API key under Seerr Requests \u2192 Settings.", Seasons: [] }
};

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<title>Seerr Requests menu</title>
<style>
  html,body{background:#111;color:#eee;font-family:"Segoe UI",Arial,sans-serif;margin:0}
  body{padding:24px}
  .menu{background:#262626;border-radius:.4em;width:16em;padding:.3em 0;box-shadow:0 .4em 1.4em rgba(0,0,0,.5)}
  .menu button{display:flex;gap:.6em;width:100%;background:none;border:0;color:inherit;font:inherit;padding:.5em 1em;text-align:left;cursor:pointer}
  .menu button:hover,.menu button.on{background:rgba(255,255,255,.08)}
  .md-icon{font-style:normal}
</style>
</head><body>
<h2 style="margin-top:0">Item menu</h2>
<div class="menu" id="preview-menu"></div>
<script>
window.__posted = [];
window.ApiClient = {
  getUrl: function(p,q){ var u="/emby/"+p; if(q){ u+="?"+Object.keys(q).map(function(k){return k+"="+encodeURIComponent(q[k]);}).join("&"); } return u; },
  getJSON: function(u){
    if (u.indexOf("Info")>=0) return Promise.resolve({ Enabled:true, CanRequest:true, Version:"1.0.1.0", MenuName:"Request this now" });
    var title = (u.match(/Id=([^&]+)/)||[])[1] || "";
    title = decodeURIComponent(title);
    var map = window.__statusMap || {};
    return Promise.resolve(map[title] || { Title:"Unknown", CanRequest:false, Message:"missing fixture", Seasons:[] });
  },
  ajax: function(opts){ window.__posted.push(opts); return Promise.resolve({ Ok:true, Result:"Requested", Detail:"Sent as Riley Rivera (auto)." }); }
};
window.__statusMap = ${JSON.stringify(statuses)};
</script>
<script>${inject}</script>
</body></html>`;

const file = path.join(__dirname, "seerr-menu.html");
fs.writeFileSync(file, html);

(async () => {
  const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files"] });
  const p = await b.newPage();
  p.errs = [];
  p.on("pageerror", e => p.errs.push(e.message));
  p.setDefaultTimeout(8000);
  await p.setViewport({ width: 900, height: 700 });
  await p.goto("file://" + file);
  await sleep(300);

  const cmds = (item) => p.evaluate((it) => {
    const src = window.__clawSeerrRequests.source;
    return src.getCommands({ items: [it] });
  }, item);

  const trailer = { Id: "t1", Name: "Blade Sample", Type: "Trailer", Path: "M:/TRAILERS/blade.mkv", LocationType: "FileSystem" };
  const owned = { Id: "m1", Name: "The Sample Club", Type: "Movie", Path: "M:/MOVIES/The Sample Club (1999)/movie.mkv", LocationType: "FileSystem", MediaSourceCount: 1 };
  const unowned = { Id: "m2", Name: "Blade Sample", Type: "Movie", LocationType: "Virtual" };
  const person = { Id: "p1", Name: "Someone", Type: "Person" };
  const series = { Id: "s1", Name: "Chemistry Set", Type: "Series", LocationType: "Virtual" };

  ok(await p.evaluate(() => !!(window.__clawSeerrRequests && window.__clawSeerrRequests.version === "1.0.1.0")), "inject loaded with plugin version");
  const c1 = await cmds(trailer);
  ok(c1.length === 1 && c1[0].name === "Request this now" && c1[0].id === "claw-seerr-request", "trailer shows Request this now");
  const c2 = await cmds(owned);
  ok(c2.length === 0, "owned movie with a file does not show the command");
  const c3 = await cmds(unowned);
  ok(c3.length === 1, "unowned virtual movie shows the command");
  const c4 = await cmds(person);
  ok(c4.length === 0, "person items are skipped");
  const c5 = await cmds(series);
  ok(c5.length === 1, "unowned series shows the command");

  await p.evaluate(() => {
    window.__clawSeerrRequests.state.enabled = false;
  });
  ok((await cmds(trailer)).length === 0, "command is hidden when the plugin is off");
  await p.evaluate(() => { window.__clawSeerrRequests.state.enabled = true; });

  // Render a fake overflow menu for the screenshot
  await p.evaluate(() => {
    const menu = document.getElementById("preview-menu");
    menu.innerHTML = '<button type="button">Play</button><button type="button" class="on">Request this now</button><button type="button">Edit</button>';
  });

  const shotDir = process.env.SHOT_DIR || path.resolve(__dirname, "../../../docs/screenshots/seerr-requests");
  fs.mkdirSync(shotDir, { recursive: true });
  const take = async (name) => {
    const dest = path.join(shotDir, name);
    await Promise.race([
      p.screenshot({ path: dest, captureBeyondViewport: false }),
      new Promise((_, r) => setTimeout(() => r(new Error("screenshot timeout " + name)), 10000))
    ]);
    console.log("shot " + name);
  };
  await take("item-menu.png");

  await p.evaluate(() => window.__clawSeerrRequests.renderDialog(Object.assign({ _itemId: "t-avail" }, window.__statusMap.trailerOwned)));
  await sleep(150);
  ok(await p.$eval(".claw-sr-dlg h3", e => e.textContent) === "Request this now", "dialog title is Request this now");
  ok(await p.$eval(".claw-sr-pill", e => e.textContent) === "Available", "available status is shown");
  ok(await p.$eval(".claw-sr-send", e => e.disabled) === true, "Request is disabled when the title is available");
  await take("status-available.png");
  await p.evaluate(() => document.querySelector(".claw-sr-modal").remove());

  await p.evaluate(() => window.__clawSeerrRequests.renderDialog(Object.assign({ _itemId: "t-pend" }, window.__statusMap.pending)));
  await sleep(100);
  ok(await p.$eval(".claw-sr-pill", e => e.textContent) === "Pending", "pending status is shown");
  ok((await p.$eval(".claw-sr-msg", e => e.textContent.toLowerCase())).indexOf("pending approval") >= 0, "pending message mentions approval");
  await take("status-pending.png");
  await p.evaluate(() => document.querySelector(".claw-sr-modal").remove());

  await p.evaluate(() => window.__clawSeerrRequests.renderDialog(Object.assign({ _itemId: "t-un" }, window.__statusMap.unmatched)));
  await sleep(100);
  const um = await p.$eval(".claw-sr-msg", e => e.textContent);
  ok(um.indexOf("not linked") >= 0 && um.toLowerCase().indexOf("never sent as the seerr admin") >= 0, "unmatched dialog is clear and refuses admin fallback");
  ok(await p.$eval(".claw-sr-send", e => e.disabled) === true, "Request is disabled for an unmatched user");
  await take("unmatched.png");
  await p.evaluate(() => document.querySelector(".claw-sr-modal").remove());

  await p.evaluate(() => window.__clawSeerrRequests.renderDialog(Object.assign({ _itemId: "s1" }, window.__statusMap.tv)));
  await sleep(150);
  ok(await p.$eval(".claw-sr-pill", e => e.textContent) === "Partially available", "TV dialog shows partially available");
  const seasons = await p.$$eval(".claw-sr-season", a => a.map(x => ({ n: x.value, disabled: x.disabled, checked: x.checked })));
  ok(seasons.length === 3 && seasons[0].disabled && !seasons[1].disabled && seasons[1].checked && seasons[2].disabled, "season 2 is the only enabled, pre-selected season");
  await p.$eval('input[name="claw-sr-mode"][value="all"]', e => e.click());
  const all = await p.evaluate(() => window.__clawSeerrRequests.chosenSeasons(document.querySelector(".claw-sr-dlg"), window.__statusMap.tv));
  ok(all === "all", "All seasons mode returns the all token");
  await p.$eval('input[name="claw-sr-mode"][value="pick"]', e => e.click());
  const picked = await p.evaluate(() => window.__clawSeerrRequests.chosenSeasons(document.querySelector(".claw-sr-dlg"), window.__statusMap.tv));
  ok(picked === "2", "picker returns season 2");
  await take("season-picker.png");

  await p.$eval(".claw-sr-send", e => e.click());
  await sleep(200);
  const posted = await p.evaluate(() => window.__posted);
  ok(posted.length === 1 && (posted[0].url || "").indexOf("Request") >= 0, "Request posts to the plugin endpoint");
  ok((posted[0].url || "").indexOf("Seasons=2") >= 0 || JSON.stringify(posted[0]).indexOf("2") >= 0, "posted seasons include 2");

  await p.evaluate(() => { var m = document.querySelector(".claw-sr-modal"); if (m) m.remove(); });
  await p.evaluate(() => window.__clawSeerrRequests.renderDialog(Object.assign({ _itemId: "t-setup" }, window.__statusMap.unconfigured)));
  await sleep(150);
  const setup = await p.$eval(".claw-sr-msg", e => e.textContent);
  ok(setup.indexOf("isn't set up yet") >= 0, "unconfigured dialog says Seerr isn't set up yet");
  ok(await p.$eval(".claw-sr-send", e => e.disabled) === true, "Request is disabled when Seerr isn't set up");
  const z = await p.$eval(".claw-sr-modal", e => parseInt(getComputedStyle(e).zIndex, 10));
  ok(z >= 100000, "dialog z-index sits above Emby action sheets");

  await p.evaluate(() => { var m = document.querySelector(".claw-sr-modal"); if (m) m.remove(); });
  await p.evaluate(() => window.__clawSeerrRequests.source.executeCommand({ id: "claw-seerr-request" }, [{ Id: "unconfigured", Name: "Blade Sample", Type: "Movie", LocationType: "Virtual" }]));
  await sleep(200);
  ok(!!(await p.$(".claw-sr-dlg")), "executeCommand with a command object opens the dialog");
  const viaCmd = await p.$eval(".claw-sr-msg", e => e.textContent);
  ok(viaCmd.indexOf("isn't set up yet") >= 0, "command-object path shows the setup message");

  ok(!p.errs.length, "no page errors " + p.errs.join("|"));

  const p2 = await b.newPage();
  p2.errs = [];
  p2.on("pageerror", e => p2.errs.push(e.message));
  p2.setDefaultTimeout(8000);
  await p2.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1");
  await p2.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p2.goto("file://" + file);
  await sleep(300);
  await p2.evaluate(() => window.__clawSeerrRequests.renderDialog(Object.assign({ _itemId: "t-setup" }, window.__statusMap.unconfigured)));
  await sleep(150);
  const mob = await p2.evaluate(() => {
    var dlg = document.querySelector(".claw-sr-dlg");
    var modal = document.querySelector(".claw-sr-modal");
    var r = dlg.getBoundingClientRect();
    var cs = getComputedStyle(modal);
    return { text: document.querySelector(".claw-sr-msg").textContent, w: r.width, h: r.height, z: parseInt(cs.zIndex, 10) };
  });
  ok(mob.text.indexOf("isn't set up yet") >= 0, "iPhone viewport: unconfigured message is shown");
  ok(mob.w > 100 && mob.h > 80, "iPhone viewport: dialog has a visible size");
  ok(mob.z >= 100000, "iPhone viewport: dialog z-index is high");
  ok(!p2.errs.length, "no page errors on iPhone viewport " + p2.errs.join("|"));
  await p2.close();

  await b.close();
  console.log(P + " passed, " + F + " failed");
  process.exit(F ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
