const fs = require('fs');
const path = require('path');
const { sanitizeTraining } = require('../../frontend/js/workout');

// Alle data in één JSON-bestand in /data (de add-on-opslag die Supervisor
// meeneemt in back-ups). Voor een handvol trainingen en een paar honderd
// loopjes is dat ruim voldoende en het blijft met de hand leesbaar.
//
// Synchronisatie is "laatste wijziging wint" per record op `updatedAt`
// (door de client gezet, in ms). Verwijderen is een tombstone
// (`deleted: true`), zodat een verwijdering op het ene toestel ook op een
// toestel doorkomt dat op dat moment offline was.

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_TRAININGS = 500;
const MAX_HISTORY = 5000;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'invalid_request';
  return err;
}

function checkMeta(input) {
  if (!input || typeof input !== 'object') throw badRequest('Ongeldig record');
  if (!ID_RE.test(String(input.id))) throw badRequest('Ongeldig id');
  const updatedAt = Number(input.updatedAt);
  // Niet verder dan een dag in de toekomst: anders kan één toestel met een
  // verkeerde klok een record voorgoed "vastzetten".
  if (!Number.isFinite(updatedAt) || updatedAt <= 0 || updatedAt > Date.now() + 24 * 3600 * 1000) {
    throw badRequest('Ongeldige updatedAt');
  }
  return { id: String(input.id), updatedAt: Math.round(updatedAt) };
}

function cleanTraining(input) {
  const meta = checkMeta(input);
  if (input.deleted) return { ...meta, deleted: true };
  return { ...meta, ...sanitizeTraining(input) };
}

function cleanHistory(input) {
  const meta = checkMeta(input);
  if (input.deleted) return { ...meta, deleted: true };
  const startedAt = Number(input.startedAt);
  const elapsed = Math.round(Number(input.elapsed));
  const planned = Math.round(Number(input.planned));
  if (!Number.isFinite(startedAt) || startedAt <= 0) throw badRequest('Ongeldige starttijd');
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 24 * 3600) throw badRequest('Ongeldige duur');
  if (!Number.isFinite(planned) || planned < 0 || planned > 24 * 3600) throw badRequest('Ongeldige geplande duur');
  return {
    ...meta,
    trainingId: ID_RE.test(String(input.trainingId)) ? String(input.trainingId) : null,
    name: String(input.name || 'Training').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Training',
    startedAt: Math.round(startedAt),
    elapsed,
    planned,
    completed: Boolean(input.completed),
  };
}

function createStore(dataDir) {
  const file = path.join(dataDir, 'hardlopen.json');
  let state = { trainings: {}, history: {} };

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    state = { trainings: parsed.trainings || {}, history: parsed.history || {} };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Kapot bestand niet stil overschrijven: apart zetten voor handmatig herstel.
      const backup = `${file}.corrupt-${Date.now()}`;
      console.error(`Kon ${file} niet lezen (${err.message}); bewaard als ${backup}`);
      try {
        fs.renameSync(file, backup);
      } catch {
        /* niets meer aan te doen */
      }
    }
  }

  function persist() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file); // atomisch: nooit een half geschreven bestand
  }

  function mergeInto(collection, records, clean, limit) {
    let changed = false;
    for (const raw of records) {
      const record = clean(raw);
      const existing = collection[record.id];
      if (existing && existing.updatedAt >= record.updatedAt) continue;
      if (!existing && Object.keys(collection).length >= limit) throw badRequest('Maximum aantal records bereikt');
      collection[record.id] = record;
      changed = true;
    }
    return changed;
  }

  // Past de wijzigingen van een client toe en geeft de volledige, actuele
  // stand terug (inclusief tombstones, zodat de client ze kan verwerken).
  // Eerst alles valideren, dan pas toepassen: een ongeldig record in de
  // batch laat de opslag ongewijzigd.
  function sync({ trainings = [], history = [] } = {}) {
    if (!Array.isArray(trainings) || !Array.isArray(history)) throw badRequest('Ongeldig verzoek');
    if (trainings.length > MAX_TRAININGS || history.length > MAX_HISTORY) throw badRequest('Te veel records in één keer');
    trainings.forEach(cleanTraining);
    history.forEach(cleanHistory);
    const changedT = mergeInto(state.trainings, trainings, cleanTraining, MAX_TRAININGS);
    const changedH = mergeInto(state.history, history, cleanHistory, MAX_HISTORY);
    if (changedT || changedH) persist();
    return snapshot();
  }

  function snapshot() {
    return {
      trainings: Object.values(state.trainings),
      history: Object.values(state.history),
      serverTime: Date.now(),
    };
  }

  return { sync, snapshot, file };
}

module.exports = { createStore, cleanTraining, cleanHistory };
