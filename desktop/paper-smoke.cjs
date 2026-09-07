const {writeFileSync,readFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {DatabaseSync}=require('node:sqlite');
module.exports=async function paperSmoke(win,result,dataDir){
 const arg=process.argv.find(a=>a.startsWith('--data-dir='));if(!arg||resolve(arg.slice(11))!==resolve(dataDir)||!process.argv.includes('--smoke-test'))throw Error('模拟测试必须使用独立数据目录');
 const run=s=>win.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async s=>{for(let i=0;i<150;i++){if(await run(s))return;await delay(200)}throw Error('模拟界面等待超时 '+s)};
 const shot=async name=>{await delay(200);writeFileSync(join(dataDir,name+'.png'),(await win.webContents.capturePage()).toPNG())};
 const source='qkltj:6002',interval=180000;
 const period=ms=>{const d=new Date(ms+8*3600000),day=d.toISOString().slice(0,10).replaceAll('-',''),n=(d.getUTCHours()*60+d.getUTCMinutes())/3;return n===0?period(ms-interval).slice(0,8)+'480':day+String(n).padStart(3,'0')};
 const remaining=interval-Date.now()%interval;if(remaining<18000)await delay(remaining+30);
 const last=Math.floor(Date.now()/interval)*interval,db=new DatabaseSync(join(dataDir,'hashplay.sqlite'));db.exec('PRAGMA busy_timeout=5000');
 try{
  const insert=db.prepare("INSERT OR IGNORE INTO draws(source,expect,hash,n1,n2,n3,n4,n5,open_ms) VALUES(?,?,'synthetic-paper',?,?,?,?,?,?)");
  db.exec('BEGIN IMMEDIATE');for(let i=0;i<270;i++)insert.run(source,period(last-i*interval),i%10,(i*3+1)%10,(i*7+2)%10,1,2,last-i*interval);db.exec('COMMIT');
  await win.loadURL('hashplay://app/simulator?source='+source);await wait('!!document.querySelector("#p-replay")');
  await run('document.querySelector("#p-ref").value="1";document.querySelector("#p-ref").dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("#p-replay").click()');
  await wait('!!document.querySelector("#p-export-result")');await shot('paper-replay');
  const forecast=await run('document.querySelector("#paper-evidence").innerText');if(!forecast.includes('下一期已校准概率：尚无'))throw Error('模拟结果误当未来概率');
  await run('document.querySelector("#p-name").value="界面模拟验证";document.querySelector("#p-start").click()');
  await wait('document.querySelector("#paper-bots").innerText.includes("界面模拟验证")');
  await wait('fetch("/api/paper/bots?source=qkltj:6002").then(r=>r.json()).then(d=>d.bots[0]?.rows.length===1)');
  const order=db.prepare('SELECT o.* FROM paper_orders o JOIN paper_bots b ON b.id=o.bot_id WHERE b.source=?').get(source);
  if(order.stake_cents!==3000)throw Error('模拟金额错误');
  await run('document.querySelector("[data-control=pause]").click()');await wait('document.querySelector("#paper-bots").innerText.includes("已暂停")');
  const nums=JSON.parse(order.numbers)[0].split('').map(Number);insert.run(source,order.expect,...nums,1,2,order.cutoff_ms);
  await run('document.querySelector("#paper-refresh-bots").click()');await wait('document.querySelector("[data-control=resume]")');
  await run('document.querySelector("[data-control=resume]").click()');await wait('document.querySelector("#paper-bots").innerText.includes("运行中")');
  await run('document.querySelector("#paper-bots details").open=true');await shot('paper-live-bot');
  const downloaded=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('模拟导出超时')),15000);win.webContents.session.once('will-download',(_,item)=>{const file=join(dataDir,'paper-export.json');item.setSavePath(file);item.once('done',(_,state)=>{clearTimeout(timer);if(state!=='completed')return reject(Error(state));const doc=JSON.parse(readFileSync(file,'utf8'));resolve(doc)})})});
  await run('document.querySelector("[data-export]").click()');const exported=await downloaded;if(exported.bot.rows.length!==1||exported.bot.rows[0].stake_cents!==3000)throw Error('模拟账本导出不完整');
  await run('document.querySelector("[data-control=stop]").click()');await wait('document.querySelector("#paper-bots").innerText.includes("已结束")');
  win.setMinimumSize(360,600);win.setSize(420,900);await delay(200);await shot('paper-mobile');if(await run('document.documentElement.scrollWidth>innerWidth+1'))throw Error('模拟界面窄屏溢出');
  win.setSize(1360,920);win.setMinimumSize(1050,700);
  result.paper={replay:true,liveOrder:true,amountCorrect:true,pauseResume:true,stop:true,fullExport:true,probabilityHonest:true,mobileNoOverflow:true};
 }finally{db.close()}
};
