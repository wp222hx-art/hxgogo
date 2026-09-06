import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { join } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { LocalDatabase } from './database.mjs'
import app, { startLocalBackground, waitLocalJobs } from '../src/index'
import { setSecretStore, bumpConfig } from '../src/config'

const vendors: Record<string, string> = {
  'https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js': '/vendor/axios.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js': '/vendor/chart.umd.js',
  'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js': '/vendor/echarts.min.js',
  'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css': '/vendor/fontawesome/css/all.min.css'
}
export function localizeHTML(html: string) {
  html = html.replace('<script src="https://cdn.tailwindcss.com"></script>', '<link rel="stylesheet" href="/vendor/tailwind.css">')
  for (const [url, local] of Object.entries(vendors)) html = html.split(url).join(local)
  return html
}
export async function startService(options: {
  root: string; dataDir: string; token: string; background?: boolean;
  secrets: { load(): Promise<Record<string, string>>; save(patch: Record<string, string | null>): Promise<void> }
}) {
  if (!options.token || options.token.length < 32) throw new Error('A private application token is required')
  const db = new LocalDatabase(join(options.dataDir, 'hashplay.sqlite'), join(options.root, 'migrations'))
  setSecretStore(options.secrets)
  // Move legacy plaintext keys to the vault before serving any request.
  const oldKeys = await db.prepare("SELECT key,value FROM app_config WHERE key IN ('OPENAI_API_KEY','DEEPSEEK_API_KEY')").all()
  if (oldKeys.results.length) {
    await options.secrets.save(Object.fromEntries(oldKeys.results.map((r: any) => [r.key, r.value])))
    await db.prepare("DELETE FROM app_config WHERE key IN ('OPENAI_API_KEY','DEEPSEEK_API_KEY')").run()
    db.native.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;')
    bumpConfig()
  }
  const controller = new AbortController()
  const jobs = new Set<Promise<unknown>>()
  const env = { DB: db, LOCAL_DESKTOP: true }
  const gateway = new Hono()
  let origin = ''
  const tokenMatches = (candidate: string) => {
    const a = Buffer.from(candidate), b = Buffer.from(options.token)
    return a.length === b.length && timingSafeEqual(a, b)
  }
  gateway.use('*', async (c, next) => {
    const requestOrigin = c.req.header('origin')
    if (new URL(c.req.url).origin !== origin || (requestOrigin && requestOrigin !== origin) ||
        c.req.header('sec-fetch-site') === 'cross-site' ||
        !tokenMatches(c.req.header('x-hashplay-app') || '')) {
      return c.json({ ok: false, error: '仅限本机应用访问' }, 403)
    }
    await next()
    c.header('Access-Control-Allow-Origin', origin)
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('Cache-Control', 'no-store')
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'")
  })
  gateway.get('/desktop/health', c => c.json({ ok: true, database: 'sqlite', background: options.background !== false, secret_storage: 'os-encrypted' }))
  gateway.get('/vendor/*', serveStatic({ root: join(options.root, 'public') }))
  gateway.get('/static/*', serveStatic({ root: join(options.root, 'public') }))
  gateway.all('*', async c => {
    const response = await app.fetch(c.req.raw, env as any, {
      waitUntil(p: Promise<unknown>) { jobs.add(p); p.finally(() => jobs.delete(p)).catch(() => {}) },
      passThroughOnException() {}
    } as any)
    if (response.headers.get('content-type')?.includes('text/html')) {
      return new Response(localizeHTML(await response.text()), { status: response.status, headers: response.headers })
    }
    return response
  })
  const server = serve({ fetch: gateway.fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    if (server.listening) resolve()
    else server.once('listening', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Cannot start local service')
  origin = 'http://127.0.0.1:' + address.port
  const loop = options.background === false ? Promise.resolve() : startLocalBackground(db as any, env as any, controller.signal)
  loop.catch(e => console.error('Background stopped:', e.message))
  let closed = false
  return {
    origin, db,
    async close() {
      if (closed) return
      closed = true
      controller.abort()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await loop
      await waitLocalJobs()
      await Promise.allSettled([...jobs])
      db.close()
      setSecretStore(null)
    }
  }
}
