# Batto Multi-Chat

Desktop-Multi-Chat für **Twitch, TikTok, CNG und YouTube** auf Basis der *Batto OBS Tool – Arbeitsanweisung V4 (04.09.2026)*.

## Was dieser Build bereits kann

- Gemeinsamer Chat-Core mit normalisiertem Nachrichtenformat.
- Tabs **Alle / Twitch / TikTok / CNG / YouTube**.
- Entkoppeltes Chat-Fenster mit demselben Core und demselben Verlauf.
- Rechtsklick auf Benutzernamen: Moderator hinzufügen/entfernen, stummschalten, blockieren, entstummen, entblocken.
- Lokaler Moderationsverlauf und klare Kennzeichnung lokaler Aktionen.
- Frei pflegbarer Chat-Filter mit Plattformwahl und Aktionen.
- **AxelChat Bridge** über WebSocket, Standard `ws://127.0.0.1:8356`, inklusive Reconnect.
- Lokaler Testadapter für Entwicklungs- und Abnahmetests.
- Lokaler OBS-HTTP/WebSocket-Server, Standard `127.0.0.1:8787`.
- OBS-Chat-Browserquelle: `http://127.0.0.1:8787/overlay/chat`.
- Chat-Design-Konfiguration für Schrift, Farben, Glow und Anzeigedauer.
- Lokale Config-Speicherung plus JSON Import/Export und rotierende lokale Backups.
- Fensterposition und -größe für Haupt- und entkoppeltes Fenster werden wiederhergestellt.
- Originaler CRAZY_BATTO-Hintergrund aus der Arbeitsanweisung als vollflächiger Programm-Hintergrund.
- CRAZY_BATTO-Team-Alpha-Grafik als Programm-/Installer-Icon; das veraltete Multi-Chat-Bild wird nicht verwendet.
- Capability-Gating: Nicht vorhandene Plattformfunktionen werden **nicht** als erfolgreich simuliert.

## Absichtlich noch nicht als „fertig“ behauptet

Die Arbeitsanweisung fordert ausdrücklich, dass nicht verfügbare Plattformfunktionen nicht simuliert werden. Deshalb sind in diesem Stand folgende Punkte sauber als noch nicht autorisiert/implementiert gekennzeichnet:

- offizieller Twitch-Login, Chat-Senden, Helix/EventSub-Moderation
- offizieller YouTube-Livechat-Adapter
- TikFinity Local Bridge
- optionaler direkter Euler-TikTok-Adapter
- dokumentierte CNG-Plattformaktionen
- Gifts/Follow/Media/Co-Host-Routen (antworten derzeit bewusst mit HTTP 501)

## Start

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

Danach liegt der NSIS-Installer unter `dist/`.

## Architektur

```text
Electron Main
├─ ConfigStore
├─ ChatCore
│  ├─ Normalisierung
│  ├─ Chat-Filter
│  ├─ lokale Moderation
│  └─ Logs
├─ Adapter
│  ├─ AxelChat WebSocket
│  └─ Mock/Test
└─ OverlayServer
   ├─ HTTP /overlay/chat
   └─ WebSocket /ws

Renderer
├─ Multi-Chat
├─ Rechtsklick-Moderation
├─ Modul-Configs
└─ OBS-URL / Status
```

## Sicherheits-/Verhaltensregel

Geheime OAuth-/API-Werte gehören nicht in die sichtbare Hauptoberfläche. Plattformaktionen dürfen erst dann als „Plattform“ protokolliert werden, wenn der jeweilige Adapter die Aktion wirklich ausgeführt und bestätigt hat.
