// IPTV Channel Mapper: real Web/config.html + config.js against a small mock (fallback mode, 14 channels).
const puppeteer = require('/workspace/jstest/node_modules/puppeteer-core');
const fs = require('fs'), path = require('path');
const W = path.resolve(__dirname, '../../Web');
let fails = 0, passes = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? passes++ : fails++; };
const names = ['WABC-HD', 'WCBS 2', 'WNBC 4', 'FOX 5 NY', 'WPIX 11', 'PBS Thirteen', 'ESPN', 'ESPN2', 'CNN', 'MSNBC', 'HGTV', 'Food Network', 'Discovery', 'History'];
const mock = `
window.__items = ${JSON.stringify(names.map((n, i) => ({ Id: 'c' + i, ManagementId: 'm3u1_' + i, Name: n, ChannelNumber: String(i + 2), TunerName: 'IPTV (Xtream)', Disabled: i === 9, SortIndexNumber: i, ImageTags: {} })))};
window.ApiClient = { accessToken: function(){return 't';}, getCurrentUserId: function(){return 'u1';}, serverAddress: function(){return 'http://emby';},
  getUrl: function (p, q) { var s = Object.keys(q || {}).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&'); return p + (s ? '?' + s : ''); },
  getImageUrl: function(){return '';},
  getJSON: function (u) { var p = u.split('?')[0];
    if (p === 'IptvMapper/Channels') return Promise.reject({ status: 404 });
    if (p === 'LiveTv/Manage/Channels') return Promise.resolve({ Items: window.__items, TotalRecordCount: window.__items.length });
    if (p === 'Items') return Promise.resolve({ Items: window.__items.map(function (c, i) { return { Id: c.Id, TagItems: [{ Name: i < 6 ? 'Local' : (i < 8 ? 'Sports' : 'News & Lifestyle') }] }; }) });
    if (p === 'LiveTv/ListingProviders') return Promise.resolve([{ Id: 'xmltv1', Type: 'xmltv', Path: 'guide.xml' }]);
    if (p === 'LiveTv/ListingProviders/Available') return Promise.resolve([]);
    if (p === 'LiveTv/ChannelMappingOptions') return Promise.resolve({ ProviderChannels: [], Mappings: [] });
    return Promise.resolve({}); },
  ajax: function () { return Promise.resolve({}); },
  getPluginConfiguration: function () { return Promise.resolve({}); }, updatePluginConfiguration: function () { return Promise.resolve({}); } };
window.Dashboard = { showLoadingMsg: function(){}, hideLoadingMsg: function(){}, alert: function(){} };
window.require = function (d, cb) { cb && cb(function(){}); };
window.define = function (deps, f) { window.__View = f(); };`;
const html = fs.readFileSync(path.join(W, 'config.html'), 'utf8');
const page = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'Material Symbols Rounded';src:url(mi.woff2) format('woff2')}.md-icon{font-family:'Material Symbols Rounded'!important;font-feature-settings:'liga';font-style:normal;display:inline-block;line-height:1}
body{margin:0;background:#141414;color:#e8e8e8;font:14px "Segoe UI",Roboto,Arial,sans-serif}.top{height:3.2em;background:#1c1c1c;display:flex;align-items:center;padding:0 1.5em;border-bottom:1px solid #2a2a2a}.top b{color:#52b54b;margin-right:.8em}
.main{padding:.5em 1.5em}button,select,input{font:inherit;color:inherit}button{background:#2a2a2a;border:1px solid #3a3a3a;border-radius:.25em;padding:.35em .8em}</style>
<script>${mock}</script></head><body><div class="top"><b>emby</b> Server dashboard &rsaquo; IPTV Channel Mapper</div><div class="main">${html}</div>
<script src="${W}/config.js"></script><script>var v=document.querySelector('.iptvMapperPage')||document.querySelector('[data-role=page]');new __View(v,{});v.dispatchEvent(new CustomEvent('viewshow'));</script></body></html>`;
fs.writeFileSync(path.join(__dirname, 'iptv-page.html'), page);
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setViewport({ width: 1500, height: 820 });
  await p.goto('file://' + path.join(__dirname, 'iptv-page.html')); await p.waitForFunction(() => document.querySelectorAll('.iptvm-tbody tr').length >= 14, { timeout: 8000 }).catch(() => {});
  ok(await p.$$eval('.iptvm-tbody tr', t => t.length) >= 14, 'channels rendered');
  const C = require('./checks.js')(p, ok);
  await p.screenshot({ path: '' + (process.env.SHOTDIR || __dirname) + '/iptvmapper-resize-before.png' });
  const sortName = () => p.$$eval('.iptvm-tbody tr', t => t.map(r => r.textContent).join('|'));
  const before = await sortName();
  await C.run('IPTV Mapper channels', '.iptvm-table', 'name', 'claw.iptvmapper.cols.channels', async () => { await p.click('.iptvm-table th[data-sort=number]'); });
  await C.drag('.iptvm-table', 'group', 90);
  ok(!!(await p.$eval('.iptvm-table th[data-sort=number]', e => e.textContent)), 'sort still works');
  ok(await p.$eval('.iptvm-table th[data-sort=name]', th => getComputedStyle(th).position) === 'sticky', 'sticky header kept');
  await p.screenshot({ path: '' + (process.env.SHOTDIR || __dirname) + '/iptvmapper-resize.png' });
  await p.reload(); await p.waitForFunction(() => document.querySelectorAll('.iptvm-tbody tr').length >= 14, { timeout: 8000 }).catch(() => {});
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('claw.iptvmapper.cols.channels')));
  ok(Math.abs((await C.thBox('.iptvm-table', 'name')).w - st.name) <= 2, 'IPTV widths restored after reload');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  await b.close(); console.log(passes + ' passed, ' + fails + ' failed'); process.exit(fails ? 1 : 0);
})();
