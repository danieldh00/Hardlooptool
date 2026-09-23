// Trainingsmodel: gedeeld tussen de browser (als gewoon <script>, zet
// `window.Workout`) en de backend (`require()` vanuit backend/src/store.js).
// Geen afhankelijkheden, geen DOM -- alleen pure functies, zodat de server
// exact dezelfde validatie doet als de editor en de tests beide kanten dekken.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Workout = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Volgorde = volgorde in de keuzelijst van de editor.
  const KINDS = {
    warmup: { label: 'Warming-up', color: '#f59e0b' },
    run: { label: 'Hardlopen', color: '#16a34a' },
    fast: { label: 'Snel', color: '#dc2626' },
    easy: { label: 'Rustig dribbelen', color: '#0d9488' },
    walk: { label: 'Wandelen', color: '#2563eb' },
    rest: { label: 'Rust', color: '#64748b' },
    cooldown: { label: 'Cooling-down', color: '#7c3aed' },
  };

  const LIMITS = {
    nameLength: 80,
    labelLength: 40,
    notesLength: 1000,
    maxItems: 50, // stappen + blokken op het hoogste niveau
    maxInnerSteps: 20, // stappen binnen één herhaalblok
    maxRepeat: 99,
    minStep: 5, // seconden
    maxStep: 4 * 3600,
    maxTotal: 8 * 3600,
  };

  function invalid(message) {
    const err = new Error(message);
    err.status = 400;
    err.code = 'invalid_training';
    return err;
  }

  function cleanText(value, max) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function cleanStep(step) {
    if (!step || typeof step !== 'object') throw invalid('Ongeldige stap');
    const kind = Object.prototype.hasOwnProperty.call(KINDS, step.kind) ? step.kind : null;
    if (!kind) throw invalid(`Onbekend soort stap: ${step.kind}`);
    const duration = Math.round(Number(step.duration));
    if (!Number.isFinite(duration) || duration < LIMITS.minStep || duration > LIMITS.maxStep) {
      throw invalid(`Een stap duurt minimaal ${LIMITS.minStep} seconden en maximaal ${LIMITS.maxStep / 3600} uur`);
    }
    const out = { type: 'step', kind, duration };
    const label = cleanText(step.label, LIMITS.labelLength);
    if (label) out.label = label;
    return out;
  }

  function cleanItem(item) {
    if (item && item.type === 'repeat') {
      const times = Math.round(Number(item.times));
      if (!Number.isFinite(times) || times < 1 || times > LIMITS.maxRepeat) {
        throw invalid(`Herhalen kan 1 tot ${LIMITS.maxRepeat} keer`);
      }
      if (!Array.isArray(item.steps) || item.steps.length === 0) throw invalid('Een herhaalblok heeft minstens één stap nodig');
      if (item.steps.length > LIMITS.maxInnerSteps) throw invalid(`Maximaal ${LIMITS.maxInnerSteps} stappen per herhaalblok`);
      // Bewust één niveau diep: blokken in blokken maken de editor en het
      // loopscherm onleesbaar en komen in schema's nauwelijks voor.
      return { type: 'repeat', times, steps: item.steps.map(cleanStep) };
    }
    return cleanStep(item);
  }

  // Maakt van willekeurige (client-)invoer een geldige training of gooit een
  // Error met status 400. Laat id/updatedAt/deleted ongemoeid: dat is de
  // taak van de opslaglaag.
  function sanitizeTraining(input) {
    if (!input || typeof input !== 'object') throw invalid('Ongeldige training');
    const name = cleanText(input.name, LIMITS.nameLength);
    if (!name) throw invalid('Geef de training een naam');
    if (!Array.isArray(input.items) || input.items.length === 0) throw invalid('Een training heeft minstens één stap nodig');
    if (input.items.length > LIMITS.maxItems) throw invalid(`Maximaal ${LIMITS.maxItems} onderdelen per training`);
    const items = input.items.map(cleanItem);
    const training = { name, items };
    const notes = String(input.notes == null ? '' : input.notes).trim().slice(0, LIMITS.notesLength);
    if (notes) training.notes = notes;
    if (totalDuration(training) > LIMITS.maxTotal) throw invalid(`Een training duurt maximaal ${LIMITS.maxTotal / 3600} uur`);
    return training;
  }

  function stepLabel(step) {
    return step.label || KINDS[step.kind].label;
  }

  // De platte lijst die het loopscherm afspeelt. `rep`/`reps` zijn alleen
  // gezet voor stappen uit een herhaalblok ("ronde 3 van 8").
  function flatten(training) {
    const out = [];
    for (const item of training.items) {
      if (item.type === 'repeat') {
        for (let rep = 1; rep <= item.times; rep++) {
          for (const step of item.steps) {
            out.push({ kind: step.kind, label: stepLabel(step), duration: step.duration, rep, reps: item.times });
          }
        }
      } else {
        out.push({ kind: item.kind, label: stepLabel(item), duration: item.duration });
      }
    }
    return out;
  }

  function totalDuration(training) {
    let total = 0;
    for (const item of training.items) {
      if (item.type === 'repeat') total += item.times * item.steps.reduce((sum, s) => sum + s.duration, 0);
      else total += item.duration;
    }
    return total;
  }

  // Tijd per soort, voor het overzicht ("20:00 hardlopen, 12:00 wandelen").
  function durationByKind(training) {
    const totals = {};
    for (const step of flatten(training)) totals[step.kind] = (totals[step.kind] || 0) + step.duration;
    return totals;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  // 75 -> "1:15", 3725 -> "1:02:05"
  function formatDuration(sec) {
    const s = Math.max(0, Math.round(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rest = s % 60;
    return h ? `${h}:${pad(m)}:${pad(rest)}` : `${m}:${pad(rest)}`;
  }

  // Voor de spraakaankondiging: 90 -> "1 minuut en 30 seconden".
  function formatSpoken(sec) {
    const s = Math.max(0, Math.round(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rest = s % 60;
    const parts = [];
    if (h) parts.push(`${h} uur`);
    if (m) parts.push(m === 1 ? '1 minuut' : `${m} minuten`);
    if (rest) parts.push(rest === 1 ? '1 seconde' : `${rest} seconden`);
    if (parts.length === 0) return '0 seconden';
    return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} en ${parts[parts.length - 1]}`;
  }

  // "2:30" -> 150, "90" -> 90 (seconden), "1:02:00" -> 3720. NaN bij onzin.
  function parseDuration(text) {
    const parts = String(text).trim().split(':');
    if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return NaN;
    return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
  }

  const min = (m) => m * 60;
  const step = (kind, duration, label) => (label ? { type: 'step', kind, duration, label } : { type: 'step', kind, duration });
  const repeat = (times, steps) => ({ type: 'repeat', times, steps });

  // Voorbeeldschema's: in de app te kopiëren naar een eigen, bewerkbare training.
  const PRESETS = [
    {
      presetId: 'start-to-run-1',
      name: 'Start to Run – week 1',
      notes: 'Opbouwschema voor beginners: afwisselend 1 minuut hardlopen en 1,5 minuut wandelen.',
      items: [step('warmup', min(5), 'Stevig wandelen'), repeat(8, [step('run', min(1)), step('walk', 90)]), step('cooldown', min(5), 'Uitwandelen')],
    },
    {
      presetId: 'start-to-run-4',
      name: 'Start to Run – week 4',
      notes: 'Langere loopblokken: 3 minuten hardlopen, 1,5 minuut wandelen.',
      items: [step('warmup', min(5), 'Stevig wandelen'), repeat(5, [step('run', min(3)), step('walk', 90)]), step('cooldown', min(5), 'Uitwandelen')],
    },
    {
      presetId: 'intervals-400',
      name: 'Intervallen 6 × 2 minuten',
      notes: 'Snelheidstraining: 2 minuten op 5 km-tempo of iets sneller, rustig herstellen.',
      items: [step('warmup', min(10), 'Inlopen'), repeat(6, [step('fast', min(2)), step('easy', 90, 'Herstel')]), step('cooldown', min(10), 'Uitlopen')],
    },
    {
      presetId: 'pyramid',
      name: 'Piramide 1-2-3-2-1',
      items: [
        step('warmup', min(10), 'Inlopen'),
        step('fast', min(1)), step('easy', min(1), 'Herstel'),
        step('fast', min(2)), step('easy', min(1), 'Herstel'),
        step('fast', min(3)), step('easy', min(2), 'Herstel'),
        step('fast', min(2)), step('easy', min(1), 'Herstel'),
        step('fast', min(1)),
        step('cooldown', min(10), 'Uitlopen'),
      ],
    },
    {
      presetId: 'tempo',
      name: 'Tempoloop 20 minuten',
      notes: 'Tempo: comfortabel zwaar, je kunt nog korte zinnen zeggen.',
      items: [step('warmup', min(10), 'Rustig inlopen'), step('run', min(20), 'Tempo'), step('cooldown', min(10), 'Rustig uitlopen')],
    },
  ];

  // Opbouwschema "Van 0 naar 5 km": 10 weken, 2 trainingen per week. Elke
  // training begint met 5 minuten stevig wandelen en eindigt met 5 minuten
  // rustig uitwandelen.
  const C25K_WEEKS = [
    // [lopen (s), wandelen (s), herhalingen] of [doorlopend lopen (s)]
    [[60, 120, 8], [90, 120, 7]],
    [[120, 120, 7], [180, 120, 6]],
    [[240, 120, 5], [300, 120, 4]],
    [[360, 120, 4], [480, 120, 3]],
    [[600, 120, 3], [720, 120, 3]],
    [[min(15)], [min(20)]],
    [[min(20)], [min(25)]],
    [[min(25)], [min(30)]],
    [[min(30)], [min(35)]],
    [[min(25), 'Heel rustig lopen'], 'finale'],
  ];

  const minText = (sec) => `${String(sec / 60).replace('.', ',')} min`;

  function c25kTraining(week, session, spec) {
    const warmup = step('warmup', min(5), 'Stevig wandelen');
    const cooldown = step('cooldown', min(5), 'Rustig wandelen');
    const base = { presetId: `c25k-w${week}-t${session}`, week, session };
    if (spec === 'finale') {
      return {
        ...base,
        name: 'Week 10 – Training 2: 5 km',
        notes: '🎉 5 km rustig proberen. Het blok duurt 40 minuten; ben je eerder bij 5 km, tik dan op ⏭ voor de cooling-down.',
        items: [warmup, step('run', min(40), '5 km rustig'), cooldown],
      };
    }
    if (spec.length === 3) {
      const [run, walk, times] = spec;
      return {
        ...base,
        name: `Week ${week} – Training ${session}`,
        notes: `${minText(run)} lopen / ${minText(walk)} wandelen × ${times}`,
        items: [warmup, repeat(times, [step('run', run), step('walk', walk)]), cooldown],
      };
    }
    const [run, label = 'Rustig lopen'] = spec;
    return {
      ...base,
      name: `Week ${week} – Training ${session}`,
      notes: `${run / 60} min ${label.toLowerCase()}`,
      items: [warmup, step('run', run, label), cooldown],
    };
  }

  const PROGRAMS = [
    {
      id: 'c25k',
      name: 'Van 0 naar 5 km',
      description: '10 weken, 2 trainingen per week: van 1 minuut lopen naar 5 km rustig. Elke training begint met 5 minuten stevig wandelen en eindigt met 5 minuten rustig wandelen.',
      trainings: C25K_WEEKS.flatMap((sessions, w) => sessions.map((spec, t) => c25kTraining(w + 1, t + 1, spec))),
    },
  ];

  // Voorbeeld of schematraining opzoeken op presetId.
  function findPreset(presetId) {
    return PRESETS.find((p) => p.presetId === presetId) || PROGRAMS.flatMap((p) => p.trainings).find((p) => p.presetId === presetId) || null;
  }

  return {
    KINDS,
    LIMITS,
    PRESETS,
    PROGRAMS,
    findPreset,
    sanitizeTraining,
    flatten,
    totalDuration,
    durationByKind,
    formatDuration,
    formatSpoken,
    parseDuration,
    stepLabel,
  };
});
