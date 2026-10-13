/* Offline test of the plugin settings page (Web/config.html + Web/config.js) against mock-emby.js.
 * Run: node test-settings.js [--shots] */
const path = require('path');
const fs = require('fs');
const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const root = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'Web', 'config.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'Web', 'config.js'), 'utf8');
const mockSrc = fs.readFileSync(path.join(__dirname, 'mock-emby.js'), 'utf8');
const shots = process.argv.includes('--shots');

let pass = 0, fail = 0; const failures = [];
function check(cond, name) { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; failures.push(name); console.log('  FAIL ' + name); } }

const shell = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#101010;color:#ddd;font-family:"Segoe UI",Roboto,"Noto Sans",Arial,sans-serif;font-size:15px}
.skin-header{height:3.3em;display:flex;align-items:center;padding:0 1.2em;background:#1a1a1a;border-bottom:1px solid #000;gap:.8em}
.skin-header b{font-weight:500}
.sidebar{position:fixed;top:3.3em;bottom:0;left:0;width:15em;background:#151515;padding:1em 0;font-size:.95em}
.sidebar div{padding:.55em 1.4em;opacity:.8}
.sidebar div.sel{background:rgba(82,181,75,.18);color:#8fdc8a;opacity:1}
.main{margin-left:15em}
.content-primary{padding-top:.4em}
</style></head><body>
<div class="skin-header"><b>Emby Server</b><span style="opacity:.5">Dashboard &rsaquo; Plugins &rsaquo; Default Chapters</span></div>
<div class="sidebar"><div>Server</div><div>Library</div><div>Live TV</div><div>Devices</div><div class="sel">Plugins</div><div>Scheduled Tasks</div></div>
<div class="main" id="host"></div></body></html>`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('pageerror', e => { fail++; failures.push('page error: ' + e.message); console.log('  PAGE ERROR', e.message); });
  await page.setViewport({ width: 1280, height: 640 });
  await page.setContent(shell);
  await page.addScriptTag({ content: mockSrc });
  await page.evaluate(() => {
    window.__installEmby();
    const s = window.__server;
    s.addOverride('101', { after: 35, interval: 5, changed: '2026-10-05T19:00:00Z' });
    s.addOverride('102', { after: 12, interval: 10, changed: '2026-10-04T13:30:00Z' });
    s.addOverride('103', { after: 23, interval: 5, changed: '2026-10-05T21:15:00Z' });
    s.items['102'].chapters = 24; s.items['102'].before = 24;
    window.define = function (deps, factory) { window.__View = factory(); };
  });
  await page.evaluate(h => { document.getElementById('host').innerHTML = h; }, html);
  await page.addScriptTag({ content: js });
  await page.evaluate(() => {
    const view = document.getElementById('defaultChaptersPage');
    window.__ctl = new window.__View(view);
    view.dispatchEvent(new CustomEvent('viewshow'));
  });
  await page.waitForFunction(() => document.querySelectorAll('.dc-rows tr[data-id]').length === 3, { timeout: 5000 });

  const ids = () => page.$$eval('.dc-rows tr[data-id]', trs => trs.map(t => t.getAttribute('data-id')));
  const text = sel => page.$eval(sel, e => e.textContent.trim());
  const reqs = () => page.evaluate(() => window.__log.requests.slice());
  const clearReqs = () => page.evaluate(() => { window.__log.requests.length = 0; window.__log.confirms.length = 0; });
  const filter = async v => { await page.$eval('.dc-filter', (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); }, v); await new Promise(r => setTimeout(r, 200)); };
  const sortBy = k => page.click('th[data-sort="' + k + '"]');

  console.log('Table');
  check(JSON.stringify(await ids()) === JSON.stringify(['103', '101', '102']), 'rows sorted by Changed, newest first');
  check((await text('.dc-count')) === '3 changed movies', 'count shown');
  const cells = await page.$$eval('tr[data-id="101"] td', tds => tds.map(t => t.textContent.trim()));
  check(/^Heat\s*\(1995\)/.test(cells[0]) && cells[1] === '101' && cells[3] === '7' && cells[4] === '35' && cells[5] === '5 min', 'row shows name, id, before, after, interval');
  check(/Oct/.test(cells[2]), 'changed time rendered as a local date');
  check(await page.$eval('tr[data-id="101"] a', a => a.getAttribute('href')) === '#!/item?id=101&serverId=srv1', 'movie name links to the item page');
  check((await page.$eval('#dcInterval', e => e.value)) === '5', 'interval setting loaded (5)');

  console.log('Filter');
  await filter('ali');
  check(JSON.stringify(await ids()) === JSON.stringify(['102']), 'filter by name');
  check((await text('.dc-count')) === '1 of 3 shown', 'filtered count');
  await filter('ARRIVAL.mkv');
  check(JSON.stringify(await ids()) === JSON.stringify(['103']), 'filter by path, case-insensitive');
  await filter('101');
  check(JSON.stringify(await ids()) === JSON.stringify(['101']), 'filter by id');
  await filter('zzz');
  check((await text('.dc-rows')) === 'No movies match the filter.', 'no-match message');
  await filter('');
  check((await ids()).length === 3, 'clearing the filter shows all rows');

  console.log('Sort');
  await sortBy('name');
  check(JSON.stringify(await ids()) === JSON.stringify(['102', '103', '101']), 'Movie column: A-Z');
  await sortBy('name');
  check(JSON.stringify(await ids()) === JSON.stringify(['101', '103', '102']), 'Movie column again: Z-A');
  await sortBy('after');
  check(JSON.stringify(await ids()) === JSON.stringify(['101', '103', '102']), 'After: largest first');
  await sortBy('after');
  check(JSON.stringify(await ids()) === JSON.stringify(['102', '103', '101']), 'After again: smallest first');
  await sortBy('interval');
  check((await ids())[0] === '102', 'Interval: 10 min first');
  await sortBy('id');
  check(JSON.stringify(await ids()) === JSON.stringify(['101', '102', '103']), 'Id ascending');
  check(await page.$eval('th[data-sort="id"]', th => th.getAttribute('aria-sort')) === 'ascending', 'sorted column marked (aria-sort)');
  await sortBy('changed');

  if (shots) {
    await page.screenshot({ path: process.env.SETTINGS_SHOT || '/workspace/default-chapters-settings.png' });
    console.log('  screenshot written');
  }

  console.log('Revert');
  await clearReqs();
  await page.evaluate(() => { window.__confirmAnswer.value = false; });
  await page.click('tr[data-id="102"] .dc-revert');
  await new Promise(r => setTimeout(r, 150));
  let L = await page.evaluate(() => JSON.parse(JSON.stringify(window.__log)));
  check(L.confirms.length === 1 && /24 original chapters of “Alien”/.test(L.confirms[0].text), 'confirm names the movie and the original count');
  check(L.requests.length === 0 && (await ids()).length === 3, 'cancel: nothing sent, row stays');

  await clearReqs();
  await page.evaluate(() => { window.__confirmAnswer.value = true; window.__clawDefaultChapters = { state: { ids: { '102': true } } }; });
  await page.click('tr[data-id="102"] .dc-revert');
  await page.waitForFunction(() => !document.querySelector('tr[data-id="102"]'), { timeout: 3000 });
  L = await page.evaluate(() => JSON.parse(JSON.stringify(window.__log)));
  check(JSON.stringify(L.requests) === JSON.stringify(['POST DefaultChapters/Items/102/Restore']), 'POST Restore for that row');
  check(JSON.stringify(await ids()) === JSON.stringify(['103', '101']), 'reverted row removed');
  check((await text('.dc-count')) === '2 changed movies', 'count updated');
  check(/Restored the original chapters of “Alien”/.test(await text('.dc-table-msg')), 'success message');
  check(await page.evaluate(() => !window.__clawDefaultChapters.state.ids['102']), 'menu cache updated (Restore entry disappears)');
  check(await page.evaluate(() => !window.__server.overrides['102']), 'server-side override gone');

  await clearReqs();
  await page.evaluate(() => { window.__server.failNext = { status: 500, text: 'disk full' }; });
  await page.click('tr[data-id="101"] .dc-revert');
  await page.waitForFunction(() => /Revert failed/.test(document.querySelector('.dc-table-msg').textContent), { timeout: 3000 });
  check((await ids()).length === 2 && /disk full/.test(await text('.dc-table-msg')), 'failed revert keeps the row and shows the error');
  check(await page.$eval('tr[data-id="101"] .dc-revert', b => !b.disabled), 'button re-enabled after failure');

  await page.click('tr[data-id="101"] .dc-revert');
  await page.waitForFunction(() => !document.querySelector('tr[data-id="101"]'), { timeout: 3000 });
  await page.click('tr[data-id="103"] .dc-revert');
  await page.waitForFunction(() => !document.querySelector('tr[data-id]'), { timeout: 3000 });
  check((await text('.dc-rows')) === 'No movies have interval chapters from this plugin yet.' && (await text('.dc-count')) === '', 'empty state after reverting everything');

  console.log('Settings');
  await clearReqs();
  await page.$eval('#dcInterval', e => { e.value = '0'; });
  await page.click('.dc-save');
  await new Promise(r => setTimeout(r, 100));
  check(/1 to 60/.test(await text('.dc-save-msg')) && (await reqs()).length === 0, 'invalid interval rejected, nothing saved');
  await page.$eval('#dcInterval', e => { e.value = '10'; });
  await page.click('.dc-save');
  await page.waitForFunction(() => /Saved/.test(document.querySelector('.dc-save-msg').textContent), { timeout: 3000 });
  check(await page.evaluate(() => window.__server.pluginConfig.IntervalMinutes === 10), 'interval 10 saved through updatePluginConfiguration');

  console.log('Reload');
  await page.evaluate(() => window.__server.addOverride('103', { after: 23 }));
  await page.click('.dc-reload');
  await page.waitForFunction(() => document.querySelectorAll('.dc-rows tr[data-id]').length === 1, { timeout: 3000 });
  check(true, 'Reload fetches the list again');

  // ------------------------------------------------------------ Found movies tab
  console.log('Tabs');
  const visible = sel => page.$eval(sel, e => !e.hidden && e.offsetParent !== null);
  check(await visible('.dc-panel-changed') && !(await visible('.dc-panel-found')), 'Changed tab shown by default');
  check((await text('.dc-badge-changed')) === '1' && (await text('.dc-badge-found')) === '\u2013', 'tab badges: Changed 1, Found not scanned');
  await page.evaluate(() => {
    const s = window.__server; s.configuredInterval = 10;
    const add = (id, name, runtime, chapters, extra) => { s.items[id] = Object.assign({ Id: id, Name: name, Type: 'Movie', ProductionYear: 1940 + (+id % 80), runtime, chapters, interval: 0 }, extra || {}); };
    add('601', 'Casablanca', 102, 1, { markers: 2 }); add('602', 'Dune', 155, 0); add('603', 'Brazil', 142, 3); add('604', 'Metropolis', 153, 2);
    add('605', 'Seven Samurai', 207, 1); add('606', 'Up', 96, 4); add('607', 'Short Film', 45, 1); add('608', 'Exactly an Hour', 60, 1);
    add('609', 'Even Steven', 88, 2, { interval: 10 }); add('610', 'Broken', 120, 1, { failWith: 'disk full' });
    s.items['611'] = { Id: '611', Name: 'Pilot Long', Type: 'Episode', runtime: 90, chapters: 0 };
  });
  await page.click('.dc-tab[data-tab="found"]');
  check(await visible('.dc-panel-found') && !(await visible('.dc-panel-changed')), 'Found movies tab switches panels');
  check(await page.$eval('.dc-tab[data-tab="found"]', b => b.getAttribute('aria-selected')) === 'true', 'active tab marked');
  check(/Nothing is scanned automatically/.test(await text('.dc-found-rows')) && (await page.evaluate(() => window.__server.foundCalls.length)) === 0, 'manual only: no scan on page load or tab switch');
  check((await page.$eval('#dcMinRuntime', e => e.value)) === '60' && (await page.$eval('#dcMaxChapters', e => e.value)) === '3' && await page.$eval('#dcExcludeOverridden', e => e.checked), 'criteria defaults 60 min, 3 chapters, hide changed');
  check(await page.$eval('.dc-bulk', b => b.disabled), 'bulk button disabled before a scan');

  console.log('Find matches');
  await page.click('.dc-preset[data-min="90"]');
  check((await page.$eval('#dcMinRuntime', e => e.value)) === '90', '1\u00BD hours preset fills 90');
  await page.click('.dc-preset[data-min="60"]');
  await page.click('.dc-find');
  await page.waitForFunction(() => document.querySelectorAll('.dc-found-rows tr[data-id]').length > 0, { timeout: 3000 });
  const fids = () => page.$$eval('.dc-found-rows tr[data-id]', trs => trs.map(t => t.getAttribute('data-id')));
  let q = await page.evaluate(() => window.__server.foundCalls[0]);
  check(q.MinRuntimeMinutes === '60' && q.MaxChapters === '3' && q.ExcludeOverridden === 'true', 'GET Found with the criteria');
  check(await page.evaluate(() => window.__server.pluginConfig.MinRuntimeMinutes === 60 && window.__server.pluginConfig.MaxChapters === 3 && window.__server.pluginConfig.ExcludeOverridden === true && window.__server.pluginConfig.IntervalMinutes === 10), 'criteria saved to plugin config (interval kept)');
  check(JSON.stringify(await fids()) === JSON.stringify(['603', '610', '601', '602', '609', '604', '605']), 'matches: >60 min, <=3 chapters, movies only, sorted by name');
  check((await text('.dc-badge-found')) === '7' && /7 movies match/.test(await text('.dc-found-msg')), 'badge and message show 7 matches');
  const brazil = await page.$$eval('tr[data-id="603"] td', tds => tds.map(t => t.textContent.trim()));
  check(/Brazil/.test(brazil[1]) && brazil[2] === '2h 22m' && brazil[3] === '3' && /Brazil\.mkv$/.test(brazil[4]), 'row: name, runtime 2h 22m, chapters, path');
  check(/^1\s*\+2m$/.test(await text('.dc-found-rows tr[data-id="601"] td:nth-child(4)')), 'markers shown separately, not counted');
  check(/evenly spaced/.test(await text('tr[data-id="609"]')), 'evenly spaced movie flagged');

  console.log('Found filter / sort / select');
  const ffilter = async v => { await page.$eval('.dc-found-filter', (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); }, v); await new Promise(r => setTimeout(r, 200)); };
  await ffilter('samurai');
  check(JSON.stringify(await fids()) === JSON.stringify(['605']) && (await text('.dc-found-count')) === '1 of 7 shown', 'filter by name');
  await ffilter('');
  await page.click('th[data-fsort="runtime"]');
  check((await fids())[0] === '605' && (await fids())[6] === '609', 'Runtime: longest first');
  await page.click('th[data-fsort="chapters"]');
  check((await fids())[0] === '603', 'Chapters: most first');
  await page.click('th[data-fsort="name"]');
  await page.click('tr[data-id="601"] .dc-row-cb');
  await page.click('tr[data-id="602"] .dc-row-cb');
  check(/2 selected/.test(await text('.dc-found-count')) && (await text('.dc-bulk')) === 'Generate for selected (2)\u2026', 'row checkboxes select; bulk button shows count');
  check(await page.$eval('.dc-page-cb', c => c.indeterminate), 'header checkbox indeterminate');
  await page.click('.dc-page-cb');
  check(/7 selected/.test(await text('.dc-found-count')), 'header checkbox selects all on the page');
  await page.click('.dc-page-cb');
  check(!/selected/.test(await text('.dc-found-count')) && await page.$eval('.dc-bulk', b => b.disabled), 'header checkbox again clears');

  console.log('Bulk generate');
  for (const id of ['601', '602', '609', '610']) await page.click('tr[data-id="' + id + '"] .dc-row-cb');
  await page.evaluate(() => { window.__confirmAnswer.value = false; window.__log.confirms.length = 0; });
  await page.click('.dc-bulk');
  await new Promise(r => setTimeout(r, 150));
  let C = await page.evaluate(() => window.__log.confirms.slice());
  check(C.length === 1 && /every 10 minutes for 4 selected movies/.test(C[0].text) && /1 of them already has evenly spaced chapters/.test(C[0].text), 'confirm lists count, interval and how many get replaced');
  check(C[0].confirmText === 'Generate' && C[0].primary === 'cancel', 'confirm: "Generate", Cancel default');
  check((await page.evaluate(() => window.__server.manyCalls.length)) === 0 && /4 selected/.test(await text('.dc-found-count')), 'cancel: nothing sent, selection kept');
  await page.evaluate(() => { window.__confirmAnswer.value = true; });
  await page.click('.dc-bulk');
  await page.waitForFunction(() => /Generated interval chapters for/.test(document.querySelector('.dc-found-msg').textContent), { timeout: 3000 });
  let M = await page.evaluate(() => window.__server.manyCalls.slice());
  check(M.length === 1 && M[0].confirmed === true && M[0].ids.slice().sort().join(',') === '601,602,609,610', 'one POST GenerateMany with the 4 ids, Confirmed=true');
  check(/for 3 movies\. They are now listed on the Changed tab\. 1 failed/.test(await text('.dc-found-msg')), 'summary: 3 done, 1 failed');
  const d601 = await page.$eval('.dc-found-rows tr[data-id="601"]', t => t.className + '|' + t.querySelector('.dc-act').textContent);
  check(/dc-done/.test(d601) && /Done/.test(d601), 'done rows marked Done [' + d601 + ']');
  check(await page.$eval('tr[data-id="601"] .dc-row-cb', c => c.disabled && !c.checked), 'done rows can no longer be selected');
  check(/disk full/.test(await text('tr[data-id="610"] .dc-act')) && await page.$('tr[data-id="610"] .dc-gen-one') !== null, 'failed row shows the error and can be retried');
  await page.waitForFunction(() => document.querySelector('.dc-badge-changed').textContent === '4', { timeout: 3000 });
  check((await text('.dc-badge-found')) === '4', 'badges: Changed 4, Found 4 remaining');
  check(await page.evaluate(() => !!window.__clawDefaultChapters.state.ids['601']), 'menu cache knows about the new overrides');
  check((await text('.dc-select-all')) === 'Select all matching (4)', 'select-all counts only rows still actionable');

  // preview: a couple selected next to done/failed rows
  await page.click('tr[data-id="603"] .dc-row-cb');
  await page.click('tr[data-id="605"] .dc-row-cb');
  if (shots) {
    await page.setViewport({ width: 1280, height: 860 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: process.env.FOUND_SHOT || '/workspace/default-chapters-found.png' });
    console.log('  found screenshot written');
  }
  await page.click('.dc-select-none');

  console.log('Changed tab after bulk');
  await page.click('.dc-goto-changed');
  check(await visible('.dc-panel-changed'), '"Changed tab" link switches tabs');
  const cids = (await ids()).slice().sort();
  check(JSON.stringify(cids) === JSON.stringify(['103', '601', '602', '609']), 'generated movies listed on Changed');
  if (shots) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: process.env.TABS_SHOT || '/workspace/default-chapters-settings-tabs.png' });
    console.log('  tabs screenshot written');
  }

  console.log('Single-row generate');
  await page.click('.dc-tab[data-tab="found"]');
  await page.evaluate(() => { window.__server.manyCalls.length = 0; window.__log.confirms.length = 0; });
  await page.click('tr[data-id="604"] .dc-gen-one');
  await page.waitForFunction(() => /Done/.test(document.querySelector('tr[data-id="604"] .dc-act').textContent), { timeout: 3000 });
  M = await page.evaluate(() => window.__server.manyCalls.slice());
  check(M.length === 1 && M[0].ids.join() === '604' && M[0].confirmed === false && (await page.evaluate(() => window.__log.confirms.length)) === 0, 'plain movie: one POST, no confirm');
  check(/Metropolis.*Changed tab/.test(await text('.dc-found-msg')), 'single-row success message');

  await page.$eval('#dcExcludeOverridden', e => { e.checked = false; });
  await page.click('.dc-find');
  await page.waitForFunction(() => window.__server.foundCalls.length === 2 && document.querySelector('tr[data-id="601"] .dc-gen-one'), { timeout: 3000 });
  const t601 = await text('.dc-found-rows tr[data-id="601"] td:nth-child(2)');
  check(/changed/.test(t601), 'with "hide changed" off, changed movies come back flagged [' + t601 + ']');
  await page.evaluate(() => { window.__server.manyCalls.length = 0; window.__log.confirms.length = 0; window.__confirmAnswer.value = false; });
  await page.click('tr[data-id="601"] .dc-gen-one');
  await new Promise(r => setTimeout(r, 150));
  C = await page.evaluate(() => window.__log.confirms.slice());
  check(C.length === 1 && /already has interval chapters/.test(C[0].text) && (await page.evaluate(() => window.__server.manyCalls.length)) === 0, 'row needing confirm: confirm first, cancel sends nothing');
  await page.evaluate(() => { window.__confirmAnswer.value = true; });
  await page.click('tr[data-id="601"] .dc-gen-one');
  await page.waitForFunction(() => window.__server.manyCalls.length === 1, { timeout: 3000 });
  check(await page.evaluate(() => window.__server.manyCalls[0].confirmed === true), 'accept: POST with Confirmed=true');

  console.log('Revert from Changed resets the Found row');
  await page.click('.dc-tab[data-tab="changed"]');
  await page.click('.dc-rows tr[data-id="602"] .dc-revert');
  await page.waitForFunction(() => !document.querySelector('.dc-rows tr[data-id="602"]'), { timeout: 3000 });
  await page.click('.dc-tab[data-tab="found"]');
  check(await page.$('tr[data-id="602"] .dc-gen-one') !== null && await page.$eval('tr[data-id="602"] .dc-row-cb', c => !c.disabled), 'reverted movie is actionable again on Found');

  console.log('Batches and paging');
  await page.evaluate(() => {
    const s = window.__server;
    for (let i = 0; i < 125; i++) { const id = String(700 + i); s.items[id] = { Id: id, Name: 'Bulk ' + String(i).padStart(3, '0'), Type: 'Movie', runtime: 100, chapters: 0, interval: 0 }; }
    s.manyCalls.length = 0;
  });
  await page.$eval('#dcExcludeOverridden', e => { e.checked = true; });
  await page.click('.dc-find');
  await page.waitForFunction(() => window.__server.foundCalls.length === 3 && document.querySelectorAll('.dc-found-rows tr[data-id]').length === 100, { timeout: 3000 });
  check(await visible('.dc-pager') && (await text('.dc-page-info')) === 'Page 1 of 2', '100 rows per page, pager shown');
  await page.click('.dc-page-cb');
  check(/100 selected/.test(await text('.dc-found-count')), 'header checkbox selects the current page only');
  await page.click('.dc-next');
  check((await text('.dc-page-info')) === 'Page 2 of 2' && (await fids()).length > 0, 'next page');
  await page.click('.dc-select-none');
  await ffilter('bulk 0');
  await page.click('.dc-select-all');
  check(/100 selected/.test(await text('.dc-found-count')), 'select all matching uses the filter (100 "Bulk 0xx")');
  await ffilter('bulk 00');
  await page.click('.dc-select-none');
  await page.click('.dc-select-all');
  check(/10 selected/.test(await text('.dc-found-count')), 'filtered selection: 10');
  await ffilter('bulk 0');
  await page.click('.dc-select-all');
  await page.click('.dc-bulk');
  await page.waitForFunction(() => /Generated interval chapters for 100 movies/.test(document.querySelector('.dc-found-msg').textContent), { timeout: 5000 });
  M = await page.evaluate(() => window.__server.manyCalls.map(c => c.ids.length));
  check(M.length === 10 && M.every(n => n === 10), '100 movies sent in batches of 10');

  await browser.close();
  console.log('\nPassed ' + pass + ', failed ' + fail);
  failures.forEach(f => console.log('  failed: ' + f));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
