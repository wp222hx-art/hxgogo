const { startService } = require('../desktop-build/service.cjs')
const parent = process.parentPort
if (!parent) throw new Error('Start this service from HashPlay Desktop')
const pending = new Map()
let sequence = 0, service
const abort = new AbortController()
const nativeFetch = globalThis.fetch
// Bound all network activity and cancel it before the database is closed.
globalThis.fetch = (input, init = {}) => {
  if (process.env.HASHPLAY_OFFLINE === '1') return Promise.reject(new Error('离线验证模式'))
  return nativeFetch(input, { ...init, signal: AbortSignal.any([abort.signal, init.signal || new AbortController().signal, AbortSignal.timeout(90000)]) })
}
function rpc(action, patch) {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('密钥服务响应超时')) }, 10000)
    pending.set(id, { resolve, reject, timer })
    parent.postMessage({ type: 'vault', id, action, patch })
  })
}
parent.on('message', async ({ data }) => {
  if (data.type === 'vault-result') {
    const p = pending.get(data.id)
    if (!p) return
    clearTimeout(p.timer); pending.delete(data.id)
    data.error ? p.reject(new Error(data.error)) : p.resolve(data.value)
  } else if (data.type === 'start') {
    try {
      service = await startService({
        root: data.root, dataDir: data.dataDir, token: data.token,
        background: process.env.HASHPLAY_OFFLINE !== '1',
        secrets: { load: () => rpc('load'), save: patch => rpc('save', patch) }
      })
      parent.postMessage({ type: 'ready', origin: service.origin })
    } catch (e) { parent.postMessage({ type: 'fatal', message: e.message }) }
  } else if (data.type === 'backup') {
    try { await service.db.backup(data.path); parent.postMessage({ type: 'backup-result', id: data.id }) }
    catch (e) { parent.postMessage({ type: 'backup-result', id: data.id, error: e.message }) }
  } else if (data.type === 'stop') {
    abort.abort()
    try { await service?.close() } finally { process.exit(0) }
  }
})
process.on('uncaughtException', e => { parent.postMessage({ type: 'fatal', message: e.message }); process.exit(1) })
