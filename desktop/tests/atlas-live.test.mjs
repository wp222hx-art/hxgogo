import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtlasLive } from '../../public/static/atlas-live.js';

class FakeClock {
  time = 0; sequence = 0; timers = new Map();
  now = () => this.time;
  setTimer = (fn, delay) => { const id = ++this.sequence; this.timers.set(id, { fn, at: this.time + delay }); return id; };
  clearTimer = id => this.timers.delete(id);
  async advance(ms) {
    const target = this.time + ms;
    while (true) {
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      const [id, task] = next; this.time = task.at; this.timers.delete(id); await task.fn();
    }
    this.time = target;
  }
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness() {
  const clock = new FakeClock(), states = [], reads = [], refreshes = [];
  const h = { clock, states, reads, refreshes, source: { id: 'local:digits3', kind: 'local' }, revision: 'local:digits3:1', remoteRevision: 'local:digits3:1', busy: false };
  h.fetch = async () => ({ ok: true, source: h.source, revision: h.remoteRevision, quality: { freshness: 'fresh' }, sync: { supported: false, lastSuccessAt: 123 } });
  h.refresh = async options => { h.revision = options.revision; };
  h.live = createAtlasLive({ getSource: () => h.source, getRevision: () => h.revision,
    fetchStatus: (sourceId, options) => { reads.push({ sourceId, ...options }); return h.fetch(sourceId, options); },
    refresh: async options => { refreshes.push(options); await h.refresh(options); },
    isBusy: () => h.busy, onState: state => states.push(state), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  h.state = () => states.at(-1);
  return h;
}

test('unchanged revision polls status every five seconds without reloading data', async () => {
  const h = harness(); await h.live.start();
  assert.equal(h.reads.length, 1); assert.equal(h.refreshes.length, 0); assert.equal(h.state().phase, 'current');
  assert.equal(h.state().source.id, h.source.id); assert.equal(h.state().sync.lastSuccessAt, 123); assert.equal(h.state().freshness, 'fresh');
  await h.clock.advance(4999); assert.equal(h.reads.length, 1);
  await h.clock.advance(1); assert.equal(h.reads.length, 2); assert.equal(h.state().lastChecked, 5000);
  await h.clock.advance(10000); assert.equal(h.reads.length, 4); assert.equal(h.refreshes.length, 0); h.live.stop();
});

test('changed revision reloads once and reports current only after the host applies it', async () => {
  const h = harness(); h.remoteRevision = 'local:digits3:2';
  await h.live.start();
  assert.deepEqual(h.refreshes, [{ automatic: true, expectedSource: 'local:digits3', revision: 'local:digits3:2' }]);
  assert.equal(h.revision, h.remoteRevision); assert.equal(h.state().phase, 'current'); assert.equal(h.state().pendingRevision, null);
  assert.ok(h.states.some(s => s.phase === 'pending' && s.syncing));
  await h.clock.advance(5000); assert.equal(h.refreshes.length, 1); h.live.stop();
});

test('busy editing keeps the latest revision pending until a safe wake', async () => {
  const h = harness(); h.busy = true; h.remoteRevision = 'local:digits3:2'; await h.live.start();
  assert.equal(h.refreshes.length, 0); assert.equal(h.state().phase, 'pending'); assert.equal(h.state().pending, true);
  h.remoteRevision = 'local:digits3:3'; await h.clock.advance(5000);
  assert.equal(h.state().pendingRevision, 'local:digits3:3'); assert.equal(h.refreshes.length, 0);
  h.busy = false; await h.live.wake();
  assert.equal(h.refreshes.length, 1); assert.equal(h.refreshes[0].revision, 'local:digits3:3'); assert.equal(h.state().phase, 'current'); h.live.stop();
});

test('overlapping wake, checkNow and start share the in-flight status request', async () => {
  const h = harness(), wait = deferred(); h.fetch = () => wait.promise;
  const first = h.live.start(), second = h.live.checkNow(), third = h.live.wake(), fourth = h.live.start();
  assert.equal(h.reads.length, 1); assert.equal(first, second); assert.equal(first, third); assert.equal(first, fourth);
  assert.equal(h.clock.timers.size, 0);
  wait.resolve({ revision: h.revision }); await Promise.all([first, second, third, fourth]);
  assert.equal(h.clock.timers.size, 1); h.live.stop();
});

test('source changes abort stale status requests and never apply their data', async () => {
  const h = harness(), old = deferred(); h.fetch = sourceId => sourceId === 'local:digits3' ? old.promise : Promise.resolve({ source: h.source, revision: 'local:eleven5:7' });
  const first = h.live.start();
  h.source = { id: 'local:eleven5', kind: 'local' }; h.revision = 'local:eleven5:6'; await h.live.wake();
  assert.equal(h.reads[0].signal.aborted, true); assert.equal(h.refreshes.length, 1); assert.equal(h.refreshes[0].expectedSource, 'local:eleven5');
  old.resolve({ source: { id: 'local:digits3' }, revision: 'local:digits3:99' }); await first;
  assert.equal(h.state().sourceId, 'local:eleven5'); assert.equal(h.state().revision, 'local:eleven5:7'); assert.equal(h.state().phase, 'current'); assert.equal(h.clock.timers.size, 1); h.live.stop();
});

test('a source switch during refresh cannot mark the old source as synchronized', async () => {
  const h = harness(), loading = deferred(); h.remoteRevision = 'local:digits3:2'; h.refresh = () => loading.promise;
  const first = h.live.start(); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.refreshes.length, 1);
  h.source = { id: 'local:eleven5', kind: 'local' }; h.revision = 'local:eleven5:1'; h.remoteRevision = h.revision;
  await h.live.wake(); const statesAfterSwitch = h.states.length;
  loading.resolve(); await first;
  assert.equal(h.states.slice(statesAfterSwitch).some(s => s.sourceId === 'local:digits3'), false);
  assert.equal(h.state().sourceId, 'local:eleven5'); assert.equal(h.state().phase, 'current'); h.live.stop();
});

test('status failures back off by 5, 10, 20, then 30 seconds; wake checks immediately on recovery', async () => {
  const h = harness(); h.fetch = async () => { throw Error('offline fixture'); }; await h.live.start();
  assert.equal(h.state().phase, 'offline'); assert.equal(h.state().nextRetryMs, 5000);
  await h.clock.advance(5000); assert.equal(h.state().nextRetryMs, 10000);
  await h.clock.advance(10000); assert.equal(h.state().nextRetryMs, 20000);
  await h.clock.advance(20000); assert.equal(h.state().nextRetryMs, 30000);
  await h.clock.advance(30000); assert.equal(h.state().nextRetryMs, 30000); assert.equal(h.state().retryCount, 5);
  h.fetch = async () => ({ revision: h.revision }); const previousReads = h.reads.length; await h.live.wake();
  assert.equal(h.reads.length, previousReads + 1); assert.equal(h.state().phase, 'current'); assert.equal(h.state().error, null); assert.equal(h.state().retryCount, 0); assert.equal(h.state().nextRetryMs, 5000); h.live.stop();
});

test('failed refresh retains pending version and retries without claiming success', async () => {
  const h = harness(); h.remoteRevision = 'local:digits3:2'; h.refresh = async () => { throw Error('load failed fixture'); }; await h.live.start();
  assert.equal(h.state().phase, 'offline'); assert.equal(h.state().errorStage, 'refresh'); assert.equal(h.state().pendingRevision, h.remoteRevision); assert.equal(h.revision, 'local:digits3:1');
  await h.clock.advance(5000); assert.equal(h.refreshes.length, 2); assert.equal(h.state().nextRetryMs, 10000);
  h.refresh = async options => { h.revision = options.revision; }; await h.live.wake();
  assert.equal(h.state().phase, 'current'); assert.equal(h.state().pending, false); h.live.stop();
});

test('a fulfilled refresh that did not update the applied revision is not a success', async () => {
  const h = harness(); h.remoteRevision = 'local:digits3:2'; h.refresh = async () => {}; await h.live.start();
  assert.equal(h.state().phase, 'offline'); assert.equal(h.state().pendingRevision, 'local:digits3:2'); assert.match(h.state().error, /尚未应用/); h.live.stop();
});

test('manual apply clears a pending revision only when getRevision confirms it', async () => {
  const h = harness(); h.busy = true; h.remoteRevision = 'local:digits3:2'; await h.live.start();
  h.live.markApplied(); assert.equal(h.state().phase, 'pending');
  h.revision = h.remoteRevision; h.live.markApplied();
  assert.equal(h.state().phase, 'current'); assert.equal(h.state().pending, false); assert.equal(h.refreshes.length, 0); assert.equal(h.reads.length, 1); h.live.stop();
});

test('stop cancels the request and timer; a late response and wake cannot restart it', async () => {
  const h = harness(), wait = deferred(); h.fetch = () => wait.promise; const pending = h.live.start();
  h.live.stop(); assert.equal(h.reads[0].signal.aborted, true); assert.equal(h.clock.timers.size, 0);
  wait.resolve({ revision: 'local:digits3:99' }); await pending; await h.live.wake(); await h.live.checkNow(); await h.clock.advance(100000);
  assert.equal(h.reads.length, 1); assert.equal(h.refreshes.length, 0); assert.equal(h.state().running, false);
});

test('invalid or mismatched status responses never refresh or claim current', async () => {
  for (const response of [{}, { revision: 'other:9', source: { id: 'other' } }, { ok: false, error: 'rejected fixture' }]) {
    const h = harness(); h.fetch = async () => response; await h.live.start();
    assert.equal(h.state().phase, 'offline'); assert.equal(h.refreshes.length, 0); h.live.stop();
  }
});
test('manual apply after a source switch preserves polling in the new scope', async () => {
  const h = harness(); await h.live.start();
  h.source = { id: 'local:eleven5', kind: 'local' }; h.revision = 'local:eleven5:4'; h.remoteRevision = h.revision;
  h.live.markApplied(); assert.equal(h.clock.timers.size, 1);
  await h.clock.advance(0); assert.equal(h.reads.at(-1).sourceId, 'local:eleven5'); assert.equal(h.state().phase, 'current');
  await h.clock.advance(5000); assert.equal(h.reads.at(-1).sourceId, 'local:eleven5'); assert.equal(h.clock.timers.size, 1); h.live.stop();
});

test('a source change discovered after a request automatically schedules its own check', async () => {
  const h = harness(), pending = deferred(); h.fetch = () => pending.promise;
  const first = h.live.start(); h.source = { id: 'local:eleven5', kind: 'local' }; h.revision = 'local:eleven5:1';
  h.fetch = async () => ({ source: h.source, revision: h.revision });
  pending.resolve({ source: { id: 'local:digits3' }, revision: 'local:digits3:2' }); await first;
  await h.clock.advance(0); assert.equal(h.reads.length, 2); assert.equal(h.state().sourceId, 'local:eleven5'); assert.equal(h.state().phase, 'current'); assert.equal(h.refreshes.length, 0); h.live.stop();
});
test('editing that begins during snapshot loading keeps the unapplied revision pending without an offline error', async () => {
  const h = harness(), loading = deferred(); h.remoteRevision = 'local:digits3:2'; h.refresh = () => loading.promise;
  const pending = h.live.start(); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.refreshes.length, 1); h.busy = true; loading.resolve(); await pending;
  assert.equal(h.state().phase, 'pending'); assert.equal(h.state().pendingRevision, h.remoteRevision); assert.equal(h.state().error, null); assert.equal(h.state().retryCount, 0);
  h.busy = false; h.refresh = async options => { h.revision = options.revision; }; await h.live.wake();
  assert.equal(h.state().phase, 'current'); assert.equal(h.refreshes.length, 2); h.live.stop();
});