# Hardlopen

Maak je hardlooptrainingen vooraf en laat je tijdens het lopen leiden door
piepjes en een stem — geen stopwatch meer waar je steeds op moet klikken.

## Installatie

1. Vul onder **Configuratie** een `access_code` in (een wachtwoord naar
   keuze). Die heb je nodig om de app buiten Home Assistant om te openen,
   bijvoorbeeld op je telefoon via `https://hardlopen.den-hollander.com`.
2. Start de add-on.
3. Open de app via het **Hardlopen**-paneel in het HA-zijmenu (geen code
   nodig), of via de tunnel-URL en log daar één keer in met de code.
   Het toestel onthoudt de inlog een jaar. Wijzig je de code, dan moeten alle
   toestellen opnieuw inloggen.

## Op je telefoon zetten

Open `https://hardlopen.den-hollander.com` in Safari (iPhone) of Chrome
(Android) en kies **Deel → Zet op beginscherm** (iPhone) of **App
installeren** (Android). De app werkt daarna ook zonder bereik.

## Cloudflare-tunnel

De app luistert op poort 3200. In de Cloudflared-add-on staat daarvoor bij
`additional_hosts`:

```yaml
- hostname: hardlopen.den-hollander.com
  service: http://<slug-met-streepjes>-hardlopen:3200
```

`<slug-met-streepjes>` is de slug van deze add-on met `_` vervangen door `-`
(bv. `a1b2c3d4-hardlopen`).

## Trainingen maken

- Een training bestaat uit **stappen** (soort + duur + optionele eigen
  omschrijving) en **herhaalblokken** (een reeks stappen die X keer
  herhaald wordt).
- De gekleurde balk laat de opbouw van de hele training zien.
- **Schema "Van 0 naar 5 km"**: 10 weken met 2 trainingen per week. De
  volgende training staat bovenaan klaar; afgeronde trainingen krijgen een
  ✅ (een gestopte training telt niet mee). Bij de laatste training (5 km)
  duurt het loopblok 40 minuten: ben je eerder bij 5 km, tik dan op ⏭.
- Onder **Voorbeelden** staan kant-en-klare schema's; "Kopiëren en
  aanpassen" maakt er een eigen training van.

## Tijdens het lopen

- Bovenaan de huidige stap met de resterende tijd, daaronder wat er straks
  komt en de totale voortgang.
- ⏮ gaat terug naar het begin van de stap (of binnen 3 seconden naar de
  vorige), ⏭ slaat de stap over, ⏸ pauzeert.
- Dezelfde bediening werkt via het vergrendelscherm en de knoppen van je
  oordopjes.
- Wordt de app per ongeluk gesloten, dan loopt de klok gewoon door: bij
  openen ga je direct terug naar het loopscherm (tik één keer om het geluid
  weer aan te zetten).

### Scherm uit of muziek?

Onder **Instellingen → Scherm uit / muziek**:

| Keuze | Scherm uit | Eigen muziek (Spotify e.d.) |
|---|---|---|
| Blijft werken met scherm uit (standaard) | ✅ piepjes gaan door | ⚠️ op iPhone wordt je muziek gepauzeerd |
| Over mijn muziek heen | ❌ scherm moet aan blijven | ✅ piepjes over je muziek heen |

Gesproken aankondigingen komen bij een uitgeschakeld scherm soms iets later
of niet (de browser pauzeert dan JavaScript); de piepjes zijn vooraf
ingepland en komen wel precies op tijd.

## Opslag

Trainingen en geschiedenis staan in `/data/hardlopen.json` en gaan dus mee
in de back-ups van Home Assistant.
