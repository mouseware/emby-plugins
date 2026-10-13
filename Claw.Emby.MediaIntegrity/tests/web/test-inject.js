// node test-inject.js [shotDir] — the "..." menu inject (claw-media-integrity.js) against a fake Emby shell. Fake data only.
const puppeteer = require(process.env.PUPPETEER || '/workspace/jstest/node_modules/puppeteer-core');
const path = require('path'), fs = require('fs');
const shots = process.argv[2]; let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('FAIL ' + m); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const font = 'file://' + path.resolve(__dirname, 'mi.woff2');
const html = `<!doctype html><html><head><style>@font-face{font-family:MI;src:url(${font})}.md-icon{font-family:MI;font-style:normal;font-feature-settings:'liga';font-size:1.4em}
body{margin:0;background:#101010;color:#ddd;font-family:Segoe UI,Arial,sans-serif;height:600px}.det{padding:2em}.det h1{margin:.2em 0}.menu{position:absolute;left:22em;top:7em;background:#262626;border-radius:.3em;padding:.4em 0;min-width:15em;box-shadow:0 .3em 1em #000}
.menu div{padding:.55em 1em;display:flex;gap:.7em;align-items:center}.menu div.hl{background:#3a3a3a}</style></head><body>
<div class="det"><h1>Sintel</h1><div style="opacity:.7">2010 · 15 min · Movie</div></div><div class="menu"></div>
<script>
var calls=[], polls=0, shown=[];
window.__registered=null;
window.Emby={importModule:function(p){
  if(/itemmanager/.test(p)) return Promise.resolve({registerCommandSource:function(s){window.__registered=s;}});
  if(/approuter/.test(p)) return Promise.resolve({show:function(u){shown.push(u);return Promise.resolve();}});
  return Promise.reject(new Error('n/a'));}};
window.ApiClient={getUrl:function(p){return p;},serverId:function(){return 's1';},getCurrentUser:function(){return Promise.resolve({Policy:{IsAdministrator:true}});},
  ajax:function(o){calls.push(o.type+' '+o.url);return Promise.resolve({Id:7,Label:'Sintel (2010)',State:'queued',Total:3,Done:0,BytesTotal:5100000000});},
  getJSON:function(u){calls.push('GET '+u);polls++;
    if(window.__mode==='bad') return Promise.resolve({Id:7,Label:'Sintel (2010)',State:polls<2?'running':'done',Total:3,Done:3,Ok:2,Changed:1,Findings:[{FileId:1,Path:'D:\\\\Media\\\\Movies\\\\Sintel (2010)\\\\Sintel (2010).mkv',Result:'changed'}]});
    return Promise.resolve(polls<2?{Id:7,Label:'Sintel (2010)',State:'running',Total:3,Done:1,BytesTotal:5100000000}:{Id:7,Label:'Sintel (2010)',State:'done',Total:3,Done:3,Ok:2,New:1});}};
</script><script src="${'file://' + path.resolve(__dirname, '../../Inject/claw-media-integrity.js')}"></script></body></html>`;
(async () => {
  fs.writeFileSync(path.join(__dirname, 'inject-page.html'), html);
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setViewport({ width: 1100, height: 600 });
  await p.goto('file://' + path.join(__dirname, 'inject-page.html')); await sleep(800);
  ok(await p.evaluate(() => !!window.__registered), 'command source registered');
  const admin = { users: { s1: { Policy: { IsAdministrator: true } } } }, user = { users: { s1: { Policy: { IsAdministrator: false } } } };
  const cmds = (items, o) => p.evaluate((items, o) => window.__registered.getCommands(Object.assign({ items }, o)), items, o);
  for (const t of ['Movie', 'Episode', 'Series', 'Season', 'Folder', 'CollectionFolder', 'MusicAlbum', 'Audio', 'Video', 'BoxSet', 'MusicVideo'])
    ok((await cmds([{ Id: '1', Type: t }], admin)).length === 1, 'menu for ' + t);
  for (const t of ['Person', 'Genre', 'Studio', 'TvChannel', 'UserView'])
    ok((await cmds([{ Id: '1', Type: t }], admin)).length === 0, 'no menu for ' + t);
  ok((await cmds([{ Id: '1', Type: 'Movie' }], user)).length === 0, 'no menu for non-admin');
  ok((await cmds([{ Id: '1', Type: 'Movie' }, { Id: '2', Type: 'Episode' }], admin)).length === 1, 'multi-select');
  ok((await cmds([{ Id: '1', Type: 'Movie', LocationType: 'Virtual' }], admin)).length === 0, 'no menu for virtual (missing) items');
  const c = (await cmds([{ Id: '1', Type: 'Movie' }], admin))[0];
  ok(c.name === 'Verify integrity' && c.icon === 'health_and_safety', 'name + icon');
  await p.evaluate(() => { document.querySelector('.menu').innerHTML = ['Play', 'Edit metadata', 'Verify integrity', 'Generate interval chapters', 'Refresh metadata'].map((n, i) => '<div' + (i === 2 ? ' class="hl"' : '') + '><i class="md-icon">' + ['play_arrow', 'edit', 'health_and_safety', 'bookmarks', 'refresh'][i] + '</i>' + n + '</div>').join(''); });
  await sleep(300); if (shots) await p.screenshot({ path: path.join(shots, 'mediaintegrity-item-menu.png') });
  await p.evaluate(() => { document.querySelector('.menu').innerHTML = ''; document.querySelector('.menu').style.display = 'none'; });
  const res = p.evaluate(() => window.__registered.executeCommand('claw-mi-verify', [{ Id: '42', Type: 'Movie' }]));
  await sleep(300);
  ok(/Checking Sintel/.test(await p.$eval('.claw-mi-toast', e => e.textContent)), 'progress toast');
  const r = await res;
  ok(r && r.job && r.job.State === 'done', 'job polled to done');
  ok(await p.evaluate(() => calls[0] === 'POST ClawMediaIntegrity/Check/Items?Ids=42'), 'posts item id');
  const t = await p.$eval('.claw-mi-toast', e => e.textContent);
  ok(/Integrity OK: Sintel/.test(t) && /2 OK · 1 new/.test(t), 'result toast: ' + t);
  if (shots) await p.screenshot({ path: path.join(shots, 'mediaintegrity-item-toast-ok.png') });
  await p.$eval('.claw-mi-open', e => e.click()); await sleep(200);
  ok(await p.evaluate(() => shown[0] === 'configurationpage?name=ClawMediaIntegrity'), 'link opens plugin page');
  ok(!(await p.$('.claw-mi-toast')), 'toast closes on link');
  await p.evaluate(() => { window.__mode = 'bad'; polls = 0; });
  await p.evaluate(() => window.__registered.executeCommand('claw-mi-verify', [{ Id: '42', Type: 'Movie' }]));
  const t2 = await p.$eval('.claw-mi-toast', e => e.textContent);
  ok(/1 problem/.test(t2) && /1 CHANGED/.test(t2) && /changed: Sintel \(2010\)\.mkv/.test(t2), 'problem toast: ' + t2);
  if (shots) await p.screenshot({ path: path.join(shots, 'mediaintegrity-item-toast-changed.png') });
  const s = await p.evaluate(() => [window.__clawMediaIntegrity.summarize({ State: 'done', Total: 0, Label: 'X' }).kind, window.__clawMediaIntegrity.summarize({ State: 'cancelled', Total: 5, Done: 2 }).text]);
  ok(s[0] === 'warn' && /cancelled after 2 of 5/.test(s[1]), 'summarize edge cases');
  const iw = await p.$eval('.claw-mi-toast .md-icon', e => e.getBoundingClientRect().width);
  ok(iw > 10 && iw < 40, 'toast icon glyph renders (' + iw + ')');
  ok(errs.length === 0, 'no page errors ' + errs.join(';'));
  fs.unlinkSync(path.join(__dirname, 'inject-page.html'));
  console.log(pass + ' passed, ' + fail + ' failed'); await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH', e); process.exit(2); });
