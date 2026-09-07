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
- Direkter **Twitch Nur-Lesen-Chat** über IRC/WebSocket ohne Client-ID-Eingabe und ohne Token-Feld.
- Twitch-Kanal kann als Kanalname, normale Twitch-URL oder Dashboard-Popout-URL angegeben werden.
- Lokaler Testadapter für Entwicklungs- und Abnahmetests.
- Lokaler OBS-HTTP/WebSocket-Server, Standard `127.0.0.1:8787`.
- OBS-Chat-Browserquelle: `http://127.0.0.1:8787/overlay/chat`.
- Chat-Design-Konfiguration für Schrift, Farben, Glow und Anzeigedauer.
- Lokale Config-Speicherung plus JSON Import/Export und rotierende lokale Backups.
- Fensterposition und -größe für Haupt- und entkoppeltes Fenster werden wiederhergestellt.
- Originaler CRAZY_BATTO-Hintergrund aus der Arbeitsanweisung als vollflächiger Programm-Hintergrund.
- CRAZY_BATTO-Team-Alpha-Grafik als Programm-/Installer-Icon; das veraltete Multi-Chat-Bild wird nicht verwendet.
- Capability-Gating: Nicht vorhandene Plattformfunktionen werden **nicht** als erfolgreich simuliert.

## Twitch

Die normale Twitch-Einstellung dieses Builds enthält **kein OAuth-/Access-Token-Feld** und verlangt **keine Client ID**. Für das reine Lesen eines öffentlichen Twitch-Chats wird eine anonyme IRC-Verbindung verwendet.

Beispiele für das Channel-Feld:

```text
crazy_batto
https://www.twitch.tv/crazy_batto
https://dashboard.twitch.tv/popout/u/crazy_batto/stream-manager/chat
```

Dieser Modus ist bewusst **Nur Lesen**. Twitch-Nachrichten senden und echte Twitch-Plattformmoderation werden in diesem Stand nicht als verfügbar dargestellt.

## Absichtlich noch nicht als „fertig“ behauptet

Die Arbeitsanweisung fordert ausdrücklich, dass nicht verfügbare Plattformfunktionen nicht simuliert werden. Deshalb sind in diesem Stand folgende Punkte klar als noch nicht implementiert gekennzeichnet:

- Twitch Chat-Senden und echte Twitch-Plattformmoderation
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
│  ├─ Twitch IRC/WebSocket (anonym, Nur Lesen)
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

Nicht verfügbare Plattformaktionen dürfen nicht als erfolgreich simuliert werden. Der Twitch-Nur-Lesen-Modus speichert keine Twitch-Zugangsdaten.
