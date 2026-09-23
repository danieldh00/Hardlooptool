const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const { createAuth, remoteIp } = require('./auth');
const { createStore } = require('./store');
const { createRateLimiter } = require('./rateLimit');
const { loadOptions, loadOrCreateSecret } = require('./options');

const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');

// Moet gelijk blijven aan SHELL_FILES in frontend/sw.js en de <script>-tags
// in index.html: de hash hierover is de cacheversie van de service worker,
// dus elke wijziging aan een van deze bestanden komt vanzelf door op een
// geïnstalleerde PWA.
const APP_SHELL_FILES = [
  'index.html',
  'css/style.css',
  'js/workout.js',
  'js/storage.js',
  'js/api.js',
  'js/audio.js',
  'js/runner.js',
  'js/app.js',
  'manifest.webmanifest',
];

function computeAppVersion() {
  const hash = crypto.createHash('sha256');
  for (const file of APP_SHELL_FILES) hash.update(fs.readFileSync(path.join(FRONTEND_DIR, file)));
  return hash.digest('hex').slice(0, 12);
}

function createApp({ dataDir, accessCode, secret }) {
  const store = createStore(dataDir);
  const auth = createAuth({ secret, getAccessCode: () => accessCode });
  const appVersion = computeAppVersion();
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  // Inloggen: streng begrensd per IP (achter de tunnel is dat het
  // cloudflared-adres, dus effectief een globale grens -- prima voor een
  // app met één gebruiker, en precies wat raden van de code onmogelijk maakt).
  const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyFn: remoteIp });
  const apiLimiter = createRateLimiter({ windowMs: 10 * 1000, max: 60, keyFn: remoteIp });

  app.get('/api/auth/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ authenticated: auth.isAuthenticated(req), configured: Boolean(accessCode), version: appVersion });
  });

  app.post('/api/auth/login', loginLimiter, (req, res) => {
    if (!accessCode) {
      return res.status(409).json({ error: 'not_configured', message: 'Stel eerst een toegangscode in via de add-on-configuratie in Home Assistant.' });
    }
    if (!auth.checkCode(String(req.body?.code ?? ''))) {
      return res.status(401).json({ error: 'wrong_code', message: 'Onjuiste toegangscode.' });
    }
    auth.setCookie(req, res);
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    auth.clearCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/sync', auth.requireAccess, apiLimiter, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(store.snapshot());
  });

  app.post('/api/sync', auth.requireAccess, apiLimiter, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(store.sync(req.body || {}));
  });

  app.get('/api/health', (req, res) => res.json({ ok: true, version: appVersion }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

  // Dynamisch, zodat de cachenaam per deploy verandert en de browser het
  // script zelf nooit uit z'n HTTP-cache haalt.
  app.get('/sw.js', (req, res) => {
    const template = fs.readFileSync(path.join(FRONTEND_DIR, 'sw.js'), 'utf8');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(template.replaceAll('__CACHE_VERSION__', appVersion));
  });

  app.use(express.static(FRONTEND_DIR, { index: 'index.html', setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

  // De app gebruikt hash-routes (#/...), dus elk ander pad is gewoon de app.
  app.get('*', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json', message: 'Ongeldige JSON' });
    const status = err.status && err.status < 500 ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.code || 'internal_error', message: status >= 500 ? 'Interne fout' : err.message });
  });

  return app;
}

if (require.main === module) {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', '..', '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const { accessCode } = loadOptions(dataDir);
  const secret = loadOrCreateSecret(dataDir);
  const port = Number(process.env.PORT) || 3200;
  if (!accessCode) {
    console.warn('Geen toegangscode ingesteld: de app werkt alleen via het Home Assistant-zijpaneel (ingress) tot je access_code invult.');
  }
  createApp({ dataDir, accessCode, secret }).listen(port, () => {
    console.log(`Hardlopen luistert op poort ${port}`);
  });
}

module.exports = { createApp, APP_SHELL_FILES };
