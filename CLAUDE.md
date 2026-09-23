# Hardlopen — werkgeheugen

Home Assistant add-on: PWA om hardlooptrainingen te maken en te lopen met
automatische timers (piepjes, spraak, trillen), zodat er onderweg niet met
een stopwatch geklikt hoeft te worden. Repo `danieldh00/Hardlooptool`.
Live op **https://hardlopen.den-hollander.com** (Cloudflare-tunnel) en via
het **Hardlopen**-paneel in HA (ingress).

Zusterprojecten met hetzelfde patroon: `danieldh00/Lijstjes` (poort 3100,
taken.den-hollander.com) en `danieldh00/Russianlanguageapp` (poort 3000,
russisch.den-hollander.com). Deze add-on gebruikt **poort 3200**.

## Branchmodel

- **`master`** is de productiebranch en GitHub's default branch. Home
  Assistant Supervisor kloont die branch als de repo als add-on-store is
  toegevoegd; met auto_update aan werkt de add-on zichzelf bij na een
  versie-bump op `master`.
- **`develop`** is de integratiebranch. Features takken af van `develop` als
  `feature/<naam>` (of `claude/<naam>`) en gaan via een PR terug naar
  `develop`.
- **Release** = PR van `develop` naar `master`, met een versie-bump in
  `hardlopen/config.yaml` én een entry in `hardlopen/CHANGELOG.md`.
  Supervisor biedt alleen een update aan als de versie hoger is — zonder
  bump komt een wijziging op `master` nooit op de Pi.
- `.github/workflows/addon-version.yml` + `scripts/check_addon_version.py`
  laten elke push naar `master` die iets in `hardlopen/` wijzigt (en elke PR
  naar `master`) falen als de versie niet omhoog is gegaan. Check vóór het
  bumpen ook de live `installed_version` via het `update.hardlopen_update`-
  entity in HA; die kan hoger zijn dan de git-geschiedenis.
- Zolang er één gebruiker is mag direct naar `master` gepusht worden om snel
  te testen; geen branch protection. Gaat dit naar meer gebruikers: branch
  protection aan en alleen nog via PR.

## Harde regels

- **Nooit secrets in de repo.** `access_code` staat alleen in de
  add-on-opties; de sessiesleutel wordt bij de eerste start aangemaakt in
  `/data/session-secret`.
- **Alle URL's in de frontend relatief** (`api/sync`, `sw.js`, nooit `/api`):
  onder ingress draait de app op `/api/hassio_ingress/<token>/`.
- **Ingress alleen vertrouwen op header + Supervisor-IP (`172.30.32.2`)**
  (`backend/src/auth.js`). De header alleen is door iedereen te vervalsen;
  verkeer via de tunnel komt van het IP van de Cloudflared-add-on.
- **`webui` + gepubliceerde poort 3200 blijven staan** naast ingress: de
  tunnel en de geïnstalleerde PWA gaan via de poort.
- **Nieuw bestand in `frontend/js/`** → toevoegen aan drie lijsten die gelijk
  moeten blijven: `<script>`-tags in `index.html`, `APP_SHELL_FILES` in
  `backend/src/server.js` en `SHELL_FILES` in `frontend/sw.js`. Een test in
  `server.test.js` controleert dat elk bestand uit `sw.js` bestaat.
- UI-teksten, commentaar, changelog en docs in het **Nederlands**.
- Geen modelnamen/-ID's in commits, PR's, code of andere repo-artefacten.
- Exports die de gebruiker vraagt: **Excel, geen CSV**, tenzij expliciet anders.
- **Nooit `pkill -f`** in de cloud-sandbox (killt de eigen shell); stop een
  testserver met `kill $(lsof -ti tcp:3200)`.

## Structuur

```
repository.yaml                  HA add-on-store
hardlopen/config.yaml            versie, poort 3200, ingress, optie access_code
hardlopen/{Dockerfile,apparmor.txt,CHANGELOG.md,DOCS.md,icon.png,logo.png}
hardlopen/backend/src/
  server.js      createApp(): auth-routes, /api/sync, /sw.js met cache-hash, static
  auth.js        ingress-herkenning, HMAC-cookie (toegangscode zit in de handtekening)
  store.js       /data/hardlopen.json, merge "laatste updatedAt wint", tombstones
  options.js     /data/options.json + sessiesleutel
  rateLimit.js   in-memory (login: 10 per 15 min)
hardlopen/backend/test/          node --test: workout, runner, server (auth + sync)
hardlopen/frontend/js/
  workout.js     gedeeld model (ook door de backend ge-require'd): soorten,
                 validatie, flatten, tijdnotatie, voorbeeldschema's
  storage.js     localStorage (`hl:`-prefix), dirty-vlag per record
  api.js         fetch-wrapper + sync()
  audio.js       Web Audio-piepjes (vooraf ingepland), stille keep-alive,
                 spraak, trillen
  runner.js      loop-engine op wandklok, pauze/skip/vorige, cue-planning
  app.js         router (#/...) en alle schermen
```

## Hoe het lopen werkt (niet zomaar veranderen)

- De positie in de training is **puur afgeleid van `Date.now()`**
  (`accumulatedMs` + `runningSince`), nooit van getelde interval-tikken. Zo
  klopt alles weer zodra de pagina na scherm-uit een tik krijgt. De toestand
  staat in `localStorage` (`hl:activeRun`), dus herladen = verder lopen.
- **Piepjes worden vooraf in de AudioContext-klok ingepland**
  (`Runner.cues()` → `Cues.schedule()`), omdat JS-timers met scherm uit
  stilvallen. Bij elke toestandswijziging én bij terugkeer naar de voorgrond
  wordt alles geannuleerd en opnieuw ingepland.
- Modus `background`: `navigator.audioSession.type = 'playback'` + stil
  WAV-bestand in een lus → audiosessie blijft actief met scherm uit (pauzeert
  op iOS andere muziek). Modus `mix`: `transient`, geen keep-alive, wake lock
  houdt het scherm aan.
- Spraak (`speechSynthesis`) kan niet vooraf ingepland worden; komt bij de
  eerstvolgende tik.
- Media Session-handlers → bediening via vergrendelscherm/oordopjes.
- **Nog niet op een echte iPhone getest** met scherm uit — dat is het eerste
  om te verifiëren bij klachten over gemiste signalen.

## Lokaal draaien en testen

```sh
cd hardlopen/backend && npm install
DATA_DIR=/tmp/hardlopen-test ACCESS_CODE=test PORT=3200 node src/server.js
npm test          # unit- en API-tests (ook in CI)
```

Playwright/Chromium staat in de cloud-sandbox klaar
(`/opt/node22/lib/node_modules/playwright`, browsers in `/opt/pw-browsers`).

## Home Assistant

- Add-on-slug: **`246b612c_hardlopen`** (auto_update + watchdog aan);
  container-hostnaam `246b612c-hardlopen`. De repo-hash hangt af van de repository-URL; wordt
  de add-on-repo verwijderd en opnieuw toegevoegd, dan verandert de slug en
  moet de Cloudflared-verwijzing mee.
- **Cloudflared-add-on** (slug `9074a9fa_cloudflared`, lokale tunnel-modus):
  in `additional_hosts` staat
  `hardlopen.den-hollander.com → http://246b612c-hardlopen:3200`. Na
  wijzigen de Cloudflared-add-on herstarten; die maakt het DNS-record zelf aan.
- Logs: `ha_get_logs(source="supervisor", slug="246b612c_hardlopen")`.
