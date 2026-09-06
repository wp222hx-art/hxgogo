type Options = {
  sources: string[]; run: (source: string) => Promise<unknown>;
  sweep?: (source: string) => Promise<unknown>; sweepSources?: string[]; sweepEveryMs?: number;
  now?: () => number; onError?: (error: unknown, source: string, kind: string) => void;
}
/** Each source advances independently. Historical repair has its own single bounded lane. */
export function createSourceScheduler(options: Options) {
  const now = options.now || Date.now, jobs = new Map<string, Promise<unknown>>(), sweeps = new Map<string, number>();
  let sweepJob: Promise<unknown> | null = null, stopped = false;
  function tick() {
    if (stopped) return;
    for (const source of options.sources) {
      if (jobs.has(source)) continue;
      const job = Promise.resolve().then(() => options.run(source))
        .catch(error => options.onError?.(error, source, 'sync'))
        .finally(() => { if (jobs.get(source) === job) jobs.delete(source) });
      jobs.set(source, job);
    }
    if (options.sweep && !sweepJob) {
      const source = (options.sweepSources || options.sources)
        .filter(s => !sweeps.has(s) || now() - sweeps.get(s)! >= (options.sweepEveryMs || 300_000))
        .sort((a, b) => (sweeps.get(a) ?? -Infinity) - (sweeps.get(b) ?? -Infinity))[0];
      if (source) {
        sweeps.set(source, now());
        sweepJob = Promise.resolve().then(() => options.sweep!(source))
          .catch(error => options.onError?.(error, source, 'repair'))
          .finally(() => { sweepJob = null });
      }
    }
  }
  async function stop() { stopped = true; await Promise.allSettled([...jobs.values(), ...(sweepJob ? [sweepJob] : [])]); }
  return { tick, stop, get pending() { return jobs.size + Number(!!sweepJob) } };
}
