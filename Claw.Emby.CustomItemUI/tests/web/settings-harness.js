// Builds settings harness pages around a given config.html/config.js (fake data only).
const fs=require('fs');const os=require('os');const OUT=fs.mkdtempSync(require('path').join(os.tmpdir(),'ciui-'));
const HEAD='<!doctype html><html><head><meta charset="utf-8"><title>Settings mock</title><style>\nbody{margin:0;background:#181818;color:#e8e8e8;font-family:Segoe UI,Roboto,Arial,sans-serif;font-size:14px}\n.topbar{height:3.2em;background:#1c1c1c;display:flex;align-items:center;padding:0 1.5em;font-weight:600;border-bottom:1px solid #2a2a2a}.topbar b{color:#52b54b;margin-right:.6em}\n.content-primary{max-width:72em;padding:1em 2.5em}.sectionTitle{font-size:1.3em;font-weight:500;margin:1.6em 0 .4em}.secondaryText,.fieldDescription{opacity:.7;font-size:92%}\n.inputContainer{margin:.8em 0}.inputLabel{display:block;opacity:.8;margin-bottom:.3em}input[type=text],input[type=number],select,textarea{background:#262626;color:#eee;border:1px solid #3a3a3a;border-radius:.25em;padding:.45em .6em;font:inherit;box-sizing:border-box}\n.inputContainer input,.inputContainer select{width:100%}.checkboxContainer{margin:.7em 0}.checkboxFieldDescription{margin-left:1.8em}\n.raised{background:#303030;color:#eee;border:0;border-radius:.3em;padding:.6em 1.1em;font:inherit;cursor:pointer}.button-submit{background:#52b54b;color:#fff}.block{display:block;width:100%;margin-top:1.5em}\n.hide{display:none!important}\n</style></head><body><div class="topbar"><b>emby</b> Plugins &rsaquo; Claw Custom Item UI</div>';
module.exports=function(dir,name){
  const head=HEAD;
  const html=fs.readFileSync(dir+'/Web/config.html','utf8');
  fs.copyFileSync(dir+'/Web/config.js',OUT+'/'+name+'.js');
  const s=`${head}\n${html}\n<script>
window.__alerts=[];window.__saved=null;
window.Dashboard={showLoadingMsg:function(){},hideLoadingMsg:function(){},processServerConfigurationUpdateResult:function(){window.__savedOk=true},alert:function(o){window.__alerts.push(o.message||o)}};
window.__cfg=JSON.parse(localStorage.getItem('__cfg')||'null')||{Enabled:true,EnableMoveLinksUp:true,LinksInsertAfter:'overview',LinksOrder:5,HideLinksHeading:true,AlignLinksLeft:true,RemoveLinkCommas:true,LinksGap:'.5em',EnableVlcPathLinks:true,VlcUrlTemplate:'vlc://{path}',ShowVlcIcon:true,EnableRaisedLinkButtons:true,ButtonBorderRadius:'.3em',ButtonTextColor:'#ffffff',ButtonCustomCss:'background:#2b2b2b;',ApplyMode:'allowlist',AllowedUserNames:'alice, bob',AllowedUserIds:'',EnableDashboardLayout:true,DashboardActivityTable:true,DashboardAlertsTable:true,DashboardStackBelowPx:900,DashboardAlertsLimit:8,DashboardActivityLimit:12,DashboardNowPlayingPerRow:3,DashboardFillRows:true};
window.ApiClient={getPluginConfiguration:function(){return Promise.resolve(JSON.parse(JSON.stringify(window.__cfg)))},updatePluginConfiguration:function(id,c){window.__saved=c;return Promise.resolve()},
 getInstalledPlugins:function(){return Promise.resolve([{Id:'b7e4c2a1-9f3d-4e8b-a6c5-1d2e3f4a5b6c',Name:'Claw Custom Item UI',Version:'1.2.3.0'},{Id:'x',Name:'Other',Version:'9'}])}};
window.define=function(deps,fn){window.__View=fn();};
</script><script src="${name}.js"></script><script>
var page=document.getElementById('clawCustomItemUiPage');new __View(page,{});
page.dispatchEvent(new CustomEvent('viewshow',{bubbles:true}));
</script></body></html>`;
  fs.writeFileSync(OUT+'/'+name+'.html',s);return OUT+'/'+name+'.html';
};
