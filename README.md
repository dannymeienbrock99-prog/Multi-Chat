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

## TikFinity: TikTok-LIVE-Chat einrichten

Der TikTok-Chat wird standardmäßig als eigener **Batto-Chat** angezeigt. Seine Nachrichten kommen über die lokale Event-API der TikFinity Desktop-App:

1. Die [TikFinity Desktop-App](https://tikfinity.zerody.one/app/) auf demselben Windows-PC wie das Batto OBS Tool starten.
2. TikFinity vollständig einrichten und dort mit dem gewünschten TikTok-LIVE verbinden. Ein gespeicherter Widget-Link allein stellt noch keine lokale Chatverbindung her.
3. Im Batto OBS Tool unter **Plattformen & Verbindungen → TikFinity Event-/Chat-Bridge** den offiziellen lokalen Endpunkt `ws://localhost:21213/` eintragen. `ws://127.0.0.1:21213/` ist die gleichwertige Loopback-Adresse.
4. **Automatisch verbinden** aktivieren und die Verbindung speichern beziehungsweise starten. Die Bridge versucht erneut zu verbinden, wenn TikFinity erst später gestartet wird.
5. Im Multi-Chat den TikTok-Tab wählen. Neue LIVE-Nachrichten erscheinen jetzt im Batto-Design und stehen zusätzlich für Commands, TTS, Alerts und Overlays bereit.

Der TikFinity-Chat-Link `https://tikfinity.zerody.one/widget/chat?cid=...` ist **optional**. Er kann als umschaltbare **TikFinity Originalansicht** hinterlegt werden, ist aber nur eine Browser-Anzeige. Das Widget zeigt ausschließlich neue Nachrichten nach seinem Laden und ersetzt nicht die lokale WebSocket-Bridge. Für den normalen Betrieb bleibt der Batto-Chat die Standardansicht.

Die offizielle TikFinity-Dokumentation bestätigt den lokalen WebSocket-Endpunkt und dass die Desktop-App auf demselben Computer laufen muss: [TikFinity TikTok LIVE API](https://tikfinity.zerody.one/de/tiktok/dapi).

## Bestehende Funktionsmodule

Die bisherigen 1.1-Funktionen bleiben die UI-Basis und werden schrittweise auf den 2.1-Core umgestellt:

- Multi-Chat TikTok / Twitch / YouTube / CNG
- Rechtsklick-Moderation und Verlauf
- TikFinity Local Bridge und AxelChat
- optionales Eingabefeld für die TikFinity-Originalansicht; HTTP wird auf HTTPS angehoben und dauerhaft getrennt von der lokalen Chat-Bridge gespeichert
- zusätzliche TikFinity-Browser-Widgets für Follower, Gifts, Likes, Shares, Abos, Ziele, Ranglisten und eigene Anzeigen
- stabile lokale TikFinity-OBS-URLs unter `http://127.0.0.1:17777/overlay/tikfinity/<widget-id>`
- originale Plattform-Logos an TikTok-, Twitch-, YouTube- und CNG-Nachrichten im Multi-Chat und Chat-Overlay
- austauschbares Chatfenster-Bild: eigenes PNG/JPG/WebP hochladen, Vorschau, Abdunklung, Anpassung und Position einstellen oder jederzeit das Crazy_Batto-Motiv aus dem Social-Media-Set wiederherstellen
- eigenes Icon für „Lokaler Chat / Overlay“ hochladen; die App schneidet es mittig quadratisch zu, erzeugt automatisch ein 128×128-PNG und verwendet es im Multi-Chat sowie im OBS-Chat-Overlay
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
- TikFinity-HTTPS-Widgets werden auf `tikfinity.zerody.one/widget/` begrenzt; die Event-/Chat-Bridge bleibt davon getrennt bei `ws://` bzw. `wss://`
- das optionale TikFinity-Chat-Widget zeigt nur Nachrichten, die nach dem Laden während einer aktiven LIVE-Verbindung eintreffen; Batto-Chat, Commands und TTS verwenden die lokale TikFinity-Bridge
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
