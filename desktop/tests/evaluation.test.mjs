import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LocalDatabase } from '../database.mjs'
mkdirSync('output/tests', { recursive: true })
const dir = mkdtempSync(resolve('output/tests/evaluation-'))
await build({ entryPoints:['src/pick_track.ts','src/evaluation.ts'], outdir:dir, bundle:true, format:'esm', platform:'node' })
const { wilsonInterval, evaluationSummary } = await import(pathToFileURL(join(dir,'evaluation.js')))
const { recordPick, pickTrack } = await import(pathToFileURL(join(dir,'pick_track.js')))
test('fixed-strategy interval and calibration diagnostic have known values; correlated configurations suppress inference', () => {
  const ci=wilsonInterval(550,1000)
  assert.ok(Math.abs(ci.lo-0.519032)<0.000002)
  const rows=Array.from({length:100},(_,i)=>({expect:String(i),count:500,hit:i%2,coverage:0.5}))
  const ev=evaluationSummary(rows)
  assert.equal(ev.calibration.brier,0.25)
  assert.equal(ev.calibration.baseline_brier,0.25)
  assert.ok(Math.abs(ev.calibration.log_loss-Math.log(2))<1e-12)
  assert.equal(ev.calibration.bins[0].observed_rate,0.5)
  assert.equal(ev.calibrated,false)
  assert.equal(evaluationSummary([...rows,rows[0]]).interval95,null)
  assert.equal(evaluationSummary([...rows,rows[0]]).z,null)
  assert.equal(evaluationSummary([]).rate,null)
})
test('pick snapshots verify deadlines, preserve first values and rescore corrected draws', async () => {
  const db=new LocalDatabase(join(dir,'picks.sqlite'),resolve('migrations'))
  const source='qkltj:6001', nums=Array.from({length:100},(_,i)=>String(i).padStart(3,'0'))
  try {
    const s={source,next_expect:'209901010002',latest_expect:'209901010001',count:100,temp:1.5,numbers:nums,coverage:0.12}
    assert.equal(await recordPick(db,s),true)
    assert.equal(await recordPick(db,{...s,coverage:0.9}),false)
    assert.equal(await recordPick(db,{...s,next_expect:'209901010003',numbers:['000','000']}),false)
    assert.equal(await recordPick(db,{...s,next_expect:'202001010002',latest_expect:'202001010001'}),true)
    await db.prepare('INSERT INTO draws (source,expect,n1,n2,n3,n4,n5,hash,open_ms) VALUES (?,?,?,?,?,?,?,?,?)').bind(source,s.next_expect,0,0,0,1,1,'synthetic',Date.now()).run()
    let stat=await pickTrack(db,source,{count:100,temp:1.5})
    assert.equal(stat.n,1);assert.equal(stat.hits,1)
    assert.equal(stat.calibration.n,1)
    assert.ok(stat.archive.some(x=>x.status==='late'&&x.n===1))
    await assert.rejects(db.prepare("UPDATE pick_log SET coverage=0.9").run())
    await assert.rejects(db.prepare("DELETE FROM pick_log").run())
    await db.prepare('UPDATE draws SET n1=9,n2=9,n3=9 WHERE source=? AND expect=?').bind(source,s.next_expect).run()
    stat=await pickTrack(db,source,{count:100,temp:1.5})
    assert.equal(stat.hits,0);assert.equal(stat.recent[0].actual,'999')
  } finally { db.close() }
})
