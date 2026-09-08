# CRAZY_BATTO Multi-Chat Platform 1.0.0

Moderne Electron-Desktopplattform für Multi-Chat, Moderation, OBS-Overlays und Stream-Automation.

## Oberfläche

Die Anwendung verwendet das CRAZY_BATTO / Team-Alpha-Branding und eine moderne dunkelblaue Dashboard-Oberfläche. Enthalten sind:

- Multi-Chat mit Tabs **Alle / TikTok / Twitch / CNG / YouTube**
- plattformgetrennte Moderation
- Rechtsklick auf Chat-Namen: Moderator hinzufügen/entfernen, stummschalten, blockieren, entstummen, entblocken
- Moderationsverlauf mit Grund, letzter Nachricht, ausführendem Benutzer, Plattform und Ergebnis
- Chat-Filter
- Twitch-Hologramm / Chat-Overlay mit Schriftart, eigener Schrift, Farben, Glow und Anzeigedauer
- Co-Host mit 1/2/3/4/6/9 Plätzen, TikTok- und Twitch-Format
- Commands, Hotkeys / Multi-Action und Events
- Medien, Medien-Pools und TTS
- Discord-Webhook
- Backup / Import / Export
- Statusleiste mit CPU, RAM und OBS-Daten

## Plattformen

### TikTok / TikFinity

TikFinity wird lokal über WebSocket angebunden, Standard:

```text
ws://127.0.0.1:21213/
```

Dafür ist kein Euler-Adapter erforderlich. Chat und von TikFinity gelieferte Events können in den gemeinsamen Core übernommen werden.

Zusätzlich kann AxelChat als lokale WebSocket-Bridge verwendet werden, Standard:

```text
ws://127.0.0.1:8356
```

### Twitch

Der sichtbare normale Twitch-Bereich enthält **kein OAuth-/Access-Token-Feld**. Der aktuelle Direktmodus liest öffentlichen Twitch-Chat ohne Token-Eingabe. Twitch-Senden und echte Twitch-Plattformmoderation werden in diesem Modus bewusst nicht als verfügbar simuliert.

Das Channel-Feld akzeptiert Kanalnamen, normale Twitch-URLs und Dashboard-Popout-URLs.

### YouTube

YouTube-Live-Chat kann mit Live-Chat-ID und eigenem API-Key gelesen werden. Der API-Key wird nicht in der normalen Config gespeichert, sondern über Electron/Windows Secure Storage behandelt.

### CNG

CNG bleibt lokal/Bridge-basiert, solange keine belastbar dokumentierte allgemeine Schreib-/Moderationsschnittstelle vorliegt.

## OBS

OBS WebSocket und Overlay-Webserver sind getrennt:

```text
OBS WebSocket: ws://127.0.0.1:4455
Overlay HTTP:  http://127.0.0.1:8787
```

Overlay-Routen:

```text
/overlay/chat
/overlay/all
/overlay/gifts
/overlay/follow
/overlay/subs
/overlay/media
/cohost/tiktok
/cohost/twitch
```

Der Overlay-Webserver weicht bei einem belegten HTTP-Port auf den nächsten freien Port aus. OBS-WebSocket bleibt davon unberührt.

## Sicherheit

- Electron `contextIsolation` aktiv
- keine Node-Integration im Renderer
- lokale Ingest-/WebSocket-Routen auf Loopback beschränkt
- OBS-Passwort, YouTube-API-Key und Discord-Webhook über Windows/Electron Secure Storage
- Hotkeys benötigen einen konkreten Zielprozess
- nicht vorhandene Plattformaktionen werden nicht als erfolgreich simuliert

## Entwicklung

```bat
npm install
npm run check
npm run smoke
npm start
```

## Windows-Installer

```bat
npm run pack:win
```

Erwarteter Installer:

```text
CRAZY-BATTO-Multi-Chat-Setup-1.0.0.exe
```

Die GitHub-CI führt Syntaxprüfung, Smoke-Test und Windows-NSIS-Build aus.
