const puppeteer=require('/workspace/jstest/node_modules/puppeteer-core');const build=require('./settings-harness.js');
let P=0,F=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);c?P++:F++;};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const path=require('path');const NEW=process.env.NEW||path.resolve(__dirname,'../..');
// OLD = a copy of the 1.2.2 plugin folder; used as the behaviour baseline (defaults to NEW = self-check).
const OLD=process.env.OLD||NEW;
(async()=>{
 const nf=build(NEW,'new'),of=build(OLD,'old');
 const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--disable-gpu','--allow-file-access-from-files']});
 async function open(f){const p=await b.newPage();p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));p.setDefaultTimeout(8000);await p.setViewport({width:1300,height:900});await p.goto('file://'+f);await sleep(500);return p;}
 const save=async p=>{await p.evaluate(()=>{window.__saved=null;document.querySelector('.clawCustomItemUiForm').dispatchEvent(new Event('submit',{cancelable:true}));});await sleep(100);return p.evaluate(()=>window.__saved);};
 const visPane=p=>p.$$eval('.ct-pane',a=>a.filter(x=>x.style.display!=='none').map(x=>x.dataset.ctpane));
 const p=await open(nf);const o=await open(of);
 await p.evaluate(()=>localStorage.removeItem('claw.customitemui.settingsTab'));await p.reload();await sleep(500);
 ok(JSON.stringify(await p.$$eval('.ct-tab',a=>a.map(x=>x.textContent)))==='["Item pages","Dashboard","General"]','three tabs: Item pages, Dashboard, General');
 ok(JSON.stringify(await visPane(p))==='["item"]','default tab is Item pages, only one pane visible');
 const paneOf=(pg,id)=>pg.$eval('#'+id,e=>(e.closest('.ct-pane')||{dataset:{}}).dataset.ctpane||'none');
 const want={item:['txtEnableMoveLinksUp','selectLinksInsertAfter','txtLinksOrder','txtHideLinksHeading','txtAlignLinksLeft','txtRemoveLinkCommas','txtLinksGap','txtEnableVlcPathLinks','txtVlcUrlTemplate','txtShowVlcIcon','txtEnableRaisedLinkButtons','txtButtonBorderRadius','txtButtonTextColor','pickButtonTextColor','txtButtonCustomCss','selectApplyMode','txtAllowedUserNames','txtAllowedUserIds'],dashboard:['chkEnableDashboardLayout','txtDashboardStackBelowPx','txtDashboardAlertsLimit','txtDashboardActivityLimit','selectDashboardNowPlayingPerRow','chkDashboardFillRows','chkDashboardActivityTable','chkDashboardAlertsTable'],general:['txtEnabled']};
 for(const t in want){const bad=[];for(const id of want[t])if(await paneOf(p,id)!==t)bad.push(id);ok(!bad.length,`${t} tab holds its ${want[t].length} controls ${bad.join(',')}`);}
 ok(await p.$eval('.cdl-wrap',e=>e.closest('.ct-pane').dataset.ctpane)==='dashboard','layout editor is on the Dashboard tab');
 const ids=pg=>pg.$$eval('form [id]',a=>a.map(x=>x.id).sort().join(','));
 ok(await ids(p)===await ids(o),'same set of form controls as 1.2.2');
 ok(await p.$$eval('button[type=submit]',a=>a.length===1&&!a[0].closest('.ct-pane')),'exactly one Save button, outside the tabs');
 ok(await p.$eval('.ct-version',e=>e.textContent)==='1.2.3.0','General shows installed version');
 const s1=await save(p),s0=await save(o);
 ok(s1&&JSON.stringify(s1)===JSON.stringify(s0),'unchanged load+save gives identical config to 1.2.2');
 // edits on every tab saved by the one Save (same as 1.2.2 with the same edits)
 const edit=async pg=>pg.evaluate(()=>{const v=(id,x)=>{const e=document.getElementById(id);if(e.type==='checkbox')e.checked=x;else e.value=x;e.dispatchEvent(new Event('change',{bubbles:true}));};
   v('txtLinksGap','1em');v('txtVlcUrlTemplate','vlc://open?{path}');v('selectApplyMode','admins');v('txtDashboardAlertsLimit','5');v('chkDashboardAlertsTable',false);v('txtEnabled',false);});
 await p.$eval('.ct-tab[data-cttab=general]',e=>e.click());await edit(p);await edit(o);
 const e1=await save(p),e0=await save(o);
 ok(e1&&JSON.stringify(e1)===JSON.stringify(e0),'edits on all three tabs saved by one Save, same as 1.2.2');
 ok(e1.LinksGap==='1em'&&e1.ApplyMode==='admins'&&e1.DashboardAlertsLimit==5&&e1.DashboardAlertsTable===false&&e1.Enabled===false,'saved values from Item, Dashboard and General tabs');
 ok(JSON.stringify(await visPane(p))==='["general"]','clicking a tab shows only that pane');
 await p.reload();await sleep(500);
 ok(JSON.stringify(await visPane(p))==='["general"]'&&await p.$eval('.ct-tab.ct-on',e=>e.dataset.cttab)==='general','last tab remembered after reload (localStorage)');
 await p.evaluate(()=>localStorage.setItem('claw.customitemui.settingsTab','bogus'));await p.reload();await sleep(500);
 ok(JSON.stringify(await visPane(p))==='["item"]','unknown saved tab falls back to Item pages');
 // over-full dashboard row -> blocked, jumps to Dashboard tab
 await p.$eval('.ct-tab[data-cttab=dashboard]',e=>e.click());await p.$eval('.cdl-tab[data-tab=table]',e=>e.click());
 await p.evaluate(()=>{const r=[...document.querySelectorAll('.cdl-tbody tr')];r[0].querySelector('.cdl-t-span').value='12';r[1].querySelector('.cdl-t-row').value=r[0].querySelector('.cdl-t-row').value;r[1].querySelector('.cdl-t-span').value='6';r[1].querySelector('.cdl-t-span').dispatchEvent(new Event('change',{bubbles:true}));});
 ok(await p.$eval('.cdl-error',e=>e.classList.contains('cdl-show')),'over-wide row flagged in the editor');
 await p.$eval('.ct-tab[data-cttab=item]',e=>e.click());
 const bad=await save(p);
 ok(bad===null&&(await p.evaluate(()=>window.__alerts.length))>0,'row over 12 still blocks saving');
 ok(JSON.stringify(await visPane(p))==='["dashboard"]','…and switches to the Dashboard tab');
 ok(await p.$eval('.cdl-tab.cdl-on',e=>e.dataset.tab)==='table','inner layout tabs (Row builder/Table) still work');
 ok(!p.errs.length&&!o.errs.length,'no page errors '+p.errs.concat(o.errs).join('|'));
 await b.close();console.log(P+' passed, '+F+' failed');process.exit(F?1:0);
})();
