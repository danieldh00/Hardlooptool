const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../../frontend/js/workout');

const sample = {
  name: '  Intervallen  ',
  items: [
    { type: 'step', kind: 'warmup', duration: 300 },
    { type: 'repeat', times: 3, steps: [{ type: 'step', kind: 'run', duration: 60 }, { type: 'step', kind: 'walk', duration: 90, label: 'Herstel' }] },
    { type: 'step', kind: 'cooldown', duration: 300 },
  ],
};

test('flatten zet herhaalblokken uit met rondenummers', () => {
  const steps = W.flatten(W.sanitizeTraining(sample));
  assert.equal(steps.length, 8);
  assert.deepEqual(steps[1], { kind: 'run', label: 'Hardlopen', duration: 60, rep: 1, reps: 3 });
  assert.equal(steps[2].label, 'Herstel');
  assert.equal(steps[6].rep, 3);
  assert.equal(steps[7].rep, undefined);
});

test('totalDuration en durationByKind', () => {
  const t = W.sanitizeTraining(sample);
  assert.equal(W.totalDuration(t), 300 + 3 * 150 + 300);
  assert.deepEqual(W.durationByKind(t), { warmup: 300, run: 180, walk: 270, cooldown: 300 });
});

test('sanitizeTraining trimt en weigert ongeldige invoer', () => {
  assert.equal(W.sanitizeTraining(sample).name, 'Intervallen');
  assert.throws(() => W.sanitizeTraining({ ...sample, name: ' ' }), /naam/);
  assert.throws(() => W.sanitizeTraining({ ...sample, items: [] }), /minstens/);
  assert.throws(() => W.sanitizeTraining({ name: 'x', items: [{ kind: 'vliegen', duration: 60 }] }), /Onbekend/);
  assert.throws(() => W.sanitizeTraining({ name: 'x', items: [{ kind: 'run', duration: 2 }] }), /minimaal/);
  assert.throws(() => W.sanitizeTraining({ name: 'x', items: [{ type: 'repeat', times: 0, steps: [{ kind: 'run', duration: 60 }] }] }), /Herhalen/);
  assert.throws(() => W.sanitizeTraining({ name: 'x', items: [{ type: 'repeat', times: 99, steps: [{ kind: 'run', duration: 4 * 3600 }] }] }), /maximaal/);
});

test('geneste herhaalblokken worden niet doorgelaten', () => {
  const nested = { name: 'x', items: [{ type: 'repeat', times: 2, steps: [{ type: 'repeat', times: 2, steps: [] }] }] };
  assert.throws(() => W.sanitizeTraining(nested), /Onbekend/);
});

test('alle voorbeeldschema\'s zijn geldig', () => {
  for (const preset of W.PRESETS) assert.doesNotThrow(() => W.sanitizeTraining(preset), preset.name);
});

test('tijdnotatie', () => {
  assert.equal(W.formatDuration(75), '1:15');
  assert.equal(W.formatDuration(3725), '1:02:05');
  assert.equal(W.formatSpoken(90), '1 minuut en 30 seconden');
  assert.equal(W.formatSpoken(120), '2 minuten');
  assert.equal(W.formatSpoken(3661), '1 uur, 1 minuut en 1 seconde');
  assert.equal(W.parseDuration('2:30'), 150);
  assert.equal(W.parseDuration('1:02:00'), 3720);
  assert.ok(Number.isNaN(W.parseDuration('2m')));
});

test('schema "Van 0 naar 5 km": 20 geldige trainingen met unieke ids', () => {
  const program = W.PROGRAMS.find((p) => p.id === 'c25k');
  assert.equal(program.trainings.length, 20);
  const ids = program.trainings.map((t) => t.presetId);
  assert.equal(new Set(ids).size, 20);
  for (const t of program.trainings) {
    assert.doesNotThrow(() => W.sanitizeTraining(t), t.name);
    // presetId moet als trainingId in de geschiedenis door de servervalidatie komen
    assert.match(`preset-${t.presetId}`, /^[A-Za-z0-9_-]{6,64}$/);
    assert.equal(W.findPreset(t.presetId), t);
  }
  // Week 1, training 1: 5 min wandelen, 8 × (1 min lopen + 2 min wandelen), 5 min wandelen
  const w1 = W.flatten(program.trainings[0]);
  assert.equal(w1.length, 18);
  assert.equal(W.totalDuration(program.trainings[0]), 300 + 8 * 180 + 300);
  // Week 5, training 2: 12 min lopen / 2 min wandelen × 3
  assert.equal(W.durationByKind(program.trainings[9]).run, 36 * 60);
});
