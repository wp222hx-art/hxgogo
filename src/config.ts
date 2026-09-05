// ============ 运行时配置：/settings 页面填写的 key / 模型 / 报单窗口，存 D1 app_config，优先级高于环境变量 ============
import { type AiEnv, llmChat, parseJson, aiProvider, buildChatBody, DEEPSEEK_MODELS, DEEPSEEK_LEGACY } from './ai'

/** 允许在页面配置的键（白名单，防止任意写入） */
export const CONFIG_KEYS = ['AI_PROVIDER', 'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL', 'DEEPSEEK_THINKING', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AI_MODEL', 'AI_EFFORT', 'AI_LEAD_MS', 'AI_TIMEOUT_MS', 'AI_REPORT_EVERY'] as const
export type ConfigKey = typeof CONFIG_KEYS[number]
const SECRET_KEYS: ConfigKey[] = ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY']

let cache: { t: number; kv: Record<string, string> } | null = null
const TTL = 15_000
export const bumpConfig = () => { cache = null }

export async function loadConfig(db: D1Database): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.t < TTL) return cache.kv
  const kv: Record<string, string> = {}
  try { for (const r of (await db.prepare('SELECT key, value FROM app_config').all<any>()).results) kv[r.key] = r.value } catch { /* 表未建 */ }
  cache = { t: Date.now(), kv }
  return kv
}

/** 合并：DB 配置 > 环境变量；空字符串视为未设置 */
export async function effectiveEnv(db: D1Database, env: AiEnv): Promise<AiEnv> {
  const kv = await loadConfig(db)
  const out: any = { ...env }
  for (const k of CONFIG_KEYS) if (kv[k] != null && kv[k] !== '') out[k] = kv[k]
  return out as AiEnv
}

export async function saveConfig(db: D1Database, patch: Record<string, string | null>) {
  const now = Date.now(); const stmts: D1PreparedStatement[] = []
  for (const [k, v] of Object.entries(patch)) {
    if (!(CONFIG_KEYS as readonly string[]).includes(k)) continue
    if (v == null || v === '') stmts.push(db.prepare('DELETE FROM app_config WHERE key=?').bind(k))
    else stmts.push(db.prepare('INSERT INTO app_config (key, value, updated_ms) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_ms=excluded.updated_ms').bind(k, String(v).trim(), now))
  }
  if (stmts.length) await db.batch(stmts)
  bumpConfig()
}

export const mask = (s?: string | null) => !s ? '' : s.length <= 8 ? '*'.repeat(s.length) : s.slice(0, 4) + '…' + s.slice(-4)

/** 给前端看的配置快照：密钥打码；标注每项来源（db / env / default） */
export async function configView(db: D1Database, env: AiEnv) {
  const kv = await loadConfig(db)
  const items: Record<string, { value: string; source: 'db' | 'env' | 'none'; secret: boolean; set: boolean; updated_ms?: number }> = {}
  const rows: Record<string, number> = {}
  try { for (const r of (await db.prepare('SELECT key, updated_ms FROM app_config').all<any>()).results) rows[r.key] = r.updated_ms } catch {}
  for (const k of CONFIG_KEYS) {
    const secret = SECRET_KEYS.includes(k)
    const dbv = kv[k], envv = (env as any)[k]
    const v = dbv || envv || ''
    items[k] = { value: secret ? mask(v) : v, source: dbv ? 'db' : envv ? 'env' : 'none', secret, set: !!v, updated_ms: rows[k] }
  }
  const eff = await effectiveEnv(db, env)
  const pv = aiProvider(eff)
  const preview = pv ? buildChatBody(pv, { json: true, maxTokens: 1500, effort: 'low', temperature: 0.7 }, [{ role: 'system', content: '…' }, { role: 'user', content: '…' }]) : null
  return { items, effective: pv ? { provider: pv.name, model: pv.model, base: pv.base, thinking: pv.thinking || null, endpoint: `${pv.base}/chat/completions`, request_preview: preview } : null, deepseek_models: DEEPSEEK_MODELS, deepseek_legacy: DEEPSEEK_LEGACY }
}

/** 校验：用给定（或当前生效）配置真实调一次模型，要求返回 JSON；返回延迟、模型、余额提示等 */
export async function validateProvider(env: AiEnv, opts: { rounds?: number } = {}) {
  const pv = aiProvider(env)
  if (!pv) return { ok: false, error: '未配置任何供应商 key' }
  const t0 = Date.now()
  // 1) 列模型（DeepSeek/OpenAI 均支持 GET /models）：验证 key 与 base 是否有效
  let models: string[] = []; let modelsErr: string | null = null
  try {
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 8000)
    const res = await fetch(`${pv.base}/models`, { headers: { Authorization: `Bearer ${pv.key}` }, signal: ac.signal }); clearTimeout(tm)
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok) modelsErr = j?.error?.message || `HTTP ${res.status}`
    else models = (j.data || []).map((m: any) => m.id).filter(Boolean).slice(0, 50)
  } catch (e: any) { modelsErr = e.name === 'AbortError' ? 'timeout' : String(e.message || e) }
  if (modelsErr && /401|invalid|authentication|api key/i.test(modelsErr)) return { ok: false, provider: pv.name, model: pv.model, base: pv.base, stage: 'auth', error: `鉴权失败：${modelsErr}`, latency_ms: Date.now() - t0 }
  // 2) 真实推理：要求输出 JSON，测速（模拟预测官任务体量的缩小版）
  const rounds = Math.max(1, Math.min(3, opts.rounds ?? 1))
  const lat: number[] = []; let lastErr: string | undefined; let sample: any = null; let usage: any = null; let request: any = null; let cot: string | null = null
  for (let i = 0; i < rounds; i++) {
    const r = await llmChat(env, {
      system: '你是 JSON 生成器。只输出 JSON，不要任何多余文字。',
      user: JSON.stringify({ task: '返回 {"ok":true,"pos_weights":[[10个0-100整数],[10个],[10个]],"note":"≤20字中文"}，pos_weights 每行不要全相同', seed: Date.now() + i }),
      json: true, maxTokens: 300, effort: 'low', timeoutMs: 20_000, temperature: 0.7,
    })
    if (!r.ok) { lastErr = r.error; break }
    lat.push(r.latency_ms); usage = r.usage; if (r.request) request = r.request; if (r.reasoning_content) cot = r.reasoning_content.slice(0, 600)
    try { sample = parseJson(r.content) } catch (e: any) { lastErr = 'bad json: ' + e.message; break }
  }
  if (lastErr) return { ok: false, provider: pv.name, model: pv.model, base: pv.base, stage: 'chat', error: lastErr, models, latency_ms: Date.now() - t0 }
  const avg = Math.round(lat.reduce((a, b) => a + b, 0) / lat.length)
  // 3) 余额（仅 DeepSeek 有此接口）
  let balance: any = null
  if (pv.name === 'deepseek') {
    try {
      const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 6000)
      const res = await fetch(`${pv.base}/user/balance`, { headers: { Authorization: `Bearer ${pv.key}` }, signal: ac.signal }); clearTimeout(tm)
      if (res.ok) { const j: any = await res.json(); balance = { available: j.is_available, infos: (j.balance_infos || []).map((b: any) => ({ currency: b.currency, total: b.total_balance })) } }
    } catch {}
  }
  const modelListed = models.length ? models.includes(pv.model) : null
  const legacyUsed = pv.name === 'deepseek' && Object.keys(DEEPSEEK_LEGACY).includes(String((env as any).DEEPSEEK_MODEL || (env as any).AI_MODEL || ''))
  const warns: string[] = []
  if (modelsErr) warns.push(`列模型失败（不影响使用）：${modelsErr}`)
  if (modelListed === false) warns.push(`模型 ${pv.model} 不在该供应商模型列表中`)
  if (legacyUsed) warns.push(`你填的是旧模型名（deepseek-chat / deepseek-reasoner，官方已于 2026-07-24 停用），系统已自动映射为 ${pv.model}${pv.thinking !== 'off' ? '（思考模式）' : ''}，建议改用新名`)
  return { ok: true, provider: pv.name, model: pv.model, thinking: pv.thinking || null, base: pv.base, endpoint: `${pv.base}/chat/completions`, models, model_listed: modelListed, latency_ms: Date.now() - t0, chat_latency_ms: lat, chat_avg_ms: avg, usage, request, cot, sample: sample && { ok: sample.ok, note: sample.note, pw_ok: Array.isArray(sample.pos_weights) && sample.pos_weights.length === 3 }, balance, warn: warns.length ? warns.join('；') : null }
}
