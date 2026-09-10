const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname,'..');
const app = fs.readFileSync(path.join(root,'src','renderer','app.js'),'utf8');
const html = fs.readFileSync(path.join(root,'src','renderer','index.html'),'utf8');
const css = fs.readFileSync(path.join(root,'src','renderer','styles.css'),'utf8');
const v21 = fs.readFileSync(path.join(root,'src','renderer','v21-ui.js'),'utf8');
const main = fs.readFileSync(path.join(root,'electron','main21.cjs'),'utf8');
const preload = fs.readFileSync(path.join(root,'electron','preload.cjs'),'utf8');

const checks = [
  ['Media-Pools konfigurierbar', /renderPoolsModule|mediaPools/],
  ['Medien importierbar', /importMedia|mediaAdd/],
  ['TTS Modul', /renderTtsModule/],
  ['TTS Audio-Geräteerkennung', /enumerateDevices|audiooutput|setSinkId/],
  ['Command Builder', /renderCommandsModule/],
  ['Command Plattformwahl', /cmdPlatform|command.*platform|platform.*command/is],
  ['Events Builder', /renderEventsModule/],
  ['Event Multi-Actions', /event.*actions|actions.*event/is],
  ['Auto-Broadcast', /renderBroadcastModule|autoBroadcast/],
  ['CNG Einstellungen', /cngSaveChatUrl|cngObsChatUrl|ghostChatUrl/],
  ['TikFinity HTTPS-Widgets', /TikFinity HTTPS-Browser-Widgets|webWidgets/],
  ['TikFinity Chat-URL-Feld', /pfTikChatUrl|TikFinity Chat-HTTP\/HTTPS/],
  ['TikFinity HTTP-Chat direkt im Chatfenster', /tikfinityChatFrame|Im TikTok-Tab anzeigen/],
  ['TikFinity stabile OBS-URL', /overlay\/tikfinity\//],
  ['Originale Plattform-Logos', /assets\/platforms\/tiktok\.svg|platformIcon\('tiktok'\)/],
  ['Synchronisierte Einstellungen', /syncEnabled|sync\.modules|config:changed/],
  ['Moderationsverlauf', /moderationHistory|renderHistory/],
  ['Co-Host', /renderCohostModule|cohost/],
  ['OBS 4455', /4455/],
  ['Overlay 17777 Runtime', /17777/],
  ['Sarah-Luna Info', /Sarah Luna/],
  ['2.1 Diagnose UI', /Diagnose 2\.1|diagnosticsModule/],
  ['Programmhintergrund', /program-background\.jpg|--program-background/]
  ,['Chatfenster-Bild-Upload', /stChatImageUpload|Eigenes Bild hochladen/]
  ,['Chatbild dauerhaft gespeichert', /dialog:chatBackground|chat-background:reset/]
  ,['Chatbild Vorschau und Anpassung', /chatBackgroundPreview|stChatImageFit|stChatImageDarkness/]
  ,['Lokaler Chat-Icon-Upload', /stLocalIconUpload|dialog:localChatIcon/]
  ,['Lokales Icon automatisch 128 × 128', /LOCAL_CHAT_ICON_SIZE|128 × 128/]
  ,['Lokales Icon im OBS-Overlay', /assets\/custom\/local-chat-icon\.png/]
];
const combined = `${app}\n${html}\n${css}\n${v21}\n${main}\n${preload}`;
const failed = checks.filter(([,regex]) => !regex.test(combined)).map(([name]) => name);
if (failed.length) {
  console.error('UI-Vertrag nicht erfüllt:');
  for (const name of failed) console.error(`- ${name}`);
  process.exit(1);
}
assert.ok(app.length > 40000, 'Renderer app.js unerwartet klein.');
console.log(`Batto OBS Tool 2.1 UI contract: OK (${checks.length} Prüfungen, ${app.length} bytes Renderer)`);
