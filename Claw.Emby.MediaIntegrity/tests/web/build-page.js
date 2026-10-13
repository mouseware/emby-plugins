// Assembles an offline page: Emby-like shell + the real integrity.html + the real guard.js.
const fs = require('fs'), path = require('path');
const web = path.resolve(__dirname, '../../Web');
const html = fs.readFileSync(path.join(web, 'integrity.html'), 'utf8');
const page = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'Material Symbols Rounded';src:url(mi.woff2) format('woff2')}
.md-icon{font-family:'Material Symbols Rounded'!important;font-weight:400;font-style:normal;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;font-feature-settings:'liga';font-variation-settings:"FILL" 0,"wght" 400,"GRAD" 0,"opsz" 24;overflow:hidden;vertical-align:middle}
body{margin:0;background:#141414;color:#e8e8e8;font:14px "Segoe UI",Roboto,Arial,sans-serif}
.top{height:3.2em;background:#1c1c1c;display:flex;align-items:center;padding:0 1.5em;border-bottom:1px solid #2a2a2a}.top b{color:#52b54b;margin-right:.8em}
.side{position:fixed;top:3.2em;left:0;bottom:0;width:14em;background:#181818;padding-top:1em}.side div{padding:.6em 1.4em;opacity:.8;display:flex;gap:.6em;align-items:center}.side .on{background:#24321f;opacity:1;color:#8fd88a}
.main{margin-left:14em;padding:1em 2.2em}.sectionTitle{font-weight:500;font-size:1.6em;margin:.3em 0}.secondaryText{opacity:.7}
.inputContainer{margin-bottom:1em}.inputLabel{display:block;opacity:.75;margin-bottom:.3em;font-size:.92em}
input[is=emby-input]{font:inherit;color:inherit;background:#222;border:1px solid #3a3a3a;border-radius:.25em;padding:.45em .6em;width:100%;box-sizing:border-box;max-width:22em}
.fieldDescription{opacity:.6;font-size:.88em;margin:.2em 0 .6em}.checkboxContainer{margin:.6em 0}
button.raised{font:inherit;background:#52b54b;color:#fff;border:0;border-radius:.3em;padding:.6em 1.4em;margin-top:1em;cursor:pointer}
</style><script src="mock-emby.js"></script></head><body><div class="top"><b>emby</b> Server dashboard</div>
<div class="side"><div><i class="md-icon">dashboard</i>Dashboard</div><div><i class="md-icon">people</i>Users</div><div><i class="md-icon">video_library</i>Library</div><div><i class="md-icon">wifi</i>Network</div>
<div><i class="md-icon">shield</i>Guard</div><div class="on"><i class="md-icon">health_and_safety</i>Media Integrity</div><div><i class="md-icon">design_services</i>Custom Item UI</div><div><i class="md-icon">live_tv</i>IPTV Mapper</div><div><i class="md-icon">bookmarks</i>Default Chapters</div></div>
<div class="main">${html}</div><script src="../../Web/integrity.js"></script><script>__boot()</script></body></html>`;
fs.writeFileSync(path.join(__dirname, 'integrity-page.html'), page);
