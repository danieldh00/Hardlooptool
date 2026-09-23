// Loop-engine: houdt bij waar je in de training bent, puur op basis van de
// wandklok (Date.now). Timers mogen dus haperen of een tijd helemaal
// stilliggen (scherm uit): zodra de pagina weer een tik krijgt, klopt de
// positie meteen weer. De toestand staat in localStorage, zodat ook een door
// de telefoon afgesloten tabblad de training gewoon laat doorlopen.
const Runner = (() => {
  // steps: platte lijst uit Workout.flatten() (plus eventueel een
  // 'ready'-stap vooraan). state = { steps, trainingId, name, accumulatedMs,
  // runningSince (epoch-ms of null), startedAt, finished }.
  function create({ steps, trainingId, name }) {
    return {
      steps,
      trainingId,
      name,
      accumulatedMs: 0,
      runningSince: Date.now(),
      startedAt: Date.now(),
      finished: false,
    };
  }

  function totalMs(state) {
    return state.steps.reduce((sum, s) => sum + s.duration * 1000, 0);
  }

  function elapsedMs(state, now = Date.now()) {
    const running = state.runningSince != null ? now - state.runningSince : 0;
    return Math.min(totalMs(state), state.accumulatedMs + Math.max(0, running));
  }

  // Waar staan we? index === steps.length betekent: klaar.
  function position(state, now = Date.now()) {
    const elapsed = elapsedMs(state, now);
    let start = 0;
    for (let i = 0; i < state.steps.length; i++) {
      const dur = state.steps[i].duration * 1000;
      if (elapsed < start + dur) {
        return { index: i, step: state.steps[i], stepStartMs: start, stepElapsedMs: elapsed - start, stepRemainingMs: start + dur - elapsed, elapsedMs: elapsed };
      }
      start += dur;
    }
    return { index: state.steps.length, step: null, stepStartMs: start, stepElapsedMs: 0, stepRemainingMs: 0, elapsedMs: elapsed };
  }

  function isRunning(state) {
    return state.runningSince != null && !state.finished;
  }

  function pause(state, now = Date.now()) {
    if (state.runningSince == null) return state;
    return { ...state, accumulatedMs: elapsedMs(state, now), runningSince: null };
  }

  function resume(state, now = Date.now()) {
    if (state.runningSince != null || state.finished) return state;
    return { ...state, runningSince: now };
  }

  function seekTo(state, ms, now = Date.now()) {
    const clamped = Math.max(0, Math.min(totalMs(state), ms));
    return { ...state, accumulatedMs: clamped, runningSince: state.runningSince != null ? now : null };
  }

  function skip(state, now = Date.now()) {
    const pos = position(state, now);
    if (pos.index >= state.steps.length) return state;
    return seekTo(state, pos.stepStartMs + pos.step.duration * 1000, now);
  }

  // Binnen de eerste 3 seconden van een stap naar de vorige stap, anders
  // terug naar het begin van de huidige (zoals bij een muziekspeler).
  function previous(state, now = Date.now()) {
    const pos = position(state, now);
    if (pos.index > 0 && pos.stepElapsedMs < 3000) {
      return seekTo(state, pos.stepStartMs - state.steps[pos.index - 1].duration * 1000, now);
    }
    return seekTo(state, pos.stepStartMs, now);
  }

  // Signalen voor alles wat nog komt, als absolute tijdstippen. Alleen
  // zinvol terwijl de training loopt.
  function cues(state, now = Date.now()) {
    if (!isRunning(state)) return [];
    const base = now - elapsedMs(state, now); // epoch-ms van "tijd 0"
    const out = [];
    let start = 0;
    state.steps.forEach((step, i) => {
      const dur = step.duration * 1000;
      const end = start + dur;
      if (i > 0) out.push({ at: base + start, type: 'go' });
      // Aftellen in de laatste drie seconden, alleen als de stap lang genoeg
      // is om er geen piepconcert van te maken.
      if (step.duration >= 10) for (const s of [3, 2, 1]) out.push({ at: base + end - s * 1000, type: 'tick' });
      if (step.duration >= 60 && step.kind !== 'ready') out.push({ at: base + start + dur / 2, type: 'half' });
      start = end;
    });
    out.push({ at: base + start, type: 'done' });
    return out.filter((c) => c.at >= now - 50);
  }

  return { create, totalMs, elapsedMs, position, isRunning, pause, resume, skip, previous, cues };
})();

if (typeof module === 'object' && module.exports) module.exports = Runner;
