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
  ok(/MB\/s/.test(await txt('.mi-scan-fb .mi-fb-speed')), 'child bar: speed');
  ok(/Tears of Steel/.test(await txt('.mi-scan-fb .mi-fb-name')) && /45% of/.test(await txt('.mi-scan-fb .mi-fb-pct')), 'child bar: file name + % of bytes');
  ok(await p.$eval('.mi-scan-fb .mi-bar i', e => e.style.width) === '45.31%', 'child bar width = current file progress');
  ok(await p.$eval('.mi-scan-live > .mi-bar i', e => parseFloat(e.style.width)) > 40, 'overall bar');
  ok(/left/.test(await txt('.mi-m-left')), 'eta');

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
  await p.$eval('.mi-prob-ign', e => e.click()); await sleep(300);
  // ---- live Check now on a Problems row (unreadable file that now reads fine)
  const upath = await p.evaluate(() => { const tr = [...document.querySelectorAll('.mi-prob-t tbody tr[data-id]')].find(r => !/Missing/.test(r.textContent)); const pth = tr.getAttribute('data-path'); __srv.outcome[pth] = 'match'; __srv.freeze = true; return pth; });
  console.log('live target', upath);
  const usel = '.mi-prob-t tr[data-path="' + upath.replace(/\\/g, '\\\\') + '"]';
  await p.$eval(usel + ' [data-act=checknow]', e => e.click()); await sleep(500);
  ok(/queued/.test(await txt(usel + ' .mi-live')), 'row shows queued');
  await p.evaluate(() => { __srv.freeze = false; __srv.step = 0.21; __srv.advance(); __srv.advance(); __srv.advance(); __srv.freeze = true; }); await sleep(1600);
  const live = await txt(usel + ' .mi-live');
  ok(/\d+%/.test(live) && /MB\/s/.test(live), 'in-row percent + speed: ' + live);
  ok(/Checking now/.test(await txt('.mi-man-title')) && await vis('.mi-man-live'), 'manual progress in panel');
  ok(/of 1/.test(await txt('.mi-man-meta')), 'panel shows file x of y');
  ok(await vis('.mi-man-fb') && /Hero/.test(await txt('.mi-man-fb .mi-fb-name')) && /MB\/s/.test(await txt('.mi-man-fb .mi-fb-speed')), 'manual child bar: file + speed');
  await shot('checknow-progress');
  await p.evaluate(() => { __srv.freeze = false; __srv.step = 0.5; }); await sleep(2600);
  ok(/OK/.test(await txt(usel + ' .mi-live')) && /OK/.test(await txt(usel + ' .mi-pill')), 'row updated to OK without reload');
  ok((await p.evaluate(() => (__toasts || []).slice(-1)[0])) .startsWith('OK:'), 'toast with result');
  await sleep(3500);
  ok(!(await p.$(usel)), 'fixed file drops out of Problems after the check');
  // a missing file checked live -> Missing
  const mpath = await p.evaluate(() => __srv.files.find(x => x.Status === 'missing').Path);
  const msel = '.mi-prob-t tr[data-path="' + mpath.replace(/\\/g, '\\\\') + '"]';
  await p.$eval(msel + ' [data-act=checknow]', e => e.click()); await sleep(2500);
  ok(/Missing/.test(await txt(msel + ' .mi-live')), 'missing result in row');
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
  const first = await p.$eval('.mi-files-t tbody tr[data-id] td:nth-child(2)', e => e.textContent);
  ok(/Bluray/.test(first), 'sort size desc puts videos first');
  await shot('browse-expanded');
  // row checkboxes + Check selected
  ok(await p.$eval('[data-box] .mi-bsel-check', e => e.disabled), 'Check selected disabled with none');
  await p.$$eval('[data-box] tbody tr[data-id] .mi-bsel', a => { a[0].click(); a[1].click(); });
  ok(/2 selected/.test(await txt('[data-box] .mi-bsel-n')), '2 selected');
  const selIds = await p.$$eval('[data-box] tbody tr[data-id]', a => a.slice(0, 2).map(r => r.getAttribute('data-id')));
  await p.evaluate(() => { __srv.step = 0.5; });
  await p.$eval('[data-box] .mi-bsel-check', e => e.click()); await sleep(5000);
  for (const id of selIds) ok(/OK/.test(await txt('[data-box] tr[data-id="' + id + '"] .mi-live')), 'selected row ' + id + ' updated');
  ok(await p.evaluate(() => __srv.calls.includes('POST Check/Files')), 'Check/Files called');
  // per-row Check now in Browse
  await p.$eval('[data-box] tbody tr[data-id]:nth-child(3) .mi-checknow', e => e.click()); await sleep(3000);
  ok(/OK/.test(await txt('[data-box] tbody tr[data-id]:nth-child(3) .mi-live')), 'browse row Check now');
  await p.$eval('.mi-files-t tbody tr[data-id]', e => e.click()); await sleep(400);
  ok(await vis('.mi-modal'), 'history modal opens');
  ok((await p.$$('.mi-hist-t tbody tr')).length === 4, 'history rows');
  await shot('history');
  await click('.mi-dlg-no'); await sleep(200);
  // ---- two batches from two libraries merge into one job
  await p.evaluate(() => { __srv.freeze = true; });
  await p.$$eval('[data-box] tbody tr[data-id] .mi-bsel', a => { a[3].click(); a[4].click(); });
  const batchA = await p.$$eval('[data-box] tbody tr[data-id]', a => a.slice(3, 5).map(r => r.getAttribute('data-id')));
  await p.$eval('[data-box] .mi-bsel-check', e => e.click()); await sleep(700);
  await p.$eval('.mi-grp-t tr.mi-grp[data-key="lib:102"]', e => e.click()); await sleep(700);
  const tvBox = '[data-box="lib:102"]';
  await p.$$eval(tvBox + ' tbody tr[data-id] .mi-bsel', a => { a[0].click(); a[1].click(); a[2].click(); });
  const batchB = await p.$$eval(tvBox + ' tbody tr[data-id]', a => a.slice(0, 3).map(r => r.getAttribute('data-id')));
  await p.$eval(tvBox + ' .mi-bsel-check', e => e.click()); await sleep(700);
  ok((await p.evaluate(() => __srv.jobs.filter(j => j.State === 'queued' || j.State === 'running').length)) === 1, 'second batch appended to the active job (one job)');
  ok(/Added 3 files to the running check \(5 in total\)/.test(await p.evaluate(() => __toasts.slice(-1)[0])), 'toast for appended batch');
  for (const id of batchB) ok(/queued/.test(await txt(tvBox + ' tr[data-id="' + id + '"] .mi-live')), 'second-batch row ' + id + ' shows queued');
  await p.evaluate(() => { __srv.freeze = false; __srv.step = 0.5; __srv.advance(); __srv.advance(); __srv.advance(); __srv.freeze = true; }); await sleep(2400);
  ok(/of 5/.test(await txt('.mi-man-files')), 'combined x of y: ' + await txt('.mi-man-files'));
  ok(/2 batches combined/.test(await txt('.mi-man-meta')) && !(await p.$('.mi-man-queued')), 'batches shown, no stale "more queued"');
  ok(await vis('.mi-man-fb'), 'manual child bar visible');
  await shot('two-batches');
  await p.evaluate(() => { __srv.freeze = false; __srv.step = 1; }); await sleep(6500);
  for (const id of batchA.concat(batchB)) ok(/OK/.test(await txt('tr[data-id="' + id + '"] .mi-live')), 'row ' + id + ' updated after combined job');
  ok((await p.evaluate(() => __srv.jobs.filter(j => j.State === 'done').slice(-1)[0].Total)) === 5, 'combined job total 5');
  await p.$eval('.mi-grp-t tr.mi-grp[data-key="lib:102"]', e => e.click()); await sleep(500);
  // Check this library
  await p.evaluate(() => { __srv.freeze = true; });
  await p.$eval('.mi-grp-t tr.mi-grp[data-key="lib:102"] .mi-grp-check', e => e.click()); await sleep(2500);
  ok(await p.evaluate(() => __srv.calls.includes('POST Check/Group')), 'group check posted');
  await p.evaluate(() => { __srv.freeze = false; __srv.advance(); __srv.advance(); __srv.advance(); __srv.advance(); __srv.advance(); __srv.freeze = true; }); await sleep(2300);
  ok(/TV Shows/.test(await txt('.mi-man-title')), 'panel shows group check: ' + await txt('.mi-man-title'));
  await shot('check-library');
  await p.evaluate(() => { __srv.freeze = false; __srv.step = 1; }); await sleep(2000);
  await p.evaluate(async () => { for (let i = 0; i < 200; i++) __srv.advance(); }); await sleep(4500);
  ok(/TV Shows/.test((await p.evaluate(() => (__toasts || []).join('|')))), 'group check finished toast');
  // global search across all files
  await p.$eval('.mi-g-search', e => { e.value = 'sintel'; e.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(800);
  ok(!(await vis('.mi-grp-t')) && await vis('.mi-gsearch-box'), 'global search replaces groups');
  ok((await p.$$('.mi-gsearch-box tbody tr[data-id]')).length === 3, 'global search finds 3');
  await p.$eval('.mi-g-search', e => { e.value = 'Example Show'; e.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(800);
  ok(/30 files/.test(await txt('.mi-gsearch-box .mi-f-count')), 'global search across libraries: ' + await txt('.mi-gsearch-box .mi-f-count'));
  await p.$eval('.mi-g-search', e => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(500);
  await p.evaluate(() => { __srv.files[3].Status = 'never_hashed'; __srv.files[5].Status = 'never_hashed'; });
  await p.select('.mi-g-status', 'never_hashed'); await sleep(600);
  ok((await p.$$('.mi-gsearch-box tbody tr[data-id]')).length === 2, 'status filter never verified');
  await shot('global-search');
  await p.select('.mi-g-status', 'missing'); await sleep(600);
  ok((await p.$$('.mi-gsearch-box tbody tr[data-id]')).length === 1, 'status filter missing');
  await p.$eval('.mi-g-clear', e => e.click()); await sleep(500);
  ok(await vis('.mi-grp-t'), 'clear restores groups');
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
