import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdirSync, mkdtempSync, readdirSync, copyFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LocalDatabase } from '../database.mjs'

mkdirSync('output/tests',{recursive:true})
const run=mkdtempSync(resolve('output/tests/atlas-sync-')),modulePath=join(run,'atlas-api.mjs')
await build({stdin:{contents:"export * from './src/atlas-api.ts'; export * from './src/period.ts'",resolveDir:process.cwd()},outfile:modulePath,bundle:true,format:'esm',platform:'node',target:'node24',logLevel:'silent'})
const {atlasApi,periodTimeMs,periodAtTimeMs}=await import(pathToFileURL(modulePath))
const migrations=resolve('migrations'), source='qkltj:6001'
const database=(path=':memory:',schema=migrations)=>new LocalDatabase(path,schema)
async function request(db,method,path,body,app=atlasApi){const response=await app.request(path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},{DB:db});return{status:response.status,headers:response.headers,body:await response.json()}}
const status=async(db,id=source)=>(await request(db,'GET','/status?source='+id)).body
const snapshot=async(db,id=source,limit=300)=>(await request(db,'GET','/snapshot?source='+id+'&limit='+limit)).body
const revision=async(db,id=source)=>(await status(db,id)).revision
const add=async(db,period='202609060001',id=source,numbers=[1,2,3,4,5])=>db.prepare('INSERT INTO draws(source,expect,hash,n1,n2,n3,n4,n5,open_ms) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,period,'public-test-hash',...numbers,periodTimeMs(period,id)).run()
const count=async(db,table)=>(await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n
const tokenNumber=token=>Number(token.slice(token.lastIndexOf(':')+1))

test('status and snapshots are read-only views of the canonical rows with one durable version',async()=>{
  const db=database(),originalFetch=globalThis.fetch;let fetches=0
  globalThis.fetch=async()=>{fetches++;throw Error('Reads may not contact an upstream')}
  try{
    await add(db);await add(db,'202609060002');
    const before=(await db.prepare('SELECT total_changes() n').first()).n
    const s=await status(db),data=await snapshot(db),response=await request(db,'GET','/status?source='+source)
    assert.equal(s.revision,data.revision);assert.equal(s.count,2);assert.equal(data.count,2);assert.equal(s.latestPeriod,'202609060002')
    assert.equal(s.readOnly,true);assert.equal(s.storage,'canonical-draws');assert.equal(s.sync.supported,true);assert.equal(s.sync.lastSuccessAt,null)
    assert.equal(s.records,undefined);assert.equal(s.events,undefined);assert.equal(data.records.length,2)
    assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(fetches,0)
    assert.equal((await db.prepare('SELECT total_changes() n').first()).n,before);assert.equal(await count(db,'atlas_records'),0)
    assert.equal((await status(db,'local:dlt')).sync.supported,false)
  }finally{globalThis.fetch=originalFetch;db.close()}
})

test('historical corrections, every stored draw field, deletes and source moves advance versions; no-ops do not',async()=>{
  const db=database()
  try{
    await add(db);await add(db,'202609060002');
    const initial=await status(db),newest=initial.latestPeriod
    await db.prepare('UPDATE draws SET n1=n1,opennumber=opennumber,src=src WHERE source=?').bind(source).run()
    assert.equal(await revision(db),initial.revision)
    const changes={n1:2,n2:3,n3:4,n4:5,n5:6,open_ms:periodTimeMs('202609060001',source)+1,hash:'corrected-public-hash',block:9,opennumber:'2,3,4,5,6',lotto_type:'test',lotto_type_cn:'public test',open_time:'2026-09-06 00:01:01',src_id:7,mismatch:1,src:'api'}
    let previous=tokenNumber(initial.revision)
    for(const [field,value] of Object.entries(changes)){
      await db.prepare('UPDATE draws SET '+field+'=? WHERE source=? AND expect=?').bind(value,source,'202609060001').run()
      const current=await status(db);assert.equal(tokenNumber(current.revision),++previous,'changed field '+field);assert.equal(current.latestPeriod,newest);assert.equal(current.count,2)
    }
    const data=await snapshot(db);assert.deepEqual(data.records[0].numbers,[2,3,4,5,6]);assert.equal(data.records.at(-1).period,newest)
    await db.prepare('UPDATE draws SET expect=? WHERE source=? AND expect=?').bind('202609060003',source,'202609060001').run()
    assert.equal(tokenNumber(await revision(db)),++previous)
    await db.prepare('UPDATE draws SET source=? WHERE source=? AND expect=?').bind('qkltj:7001',source,'202609060003').run()
    assert.equal(tokenNumber(await revision(db)),++previous);assert.equal(await revision(db,'qkltj:7001'),'qkltj:7001:1')
    await db.prepare('DELETE FROM draws WHERE source=?').bind('qkltj:7001').run();assert.equal(await revision(db,'qkltj:7001'),'qkltj:7001:2');assert.equal((await status(db,'qkltj:7001')).count,0)
    assert.equal(await revision(db,'qkltj:6002'),'qkltj:6002:0')
  }finally{db.close()}
})

test('failed transactions roll back both row mutations and their revision increments',async()=>{
  const db=database();try{
    await add(db);const before=await revision(db)
    const insert=period=>db.prepare('INSERT INTO draws(source,expect,hash,n1,n2,n3,n4,n5,open_ms) VALUES(?,?,?,?,?,?,?,?,?)').bind(source,period,'public-marker',1,2,3,4,5,periodTimeMs(period,source))
    await assert.rejects(db.batch([insert('202609060002'),insert('202609060001')]),/UNIQUE/)
    assert.equal(await revision(db),before);assert.equal((await snapshot(db)).records.length,1)
  }finally{db.close()}
})

test('snapshot rows, count and revision cannot tear when a new write follows its first database read',async()=>{
  const db=database();try{
    await add(db);let reads=0
    const afterRead=async result=>{if(++reads===1)await add(db,'202609060002');return result}
    const boundary={prepare(sql){const native=db.prepare(sql);return{bind(...args){const statement=native.bind(...args);return{first:async()=>afterRead(await statement.first()),all:async()=>afterRead(await statement.all())}}}}}
    const result=await snapshot(boundary)
    assert.equal(reads,1);assert.equal(result.count,1);assert.equal(result.revision,'qkltj:6001:1');assert.deepEqual(result.records.map(r=>r.period),['202609060001'])
    const after=await status(db);assert.equal(after.count,2);assert.equal(after.revision,'qkltj:6001:2')
  }finally{db.close()}
})

test('migration seeds existing data and tokens survive closing the database and reloading the application module',async()=>{
  const oldMigrations=join(run,'pre-revisions');mkdirSync(oldMigrations)
  for(const name of readdirSync(migrations).filter(name=>name.endsWith('.sql')&&name<'0018'))copyFileSync(join(migrations,name),join(oldMigrations,name))
  const file=join(run,'restart.sqlite');let db=database(file,oldMigrations)
  await add(db);await add(db,'202609060002');db.close();db=database(file)
  const token=await revision(db);assert.equal(token,'qkltj:6001:2');db.close()
  const freshModule=await import(pathToFileURL(modulePath).href+'?restart');db=database(file)
  try{const result=await request(db,'GET','/snapshot?source='+source,undefined,freshModule.atlasApi);assert.equal(result.body.revision,token);assert.equal(result.body.records.length,2)}finally{db.close()}
})

test('local imported records receive the same durable correction/delete contract without copying canonical draws',async()=>{
  const db=database(),id='local:digits3';try{
    const imported=await request(db,'POST','/import',{sourceId:id,records:[{period:'p1',numbers:[1,2,3],drawAt:'2026-09-06T12:00:00+08:00'},{period:'p2',numbers:[4,5,6],drawAt:'2026-09-06T12:01:00+08:00'}]})
    assert.equal(imported.status,201);const initial=await status(db,id);assert.equal(initial.revision,'local:digits3:2')
    await db.prepare('UPDATE atlas_records SET record_json=record_json WHERE source_id=?').bind(id).run();assert.equal(await revision(db,id),initial.revision)
    await db.prepare("UPDATE atlas_records SET record_json=json_set(record_json,'$.numbers',json('[3,2,1]')) WHERE source_id=? AND record_key='p1'").bind(id).run()
    const current=await snapshot(db,id);assert.equal(current.revision,'local:digits3:3');assert.equal(current.latestPeriod,'p2');assert.deepEqual(current.records[0].numbers,[3,2,1]);assert.equal(current.count,2)
    await db.prepare("DELETE FROM atlas_records WHERE source_id=? AND record_key='p1'").bind(id).run();assert.equal(await revision(db,id),'local:digits3:4');assert.equal(await count(db,'draws'),0)
  }finally{db.close()}
})

function upstreamRow(numbers=[1,2,3,4,5]){
  const period=periodAtTimeMs(Date.now()-60000,source),time=periodTimeMs(period,source)+14000
  return{expect:period,hash:'a12345',opennumber:numbers.join(','),block:1,openTime:new Date(time+8*3600000).toISOString().slice(0,19).replace('T',' ')}
}
test('sync endpoint accepts only supported real sources and returns canonical status without AI or strategy work',async()=>{
  const db=database(),originalFetch=globalThis.fetch;let fetches=0,payload=upstreamRow()
  globalThis.fetch=async()=>{fetches++;return new Response(JSON.stringify({code:0,data:[payload]}),{headers:{'Content-Type':'application/json'}})}
  try{
    assert.equal((await request(db,'POST','/sync',{sourceId:'local:digits3'})).status,403)
    assert.equal((await request(db,'POST','/sync',{sourceId:'local:five'})).status,404)
    assert.equal((await request(db,'POST','/sync',{sourceId:'unknown'})).status,404)
    assert.equal((await request(db,'POST','/sync',{sourceId:source,force:1})).status,400)
    assert.equal((await request(db,'POST','/sync',{sourceId:source,tick:true})).status,400)
    assert.equal(fetches,0)
    const first=await request(db,'POST','/sync',{sourceId:source});assert.equal(first.status,200);assert.equal(first.body.result.inserted,1);assert.equal(first.body.status.count,1)
    const version=first.body.status.revision;assert.equal((await snapshot(db)).revision,version)
    const immediate=await request(db,'POST','/sync',{sourceId:source,force:true});assert.equal(immediate.status,200);assert.equal(immediate.body.result.skipped,true);assert.equal(fetches,1)
    await db.prepare('UPDATE sync_meta SET last_sync_ms=? WHERE source=?').bind(Date.now()-5000,source).run()
    payload={...payload,opennumber:'5,4,3,2,1'}
    const corrected=await request(db,'POST','/sync',{sourceId:source,force:true});assert.equal(corrected.status,200);assert.equal(corrected.body.result.updated,1);assert.notEqual(corrected.body.status.revision,version);assert.equal(corrected.body.status.count,1)
    assert.deepEqual((await snapshot(db)).records[0].numbers,[5,4,3,2,1]);assert.equal(fetches,2)
    for(const table of ['atlas_records','arena_rounds','ai_forecasts'])assert.equal(await count(db,table),0,table+' must stay untouched')
  }finally{globalThis.fetch=originalFetch;db.close()}
})

test('empty upstream response surfaces a sync error while existing rows and their version remain intact',async()=>{
  const db=database(),originalFetch=globalThis.fetch
  globalThis.fetch=async()=>new Response(JSON.stringify({code:0,data:[]}),{headers:{'Content-Type':'application/json'}})
  try{
    await add(db);const before=await revision(db)
    const result=await request(db,'POST','/sync',{sourceId:source,force:true})
    assert.equal(result.status,502);assert.equal(result.body.ok,false);assert.equal(result.body.code,'UPSTREAM_SYNC_FAILED');assert.equal(result.body.status.revision,before);assert.equal(result.body.status.count,1)
    assert.ok(result.body.status.sync.lastError);assert.equal((await status(db)).sync.failStreak,1)
  }finally{globalThis.fetch=originalFetch;db.close()}
})
