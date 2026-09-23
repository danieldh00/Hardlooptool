# Hardlopen

Home Assistant add-on + installeerbare webapp om hardlooptrainingen met
automatische timers te maken en te lopen. Stel je schema vooraf samen
(warming-up, intervallen, herhaalblokken, cooling-down) en laat je onderweg
leiden door piepjes, een stem en trillingen — zonder stopwatch.

**Live:** https://hardlopen.den-hollander.com

## Functies

- **Trainingen bouwen** met stappen (Warming-up, Hardlopen, Snel, Rustig
  dribbelen, Wandelen, Rust, Cooling-down) en herhaalblokken
  (bv. 8 × [1 min hardlopen, 1:30 wandelen]); gekleurde tijdlijn en totaaltijd.
- **Voorbeeldschema's**: Start to Run week 1 en 4, intervallen, piramide,
  tempoloop — kopiëren en aanpassen.
- **Loopscherm**: grote aftelklok in de kleur van de stap, "straks: …",
  ronde X van Y, totale voortgang; pauze, vorige en volgende stap.
- **Signalen**: 3-2-1-piepjes, lange piep bij elke wissel, optioneel
  halverwege; gesproken aankondiging in het Nederlands; trillen (Android).
- **Scherm uit**: piepjes worden vooraf in de audioklok ingepland;
  bediening via vergrendelscherm en oordopjes (Media Session).
- **Robuust**: de klok is gebaseerd op de echte tijd en de toestand wordt
  bewaard — een gesloten of herladen app loopt gewoon verder.
- **Geschiedenis** met weekoverzicht.
- **Offline-first** met synchronisatie tussen toestellen via de add-on.

## Installatie in Home Assistant

1. **Instellingen → Add-ons → Add-on-winkel → ⋮ → Repositories** en voeg
   `https://github.com/danieldh00/Hardlooptool` toe.
2. Installeer **Hardlopen**, vul bij Configuratie een `access_code` in en start.
3. Open via het zijpaneel, of via de tunnel-URL (eenmalig inloggen met de code).

Zie [`hardlopen/DOCS.md`](hardlopen/DOCS.md) voor gebruik en de
Cloudflare-tunnelconfiguratie.

## Ontwikkeling

| | |
|---|---|
| Backend | Node 20, Express, JSON-opslag in `/data/hardlopen.json` |
| Frontend | Vanilla JS PWA, geen bundler, hash-routing |
| Tests | `cd hardlopen/backend && npm test` |
| Poort | 3200 |
| Branches | `master` (productie, HA installeert hiervan), `develop` (integratie) |

Zie [`CLAUDE.md`](CLAUDE.md) voor architectuur, branchmodel en valkuilen.
