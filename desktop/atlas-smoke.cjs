const {writeFileSync,readFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {DatabaseSync}=require('node:sqlite');
module.exports=async function atlasSmoke(win,result,dataDir){
  const run=code=>win.webContents.executeJavaScript(code,true);
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async expression=>{for(let i=0;i<120;i++){if(await run(expression))return;await delay(250);}throw Error('图谱交互等待超时：'+expression);};
  const clickText=async text=>run('(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==='+JSON.stringify(text)+');if(!b)throw Error("未找到按钮");b.click();})()');
  const tab=async name=>{await run('document.querySelector('+JSON.stringify('[data-atlas-tab="'+name+'"]')+').click()');await delay(160);};
  const source=async id=>{await run('(()=>{const s=document.querySelector("select[aria-label=数据来源]");s.value='+JSON.stringify(id)+';s.dispatchEvent(new Event("change",{bubbles:true}));})()');await wait('new URL(location.href).searchParams.get("source")==='+JSON.stringify(id)+' && !document.querySelector("#atlas-refresh").disabled');};
  const screenshot=async name=>{await delay(250);writeFileSync(join(dataDir,name+'.png'),(await win.webContents.capturePage()).toPNG());};
  await wait('document.querySelector("#atlas-app")?.dataset.ready==="true"');
  const rows=Array.from({length:20},(_,i)=>({period:'smoke-'+String(i+1).padStart(3,'0'),numbers:[i%10,(i*3+1)%10,(i*7+2)%10],drawAt:Date.UTC(2026,8,1,0,i)}));
  const imports=[
    {sourceId:'local:digits3',records:rows},
    {sourceId:'local:eleven5',records:rows.map((r,i)=>({...r,numbers:Array.from({length:5},(_,j)=>(i+j*2)%11+1)}))},
    {sourceId:'local:dlt',records:[{period:'smoke-001',zones:{front:[2,6,11,15,31],back:[7,8]},drawAt:Date.UTC(2026,8,1)}]},
    {sourceId:'local:football',records:[{matchId:'smoke-match-001',kickoff:Date.UTC(2026,8,1),home:'界面测试主队',away:'界面测试客队',status:'finished',homeScore:2,awayScore:1}]}
  ];
  for(const body of imports){const status=await run('fetch("/api/atlas/import",{method:"POST",headers:{"Content-Type":"application/json"},body:'+JSON.stringify(JSON.stringify(body))+'}).then(r=>r.status)');if(status!==201)throw Error('图谱测试导入失败 '+status);}
  await source('local:digits3');await wait('document.querySelector(".atlas-kpi strong")?.textContent==="1,000"');
  await screenshot('atlas-workbench');
  await clickText('＋ 添加条件');await wait('!!document.querySelector("dialog[open] .atlas-catalog-item")');
  await run('(()=>{const b=[...document.querySelectorAll(".atlas-catalog-item")].find(b=>b.querySelector("strong")?.textContent==="和值 / 和值走势");if(!b)throw Error("和值条件未找到");b.click();})()');
  await wait('!!document.querySelector("dialog[open] .atlas-value")');
  await run('[...document.querySelectorAll("dialog[open] .atlas-value")].find(b=>b.textContent==="0").click()');await clickText('保存条件');
  await wait('document.querySelectorAll(".atlas-condition").length===1 && document.querySelector(".atlas-kpi strong")?.textContent==="1"');
  await screenshot('atlas-condition');
  const exported = new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CSV下载超时')),20000);win.webContents.session.once('will-download',(_event,item)=>{const file=join(dataDir,'atlas-export.csv');item.setSavePath(file);item.once('done',(_e,status)=>{clearTimeout(timer);status==='completed'?resolve(readFileSync(file,'utf8')):reject(Error('CSV导出失败 '+status));});});});
  await clickText('导出全部 CSV');const csv=await exported;if(!csv.includes('0,0,0')||csv.trim().split(/\r?\n/).length!==2)throw Error('导出不是完整的1条候选');
  await clickText('保存方案');await wait('!!document.querySelector("dialog[open] input")');
  await run('document.querySelector("dialog[open] input").value="界面核对 · 和值0"');
  await run('(()=>{const bs=[...document.querySelectorAll("dialog[open] button")];const b=bs.find(b=>/保存/.test(b.textContent)&&!/取消/.test(b.textContent));if(!b)throw Error("方案保存按钮未找到");b.click();})()');
  await wait('!document.querySelector("dialog[open]")');
  await wait('fetch("/api/atlas/workspace").then(r=>r.json()).then(d=>d.workspace.presets.some(p=>p.name==="界面核对 · 和值0"))');
  await tab('trends');await wait('document.querySelectorAll(".atlas-trend-table tbody tr").length===20');await screenshot('atlas-trends');
  const trendLabels=await run('[...document.querySelectorAll(".atlas-trend-table tfoot tr")].map(r=>r.cells[0].textContent)');
  if(!trendLabels.includes('最大遗漏')||!trendLabels.includes('最大连出'))throw Error('遗漏统计未显示');
  for(const name of ['presets','monitor','omissions','kline','banker','assistant','calculator','settings','help']){
    await tab(name);await delay(200);
    const text=await run('document.querySelector("#atlas-content").innerText');
    if(/工具数据暂不可用|工具暂未打开|未找到|NaN|undefined/.test(text))throw Error('工具未正确显示：'+name+' '+text.slice(0,150));
  }
  await tab('omissions');await run('document.querySelector("[data-action=om-run]").click()');await wait('document.querySelector("#at-om-scope")?.textContent.includes("1000组")');
  await tab('monitor');await run('document.querySelector("[data-action=capture-0]").click()');await wait('document.querySelector("#atlas-content").innerText.includes("条件观察1")');await run('document.querySelector("[data-action=start-0]").click()');await wait('fetch("/api/atlas/workspace").then(r=>r.json()).then(d=>d.workspace.monitors[0]?.running===true)');
  const observedBody={sourceId:'local:digits3',records:[{period:'smoke-monitor-021',numbers:[0,0,0],drawAt:Date.UTC(2026,8,1,0,20)}]};
  await run('fetch("/api/atlas/import",{method:"POST",headers:{"Content-Type":"application/json"},body:'+JSON.stringify(JSON.stringify(observedBody))+'}).then(r=>r.json())');await run('document.querySelector("#atlas-refresh").click()');await wait('fetch("/api/atlas/workspace").then(r=>r.json()).then(d=>d.workspace.monitors[0]?.log?.some(x=>x.period==="smoke-monitor-021"&&x.hit===true))');await screenshot('atlas-monitor');
  await run('document.querySelector("[data-action=stop-0]").click()');await wait('fetch("/api/atlas/workspace").then(r=>r.json()).then(d=>d.workspace.monitors[0]?.running===false)');
  await tab('settings');await run('document.querySelector("#at-import-source").value="local:digits3"');
  const uiImport={sourceId:'local:digits3',records:[{period:'smoke-ui-021',numbers:[9,8,7],drawAt:Date.UTC(2026,8,1,0,21)}]};
  await run('document.querySelector("#at-data-json").value='+JSON.stringify(JSON.stringify(uiImport)));
  await run('document.querySelector("[data-action=data-import]").click()');
  await wait('fetch("/api/atlas/snapshot?source=local:digits3").then(r=>r.json()).then(d=>d.records.length===22)');
  await source('local:eleven5');await tab('conditions');await wait('document.querySelector(".atlas-kpi strong")?.textContent==="462"');
  await run('(()=>{const s=document.querySelector("select[aria-label=分析投影]");s.value="any2";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await wait('document.querySelector(".atlas-kpi strong")?.textContent==="55"');await tab('trends');await wait('document.querySelectorAll(".atlas-trend-table tbody tr").length===20');
  await screenshot('atlas-eleven5');
  await source('local:dlt');await tab('conditions');await wait('document.querySelector(".atlas-kpi strong")?.textContent==="324,632"');await tab('results');await run('document.querySelector("[data-atlas-zoned]").click()');await wait('document.querySelector("#atlas-content").innerText.includes("21,425,712")');await screenshot('atlas-dlt');
  await source('local:football');await wait('document.querySelector("#atlas-content").innerText.includes("界面测试主队")');
  await screenshot('atlas-football');
  await tab('presets');await clickText('查看 K 线');await wait('new URL(location.href).searchParams.get("source")==="local:digits3" && new URL(location.href).searchParams.get("tab")==="kline"');await wait('!document.querySelector("#atlas-content").innerText.includes("正在打开工具")');await screenshot('atlas-kline');
  await source('local:digits3');await tab('conditions');
  await wait('document.querySelector(".atlas-kpi strong")?.textContent==="1"');
  // Exercise the real page watcher against the very same isolated WAL database used by the service.
  // Never fall back to the default profile, and never press the upstream sync button in this test.
  const testDataArg=process.argv.find(arg=>arg.startsWith('--data-dir='));
  if(!process.argv.includes('--smoke-test')||!testDataArg||resolve(testDataArg.slice(11))!==resolve(dataDir))throw Error('自动更新测试必须使用显式指定的隔离冒烟数据目录');
  const liveDb=new DatabaseSync(join(dataDir,'hashplay.sqlite'));
  const liveSource='qkltj:6001';
  let automaticUpdate;
  try{
    liveDb.exec('PRAGMA busy_timeout=5000');
    const latestBefore=liveDb.prepare('SELECT MAX(open_ms) latest FROM draws WHERE source=?').get(liveSource)?.latest||0;
    const firstBoundary=Math.ceil(Math.max(Date.now(),latestBefore)/60000)*60000+60000;
    const testPeriod=boundary=>{const d=new Date(boundary+8*3600000-1);return String(d.getUTCFullYear()).padStart(4,'0')+String(d.getUTCMonth()+1).padStart(2,'0')+String(d.getUTCDate()).padStart(2,'0')+String(d.getUTCHours()*60+d.getUTCMinutes()+1).padStart(4,'0');};
    const livePeriods=Array.from({length:5},(_,i)=>testPeriod(firstBoundary+i*60000));
    const insert=liveDb.prepare('INSERT INTO draws(source,expect,hash,n1,n2,n3,n4,n5,open_ms,opennumber,src) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const add=(i,values)=>insert.run(liveSource,livePeriods[i],'synthetic-atlas-live-smoke-'+i,...values,firstBoundary+i*60000+14000,values.join(','),'smoke');
    const liveRevision=()=>liveSource+':'+String(liveDb.prepare('SELECT revision FROM atlas_source_revisions WHERE source_id=?').get(liveSource).revision);
    const currentExpression=revision=>'document.querySelector("#atlas-live-status")?.dataset.phase==="current" && document.querySelector("#atlas-live-status")?.dataset.revision==='+JSON.stringify(revision);
    const rowExpression=period=>'[...document.querySelectorAll(".atlas-trend-table tbody tr")].find(row=>row.cells[0]?.textContent.trim()==='+JSON.stringify(period)+')';
    add(0,[1,2,3,4,5]);add(1,[4,5,6,7,8]);
    await source(liveSource);await tab('conditions');
    await run('(()=>{const s=document.querySelector("select[aria-label=分析投影]");s.value="all";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
    await tab('trends');await wait('!!('+rowExpression(livePeriods[1])+')');
    const baselineRevision=liveRevision();await wait(currentExpression(baselineRevision));
    const arrivalStart=Date.now();add(2,[7,6,5,4,3]);const arrivalRevision=liveRevision();
    await wait('!!('+rowExpression(livePeriods[2])+') && ('+currentExpression(arrivalRevision)+')');
    const arrivalMs=Date.now()-arrivalStart;
    const correctionStart=Date.now();
    liveDb.prepare('UPDATE draws SET n1=9,n2=8,n3=7,n4=6,n5=5,opennumber=? WHERE source=? AND expect=?').run('9,8,7,6,5',liveSource,livePeriods[0]);
    const correctionRevision=liveRevision();
    await wait('(()=>{const row='+rowExpression(livePeriods[0])+';return row?.cells[1]?.textContent.trim()==="9 8 7 6 5" && ('+currentExpression(correctionRevision)+');})()');
    const correctionMs=Date.now()-correctionStart;
    const latestInPage=await run('document.querySelector(".atlas-trend-table tbody tr:last-child td")?.textContent.trim()');
    if(latestInPage!==livePeriods[2])throw Error('历史修正错误地改变了最新期');
    await screenshot('atlas-auto-update');

    await tab('conditions');await wait('document.querySelector("#atlas-content").innerText.includes('+JSON.stringify('期号 '+livePeriods[2])+')');
    const conditionsBefore=await run('document.querySelectorAll(".atlas-condition").length');
    await clickText('＋ 添加条件');await wait('!!document.querySelector("dialog[open] .atlas-catalog-item")');
    await run('(()=>{const b=[...document.querySelectorAll(".atlas-catalog-item")].find(b=>b.querySelector("strong")?.textContent==="和值 / 和值走势");if(!b)throw Error("和值编辑入口未找到");b.click();})()');
    await wait('!!document.querySelector("dialog[open] .atlas-value")');
    await run('(()=>{const b=[...document.querySelectorAll("dialog[open] .atlas-value")].find(b=>b.textContent==="17");b.click();const fields=[["至少命中个数","2"],["最多命中个数","3"],["每条条件容错个数","1"]];for(const [label,value] of fields){const input=document.querySelector("dialog[open] input[aria-label="+JSON.stringify(label)+"]");input.value=value;input.dispatchEvent(new Event("input",{bubbles:true}));}})()');
    const editorExpression='(()=>{const d=document.querySelector("dialog[open]");return d?{values:[...d.querySelectorAll(".atlas-value.active")].map(b=>b.textContent),inputs:[...d.querySelectorAll("input[type=number]")].map(i=>i.value)}:null;})()';
    const draftBefore=await run(editorExpression);
    add(3,[8,8,8,8,8]);const pendingRevision=liveRevision();
    await wait('document.querySelector("#atlas-live-status")?.dataset.phase==="pending"');
    const draftAfter=await run(editorExpression);
    if(JSON.stringify(draftBefore)!==JSON.stringify(draftAfter))throw Error('自动更新覆盖了正在编辑的条件');
    if(!await run('document.querySelector("#atlas-content").innerText.includes('+JSON.stringify('期号 '+livePeriods[2])+')'))throw Error('编辑过程中提前替换了当前观察数据');
    await screenshot('atlas-update-pending');
    await run('document.querySelector("dialog[open] button[aria-label="+JSON.stringify("关闭对话框")+"]").click()');
    await wait('!document.querySelector("dialog[open]")');
    if(await run('!!document.querySelector("#atlas-apply-update")'))await run('document.querySelector("#atlas-apply-update").click()');
    await wait('document.querySelector("#atlas-content").innerText.includes('+JSON.stringify('期号 '+livePeriods[3])+') && ('+currentExpression(pendingRevision)+')');
    if(await run('document.querySelectorAll(".atlas-condition").length')!==conditionsBefore)throw Error('取消编辑后条件数量发生变化');
    await wait('!!document.querySelector(".atlas-kpi strong")');
    const observationExpression='document.querySelector("#atlas-content .atlas-work-grid > .atlas-stack > .atlas-card")?.innerText';
    const observationBeforeOffline=await run(observationExpression);
    if(!observationBeforeOffline?.includes(livePeriods[3]))throw Error('断线测试前没有当前观察数据');
    // The failure is confined to this renderer's status fetch; the server and upstream fetch remain untouched.
    await run('(()=>{if(window.__atlasSmokeOriginalFetch)throw Error("测试fetch已经被替换");const original=window.fetch;window.__atlasSmokeOriginalFetch=original;window.fetch=function(...args){const target=args[0];const url=new URL(typeof target==="string"?target:(target?.url||String(target)),location.href);if(url.pathname==="/api/atlas/status")return Promise.reject(new Error("smoke-only status outage"));return original.apply(this,args);};})()');
    await wait('document.querySelector("#atlas-live-status")?.dataset.phase==="offline"');
    if(await run(observationExpression)!==observationBeforeOffline)throw Error('状态查询断线后丢失或替换了旧快照');
    add(4,[2,4,6,8,0]);const recoveredRevision=liveRevision();
    if(!await run('document.querySelector("#atlas-content").innerText.includes('+JSON.stringify('期号 '+livePeriods[3])+')'))throw Error('断线时错误地声称已显示新数据');
    await screenshot('atlas-offline-preserved');
    const recoveryStart=Date.now();
    await run('(()=>{window.fetch=window.__atlasSmokeOriginalFetch;delete window.__atlasSmokeOriginalFetch;window.dispatchEvent(new Event("online"));})()');
    await wait('document.querySelector("#atlas-content").innerText.includes('+JSON.stringify('期号 '+livePeriods[4])+') && ('+currentExpression(recoveredRevision)+')');
    const recoveryMs=Date.now()-recoveryStart;await screenshot('atlas-auto-recovered');
    automaticUpdate={newArrival:true,historicalCorrection:true,latestPeriodUnchangedOnCorrection:true,noManualRefresh:true,editorPendingPreserved:true,pendingApplied:true,offlineSnapshotPreserved:true,onlineRecovery:true,arrivalMs,correctionMs,recoveryMs,revisions:[baselineRevision,arrivalRevision,correctionRevision,pendingRevision,recoveredRevision]};
  }finally{await run("(()=>{if(window.__atlasSmokeOriginalFetch){window.fetch=window.__atlasSmokeOriginalFetch;delete window.__atlasSmokeOriginalFetch;}})()").catch(()=>{});liveDb.close();}
  await source('local:digits3');await tab('conditions');await wait('document.querySelector(".atlas-kpi strong")?.textContent==="1"');
  result.atlas={ready:true,conditions:true,worker:true,sourceIsolation:true,projection:true,trendRows:20,tools:10,importViaUI:true,presetSaved:true,football:true,fullCsv:true,zonedCombination:true,omissionQuery:true,monitorNewArrival:true,automaticUpdate};
};
