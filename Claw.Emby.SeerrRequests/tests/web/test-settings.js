const puppeteer = require("/workspace/jstest/node_modules/puppeteer-core");
const build = require("./settings-harness.js");
const path = require("path");
const fs = require("fs");
let P = 0, F = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? P++ : F++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = process.env.NEW || path.resolve(__dirname, "../..");

(async () => {
  const file = build(ROOT, "new");
  const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files"] });
  const p = await b.newPage();
  p.errs = [];
  p.on("pageerror", e => p.errs.push(e.message));
  p.setDefaultTimeout(8000);
  await p.setViewport({ width: 1280, height: 900 });
  await p.goto("file://" + file);
  await sleep(400);

  const tabs = await p.$$eval(".sr-tab", a => a.map(x => x.textContent.trim()));
  ok(JSON.stringify(tabs) === JSON.stringify(["Settings", "Activity", "General"]), "three tabs: Settings, Activity, General");
  ok(await p.$eval(".sr-panel.sr-on", e => e.getAttribute("data-panel")) === "settings", "default tab is Settings");
  ok(await p.$eval("#srUrl", e => e.value) === "http://192.168.1.237:5055", "default Seerr URL is filled in");
  const keyVal = await p.$eval("#srKey", e => e.value);
  ok(keyVal.indexOf("•") >= 0 && !/^[A-Za-z0-9_-]{8,}$/.test(keyVal), "API key field shows a mask, not a raw key");
  ok(!(await p.content()).includes("test-seerr-key-"), "page HTML does not contain a raw test key");

  const names = await p.$$eval("#srMapBody tr[data-emby] td:first-child", a => a.map(x => x.textContent.replace(/\s+/g, " ").trim()));
  ok(names.join("|").indexOf("Riley Rivera") >= 0 && names.join("|").indexOf("Sam Patel") >= 0 && names.join("|").indexOf("Admin Fay") >= 0, "mapping table lists fake Emby users");
  const hows = await p.$$eval("#srMapBody .sr-how", a => a.map(x => x.textContent));
  ok(hows.some(h => /Auto/.test(h)) && hows.some(h => /Manual/.test(h)), "auto and manual match labels are shown");

  await p.$eval("#srTest", e => e.click());
  await sleep(200);
  ok(await p.$eval("#srTestMsg", e => e.classList.contains("ok") && e.textContent.indexOf("2.5.0-fake") >= 0), "Test connection shows the fake Seerr version");

  await p.$eval('.sr-tab[data-tab=activity]', e => e.click());
  ok(await p.$eval(".sr-panel.sr-on", e => e.getAttribute("data-panel")) === "activity", "Activity tab shows the activity panel");
  const acts = await p.$$eval("#srActBody tr", a => a.map(r => r.textContent.replace(/\s+/g, " ").trim()));
  ok(acts.some(t => t.indexOf("Blade Sample") >= 0 && t.indexOf("Requested") >= 0), "activity lists a successful movie request");
  ok(acts.some(t => t.indexOf("Chemistry Set") >= 0 && t.indexOf("2") >= 0), "activity lists a TV season request");
  ok(acts.some(t => t.indexOf("Unmatched") >= 0 && t.toLowerCase().indexOf("never sent as the seerr admin") >= 0), "activity records an unmatched user, no admin fallback");
  ok(await p.$eval("table.sr-act-t", e => e.classList.contains("cr-t") && !!e.querySelector(".cr-h")), "activity table has resizable column handles");
  ok(await p.$eval("table.sr-map-t", e => e.classList.contains("cr-t")), "user-mapping table is hooked up for column resize");

  await p.$eval('.sr-tab[data-tab=general]', e => e.click());
  ok(await p.$eval(".sr-panel.sr-on", e => e.getAttribute("data-panel")) === "general", "General tab shows the general panel");
  ok(await p.$eval("#srEnabled", e => e.checked) === true, "Enable plugin is on");
  ok(await p.$eval(".sr-version", e => e.textContent) === "1.0.0.0", "About shows version 1.0.0.0");
  ok((await p.$eval(".sr-script", e => e.textContent)).indexOf("claw-seerr-requests.js") >= 0, "About mentions the inject script");
  ok((await p.$eval('.sr-about a', e => e.getAttribute("href")||"")).indexOf("github.com/mouseware/emby-plugins") >= 0, "About links to the GitHub repo");

  await p.$eval("#srEnabled", e => { e.checked = false; e.dispatchEvent(new Event("change", { bubbles: true })); });
  await p.$eval(".sr-general-form button[type=submit]", e => e.click());
  await sleep(150);
  const saved = await p.evaluate(() => window.__saved);
  ok(saved && saved.Enabled === false, "General Save stores Enabled=false");
  ok(await p.$eval("#srOffBanner", e => e.classList.contains("sr-on")), "off banner appears when the plugin is switched off");

  await p.$eval('.sr-tab[data-tab=settings]', e => e.click());
  await p.$eval("#srVis", e => { e.value = "allowlist"; e.dispatchEvent(new Event("change", { bubbles: true })); });
  ok(await p.$eval("#srAllowWrap", e => e.hidden) === false, "allowlist reveals the user checkboxes");
  await p.$eval("#srAllLibs", e => { e.checked = false; e.dispatchEvent(new Event("change", { bubbles: true })); });
  const libNames = await p.$$eval("#srLibs label", a => a.map(x => x.textContent));
  ok(libNames.join(" ").indexOf("Movies") >= 0 && libNames.join(" ").indexOf("Trailers") >= 0, "library list includes Movies and Trailers");

  ok(!p.errs.length, "no page errors " + p.errs.join("|"));

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

  // Restore a clean on-state for screenshots
  await p.evaluate(() => {
    const v = document.getElementById("clawSeerrRequestsPage")._seerrRequests;
    v.state.cfg.Enabled = true;
    document.getElementById("srEnabled").checked = true;
    v.applyCfg(v.state.cfg);
    v.showTab("settings");
    document.getElementById("srVis").value = "all";
    document.getElementById("srVis").dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("srAllLibs").checked = true;
    document.getElementById("srAllLibs").dispatchEvent(new Event("change", { bubbles: true }));
  });
  await p.evaluate(() => window.scrollTo(0, 0));
  await sleep(150);
  await p.$eval("#srTest", e => e.click());
  await sleep(200);
  await p.evaluate(() => window.scrollTo(0, 0));
  await take("settings.png");

  await p.evaluate(() => document.querySelector(".sr-map-t").scrollIntoView({ block: "start", behavior: "instant" }));
  await sleep(100);
  await take("users.png");

  await p.$eval("#srVis", e => { e.value = "allowlist"; e.dispatchEvent(new Event("change", { bubbles: true })); });
  await p.$eval("#srAllLibs", e => { e.checked = false; e.dispatchEvent(new Event("change", { bubbles: true })); });
  await p.evaluate(() => document.getElementById("srVis").scrollIntoView({ block: "start", behavior: "instant" }));
  await sleep(100);
  await take("visibility.png");

  await p.$eval('.sr-tab[data-tab=activity]', e => e.click());
  await p.evaluate(() => window.scrollTo(0, 0));
  await sleep(150);
  await take("activity.png");

  await p.$eval('.sr-tab[data-tab=general]', e => e.click());
  await p.evaluate(() => window.scrollTo(0, 0));
  await sleep(150);
  await take("general.png");

  await b.close();
  console.log(P + " passed, " + F + " failed");
  process.exit(F ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
