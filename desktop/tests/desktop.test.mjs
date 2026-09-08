import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { LocalDatabase } from '../database.mjs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { startService } = require('../../desktop-build/service.cjs')
mkdirSync('output/tests', { recursive: true })
const root = resolve('desktop-build')
const temporary = () => mkdtempSync(resolve('output/tests/run-'))
const token = 'test-only-application-token-0123456789abcdef'

test('all migrations, batch rollback, backup and restart persistence', async () => {
  const dir = temporary(), file = join(dir, 'data.sqlite')
  let db = new LocalDatabase(file, join(root, 'migrations'))
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM desktop_migrations').first()).n, 21)
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO app_config VALUES ('test','first',1)"),
    db.prepare("INSERT INTO app_config VALUES ('test','duplicate',2)")
  ]))
  assert.equal(await db.prepare("SELECT * FROM app_config WHERE key='test'").first(), null)
  await db.batch([db.prepare("INSERT INTO app_config VALUES ('test','persisted',1)")])
  await db.backup(join(dir, 'backup.sqlite'))
  db.close()
  db = new LocalDatabase(file, join(root, 'migrations'))
  assert.equal(await db.prepare("SELECT value FROM app_config WHERE key='test'").first('value'), 'persisted')
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM desktop_migrations').first()).n, 21)
  db.close()
  const restored = new LocalDatabase(join(dir, 'backup.sqlite'), join(root, 'migrations'))
  assert.equal(await restored.prepare("SELECT value FROM app_config WHERE key='test'").first('value'), 'persisted')
  restored.close()
})

test('private local service, offline assets, encrypted-store contract and persisted account', async () => {
  const dir = temporary(), values = {}
  const secrets = {
    async load() { return { ...values } },
    async save(patch) { for (const [k,v] of Object.entries(patch)) v ? values[k] = v : delete values[k] }
  }
  let service = await startService({ root, dataDir: dir, token, secrets, background: false })
  const request = (path, init = {}) => fetch(service.origin + path, { ...init, headers: { 'x-hashplay-app': token, ...init.headers } })
  try {
    assert.equal((await fetch(service.origin + '/api/config')).status, 403)
    assert.equal((await request('/api/config', { headers: { Origin: 'https://untrusted.example' } })).status, 403)
    assert.equal((await request('/api/config', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
    for (const route of ['/workspace','/simulator','/','/settings','/query','/analysis','/arena','/ai','/top3','/atlas']) {
      const response = await request(route), html = await response.text()
      assert.equal(response.status, 200, route)
      assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"))
      assert.doesNotMatch(html, /(?:src|href)="https:\/\/cdn\./)
    }
    for (const path of ['/vendor/tailwind.css','/vendor/axios.min.js','/vendor/chart.umd.js','/vendor/echarts.min.js','/vendor/fontawesome/css/all.min.css','/static/settings.js','/static/atlas.js','/static/atlas-core.js','/static/atlas-tools.js','/static/atlas.css','/static/atlas.svg','/static/platform.css','/static/platform.js','/static/themes.css','/static/themes.js','/static/studio.css','/static/studio.js','/static/paper.js','/static/paper.css']) {
      const response = await request(path)
      assert.equal(response.status, 200, path)
      assert.ok((await response.arrayBuffer()).byteLength > 100, path)
    }
    const initial = await (await request('/api/config')).json()
    assert.equal(initial.items.AI_PROVIDER.value, 'disabled')
    assert.equal(initial.effective, null)
    const disabledResponse = await request('/api/arena/pick')
    assert.equal(disabledResponse.status, 200)
    const disabledState = await disabledResponse.json()
    assert.equal(disabledState.code, 'AI_DISABLED')
    assert.equal(disabledState.settings_url, '/settings')
    assert.equal((await request('/api/arena/pick?source=invalid')).status, 400)
    for (const provider of ['openai', 'local']) {
      await request('/api/config', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({AI_PROVIDER:provider}) })
      const incomplete = await request('/api/arena/pick')
      assert.equal(incomplete.status, 200)
      assert.equal((await incomplete.json()).code, 'AI_NOT_CONFIGURED')
    }
    for (const path of ['/api/analysis/audit?source=local:five','/api/analysis/pick/track?source=local:five','/api/ai/history?source=local:five','/api/ai/query?source=qkltj:6002&expect=20260906480','/api/ai/query?source=qkltj:6002&expect=480&date=2026-09-06','/api/ai/tier-analysis?source=local:five','/api/ai/sets/board?source=local:five','/api/arena/board?source=local:five','/api/top3/pick?source=local:five']) {
      const response = await request(path), result = await response.json()
      assert.equal(response.status,200, path + ' ' + JSON.stringify(result))
      assert.equal(result.ok,true,path)
      if (path.includes('/tier-analysis')) { assert.equal(result.next_forecast,null); assert.ok(result.tiers.every(t=>t.next.verdict==='insufficient_evidence')) }
    }
    assert.equal((await request('/api/ai/query?source=qkltj:6002&expect=481&date=2026-09-06')).status,400)
    assert.equal((await request('/api/ai/query?source=qkltj:6002&expect=1&date=2026-02-30')).status,400)
    await request('/api/config', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({AI_PROVIDER:'local',AI_MODEL:'no-call',OPENAI_BASE_URL:'http://127.0.0.1:9/v1'}) })
    const readyEmpty = await request('/api/arena/pick?source=local:five')
    assert.equal(readyEmpty.status,200)
    assert.equal((await readyEmpty.json()).record,null)
    const marker = 'test-marker-never-a-real-api-key'
    const saved = await (await request('/api/config', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ OPENAI_API_KEY:marker, AI_PROVIDER:'disabled', AI_MODEL:'test-model' }) })).json()
    assert.equal(saved.ok, true)
    assert.ok(!JSON.stringify(saved).includes(marker))
    assert.equal(values.OPENAI_API_KEY, marker)
    assert.equal(await service.db.prepare("SELECT * FROM app_config WHERE key='OPENAI_API_KEY'").first(), null)
    const guest = await (await request('/api/auth/guest', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ nickname:'本地验证用户' }) })).json()
    assert.equal(guest.ok, true)
    assert.ok(guest.token)
    await service.close()
    service = await startService({ root, dataDir:dir, token, secrets, background:false })
    const me = await (await request('/api/me', { headers:{'X-Token':guest.token} })).json()
    assert.equal(me.ok, true)
    assert.equal(me.user.nickname, '本地验证用户')
    const state = await (await request('/api/state?room=seed', { headers:{'X-Token':guest.token} })).json()
    assert.equal(state.ok, true)
    assert.equal((await (await request('/api/config')).json()).items.AI_MODEL.value, 'test-model')
  } finally { await service.close() }
})

test('local AI configuration routes calls through backend without forwarding cloud key', async () => {
  const calls = []
  const mock = createServer(async (req,res) => {
    let body = ''; for await (const chunk of req) body += chunk
    calls.push({ url:req.url, authorization:req.headers.authorization, body:body ? JSON.parse(body) : null })
    res.setHeader('Content-Type','application/json')
    if (req.url === '/v1/models') res.end(JSON.stringify({data:[{id:'local-test-model'}]}))
    else res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({ok:true,pos_weights:[Array(10).fill(10),Array(10).fill(10),Array(10).fill(10)],note:'本机模拟验证'})}}],usage:{prompt_tokens:1,completion_tokens:1}}))
  })
  await new Promise(resolve => mock.listen(0,'127.0.0.1',resolve))
  const service = await startService({
    root, dataDir:temporary(), token, background:false,
    secrets:{async load(){return {OPENAI_API_KEY:'cloud-marker-must-not-be-forwarded'}},async save(){}}
  })
  const request = (path, body) => fetch(service.origin+path,{method:'POST',headers:{'x-hashplay-app':token,'Content-Type':'application/json'},body:JSON.stringify(body)})
  try {
    const response = await request('/api/config/validate',{AI_PROVIDER:'local',OPENAI_BASE_URL:'http://127.0.0.1:'+mock.address().port+'/v1',AI_MODEL:'local-test-model',rounds:1})
    const result = await response.json()
    assert.equal(result.result.ok,true, JSON.stringify(result))
    assert.equal(result.result.provider,'local')
    assert.equal(calls.length,2)
    assert.ok(calls.every(c=>!c.authorization))
    assert.equal(calls[1].body.model,'local-test-model')
    assert.equal(calls[1].body.max_tokens,300)
    assert.ok(!('reasoning_effort' in calls[1].body))
    const disabled = await (await request('/api/config/validate',{AI_PROVIDER:'disabled'})).json()
    assert.equal(disabled.result.ok,false)
    const remote = await (await request('/api/config/validate',{AI_PROVIDER:'local',OPENAI_BASE_URL:'https://example.com/v1',AI_MODEL:'x'})).json()
    assert.equal(remote.result.ok,false)
    assert.equal(calls.length,2)
  } finally {
    await service.close()
    mock.closeAllConnections()
    await new Promise(resolve=>mock.close(resolve))
  }
})
