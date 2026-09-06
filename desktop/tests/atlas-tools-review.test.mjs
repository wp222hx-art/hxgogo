import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as core from '../../public/static/atlas-core.js'

// The module executes unchanged against a tiny DOM/event boundary; no browser or real profile is used.
const source=readFileSync(new URL('../../public/static/atlas-tools.js',import.meta.url),'utf8').replace("import * as core from './atlas-core.js'",'').replace('export async function renderTool','async function renderTool')
class Element {
  constructor(){this.children=new Map();this.handlers={};this.value='';this.checked=false;this.innerHTML='';this.textContent='';this.appended=[];this.style={}}
  querySelector(key){if(!this.children.has(key))this.children.set(key,new Element());return this.children.get(key)}
  querySelectorAll(){return []}
  addEventListener(event,handler){this.handlers[event]=handler}
  append(...nodes){this.appended.push(...nodes)}
  async fire(event='click'){return this.handlers[event]?.({target:this})}
  click(){} remove(){} select(){}
}
const digits3={min:0,max:9,count:3,ordered:true,replacement:true}
const any2={min:1,max:11,count:2,ordered:false,replacement:false}
function fixture(extra={}) {
  const captured={notifications:[],saved:[],copied:null,download:null,timers:0}
  const document={createElement:()=>new Element(),body:new Element(),execCommand:()=>true}
  const tools=new Function('core','navigator','document','URL','setTimeout','setInterval','clearInterval','fetch', source+'\nreturn {renderMonitor,renderKline,renderSettings,renderOmissions};')(
    core,{clipboard:{writeText:async text=>{captured.copied=text}}},document,{createObjectURL:blob=>{captured.download=blob;return 'blob:review'},revokeObjectURL:()=>{}},()=>0,()=>++captured.timers,()=>{},async()=>({ok:true,json:async()=>JSON.parse(readFileSync(new URL('../../public/static/atlas-screenshots.json',import.meta.url),'utf8'))})
  )
  const ctx={el:new Element(),source:{id:'local:digits3',schemaId:'digits3'},rule:digits3,records:[],rules:[],options:{},params:{},projection:'front3',zone:'front',workspace:{presets:[],monitors:[],preferences:{}},notify:text=>captured.notifications.push(text),saveWorkspace:async w=>captured.saved.push(structuredClone(w)),reload:async()=>{},navigate:async()=>{},...extra}
  return {ctx,tools,captured,action:id=>ctx.el.querySelector('[data-action="'+id+'"]')}
}
function preset(ctx,extra={}) {return {id:'review',name:'review',sourceId:ctx.source.id,schemaId:ctx.source.schemaId,projection:ctx.projection,zone:ctx.zone,rule:structuredClone(ctx.rule),rules:[],options:{},params:{},...extra}}
const row=(period,numbers,previousContiguous=true)=>({period,numbers,previousContiguous})

test('monitor window loss resets prior miss count without fabricating intervening results',async()=>{
  const f=fixture({records:[row('p5',[1,2,3]),row('p6',[2,3,4])]});
  f.ctx.workspace.monitors=[{name:'old',sourceId:f.ctx.source.id,preset:preset(f.ctx),running:true,lastSeenPeriod:'p1',currentMiss:8,log:[]}];
  await f.tools.renderMonitor(f.ctx);
  assert.equal(f.ctx.workspace.monitors[0].lastSeenPeriod,'p6');
  assert.equal(f.ctx.workspace.monitors[0].currentMiss,null);
  assert.deepEqual(f.ctx.workspace.monitors[0].log,[]);
});

test('monitor known gap keeps cross-period outcome unknown and records the next valid hit',async()=>{
  const f=fixture({records:[row('p1',[1,1,1]),row('p3',[2,2,2],false),row('p4',[3,3,3])]});
  f.ctx.workspace.monitors=[{name:'delta3',sourceId:f.ctx.source.id,preset:preset(f.ctx,{rules:[{metricId:'sumAmplitude',values:[3],minHits:1,maxHits:1}]}),running:true,lastSeenPeriod:'p1',currentMiss:4,log:[]}];
  await f.tools.renderMonitor(f.ctx);
  assert.deepEqual(f.ctx.workspace.monitors[0].log.map(r=>[r.period,r.hit]),[['p4',true],['p3',null]]);
  assert.equal(f.ctx.workspace.monitors[0].currentMiss,0);
});

test('任二 monitor compares candidates against all five observed numbers exactly once per period',async()=>{
  const f=fixture({source:{id:'local:eleven5',schemaId:'eleven5'},rule:any2,projection:'any2',records:[row('p1',[1,2,3,4,5],null),row('p2',[5,4,3,2,1],null),row('p3',[2,3,4,6,7],null)]});
  f.ctx.workspace.monitors=[{name:'1+5',sourceId:f.ctx.source.id,preset:preset(f.ctx,{kind:'numbers',numbers:[[1,5]]}),running:true,lastSeenPeriod:'p1',currentMiss:0,log:[]}];
  await f.tools.renderMonitor(f.ctx);
  assert.deepEqual(f.ctx.workspace.monitors[0].log.map(r=>[r.period,r.hit]),[['p3',false],['p2',true]]);
  assert.equal(f.ctx.workspace.monitors[0].currentMiss,1);
});

test('monitor rejects a different source and preserves complete options and parameters for copy and submit',async()=>{
  const f=fixture({records:[row('p1',[1,2,3])]});
  const p=preset(f.ctx,{rules:[{metricId:'sum',values:[10]}],options:{inverse:true,globalTolerance:1},params:{pairs:[[0,2]],smallMax:3}});
  f.ctx.workspace.monitors=[{name:'scope',sourceId:f.ctx.source.id,preset:p,running:false,log:[]}];
  let candidateArgs,applied;
  f.ctx.getCandidates=async args=>{candidateArgs=args;return {count:1,items:[{numbers:[1,2,3]}]}};
  f.ctx.applyPreset=async value=>{applied=value};
  await f.tools.renderMonitor(f.ctx);
  await f.action('copy-0').fire();
  assert.deepEqual(candidateArgs.params,p.params);assert.deepEqual(candidateArgs.rule,p.rule);assert.equal(candidateArgs.inverse,true);assert.equal(candidateArgs.globalTolerance,1);
  await f.action('submit-0').fire();assert.deepEqual(applied,p);
  f.ctx.workspace.monitors[0].preset.sourceId='qkltj:6001';
  await f.action('start-0').fire();
  assert.equal(f.ctx.workspace.monitors[0].running,false);
  assert.match(f.captured.notifications.at(-1),/其他来源或范围/);
});

test('K-line missing prior observations neither decrement the index nor join aggregates across gaps',async()=>{
  const f=fixture({records:[row('p1',[1,1,1],null),row('p2',[2,2,2]),row('p4',[3,3,3],false),row('p5',[4,4,4])],rules:[{metricId:'sumAmplitude',values:[3],minHits:1,maxHits:1}]});
  await f.tools.renderKline(f.ctx);
  const chart=f.ctx.el.querySelector('#at-kl-chart').innerHTML, summary=f.ctx.el.querySelector('#at-kl-summary').innerHTML;
  assert.match(summary,/原始样本 4 · 已知 2 · 未知 2 · 匹配 2/);
  assert.match(chart,/p2至p2 1个已知样本 开0 高1 低0 收1/);
  assert.match(chart,/p5至p5 1个已知样本 开1 高2 低1 收2/);
  assert.match(chart,/缺期或未知：中断聚合，不增减累计值/);
});

test('data export selects records by schema despite an empty events array and keeps all 77 references visible',async()=>{
  const records=[{period:'p1',numbers:[1,2,3,4,5]}];
  const f=fixture({source:{id:'qkltj:6001',schemaId:'digits5'},snapshot:{records,events:[]},records:[{period:'p1',numbers:[1,2,3]}]});
  await f.tools.renderSettings(f.ctx);await f.action('settings-export-data').fire();
  const data=JSON.parse(await f.captured.download.text());assert.deepEqual(data.records,records);
  const index=f.ctx.el.querySelector('.at-tool').appended[0];assert.match(index.querySelector('#at-index-count').textContent,/显示77\/77张/);
  assert.equal((index.querySelector('#at-index-list').innerHTML.match(/<details>/g)||[]).length,77);
  const football=fixture({source:{id:'local:football',schemaId:'football'},rule:null,snapshot:{records:[],events:[{matchId:'m1',home:'A',away:'B',status:'scheduled',homeScore:null,awayScore:null}]}});
  await football.tools.renderSettings(football.ctx);await football.action('settings-export-data').fire();
  assert.equal(JSON.parse(await football.captured.download.text()).records[0].matchId,'m1');
});

test('monitor reconciles historical corrections without creating observations or repeating reminders',async()=>{
  const f=fixture({records:[row('p0',[1,1,1]),row('p1',[1,2,3]),row('p2',[2,3,4]),row('p3',[3,4,5])]});
  f.ctx.workspace.monitors=[{name:'sum6',sourceId:f.ctx.source.id,preset:preset(f.ctx,{rules:[{metricId:'sum',values:[6],minHits:1,maxHits:1}]}),running:true,startedAfter:'p0',lastSeenPeriod:'p0',currentMiss:0,threshold:3,autoRemind:true,log:[]}];
  await f.tools.renderMonitor(f.ctx);
  assert.equal(f.ctx.workspace.monitors[0].currentMiss,2);const observedAt=f.ctx.workspace.monitors[0].log.find(r=>r.period==='p1').observedAt;
  f.ctx.records[1]=row('p1',[2,3,4]);await f.tools.renderMonitor(f.ctx);
  const m=f.ctx.workspace.monitors[0],changed=m.log.find(r=>r.period==='p1');
  assert.equal(m.log.length,3);assert.equal(m.currentMiss,3);assert.equal(m.currentMissLowerBound,false);
  assert.deepEqual(changed.numbers,[2,3,4]);assert.deepEqual(changed.originalNumbers,[1,2,3]);assert.equal(changed.originalHit,true);assert.equal(changed.hit,false);
  assert.equal(changed.observedAt,observedAt);assert.ok(changed.revisedAt);assert.equal(f.captured.notifications.length,0);assert.equal(f.captured.timers,0);
  assert.match(f.ctx.el.innerHTML,/已按当前数据重算/);
  const savedCount=f.captured.saved.length;await f.tools.renderMonitor(f.ctx);assert.equal(f.captured.saved.length,savedCount);
});

test('changing the observation baseline recomputes cross-period logs but never logs that baseline',async()=>{
  const f=fixture({records:[row('p1',[1,1,1]),row('p2',[2,2,2])]});
  f.ctx.workspace.monitors=[{name:'delta3',sourceId:f.ctx.source.id,preset:preset(f.ctx,{rules:[{metricId:'sumAmplitude',values:[3],minHits:1,maxHits:1}]}),running:true,startedAfter:'p1',lastSeenPeriod:'p1',currentMiss:0,log:[]}];
  await f.tools.renderMonitor(f.ctx);assert.equal(f.ctx.workspace.monitors[0].log[0].hit,true);
  f.ctx.records[0]=row('p1',[0,0,0]);await f.tools.renderMonitor(f.ctx);
  assert.deepEqual(f.ctx.workspace.monitors[0].log.map(r=>[r.period,r.hit]),[['p2',false]]);assert.equal(f.ctx.workspace.monitors[0].currentMiss,1);
});

test('stopped monitors still reconcile stored observations but do not consume new periods',async()=>{
  const f=fixture({records:[row('p0',[0,0,0]),row('p1',[1,2,3])]});
  f.ctx.workspace.monitors=[{name:'sum6',sourceId:f.ctx.source.id,preset:preset(f.ctx,{rules:[{metricId:'sum',values:[6],minHits:1,maxHits:1}]}),running:true,startedAfter:'p0',lastSeenPeriod:'p0',currentMiss:0,log:[]}];
  await f.tools.renderMonitor(f.ctx);f.ctx.workspace.monitors[0].running=false;
  f.ctx.records=[row('p0',[0,0,0]),row('p1',[2,3,4]),row('p2',[3,4,5])];await f.tools.renderMonitor(f.ctx);
  assert.deepEqual(f.ctx.workspace.monitors[0].log.map(r=>[r.period,r.hit]),[['p1',false]]);assert.equal(f.ctx.workspace.monitors[0].lastSeenPeriod,'p1');assert.equal(f.ctx.workspace.monitors[0].running,false);
});

test('unavailable logged periods retain their original observation and are visibly unverified',async()=>{
  const f=fixture({records:[row('p5',[1,2,3]),row('p6',[2,3,4])]});
  f.ctx.workspace.monitors=[{name:'old',sourceId:f.ctx.source.id,preset:preset(f.ctx),running:true,startedAfter:'p1',lastSeenPeriod:'p3',currentMiss:2,log:[{period:'p3',numbers:[9,9,9],hit:false,observedAt:'2026-09-01T00:00:00.000Z'}]}];
  await f.tools.renderMonitor(f.ctx);const m=f.ctx.workspace.monitors[0];
  assert.equal(m.log.length,1);assert.equal(m.log[0].verification,'outside-snapshot');assert.deepEqual(m.log[0].numbers,[9,9,9]);assert.equal(m.log[0].hit,false);assert.equal(m.currentMiss,null);assert.equal(m.lastSeenPeriod,'p6');assert.match(f.ctx.el.innerHTML,/当前快照外 \/ 未复核/);
});

test('omission view restores only applied queries and recomputes them for the latest records',async()=>{
  let clean=0;const f=fixture({records:[row('p1',[1,2,3]),row('p2',[2,3,4])],viewState:{},markClean:()=>clean++});
  await f.tools.renderOmissions(f.ctx);assert.equal(f.ctx.viewState.omissions,undefined);assert.equal(clean,0);
  for(const [id,value] of [['kind','groups'],['k','2'],['pool','1,2,3'],['sort','count'],['start','1'],['end','2']])f.ctx.el.querySelector('#at-om-'+id).value=value;
  await f.action('om-run').fire();assert.equal(clean,1);assert.equal(f.ctx.viewState.omissions.kind,'groups');assert.match(f.ctx.el.querySelector('#at-om-scope').textContent,/3组 · 2期/);
  f.ctx.el.querySelector('#at-om-pool').value='99';await f.action('om-run').fire();assert.equal(clean,1);assert.equal(f.ctx.viewState.omissions.pool,'1,2,3');
  f.ctx.records.push(row('p3',[1,2,3]));f.ctx.el=new Element();await f.tools.renderOmissions(f.ctx);
  assert.equal(f.ctx.el.querySelector('#at-om-pool').value,'1,2,3');assert.equal(f.ctx.el.querySelector('#at-om-sort').value,'count');assert.equal(f.ctx.el.querySelector('#at-om-end').value,'2');assert.match(f.ctx.el.querySelector('#at-om-scope').textContent,/3组 · 3期/);assert.equal(clean,2);
});

test('K-line retains applied selection and bucket while honoring a newly selected entry preset',async()=>{
  let clean=0;const f=fixture({records:[row('p1',[1,1,1]),row('p2',[2,2,2])],viewState:{},selectedPresetId:'a',markClean:()=>clean++});
  f.ctx.workspace.presets=[preset(f.ctx,{id:'a',rules:[{metricId:'sum',values:[3]}]}),preset(f.ctx,{id:'b',rules:[{metricId:'sum',values:[6]}]}),preset(f.ctx,{id:'c',rules:[{metricId:'sum',values:[9]}]})];
  await f.tools.renderKline(f.ctx);f.ctx.el.querySelector('#at-kl-preset').value='b';f.ctx.el.querySelector('#at-kl-bucket').value='2';await f.action('kl-run').fire();
  assert.equal(f.ctx.viewState.kline.presetId,'b');assert.equal(f.ctx.viewState.kline.bucket,2);
  f.ctx.records.push(row('p3',[3,3,3]));f.ctx.el=new Element();await f.tools.renderKline(f.ctx);
  assert.equal(f.ctx.el.querySelector('#at-kl-preset').value,'b');assert.equal(f.ctx.el.querySelector('#at-kl-bucket').value,'2');assert.match(f.ctx.el.querySelector('#at-kl-summary').innerHTML,/原始样本 3/);
  f.ctx.selectedPresetId='c';f.ctx.el=new Element();await f.tools.renderKline(f.ctx);assert.equal(f.ctx.el.querySelector('#at-kl-preset').value,'c');assert.ok(clean>=4);
});
test('editing during a pending omission query does not mark newer input clean or store it as applied',async()=>{
  let clean=0,resolve;const pending=new Promise(done=>resolve=done);
  const f=fixture({records:[row('p1',[1,2,3])],viewState:{},markClean:()=>clean++,getCandidates:()=>pending});
  await f.tools.renderOmissions(f.ctx);f.ctx.el.querySelector('#at-om-kind').value='filtered';
  const run=f.action('om-run').fire();f.ctx.el.querySelector('#at-om-kind').value='groups';f.ctx.el.querySelector('#at-om-pool').value='1,2,3';
  resolve({count:1,items:[{numbers:[1,2,3]}]});await run;
  assert.equal(clean,0);assert.equal(f.ctx.viewState.omissions.kind,'filtered');assert.equal(f.ctx.el.querySelector('#at-om-kind').value,'groups');
});

test('editing K-line settings during calculation preserves the unapplied input as dirty',async()=>{
  let clean=0;const f=fixture({records:[row('p1',[1,2,3])],viewState:{},markClean:()=>clean++});
  await f.tools.renderKline(f.ctx);assert.equal(clean,1);
  f.ctx.el.querySelector('#at-kl-bucket').value='3';const run=f.action('kl-run').fire();f.ctx.el.querySelector('#at-kl-bucket').value='17';await run;
  assert.equal(clean,1);assert.equal(f.ctx.viewState.kline.bucket,3);assert.equal(f.ctx.el.querySelector('#at-kl-bucket').value,'17');
});