const puppeteer=require('/workspace/jstest/node_modules/puppeteer-core');
const fs=require('fs');const os=require('os');const path=require('path');
const DIR=path.resolve(__dirname,'../..');
const SHOT=process.env.SHOT_DIR||path.join(DIR,'../../docs/screenshots/custom-item-ui');
let P=0,F=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);c?P++:F++;};const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const OWNED={
  'tr-silence':{TrailerId:'tr-silence',Id:'mv-silence',Name:'The Silence of the Lambs',Type:'Movie',Year:1991,ImageTag:'img-silence',Match:'imdb'},
  'tr-bambi':{TrailerId:'tr-bambi',Id:'mv-bambi',Name:'Bambi',Type:'Movie',Year:1942,ImageTag:'img-bambi',Match:'tmdb'},
  'tr-year':{TrailerId:'tr-year',Id:'mv-year',Name:'Only Year',Type:'Movie',Year:2001,ImageTag:'img-year',Match:'title-year'}
  // tr-unowned and tr-extra have no mapping
};

const PAGE=`<!doctype html><html><head><meta charset="utf-8"><title>Trailers mock</title>
<style>
body{margin:0;background:#101010;color:#eee;font-family:Segoe UI,Roboto,Arial,sans-serif}
.topbar{height:3em;background:#1a1a1a;display:flex;align-items:center;padding:0 1.2em;border-bottom:1px solid #2a2a2a;font-weight:600}
.topbar b{color:#52b54b;margin-right:.6em}
h2{font-weight:500;font-size:1.15em;margin:1.2em 1.4em .4em}
.row{display:flex;gap:1em;padding:0 1.4em 1.4em;flex-wrap:wrap}
.card{width:10.5em;cursor:pointer;text-decoration:none;color:inherit;display:block}
.card .img{height:15.5em;border-radius:.3em;background:#2a2a2a center/cover no-repeat;display:flex;align-items:flex-end}
.card .img span{font-size:10px;background:rgba(0,0,0,.65);padding:.15em .4em;margin:.3em;border-radius:.2em;text-transform:uppercase;letter-spacing:.03em}
.card .name{margin-top:.4em;font-size:13px;line-height:1.3}
.card.owned .img{box-shadow:0 0 0 2px #52b54b}
.legend{opacity:.7;font-size:12px;margin:0 1.4em 1em}
</style></head><body>
<div class="topbar"><b>emby</b> Home</div>
<h2>Because you own it — Trailers</h2>
<p class="legend" id="legend">Loading…</p>
<div class="row" id="row"></div>
<script>
window.__mapCalls=0; window.__mapped=[];
window.ApiClient={
  serverId:function(){return 'srv';},
  getCurrentUser:function(){return Promise.resolve({Name:'alice',Policy:{IsAdministrator:true}});},
  getPluginConfiguration:function(){return Promise.resolve(window.__cfg);},
  getUrl:function(p,q){return p+'?Ids='+(q&&q.Ids||'');},
  getJSON:function(url){
    if(/TrailerMap/.test(url)){
      window.__mapCalls++;
      var ids=(/Ids=([^&]*)/.exec(url)||[,' '])[1].split(',');
      var Items=ids.map(function(id){return window.__owned[id];}).filter(Boolean);
      return Promise.resolve({Items:Items});
    }
    if(/Items/.test(url) || url==='home'){
      return Promise.resolve({Items:window.__homeItems});
    }
    return Promise.resolve({});
  }
};
</script>
<script src="claw-custom-item-ui.js"></script>
<script>
function render(items){
  var row=document.getElementById('row');
  row.innerHTML=items.map(function(it){
    var owned=!!it.ClawReplacedTrailer;
    var badge=owned?'library':(it.Type==='Trailer'?'trailer':'');
    var bg=it.ImageTags&&it.ImageTags.Primary
      ? 'background-image:linear-gradient(160deg,#1a3a2a,#2a2a1a),none'
      : 'background-image:linear-gradient(160deg,#3a1a1a,#2a1a2a)';
    if(it.Id==='mv-silence'||it.Id==='tr-silence') bg='background:#3a2a12';
    if(it.Id==='mv-bambi'||it.Id==='tr-bambi') bg='background:#1a3a18';
    if(it.Id==='mv-year'||it.Id==='tr-year') bg='background:#1a2a3a';
    if(it.Id==='tr-unowned') bg='background:#3a1a1a';
    if(it.Id==='tr-extra') bg='background:#2a2a2a';
    return '<a class="card'+(owned?' owned':'')+'" data-id="'+it.Id+'" data-type="'+it.Type+'" href="#/item?id='+it.Id+'"><div class="img" style="'+bg+'"><span>'+badge+'</span></div><div class="name">'+it.Name+(it.ProductionYear?' ('+it.ProductionYear+')':'')+'</div></a>';
  }).join('');
}
window.__boot=function(){
  return ApiClient.getJSON('home').then(function(r){
    var items=r.Items||[];
    render(items);
    var n=items.filter(function(x){return x.ClawReplacedTrailer;}).length;
    var left=items.filter(function(x){return x.Type==='Trailer';}).length;
    document.getElementById('legend').textContent=n+' trailer'+(n===1?'':'s')+' replaced with the library movie · '+left+' trailer'+(left===1?'':'s')+' unchanged (not in the library, or a local extra).';
    window.__shown=items;
    return items;
  });
};
</script></body></html>`;

(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ciu-tr-'));
 const js=fs.readFileSync(path.join(DIR,'Inject/claw-custom-item-ui.js'),'utf8');
 fs.writeFileSync(path.join(tmp,'claw-custom-item-ui.js'), js);
 fs.writeFileSync(path.join(tmp,'page.html'), PAGE);
 const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--disable-gpu','--allow-file-access-from-files']});
 const p=await b.newPage(); p.errs=[]; p.on('pageerror',e=>p.errs.push(e.message));
 await p.setViewport({width:1280,height:720});
 await p.goto('file://'+path.join(tmp,'page.html'));
 await sleep(200);

 // default (toggle off): items stay trailers
 await p.evaluate((owned)=>{
   window.__cfg={Enabled:true,ReplaceOwnedTrailers:false,ApplyMode:'all'};
   window.__owned=owned;
   window.__homeItems=[
     {Id:'tr-silence',Name:'The Silence of the Lambs',Type:'Trailer',ChannelId:'ch-trailers',ProductionYear:1991,ImageTags:{Primary:'t'}},
     {Id:'tr-bambi',Name:'Bambi',Type:'Trailer',ChannelId:'ch-trailers',ProductionYear:1942},
     {Id:'tr-year',Name:'Only Year',Type:'Trailer',ChannelId:'ch-trailers',ProductionYear:2001},
     {Id:'tr-unowned',Name:'Coming Soon: Unreleased',Type:'Trailer',ChannelId:'ch-trailers',ProductionYear:2027},
     {Id:'tr-extra',Name:'Bambi',Type:'Trailer',ExtraType:'Trailer',ProductionYear:1942}
   ];
 }, OWNED);
 const off=await p.evaluate(()=>window.__boot());
 ok(off.every(x=>x.Type==='Trailer') && off.every(x=>!x.ClawReplacedTrailer),'off: no cards swapped');
 ok(await p.evaluate(()=>window.__mapCalls)===0,'off: no lookup request');

 // toggle on (reload so the inject re-reads config; it caches the first fetch)
 await p.reload(); await sleep(200);
 await p.evaluate((owned)=>{
   window.__cfg={Enabled:true,ReplaceOwnedTrailers:true,ApplyMode:'all'};
   window.__owned=owned;
   window.__mapCalls=0;
   window.__homeItems=[
     {Id:'tr-silence',Name:'The Silence of the Lambs',Type:'Trailer',ChannelId:'ch-trailers',ProductionYear:1991,ImageTags:{Primary:'t'}},
     {Id:'tr-bambi',Name:'Bambi',Type:'Trailer',ChannelId:'ch-trailers',ProductionYear:1942},
     {Id:'tr-year',Name:'Only Year',Type:'Trailer',ChannelId:'ch-trailers',ProductionYear:2001},
     {Id:'tr-unowned',Name:'Coming Soon: Unreleased',Type:'Trailer',ChannelId:'ch-trailers',ProductionYear:2027},
     {Id:'tr-extra',Name:'Bambi',Type:'Trailer',ExtraType:'Trailer',ProductionYear:1942}
   ];
 }, OWNED);
 const on=await p.evaluate(()=>window.__boot());
 ok(on[0].Id==='mv-silence' && on[0].Type==='Movie' && on[0].Name==='The Silence of the Lambs' && on[0].ClawTrailerMatch==='imdb','owned (IMDb): card is the library movie');
 ok(on[1].Id==='mv-bambi' && on[1].ClawTrailerMatch==='tmdb','owned (TMDb): card is the library movie');
 ok(on[2].Id==='mv-year' && on[2].ClawTrailerMatch==='title-year','owned (title+year): card is the library movie');
 ok(on[3].Id==='tr-unowned' && on[3].Type==='Trailer','unowned trailer unchanged');
 ok(on[4].Id==='tr-extra' && on[4].Type==='Trailer' && !on[4].ClawReplacedTrailer,'local extra unchanged');
 ok(await p.evaluate(()=>[...document.querySelectorAll('.card')].map(c=>c.getAttribute('data-id')).join(',')), 'ids rendered');
 const hrefs=await p.$$eval('.card',a=>a.map(x=>x.getAttribute('href')));
 ok(hrefs[0]==='#/item?id=mv-silence' && hrefs[3]==='#/item?id=tr-unowned','link/play target follows the swapped or original id');
 ok((await p.evaluate(()=>window.__mapCalls))>=1,'on: one lookup batch');

 // second load uses cache (wrap still calls getJSON('home') then maybe map; cached ids should not refetch)
 await p.evaluate(()=>{ window.__mapCalls=0; });
 await p.evaluate(()=>window.__boot());
 ok(await p.evaluate(()=>window.__mapCalls)===0,'cached: no second lookup');

 fs.mkdirSync(SHOT,{recursive:true});
 await p.screenshot({path:path.join(SHOT,'trailers-replaced.png')});
 // settings screenshot of the Item pages tab is taken by a dedicated shot below if page exists

 ok(!p.errs.length,'no page errors '+(p.errs||[]).join('|'));
 await b.close();
 console.log(P+' passed, '+F+' failed');
 process.exit(F?1:0);
})();
