import { LocalDatabase } from '../database.mjs'
import { mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
const path=process.argv[2]
if(!path || !path.startsWith('output/')) throw Error('An isolated output/ test profile is required')
mkdirSync(path,{recursive:true})
const db=new LocalDatabase(join(resolve(path),'hashplay.sqlite'),resolve('migrations'))
const numbers=Array.from({length:500},(_,i)=>String(i).padStart(3,'0')).join(' ')
try {
  for(let i=1;i<=120;i++){
    const expect='20260101'+String(i).padStart(4,'0')
    const based='20260101'+String(i-1).padStart(4,'0')
    const cutoff=Date.parse('2026-01-01T00:00:00+08:00')+i*60000
    if(i>1) await db.prepare("INSERT INTO pick_log(source,expect,count,temp,based_on,numbers,coverage,created_ms,prediction_version,cutoff_ms,prediction_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind('qkltj:6001',expect,500,1.5,based,numbers,0.7,cutoff-20000,'audit-v1',cutoff,'live').run()
    const no=String((i*37)%1000).padStart(3,'0')
    await db.prepare('INSERT INTO draws(source,expect,hash,n1,n2,n3,n4,n5,open_ms) VALUES(?,?,?,?,?,?,?,?,?)').bind('qkltj:6001',expect,'synthetic-test-fixture-'+i,...no.split('').map(Number),i%10,(i*3)%10,cutoff).run()
  }
} finally { db.close() }
process.stdout.write('Synthetic audit fixture prepared in isolated test profile.\n')
