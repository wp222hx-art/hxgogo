import { evaluateCandidates, evaluateZonedCandidates, iterateMatches, buildTrend } from './atlas-core.js';

const escape = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
self.onmessage = async event => {
  const { id, type, payload } = event.data || {};
  try {
    if (type === 'evaluate') {
      self.postMessage({ id, result: evaluateCandidates(payload.rule, payload.rules, payload.options) });
    } else if (type === 'zoned') {
      self.postMessage({ id, result: evaluateZonedCandidates(payload.zones, payload.zoneRules, payload.options) });
    } else if (type === 'trend') {
      self.postMessage({ id, result: buildTrend(payload.records, payload.metricIds, payload.rule, payload.params) });
    } else if (type === 'export') {
      const options = { ...payload.options }, lines = ['source,rank,numbers,ranking_score,failed_rules'];
      let count = 0; const ranked = [];
      for (const item of iterateMatches(payload.rule, payload.rules, options)) {
        count++;
        if (options.order === 'score') ranked.push(item);
        else lines.push([payload.source, count, item.key, item.score, item.failed].map(escape).join(','));
        if (count % 2000 === 0) self.postMessage({ id, progress: { done: count, total: null } });
      }
      if (options.order === 'score') {
        ranked.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
        ranked.forEach((item, i) => lines.push([payload.source, i + 1, item.key, item.score, item.failed].map(escape).join(',')));
      }
      self.postMessage({ id, progress: { done: count, total: count } });
      self.postMessage({ id, result: { count, text: '\ufeff' + lines.join('\r\n') } });
    } else if (type === 'zonedExport') {
      const result = evaluateZonedCandidates(payload.zones, payload.zoneRules, payload.options);
      const start = (result.page - 1) * result.pageSize;
      const lines = ['source,rank,front,back,export_start,export_end,total_filtered'];
      result.items.forEach((item, i) => lines.push([payload.source, start + i + 1, item.zones.front.join(','), item.zones.back.join(','), start + 1, start + result.items.length, result.count].map(escape).join(',')));
      self.postMessage({ id, result: { count: result.count, exported: result.items.length, start: start + 1, end: start + result.items.length, text: '\ufeff' + lines.join('\r\n') } });
    } else throw new Error('未知计算任务');
  } catch (error) { self.postMessage({ id, error: error?.message || String(error) }); }
};