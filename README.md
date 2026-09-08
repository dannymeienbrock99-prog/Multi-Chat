# Batto OBS Tool 2.1

Windows/Electron Streaming-Plattform für Multi-Chat, Moderation, OBS, Overlays, Alerts, Automationen, TTS und Media.

Diese Branch folgt dem **Technischen Arbeitsauftrag 2.1 vom 08.09.2026**. Die Priorität liegt auf sauberer Modultrennung, stabilen Settings, reproduzierbaren Builds und Fehlerisolation.

## 2.1 Architektur

Die verbindliche Datenrichtung ist:

```text
Plattform-Connector
      ↓
Event Normalizer → Validierung → Dedup → Aggregation
      ↓
Event Core / Bus
      ├─ Multi-Chat
      ├─ Moderation / Audit
      ├─ Rules / Commands / Hotkeys
      ├─ TTS
      ├─ Alerts
      └─ Overlay Server → OBS Browser Source

OBS Service ↔ obs-websocket 5.x
FFmpeg Service ↔ Worker-Prozess
```

Neu angelegt sind getrennte Core-Module für:

- `src/core/events/` – versioniertes Event-Schema, Normalizer, Dedupe, Aggregation, bounded Event-Bus und Event-Core
- `src/core/connectors/` – Connector-Vertrag und isolierter Connector-Manager mit Timeout/Backoff
- `src/core/settings/` – Validierung, Draft/Apply/Discard/Reset und separater Secrets-Service
- `src/core/logging/` – strukturierte, Secret-bereinigte Logs
- `src/core/health/` – Health-Snapshot für OBS, Overlay, Connectoren, Event-Core, FFmpeg und Settings
- `src/core/storage/` – optionaler SQLite-WAL-Audit-Store mit DEGRADED-Fallback
- `src/core/media/` – FFmpeg-Erkennung, Encoder-Test, beaufsichtigter Child Process und Media-Presets

## Settings / User Data

Laufzeitdaten liegen unter dem Electron-UserData-Pfad in `Batto-OBS-Tool/`:

```text
settings.json
settings.backup.json
secrets.bin
profiles/
data/
assets/
logs/
backups/
cache/
```

Alte `BattoMultiChat/config.json`-Daten werden beim ersten Start übernommen, wenn noch keine neue 2.1-Settings-Datei existiert.

Settings werden validiert und atomar geschrieben. Secrets bleiben außerhalb der normalen Settings/Exporte.

## Ports

- OBS WebSocket: `ws://127.0.0.1:4455`
- Batto Overlay HTTP/WS: `http://127.0.0.1:17777` und `ws://127.0.0.1:17777/ws`

Der Overlay-Port wechselt bei Konflikten **nicht mehr still auf einen anderen Port**. Ein belegter Port wird als klarer Fehler gemeldet.

## Bestehende Funktionsmodule

Die bisherigen 1.1-Funktionen bleiben die UI-Basis und werden schrittweise auf den 2.1-Core umgestellt:

- Multi-Chat TikTok / Twitch / YouTube / CNG
- Rechtsklick-Moderation und Verlauf
- TikFinity Local Bridge und AxelChat
- Twitch Nur-Lesen
- YouTube Live-Chat
- CNG Overlay-/Ghost-Integration
- Auto-Broadcast
- Commands, Events, Hotkeys / Multi-Action
- Medien und Medien-Pools
- TTS mit Audio-Ausgabe
- Discord Webhook
- Hologramm und Co-Host
- OBS WebSocket 4455
- Backups und synchronisierte Einstellungen
- CRAZY_BATTO Programm-Hintergrund

## Sicherheitsregeln

- keine privaten TikTok-Endpunkte, Signaturmechanismen, Cookie-Hacks oder Bypässe im Core
- Loopback-only als Default für Overlay und interne WebSockets
- Electron `contextIsolation`, keine Node-Integration im Renderer
- Secrets via `safeStorage`
- keine Dummy-Erfolgsmeldungen für nicht autorisierte Plattformaktionen
- FFmpeg nur mit Argument-Arrays über `spawn`, nie über frei zusammengesetzte Shell-Strings

## Tests

```bat
npm install
npm run check
npm run smoke
npm start
```

Windows-Setup:

```bat
npm run pack:win
```

## Aktueller 2.1 Status

Der neue Core ist als getrennte Schicht angelegt und durch Syntax-/Smoke-Tests abgesichert. Die vollständige Verdrahtung aller bestehenden UI-Module über Event-Core, Connector-Manager, Audit-Store, Health-Service und FFmpeg-Service erfolgt in der 2.1-Branch schrittweise nach der im Arbeitsauftrag vorgegebenen Reihenfolge. Erst wenn die Definition-of-Done-Checkliste vollständig erfüllt ist, wird 2.1 als fertig bezeichnet.
