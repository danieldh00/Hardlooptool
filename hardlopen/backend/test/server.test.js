const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/server');

function start(opts = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hardlopen-test-'));
  const app = createApp({ dataDir, accessCode: 'geheim', secret: 'x'.repeat(64), ...opts });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ base, dataDir, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

async function login(base, code = 'geheim') {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  return { res, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

const training = (over = {}) => ({
  id: 'abcdef123',
  updatedAt: Date.now(),
  name: 'Test',
  items: [{ type: 'step', kind: 'run', duration: 600 }],
  ...over,
});

test('zonder inlog geen toegang tot de data', async () => {
  const srv = await start();
  try {
    const res = await fetch(`${srv.base}/api/sync`);
    assert.equal(res.status, 401);
    const status = await (await fetch(`${srv.base}/api/auth/status`)).json();
    assert.equal(status.authenticated, false);
    assert.equal(status.configured, true);
  } finally {
    await srv.close();
  }
});

test('X-Ingress-Path vanaf een willekeurig IP geeft geen toegang', async () => {
  const srv = await start();
  try {
    const res = await fetch(`${srv.base}/api/sync`, { headers: { 'X-Ingress-Path': '/api/hassio_ingress/abc' } });
    assert.equal(res.status, 401);
  } finally {
    await srv.close();
  }
});

test('verkeerde code faalt, juiste code geeft een werkende cookie', async () => {
  const srv = await start();
  try {
    assert.equal((await login(srv.base, 'fout')).res.status, 401);
    const { res, cookie } = await login(srv.base);
    assert.equal(res.status, 200);
    assert.match(cookie, /^hardlopen_session=/);
    const sync = await fetch(`${srv.base}/api/sync`, { headers: { Cookie: cookie } });
    assert.equal(sync.status, 200);
  } finally {
    await srv.close();
  }
});

test('andere toegangscode maakt oude cookies ongeldig', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hardlopen-test-'));
  const a = await start({ dataDir });
  const { cookie } = await login(a.base);
  await a.close();
  const b = await start({ dataDir, accessCode: 'nieuw' });
  try {
    const res = await fetch(`${b.base}/api/sync`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 401);
  } finally {
    await b.close();
  }
});

test('zonder ingestelde code kan niemand inloggen', async () => {
  const srv = await start({ accessCode: '' });
  try {
    const { res } = await login(srv.base, '');
    assert.equal(res.status, 409);
  } finally {
    await srv.close();
  }
});

test('sync: laatste wijziging wint, tombstones en opslag op schijf', async () => {
  const srv = await start();
  try {
    const { cookie } = await login(srv.base);
    const post = (body) =>
      fetch(`${srv.base}/api/sync`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    const t1 = Date.now() - 10_000;
    let res = await (await post({ trainings: [training({ updatedAt: t1, name: 'Eerste' })] })).json();
    assert.equal(res.trainings[0].name, 'Eerste');

    // Oudere versie wordt genegeerd.
    res = await (await post({ trainings: [training({ updatedAt: t1 - 1, name: 'Oud' })] })).json();
    assert.equal(res.trainings[0].name, 'Eerste');

    // Nieuwere verwijdering wint.
    res = await (await post({ trainings: [{ id: 'abcdef123', updatedAt: t1 + 1, deleted: true }] })).json();
    assert.equal(res.trainings[0].deleted, true);

    // Geschiedenis
    res = await (await post({ history: [{ id: 'hist12345', updatedAt: Date.now(), trainingId: 'abcdef123', name: 'Eerste', startedAt: Date.now(), elapsed: 600, planned: 600, completed: true }] })).json();
    assert.equal(res.history.length, 1);

    const onDisk = JSON.parse(fs.readFileSync(path.join(srv.dataDir, 'hardlopen.json'), 'utf8'));
    assert.equal(onDisk.trainings.abcdef123.deleted, true);
    assert.equal(onDisk.history.hist12345.elapsed, 600);
  } finally {
    await srv.close();
  }
});

test('sync: ongeldige training wordt geweigerd en niets wordt opgeslagen', async () => {
  const srv = await start();
  try {
    const { cookie } = await login(srv.base);
    const res = await fetch(`${srv.base}/api/sync`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trainings: [training({ id: 'goed12345' }), training({ id: 'fout12345', items: [{ kind: 'run', duration: 1 }] })] }),
    });
    assert.equal(res.status, 400);
    const snap = await (await fetch(`${srv.base}/api/sync`, { headers: { Cookie: cookie } })).json();
    assert.equal(snap.trainings.length, 0);
  } finally {
    await srv.close();
  }
});

test('frontend en service worker worden geserveerd', async () => {
  const srv = await start();
  try {
    const html = await (await fetch(`${srv.base}/`)).text();
    assert.match(html, /<title>Hardlopen<\/title>/);
    const sw = await (await fetch(`${srv.base}/sw.js`)).text();
    assert.doesNotMatch(sw, /__CACHE_VERSION__/);
    // Elke app-shell-file uit sw.js moet echt bestaan (anders faalt de installatie).
    const files = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
    for (const f of files) assert.equal((await fetch(`${srv.base}/${f}`)).status, 200, f);
  } finally {
    await srv.close();
  }
});
