// Lokale opslag: alles staat in localStorage zodat de app volledig offline
// werkt (ook midden in het bos zonder bereik). Records met `dirty: true` zijn
// lokaal gewijzigd en nog niet naar de add-on gestuurd -- zie api.js/sync().
const Store = (() => {
  const PREFIX = 'hl:';

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      if (value == null) localStorage.removeItem(PREFIX + key);
      else localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (err) {
      console.warn('Opslaan in localStorage mislukt', err);
    }
  }

  function newId() {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
  }

  // Monotoon oplopend, ook als twee wijzigingen in dezelfde milliseconde vallen.
  let lastStamp = 0;
  function stamp() {
    lastStamp = Math.max(Date.now(), lastStamp + 1);
    return lastStamp;
  }

  const collection = (key) => ({
    all() {
      return Object.values(read(key, {})).filter((r) => !r.deleted);
    },
    get(id) {
      const rec = read(key, {})[id];
      return rec && !rec.deleted ? rec : null;
    },
    put(record) {
      const map = read(key, {});
      const saved = { ...record, id: record.id || newId(), updatedAt: stamp(), dirty: true };
      map[saved.id] = saved;
      write(key, map);
      return saved;
    },
    remove(id) {
      const map = read(key, {});
      map[id] = { id, deleted: true, updatedAt: stamp(), dirty: true };
      write(key, map);
    },
    dirty() {
      return Object.values(read(key, {})).filter((r) => r.dirty);
    },
    // Verwerkt de stand van de server. Een lokaal record dat na het
    // versturen nóg eens gewijzigd is (nieuwere updatedAt) blijft staan.
    applyServer(records) {
      const map = read(key, {});
      for (const rec of records) {
        const local = map[rec.id];
        if (local && local.dirty && local.updatedAt > rec.updatedAt) continue;
        map[rec.id] = { ...rec, dirty: false };
      }
      write(key, map);
    },
  });

  const DEFAULT_SETTINGS = {
    speech: true,
    beeps: true,
    countdown: true,
    vibrate: true,
    halfway: false,
    voiceURI: '',
    audioMode: 'background', // 'background' | 'mix'
    leadIn: 5,
    volume: 0.8,
  };

  return {
    trainings: collection('trainings'),
    history: collection('history'),
    newId,
    settings() {
      return { ...DEFAULT_SETTINGS, ...read('settings', {}) };
    },
    saveSettings(patch) {
      const next = { ...this.settings(), ...patch };
      write('settings', next);
      return next;
    },
    activeRun() {
      return read('activeRun', null);
    },
    saveActiveRun(run) {
      write('activeRun', run);
    },
    lastSync() {
      return read('lastSync', 0);
    },
    setLastSync(t) {
      write('lastSync', t);
    },
  };
})();
