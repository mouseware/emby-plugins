/* Column resize on the Changed and Found tables (real Web/config.html + config.js + mock-emby.js).
 * Run: node test-colresize.js   (needs puppeteer-core + Chrome; served from file:// so localStorage works) */
const path = require('path'), fs = require('fs');
const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core');
const root = path.resolve(__dirname, '..', '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passes = 0, fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? passes++ : fails++; };
const shell = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#101010;color:#ddd;font-family:"Segoe UI",Roboto,Arial,sans-serif;font-size:15px}
.skin-header{height:3.3em;display:flex;align-items:center;padding:0 1.2em;background:#1a1a1a;border-bottom:1px solid #000}.main{margin-left:0}
</style><script src="mock-emby.js"></script></head><body><div class="skin-header"><b>Emby Server</b>&nbsp;<span style="opacity:.5">Dashboard &rsaquo; Plugins &rsaquo; Default Chapters</span></div>
<div class="main" id="host">${fs.readFileSync(path.join(root, 'Web', 'config.html'), 'utf8')}</div>
<script>window.__installEmby(); var s = window.__server; s.addOverride('101', { after: 35, interval: 5, changed: '2026-10-05T19:00:00Z' }); s.addOverride('102', { after: 12, interval: 10, changed: '2026-10-04T13:30:00Z' }); s.addOverride('103', { after: 23, interval: 5, changed: '2026-10-05T21:15:00Z' });
var add = function (id, name, runtime, chapters, extra) { s.items[id] = Object.assign({ Id: id, Name: name, Type: 'Movie', ProductionYear: 1940 + (+id % 80), runtime: runtime, chapters: chapters, interval: 0 }, extra || {}); };
add('601', 'Casablanca', 102, 1); add('602', 'Dune', 155, 0); add('603', 'Brazil', 142, 3); add('604', 'Metropolis', 153, 2); add('605', 'Seven Samurai', 207, 1);
window.define = function (d, f) { window.__View = f(); };</script>
<script src="../../Web/config.js"></script><script>var v = document.getElementById('defaultChaptersPage'); new __View(v); v.dispatchEvent(new CustomEvent('viewshow'));</script></body></html>`;
const file = path.join(__dirname, 'colresize-page.html'); fs.writeFileSync(file, shell);
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setViewport({ width: 1280, height: 640 });
  await p.goto('file://' + file); await p.waitForFunction(() => document.querySelectorAll('.dc-rows tr[data-id]').length === 3, { timeout: 5000 });
  const C = require(process.env.CHECKS || './checks.js')(p, ok);
  const order = () => p.$$eval('.dc-rows tr[data-id]', t => t.map(r => r.getAttribute('data-id')).join());
  const o0 = await order();
  await C.run('Changed table', '.dc-panel-changed table.dc-table', 'name', 'claw.defaultchapters.cols.changed', async () => { await p.click('th[data-sort="after"]'); });
  ok(await order() !== o0, 'clicking a header (not its edge) still sorts');
  ok(await p.$eval('.dc-panel-changed th[data-sort=name]', th => getComputedStyle(th).position) === 'sticky', 'sticky header kept');
  if (!process.env.NOSHOTS) await p.screenshot({ path: '/workspace/default-chapters-resize-changed.png' });
  await p.click('.dc-tab[data-tab="found"]'); await sleep(200); await p.click('.dc-preset[data-min="60"]'); await p.click('.dc-find');
  await p.waitForFunction(() => document.querySelectorAll('.dc-found-rows tr[data-id]').length > 0, { timeout: 3000 });
  await C.run('Found table', '.dc-found-table', 'path', 'claw.defaultchapters.cols.found', async () => { await p.click('th[data-fsort="runtime"]'); });
  if (!process.env.NOSHOTS) await p.screenshot({ path: '/workspace/default-chapters-resize-found.png' });
  await p.reload(); await p.waitForFunction(() => document.querySelectorAll('.dc-rows tr[data-id]').length === 3, { timeout: 5000 });
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('claw.defaultchapters.cols.changed')));
  ok(Math.abs((await C.thBox('.dc-panel-changed table.dc-table', 'name')).w - st.name) <= 2, 'Changed widths restored after reload');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close(); fs.unlinkSync(file); console.log(passes + ' passed, ' + fails + ' failed'); process.exit(fails ? 1 : 0);
})();
