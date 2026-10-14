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
  const url = require('url').pathToFileURL(path.resolve(__dirname, 'integrity-page.html')).href;
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
  ok((await p.$$('.mi-grp-t tr.mi-grp')).length === 5, '5 library groups (4 libs + extra)');
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
  // ---- files on disk that the database does not know (any library type, e.g. audiobooks)
  await click('.mi-tab[data-tab=browse]'); await sleep(300);
  if (await p.$eval('.mi-seg button[data-group=folder]', e => e.classList.contains('mi-on'))) { await p.$eval('.mi-seg button[data-group=library]', e => e.click()); await sleep(500); }
  const ab = '.mi-grp-t tr.mi-grp[data-key="lib:104"]';
  ok(!!(await p.$(ab)), 'library with 0 tracked files is listed (Audio books)');
  ok(/^0$/.test(await p.$eval(ab, r => r.cells[1].textContent.trim())), 'Audio books: 0 files before the file list is read');
  await p.$eval(ab, e => e.click()); await sleep(600);
  ok(/No files found on disk in this library yet/.test(await txt('[data-box="lib:104"] tbody')), 'empty library explains how to read it');
  ok(/files on disk, read/.test(await txt('.mi-fl-info')), 'file list info shown');
  await p.$eval('.mi-fl-refresh', e => e.click()); await sleep(400);
  ok(/Reading file list/.test(await txt('.mi-fl-info')), 'refresh shows reading state');
  ok(await p.evaluate(() => __srv.calls.includes('POST FileList/Refresh')), 'refresh API called');
  await sleep(4500);
  ok(/^12$/.test(await p.$eval(ab, r => r.cells[1].textContent.trim())), 'Audio books: 12 files after refresh: ' + await p.$eval(ab, r => r.cells[1].textContent.trim()));
  ok(/^12$/.test(await p.$eval(ab, r => r.cells[5].textContent.trim())), 'Audio books: 12 not yet hashed');
  ok((await p.$$('[data-box="lib:104"] tbody tr[data-id]')).length === 12, 'expanded library lists the untracked files');
  ok(/Not yet hashed/.test(await txt('[data-box="lib:104"] tbody tr[data-id] td:nth-child(6)')), 'row status Not yet hashed');
  await shot('untracked-library');
  // untracked file in a library that already had files (Movies) shows in global search + status filter
  await p.$eval('.mi-g-status', e => { e.value = 'pending'; e.dispatchEvent(new Event('change')); }); await sleep(700);
  const pendRows = await p.$$eval('.mi-gsearch-box tbody tr[data-id]', a => a.map(r => r.textContent));
  ok(pendRows.some(t => /Making of\.mp4/.test(t)) && pendRows.some(t => /Quiet Rivers\.m4b/.test(t)), 'status filter Not yet hashed finds untracked files in every library');
  await p.$eval('.mi-g-search', e => { e.value = 'Quiet Rivers'; e.dispatchEvent(new Event('input')); }); await sleep(900);
  ok((await p.$$('.mi-gsearch-box tbody tr[data-id]')).length === 4, 'global search finds the 4 untracked files of that book');
  // Check now on an untracked file
  await p.evaluate(() => { __srv.freeze = false; __srv.step = 1; });
  const qr = await p.$$eval('.mi-gsearch-box tbody tr[data-id]', a => a.find(r => /\.m4b/.test(r.textContent)).getAttribute('data-id'));
  await p.$eval('.mi-gsearch-box tbody tr[data-id="' + qr + '"] .mi-checknow', e => e.click()); await sleep(5000);
  ok(/OK|New/i.test(await txt('.mi-gsearch-box tr[data-id="' + qr + '"] .mi-live')), 'Check now works on an untracked file');
  await p.$eval('.mi-g-clear', e => e.click()); await sleep(600);
  // Check this library on Audio books
  await p.$eval(ab + ' .mi-grp-check', e => e.click()); await sleep(500);
  const abJob = await p.evaluate(() => __srv.jobs.slice(-1)[0]);
  ok(abJob && abJob.Total === 12 && /Audio books/.test(abJob._first || abJob.Label), 'Check this library queues all 12 audiobook files');
  await sleep(6000);
  // Problems tab: note with count + Check all
  await p.evaluate(() => { __srv.files.forEach(f => { if (/Making of/.test(f.Path)) { f.Status = 'pending'; } }); });
  await click('.mi-tab[data-tab=problems]'); await sleep(2500);
  ok(await vis('.mi-pend-note') && /not yet hashed/.test(await txt('.mi-pend-text')), 'Problems tab shows not-yet-hashed count');
  await p.$eval('.mi-pend-check', e => e.click()); await sleep(500);
  ok(await p.evaluate(() => __srv.calls.includes('POST Check/Group') && __srv.jobs.some(j => (j.State === 'running' || j.State === 'queued' || /not yet hashed/.test(j._first)) && j._files.some(f => /Making of/.test(f.Path)))), 'Check all not yet hashed queues them');
  await sleep(1500); await p.$eval('.mi-pend-browse', e => e.click()); await sleep(700);
  ok(await vis('.mi-gsearch-box') && await p.$eval('.mi-g-status', e => e.value) === 'pending', 'Show in Browse opens the filter');
  await p.$eval('.mi-g-clear', e => e.click()); await sleep(6000);
  // ---- "(old database)" goes away once no imported file is left without a verified hash
  await p.evaluate(() => { __srv.freeze = false; __srv.step = 1; __srv.files.filter(f => f.Status === 'ok' && /Family/.test(f.Path)).slice(0, 3).forEach(f => { f.Status = 'never_hashed'; f.LastHash = null; f.LastChecked = null; f._wasNever = true; }); });
  ok(await p.evaluate(() => __srv.files.some(f => f._wasNever)), 'fixture has never-verified imported files');
  await sleep(2600);
  ok(/old database/.test(await txt('.mi-c-queue')), 'page notice shows (old database) while never-verified files remain');
  const nvIds = await p.evaluate(() => __srv.files.filter(f => f.Status === 'never_hashed').map(f => f.Id));
  await p.evaluate(ids => ApiClient.ajax({ type: 'POST', url: ApiClient.getUrl('ClawMediaIntegrity/Check/Files', { Ids: ids.join(',') }), dataType: 'json' }), nvIds);
  await sleep(9000);
  ok(await p.evaluate(() => __srv.files.filter(f => f.Status === 'never_hashed').length) === 0, 'all never-verified files got a hash');
  ok(!/old database/.test(await txt('.mi-c-queue')), 'page notice without (old database) at 0: ' + await txt('.mi-c-queue'));
  ok(!/old script/.test(await txt('.mi-pend-text').catch(() => '')), 'Problems note drops the old-script part');
  await click('.mi-tab[data-tab=browse]'); await sleep(300);
  await p.$eval('.mi-g-search', (e, n) => { e.value = n; e.dispatchEvent(new Event('input')); }, await p.evaluate(id => __srv.files.find(f => f.Id === id).Name, nvIds[0])); await sleep(900);
  const lbl = await p.$eval('.mi-gsearch-box tbody tr[data-id="' + nvIds[0] + '"] td:nth-child(6)', e => e.textContent);
  ok(!/Never verified|old/i.test(lbl) && /OK|Changed|Unreadable|Missing/.test(lbl), 'per-file label after its first plugin hash: ' + lbl.trim());
  await p.$eval('.mi-g-clear', e => e.click()); await sleep(500);
  // ---- paging + Gmail-style "select all N matching"
  await p.evaluate(() => { for (let i = 1; i <= 160; i++) __srv.add('E:\\Archive\\Scans\\Page ' + String(i).padStart(3, '0') + '.tif', 2e6 + i, 'ok'); });
  await click('.mi-tab[data-tab=browse]'); await sleep(300);
  const ex = '.mi-grp-t tr.mi-grp[data-key="extra"]';
  await p.$eval(ex, e => e.click()); await sleep(700);
  const eb = '[data-box="extra"]';
  ok((await p.$$(eb + ' tbody tr[data-id]')).length === 100, 'Browse pages at 100 rows');
  await p.$eval(eb + ' .mi-bsel-all', e => e.click()); await sleep(200);
  ok(await vis(eb + ' .mi-selall') && /All 100 on this page selected/.test(await txt(eb + ' .mi-selall')) && /Select all 162 matching files/.test(await txt(eb + ' .mi-selall')), 'banner after header box: ' + await txt(eb + ' .mi-selall'));
  ok(/^100 selected/.test(await txt(eb + ' .mi-bsel-n')), 'header box selects only the current page');
  await p.$eval(eb + ' .mi-selall', e => e.scrollIntoView({ block: 'center' })); await sleep(150);
  await shot('select-page');
  await p.$eval(eb + ' .mi-sa-all', e => e.click()); await sleep(200);
  ok(/All 162 matching files are selected/.test(await txt(eb + ' .mi-selall')) && /162 selected/.test(await txt(eb + ' .mi-bsel-n')), 'select all matching');
  await p.$eval(eb + ' .mi-selall', e => e.scrollIntoView({ block: 'center' })); await sleep(150);
  await shot('select-all-matching');
  await p.$eval(eb + ' .mi-sa-clear', e => e.click()); await sleep(200);
  ok(!(await vis(eb + ' .mi-selall')) && /^0 selected/.test(await txt(eb + ' .mi-bsel-n')), 'Clear selection');
  // select all with a search filter -> server gets the filter, not ids
  await p.$eval(eb + ' .mi-f-search', e => { e.value = '.tif'; e.dispatchEvent(new Event('input')); }); await sleep(900);
  const tot = await txt(eb + ' .mi-f-count');
  await p.$eval(eb + ' .mi-bsel-all', e => e.click()); await sleep(200);
  ok(/Select all 160 matching/.test(await txt(eb + ' .mi-selall')), 'banner counts the filtered total (' + tot + ')');
  await p.$eval(eb + ' .mi-sa-all', e => e.click()); await sleep(100);
  await p.$eval(eb + ' .mi-bsel-check', e => e.click()); await sleep(600);
  const lm = await p.evaluate(() => __srv.lastMatching);
  ok(lm && lm.q.Group === 'extra' && lm.q.Search === '.tif' && lm.n === 160 && !lm.q.Ids, 'Check selected sends the filter (160 files), not ids');
  // confirmation above 2,000 files
  await p.evaluate(() => { for (let i = 1; i <= 2100; i++) __srv.add('E:\\Archive\\Bulk\\f' + i + '.bin', 1000, 'ok'); window.__conf = []; window.confirm = (m) => { window.__conf.push(m); return false; }; });
  await p.$eval(eb + ' .mi-f-search', e => { e.value = ''; e.dispatchEvent(new Event('input')); }); await sleep(900);
  await p.$eval(eb + ' .mi-bsel-all', e => e.click()); await p.$eval(eb + ' .mi-sa-all', e => e.click());
  const callsBefore = await p.evaluate(() => __srv.calls.filter(c => c === 'POST Check/Matching').length);
  await p.$eval(eb + ' .mi-bsel-check', e => e.click()); await sleep(300);
  ok(await p.evaluate(() => /Check all 2,262 matching files/.test(window.__conf[0] || '')), 'confirm above 2,000: ' + await p.evaluate(() => window.__conf[0]));
  ok(await p.evaluate(n => __srv.calls.filter(c => c === 'POST Check/Matching').length === n, callsBefore), 'declined confirm queues nothing');
  await p.evaluate(() => { window.confirm = () => true; });
  await p.$eval(eb + ' .mi-sa-clear', e => e.click()).catch(() => {});
  // Problems tab: paging + select all matching
  await p.evaluate(() => { for (let i = 1; i <= 130; i++) { const f = __srv.add('E:\\Archive\\Damaged\\clip ' + i + '.mp4', 5e7, 'changed'); f.LastChecked = new Date().toISOString(); } });
  await click('.mi-tab[data-tab=problems]'); await sleep(900);
  const probTotal = await p.evaluate(() => __srv.files.filter(f => ['changed','modified','missing','unreadable'].includes(f.Status) && !f.Ignored).length);
  ok((await p.$$('.mi-prob-t tbody tr[data-id]')).length === 100 && await vis('.mi-prob-pager'), 'Problems pages at 100 rows');
  await p.$eval('.mi-sel-all', e => e.click()); await sleep(200);
  ok(/All 100 on this page selected/.test(await txt('.mi-prob-selall')) && new RegExp('Select all ' + probTotal + ' matching').test(await txt('.mi-prob-selall')), 'Problems banner');
  await p.$eval('.mi-prob-selall .mi-sa-all', e => e.click()); await sleep(200);
  ok(new RegExp('^' + probTotal + ' selected').test(await txt('.mi-prob-bulk')), 'Problems: all matching selected');
  await p.$eval('.mi-prob-selall', e => e.scrollIntoView({ block: 'center' })); await sleep(150);
  await shot('problems-select-all');
  await p.$eval('.mi-bulk[data-act=recheck]', e => e.click()); await sleep(600);
  const lp = await p.evaluate(() => __srv.lastMatching);
  ok(lp && lp.q.Group === 'problems' && lp.n === probTotal, 'Problems Check now with select-all sends the filter (' + (lp && lp.n) + ')');
  await p.$eval('.mi-prob-next', e => e.click()); await sleep(200);
  ok((await p.$$('.mi-prob-t tbody tr[data-id]')).length === probTotal - 100, 'Problems page 2');
  await p.evaluate(() => { __srv.files.filter(f => /Damaged|Scans|Bulk/.test(f.Path)).forEach(f => __srv.files.splice(__srv.files.indexOf(f), 1)); __srv.jobs.forEach(j => { if (j.State !== 'done') { j.State = 'cancelled'; j.CurrentFile = null; } }); });
  await p.reload(); await sleep(1200);
  // manual checks show in Activity (two batches -> one entry)
  await p.evaluate(() => { __srv.freeze = true; });
  await p.evaluate(() => { const ids = __srv.files.slice(0, 2).map(f => f.Id), ids2 = __srv.files.slice(40, 43).map(f => f.Id);
    return ApiClient.ajax({ type: 'POST', url: ApiClient.getUrl('ClawMediaIntegrity/Check/Files', { Ids: ids.join(',') }), dataType: 'json' }).then(() => ApiClient.ajax({ type: 'POST', url: ApiClient.getUrl('ClawMediaIntegrity/Check/Files', { Ids: ids2.join(',') }), dataType: 'json' })); });
  await p.evaluate(() => { __srv.freeze = false; __srv.step = 1; for (let i = 0; i < 20; i++) __srv.advance(); });
  await click('.mi-tab[data-tab=activity]'); await sleep(500);
  const man = await p.$$eval('.mi-scans-t tbody tr[data-scan]', a => a.filter(r => /Manual/.test(r.cells[0].textContent)).map(r => [r.cells[1].textContent, r.cells[6].textContent, r.cells[14].textContent]));
  ok(man.length === 1 && /\+ 1 more batch/.test(man[0][0]) && man[0][1].trim() === '5' && /2 batches combined/.test(man[0][2]), 'combined manual batches = one Activity entry: ' + JSON.stringify(man));
  await shot('activity-manual');
  await p.reload(); await sleep(1200);
  // activity
  await click('.mi-tab[data-tab=activity]'); await sleep(300);
  const actRows = await p.$$eval('.mi-scans-t tbody tr[data-scan]', a => a.map(r => [r.cells[0].textContent, r.cells[1].textContent]));
  ok(actRows.length === 6 && actRows.some(r => /Scheduled/.test(r[0])) && actRows.some(r => /Item menu/.test(r[0]) && /Sintel/.test(r[1])) && actRows.some(r => /New media/.test(r[0])), 'Activity lists scans, item-menu and new-media entries: ' + actRows.length);
  ok(await p.$eval('.mi-scans-t thead', e => /Type/.test(e.textContent) && /What was checked/.test(e.textContent) && /Ended/.test(e.textContent)), 'Type, label and end columns');
  await p.$eval('.mi-scans-t tbody tr[data-scan="5"]', e => e.click()); await sleep(400);
  ok(await vis('.mi-act-detail') && /Sintel \(2010\)/.test(await txt('.mi-act-detail')) && (await p.$$('.mi-act-detail .mi-act-find tr[data-id]')).length === 1, 'click-through detail with findings');
  await p.$eval('.mi-act-find tr[data-id]', e => e.click()); await sleep(500);
  ok(await p.evaluate(() => __srv.calls.some(c => /^GET Files\/\d+\/History$/.test(c))), 'finding opens the file history');
  await p.keyboard.press('Escape'); await sleep(200);
  ok(await p.$eval('.mi-modal', e => e.classList.contains('mi-on')), 'history dialog open');
  await p.$eval('.mi-dlg-no', e => e.click()); await sleep(200);
  await p.$eval('.mi-act-type', e => { e.value = 'newmedia'; e.dispatchEvent(new Event('change')); }); await sleep(200);
  ok((await p.$$('.mi-scans-t tbody tr[data-scan]')).length === 1, 'type filter: new media (daily rollup = one entry)');
  await p.$eval('.mi-act-type', e => { e.value = ''; e.dispatchEvent(new Event('change')); }); await sleep(200);
  ok(/14,316/.test(await txt('.mi-import-note')), 'import note');
  await shot('activity');
  // settings
  await click('.mi-tab[data-tab=settings]'); await sleep(400);
  ok((await p.$$('.mi-s-lib')).length === 4, 'library checkboxes (incl. audiobooks)');
  await shot('settings');
  await p.$eval('.mi-s-lib', e => e.click());
  await p.$eval('.mi-s-throttle', e => e.value = '80');
  await p.$eval('.mi-settings-form', f => f.requestSubmit()); await sleep(300);
  const sv = await p.evaluate(() => __srv.saved[0]);
  ok(sv && sv.ThrottleMBps === 80 && sv.ExcludedLibraryIds[0] === '101' && sv.ExtraFolders[0] === 'E:\\Archive', 'settings save');
  ok(sv && sv.Exclude.indexOf('*.nfo') >= 0 && sv.Exclude.indexOf('*.srt') < 0, 'default skip list has metadata, not subtitles');
  ok(/Skip = never hashed/.test(await p.$eval('.mi-settings-form', e => e.textContent)), 'skip vs auto-accept explanation shown');
  // restore recommended merges with own patterns
  await p.$eval('.mi-s-exclude', e => e.value = 'MyJunk.dat\n*.nfo');
  await click('.mi-skip-restore'); await sleep(300);
  const exl = await p.$eval('.mi-s-exclude', e => e.value.split('\n').filter(Boolean));
  ok(exl.indexOf('MyJunk.dat') >= 0 && exl.indexOf('*.jpg') >= 0 && exl.filter(x => x === '*.nfo').length === 1, 'restore recommended merges, keeps own patterns, no duplicates');
  ok((await p.$eval('.mi-skip-note', e => e.textContent)).length > 0, 'restore shows a note');
  // >1,000 removal confirm: cancel = not saved, OK = saved
  await p.evaluate(() => { __srv.skipWould = 2500; });
  const nSaved = await p.evaluate(() => __srv.saved.length);
  await p.evaluate(() => { window.__conf = []; window.__confAns = false; window.confirm = (m) => { window.__conf.push(m); return window.__confAns; }; });
  await p.$eval('.mi-settings-form', f => f.requestSubmit()); await sleep(400);
  const dlg = await p.evaluate(() => window.__conf[0] || '');
  ok(/2,500/.test(dlg) && /not touched/.test(dlg), 'confirm above 1,000 removals names the count: ' + dlg);
  ok(await p.evaluate(() => __srv.saved.length) === nSaved, 'cancelled confirm does not save');
  await p.evaluate(() => { window.__confAns = true; });
  await p.$eval('.mi-settings-form', f => f.requestSubmit()); await sleep(400);
  ok(await p.evaluate(() => __srv.saved.length) === nSaved + 1, 'accepted confirm saves');
  ok(await p.evaluate(() => /MyJunk\.dat/.test(__srv.previews[__srv.previews.length - 1])), 'preview gets the new patterns');
  await p.evaluate(() => { __srv.skipWould = 40; window.__conf = []; });
  await p.$eval('.mi-settings-form', f => f.requestSubmit()); await sleep(400);
  ok(await p.evaluate(() => window.__conf.length === 0 && __srv.saved.length) === nSaved + 2, 'no confirm at or below 1,000');  // column resize
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
