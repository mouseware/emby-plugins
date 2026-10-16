// IPTV Channel Mapper: General tab, Export (.zip) and Import preview/apply against a mock with a stored config (fake data only).
// node test-iptv-io.js   (env: PUPPETEER, CHROME, SHOTDIR, JSZIP = path to the jszip module)
const puppeteer = require(process.env.PUPPETEER || '/workspace/jstest/node_modules/puppeteer-core');
const JSZip = require(process.env.JSZIP || '/workspace/jstest/node_modules/jszip');
const fs = require('fs'), path = require('path'), os = require('os');
const W = path.resolve(__dirname, '../../Web');
const SHOT = process.env.SHOTDIR || __dirname;
let fails = 0, passes = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? passes++ : fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const names = ['WABC-HD', 'WCBS 2', 'WNBC 4', 'FOX 5 NY', 'WPIX 11', 'PBS Thirteen', 'ESPN', 'ESPN2', 'CNN', 'MSNBC', 'HGTV', 'Food Network', 'Discovery', 'History'];
function pageHtml(cfg) {
  const mock = `
window.__items = ${JSON.stringify(names.map((n, i) => ({ Id: 'c' + i, ManagementId: 'm3u1_' + i, Name: n, ChannelNumber: String(i + 2), TunerName: 'IPTV (Xtream)', Disabled: i === 9, SortIndexNumber: i, ImageTags: i === 1 ? { Primary: 'tagc1' } : {} })))};
window.__serverRows = ${JSON.stringify(names.map((n, i) => ({ Key: 'm3u1|tvg:' + n.toLowerCase().replace(/[^a-z0-9]+/g, '') + '.us', ManagementId: 'm3u1_' + i, ItemId: 'c' + i, TunerHostId: 'm3u1', TunerName: 'IPTV (Xtream)', TvgId: n.toLowerCase().replace(/[^a-z0-9]+/g, '') + '.us', M3uName: n, M3uNumber: String(i + 2), M3uGroup: i < 6 ? 'Local' : (i < 8 ? 'Sports' : 'News & Lifestyle'), M3uLogoUrl: 'https://logos.example.invalid/m3u/' + i + '.png', Name: i === 0 ? 'ABC 7 New York' : n, ChannelNumber: i === 0 ? '7' : String(i + 2), InLibrary: i !== 9, LockedFields: i === 0 ? ['Name'] : [], ListingsProviderId: i === 6 ? 'xmltv1' : null, ListingsChannelId: i === 6 ? 'espn.us' : null })))};
window.__cfg = ${JSON.stringify(cfg || {})}; window.__saved = []; window.__toasts = []; window.__conf = []; window.__confAns = false; window.__ajax = [];
window.confirm = function (m) { window.__conf.push(m); return window.__confAns; };
function logoPng(text, color) { var c = document.createElement('canvas'); c.width = 96; c.height = 48; var x = c.getContext('2d'); x.fillStyle = color || '#1565c0'; x.fillRect(0, 0, 96, 48); x.fillStyle = '#fff'; x.font = 'bold 20px Arial'; x.textAlign = 'center'; x.fillText(text, 48, 31); return new Promise(function (r) { c.toBlob(r, 'image/png'); }); }
window.__logoPng = logoPng;
var realFetch = window.fetch;
window.fetch = function (u, o) { if (/Images\\/Primary/.test(String(u))) return logoPng('CBS', '#333').then(function (b) { return new Response(b, { status: 200, headers: { 'Content-Type': 'image/png' } }); }); return realFetch(u, o); };
window.ApiClient = { accessToken: function(){return 't';}, getCurrentUserId: function(){return 'u1';}, serverAddress: function(){return 'http://emby';},
  getUrl: function (p, q) { var s = Object.keys(q || {}).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&'); return p + (s ? '?' + s : ''); },
  getImageUrl: function(){return '';},
  getJSON: function (u) { var p = u.split('?')[0];
    if (p === 'IptvMapper/Logo') { var q = {}; (u.split('?')[1] || '').split('&').forEach(function (kv) { var a = kv.split('='); if (a[0]) q[a[0]] = decodeURIComponent(a[1] || ''); }); window.__logoCalls = (window.__logoCalls || 0) + 1;
      if (window.__noLogoApi) return Promise.reject({ status: 404 });
      if ((q.Url || '').slice(-10) === '/m3u/3.png' && !q.ItemId) return Promise.resolve({ Ok: false, Error: 'HTTP 404' });
      var lbl = q.ItemId === 'c1' ? 'CBS' : (q.Url || '').split('/').pop().replace('.png', '');
      return logoPng(lbl, q.ItemId ? '#333' : '#2e7d32').then(function (b) { return b.arrayBuffer(); }).then(function (buf) { var u8 = new Uint8Array(buf), str = ''; for (var i = 0; i < u8.length; i++) str += String.fromCharCode(u8[i]); return { Ok: true, Source: q.ItemId ? 'emby' : 'url', ContentType: 'image/png', Base64: btoa(str), Bytes: u8.length }; }); }
    if (p === 'IptvMapper/Channels') return Promise.resolve({ Rows: window.__serverRows, Tuners: [], Warnings: [] });
    if (p === 'LiveTv/Manage/Channels') return Promise.resolve({ Items: window.__items, TotalRecordCount: window.__items.length });
    if (p === 'Items') return Promise.resolve({ Items: window.__items.map(function (c, i) { return { Id: c.Id, TagItems: [{ Name: i === 6 ? 'Sports HD' : i < 6 ? 'Local' : (i < 8 ? 'Sports' : 'News & Lifestyle') }] }; }) });
    if (p === 'LiveTv/ListingProviders') return Promise.resolve([{ Id: 'xmltv1', Type: 'xmltv', Path: 'guide.xml' }]);
    if (p === 'LiveTv/ListingProviders/Available') return Promise.resolve([]);
    if (p === 'LiveTv/ChannelMappingOptions') return Promise.resolve({ ProviderChannels: [{ Id: 'espn.us', Name: 'ESPN' }, { Id: 'cnn.us', Name: 'CNN' }], Mappings: [] });
    return Promise.resolve({}); },
  ajax: function (o) { window.__ajax.push(o.type + ' ' + o.url); return Promise.resolve({}); },
  getInstalledPlugins: function () { return Promise.resolve([{ Id: 'e5b612ae-cad5-47e9-8fb3-27a029c220d3', Name: 'IPTV Channel Mapper', Version: '1.4.0.0' }]); },
  getPluginConfiguration: function () { return Promise.resolve(JSON.parse(JSON.stringify(window.__cfg))); },
  updatePluginConfiguration: function (id, c) { window.__cfg = JSON.parse(JSON.stringify(c)); window.__saved.push(window.__cfg); return Promise.resolve({}); } };
window.Dashboard = { showLoadingMsg: function(){}, hideLoadingMsg: function(){}, alert: function(){} };
window.require = function (d, cb) { cb && cb(function (m) { window.__toasts.push(m && m.text || m); }); };
window.define = function (deps, f) { window.__View = f(); };`;
  const html = fs.readFileSync(path.join(W, 'config.html'), 'utf8');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'Material Symbols Rounded';src:url(mi.woff2) format('woff2')}.md-icon{font-family:'Material Symbols Rounded'!important;font-feature-settings:'liga';font-style:normal;display:inline-block;line-height:1}
body{margin:0;background:#141414;color:#e8e8e8;font:14px "Segoe UI",Roboto,Arial,sans-serif}.top{height:3.2em;background:#1c1c1c;display:flex;align-items:center;padding:0 1.5em;border-bottom:1px solid #2a2a2a}.top b{color:#52b54b;margin-right:.8em}
.main{padding:.5em 1.5em}button,select,input{font:inherit;color:inherit}button{background:#2a2a2a;border:1px solid #3a3a3a;border-radius:.25em;padding:.35em .8em}</style>
<script>${mock}</script></head><body><div class="top"><b>emby</b> Server dashboard &rsaquo; IPTV Channel Mapper</div><div class="main">${html}</div>
<script src="${require('url').pathToFileURL(path.join(W, 'config.js')).href}"></script><script>var v=document.querySelector('.iptvMapperPage')||document.querySelector('[data-role=page]');new __View(v,{});v.dispatchEvent(new CustomEvent('viewshow'));</script></body></html>`;
}
const PAGE = path.join(__dirname, 'iptv-io-page.html');
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setViewport({ width: 1500, height: 900 });
  const open = async cfg => { fs.writeFileSync(PAGE, pageHtml(cfg)); await p.goto(require('url').pathToFileURL(PAGE).href); await p.waitForFunction(() => document.querySelectorAll('.iptvm-tbody tr').length >= 14, { timeout: 8000 }).catch(() => {}); await sleep(300); };
  await open({});
  const keys = await p.evaluate(() => __iptvmTest.state.rows.map(r => r.key));
  ok(keys.length === 14, 'rows loaded (' + keys[0] + ')');
  const cfg = { Enabled: true, Overrides: [
    { Key: keys[0], TunerHostId: 'm3u1', ManagementId: 'm3u1_0', ItemId: 'c0', Name: 'ABC 7 New York', Number: '7', LogoSource: 'url', LogoUrl: 'https://logos.example.invalid/abc7.png', HasGuideOverride: false, UpdatedUtc: '2026-10-12T15:00:00Z' },
    { Key: keys[1], TunerHostId: 'm3u1', ManagementId: 'm3u1_1', ItemId: 'c1', LogoSource: 'upload', LogoFileName: 'cbs-logo.png', HasGuideOverride: false, UpdatedUtc: '2026-10-12T15:01:00Z' },
    { Key: keys[6], TunerHostId: 'm3u1', ManagementId: 'm3u1_6', ItemId: 'c6', Group: 'Sports HD', HasGuideOverride: true, ListingsProviderId: 'xmltv1', ListingsChannelId: 'espn.us', UpdatedUtc: '2026-10-12T15:02:00Z' },
    { Key: 'm3u1|name:oldchannel', TunerHostId: 'm3u1', Name: 'Old Channel', Number: '99', HasGuideOverride: false, SeenM3uName: 'Old Channel' }],
    Snapshots: [{ Id: '1760000000000', DateUtc: '2026-10-10T12:00:00Z', Summary: 'Earlier save: 3 change(s) on 3 channel(s)', Changes: [] }], MaxSnapshots: 20 };
  await open(cfg);

  // ---------------- General tab
  await p.click('.iptvm-tab[data-itab=general]'); await sleep(300);
  ok(await p.$eval('.iptvm-g-enabled', e => e.checked && e.offsetParent !== null), 'General: Enable switch shown, on');
  ok((await p.$eval('.iptvm-version', e => e.textContent.trim())) === '1.4.0.0', 'General: About shows the version');
  const about = await p.$eval('[data-ipane=general]', e => e.innerHTML);
  ok(/github\.com\/mouseware\/emby-plugins/.test(about) && /None/.test(await p.$eval('[data-ipane=general]', e => e.textContent)), 'General: GitHub link, no injected script');
  ok(await p.$eval('[data-ipane=channels]', e => e.style.display === 'none'), 'channel pane hidden on General');
  await p.screenshot({ path: SHOT + '/iptvmapper-general.png' });
  await p.click('.iptvm-tab[data-itab=channels]'); await sleep(200);

  // ---------------- Export
  await p.evaluate(() => __iptvmTest.exportZip()); await sleep(800);
  const exp = await p.evaluate(async () => { const e = window.__iptvmLastExport; if (!e) return null; const buf = new Uint8Array(await e.blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]); return { name: e.name, b64: btoa(s), channels: e.channels, logos: e.logos }; });
  ok(exp && /^iptv-mapper-export-\d{8}-\d{4}\.zip$/.test(exp.name), 'export file name ' + (exp && exp.name));
  const zipPath = path.join(SHOT, 'iptvmapper-export-sample.zip'); fs.writeFileSync(zipPath, Buffer.from(exp.b64, 'base64'));
  const z = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const zn = Object.keys(z.files);
  ok(zn.includes('mapper.json') && zn.some(n => /^logos\/.+\.png$/.test(n)), 'zip (read by JSZip) has mapper.json + logos/: ' + zn.join(', '));
  const mj = JSON.parse(await z.file('mapper.json').async('string'));
  ok(mj.Format === 'claw-iptvmapper' && mj.FormatVersion === 1 && mj.Channels.length === 4, 'mapper.json: format + 4 channel overrides');
  const c0 = mj.Channels.find(c => c.Key === keys[0]), c1 = mj.Channels.find(c => c.Key === keys[1]), c6 = mj.Channels.find(c => c.Key === keys[6]);
  ok(c0 && c0.Logo && c0.Logo.Source === 'url' && c0.Logo.Url === 'https://logos.example.invalid/abc7.png' && /^logos\//.test(c0.Logo.File || '') && c0.Name === 'ABC 7 New York' && c0.Number === '7', 'URL logo keeps its link and (all logos) gets a file too');
  ok(c1 && c1.Logo && c1.Logo.Source === 'upload' && /^logos\/\d*_?WCBS_2\.png$/.test(c1.Logo.File) && zn.includes(c1.Logo.File), 'uploaded logo stored as file ' + (c1 && c1.Logo && c1.Logo.File));
  const png = await z.file(c1.Logo.File).async('uint8array');
  ok(png[0] === 0x89 && png[1] === 0x50 && png.length > 100, 'logo file is a PNG (' + png.length + ' bytes)');
  ok(c6 && c6.Group === 'Sports HD' && c6.Guide && c6.Guide.ProviderId === 'xmltv1' && c6.Guide.ChannelId === 'espn.us' && c6.Guide.Provider && c6.Guide.Provider.Type === 'xmltv', 'group + guide mapping with provider info');
  ok(mj.Snapshots.length === 1 && mj.Providers.length === 1 && mj.Channels.some(c => c.Key === 'm3u1|name:oldchannel'), 'snapshots, providers and offline overrides included');
  ok(zn.filter(n => n.startsWith('logos/')).length === 13 && mj.AllLogos === true, 'include all logos (default): 13 of 14 channel logos in logos/, got ' + zn.filter(n => n.startsWith('logos/')).length);
  ok(mj.Logos.length === 14 && mj.Logos.filter(l => l.File).every(l => zn.includes(l.File)) && mj.Logos.find(l => l.Key === keys[1]).Source === 'upload' && mj.Logos.find(l => l.Key === keys[5]).Source === 'm3u', 'mapper.json Logos reference the files, with their source');
  const fl = mj.LogoFailures; const l3 = mj.Logos.find(l => l.Key === keys[3]);
  ok(fl.length === 1 && /HTTP 404/.test(fl[0].Error) && l3 && !l3.File && /\/m3u\/3\.png$/.test(l3.Url), 'failed download: link kept, listed in LogoFailures');
  const res = await p.$eval('.iptvm-results', e => e.classList.contains('iptvm-show') ? e.textContent : '');
  ok(/13 of 14 channel logos/.test(res) && /1 logo\(s\) could not be read/.test(res) && /FOX 5 NY/.test(res) && /HTTP 404/.test(res), 'export summary lists the failure: ' + res.slice(0, 160));
  await p.screenshot({ path: SHOT + '/iptvmapper-export-summary.png' });
  ok(await p.$$eval('.iptvm-exp-all', a => a.length === 2 && a.every(c => c.checked)), '"Include all logos" on by default (toolbar + General)');
  await p.click('.iptvm-toolbar .iptvm-exp-all, .iptvm-exp-all');
  ok(await p.evaluate(() => localStorage.getItem('claw.iptvmapper.exportAllLogos') === '0') && await p.$$eval('.iptvm-exp-all', a => a.every(c => !c.checked)), 'option persisted and both boxes synced');
  await p.evaluate(() => __iptvmTest.exportZip()); await sleep(800);
  ok(await p.evaluate(() => __iptvmLastExport.logos === 1 && __iptvmLastExport.all === false), 'option off: only the uploaded logo is stored (old behaviour)');
  await p.click('.iptvm-exp-all'); await sleep(100);
  await p.evaluate(() => { window.__noLogoApi = true; }); await p.evaluate(() => __iptvmTest.exportZip()); await sleep(800);
  ok(await p.evaluate(() => __iptvmLastExport.logos === 1 && __iptvmLastExport.failures.length === 13), 'old server without the logo endpoint: Emby image read by the browser, the rest kept as links');
  await p.evaluate(() => { window.__noLogoApi = false; });

  // ---------------- Import: build a deflate-compressed zip with JSZip
  const nbc = Buffer.from((await p.evaluate(async () => { const bl = await __logoPng('NBC 4', '#6a1b9a'); const u = new Uint8Array(await bl.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); })), 'base64');
  const imp = { Format: 'claw-iptvmapper', FormatVersion: 1, ExportedUtc: '2026-10-13T09:30:00Z', Providers: [{ Id: 'oldxml', Type: 'xmltv', Label: 'xmltv (guide.xml)' }],
    Channels: [
      { Key: keys[2], TunerHostId: 'm3u1', ManagementId: 'm3u1_2', Label: 'WNBC 4', Name: 'NBC 4 New York', Logo: { Source: 'upload', File: 'logos/WNBC_4.png' } },
      { Key: keys[0], TunerHostId: 'm3u1', ManagementId: 'm3u1_0', Label: 'WABC-HD', Number: '77' },
      { Key: keys[8], TunerHostId: 'm3u1', ManagementId: 'm3u1_8', Label: 'CNN', Guide: { ProviderId: 'oldxml', ChannelId: 'cnn.us' } },
      { Key: keys[9], TunerHostId: 'm3u1', ManagementId: 'm3u1_9', Label: 'MSNBC', Guide: { ProviderId: 'sd9', ChannelId: '123', Provider: { Id: 'sd9', Type: 'SchedulesDirect', Label: 'Schedules Direct' } } },
      { Key: 'm3u9|name:ghosttv', TunerHostId: 'm3u9', Label: 'Ghost TV', Name: 'Ghost TV', Number: '500' }],
    Logos: [{ Key: keys[10], Label: 'HGTV', Source: 'm3u', File: 'logos/HGTV.png' }, { Key: keys[1], Label: 'WCBS 2', Source: 'emby', File: 'logos/WCBS_2.png' }, { Key: keys[11], Label: 'Food Network', Source: 'm3u', Url: 'https://x.invalid/f.png', File: null, Error: 'HTTP 404' }],
    Snapshots: [{ Id: '1759000000000', DateUtc: '2026-10-01T08:00:00Z', Summary: 'From the other server', Changes: [] }], MaxSnapshots: 20 };
  const zi = new JSZip(); zi.file('mapper.json', JSON.stringify(imp, null, 2)); zi.file('logos/WNBC_4.png', nbc); zi.file('logos/HGTV.png', nbc); zi.file('logos/WCBS_2.png', nbc);
  const impPath = path.join(os.tmpdir(), 'iptv-mapper-import-sample.zip');
  fs.writeFileSync(impPath, await zi.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  await p.evaluate(() => { window.__conf = []; });
  await (await p.$('.iptvm-import-file')).uploadFile(impPath); await sleep(900);
  ok(await p.$eval('.iptvm-import-overlay', e => e.classList.contains('iptvm-show')), 'import preview opens');
  ok(/5 channel override\(s\), 3 logo file\(s\), 1 snapshot/.test(await p.$eval('.iptvm-imp-file', e => e.textContent)), 'preview header describes the file');
  const prev = () => p.$$eval('.iptvm-imp-table tbody tr', t => t.map(r => Array.from(r.cells).map(c => c.textContent.trim()).join(' | ')));
  const summary = () => p.$eval('.iptvm-imp-summary', e => e.textContent);
  const setOpt = async (n, v) => { await p.$eval('input[name="' + n + '"][value="' + v + '"]', e => { e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(250); };
  ok(await p.$eval('input[name=iptvmImpMode][value=merge]', e => e.checked) && await p.$eval('input[name=iptvmImpScope][value=all]', e => e.checked), 'defaults: Merge + All channels');
  let rows = await prev(), sm = await summary();
  ok(rows.some(r => /WNBC 4 \| name \| WNBC 4 \| NBC 4 New York/.test(r)), 'merge: name change shown (current -> imported)');
  ok(rows.some(r => /WNBC 4 \| logo \|.*file logos\/WNBC_4\.png/.test(r)), 'merge: logo from the zip shown');
  ok(rows.some(r => /CNN \| guide mapping \| Auto \| .*cnn\.us/.test(r)), 'merge: guide mapped to the local provider by type/label');
  ok(rows.some(r => /\| channel number \| 7 \| 77$/.test(r)) && !rows.some(r => /\| name \| ABC 7 New York/.test(r)), 'merge: only fields from the file change');
  ok(/Schedules Direct.*does not exist here/.test(sm), 'merge: missing provider warned');
  ok(/1 channel\(s\) from the file not found here \(kept as overrides for later\)/.test(sm), 'merge/all: unmatched kept for later');
  ok(await p.$eval('.iptvm-imp-logo', e => e.src.startsWith('blob:')), 'logo preview thumbnail from the zip');
  ok(rows.some(r => /HGTV \| logo \|.*file logos\/HGTV\.png/.test(r)) && !rows.some(r => /WCBS 2 \| logo/.test(r)) && /2 embedded logo|1 embedded logo/.test(sm), 'merge: embedded logo restores a channel without a logo, keeps existing ones');
  const nMerge = rows.length;
  await p.screenshot({ path: SHOT + '/iptvmapper-import-preview.png' });
  await setOpt('iptvmImpMode', 'replace');
  rows = await prev();
  ok(rows.some(r => /\| name \| ABC 7 New York \| WABC-HD$/.test(r)), 'replace: other override fields reset to the M3U value');
  ok(rows.some(r => /WCBS 2 \| logo/.test(r)) && rows.some(r => /^\d+ ESPN \| group/.test(r)) && rows.some(r => /^\d+ ESPN \| guide mapping \| .*espn\.us \| Auto$/.test(r)), 'replace + all: channels missing from the file are reset');
  const nReplAll = rows.length;
  await setOpt('iptvmImpScope', 'matching');
  rows = await prev(); sm = await summary();
  ok(!rows.some(r => /^\d+ ESPN \|/.test(r)) && rows.some(r => /WCBS 2 \| logo \|.*file logos\/WCBS_2\.png/.test(r)) && rows.some(r => /\| name \| ABC 7 New York/.test(r)), 'replace + matching only: unlisted channels untouched, embedded logos restored');
  ok(/\(ignored\)/.test(sm), 'matching only: unmatched ignored');
  ok(nReplAll > rows.length && rows.length > nMerge - 1, 'change counts: merge ' + nMerge + ', replace/all ' + nReplAll + ', replace/matching ' + rows.length);
  await p.screenshot({ path: SHOT + '/iptvmapper-import-replace.png' });
  // resizable preview columns
  {
    const th = await p.$('.iptvm-imp-table th:nth-child(1)'); const w0 = (await th.boundingBox()).width; const h = await th.$('.cr-h');
    ok(!!h, 'preview table has resize handles');
    if (h) { const hb = await h.boundingBox(); await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await p.mouse.down(); await p.mouse.move(hb.x + 90, hb.y + 4, { steps: 5 }); await p.mouse.up(); ok((await th.boundingBox()).width > w0 + 40, 'preview column resizes'); }
  }
  // apply merge + all; cancel the final Save confirm
  await setOpt('iptvmImpMode', 'merge'); await setOpt('iptvmImpScope', 'all');
  const nSaves = await p.evaluate(() => __saved.length);
  await p.click('.iptvm-imp-apply'); await sleep(1500);
  let C = await p.evaluate(() => window.__cfg);
  ok(await p.evaluate(n => __saved.length === n + 1, nSaves), 'apply stores the config once before saving');
  ok(/^Before import of iptv-mapper-import-sample\.zip \(merge, all channels\)/.test(C.Snapshots[0].Summary) && C.Snapshots[0].Changes.length > 0, 'snapshot of the current state stored first: ' + C.Snapshots[0].Summary);
  ok(C.Snapshots[0].Changes.some(c => c.Field === 'name' && c.Before === 'WNBC 4' && c.After === 'NBC 4 New York'), 'snapshot records before/after values');
  ok(C.Snapshots.some(s => s.Id === '1759000000000') && C.Snapshots.some(s => s.Id === '1760000000000'), 'imported snapshots merged with the existing ones');
  ok(C.Overrides.some(o => o.Key === 'm3u9|name:ghosttv' && o.Name === 'Ghost TV') && C.Overrides.some(o => o.Key === 'm3u1|name:oldchannel'), 'unmatched override stored for later; existing offline override kept');
  ok(await p.evaluate(() => /^Apply \d+ change\(s\) to Emby\?/.test(window.__conf[window.__conf.length - 1] || '')), 'normal Save confirmation asked: ' + await p.evaluate(() => (window.__conf[window.__conf.length - 1] || '').split('\n')[0]));
  ok(!(await p.$eval('.iptvm-import-overlay', e => e.classList.contains('iptvm-show'))), 'preview closed');
  ok(await p.$eval('.iptvm-act-save', e => !e.disabled), 'imported changes stay pending after cancelling Save');
  ok(await p.evaluate(() => Object.keys(__iptvmTest.state.uploads).length >= 2), 'zip logos became uploads');
  await p.screenshot({ path: SHOT + '/iptvmapper-import-pending.png' });
  // accept the save
  await p.evaluate(() => { window.__confAns = true; window.__ajax = []; });
  await p.click('.iptvm-act-save'); await sleep(2500);
  C = await p.evaluate(() => window.__cfg);
  const o2 = C.Overrides.find(o => o.Key === keys[2]);
  ok(o2 && o2.Name === 'NBC 4 New York' && o2.LogoSource === 'upload', 'after Save: imported name + logo stored as overrides');
  ok((await p.evaluate(() => __ajax.length)) > 0, 'Save talked to Emby (' + (await p.evaluate(() => __ajax.slice(0, 3).join(', '))) + ')');

  // ---------------- switched off
  await p.click('.iptvm-tab[data-itab=general]'); await sleep(200);
  await p.$eval('.iptvm-g-enabled', e => { e.checked = false; }); await p.$eval('.iptvm-general-form', f => f.requestSubmit()); await sleep(500);
  ok(await p.evaluate(() => __cfg.Enabled === false && __cfg.Overrides.length > 0), 'switch off saved, overrides kept');
  ok(/is off/.test(await p.$eval('.iptvm-g-msg', e => e.textContent)), 'off message');
  ok(await p.$eval('.iptvm-off-banner', e => e.style.display !== 'none'), 'off banner shown');
  ok(await p.$$eval('.iptvm-act-import', a => a.every(x => x.disabled)), 'Import disabled while off');
  await p.screenshot({ path: SHOT + '/iptvmapper-off.png' });
  await p.click('.iptvm-tab[data-itab=channels]'); await sleep(200);
  await p.evaluate(() => { window.__conf = []; window.__toasts = []; });
  await p.evaluate(() => __iptvmTest.importFile(new File([new Uint8Array([1, 2, 3])], 'x.zip')));
  ok(!(await p.$eval('.iptvm-import-overlay', e => e.classList.contains('iptvm-show'))) && (await p.evaluate(() => __toasts.join())).includes('switched off'), 'import refused while off');
  await p.evaluate(() => __iptvmTest.exportZip()); await sleep(500);
  ok(/Exported \d+ channel/.test(await p.evaluate(() => __toasts.join(' | '))), 'export still works while off');
  await p.click('.iptvm-tab[data-itab=general]'); await sleep(200);
  await p.$eval('.iptvm-g-enabled', e => { e.checked = true; }); await p.$eval('.iptvm-general-form', f => f.requestSubmit()); await sleep(500);
  ok(await p.evaluate(() => __cfg.Enabled === true) && await p.$eval('.iptvm-off-banner', e => e.style.display === 'none'), 'switched on again');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  fs.unlinkSync(PAGE); fs.unlinkSync(impPath);
  await b.close(); console.log(passes + ' passed, ' + fails + ' failed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH', e); process.exit(2); });