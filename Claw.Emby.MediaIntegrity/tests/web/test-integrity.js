// node test-integrity.js [shotDir]  — puppeteer UI test against the offline mock (fake data only).
const puppeteer = require(process.env.PUPPETEER || '/workspace/jstest/node_modules/puppeteer-core');
const path = require('path');
const shots = process.argv[2];
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('FAIL ' + m); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.setViewport({ width: 1500, height: 1000 });
  const url = 'file://' + path.resolve(__dirname, 'integrity-page.html');
  await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.evaluate(() => document.fonts.ready); await sleep(600);
  const click = (s) => p.$eval(s, e => e.click());
  const txt = (s) => p.$eval(s, e => e.textContent.trim());
  const shot = async (n) => { if (shots) await p.screenshot({ path: path.join(shots, 'mediaintegrity-' + n + '.png') }); };
  const vis = (s) => p.$eval(s, e => !!(e.offsetWidth || e.offsetHeight));

  // icon
  const iw = await p.$eval('h2 .md-icon', e => e.getBoundingClientRect().width);
  ok(iw > 15 && iw < 30, 'health_and_safety glyph renders as single icon (w=' + iw + ')');
  // status / cards
  ok(/6,182/.test(await txt('.mi-m-files')), 'file x of y');
  ok(/MB\/s/.test(await txt('.mi-m-speed')), 'speed');
  ok(/left/.test(await txt('.mi-m-left')), 'eta');
  ok(/Tears of Steel/.test(await txt('.mi-cur')), 'current file');
  ok((await txt('.mi-c-problems')) === '4', 'problems card = 4');
  ok(await vis('.mi-act-pause') && await vis('.mi-act-stop') && !(await vis('.mi-act-start')), 'running buttons');
  // problems
  ok((await p.$$('.mi-prob-t tbody tr[data-id]')).length === 4, '4 problem rows');
  await shot('problems-running');
  await click('.mi-act-pause'); await sleep(2300);
  ok(await vis('.mi-act-resume') && !(await vis('.mi-act-pause')), 'paused -> resume shown');
  ok(/aused/i.test(await txt('.mi-scan-state')), 'paused state text');
  await click('.mi-act-resume'); await sleep(2300);
  ok(await vis('.mi-act-pause'), 'resumed');
  await click('.mi-act-stop'); await sleep(2300);
  ok(await vis('.mi-act-start') && await vis('.mi-act-fresh'), 'stopped -> start + start over');
  await shot('problems-stopped');
  // bulk / actions
  ok(await p.$eval('.mi-bulk[data-act=accept]', e => e.disabled), 'bulk disabled with no selection');
  await p.$eval('.mi-prob-t tbody tr:nth-child(1) .mi-sel', e => e.click());
  ok(/1 selected/.test(await txt('.mi-prob-bulk')), 'selection count');
  await click('.mi-bulk[data-act=accept]'); await sleep(400);
  ok((await p.$$('.mi-prob-t tbody tr[data-id]')).length === 3, 'accept removes row');
  await p.$eval('.mi-prob-t tbody tr[data-id] [data-act=ignore]', e => e.click()); await sleep(400);
  ok((await p.$$('.mi-prob-t tbody tr[data-id]')).length === 2, 'ignore hides row');
  await p.$eval('.mi-prob-ign', e => e.click()); await sleep(400);
  ok((await p.$$('.mi-prob-t tbody tr[data-id]')).length === 3, 'show ignored');
  await p.$eval('.mi-prob-t tbody tr[data-id] [data-act=recheck]', e => e.click()); await sleep(300);
  ok((await p.evaluate(() => __srv.queue)) === 1, 'recheck queued');
  await p.$eval('.mi-prob-ign', e => e.click()); await sleep(300);
  // browse
  await click('.mi-tab[data-tab=browse]'); await sleep(400);
  ok((await p.$$('.mi-grp-t tr.mi-grp')).length === 4, '4 library groups (3 libs + extra)');
  await shot('browse-library');
  await p.$eval('.mi-grp-t tr.mi-grp', e => e.click()); await sleep(400);
  const n1 = (await p.$$('.mi-files-t tbody tr[data-id]')).length;
  ok(n1 === 42, 'movies 42 files, got ' + n1);
  await p.$eval('.mi-f-search', e => { e.value = 'sintel'; e.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(700);
  ok((await p.$$('.mi-files-t tbody tr[data-id]')).length === 3, 'search');
  await p.$eval('.mi-f-search', e => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(700);
  await p.$eval('.mi-files-t th[data-sort=size]', e => e.click()); await sleep(300); // first click on size = largest first
  const first = await p.$eval('.mi-files-t tbody tr[data-id] td', e => e.textContent);
  ok(/Bluray/.test(first), 'sort size desc puts videos first');
  await shot('browse-expanded');
  await p.$eval('.mi-files-t tbody tr[data-id]', e => e.click()); await sleep(400);
  ok(await vis('.mi-modal'), 'history modal opens');
  ok((await p.$$('.mi-hist-t tbody tr')).length === 4, 'history rows');
  await shot('history');
  await click('.mi-dlg-no'); await sleep(200);
  // paging on TV group (38) — set small page via folder group with all D:
  await p.$eval('.mi-seg button[data-group=folder]', e => e.click()); await sleep(400);
  const fg = await p.$$eval('.mi-grp-t tr.mi-grp b', a => a.map(e => e.textContent));
  ok(fg.join('|') === 'D:\\Media|E:\\Archive|E:\\Family', 'folder grouping ' + fg.join('|'));
  await shot('browse-folder');
  await p.reload(); await sleep(600);
  ok(await vis('.mi-grp-t'), 'remembers last tab');
  ok(await p.$eval('.mi-seg button[data-group=folder]', e => e.classList.contains('mi-on')), 'remembers grouping');
  // activity
  await click('.mi-tab[data-tab=activity]'); await sleep(300);
  ok((await p.$$('.mi-scans-t tbody tr')).length === 4, '4 scans');
  ok(/14,316/.test(await txt('.mi-import-note')), 'import note');
  await shot('activity');
  // settings
  await click('.mi-tab[data-tab=settings]'); await sleep(400);
  ok((await p.$$('.mi-s-lib')).length === 3, 'library checkboxes');
  await shot('settings');
  await p.$eval('.mi-s-lib', e => e.click());
  await p.$eval('.mi-s-throttle', e => e.value = '80');
  await p.$eval('.mi-settings-form', f => f.requestSubmit()); await sleep(300);
  const sv = await p.evaluate(() => __srv.saved[0]);
  ok(sv && sv.ThrottleMBps === 80 && sv.ExcludedLibraryIds[0] === '101' && sv.ExtraFolders[0] === 'E:\\Archive', 'settings save');
  // column resize
  await click('.mi-tab[data-tab=problems]'); await sleep(300);
  const h = await p.$$('.mi-prob-t th .cr-h');
  ok(h.length >= 5, 'resize handles present');
  const th = await p.$('.mi-prob-t th:nth-child(3)'); const bb = await th.boundingBox(); const before = bb.width;
  const hb = await (await th.$('.cr-h')).boundingBox();
  await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await p.mouse.down(); await p.mouse.move(hb.x + 80, hb.y + 5, { steps: 5 }); await p.mouse.up();
  const after = (await th.boundingBox()).width;
  ok(after > before + 50, 'drag widens column ' + before + '->' + after);
  ok(await p.evaluate(() => !!localStorage.getItem('claw.mediaintegrity.cols.problems')), 'widths persisted');
  ok(errs.length === 0, 'no page errors: ' + errs.join('; '));
  console.log(pass + ' passed, ' + fail + ' failed'); await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH', e); process.exit(2); });
