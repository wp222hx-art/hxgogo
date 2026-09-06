/** Read-only revision watcher. The host owns data loading and source synchronization. */
export function createAtlasLive({
  getSource, getRevision, fetchStatus, refresh, onState = () => {}, isBusy = () => false,
  now = () => Date.now(), setTimer = (fn, delay) => setTimeout(fn, delay), clearTimer = timer => clearTimeout(timer),
}) {
  for (const [name, fn] of Object.entries({ getSource, getRevision, fetchStatus, refresh, onState, isBusy, now, setTimer, clearTimer })) {
    if (typeof fn !== 'function') throw new TypeError(name + ' must be a function');
  }
  const interval = 5000, maximumRetry = 30000;
  let running = false, timer = null, generation = 0, flight = null, sourceId = null, failures = 0;
  let state = {
    phase: 'checking', running: false, checking: false, syncing: false, sourceId: null,
    revision: null, pendingRevision: null, pending: false, lastChecked: null, lastSuccessfulCheck: null,
    error: null, errorStage: null, nextRetryMs: null, nextCheckAt: null, retryCount: 0,
    status: null, source: null, sync: null, freshness: 'unknown',
  };
  const currentSource = () => getSource() || {};
  function emit(change = {}) {
    state = { ...state, ...change, running, pending: !!(change.pendingRevision === undefined ? state.pendingRevision : change.pendingRevision) };
    try { onState({ ...state }); } catch { /* Rendering failures must not turn a successful read into a network failure. */ }
    return { ...state };
  }
  function clearSchedule() { if (timer !== null) { clearTimer(timer); timer = null; } }
  function schedule(delay) {
    clearSchedule();
    if (!running) return;
    timer = setTimer(() => { timer = null; return checkNow(); }, delay);
  }
  function alignSource() {
    const source = currentSource(), id = typeof source.id === 'string' && source.id ? source.id : null;
    if (id !== sourceId) {
      generation++; clearSchedule(); flight?.controller.abort(); flight = null; failures = 0; sourceId = id;
      emit({ phase: 'checking', checking: false, syncing: false, sourceId: id, source: { ...source },
        revision: null, pendingRevision: null, status: null, sync: null, freshness: 'unknown',
        lastChecked: null, lastSuccessfulCheck: null, error: null, errorStage: null,
        nextRetryMs: null, nextCheckAt: null, retryCount: 0 });
    }
    return id;
  }
  function isCurrent(request) {
    return running && flight === request && generation === request.generation && currentSource().id === request.sourceId && !request.controller.signal.aborted;
  }
  function checked(change) {
    failures = 0;
    emit({ ...change, checking: false, syncing: false, error: null, errorStage: null, retryCount: 0,
      nextRetryMs: interval, nextCheckAt: now() + interval });
  }
  function checkNow() {
    if (!running) return Promise.resolve({ ...state });
    const expectedSource = alignSource();
    if (flight) return flight.promise;
    clearSchedule();
    if (!expectedSource) {
      emit({ phase: 'offline', checking: false, error: '尚未选择数据来源', errorStage: 'source', nextRetryMs: interval, nextCheckAt: now() + interval });
      schedule(interval); return Promise.resolve({ ...state });
    }
    const request = { sourceId: expectedSource, generation, controller: new AbortController(), promise: null };
    flight = request;
    request.promise = (async () => {
      let delay = interval, stage = 'status';
      emit({ phase: 'checking', checking: true, syncing: false, nextRetryMs: null, nextCheckAt: null });
      try {
        const status = await fetchStatus(expectedSource, { signal: request.controller.signal });
        if (!isCurrent(request)) return { ...state };
        if (!status || status.ok === false) throw new Error(typeof status?.error === 'string' ? status.error : '同步状态读取失败');
        if (status.source?.id && status.source.id !== expectedSource) throw new Error('同步状态来源不一致，已忽略该响应');
        const revision = status.revision;
        if (typeof revision !== 'string' || !revision) throw new Error('同步状态缺少有效的数据版本');
        const pendingRevision = getRevision() === revision ? null : revision;
        emit({ status, source: status.source || { ...currentSource() }, sync: status.sync || null,
          freshness: status.quality?.freshness ?? status.freshness ?? status.sync?.freshness ?? 'unknown',
          revision, pendingRevision, lastChecked: now(), lastSuccessfulCheck: now() });
        if (!pendingRevision) {
          checked({ phase: 'current', pendingRevision: null }); return { ...state };
        }
        emit({ phase: 'pending', checking: false });
        if (isBusy()) {
          checked({ phase: 'pending', pendingRevision }); return { ...state };
        }
        if (!isCurrent(request)) return { ...state };
        stage = 'refresh'; emit({ phase: 'pending', syncing: true });
        await refresh({ automatic: true, expectedSource, revision });
        if (!isCurrent(request)) return { ...state };
        if (getRevision() !== revision && isBusy()) {
          checked({ phase: 'pending', pendingRevision: revision }); return { ...state };
        }
        if (getRevision() !== revision) throw new Error('新数据尚未应用，保留更新提示并稍后重试');
        checked({ phase: 'current', pendingRevision: null });
        return { ...state };
      } catch (error) {
        if (!isCurrent(request)) return { ...state };
        failures++; delay = Math.min(maximumRetry, interval * 2 ** Math.min(failures - 1, 3));
        emit({ phase: 'offline', checking: false, syncing: false, lastChecked: now(),
          error: error?.message || String(error), errorStage: stage, retryCount: failures,
          nextRetryMs: delay, nextCheckAt: now() + delay });
        return { ...state };
      } finally {
        if (flight === request) {
          flight = null;
          if (running) {
            if (currentSource().id !== sourceId) { alignSource(); schedule(0); }
            else schedule(delay);
          }
        }
      }
    })();
    return request.promise;
  }
  function start() {
    if (running) return checkNow();
    running = true; return checkNow();
  }
  function stop() {
    running = false; generation++; clearSchedule(); flight?.controller.abort(); flight = null;
    return emit({ checking: false, syncing: false, nextRetryMs: null, nextCheckAt: null });
  }
  function wake() { return running ? checkNow() : Promise.resolve({ ...state }); }
  function markApplied() {
    alignSource();
    if (state.pendingRevision && getRevision() === state.pendingRevision) {
      checked({ phase: 'current', pendingRevision: null });
      if (running && !flight) schedule(interval);
    } else if (running && !flight && timer === null) {
      // A manual source reload may be the first signal of a source change; keep polling that new scope.
      schedule(0);
    }
    return { ...state };
  }
  return { start, stop, checkNow, wake, markApplied };
}