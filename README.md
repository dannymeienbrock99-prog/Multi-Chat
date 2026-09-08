# CRAZY_BATTO Multi-Chat Platform 1.1.0

Windows/Electron Streaming-Plattform für Multi-Chat, Moderation, OBS-Overlays und Stream-Automation.

## Neu in 1.1.0

- Das hochgeladene CRAZY_BATTO-Drachenmotiv wird als vollflächiger Programm-Hintergrund verwendet, inklusive einstellbarer Abdunklung.
- Medien-Pools mit Zufalls-/Sequenzmodus, Medienauswahl, Lautstärke, Anzeigedauer, Wiederholungsschutz und Test.
- TTS mit Windows-SAPI-Stimmen, automatischer Erkennung verbundener Audio-Ausgänge, gezielter Geräteausgabe und Lautstärkeregler.
- Commands mit Plattformfilter für Alle / TikTok / Twitch / CNG / YouTube / Lokal und frei kombinierbaren Multi-Actions.
- Events mit Plattform, Eventtyp, Textfilter, Mindestwert und Multi-Actions.
- Auto-Chat-Broadcast mit Zielplattformen, Intervall, Startverzögerung, Sequenz/Zufall und lokalem CNG-Overlay-Modus.
- CNG: Creator-ID, Alert-Overlay, Ghost-Chat und lokal verschlüsselte OBS-Chat-URL mit `obsChatToken`.
- Laufende Module erhalten Konfigurationsänderungen sofort über `config:changed`.
- Zusätzliche Synchronisations-Einstellungen je Modul.
- Persönliche Info in den Einstellungen: "Ich danke Dir Für alles Sarah Luna Ich hab Dich Lieb Dein Bruder Crazy_Batto".

## Ports

- OBS WebSocket: `ws://127.0.0.1:4455`
- CRAZY_BATTO Overlay-HTTP: `http://127.0.0.1:8787`

## Sicherheit

- Der CNG `obsChatToken` wird niemals in die Git-Konfiguration oder den öffentlichen Quellcode geschrieben. Die vollständige tokenisierte OBS-Chat-URL wird lokal über Electron/Windows `safeStorage` gespeichert.
- Plattform-Schreibaktionen werden nur ausgeführt, wenn eine echte autorisierte Schreib-Verbindung vorhanden ist. CNG Auto-Broadcast kann ohne dokumentierte Schreib-Schnittstelle lokal im Multi-Chat/Overlay ausgegeben werden; ein Plattform-Post wird nicht simuliert.

## Build-Status

GitHub Actions Run `34184593999`:
- Syntax-Check: erfolgreich
- Core-Smoke-Test: erfolgreich
- Windows-NSIS-Installer: erfolgreich
- Artefakt: `CRAZY-BATTO-Multi-Chat-Setup-1.1.0.exe`

## Entwicklung

```bat
npm install
npm run check
npm run smoke
npm start
```

## Windows Installer

```bat
npm run pack:win
```
