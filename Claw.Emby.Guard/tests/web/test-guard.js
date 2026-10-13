const puppeteer = require('/workspace/jstest/node_modules/puppeteer-core');
const path = require('path');
require('./build-page.js');
const URL = 'file://' + path.resolve(__dirname, 'guard-page.html');
let fails = 0, passes = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? passes++ : fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS !== '0';
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setViewport({ width: 1500, height: 900 });
  await p.goto(URL); await p.evaluate(() => document.fonts.ready); await sleep(300);
  const rows = () => p.$$eval('.cg-live-t tbody tr', t => t.map(r => [...r.cells].map(c => c.textContent.trim())));
  const head = (s) => p.$$eval(s + ' thead th', t => t.map(h => h.textContent.replace(/[▲▼]/g, '').trim()));

  // ---- live log ----
  let r = await rows();
  ok(r.length === 9, 'live log shows all events (' + r.length + ')');
  ok((await head('.cg-live-t')).join('|') === '|Time|IP|Username|Event|Client / request|Fails|Status', 'no Country column without MaxMind key');
  ok(r[0][2] === '198.51.100.23' && r[0][4] === 'API 403', 'newest first');
  ok(await p.$eval('.cg-c-failed', e => e.textContent) === '4' && await p.$eval('.cg-c-api', e => e.textContent) === '2', 'summary cards');
  ok(await p.$eval('.cg-c-state', e => e.textContent) === 'On', 'enforcement card');
  ok(await p.$eval('.cg-bans-count', e => e.textContent) === '3', 'Bans tab badge');
  const ghost = r.find(x => x[2] === '2a02:4780:1:2::99'); ok(ghost && /no such user/.test(ghost[3]), 'nonexistent user tagged');
  const iconW = await p.$$eval('.cg-live-t td.cg-ic .md-icon', a => a.map(i => i.getBoundingClientRect().width));
  ok(iconW.every(w => w > 0 && w < 30), 'icons render as glyphs');
  if (SHOTS) await p.screenshot({ path: '/workspace/guard-live.png' });
  // filter
  await p.type('.cg-filter', 'javid'); await sleep(50); r = await rows();
  ok(r.length === 1 && r[0][3].startsWith('javid'), 'text filter');
  await p.$eval('.cg-filter', e => { e.value = ''; e.dispatchEvent(new Event('input')); });
  await p.select('.cg-kind', 'api'); await sleep(50); r = await rows();
  ok(r.length === 2 && r.every(x => /API/.test(x[4])), 'event-type filter');
  await p.select('.cg-kind', ''); await sleep(50);
  // sort
  await p.click('.cg-live-t th[data-sort="ip"]'); await sleep(50); r = await rows();
  const ips = r.map(x => x[2]); ok(JSON.stringify(ips) === JSON.stringify(ips.slice().sort()), 'sort by IP');
  await p.click('.cg-live-t th[data-sort="time"]'); await sleep(50);
  // row menu
  const clickRow = async (ip, u) => { const h = await p.evaluateHandle((ip, u) => [...document.querySelectorAll('.cg-live-t tbody tr')].find(tr => tr.cells[2].textContent.trim() === ip && (!u || tr.cells[3].textContent.indexOf(u) === 0)), ip, u || ''); await h.asElement().click(); await sleep(80); };
  await clickRow('192.168.1.40');
  let menu = await p.$$eval('.cg-menu button', a => a.map(x => [x.textContent.trim(), x.disabled]));
  ok(menu.filter(x => /^.*Ban/.test(x[0])).every(x => x[1]) && /LAN/.test(await p.$eval('.cg-menu .cg-mh', e => e.textContent)), 'LAN row: ban actions disabled');
  await clickRow('45.148.10.92');
  menu = await p.$$eval('.cg-menu button', a => a.map(x => x.textContent.trim()));
  ok(menu.some(x => /Ban 1 hour/.test(x)) && menu.some(x => /Ban 1 day/.test(x)) && menu.some(x => /Ban 30 days/.test(x)) && menu.some(x => /Ban permanently/.test(x)) &&
     menu.some(x => /Whitelist this IP/.test(x)) && menu.some(x => /Watch username.*javid/.test(x)) && menu.some(x => /Show only this IP/.test(x)), 'row menu has all actions');
  if (SHOTS) await p.screenshot({ path: '/workspace/guard-live-menu.png' });
  // ban 1 day from row
  const menuClick = async re => { const h = await p.evaluateHandle(re => [...document.querySelectorAll('.cg-menu button')].find(x => new RegExp(re).test(x.textContent)), re); await h.asElement().click(); await sleep(80); };
  await menuClick('Ban 1 day');
  ok(await p.$eval('.cg-modal', e => e.classList.contains('cg-on')) && /1 day/.test(await p.$eval('.cg-dlg-body', e => e.textContent)), 'confirm dialog before ban');
  await p.click('.cg-dlg-yes'); await sleep(200);
  let srv = await p.evaluate(() => __srv.bans.map(b => b.Key));
  ok(srv.includes('45.148.10.92'), 'ban posted');
  r = await rows(); ok(r.some(x => x[2] === '45.148.10.92' && x[4] === 'Banned'), 'ban appears in live log');
  // own address
  await clickRow('73.124.221.68'); ok(/this is you/.test(await p.$eval('.cg-menu .cg-mh', e => e.textContent)), 'menu marks your own address');
  await menuClick('Ban 1 hour'); await p.click('.cg-dlg-yes'); await sleep(200);
  ok(/your own address/i.test(await p.$eval('.cg-dlg-title', e => e.textContent)) && await p.$eval('.cg-modal', e => e.classList.contains('cg-on')), 'own address: second explicit confirm');
  ok(!(await p.evaluate(() => __srv.bans.some(b => b.Key === '73.124.221.68'))), 'not banned before the extra confirm');
  await p.click('.cg-dlg-no'); await sleep(100);
  ok(!(await p.evaluate(() => __srv.bans.some(b => b.Key === '73.124.221.68'))), 'cancel keeps you unbanned');
  // watch username
  await clickRow('45.148.10.92', 'javid'); await menuClick('Watch username'); await p.click('.cg-dlg-yes'); await sleep(150);
  ok(await p.evaluate(() => __srv.cfg.InstantBanUsernames.includes('javid')), 'watch username -> instant list');
  // show only this IP
  await clickRow('185.220.101.34'); await menuClick('Show only this IP'); r = await rows();
  ok(r.length === 2 && r.every(x => x[2] === '185.220.101.34'), 'show only this IP');
  await p.click('.cg-clear-ip'); await sleep(50);
  // whitelist from row
  await clickRow('198.51.100.23'); await menuClick('Whitelist this IP'); await p.click('.cg-dlg-yes'); await sleep(150);
  ok(await p.evaluate(() => __srv.cfg.Whitelist.some(w => w.Cidr === '198.51.100.23')), 'whitelist from row');
  // live polling
  await p.evaluate(() => __srv.push({ Time: new Date().toISOString(), Kind: 'signin-failed', Ip: '203.0.113.200', Key: '203.0.113.200', Username: 'admin', UserExists: false, Client: 'curl', Count: 1 }));
  await sleep(4600); r = await rows();
  ok(r[0][2] === '203.0.113.200', 'new event arrives by polling (4 s)');
  await p.click('.cg-pause'); await p.evaluate(() => __srv.push({ Time: new Date().toISOString(), Kind: 'api-401', Ip: '203.0.113.201', Key: '203.0.113.201', Request: 'GET /x', Count: 1 }));
  await sleep(4600); r = await rows(); ok(r[0][2] !== '203.0.113.201', 'pause stops polling');
  await p.click('.cg-pause'); await sleep(300); r = await rows(); ok(r[0][2] === '203.0.113.201', 'unpause catches up');

  // ---- import from Emby logs ----
  await p.click('.cg-import'); await sleep(80);
  ok(/Import from Emby logs/.test(await p.$eval('.cg-dlg-title', e => e.textContent)) && /rotated/.test(await p.$eval('.cg-dlg-body', e => e.textContent)), 'import asks first, explains files');
  await p.click('.cg-dlg-yes'); await sleep(400);
  ok(/Import finished/.test(await p.$eval('.cg-dlg-title', e => e.textContent)) && await p.$eval('.cg-imp-n', e => e.textContent) === '537', 'import shows imported count (537)');
  const impBody = await p.$eval('.cg-dlg-body', e => e.textContent);
  ok(/Bans created by the rules4 \(1 still active\)/.test(impBody) && /never banned\)402/.test(impBody), 'import result breakdown');
  if (SHOTS) await p.screenshot({ path: '/workspace/guard-import.png' });
  await p.click('.cg-dlg-yes'); await sleep(200);
  ok(await p.$eval('.cg-range', e => e.value) === '168', 'range widened to 7 days to show imported items');
  ok((await p.$$eval('.cg-live-t tbody tr', t => t.filter(r => /imported/.test(r.textContent)).length)) >= 4, 'imported rows tagged "imported"');
  ok(/537 imported/.test(await p.$eval('.cg-import-last', e => e.textContent)), 'last-import summary in toolbar');
  await p.click('.cg-import'); await sleep(50); await p.click('.cg-dlg-yes'); await sleep(300);
  ok(await p.$eval('.cg-imp-n', e => e.textContent) === '0' && /already in Guard.s log543/.test(await p.$eval('.cg-dlg-body', e => e.textContent)), 'second import: 0 new, 543 skipped');
  await p.click('.cg-dlg-yes'); await sleep(100);
  // ---- bans ----
  await p.click('.cg-tab[data-tab="bans"]'); await sleep(200);
  const brows = () => p.$$eval('.cg-bans-t tbody tr', t => t.map(r => [...r.cells].map(c => c.textContent.trim())));
  let br = await brows();
  ok(br.length === 4, 'active bans listed (' + br.length + ')');
  ok(br.some(x => x[0] === '103.77.20.0/24' && /permanent/.test(x[4])), 'CIDR + permanent shown');
  if (SHOTS) await p.screenshot({ path: '/workspace/guard-bans.png' });
  const banBtn = async (key, act) => { const h = await p.evaluateHandle((k, a) => document.querySelector('.cg-bans-t tr[data-key="' + k + '"] button[data-act="' + a + '"]'), key, act); await h.asElement().click(); await sleep(120); };
  const before = await p.evaluate(() => __srv.bans.find(b => b.Key === '45.155.205.233').Expires);
  await banBtn('45.155.205.233', 'extend'); await sleep(150);
  const after = await p.evaluate(() => __srv.bans.find(b => b.Key === '45.155.205.233').Expires);
  ok(new Date(after) - new Date(before) === 864e5, 'extend +1 day');
  await banBtn('45.155.205.233', 'perm'); await p.click('.cg-dlg-yes'); await sleep(200);
  ok(await p.evaluate(() => __srv.bans.find(b => b.Key === '45.155.205.233').Expires === null), 'make permanent');
  await banBtn('185.220.101.34', 'unban'); await p.click('.cg-dlg-yes'); await sleep(200);
  br = await brows(); ok(!br.some(x => x[0] === '185.220.101.34'), 'unban removes row');
  ok(await p.$$eval('.cg-hist-t tbody tr', t => t.some(r => /185.220.101.34/.test(r.textContent))), 'unbanned goes to history');
  await p.type('.cg-ban-ip', '192.168.1.9'); await p.click('.cg-ban-add'); await sleep(80); await p.click('.cg-dlg-yes'); await sleep(200);
  ok(/LAN/.test(await p.$eval('.cg-dlg-body', e => e.textContent)), 'manual LAN ban refused with explanation');
  await p.click('.cg-dlg-yes'); await sleep(80);
  await p.$eval('.cg-ban-ip', e => e.value = ''); await p.type('.cg-ban-ip', 'not-an-ip'); await p.click('.cg-ban-add'); await sleep(80);
  ok(await p.$eval('.cg-ban-err', e => e.classList.contains('cg-on')), 'invalid IP rejected client-side');
  await p.$eval('.cg-ban-ip', e => e.value = ''); await p.type('.cg-ban-ip', '2001:db8:9::/48'); await p.select('.cg-ban-dur', '0'); await p.click('.cg-ban-add'); await sleep(80); await p.click('.cg-dlg-yes'); await sleep(200);
  ok(await p.evaluate(() => __srv.bans.some(b => b.Key === '2001:db8:9::/48' && b.Expires === null)), 'manual permanent IPv6 range ban');
  await p.click('.cg-bans-t th[data-sort="hits"]'); await sleep(50); br = await brows();
  const hits = br.map(x => +x[5]); ok(JSON.stringify(hits) === JSON.stringify(hits.slice().sort((a, b) => a - b)), 'bans sortable');

  // ---- rules ----
  await p.click('.cg-tab[data-tab="rules"]'); await sleep(100);
  ok(await p.$eval('#cgSigninN', e => e.value) === '5' && await p.$eval('#cgSigninW', e => e.value) === '10' && await p.$eval('#cgUnknownN', e => e.value) === '2', 'rules defaults 5 / 10 min / 2');
  const steps = () => p.$$eval('.cg-steps-body tr', t => t.map(r => (r.querySelector('.cg-step-u').value === '0' ? 'perm' : r.querySelector('.cg-step-n').value + 'x' + r.querySelector('.cg-step-u').value)));
  ok(JSON.stringify(await steps()) === JSON.stringify(['1x60', '1x1440', '30x1440', 'perm']), 'escalation 1h, 1d, 30d, permanent');
  ok((await p.$eval('#cgInstant', e => e.value)).split('\n').includes('administrator'), 'instant usernames listed');
  if (SHOTS) { await p.setViewport({ width: 1500, height: 1250 }); await p.screenshot({ path: '/workspace/guard-rules.png' }); await p.setViewport({ width: 1500, height: 900 }); }
  // edit: threshold 3, change step 2 to 12 hours, remove 30d, save
  await p.$eval('#cgSigninN', e => e.value = '3');
  await p.evaluate(() => { const tr = document.querySelectorAll('.cg-steps-body tr')[1]; tr.querySelector('.cg-step-n').value = '12'; tr.querySelector('.cg-step-u').value = '60'; });
  await p.evaluate(() => document.querySelectorAll('.cg-steps-body tr')[2].querySelector('.cg-step-del').click());
  await p.$eval('#cgInstant', e => e.value = 'root\nadmin, oracle');
  await p.$eval('.cg-rules-form', f => f.requestSubmit()); await sleep(200);
  let cfg = await p.evaluate(() => __srv.cfg);
  ok(cfg.SigninFailThreshold === 3 && JSON.stringify(cfg.EscalationMinutes) === JSON.stringify([60, 720, 0]) && JSON.stringify(cfg.InstantBanUsernames) === JSON.stringify(['root', 'admin', 'oracle']), 'rules saved: threshold, steps, usernames');
  ok(cfg.BanUnknownUsersInstantly === false && !(await p.$eval('#cgUnknownInstant', e => e.checked)), "'Ban non-existent usernames instantly' present, default off");
  await p.click('#cgUnknownInstant'); await p.$eval('.cg-rules-form', f => f.requestSubmit()); await sleep(200);
  ok((await p.evaluate(() => __srv.cfg.BanUnknownUsersInstantly)) === true && (await p.evaluate(() => __srv.cfg.UnknownUserFailThreshold)) === 2, 'instant non-existent toggle saved; tries setting unchanged');
  // permanent must be last
  await p.click('.cg-step-add'); await sleep(50);
  await p.evaluate(() => { const rows = document.querySelectorAll('.cg-steps-body tr'); rows[rows.length - 1].querySelector('.cg-step-u').value = '1440'; });
  await p.$eval('.cg-rules-form', f => f.requestSubmit()); await sleep(100);
  ok(await p.$eval('.cg-rules-err', e => e.classList.contains('cg-on') && /last/.test(e.textContent)), 'permanent must be the last step');

  // ---- whitelist ----
  await p.click('.cg-tab[data-tab="whitelist"]'); await sleep(100);
  ok(/never filtered by Emby/.test(await p.$eval('[data-panel="whitelist"] .cg-note', e => e.textContent)), 'LAN informational note');
  await p.type('.cg-wl-cidr', '203.0.113.0/24'); await p.type('.cg-wl-note', 'office'); await p.click('.cg-wl-add'); await sleep(50);
  await p.type('.cg-wl-cidr', 'bogus'); await p.click('.cg-wl-add'); await sleep(50);
  ok(await p.$eval('.cg-wl-err', e => e.classList.contains('cg-on')), 'invalid whitelist entry rejected');
  await p.click('.cg-wl-mine'); await sleep(50);
  await p.click('.cg-wl-save'); await sleep(200);
  cfg = await p.evaluate(() => __srv.cfg);
  ok(cfg.Whitelist.some(w => w.Cidr === '203.0.113.0/24' && w.Note === 'office') && cfg.Whitelist.some(w => w.Cidr === '73.124.221.68'), 'whitelist saved (incl. my IP on request)');
  ok(await p.$eval('.cg-wl-count', e => e.textContent) === String(cfg.Whitelist.length), 'whitelist badge');

  // ---- settings ----
  await p.click('.cg-tab[data-tab="settings"]'); await sleep(100);
  ok(/Forever/.test(await p.$eval('.cg-retention', e => e.textContent)) && /3 days/.test(await p.$eval('.cg-retention', e => e.textContent)), 'retention shown');
  ok(/managed by Guard/.test(await p.$eval('.cg-filter-note', e => e.textContent)), 'filter status explained');
  await p.type('#cgMmId', '123456'); await p.type('#cgMmKey', 'abc_def');
  await p.$eval('.cg-settings-form', f => f.requestSubmit()); await sleep(200);
  cfg = await p.evaluate(() => __srv.cfg); ok(cfg.MaxMindAccountId === '123456' && cfg.MaxMindLicenseKey === 'abc_def', 'MaxMind credentials saved');
  // master off asks
  await p.click('#cgEnabled'); await p.$eval('.cg-settings-form', f => f.requestSubmit()); await sleep(100);
  ok(/Switch Guard off/.test(await p.$eval('.cg-dlg-title', e => e.textContent)), 'master off asks for confirmation');
  await p.click('.cg-dlg-yes'); await sleep(200);
  ok((await p.evaluate(() => __srv.cfg.Enabled)) === false, 'master off saved');
  // country column when enabled
  await p.evaluate(() => { __srv.country = true; __srv.cfg.Enabled = true; });
  await p.click('.cg-tab[data-tab="live"]');
  await p.evaluate(() => document.getElementById('clawGuardPage').dispatchEvent(new CustomEvent('viewshow'))); await sleep(400);
  ok((await head('.cg-live-t')).includes('Country') && (await rows()).some(x => x[3] === 'NL'), 'Country column appears with GeoLite DB');
  if (SHOTS) await p.screenshot({ path: '/workspace/guard-live-country.png' });
  // conflict state
  await p.evaluate(() => { __srv.filterState = 'conflict-whitelist'; }); await p.evaluate(() => document.getElementById('clawGuardPage').dispatchEvent(new CustomEvent('viewshow'))); await sleep(300);
  ok(await p.$eval('.cg-c-state', e => e.textContent) === 'Not enforcing', 'allow-list conflict surfaced');

  await p.click('.cg-tab[data-tab="live"]'); await sleep(200);
  // ---- column resize ----
  const colW = (sel, i) => p.$eval(sel, (t, i) => t.tHead.rows[0].cells[i].getBoundingClientRect().width, i);
  const dragCol = async (sel, i, dx) => {
    const box = await p.$eval(sel, (t, i) => { const r = t.tHead.rows[0].cells[i].querySelector('.cr-h').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, i);
    await p.mouse.move(box.x, box.y); await p.mouse.down(); await p.mouse.move(box.x + dx / 2, box.y, { steps: 4 }); await p.mouse.move(box.x + dx, box.y, { steps: 4 }); await p.mouse.up(); await sleep(80);
  };
  ok(await p.$$eval('.cg-live-t thead th', a => a.every(th => th.querySelector('.cr-h'))), 'resize handles on every live-log header');
  const sortBefore = await p.evaluate(() => __View && document.querySelector('.cg-live-t th[data-sort=ip]').textContent);
  const w0 = await colW('.cg-live-t', 6);
  await dragCol('.cg-live-t', 6, 140);
  const w1 = await colW('.cg-live-t', 6);
  ok(Math.abs(w1 - w0 - 140) <= 3, `drag widens Client column by 140px (${Math.round(w0)} -> ${Math.round(w1)})`);
  ok(await p.$eval('.cg-live-t th[data-sort=ip]', e => e.textContent) === sortBefore, 'dragging a handle does not sort');
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('claw.guard.cols.live')));
  ok(stored && Math.abs(stored.client - w1) <= 2, 'width saved per table in localStorage (claw.guard.cols.live)');
  await p.evaluate(() => __srv.push({ Time: new Date().toISOString(), Kind: 'api-401', Ip: '203.0.113.9', Key: '203.0.113.9', Request: 'GET /y', Count: 1 }));
  await p.click('.cg-live-t th[data-sort="time"]'); await sleep(100); await p.click('.cg-live-t th[data-sort="time"]'); await sleep(100);
  ok(Math.abs(await colW('.cg-live-t', 6) - w1) <= 2 && await p.$$eval('.cg-live-t thead th', a => a.every(th => th.querySelector('.cr-h'))), 'width + handles survive header re-render (sort)');
  await dragCol('.cg-live-t', 3, -400);
  ok(await colW('.cg-live-t', 3) >= 27, 'minimum column width enforced');
  if (SHOTS) await p.screenshot({ path: '/workspace/guard-resize.png' });
  await p.reload(); await p.evaluate(() => document.fonts.ready); await sleep(500);
  ok(Math.abs(await p.$eval('.cg-live-t th[data-sort=client]', e => e.getBoundingClientRect().width) - w1) <= 2, 'width restored after page reload (by column id, even without the Country column)');
  await p.$eval('.cg-live-t th[data-sort=client] .cr-h', h => h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await sleep(80);
  ok(!(await p.evaluate(() => localStorage.getItem('claw.guard.cols.live'))) && !(await p.$eval('.cg-live-t', t => t.classList.contains('cr-fixed'))), 'double-click resets the table to automatic widths');
  ok(await p.$$eval('table.cg-bans-t thead th, table.cg-hist-t thead th, table.cg-wl-t thead th', a => a.length > 0 && a.every(th => th.querySelector('.cr-h'))), 'handles on Bans, History and Whitelist tables');

  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close();
  console.log(passes + ' passed, ' + fails + ' failed'); process.exit(fails ? 1 : 0);
})();
