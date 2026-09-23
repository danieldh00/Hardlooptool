// Praat met de add-on. Alle URL's zijn relatief: onder Home Assistant Ingress
// draait de app op /api/hassio_ingress/<token>/ en die prefix verschilt per
// sessie, dus nooit een pad met een leidende '/'.
const Api = (() => {
  class ApiError extends Error {
    constructor(status, body) {
      super((body && body.message) || `HTTP ${status}`);
      this.status = status;
      this.code = body && body.error;
    }
  }

  async function request(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  let syncing = null;

  // Stuurt lokale wijzigingen mee en neemt de volledige serverstand over.
  // Gelijktijdige aanroepen delen dezelfde belofte. Gooit bij 401 (niet
  // ingelogd); netwerkfouten laten de lokale wijzigingen gewoon staan.
  function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      const payload = {
        trainings: Store.trainings.dirty().map(stripDirty),
        history: Store.history.dirty().map(stripDirty),
      };
      const result = await request('api/sync', { method: 'POST', body: payload });
      Store.trainings.applyServer(result.trainings);
      Store.history.applyServer(result.history);
      Store.setLastSync(Date.now());
      return result;
    })().finally(() => {
      syncing = null;
    });
    return syncing;
  }

  function stripDirty(rec) {
    const { dirty, ...rest } = rec; // eslint-disable-line no-unused-vars
    return rest;
  }

  return {
    ApiError,
    status: () => request('api/auth/status'),
    login: (code) => request('api/auth/login', { method: 'POST', body: { code } }),
    logout: () => request('api/auth/logout', { method: 'POST' }),
    sync,
  };
})();
