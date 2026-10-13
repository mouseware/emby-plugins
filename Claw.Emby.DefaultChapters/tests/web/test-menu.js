/* Offline test of the item "..." menu inject (Inject/claw-default-chapters.js) against mock-emby.js.
 * Run: node test-menu.js [--shots]   (needs puppeteer-core + Chrome; see README) */
const path = require('path');
const fs = require('fs');
const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const root = path.resolve(__dirname, '..', '..');
const injectSrc = fs.readFileSync(path.join(root, 'Inject', 'claw-default-chapters.js'), 'utf8').replace(/__PLUGIN_VERSION__/g, '1.0.0.0');
const mockSrc = fs.readFileSync(path.join(__dirname, 'mock-emby.js'), 'utf8');
const shots = process.argv.includes('--shots');

let pass = 0, fail = 0; const failures = [];
function check(cond, name) { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; failures.push(name); console.log('  FAIL ' + name); } }

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('pageerror', e => { fail++; failures.push('page error: ' + e.message); console.log('  PAGE ERROR', e.message); });
  await page.setViewport({ width: 1280, height: 760 });
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  await page.addScriptTag({ content: mockSrc });
  await page.addScriptTag({ content: injectSrc });

  const ours = (item, user, multi) => page.evaluate((item, user, multi) => {
    const o = multi ? { items: [item, item] } : { items: [item] };
    if (user) o.user = user;
    return window.__itemmanager.getCommands(o).filter(c => /^claw-dc-/.test(c.id)).map(c => c.id + ':' + c.name);
  }, item, user || null, !!multi);
  const exec = (id, item) => page.evaluate((id, item) => window.__itemmanager.executeCommand(id, [item], {}).then(r => r, e => ({ rejected: String(e) })), id, item);
  const log = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__log)));
  const resetLog = () => page.evaluate(() => { const l = window.__log; l.requests.length = 0; l.confirms.length = 0; l.alerts.length = 0; l.toasts.length = 0; l.refreshes = 0; });
  const settle = () => page.evaluate(() => new Promise(r => setTimeout(r, 60)));
  const movie = id => ({ Id: id, Type: 'Movie', Name: 'x' });
  const admin = { Policy: { IsAdministrator: true } }, kid = { Policy: { IsAdministrator: false } };

  console.log('Boot');
  check(await page.evaluate(() => !!window.__clawDefaultChapters && window.__itemmanager._sources.length === 0), 'script waits for the Emby app (not registered yet)');
  await page.evaluate(() => { window.__server.addOverride('103', { after: 30 }); setTimeout(window.__installEmby, 700); });
  await page.waitForFunction(() => window.__itemmanager._sources.length === 1, { timeout: 5000 });
  await page.waitForFunction(() => window.__clawDefaultChapters.state.loadedAt > 0, { timeout: 5000 });
  check(true, 'registered exactly one itemmanager command source once Emby appeared');
  check(await page.evaluate(() => window.__clawDefaultChapters.version) === '1.0.0.0', 'version stamped by the server');

  console.log('Menu entries');
  check(JSON.stringify(await ours(movie('101'), admin)) === JSON.stringify(['claw-dc-generate:Generate interval chapters']), 'admin, movie without stash: Generate only');
  check(JSON.stringify(await ours(movie('103'), admin)) === JSON.stringify(['claw-dc-generate:Generate interval chapters', 'claw-dc-restore:Restore original chapters']), 'movie with stash: Generate + Restore');
  check((await ours(movie('101'))).length === 1, 'no user in options: falls back to cached current user (admin)');
  check((await ours(movie('103'), kid)).length === 0, 'non-admin user: no entries');
  check((await ours({ Id: '201', Type: 'Episode' }, admin)).length === 0, 'episode: no entries');
  check((await ours({ Id: '5', Type: 'Series' }, admin)).length === 0, 'series: no entries');
  check((await ours({ Id: '6', Type: 'Video' }, admin)).length === 0, 'home video: no entries');
  check((await ours({ Id: '7', Type: 'Movie', ExtraType: 'Trailer' }, admin)).length === 0, 'movie extra: no entries');
  check((await ours({ Id: '8', Type: 'TvChannel' }, admin)).length === 0, 'live TV: no entries');
  check((await ours(movie('101'), admin, true)).length === 0, 'multi-selection: no entries');
  const all = await page.evaluate(() => window.__itemmanager.getCommands({ items: [{ Id: '103', Type: 'Movie' }], user: { Policy: { IsAdministrator: true } } }).map(c => c.id));
  check(all.indexOf('refresh') >= 0 && all.indexOf('claw-dc-generate') > all.indexOf('refresh'), "Emby's own entries untouched, ours appended");

  console.log('Generate without confirm');
  await resetLog();
  let r = await exec('claw-dc-generate', movie('101'));
  let L = await log();
  check(r && r.updated === true, 'generate resolved as updated');
  check(L.confirms.length === 0, 'no confirm for a movie with real chapters and no override');
  check(JSON.stringify(L.requests) === JSON.stringify(['GET DefaultChapters/Items/101/Status', 'POST DefaultChapters/Items/101/Generate?Confirmed=false']), 'status then POST Generate (Confirmed=false)');
  check(L.toasts.length === 1 && /25 chapters, every 5 min/.test(L.toasts[0]), 'toast reports the new chapter count');
  await settle();
  check((await log()).refreshes === 1, 'item page refreshed via appRouter.refreshCurrentView');
  check((await ours(movie('101'), admin)).length === 2, 'Restore now offered for that movie');

  console.log('Confirm path');
  await resetLog();
  await page.evaluate(() => { window.__confirmAnswer.value = false; });
  r = await exec('claw-dc-generate', movie('102'));
  L = await log();
  check(L.confirms.length === 1 && /5-minute interval set/.test(L.confirms[0].text), "Emby's confirm dialog shown with the server's reason (interval-looking set)");
  check(L.confirms[0].confirmText === 'Replace' && L.confirms[0].primary === 'cancel', 'confirm uses "Replace" with Cancel as the safe default');
  check(r && r.cancelled === true && L.requests.length === 1 && L.requests[0] === 'GET DefaultChapters/Items/102/Status', 'cancel: no POST sent');
  check(L.toasts.length === 0, 'cancel: no toast');
  await resetLog();
  await page.evaluate(() => { window.__confirmAnswer.value = true; });
  r = await exec('claw-dc-generate', movie('102'));
  L = await log();
  check(L.confirms.length === 1 && L.requests[1] === 'POST DefaultChapters/Items/102/Generate?Confirmed=true', 'accept: POST Generate with Confirmed=true');
  check(r && r.updated === true, 'accept: updated');
  await resetLog();
  r = await exec('claw-dc-generate', movie('101'));
  L = await log();
  check(L.confirms.length === 1 && /already has interval chapters/.test(L.confirms[0].text), 'existing override: confirm shown');
  await resetLog();
  await page.evaluate(() => { window.__server.items['103'].chapters = 9; delete window.__server.overrides['103']; window.__server.forceConfirmOnPost = true; });
  r = await exec('claw-dc-generate', movie('103'));
  L = await log();
  check(JSON.stringify(L.requests) === JSON.stringify(['GET DefaultChapters/Items/103/Status', 'POST DefaultChapters/Items/103/Generate?Confirmed=false', 'POST DefaultChapters/Items/103/Generate?Confirmed=true']) && L.confirms.length === 1, 'server asks for confirm after the status call: confirm, then retry with Confirmed=true');

  console.log('Restore');
  await resetLog();
  r = await exec('claw-dc-restore', movie('101'));
  L = await log();
  check(r && r.updated === true && L.requests[0] === 'POST DefaultChapters/Items/101/Restore', 'POST Restore');
  check(/Original chapters restored \(7\)/.test(L.toasts[0] || ''), 'toast reports restored count');
  check((await ours(movie('101'), admin)).length === 1, 'Restore entry gone afterwards');
  await settle();

  console.log('Errors and non-movies');
  await resetLog();
  r = await exec('claw-dc-generate', { Id: '301', Type: 'Movie' });
  L = await log();
  check(L.alerts.length === 1 && /only available for movies/.test(L.alerts[0].text) && L.requests.length === 1, 'server says not eligible (e.g. a recording): alert, no POST');
  await resetLog();
  await page.evaluate(() => { window.__server.failNext = null; });
  await page.evaluate(() => { const s = window.__server; const orig = s.items['101']; s.items['101'] = orig; });
  await page.evaluate(() => { window.__server.failNext = { status: 400, text: 'This movie has no known runtime or is shorter than one 5-minute interval.' }; });
  r = await exec('claw-dc-generate', movie('101'));
  L = await log();
  check(L.alerts.length === 1 && /shorter than one 5-minute interval/.test(L.alerts[0].text) && L.alerts[0].title === 'Could not generate chapters', 'server error text shown in an alert');
  check(r && r.error, 'error resolved (menu does not throw)');
  r = await exec('claw-dc-restore', movie('102'));
  check(r && r.updated, 'restore second movie');
  await resetLog();
  r = await exec('claw-dc-restore', movie('102'));
  check(r && r.rejected === 'nocommands', 'Restore not offered once the stash is gone (itemmanager finds no source)');

  if (shots) {
    // Preview: Emby-like action sheet for a movie with a stash, then the confirm dialog.
    await page.evaluate(() => window.__server.addOverride('101', { after: 35 }));
    await page.evaluate(() => window.__clawDefaultChapters.reload());
    const cmds = await page.evaluate(() => window.__itemmanager.getCommands({ items: [{ Id: '101', Type: 'Movie' }], user: { Policy: { IsAdministrator: true } } }));
    await page.setContent(fs.readFileSync(path.join(__dirname, 'menu-preview.html'), 'utf8'));
    await page.evaluate(cmds => window.renderSheet(cmds), cmds);
    await page.evaluate(() => document.fonts.ready);
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: process.env.MENU_SHOT || '/workspace/default-chapters-menu.png' });
    await page.evaluate(() => window.renderConfirm("This movie's 24 chapters already look like a 5-minute interval set. Replace them with a 5-minute set anyway?"));
    await page.screenshot({ path: process.env.CONFIRM_SHOT || '/workspace/default-chapters-confirm.png' });
    console.log('  screenshots written');
  }

  await browser.close();
  console.log('\nPassed ' + pass + ', failed ' + fail);
  failures.forEach(f => console.log('  failed: ' + f));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
