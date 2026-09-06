import { metricCatalog, numberKey, candidateSpace } from './atlas-core.js';
import { renderTool } from './atlas-tools.js';
import { createAtlasLive } from './atlas-live.js';

const API = '/api/atlas';
const PERIODS = [10, 20, 30, 50, 100, 200, 300];
const NAV = [
  ['conditions', '条件工作台', '⊞', '从一条规则开始，看清每一步筛选。'],
  ['trends', '走势图谱', '▥', '把数字、属性与遗漏放在同一条时间轴。'],
  ['results', '候选结果', '▦', '完整计数、分页检视，保留每一步规则。'],
  ['presets', '参考方案', '◇', '保存可复现的条件组合，比较不同观察角度。'],
  ['monitor', '方案监测', '◉'], ['omissions', '遗漏分析', '⌁'], ['kline', '命中 K 线', '⌇'],
  ['banker', '胆拖工具', '⊕'], ['assistant', '知识助手', '✧'], ['sports', '足球数据', '⚽'],
  ['calculator', '成本计算', '▤'], ['settings', '数据与格式', '⚙'], ['help', '接入说明', '↗'],
];
const state = {
  tab: 'conditions', sources: [], schemas: [], source: null, snapshot: { records: [], events: [] },
  workspace: { presets: [], monitors: [], preferences: {} }, rules: [], options: { globalTolerance: 0, inverse: false, order: 'number', page: 1, pageSize: 100 },
  projection: 'front3', zone: 'front', limit: 50, params: {}, rule: null, records: [], catalog: [], results: null,
  zonedMode: false, zonedPage: 1, zonedResult: null, trendIds: [], trendPage: 0, trendSelection: new Set(), trendResult: null, undoRules: null, cleanup: null, epoch: 0,
};
const content = document.getElementById('atlas-content');
let refreshController, candidateController, trendController, toastTimer, persistTimer;
let workspaceSaveQueue = Promise.resolve(), workspaceRevision = 0, workspaceWrites = 0;
let live, liveState, viewDirty = false, syncBusy = false;
const toolViews = new Map();
const activeWorkers = new Set();
const nf = new Intl.NumberFormat('zh-CN');
const num = value => nf.format(Number(value) || 0);
const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => 'r-' + (crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (['value', 'checked', 'disabled', 'selected'].includes(key)) node[key] = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) if (child != null && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const button = (label, action, kind = '', props = {}) => el('button', { type: 'button', class: 'atlas-button ' + kind, onClick: action, ...props }, label);
const chip = (label, kind = '') => el('span', { class: 'atlas-chip ' + kind }, label);
const field = (label, input) => el('label', { class: 'atlas-field' }, el('span', {}, label), input);
const notice = (text, kind = '') => el('div', { class: 'atlas-notice ' + kind }, text);
const empty = (title, text, actions = []) => el('div', { class: 'atlas-empty' }, el('div', { class: 'atlas-empty-icon', 'aria-hidden': 'true' }, '◇'), el('h2', {}, title), el('p', {}, text), el('div', { class: 'atlas-actions' }, actions));
const loading = (text = '正在计算…') => el('div', { class: 'atlas-loading-row' }, el('span', { class: 'atlas-loading' }), text);
const card = (...kids) => el('section', { class: 'atlas-card' }, kids);
const cardHead = (title, subtitle, actions = []) => el('div', { class: 'atlas-card-header' }, el('div', {}, el('h2', {}, title), subtitle ? el('p', {}, subtitle) : null), el('div', { class: 'atlas-card-actions' }, actions));
function notify(message, error = false) {
  const node = document.getElementById('atlas-toast');
  node.textContent = String(message); node.className = 'atlas-toast visible' + (error ? ' error' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.className = 'atlas-toast', 4300);
}
async function api(path, options = {}) {
  const response = await fetch(API + path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  let data; try { data = await response.json(); } catch { throw Error('接口未返回有效数据（HTTP ' + response.status + '）'); }
  if (!response.ok || data.ok === false) throw Error(data.error?.message || data.message || (typeof data.error === 'string' ? data.error : '读取失败，HTTP ' + response.status));
  return data;
}
function scopeKey(zone = state.zone) { return (state.source?.id || '') + ':' + state.projection + ':' + zone; }
function normalizeProjection() {
  const allowed = state.source?.schemaId === 'eleven5' ? ['any5','any2','any3','any4','first2','first3'] : state.source?.schemaId === 'digits5' ? ['front3','middle3','back3','all'] : ['front3'];
  if (!allowed.includes(state.projection)) state.projection = allowed[0];
  if (!['front','back'].includes(state.zone)) state.zone = 'front';
}
function parametersFor(rule, zone = state.zone) {
  const preferences = state.workspace.preferences || {};
  const scoped = preferences.metricParamsByScope?.[scopeKey(zone)];
  const params = clone(scoped || preferences.metricParams || {});
  const pairs = params.pairs;
  const valid = Array.isArray(pairs) && pairs.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(n => Number.isInteger(n) && n >= 0 && n < rule.count) && pair[0] !== pair[1]);
  if (!valid) delete params.pairs;
  if (params.smallMax != null && (!Number.isFinite(Number(params.smallMax)) || params.smallMax < rule.min || params.smallMax > rule.max)) delete params.smallMax;
  return params;
}
function saveWorkspace(workspace) {
  const next = clone(workspace); next.preferences ||= {}; next.presets ||= []; next.monitors ||= [];
  const revision = ++workspaceRevision; workspaceWrites++;
  // Publish the pending state immediately so the automatic preference save cannot use a pre-save preset list.
  state.workspace = next;
  const job = workspaceSaveQueue.catch(() => {}).then(async () => {
    const result = await api('/workspace', { method: 'PUT', body: JSON.stringify({ workspace: next }) });
    const saved = result.workspace || next;
    if (revision === workspaceRevision) state.workspace = saved;
    return saved;
  });
  const tracked = job.finally(() => workspaceWrites--);
  workspaceSaveQueue = tracked.catch(() => {});
  return tracked;
}
function persistPreferences() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    const preferences = { ...state.workspace.preferences, sourceId: state.source?.id, projection: state.projection, zone: state.zone, limit: state.limit };
    const byScope = { ...(preferences.rulesByScope || {}), [scopeKey()]: { rules: state.rules, options: state.options } };
    const keys = Object.keys(byScope); for (const key of keys.slice(0, Math.max(0, keys.length - 15))) delete byScope[key];
    preferences.rulesByScope = byScope;
    try { await saveWorkspace({ ...state.workspace, preferences }); } catch (error) { notify('工作区暂未保存：' + error.message, true); }
  }, 350);
}
function stashScope() {
  state.workspace.preferences ||= {};
  state.workspace.preferences.rulesByScope ||= {};
  state.workspace.preferences.rulesByScope[scopeKey()] = { rules: clone(state.rules), options: clone(state.options) };
}
function restoreScope() {
  normalizeProjection();
  const stored = state.workspace.preferences?.rulesByScope?.[scopeKey()];
  state.rules = clone(stored?.rules || []);
  state.options = { globalTolerance: 0, inverse: false, order: 'number', page: 1, pageSize: 100, ...stored?.options, page: 1 };
  state.results = null; state.zonedMode = false; state.zonedPage = 1; state.zonedResult = null; state.trendIds = []; state.trendSelection.clear(); state.trendPage = 0;
}
function deriveContext() {
  if (!state.source) return;
  normalizeProjection();
  let rule = clone(state.source.rule), records = (state.snapshot.records || []).slice(-state.limit).map(record => ({ ...record, originalNumbers: record.numbers ? [...record.numbers] : [] }));
  if (state.source.schemaId === 'football') { state.rule = null; state.records = records; state.catalog = []; return; }
  if (rule.zones) {
    state.zone = rule.zones[state.zone] ? state.zone : 'front';
    rule = clone(rule.zones[state.zone]);
    records = records.map(record => ({ ...record, numbers: [...(record.zones?.[state.zone] || [])] }));
  } else if (state.source.schemaId === 'digits5') {
    const slices = { front3: [0, 3], middle3: [1, 4], back3: [2, 5], all: [0, 5] };
    const slice = slices[state.projection] || slices.front3;
    rule.count = slice[1] - slice[0];
    records = records.map(record => ({ ...record, numbers: (record.numbers || []).slice(...slice) }));
  } else if (state.source.schemaId === 'eleven5') {
    const selection = state.projection.match(/^(any|first)([2345])$/);
    const mode = selection?.[1] || 'any', count = Number(selection?.[2] || 5);
    rule.count = count; rule.ordered = mode === 'first';
    if (mode === 'first') records = records.map(record => ({ ...record, numbers: (record.numbers || []).slice(0, count) }));
    // Unordered 任N keeps all five recorded digits; core evaluates all subsets once per period.
  }
  state.rule = rule; state.records = records;
  state.params = parametersFor(rule);
  state.catalog = metricCatalog(rule, state.params);
}
function scopeLabel() {
  if (state.source?.schemaId === 'dlt') return state.zone === 'front' ? '前区 · 5 / 35' : '后区 · 2 / 12';
  if (state.source?.schemaId === 'digits5') return ({ front3: '前三位', middle3: '中三位', back3: '后三位', all: '五位全量' })[state.projection] || '前三位';
  if (state.source?.schemaId === 'eleven5') return state.rule?.ordered ? '原始前 ' + state.rule.count + ' 位' : '任 ' + (state.rule?.count || 5) + ' · 无序组合';
  return state.rule ? state.rule.count + ' 位数字' : '赛事事件';
}
function renderSourceBar() {
  const select = el('select', { class: 'atlas-source-select', 'aria-label': '数据来源', onChange: async event => {
    stashScope(); state.source = state.sources.find(source => source.id === event.target.value);
    state.projection = state.source.schemaId === 'eleven5' ? 'any5' : 'front3'; state.zone = 'front'; restoreScope();
    if (state.source.schemaId === 'football') state.tab = 'sports';
    await reload();
  } }, state.sources.map(source => el('option', { value: source.id, selected: source.id === state.source?.id }, source.label)));
  const parts = [field('数据来源', select)];
  if (state.source?.schemaId === 'digits5' || state.source?.schemaId === 'eleven5') {
    const choices = state.source.schemaId === 'digits5' ? [['front3', '前三位'], ['middle3', '中三位'], ['back3', '后三位'], ['all', '五位全量']] : [['any5', '任5 · 无序'], ['any2', '任2 · 无序'], ['any3', '任3 · 无序'], ['any4', '任4 · 无序'], ['first2', '前2 · 原始位置'], ['first3', '前3 · 原始位置']];
    parts.push(field('分析投影', el('select', { 'aria-label': '分析投影', onChange: event => { stashScope(); state.projection = event.target.value; restoreScope(); deriveContext(); persistPreferences(); renderSourceBar(); navigate(state.tab); } }, choices.map(([value, label]) => el('option', { value, selected: state.projection === value }, label)))));
  }
  if (state.source?.schemaId === 'dlt') parts.push(field('分析区域', el('select', { 'aria-label': '分析区域', onChange: event => { stashScope(); state.zone = event.target.value; restoreScope(); deriveContext(); persistPreferences(); renderSourceBar(); navigate(state.tab); } }, [['front', '前区 · 5 / 35'], ['back', '后区 · 2 / 12']].map(([value, label]) => el('option', { value, selected: state.zone === value }, label)))));
  parts.push(field('观察窗口', el('div', { class: 'atlas-periods' }, PERIODS.map(value => button(value + '期', () => { state.limit = value; deriveContext(); persistPreferences(); renderSourceBar(); navigate(state.tab); }, '', { class: 'atlas-period-button' + (state.limit === value ? ' active' : ''), 'aria-pressed': state.limit === value })))));
  parts.push(el('div', { class: 'atlas-source-note' }, state.source?.kind === 'local' ? '本地导入来源 · 不自动访问外网' : '与原平台共用数据库 · 每 5 秒核对更新'));
  document.getElementById('atlas-source-bar').replaceChildren(...parts);
  document.getElementById('atlas-sync-now').hidden = state.source?.kind !== 'builtin';
  const size = state.source?.schemaId === 'football' ? (state.snapshot.events || []).length : state.records.length;
  document.getElementById('atlas-data-status').textContent = size ? num(size) + (state.source?.schemaId === 'football' ? ' 条赛事' : ' 期记录') : state.source?.kind === 'builtin' ? '等待后台同步' : '等待导入数据';
  const announcement = document.getElementById('atlas-announcement'); announcement.replaceChildren();
  const quality = state.snapshot.quality || {}, lastRecord = (state.snapshot.records || []).at(-1), lastEvent = (state.snapshot.events || []).at(-1);
  const lastTime = lastRecord?.drawAt || lastEvent?.drawAt || lastEvent?.startAt || lastRecord?.observedAt || lastEvent?.observedAt;
  const date = lastTime ? new Date(lastTime) : null, qualityNotes = [];
  if (date && Number.isFinite(date.getTime())) qualityNotes.push('最后数据时间：' + date.toLocaleString('zh-CN', { hour12: false }));
  if (quality.freshness === 'stale') qualityNotes.push('数据已过期，当前展示历史快照');
  if (quality.missingPeriods > 0) qualityNotes.push('当前快照范围缺 ' + num(quality.missingPeriods) + ' 期；跨期比较会在缺口中断');
  if (quality.rejectedRows > 0) qualityNotes.push('已排除 ' + num(quality.rejectedRows) + ' 条无效记录');
  if (state.source?.kind === 'local' && state.source?.schemaId !== 'football') qualityNotes.push('相邻记录，开奖连续性未知');
  if (qualityNotes.length) announcement.append(notice(qualityNotes.join(' · '), quality.freshness === 'stale' || quality.missingPeriods > 0 || quality.rejectedRows > 0 ? 'warning compact' : 'compact'));

  if (state.source?.schemaId === 'eleven5' && !state.rule?.ordered) announcement.append(notice('任' + state.rule.count + '：每期遍历完整开奖的全部 ' + state.rule.count + ' 码子集，统计仍按期；任一子集满足即命中。定位指标对每个子集升序排列。', 'compact'));
  else if (state.source?.schemaId === 'eleven5') announcement.append(notice('前' + state.rule.count + '：按开奖原始位置截取，候选保留顺序。这是明确的历史观察口径，不代替官方玩法说明。', 'compact'));
  if (state.source?.schemaId === 'dlt') announcement.append(notice('大乐透完整空间：前区 324,632 × 后区 66 = 21,425,712 注。前后区独立筛选后可在候选结果中合并分页浏览。', 'compact'));
}
function workerRun(type, payload, { signal, progress } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('已取消', 'AbortError'));
    const worker = new Worker('/static/atlas-worker.js', { type: 'module' }), id = uid();
    activeWorkers.add(worker);
    const timeout = setTimeout(() => finish(new Error('计算用时过长，请减少条件或缩小号码域后重试。')), type === 'export' ? 600000 : 180000);
    const abort = () => finish(new DOMException('已取消', 'AbortError'));
    function finish(error, result) { clearTimeout(timeout); signal?.removeEventListener('abort', abort); worker.terminate(); activeWorkers.delete(worker); error ? reject(error) : resolve(result); }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => finish(new Error(event.message || '后台计算未能启动，请刷新后重试。'));
    worker.onmessage = event => { const data = event.data; if (data.id !== id) return; if (data.progress) { progress?.(data.progress); return; } finish(data.error ? new Error(data.error) : null, data.result); };
    worker.postMessage({ id, type, payload });
  });
}
function candidatePayload(extra = {}) {
  const options = { ...state.options, previous: state.records.at(-1)?.numbers || [], params: clone(state.params), history: state.records, ...extra };
  const rule = options.rule || state.rule, rules = options.rules || state.rules; delete options.rule; delete options.rules; delete options.signal; delete options.progress;
  if (!rule) throw Error('当前赛事来源没有数字组合空间，请使用足球数据页面。');
  return { rule: clone(rule), rules: clone(rules), options };
}
async function getCandidates(extra = {}) { return workerRun('evaluate', candidatePayload(extra), { signal: extra.signal }); }
async function setRules(rules) {
  state.undoRules = clone(state.rules); state.rules = clone(rules); state.options.page = 1; state.results = null; persistPreferences();
  if (['conditions', 'results'].includes(state.tab)) await navigate(state.tab);
}
function rulesInfo() { const active = state.rules.filter(rule => rule.enabled !== false && rule.values?.length).length; return active + ' 条启用条件 · 全局允许 ' + state.options.globalTolerance + ' 条不满足' + (state.options.inverse ? ' · 已取反集' : ''); }
function dialog(title, subtitle = '') {
  const modal = el('dialog', { class: 'atlas-dialog' });
  const body = el('div', { class: 'atlas-dialog-body' }), actions = el('div', { class: 'atlas-dialog-actions' });
  modal.append(el('div', { class: 'atlas-dialog-head' }, el('div', {}, el('h2', {}, title), subtitle ? el('p', { class: 'atlas-muted' }, subtitle) : null), button('×', () => modal.close(), '', { 'aria-label': '关闭对话框' })), body, actions);
  modal.addEventListener('close', () => modal.remove(), { once: true }); document.body.append(modal); modal.showModal();
  return { modal, body, actions };
}
function metricById(id) { return state.catalog.find(metric => metric.id === id); }
function openCatalog() {
  const { modal, body, actions } = dialog('添加分析条件', state.catalog.length + ' 个公开指标 · 可按截图名称、位置或组别搜索');
  const search = el('input', { type: 'search', placeholder: '搜索：胆码、和值、定位、两码、跳位…', 'aria-label': '搜索条件' });
  const group = el('select', { 'aria-label': '条件分组' }, el('option', { value: '' }, '全部分组'), [...new Set(state.catalog.map(metric => metric.group))].map(value => el('option', { value }, value)));
  const grid = el('div', { class: 'atlas-catalog-grid' });
  const render = () => {
    const query = search.value.trim().toLowerCase();
    const metrics = state.catalog.filter(metric => (!group.value || metric.group === group.value) && (!query || (metric.label + ' ' + metric.group + ' ' + metric.id).toLowerCase().includes(query)));
    grid.replaceChildren(...metrics.map(metric => el('button', { type: 'button', class: 'atlas-catalog-item', onClick: () => { modal.close(); openRuleEditor(metric.id); } }, el('strong', {}, metric.label), el('small', {}, metric.group + (metric.uncertain ? ' · 明示自定义口径' : '')))));
    if (!metrics.length) grid.append(empty('未找到指标', '试试“和值”“定位”“连号”等名称。'));
  };
  search.addEventListener('input', render); group.addEventListener('change', render);
  body.append(el('div', { class: 'atlas-catalog-controls' }, search, group), grid); actions.append(button('关闭', () => modal.close(), 'ghost')); render(); search.focus();
}
function openRuleEditor(metricId, existing) {
  const metric = metricById(metricId); if (!metric) return notify('该指标不适用于当前号码规则。', true);
  const selected = new Set((existing?.values || []).map(String));
  const { modal, body, actions } = dialog(existing ? '编辑条件' : '配置条件', metric.label);
  body.append(notice(metric.definition, metric.uncertain ? 'warning' : ''));
  if (metric.uncertain) body.append(el('p', { class: 'atlas-help', style: 'margin-top:8px' }, '参考截图未公开原始公式；这里采用上方明确显示的本平台口径。'));
  let valuesInput = null;
  if (metricId === 'numberSet') {
    valuesInput = el('textarea', { rows: 8, placeholder: '每行一组完整号码，用逗号或空格分隔。', 'aria-label': '指定号码集合' }); valuesInput.value = (existing?.values || []).join('\n');
    body.append(el('div', { class: 'atlas-section-label' }, '指定完整号码'), valuesInput);
  } else {
    const values = el('div', { class: 'atlas-value-list' });
    const renderValues = () => values.replaceChildren(...metric.values.map(value => button(String(value), () => { selected.has(String(value)) ? selected.delete(String(value)) : selected.add(String(value)); renderValues(); }, '', { class: 'atlas-value' + (selected.has(String(value)) ? ' active' : ''), 'aria-pressed': selected.has(String(value)) })));
    body.append(el('div', { class: 'atlas-toolbar', style: 'margin-top:18px' }, el('span', { class: 'atlas-muted' }, '选择指标值'), el('div', { class: 'atlas-actions' }, button('全选', () => { metric.values.forEach(value => selected.add(String(value))); renderValues(); }, 'small ghost'), button('反选', () => { metric.values.forEach(value => selected.has(String(value)) ? selected.delete(String(value)) : selected.add(String(value))); renderValues(); }, 'small ghost'), button('清空', () => { selected.clear(); renderValues(); }, 'small ghost'))), values); renderValues();
  }
  const minimum = el('input', { type: 'number', min: 0, max: 999, value: existing?.minHits ?? 1, 'aria-label': '至少命中个数' });
  const maximum = el('input', { type: 'number', min: 0, max: 999, value: existing?.maxHits ?? 99, 'aria-label': '最多命中个数' });
  const tolerance = el('input', { type: 'number', min: 0, max: 99, value: existing?.tolerance ?? 0, 'aria-label': '每条条件容错个数' });
  const exclude = el('input', { type: 'checkbox', checked: !!existing?.exclude });
  body.append(el('div', { class: 'atlas-editor-numbers' }, field('至少命中选值个数', minimum), field('最多命中选值个数', maximum), field('允许数量偏差', tolerance)), el('label', { class: 'atlas-check-label', style: 'margin-top:17px' }, exclude, '排除：对满足上述数量范围的结果取反'), el('p', { class: 'atlas-help', style: 'margin-top:12px' }, '计数保留指标产生的重复值。容错 t 将允许范围扩展为 [至少−t, 最多+t]；随后执行排除，再参与全局条件判断。没有选值的条件会停用。'));
  actions.append(button('取消', () => modal.close(), 'ghost'), button('保存条件', async () => {
    try {
      const minHits = Number(minimum.value), maxHits = Number(maximum.value), allowed = Number(tolerance.value);
      if (![minHits, maxHits, allowed].every(value => Number.isInteger(value) && value >= 0) || minHits > maxHits) throw Error('请填写有效整数，最多命中不能小于至少命中。');
      let chosen;
      if (metricId === 'numberSet') {
        chosen = [...new Set(valuesInput.value.split(/\n/).map(line => line.trim()).filter(Boolean).map(line => {
          const numbers = line.split(/[\s,，]+/).filter(Boolean).map(Number);
          if (numbers.length !== state.rule.count || numbers.some(n => !Number.isInteger(n) || n < state.rule.min || n > state.rule.max) || (!state.rule.replacement && new Set(numbers).size !== numbers.length)) throw Error('号码行不符合当前 ' + state.rule.count + ' 位规则：' + line.slice(0, 50));
          return numberKey(numbers, state.rule);
        }))];
      } else chosen = metric.values.filter(value => selected.has(String(value)));
      const rule = { id: existing?.id || uid(), metricId, values: chosen, minHits, maxHits, exclude: exclude.checked, tolerance: allowed, enabled: chosen.length > 0 };
      const next = existing ? state.rules.map(item => item.id === existing.id ? rule : item) : [...state.rules, rule];
      modal.close(); await setRules(next); notify(chosen.length ? '条件已保存' : '条件已保存为停用：尚未选择指标值');
    } catch (error) { notify(error.message, true); }
  }, 'primary'));
}

function renderConditions() {
  if (!state.rule) return renderNonNumber();
  const rulesBox = el('div', {}), resultBox = el('div', {});
  const left = card(cardHead('筛选条件', '同一组条件可保存、复用，也可送到历史检验。', [button('＋ 添加条件', openCatalog, 'primary')]), rulesBox);
  if (!state.rules.length) rulesBox.append(empty('还没有筛选条件', '从胆码、和值、定位或走势列开始。未添加条件时，候选是当前规则的完整组合空间。', [button('浏览条件目录', openCatalog, 'ghost')]));
  else for (const rule of state.rules) {
    const metric = metricById(rule.metricId);
    const check = el('input', { type: 'checkbox', checked: rule.enabled !== false, 'aria-label': '启用 ' + (metric?.label || rule.metricId), onChange: event => { rule.enabled = event.target.checked; state.options.page = 1; persistPreferences(); navigate('conditions'); } });
    const values = rule.values || [];
    rulesBox.append(el('article', { class: 'atlas-condition' + (rule.enabled === false ? ' disabled' : '') },
      el('div', { class: 'atlas-condition-head' }, check, el('strong', {}, metric?.label || rule.metricId), rule.exclude ? chip('排除', 'purple') : null,
        button('修改', () => openRuleEditor(rule.metricId, rule)), button('删除', () => setRules(state.rules.filter(item => item.id !== rule.id)))),
      el('div', { class: 'atlas-condition-values' }, values.slice(0, 24).map(value => chip(value, 'accent')), values.length > 24 ? chip('另 ' + (values.length - 24) + ' 项') : null),
      el('div', { class: 'atlas-condition-footer' }, el('span', { class: 'atlas-condition-note' }, '命中 ' + (rule.minHits ?? 1) + '–' + (rule.maxHits ?? 99) + ' 项 · 数量偏差 ±' + (rule.tolerance || 0)), metric?.uncertain ? chip('明示自定义口径', 'warning') : null),
      el('details', { class: 'atlas-definition' }, el('summary', {}, '查看规则定义'), el('p', {}, metric?.definition || '该指标不在当前目录；请检查来源和投影。'))));
  }
  const global = el('input', { type: 'number', min: 0, max: 99, value: state.options.globalTolerance, 'aria-label': '全局容错条件条数', onChange: event => {
    const value = Number(event.target.value);
    if (!Number.isInteger(value) || value < 0) return notify('全局容错需要非负整数。', true);
    state.options.globalTolerance = value; state.options.page = 1; persistPreferences(); navigate('conditions');
  } });
  left.append(el('div', { class: 'atlas-setting-row' }, el('div', {}, el('h3', {}, '全局容错'), el('p', { class: 'atlas-help' }, '允许不满足的条件条数。0 表示全部条件都须满足。')), global),
    el('div', { class: 'atlas-actions', style: 'margin-top:17px' },
      button('保存方案', () => savePresetDialog(), 'ghost'), button('清空条件', () => setRules([]), 'ghost', { disabled: !state.rules.length }),
      button('撤销修改', () => { const old = state.undoRules; if (old) setRules(old); }, 'ghost', { disabled: !state.undoRules })),
    el('p', { class: 'atlas-help', style: 'margin-top:16px' }, '条件只描述组合与历史属性，不构成预测优势。无选值条件自动停用；每条规则的包含 / 排除先单独判断，再统计全局失败条数。'));
  const latest = state.records.at(-1);
  const recent = card(cardHead('当前观察', state.source.label), latest ? el('div', { class: 'atlas-result-grid large' }, (latest.numbers || []).map(n => el('div', { class: 'atlas-number' }, String(n).padStart(state.rule.max > 9 ? 2 : 1, '0')))) : empty('暂无开奖记录', '可在“数据与格式”导入真实数据；号码组合筛选仍可独立使用。', [button('导入数据', () => navigate('settings'), 'ghost')]),
    latest ? el('p', { class: 'atlas-help', style: 'margin-top:12px' }, '期号 ' + latest.period + ' · ' + scopeLabel() + ' · 当前窗口 ' + state.records.length + ' 期') : null);
  content.replaceChildren(el('div', { class: 'atlas-work-grid' }, left, el('div', { class: 'atlas-stack' }, recent, resultBox)));
  refreshCandidates(resultBox, true);
}
function statsCards(result) {
  const stats = [
    ['筛选结果', num(result.count), '条候选', 'accent'],
    ['完整空间', num(result.total), scopeLabel(), ''],
    ['组合占比', result.total ? (result.count / result.total * 100).toFixed(1) + '%' : '—', '不是预测命中率', ''],
  ];
  return el('div', { class: 'atlas-kpis' }, stats.map(([label, value, note, kind]) => el('div', { class: 'atlas-kpi ' + kind }, el('span', {}, label), el('strong', {}, value), el('small', {}, note))));
}
function formatNumbers(numbers) {
  const format = state.workspace.preferences?.format || {};
  const setting = format.separator ?? state.workspace.preferences?.numberSeparator ?? ',';
  const separator = ({ comma: ',', space: ' ', tab: '\t' })[setting] ?? setting;
  const width = format.pad === false ? 1 : state.rule.max > 9 ? 2 : 1;
  return numbers.map(n => String(n).padStart(width, '0')).join(separator);
}
async function refreshCandidates(target, compact = false) {
  candidateController?.abort(); candidateController = new AbortController();
  target.replaceChildren(card(loading('正在后台筛选完整组合空间…')));
  const epoch = state.epoch;
  try {
    const result = await getCandidates({ signal: candidateController.signal });
    if (epoch !== state.epoch || !target.isConnected) return;
    state.results = result; drawResultPanel(target, result, compact);
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (target.isConnected) target.replaceChildren(card(notice(error.message, 'error'), button('重试计算', () => refreshCandidates(target, compact), 'ghost', { style: 'margin-top:12px' })));
  }
}
function drawResultPanel(target, result, compact) {
  const box = card(cardHead(compact ? '候选预览' : '候选结果', rulesInfo(), compact ? [button('展开 →', () => navigate('results'), 'small ghost')] : []), statsCards(result));
  if (!compact) {
    const order = el('select', { 'aria-label': '候选排列顺序', onChange: event => { state.options.order = event.target.value; state.options.page = 1; persistPreferences(); refreshCandidates(target); } },
      el('option', { value: 'number', selected: state.options.order === 'number' }, '按号码排列'),
      el('option', { value: 'score', selected: state.options.order === 'score' }, '按历史频次排序分'));
    const perPage = el('select', { 'aria-label': '每页候选数量', onChange: event => { state.options.pageSize = Number(event.target.value); state.options.page = 1; refreshCandidates(target); } }, [50, 100, 200, 500].map(n => el('option', { value: n, selected: state.options.pageSize === n }, n + ' 条 / 页')));
    box.append(el('div', { class: 'atlas-toolbar' }, el('div', { class: 'atlas-actions' }, order, perPage), el('div', { class: 'atlas-actions' },
      button(state.options.inverse ? '✓ 反集已启用' : '取反集', () => { state.options.inverse = !state.options.inverse; state.options.page = 1; persistPreferences(); refreshCandidates(target); }, state.options.inverse ? 'active' : 'ghost'),
      button('返回条件', () => navigate('conditions'), 'ghost'))));
  }
  const list = compact ? result.items.slice(0, 24) : result.items;
  const needsHistory = !state.records.length && state.rules.some(rule => rule.enabled !== false && rule.values?.length && (['sumAmplitude', 'amplitudeAttr', 'repeat'].includes(rule.metricId) || rule.metricId.startsWith('positionOmission:')));
  if (!result.count) box.append(empty(needsHistory ? '当前条件依赖前序，暂无数据' : '当前条件没有交集', needsHistory ? '当前没有有效历史记录，跨期或定位遗漏条件无法判断。请导入数据，或停用依赖历史的条件；静态数字条件仍可生成合法候选全集。' : '尝试减少条件、修改取值或调整明确的容错数量。', [button('编辑条件', () => navigate('conditions'), 'ghost')]));
  else if (state.options.order === 'score' && !compact) {
    const table = el('table', { class: 'atlas-table' }, el('thead', {}, el('tr', {}, ['序号', '候选号码', '历史频次排序分', '未满足条件数'].map(label => el('th', {}, label)))), el('tbody', {}, list.map((item, i) => el('tr', {}, el('td', { class: 'atlas-num' }, (state.options.page - 1) * state.options.pageSize + i + 1), el('td', { class: 'atlas-mono' }, formatNumbers(item.numbers)), el('td', { class: 'atlas-num' }, Number(item.score || 0).toFixed(2)), el('td', { class: 'atlas-num' }, item.failed)))));
    box.append(el('div', { class: 'atlas-table-wrap' }, table));
  } else box.append(el('div', { class: 'atlas-result-grid' + (state.rule.count > 3 || state.rule.max > 9 ? ' large' : '') }, list.map(item => el('div', { class: 'atlas-number', title: '排序分 ' + Number(item.score || 0).toFixed(2) + '；不满足 ' + item.failed + ' 条' }, formatNumbers(item.numbers)))));
  if (compact && result.count > list.length) box.append(el('p', { class: 'atlas-help', style: 'margin-top:10px' }, '预览 ' + list.length + ' 条 / 共 ' + num(result.count) + ' 条。'));
  if (!compact) {
    const pages = Math.max(1, Math.ceil(result.count / state.options.pageSize));
    const pageInput = el('input', { type: 'number', min: 1, max: pages, value: state.options.page, 'aria-label': '候选页码' });
    const go = page => { state.options.page = Math.max(1, Math.min(pages, Math.floor(page) || 1)); refreshCandidates(target); };
    pageInput.addEventListener('change', () => go(Number(pageInput.value)));
    box.append(el('div', { class: 'atlas-pagination' }, button('← 上一页', () => go(state.options.page - 1), 'small ghost', { disabled: state.options.page <= 1 }), pageInput, '/ ' + num(pages) + ' 页', button('下一页 →', () => go(state.options.page + 1), 'small ghost', { disabled: state.options.page >= pages })));
  }
  box.append(el('div', { class: 'atlas-result-tools' },
    button('复制本页', () => copyCandidates(false), 'ghost', { disabled: !result.count }),
    !compact ? button('复制全部', () => copyCandidates(true), 'ghost', { disabled: !result.count }) : null,
    button('导出全部 CSV', exportCandidates, 'ghost', { disabled: !result.count }),
    button('保存方案', () => savePresetDialog(), 'ghost'),
    button('发送到 K 线', () => savePresetDialog('kline'), 'primary', { disabled: !result.count })),
    el('p', { class: 'atlas-help' }, result.definition || '排序分只描述历史频次，不表示未来命中概率。'),
    el('p', { class: 'atlas-help', style: 'margin-top:4px' }, '总数按完整空间扫描；分页不会改变筛选结果。组合占比不等于经过验证的预测优势。'));
  target.replaceChildren(box);
}
async function copyCandidates(all) {
  try {
    if (!state.results?.count) return;
    if (all && state.results.count > 10000) throw Error('完整结果超过 10,000 条，请使用“导出全部 CSV”；“复制本页”仍可使用。');
    const result = all ? await getCandidates({ page: 1, pageSize: Math.max(1, state.results.count), collectLimit: 10000 }) : state.results;
    if (all && result.items.length !== result.count) throw Error('尚未取得完整结果，请改用导出全部。');
    await navigator.clipboard.writeText(result.items.map(item => formatNumbers(item.numbers)).join('\n'));
    notify('已复制 ' + num(result.items.length) + ' 条' + (all ? '（全部结果）' : '（当前页）'));
  } catch (error) { notify(error.message || '浏览器未允许剪贴板，请使用 CSV 导出。', true); }
}
function download(text, filename, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = el('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
async function exportCandidates() {
  const { modal, body, actions } = dialog('导出全部候选', '后台完整扫描一次，完成后下载 CSV。');
  const progress = el('p', { class: 'atlas-muted' }, '正在扫描完整空间…'); body.append(loading('生成导出文件'), progress);
  const controller = new AbortController(); const source = state.source.id; let complete = false;
  actions.append(button('取消', () => modal.close(), 'ghost'));
  modal.addEventListener('close', () => { if (!complete) controller.abort(); }, { once: true });
  try {
    const result = await workerRun('export', { ...candidatePayload(), source }, { signal: controller.signal, progress: data => progress.textContent = data.total == null ? '已收集 ' + num(data.done) + ' 条，继续扫描完整空间…' : '已生成 ' + num(data.done) + ' / ' + num(data.total) + ' 条' });
    complete = true; modal.close(); download(result.text, 'atlas-' + source.replace(/[^a-z0-9-]/gi, '-') + '-' + Date.now() + '.csv'); notify('已导出全部 ' + num(result.count) + ' 条候选');
  } catch (error) { if (error.name !== 'AbortError') { body.replaceChildren(notice(error.message, 'error')); } }
}
function zonedPayload(extra = {}) {
  const zones = state.source.rule.zones, zoneRules = {}, zoneOptions = {};
  if (!zones?.front || !zones?.back) throw Error('当前来源不支持前后双区。');
  for (const zone of ['front', 'back']) {
    const saved = zone === state.zone ? { rules: state.rules, options: state.options } : state.workspace.preferences?.rulesByScope?.[scopeKey(zone)];
    const history = state.records.map(record => ({ ...record, numbers: [...(record.zones?.[zone] || [])] }));
    zoneRules[zone] = clone(saved?.rules || []);
    zoneOptions[zone] = { ...(saved?.options || {}), params: parametersFor(zones[zone], zone), history, previous: history.at(-1)?.numbers || [] };
  }
  return { zones: clone(zones), zoneRules, options: { page: state.zonedPage, pageSize: 100, ...extra, zoneOptions } };
}
function formatZone(numbers) { return numbers.map(n => String(n).padStart(state.workspace.preferences?.format?.pad === false ? 1 : 2, '0')).join(','); }
async function exportZoned(firstBatch = false) {
  const options = firstBatch ? { page: 1, pageSize: 10000 } : { page: state.zonedPage, pageSize: 100 };
  const { modal, body, actions } = dialog(firstBatch ? '导出前 10,000 条合并结果' : '导出当前合并结果页', firstBatch ? '完整注数可能超过两千万；本次仅导出筛选结果最前面的至多 10,000 条，CSV 会标明总数及范围。' : '本次仅导出当前页的至多 100 条完整前后区组合。');
  const controller = new AbortController(); let finished = false;
  body.append(loading('正在后台生成指定范围…')); actions.append(button('取消', () => modal.close(), 'ghost'));
  modal.addEventListener('close', () => { if (!finished) controller.abort(); }, { once: true });
  try {
    const source = state.source.id;
    const result = await workerRun('zonedExport', { ...zonedPayload(options), source }, { signal: controller.signal });
    finished = true; modal.close();
    download(result.text, 'atlas-dlt-rows-' + result.start + '-' + result.end + '.csv');
    notify('已导出第 ' + num(result.start) + '–' + num(result.end) + ' 条 / 共 ' + num(result.count) + ' 条');
  } catch (error) { if (error.name !== 'AbortError') body.replaceChildren(notice(error.message, 'error')); }
}
async function refreshZoned(target) {
  candidateController?.abort(); candidateController = new AbortController(); const epoch = state.epoch;
  target.replaceChildren(card(loading('正在合并两区条件并计算完整注数…')));
  try {
    const payload = zonedPayload(), result = await workerRun('zoned', payload, { signal: candidateController.signal });
    if (epoch !== state.epoch || !target.isConnected) return;
    state.zonedResult = result;
    const box = card(cardHead('前后区合并结果', '前区、后区分别应用各自保存的条件与容错，再生成完整的一注。'),
      el('div', { class: 'atlas-kpis' }, [
        ['完整空间', num(result.total), '324,632 × 66'],
        ['筛选注数', num(result.count), num(result.frontCount) + ' 前区 × ' + num(result.backCount) + ' 后区'],
        ['组合占比', result.total ? (result.count / result.total * 100).toFixed(3) + '%' : '—', '不是预测命中率'],
      ].map(([label, value, note]) => el('div', { class: 'atlas-kpi' }, el('span', {}, label), el('strong', {}, value), el('small', {}, note)))),
      notice('当前使用：前区 ' + payload.zoneRules.front.filter(r => r.enabled !== false && r.values?.length).length + ' 条启用规则；后区 ' + payload.zoneRules.back.filter(r => r.enabled !== false && r.values?.length).length + ' 条启用规则。两区各自独立应用全局容错和取反设置。'));
    if (result.items.length) box.append(el('div', { class: 'atlas-table-wrap', style: 'margin-top:16px' }, el('table', { class: 'atlas-table' },
      el('thead', {}, el('tr', {}, ['序号', '前区 · 5 / 35', '后区 · 2 / 12'].map(label => el('th', {}, label)))),
      el('tbody', {}, result.items.map((item, i) => el('tr', {}, el('td', { class: 'atlas-num' }, (result.page - 1) * result.pageSize + i + 1), el('td', { class: 'atlas-mono' }, formatZone(item.zones.front)), el('td', { class: 'atlas-mono' }, formatZone(item.zones.back))))))));
    else box.append(empty('没有完整前后区组合', '某个区域没有通过筛选的结果。请切换对应区域修改条件。'));
    const pages = Math.max(1, Math.ceil(result.count / result.pageSize));
    const go = value => { state.zonedPage = Math.max(1, Math.min(pages, Math.floor(value) || 1)); refreshZoned(target); };
    const input = el('input', { type: 'number', min: 1, max: pages, value: result.page, 'aria-label': '双区结果页码', onChange: event => go(Number(event.target.value)) });
    box.append(el('div', { class: 'atlas-pagination' }, button('← 上一页', () => go(result.page - 1), 'small ghost', { disabled: result.page <= 1 }), input, '/ ' + num(pages) + ' 页 · 100 注 / 页', button('下一页 →', () => go(result.page + 1), 'small ghost', { disabled: result.page >= pages })),
      el('div', { class: 'atlas-result-tools' },
        button('复制本页完整号码', async () => { try { await navigator.clipboard.writeText(result.items.map(item => formatZone(item.zones.front) + ' | ' + formatZone(item.zones.back)).join('\n')); notify('已复制当前页 ' + result.items.length + ' 注完整号码'); } catch (error) { notify('复制失败，请改用 CSV 导出。', true); } }, 'ghost', { disabled: !result.items.length }),
        button('导出本页 CSV', () => exportZoned(false), 'ghost', { disabled: !result.items.length }),
        button('导出前 10,000 条 CSV', () => exportZoned(true), 'ghost', { disabled: !result.count })),
      el('p', { class: 'atlas-help' }, result.definition + ' 合并结果只按号码序排列；导出范围会在文件中明确记录。'));
    target.replaceChildren(box);
  } catch (error) { if (error.name !== 'AbortError' && target.isConnected) target.replaceChildren(card(notice(error.message, 'error'), button('重试', () => refreshZoned(target), 'ghost'))); }
}
function renderResults() {
  if (!state.rule) return renderNonNumber();
  const target = el('div', {}), children = [];
  if (state.source.schemaId === 'dlt') children.push(el('div', { class: 'atlas-toolbar', style: 'margin-bottom:16px' }, el('div', { class: 'atlas-actions' },
    button('当前区 · ' + scopeLabel(), () => { state.zonedMode = false; renderResults(); }, state.zonedMode ? 'ghost' : 'primary'),
    button('前后区合并 · 完整一注', () => { stashScope(); state.zonedMode = true; state.zonedPage = 1; renderResults(); }, state.zonedMode ? 'primary' : 'ghost', { 'data-atlas-zoned': 'true' }))));
  children.push(target); content.replaceChildren(...children);
  if (state.source.schemaId === 'dlt' && state.zonedMode) refreshZoned(target); else refreshCandidates(target);
}

const TREND_VIEWS = [
  ['basic', '基本走势', () => ['numbers', 'shape', 'smallCount', 'evenCount', 'compositeCount', 'sum']],
  ['positions', '立体走势', () => state.catalog.filter(m => m.id.startsWith('position:')).map(m => m.id)],
  ['sum', '和值走势', () => ['sum']], ['sumtail', '和合走势', () => ['sumBands', 'tail']],
  ['diff', '差跨走势', () => ['pairDiff', 'sameDiff', 'span']],
  ['diffcount', '差值个数', () => state.catalog.filter(m => m.id.startsWith('diffCount:')).map(m => m.id)],
  ['headtail', '龙头凤尾', () => ['headAttr', 'tailAttr']],
  ['route', '012 路走势', () => ['numbers', 'routeCount:0', 'routeCount:1', 'routeCount:2']],
  ['pairsum', '和合分布', () => ['pairSum', 'pairTail']], ['mean', '均值走势', () => ['mean', 'meanAttr']],
  ['amplitude', '和振走势', () => ['sumAmplitude', 'amplitudeAttr']],
  ['custom', '自定义指标组合', () => state.trendIds],
];
function openTrendMetrics(onApply) {
  const { modal, body, actions } = dialog('组合走势图谱', '选择所需指标；所有定义可展开查看。列数较多时表格按组分页。');
  const selected = new Set(state.trendIds), query = el('input', { type: 'search', placeholder: '搜索指标名称或分组', 'aria-label': '搜索走势指标' }), list = el('div', { class: 'atlas-catalog-grid' });
  const count = el('span', { class: 'atlas-muted' });
  const render = () => {
    count.textContent = '已选 ' + selected.size + ' 个指标';
    list.replaceChildren(...state.catalog.filter(m => m.values.length && (!query.value || (m.label + m.group).includes(query.value))).map(m => el('label', { class: 'atlas-catalog-item' }, el('span', { class: 'atlas-check-label' }, el('input', { type: 'checkbox', checked: selected.has(m.id), onChange: event => { event.target.checked ? selected.add(m.id) : selected.delete(m.id); count.textContent = '已选 ' + selected.size + ' 个指标'; } }), m.label), el('small', {}, m.group + (m.uncertain ? ' · 明示自定义口径' : '')))));
  };
  query.addEventListener('input', render);
  body.append(el('div', { class: 'atlas-catalog-controls' }, query), list); actions.append(count, button('取消', () => modal.close(), 'ghost'), button('应用组合', () => {
    if (!selected.size) return notify('至少选择一个指标。', true);
    const columns = state.catalog.filter(m => selected.has(m.id)).reduce((sum, m) => sum + m.values.length, 0);
    if (columns > 1500) return notify('所选组合超过 1,500 列，请分批查看这些指标。', true);
    state.trendIds = [...selected]; state.trendSelection.clear(); state.trendPage = 0; modal.close(); onApply();
  }, 'primary')); render(); query.focus();
}
function renderTrends() {
  if (!state.rule) return renderNonNumber();
  if (!state.trendIds.length) state.trendIds = TREND_VIEWS[0][2]().filter(id => metricById(id));
  const target = el('div', {}), selectedLabels = () => state.trendIds.map(id => metricById(id)?.label.split(' / ')[0]).join(' · ');
  const preset = el('select', { 'aria-label': '截图走势视图', onChange: event => {
    const view = TREND_VIEWS.find(v => v[0] === event.target.value);
    if (view[0] === 'custom') return openTrendMetrics(() => renderTrends());
    state.trendIds = view[2]().filter(id => metricById(id)); state.trendSelection.clear(); state.trendPage = 0; loadTrend(target);
  } }, TREND_VIEWS.map(([id, label]) => el('option', { value: id }, label)));
  const matched = TREND_VIEWS.find(v => v[0] !== 'custom' && JSON.stringify(v[2]().filter(id => metricById(id))) === JSON.stringify(state.trendIds));
  preset.value = matched?.[0] || 'custom';
  const heading = card(cardHead('历史走势矩阵', '色块表示本期命中，灰色数字表示连续未出现期数。'),
    el('div', { class: 'atlas-toolbar' }, el('div', { class: 'atlas-actions' }, preset, button('选择 / 组合指标', () => openTrendMetrics(() => renderTrends()), 'ghost')), chip(state.records.length + ' 期 · ' + scopeLabel(), 'accent')),
    el('p', { class: 'atlas-help' }, '点击列值选择条件，支持跨列组分页选择后统一提交。统计按实际记录计算，跨期数据缺少前序时显示 —。'));
  content.replaceChildren(el('div', { class: 'atlas-stack' }, heading, target));
  loadTrend(target);
}
async function loadTrend(target) {
  trendController?.abort(); trendController = new AbortController(); target.replaceChildren(card(loading('正在整理历史走势与遗漏…')));
  const epoch = state.epoch;
  try {
    const result = await workerRun('trend', { records: state.records, metricIds: state.trendIds, rule: state.rule, params: state.params }, { signal: trendController.signal });
    if (epoch !== state.epoch || !target.isConnected) return;
    state.trendResult = result; drawTrend(target);
  } catch (error) { if (error.name !== 'AbortError' && target.isConnected) target.replaceChildren(card(notice(error.message, 'error'))); }
}
function drawTrend(target) {
  const result = state.trendResult;
  if (!result || !state.records.length) return target.replaceChildren(card(empty('当前来源没有可绘制的记录', '导入或积累开奖记录后，这里会按期显示命中、遗漏与统计。', [button('打开数据导入', () => navigate('settings'), 'primary')])));
  const all = result.columns, pageSize = 70, pages = Math.max(1, Math.ceil(all.length / pageSize));
  state.trendPage = Math.max(0, Math.min(pages - 1, state.trendPage));
  const offset = state.trendPage * pageSize, columns = all.slice(offset, offset + pageSize);
  const selected = [...state.trendSelection];
  const toolbar = el('div', { class: 'atlas-trend-selected' }, chip('已选 ' + selected.length + ' 列', 'accent'),
    button('将所选列添加为条件', async () => {
      const grouped = new Map();
      for (const column of all) if (state.trendSelection.has(column.key)) { if (!grouped.has(column.metricId)) grouped.set(column.metricId, []); grouped.get(column.metricId).push(column.value); }
      if (!grouped.size) return notify('先点击表头中的指标值。');
      const rules = [...grouped].map(([metricId, values]) => ({ id: uid(), metricId, values, minHits: 1, maxHits: 99, tolerance: 0, exclude: false, enabled: true }));
      await setRules([...state.rules, ...rules]); state.trendSelection.clear(); notify('已加入 ' + rules.length + ' 条条件'); navigate('conditions');
    }, 'primary', { disabled: !selected.length }), button('清空选择', () => { state.trendSelection.clear(); drawTrend(target); }, 'ghost', { disabled: !selected.length }));
  if (pages > 1) toolbar.append(el('span', { class: 'atlas-muted', style: 'margin-left:auto' }, '列组 ' + (state.trendPage + 1) + ' / ' + pages + ' · 共 ' + all.length + ' 列'), button('←', () => { state.trendPage--; drawTrend(target); }, 'small ghost', { disabled: state.trendPage === 0, 'aria-label': '上一列组' }), button('→', () => { state.trendPage++; drawTrend(target); }, 'small ghost', { disabled: state.trendPage >= pages - 1, 'aria-label': '下一列组' }));
  const groups = [];
  for (const column of columns) { const last = groups.at(-1); if (last?.id === column.metricId) last.count++; else groups.push({ id: column.metricId, count: 1 }); }
  const header1 = el('tr', {}, el('th', { class: 'sticky', rowspan: 2 }, '期号'), el('th', { class: 'number-col', rowspan: 2 }, '观察号码'),
    groups.map(group => el('th', { colspan: group.count, title: metricById(group.id)?.definition }, metricById(group.id)?.label.split(' / ')[0] || group.id)));
  const header2 = el('tr', {}, columns.map(column => el('th', { class: state.trendSelection.has(column.key) ? 'selected' : '', style: 'top:34px', title: column.label },
    button(String(column.value), () => { state.trendSelection.has(column.key) ? state.trendSelection.delete(column.key) : state.trendSelection.add(column.key); drawTrend(target); }, 'small ghost', { 'aria-pressed': state.trendSelection.has(column.key), 'aria-label': '选择 ' + (metricById(column.metricId)?.label || '') + ' ' + column.value }))));
  const tbody = el('tbody', {});
  for (const row of result.rows) tbody.append(el('tr', {}, el('td', { class: 'sticky' }, row.period), el('td', { class: 'number-col atlas-mono' }, (row.numbers || []).map(n => String(n).padStart(state.rule.max > 9 ? 2 : 1, '0')).join(' ')),
    columns.map((column, i) => { const cell = row.cells[offset + i]; const tone = state.trendIds.indexOf(column.metricId) % 3; return el('td', { class: cell.hit === null || cell.miss == null ? 'unknown' : cell.hit ? 'hit ' + (tone === 1 ? 'blue' : tone === 2 ? 'purple' : '') : 'miss', title: cell.hit === null ? '没有有效前序，或数据不连续' : cell.hit ? '本期命中' : '连续 ' + cell.miss + ' 期未出现' }, cell.hit === null || cell.miss == null ? '—' : cell.hit ? String(column.value) : cell.miss); })));
  const footer = el('tfoot', {}, [['出现次数', 'count'], ['最大连出', 'maxStreak'], ['最大遗漏', 'maxMiss'], ['当前遗漏', 'currentMiss']].map(([label, key]) => el('tr', {}, el('td', { class: 'sticky' }, label), el('td', { class: 'number-col' }, '窗口内统计'), columns.map((_, i) => el('td', {}, result.stats[offset + i]?.[key] ?? '—')))));
  const defs = el('details', { class: 'atlas-definition' }, el('summary', {}, '当前 ' + state.trendIds.length + ' 个指标的公开定义'), el('ul', {}, state.trendIds.map(id => { const metric = metricById(id); return el('li', {}, el('strong', {}, metric?.label + '：'), metric?.definition, metric?.uncertain ? '【本平台明示自定义口径】' : ''); })));
  target.replaceChildren(card(toolbar, el('div', { class: 'atlas-table-wrap' }, el('table', { class: 'atlas-table atlas-trend-table' }, el('thead', {}, header1, header2), tbody, footer)),
    el('div', { class: 'atlas-trend-legend' }, el('span', {}, el('i', { class: 'atlas-legend-dot' }), '命中值'), el('span', {}, '灰色：遗漏期数'), el('span', {}, '—：无法比较')),
    defs, el('p', { class: 'atlas-help', style: 'margin-top:10px' }, '遗漏只覆盖当前观察窗口；未出现不代表即将出现。截图中的未知规则按目录所示明确定义执行。')));
}

async function savePresetDialog(purpose = 'save') {
  if (!state.rule) return notify('请选择数字来源后保存条件方案。', true);
  const { modal, body, actions } = dialog(purpose === 'kline' ? '保存并发送到命中 K 线' : '保存当前参考方案', '保存条件定义与来源口径，不把历史排序分当作命中概率。');
  const name = el('input', { value: scopeLabel() + ' · ' + state.rules.filter(r => r.enabled !== false).length + ' 条件', maxlength: 80, style: 'width:100%', 'aria-label': '方案名称' });
  body.append(field('方案名称', name), el('p', { class: 'atlas-help', style: 'margin-top:14px' }, state.source.label + ' / ' + scopeLabel() + ' / ' + rulesInfo()));
  const save = button(purpose === 'kline' ? '保存并查看 K 线' : '保存方案', async () => {
    if (!name.value.trim()) return notify('请填写方案名称。', true);
    save.disabled = true;
    try {
      const preset = { id: uid(), name: name.value.trim(), sourceId: state.source.id, projection: state.projection, zone: state.zone, rule: clone(state.rule), rules: clone(state.rules), options: { globalTolerance: state.options.globalTolerance, inverse: state.options.inverse, order: state.options.order }, params: clone(state.params), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), kind: 'rules' };
      const workspace = clone(state.workspace); workspace.presets = [...(workspace.presets || []), preset];
      workspace.preferences ||= {}; workspace.preferences.activePresetId = preset.id;
      await saveWorkspace(workspace); modal.close(); notify('方案已保存');
      if (purpose === 'kline') navigate('kline'); else if (state.tab === 'presets') renderPresets();
    } catch (error) { notify('保存失败：' + error.message, true); save.disabled = false; }
  }, 'primary');
  actions.append(button('取消', () => modal.close(), 'ghost'), save); name.select();
}
function demoPresets() {
  if (!state.rule) return [];
  const make = (metricId, values, name, description) => ({ name, description, rules: [{ id: uid(), metricId, values, minHits: 1, maxHits: 99, tolerance: 0, exclude: false, enabled: true }] });
  const sum = metricById('sum'), span = metricById('span'), digits = metricById('numbers'), demos = [];
  if (sum) demos.push(make('sum', sum.values.slice(Math.floor(sum.values.length / 3), Math.ceil(sum.values.length * 2 / 3)), '和值区间观察', '把和值域中间三分之一作为演示条件，检查候选缩减程度；不代表更易命中。'));
  if (span) demos.push(make('span', span.values.slice(0, Math.max(1, Math.ceil(span.values.length / 2))), '跨度范围观察', '用跨度域前一半演示数值条件；可与和值、定位条件组合。'));
  if (digits) demos.push(make('numbers', digits.values.filter((_, i) => i % 3 === 0), '胆码集合观察', '按号码目录每隔两项取一项，要求至少出现一个；仅演示集合计数。'));
  return demos;
}
async function applyPreset(preset, targetTab = preset.kind === 'event-group' ? 'monitor' : 'conditions') {
  const source = state.sources.find(s => s.id === preset.sourceId);
  if (!source) throw Error('该方案的数据来源不在当前目录，不能自动套用。');
  stashScope(); state.source = source; state.projection = preset.projection || (source.schemaId === 'eleven5' ? 'any5' : 'front3'); state.zone = preset.zone || 'front';
  normalizeProjection(); restoreScope();
  if (preset.kind !== 'event-group') {
    state.rules = clone(preset.rules || []); state.options = { ...state.options, ...preset.options, page: 1 };
  }
  if (preset.params) { state.workspace.preferences.metricParamsByScope ||= {}; state.workspace.preferences.metricParamsByScope[scopeKey()] = clone(preset.params); }
  state.workspace.preferences.activePresetId = preset.id;
  if (targetTab === 'monitor') state.workspace.preferences.pendingMonitorPresetId = preset.id;
  state.tab = targetTab; stashScope();
  await saveWorkspace(state.workspace); await reload(); persistPreferences(); notify('已载入方案：' + preset.name);
}
function renderPresets() {
  const saved = state.workspace.presets || [], grid = el('div', { class: 'atlas-grid' });
  for (const preset of saved) {
    const source = state.sources.find(s => s.id === preset.sourceId);
    const eventOnly = preset.kind === 'event-group';
    grid.append(el('article', { class: 'atlas-preset-card' },
      el('div', { class: 'atlas-preset-title' }, el('h3', {}, preset.name || '未命名方案'), chip(eventOnly ? '组合事件' : preset.kind === 'numbers' ? '号码集合' : '条件方案', eventOnly ? 'purple' : 'accent')),
      el('div', { class: 'atlas-preset-meta' }, (source?.label || preset.sourceId || '未标注来源') + (preset.zone ? ' · ' + (preset.zone === 'back' ? '后区' : '前区 / 单区') : '')),
      el('p', { class: 'atlas-help' }, eventOnly ? '只用于方案监测 / K 线中的组合事件，不能作为完整号码筛选条件加载。' : (preset.rules?.length || 0) + ' 条规则' + (preset.numbers?.length ? ' · ' + num(preset.numbers.length) + ' 组已存号码' : '') + '；加载时还原来源、投影及容错配置。'),
      el('div', { class: 'atlas-actions' }, button(eventOnly ? '查看监测' : '加载条件', () => applyPreset(preset).catch(error => notify(error.message, true)), 'primary small'),
        button('查看 K 线', () => applyPreset(preset, 'kline').catch(error => notify(error.message, true)), 'ghost small'),
        button('删除', async () => { try { await saveWorkspace({ ...state.workspace, presets: saved.filter(item => item.id !== preset.id) }); renderPresets(); notify('方案已删除'); } catch (error) { notify(error.message, true); } }, 'ghost small'))));
  }
  const box = card(cardHead('我的参考方案', '保留每个方案的规则、来源与创建时间。', [button('保存当前条件', () => savePresetDialog(), 'primary', { disabled: !state.rule })]), saved.length ? grid : empty('还没有保存的方案', '在条件工作台完成筛选后，点击“保存方案”。也可以先使用下方透明演示条件。', [button('去条件工作台', () => navigate('conditions'), 'ghost')]));
  const demos = demoPresets();
  const demoBox = card(cardHead('透明演示条件', '用于了解筛选行为；这些方案没有预设收益或命中优势。'),
    el('div', { class: 'atlas-grid' }, demos.map(demo => el('article', { class: 'atlas-preset-card' }, chip('演示 · 非推荐', 'purple'), el('h3', {}, demo.name), el('p', { class: 'atlas-help' }, demo.description),
      button('载入演示条件', async () => { await setRules(demo.rules); state.options.inverse = false; state.options.globalTolerance = 0; navigate('conditions'); notify('已载入可编辑的演示条件'); }, 'ghost')))));
  content.replaceChildren(el('div', { class: 'atlas-stack' }, box, demos.length ? demoBox : null));
}
function renderNonNumber() {
  content.replaceChildren(card(empty('当前选择的是赛事数据', '足球按比赛事件、时间和比分浏览，不套用数字彩票的组合枚举规则。', [button('查看足球数据', () => navigate('sports'), 'primary'), button('导入与格式设置', () => navigate('settings'), 'ghost')])));
}
function renderHelp() {
  const rows = [
    ['三位 / 五位数字', '已接入', '固定位置、可重复数字；前三 / 中三 / 后三 / 全五位投影。'],
    ['11选5', '本地导入', '任N按无序子集逐期统计；前N保留原始开奖位置。'],
    ['大乐透', '本地导入', '前后区独立筛选后合并分页；完整空间21,425,712注，有界导出明确范围。'],
    ['足球', '本地导入', '比赛状态和比分事件；无自动外网服务。'],
    ['双色球 / 篮球', '待接入', '需要明确双区号码或赛事适配器；当前没有对应数据接口。'],
    ['手机版', '当前为自适应页面', '小屏可浏览本工作台；没有声称提供独立手机安装包。'],
    ['知识讲座', '内置规则说明', '知识助手提供已公开的指标定义；没有外部课程接口。'],
  ];
  content.replaceChildren(el('div', { class: 'atlas-stack' },
    card(cardHead('一个独立、可复用的研究空间', '旧平台保持原有功能；这里通过公开的数据契约共享只读快照。'),
      notice('图谱与原平台共用同一数据库，每 5 秒核对版本，新增、更正和删除都会自动更新。刷新快照只读取本地；“同步数据”仅补取上游数据。正在编辑时保留输入并提示待更新。保存的条件方案和监测设置属于图谱工作区。'),
      el('div', { class: 'atlas-table-wrap', style: 'margin-top:18px' }, el('table', { class: 'atlas-table' }, el('thead', {}, el('tr', {}, ['数据 / 功能', '状态', '明确边界'].map(x => el('th', {}, x)))), el('tbody', {}, rows.map(row => el('tr', {}, row.map(cell => el('td', { style: 'white-space:normal' }, cell)))))))),
    card(cardHead('如何理解筛选与走势'), el('ol', { class: 'atlas-help' },
      el('li', {}, '先选择数据来源与投影，再添加条件。每条规则都有公开定义，未知原公式的指标会标注“明示自定义口径”。'),
      el('li', {}, '规则内允许数量偏差；全局容错表示可有多少条规则不满足。未选值的规则默认停用。'),
      el('li', {}, '候选数占全集比例是组合占比。历史频次分、冷热、遗漏和机制共识都不是校准后的预测概率。'),
      el('li', {}, '跨期指标需要有效前序。已知缺期会断开比较；没有日历的导入来源只按相邻记录描述。'),
      el('li', {}, '参考截图存在空白、重复以及没有公开公式的页面；本工作台逐项记录与公开采用的规则，不猜测隐藏算法。')),
      el('div', { class: 'atlas-actions', style: 'margin-top:18px' }, el('a', { class: 'atlas-button', href: '/' }, '返回原平台'), el('a', { class: 'atlas-button', href: '/analysis' }, '原量化分析'), button('查看指标目录', openCatalog, 'primary', { disabled: !state.rule })))));
}
function toolContext(elNode) {
  const frozen = state.rule ? clone(candidatePayload()) : null;
  const scopedCandidates = async (extra = {}) => {
    if (!frozen) throw Error('当前赛事来源没有数字组合空间。');
    const options = { ...frozen.options, ...extra };
    delete options.rules; delete options.rule; delete options.signal; delete options.progress;
    return workerRun('evaluate', { rule: extra.rule || frozen.rule, rules: extra.rules || frozen.rules, options }, { signal: extra.signal });
  };
  return {
    el: elNode, source: state.source, snapshot: state.snapshot, records: state.records, rule: state.rule,
    params: state.params, projection: state.projection, zone: state.zone, workspace: state.workspace,
    rules: state.rules, options: state.options, selectedPresetId: state.workspace.preferences?.activePresetId,
    saveWorkspace, setRules, applyPreset, notify, reload, navigate, getCandidates: scopedCandidates,
    viewState: toolViews.get(scopeKey() + ':' + state.tab) || (() => { const value = {}; toolViews.set(scopeKey() + ':' + state.tab, value); return value; })(),
    markClean: () => { viewDirty = false; },
  };
}
async function navigate(tab) {
  if (!NAV.some(item => item[0] === tab)) tab = 'conditions';
  state.tab = tab; viewDirty = false; state.epoch++; const epoch = state.epoch;
  candidateController?.abort(); trendController?.abort();
  if (state.cleanup) { try { state.cleanup(); } catch {} state.cleanup = null; }
  const [id, label, , subtitle] = NAV.find(item => item[0] === tab);
  document.getElementById('atlas-title').textContent = label;
  document.getElementById('atlas-subtitle').textContent = subtitle || '公开规则、清晰记录，在当前数据范围内逐项检验。';
  for (const item of document.querySelectorAll('[data-atlas-tab]')) { const active = item.dataset.atlasTab === tab; item.classList.toggle('active', active); active ? item.setAttribute('aria-current', 'page') : item.removeAttribute('aria-current'); }
  const url = new URL(location.href); url.searchParams.set('tab', tab); if (state.source) url.searchParams.set('source', state.source.id); history.replaceState({}, '', url);
  if (state.source) window.dispatchEvent(new CustomEvent('platform-source', {detail: state.source.id}));
  if (!state.source) return;
  if (tab === 'conditions') return renderConditions();
  if (tab === 'trends') return renderTrends();
  if (tab === 'results') return renderResults();
  if (tab === 'presets') return renderPresets();
  if (tab === 'help') return renderHelp();
  const target = el('div', {}); content.replaceChildren(target); target.append(loading('正在打开工具…'));
  try {
    const cleanup = await renderTool(tab, toolContext(target));
    if (epoch === state.epoch) state.cleanup = typeof cleanup === 'function' ? cleanup : null;
    else if (typeof cleanup === 'function') cleanup();
  } catch (error) { if (target.isConnected) target.replaceChildren(card(notice('工具暂未打开：' + error.message, 'error'), button('重试', () => navigate(tab), 'ghost', { style: 'margin-top:12px' }))); }
}
function editing() {
  return !!document.querySelector('dialog[open]') || viewDirty || !!document.activeElement?.matches('input,textarea,[contenteditable="true"]');
}
function renderLive(value) {
  liveState = value;
  const node = document.getElementById('atlas-live-status');
  const same = value.sourceId === state.source?.id;
  const current = same && value.phase === 'current' && value.revision === state.snapshot.revision;
  node.dataset.phase = current ? 'current' : value.phase === 'current' ? 'checking' : value.phase;
  node.dataset.revision = state.snapshot.revision || '';
  const remote = value.sync || {}, local = state.source?.kind === 'local';
  const delayed = !local && (remote.lastError || remote.freshness === 'stale' || value.freshness === 'stale');
  const label = !same ? '正在核对新来源' : value.phase === 'offline' ? '连接暂不可用，保留已加载数据'
    : value.pending ? (value.syncing ? '正在应用数据库更新' : '数据库有更新，保留当前编辑')
    : current ? (delayed ? '本地已一致 · 上游更新延迟' : '已与数据库一致') : '正在核对数据库';
  const latest = value.status?.latestPeriod;
  const details = [local ? '本地导入有变化时自动更新' : '共用原始开奖库',
    '每 5 秒检查', current && latest ? '最新期 ' + latest : null,
    value.lastSuccessfulCheck ? '核对 ' + new Date(value.lastSuccessfulCheck).toLocaleTimeString('zh-CN', { hour12: false }) : null];
  node.replaceChildren(el('span', { class: 'atlas-live-dot', 'aria-hidden': 'true' }), el('strong', {}, label),
    el('span', { class: 'atlas-live-detail' }, details.filter(Boolean).join(' · ')));
  node.title = value.error || remote.lastError || '新增、历史更正和删除均按同一数据库版本更新';
  const apply = document.getElementById('atlas-apply-update');
  apply.hidden = !same || !value.pending;
  apply.disabled = !!document.querySelector('dialog[open]') || !!refreshController || workspaceWrites > 0 || activeWorkers.size > 0;
}
async function reload(options = {}) {
  const automatic = options.automatic === true;
  if (!state.source || (options.expectedSource && options.expectedSource !== state.source.id)) return;
  if (automatic && (editing() || refreshController || workspaceWrites || activeWorkers.size)) return;
  refreshController?.abort();
  const request = new AbortController(); refreshController = request;
  const sourceId = state.source.id, epoch = state.epoch;
  const refreshButton = document.getElementById('atlas-refresh'); refreshButton.disabled = true;
  const sameSource = state.snapshot.source?.id === sourceId;
  const scroll = { x: window.scrollX, y: window.scrollY };
  try {
    if (!sameSource) {
      candidateController?.abort(); trendController?.abort(); state.epoch++;
      if (state.cleanup) { try { state.cleanup(); } catch {} state.cleanup = null; }
      state.snapshot = { source: clone(state.source), records: [], events: [], quality: { state: 'empty', sampleSize: 0 } };
      state.results = null; state.zonedResult = null; state.trendResult = null;
      viewDirty = false; deriveContext(); renderSourceBar();
      content.replaceChildren(card(loading('正在读取新来源快照…')));
      live?.wake();
    }
    const snapshot = await api('/snapshot?source=' + encodeURIComponent(sourceId) + '&limit=300', { signal: request.signal, cache: 'no-store' });
    if (request.signal.aborted || refreshController !== request || state.source.id !== sourceId) return;
    // A user may start editing or navigate while the read is in flight. Leave that screen intact.
    if (automatic && (editing() || workspaceWrites || activeWorkers.size || epoch !== state.epoch)) return;
    if (snapshot.source?.id !== sourceId) throw Error('快照来源不一致，已忽略该响应。');
    state.snapshot = snapshot; state.results = null; state.zonedResult = null; state.trendResult = null;
    deriveContext(); renderSourceBar(); await navigate(state.tab);
    if (refreshController !== request || state.source.id !== sourceId) return;
    if (!automatic) persistPreferences();
    document.getElementById('atlas-app').dataset.ready = 'true';
    document.getElementById('atlas-app').dataset.revision = snapshot.revision;
    if (automatic) window.scrollTo(scroll.x, scroll.y);
    live?.markApplied();
  } catch (error) {
    if (error.name === 'AbortError' || state.source?.id !== sourceId || refreshController !== request) return;
    if (automatic) throw error;
    if (!state.snapshot.revision) {
      document.getElementById('atlas-app').dataset.ready = 'error';
      content.replaceChildren(card(empty('快照读取失败', error.message, [button('重试读取', () => reload(), 'primary'), button('数据设置', () => navigate('settings'), 'ghost')])));
    }
    notify('刷新失败，保留已加载数据：' + error.message, true);
  } finally {
    if (refreshController === request) {
      refreshController = null; refreshButton.disabled = false;
      if (liveState) renderLive(liveState);
    }
  }
}
async function syncNow() {
  if (syncBusy || state.source?.kind !== 'builtin') return;
  const sourceId = state.source.id, node = document.getElementById('atlas-sync-now');
  syncBusy = true; node.disabled = true; node.textContent = '正在同步…';
  try {
    const result = await api('/sync', { method: 'POST', body: JSON.stringify({ sourceId, force: true }) });
    if (state.source?.id === sourceId) {
      if (!editing()) await reload();
      await live?.wake();
    }
    notify(result.result?.skipped ? '后台已在同步或等待下一次更新，已核对本地数据。' : '已同步上游数据并核对图谱。');
  } catch (error) { notify('上游同步未完成：' + error.message + '。已保留本地数据。', true); await live?.wake(); }
  finally { syncBusy = false; node.disabled = false; node.textContent = '⇄ 同步数据'; }
}
async function boot() {
  const nav = document.getElementById('atlas-navigation'); nav.className = 'atlas-navigation';
  NAV.forEach(([tab, label, icon], index) => { if (index === 4 || index === 11) nav.append(el('div', { class: 'atlas-nav-divider' })); nav.append(el('button', { type: 'button', class: 'atlas-nav-button', 'data-atlas-tab': tab, onClick: () => navigate(tab) }, el('span', { class: 'atlas-nav-icon', 'aria-hidden': 'true' }, icon), label)); });
  document.getElementById('atlas-refresh').addEventListener('click', async () => { await reload(); await live?.wake(); });
  document.getElementById('atlas-sync-now').addEventListener('click', syncNow);
  document.getElementById('atlas-apply-update').addEventListener('click', async () => {
    if (document.querySelector('dialog[open]')) return;
    await reload(); await live?.wake();
  });
  // Unsaved tool forms remain visible until their action succeeds, navigation, or an explicit refresh.
  for (const event of ['input', 'change']) content.addEventListener(event, e => {
    if (!['conditions','trends','results','presets','help'].includes(state.tab) && e.target.matches('input,textarea,select')) viewDirty = true;
  });
  live = createAtlasLive({
    getSource: () => state.source,
    getRevision: () => state.snapshot.source?.id === state.source?.id ? state.snapshot.revision : null,
    fetchStatus: (sourceId, { signal }) => api('/status?source=' + encodeURIComponent(sourceId), { signal, cache: 'no-store' }),
    refresh: reload, onState: renderLive,
    isBusy: () => editing() || !!refreshController || workspaceWrites > 0 || activeWorkers.size > 0,
  });
  window.addEventListener('online', () => live.wake());
  window.addEventListener('focus', () => live.wake());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) live.wake(); });
  document.addEventListener('close', () => { if (liveState) renderLive(liveState); live.wake(); }, true);
  try {
    const [catalog, saved] = await Promise.all([api('/catalog'), api('/workspace')]);
    state.sources = catalog.sources || []; state.schemas = catalog.schemas || [];
    state.workspace = saved.workspace || state.workspace; state.workspace.preferences ||= {}; state.workspace.presets ||= []; state.workspace.monitors ||= [];
    const preferences = state.workspace.preferences, query = new URL(location.href).searchParams;
    state.source = state.sources.find(source => source.id === (query.get('source') || preferences.sourceId)) || state.sources[0];
    if (!state.source) throw Error('来源目录为空。');
    state.projection = preferences.projection || (state.source.schemaId === 'eleven5' ? 'any5' : 'front3'); state.zone = preferences.zone || 'front'; state.limit = PERIODS.includes(preferences.limit) ? preferences.limit : 50;
    state.tab = query.get('tab') || (state.source.schemaId === 'football' ? 'sports' : 'conditions');
    restoreScope(); deriveContext(); renderSourceBar(); await reload(); live.start();
  } catch (error) { document.getElementById('atlas-app').dataset.ready = 'error'; content.replaceChildren(card(empty('图谱工作台暂未连接', error.message, [button('重新打开', () => location.reload(), 'primary'), el('a', { href: '/', class: 'atlas-button' }, '返回原平台')]))); }
}
window.addEventListener('beforeunload', () => { live?.stop(); refreshController?.abort(); activeWorkers.forEach(worker => worker.terminate()); clearTimeout(persistTimer); state.cleanup?.(); });
boot();
