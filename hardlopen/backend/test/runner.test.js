const test = require('node:test');
const assert = require('node:assert/strict');
const Runner = require('../../frontend/js/runner');

const steps = [
  { kind: 'ready', label: 'Klaar', duration: 5 },
  { kind: 'run', label: 'Hardlopen', duration: 60 },
  { kind: 'walk', label: 'Wandelen', duration: 30 },
];

function at(t0, sec) {
  return t0 + sec * 1000;
}

test('positie volgt de wandklok, ook na een lange stilte', () => {
  const t0 = 1_000_000;
  const s = { ...Runner.create({ steps, name: 'x' }), runningSince: t0, startedAt: t0 };
  assert.equal(Runner.position(s, at(t0, 2)).index, 0);
  const p = Runner.position(s, at(t0, 40));
  assert.equal(p.index, 1);
  assert.equal(p.stepRemainingMs, 25_000);
  assert.equal(Runner.position(s, at(t0, 70)).index, 2);
  assert.equal(Runner.position(s, at(t0, 500)).index, 3); // klaar
});

test('pauzeren bevriest de tijd, hervatten loopt verder', () => {
  const t0 = 1_000_000;
  let s = { ...Runner.create({ steps, name: 'x' }), runningSince: t0 };
  s = Runner.pause(s, at(t0, 10));
  assert.equal(Runner.elapsedMs(s, at(t0, 100)), 10_000);
  assert.equal(Runner.isRunning(s), false);
  s = Runner.resume(s, at(t0, 100));
  assert.equal(Runner.elapsedMs(s, at(t0, 105)), 15_000);
});

test('overslaan en terug', () => {
  const t0 = 1_000_000;
  let s = { ...Runner.create({ steps, name: 'x' }), runningSince: t0 };
  s = Runner.skip(s, at(t0, 20)); // in stap 1 -> begin stap 2
  assert.equal(Runner.position(s, at(t0, 20)).index, 2);
  s = Runner.previous(s, at(t0, 21)); // binnen 3 s -> vorige stap
  assert.equal(Runner.position(s, at(t0, 21)).index, 1);
  assert.equal(Runner.position(s, at(t0, 21)).stepElapsedMs, 0);
  s = Runner.previous(s, at(t0, 31)); // na 10 s -> begin huidige stap
  const p = Runner.position(s, at(t0, 31));
  assert.equal(p.index, 1);
  assert.equal(p.stepElapsedMs, 0);
});

test('signalen: aftellen, go per wissel, halverwege en klaar', () => {
  const t0 = 1_000_000;
  const s = { ...Runner.create({ steps, name: 'x' }), runningSince: t0 };
  const cues = Runner.cues(s, t0);
  const of = (type) => cues.filter((c) => c.type === type).map((c) => (c.at - t0) / 1000);
  assert.deepEqual(of('go'), [5, 65]);
  assert.deepEqual(of('tick'), [62, 63, 64, 92, 93, 94]); // 'ready' (5 s) telt niet af
  assert.deepEqual(of('half'), [35]);
  assert.deepEqual(of('done'), [95]);
  // Later in de training: alleen wat nog komt.
  assert.deepEqual(Runner.cues(s, at(t0, 70)).map((c) => c.type), ['tick', 'tick', 'tick', 'done']);
  // Gepauzeerd: niets inplannen.
  assert.deepEqual(Runner.cues(Runner.pause(s, at(t0, 10)), at(t0, 10)), []);
});
