const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, shell, safeStorage, utilityProcess, session, protocol } = require('electron')
const { join, resolve } = require('node:path')
const { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, renameSync, appendFileSync, statSync, rmSync } = require('node:fs')
const { randomBytes } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const createVault = require('./vault.cjs')

protocol.registerSchemesAsPrivileged([{ scheme: 'hashplay', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])
const uiOrigin = 'hashplay://app'
app.setName('HashPlay Desktop')
const smoke = process.argv.includes('--smoke-test')
const syncTest = process.argv.includes('--sync-test')
const offline = process.argv.includes('--offline')
const dataArg = process.argv.find(a => a.startsWith('--data-dir='))
if (dataArg) app.setPath('userData', resolve(dataArg.slice(11)))
const dataDir = app.getPath('userData')
mkdirSync(dataDir, { recursive: true })
if (!app.requestSingleInstanceLock()) { app.quit() } else {
  let win, tray, worker, origin = '', quitting = false, stopping = false
  let restartCount = 0, restartTimer
  const token = randomBytes(32).toString('hex')
  const root = join(app.getAppPath(), 'desktop-build')
  const vault = createVault(join(dataDir, 'secrets.bin'), safeStorage)
  const logfile = join(dataDir, 'desktop.log')
  const backupRequests = new Map()
  let backupId = 0, smokePickRequests = 0
  function log(message) {
    let text = String(message)
    try { for (const value of Object.values(vault.load())) if (value) text = text.split(value).join('[REDACTED]') } catch {}
    if (existsSync(logfile) && statSync(logfile).size > 2_000_000) renameSync(logfile, logfile + '.previous')
    appendFileSync(logfile, new Date().toISOString() + ' ' + text.slice(0, 4000) + '\n')
  }
  function showPage(path = '/settings') {
    if (!origin) return
    if (!win || win.isDestroyed()) createWindow()
    win.loadURL(uiOrigin + path)
    if (!smoke) { win.show(); win.focus() }
  }
  function createWindow() {
    win = new BrowserWindow({
      title: 'HashPlay 本地工作台', width: 1360, height: 920, minWidth: 1050, minHeight: 700,
      show: false, backgroundColor: '#0b0f1a', icon: join(root, 'icon.png'),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false, offscreen: smoke }
    })
    win.on('close', event => {
      if (!quitting) { event.preventDefault(); win.hide() }
    })
    win.webContents.setWindowOpenHandler(({ url }) => {
      try { const u = new URL(url); if (['https:', 'http:'].includes(u.protocol)) shell.openExternal(url) } catch {}
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
      const target = new URL(url)
      if (target.protocol !== 'hashplay:' || target.host !== 'app') event.preventDefault()
    })
    win.webContents.on('render-process-gone', (_, detail) => { log('Renderer stopped: ' + detail.reason); if (!quitting) showPage() })
  }
  async function startWorker() {
    stopping = false
    const child = utilityProcess.fork(join(app.getAppPath(), 'desktop/worker.cjs'), [], {
      serviceName: 'HashPlay 本地后台', stdio: 'pipe',
      env: { ...process.env, HASHPLAY_OFFLINE: smoke || offline ? '1' : '0' }
    })
    worker = child
    child.stdout?.on('data', chunk => log(chunk.toString()))
    child.stderr?.on('data', chunk => log(chunk.toString()))
    const ready = new Promise((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error('本地后台启动超时')), 25000)
      child.on('message', async message => {
        if (message.type === 'vault') {
          try {
            const value = message.action === 'load' ? vault.load() : message.action === 'save' ? vault.save(message.patch) : (() => { throw new Error('Invalid vault action') })()
            child.postMessage({ type: 'vault-result', id: message.id, value })
          } catch { child.postMessage({ type: 'vault-result', id: message.id, error: '系统密钥存储不可用，请查看系统账户权限' }) }
        } else if (message.type === 'ready') {
          clearTimeout(timeout); origin = message.origin; resolveReady()
        } else if (message.type === 'fatal') {
          clearTimeout(timeout); log('Service error: ' + message.message); rejectReady(new Error(message.message))
        } else if (message.type === 'backup-result') {
          const p = backupRequests.get(message.id)
          if (p) { clearTimeout(p.timer); backupRequests.delete(message.id); message.error ? p.reject(new Error(message.error)) : p.resolve() }
        }
      })
      child.once('exit', code => { clearTimeout(timeout); rejectReady(new Error('本地后台退出，代码 ' + code)) })
    })
    child.on('exit', code => {
      log('Background exit ' + code)
      for (const p of backupRequests.values()) { clearTimeout(p.timer); p.reject(new Error('后台已停止')) }
      backupRequests.clear()
      if (stopping || quitting || child !== worker) return
      origin = ''
      if (restartCount++ < 3) {
        restartTimer = setTimeout(() => startWorker().then(() => showPage()).catch(reportError), 1500)
      } else reportError(new Error('后台连续退出，请退出应用后重新启动。数据仍保存在本机。'))
    })
    child.postMessage({ type: 'start', root, dataDir, token })
    await ready
  }
  function stopWorker() {
    stopping = true
    clearTimeout(restartTimer)
    return new Promise(resolveStop => {
      if (!worker) return resolveStop()
      const child = worker
      const timer = setTimeout(() => { child.kill(); resolveStop() }, 12000)
      child.once('exit', () => { clearTimeout(timer); resolveStop() })
      try { child.postMessage({ type: 'stop' }) } catch { clearTimeout(timer); resolveStop() }
    })
  }
  function backupTo(path) {
    return new Promise((resolveBackup, reject) => {
      const id = ++backupId
      const timer = setTimeout(() => { backupRequests.delete(id); reject(new Error('备份超时')) }, 30000)
      backupRequests.set(id, { resolve: resolveBackup, reject, timer })
      worker.postMessage({ type: 'backup', id, path })
    })
  }
  async function backupData() {
    const selected = await dialog.showSaveDialog(win, {
      title: '备份本地数据（不包含 API 密钥）',
      defaultPath: join(app.getPath('documents'), 'HashPlay-' + new Date().toISOString().slice(0, 10) + '.sqlite'),
      filters: [{ name: 'SQLite 数据库', extensions: ['sqlite'] }]
    })
    if (selected.canceled || !selected.filePath) return
    if (resolve(selected.filePath) === resolve(join(dataDir, 'hashplay.sqlite'))) throw new Error('请选择其他备份位置')
    await backupTo(selected.filePath)
    dialog.showMessageBox(win, { type: 'info', message: '数据备份完成', detail: '备份包含历史记录和普通配置，API 密钥仍留在本机加密存储中。' })
  }
  async function restoreData() {
    const selected = await dialog.showOpenDialog(win, { title: '恢复 HashPlay 数据', properties: ['openFile'], filters: [{ name: 'SQLite 数据库', extensions: ['sqlite'] }] })
    if (selected.canceled) return
    const source = selected.filePaths[0]
    if (resolve(source) === resolve(join(dataDir, 'hashplay.sqlite'))) throw new Error('不能从正在使用的数据库恢复')
    const check = new DatabaseSync(source, { readOnly: true })
    try {
      if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('备份文件完整性检查失败')
      for (const table of ['desktop_migrations','app_config','users','draws','arena_rounds']) {
        if (!check.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error('这不是完整的 HashPlay 桌面版备份')
      }
      const supported = require('node:fs').readdirSync(join(root, 'migrations'))
      if (check.prepare('SELECT name FROM desktop_migrations').all().some(row => !supported.includes(row.name))) throw new Error('备份来自更新版本，请先升级应用')
    } finally { check.close() }
    const answer = await dialog.showMessageBox(win, { type: 'question', buttons: ['取消', '恢复并重启后台'], defaultId: 0, cancelId: 0, message: '用此备份替换当前历史记录？', detail: '当前数据会先自动备份。API 密钥保持不变。' })
    if (answer.response !== 1) return
    const old = join(dataDir, 'before-restore-' + Date.now() + '.sqlite')
    await backupTo(old)
    await stopWorker()
    const dbPath = join(dataDir, 'hashplay.sqlite')
    // Fixed paths under the app data directory; never remove arbitrary user paths.
    for (const suffix of ['-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
    copyFileSync(source, dbPath)
    try { await startWorker(); showPage() }
    catch (e) {
      await stopWorker()
      for (const suffix of ['-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
      copyFileSync(old, dbPath)
      await startWorker(); showPage()
      throw e
    }
  }
  function reportError(error) {
    log(error.message || error)
    if (smoke || syncTest) { console.error(error.message); app.exit(1); return }
    dialog.showErrorBox('HashPlay', String(error.message || error))
  }
  function menuAction(fn) { return () => Promise.resolve().then(fn).catch(reportError) }
  function buildMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '工作台', submenu: [
        { label: 'AI 配置中心', click: () => showPage('/settings') },
        { label: 'AI 推荐', click: () => showPage('/ai') },
        { label: '历史查询', click: () => showPage('/query') },
        { label: '量化分析', click: () => showPage('/analysis') },
        { label: '图谱工作台', click: () => showPage('/atlas') },
        { label: '策略竞技场', click: () => showPage('/arena') },
        { label: '优质策略', click: () => showPage('/top3') },
        { label: '虚拟积分演示', click: () => showPage('/') },
        { type: 'separator' }, { label: '退出', click: () => app.quit() }
      ] },
      { label: '数据', submenu: [
        { label: '备份数据…', click: menuAction(backupData) },
        { label: '恢复数据…', click: menuAction(restoreData) },
        { label: '打开数据文件夹', click: () => shell.openPath(dataDir) },
        { label: '查看运行日志', click: () => shell.openPath(logfile) }
      ] },
      { label: '视图', submenu: [{ role: 'reload', label: '刷新' }, { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'togglefullscreen', label: '全屏' }] },
      { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] }
    ]))
    tray = new Tray(nativeImage.createFromPath(join(root, 'icon.png')).resize({ width: 32, height: 32 }))
    tray.setToolTip('HashPlay · 关闭窗口后后台继续运行')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示工作台', click: () => { if (win && !win.isDestroyed()) { win.show(); win.focus() } else showPage() } },
      { label: 'AI 配置中心', click: () => showPage('/settings') },
      { type: 'separator' }, { label: '退出并停止后台', click: () => app.quit() }
    ]))
    tray.on('double-click', () => { if (win) { win.show(); win.focus() } else showPage() })
  }
  async function smokeTest() {
    const errors = []
    win.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message) })
    const result = { pages: [], errors, version: app.getVersion(), electron: process.versions.electron, sqlite: false, encrypted: false }
    for (const path of ['/settings','/query','/analysis','/arena','/ai','/top3','/atlas','/']) {
      await win.loadURL(uiOrigin + path)
      await new Promise(r => setTimeout(r, 1000))
      const info = await win.webContents.executeJavaScript("({ title:document.title, text:document.body.innerText.slice(0,100), scripts:[...document.scripts].map(s=>s.src).filter(Boolean), background:getComputedStyle(document.body).backgroundColor, node:typeof require })")
      if (!info.title || info.node !== 'undefined' || info.scripts.some(s => !s.startsWith(uiOrigin))) throw new Error('桌面页面验证失败: ' + path)
      result.pages.push({ path, ...info })
      if (path === '/atlas') await require('./atlas-smoke.cjs')(win,result,dataDir)
      if (path === '/analysis') {
        const seeded = await win.webContents.executeJavaScript("fetch('/api/analysis/pick/track?source=qkltj:6001&count=500&temp=1.5').then(r=>r.json()).then(d=>d.n>0)")
        if (seeded) {
          let ready = false
          for (let i = 0; i < 40 && !ready; i++) {
            await new Promise(r => setTimeout(r, 250))
            ready = await win.webContents.executeJavaScript("document.getElementById('pick-track-verdict').textContent.includes('Brier')")
          }
          if (!ready) throw new Error('预测检验指标未显示')
          await win.webContents.executeJavaScript("document.getElementById('pick-track').scrollIntoView({behavior:'instant',block:'center'})")
          await new Promise(r => setTimeout(r, 400))
          result.auditPanelPosition = await win.webContents.executeJavaScript("({top:document.getElementById('pick-track').getBoundingClientRect().top,scroll:window.scrollY})")
          writeFileSync(join(dataDir, 'prediction-audit.png'), (await win.webContents.capturePage()).toPNG())
          result.auditCalibrationView = true
        }
      }
      if (path === '/ai') {
        const state = await win.webContents.executeJavaScript("({visible:getComputedStyle(document.getElementById('ai-config-state')).display !== 'none',title:document.getElementById('ai-config-title').textContent,link:document.getElementById('ai-config-link').getAttribute('href'),text:document.body.innerText})")
        if (!state.visible || state.title !== 'AI 已停用' || state.link !== '/settings' || state.text.includes('Request failed with status code 400')) throw new Error('AI 停用状态显示错误')
        const before = smokePickRequests
        await new Promise(r => setTimeout(r, 5500))
        if (smokePickRequests !== before) throw new Error('AI 停用后仍在自动重试推荐请求')
        result.aiConfigurationState = true
        writeFileSync(join(dataDir, 'ai-disabled.png'), (await win.webContents.capturePage()).toPNG())
      }
    }
    await win.loadURL(uiOrigin + '/settings')
    await new Promise(r => setTimeout(r, 1200))
    await win.webContents.executeJavaScript("fetch('/api/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({AI_PROVIDER:'local',AI_MODEL:'',OPENAI_BASE_URL:''})}).then(r=>r.json())")
    await win.loadURL(uiOrigin + '/ai')
    await new Promise(r => setTimeout(r, 1000))
    const missing = await win.webContents.executeJavaScript("document.getElementById('ai-config-title').textContent")
    if (missing !== '请先完成 AI 配置') throw new Error('AI 配置不完整状态显示错误')
    const navigation = new Promise(resolve => win.webContents.once('did-finish-load', resolve))
    await win.webContents.executeJavaScript("document.getElementById('ai-config-link').click()")
    await navigation
    if (win.webContents.getURL() !== uiOrigin + '/settings') throw new Error('AI 配置入口导航失败')
    await win.webContents.executeJavaScript("fetch('/api/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({AI_PROVIDER:'disabled'})}).then(r=>r.json())")
    await win.reload()
    await new Promise(r => setTimeout(r, 1000))
    const image = await win.webContents.capturePage()
    writeFileSync(join(dataDir, 'desktop-settings.png'), image.toPNG())
    const health = await win.webContents.executeJavaScript("fetch('/desktop/health').then(r=>r.json())")
    result.sqlite = health.database === 'sqlite'
    // Exercise the OS vault with a disposable, non-credential marker.
    const temporaryVault = createVault(join(dataDir, 'vault-smoke.bin'), safeStorage)
    temporaryVault.save({ OPENAI_API_KEY: 'smoke-test-marker-not-a-credential' })
    result.encrypted = temporaryVault.load().OPENAI_API_KEY === 'smoke-test-marker-not-a-credential' && !readFileSync(join(dataDir, 'vault-smoke.bin')).includes(Buffer.from('smoke-test-marker'))
    rmSync(join(dataDir, 'vault-smoke.bin'))
    await backupTo(join(dataDir, 'smoke-backup.sqlite'))
    win.close()
    if (win.isDestroyed() || win.isVisible()) throw new Error('关闭窗口后托盘运行验证失败')
    const stillHealthy = await win.webContents.executeJavaScript("fetch('/desktop/health').then(r=>r.ok)")
    if (!stillHealthy || !result.sqlite || !result.encrypted) throw new Error('桌面后台验证失败')
    result.tray = true
    await win.webContents.executeJavaScript("localStorage.setItem('desktop-smoke-persistence','retained')")
    await stopWorker()
    await startWorker()
    await win.loadURL(uiOrigin + '/settings')
    const retained = await win.webContents.executeJavaScript("localStorage.getItem('desktop-smoke-persistence')")
    if (retained !== 'retained') throw new Error('后台重启后账户存储未保留')
    result.restartPersistence = true
    writeFileSync(join(dataDir, 'smoke-result.json'), JSON.stringify(result, null, 2))
    console.log('Desktop smoke test passed: ' + result.pages.length + ' pages, vault, backup, tray.')
    app.quit()
  }
  async function testSynchronization() {
    const headers = { 'X-HashPlay-App': token }
    const builtin = ['qkltj:6001','qkltj:6002','qkltj:6003','qkltj:6004','qkltj:7001']
    const startedAt = Date.now(), deadline = startedAt + 60_000
    let sources = null, pollError = null, status = null
    const fetchJSON = async (path, timeout = 5000) => {
      const response = await fetch(origin + path, { headers, signal: AbortSignal.timeout(Math.max(1, Math.floor(timeout))) })
      const body = await response.json()
      if (!response.ok || body.ok === false) throw new Error(body.error?.message || body.error || `HTTP ${response.status}: ${path}`)
      return body
    }
    // The desktop background owns fetching; these local reads never trigger AI or a second synchronization lane.
    while (Date.now() < deadline) {
      try {
        sources = await fetchJSON('/api/sources', Math.min(5000, deadline - Date.now()))
        pollError = null
        if (builtin.every(source => sources.sources?.some(s => s.key === source && s.count > 0 && s.meta?.last_ok_ms > 0))) break
      } catch (error) { pollError = String(error.message || error) }
      const remaining = deadline - Date.now()
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(500, remaining)))
    }
    try { status = await fetchJSON('/api/keeper/status') } catch (error) { status = { error: String(error.message || error) } }
    const counts = builtin.map(source => {
      const record = sources?.sources?.find(s => s.key === source)
      return { source, count: record?.count || 0, latest: record?.latest ?? null, lastSuccessAt: record?.meta?.last_ok_ms || null, lastError: record?.meta?.last_error || null }
    })
    const atlasConsistency = [], errors = []
    if (pollError) errors.push({ stage: 'sources', error: pollError })
    let reader
    try {
      reader = new DatabaseSync(join(dataDir, 'hashplay.sqlite'), { readOnly: true })
      reader.exec('PRAGMA busy_timeout=1000')
      const canonicalQuery = reader.prepare(`WITH selected AS (
        SELECT expect,n1,n2,n3,n4,n5,open_ms FROM draws WHERE source=? ORDER BY open_ms DESC,expect DESC LIMIT 1000
      ) SELECT
        (SELECT COUNT(*) FROM draws WHERE source=?) AS count,
        (SELECT expect FROM selected LIMIT 1) AS latest,
        (SELECT open_ms FROM selected LIMIT 1) AS latest_ms,
        (SELECT json_group_array(json_object('period',expect,'numbers',json_array(n1,n2,n3,n4,n5),'drawAt',open_ms)) FROM selected) AS rows_json,
        COALESCE((SELECT revision FROM atlas_source_revisions WHERE source_id=?),0) AS revision`)
      const revisionQuery = reader.prepare('SELECT revision FROM atlas_source_revisions WHERE source_id=?')
      const verifyDeadline = Date.now() + 15_000
      const checks = await Promise.all(builtin.map(async source => {
        const acquisition = counts.find(c => c.source === source)
        let lastError = acquisition.count > 0 ? '持续写入，未取得稳定版本窗口' : (acquisition.lastError || '60秒内该来源未成功同步取得数据')
        for (let attempt = 1; attempt <= 6 && Date.now() < verifyDeadline; attempt++) {
          try {
            const before = canonicalQuery.get(source, source, source)
            const revision = source + ':' + before.revision
            const timeout = Math.min(5000, verifyDeadline - Date.now())
            const [snapshot, original] = await Promise.all([
              fetchJSON('/api/atlas/snapshot?source=' + encodeURIComponent(source) + '&limit=1000', timeout),
              fetchJSON('/api/sync/status?source=' + encodeURIComponent(source), timeout),
            ])
            const after = revisionQuery.get(source)?.revision || 0
            // Any intervening canonical write invalidates this comparison, including same-period corrections.
            if (before.revision !== after) {
              lastError = '验证期间数据版本改变，正在重试'
              await new Promise(resolve => setTimeout(resolve, 150)); continue
            }
            const current = original.status?.[source]
            if (!before.count || !(current?.last_ok_ms > 0)) throw new Error(acquisition.lastError || current?.last_error || '该来源没有成功同步的真实数据')
            const canonical = JSON.parse(before.rows_json || '[]').reverse()
            const actual = (snapshot.records || []).map(row => ({ period: row.period, numbers: row.numbers, drawAt: row.drawAt }))
            const problems = []
            if (snapshot.storage !== 'canonical-draws') problems.push('图谱未读取共享draws表')
            if (snapshot.revision !== revision) problems.push('图谱持久版本不一致')
            if (snapshot.count !== before.count) problems.push('图谱总量不一致')
            if (snapshot.latestPeriod !== before.latest || snapshot.latestDrawAt !== before.latest_ms) problems.push('图谱最新期或开奖时间不一致')
            if (JSON.stringify(actual) !== JSON.stringify(canonical)) problems.push('图谱期号、号码或开奖顺序不一致')
            if (current?.total !== before.count || current?.latest_expect !== before.latest || current?.latest_open_ms !== before.latest_ms) problems.push('原同步状态总量或最新期不一致')
            if (problems.length) throw new Error(problems.join('；'))
            return { source, ok: true, count: before.count, latest: before.latest, latestDrawAt: before.latest_ms, revision, comparedRecords: canonical.length, attempts: attempt, originalStatusMatches: true, lastSuccessAt: current.last_ok_ms, lastError: current.last_error || null }
          } catch (error) {
            lastError = String(error.message || error)
            if (Date.now() < verifyDeadline) await new Promise(resolve => setTimeout(resolve, 150))
          }
        }
        return { source, ok: false, error: lastError, upstreamError: acquisition.lastError }
      }))
      atlasConsistency.push(...checks)
      for (const check of checks) if (!check.ok) errors.push({ source: check.source, error: check.error, upstreamError: check.upstreamError })
    } catch (error) {
      errors.push({ stage: 'database-comparison', error: String(error.message || error) })
    } finally { reader?.close() }
    const result = { version: app.getVersion(), startedAt, completedAt: Date.now(), counts, status, atlasConsistency, errors }
    writeFileSync(join(dataDir, 'sync-result.json'), JSON.stringify(result, null, 2))
    if (errors.length || atlasConsistency.length !== builtin.length || atlasConsistency.some(check => !check.ok)) {
      throw new Error('五源同步一致性验证失败：' + errors.map(item => (item.source || item.stage) + ' ' + item.error).join('；'))
    }
    console.log('Live synchronization and canonical/atlas consistency verified: 5 sources.')
    app.quit()
  }
  app.on('second-instance', () => { if (win) { win.show(); win.focus() } })
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault(); quitting = true
    stopWorker().finally(() => { tray?.destroy(); app.quit() })
  })
  app.on('window-all-closed', () => {})
  app.whenReady().then(async () => {
    log('Starting HashPlay ' + app.getVersion())
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)
    // A stable private origin keeps browser account storage across random backend ports.
    protocol.handle('hashplay', async request => {
      const url = new URL(request.url)
      if (smoke && url.pathname === '/api/arena/pick') smokePickRequests++
      const source = request.headers.get('origin')
      if (url.host !== 'app' || (source && source !== uiOrigin) || !origin) return new Response('后台尚未就绪', { status: 503 })
      const headers = { 'X-HashPlay-App': token, Origin: origin }
      for (const name of ['content-type', 'accept', 'x-token']) {
        const value = request.headers.get(name)
        if (value) headers[name] = value
      }
      try {
        const response = await fetch(origin + url.pathname + url.search, {
          method: request.method, headers, redirect: 'error',
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer()
        })
        const outHeaders = new Headers(response.headers)
        outHeaders.set('Access-Control-Allow-Origin', uiOrigin)
        return new Response(response.body, { status: response.status, headers: outHeaders })
      } catch { return new Response('本地后台连接已断开，请稍后刷新。', { status: 503 }) }
    })
    await startWorker()
    createWindow(); buildMenu()
    if (smoke) await smokeTest()
    else if (syncTest) await testSynchronization()
    else showPage()
  }).catch(reportError)
}
