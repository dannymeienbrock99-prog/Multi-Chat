const api = window.batto;
const detached = new URLSearchParams(location.search).get("detached") === "1";

const S = {
  config: null, messages: [], logs: [], moderation: {}, adapters: {}, overlay: null,
  tab: "all", contextUser: null, settingsPage: "multiChat"
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v="") => String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const time = (iso) => { const d=new Date(iso); return Number.isNaN(d.getTime())?"":d.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"}); };

function toast(msg, error=false) {
  const el=$("#toast"); el.textContent=msg; el.classList.toggle("error",error); el.hidden=false;
  clearTimeout(toast.t); toast.t=setTimeout(()=>el.hidden=true,3200);
}

function count(p){ return p==="all" ? S.messages.length : S.messages.filter(m=>m.platform===p).length; }

function renderTabs(){
  const tabs=[["all","Alle"],["twitch","Twitch"],["tiktok","TikTok"],["cng","CNG"],["youtube","YouTube"]];
  $("#platformTabs").innerHTML=tabs.map(([id,n])=>`<button data-tab="${id}" class="${S.tab===id?"active":""}">${n} ${count(id)}</button>`).join("");
  $$("#platformTabs button").forEach(b=>b.onclick=()=>{S.tab=b.dataset.tab;renderTabs();renderMessages();});
}

function renderMessages(){
  const rows=S.tab==="all"?S.messages:S.messages.filter(m=>m.platform===S.tab);
  if(!rows.length){ $("#chatList").innerHTML='<div class="empty-state"><strong>Noch keine Nachrichten</strong><span>AxelChat verbinden oder eine Testnachricht senden.</span></div>'; return; }
  $("#chatList").innerHTML=rows.map(m=>`
    <article class="message-row ${m.filterHit?"filter-hit":""}">
      <div class="avatar">${esc((m.displayName||m.username||"?").slice(0,2).toUpperCase())}</div>
      <div class="message-main">
        <div class="message-meta">
          <span class="username" data-user="${esc(m.username)}" data-platform="${esc(m.platform)}">${esc(m.displayName||m.username)}</span>
          <span class="platform-tag">${esc(m.platform)}</span>${m.moderator?'<span class="platform-tag">MOD</span>':""}
        </div>
        <div class="message-text">${esc(m.message)}</div>
      </div>
      <time class="message-time">${time(m.timestamp)}</time>
    </article>`).join("");
  $$(".username").forEach(el=>el.oncontextmenu=e=>{
    e.preventDefault(); S.contextUser={username:el.dataset.user,platform:el.dataset.platform};
    const menu=$("#contextMenu"); menu.hidden=false; menu.style.left=`${Math.min(e.clientX,innerWidth-230)}px`; menu.style.top=`${Math.min(e.clientY,innerHeight-280)}px`;
  });
  if(S.config?.multiChat?.autoScroll) $("#chatList").scrollTop=$("#chatList").scrollHeight;
}

function renderModeration(){
  const t={moderators:0,muted:0,blocked:0};
  Object.values(S.moderation||{}).forEach(x=>{t.moderators+=x.moderators?.length||0;t.muted+=x.muted?.length||0;t.blocked+=x.blocked?.length||0;});
  $("#moderationSummary").innerHTML=`<div><span>Moderatoren</span><strong>${t.moderators}</strong></div><div><span>Stummgeschaltet</span><strong>${t.muted}</strong></div><div><span>Blockiert</span><strong>${t.blocked}</strong></div>`;
}

function renderLogs(){
  $("#miniLog").innerHTML=(S.logs||[]).slice(-7).reverse().map(x=>`<div>${time(x.timestamp)} · ${esc(x.category)} · ${esc(x.message)}</div>`).join("")||"<div>Noch keine Aktivität.</div>";
}

function renderConnection(){
  const a=S.adapters?.axelchat||{}, connected=!!a.connected;
  $("#axelDot").classList.toggle("ok",connected); $("#axelStatusText").textContent=connected?"Verbunden":(a.state||"Nicht verbunden");
  $("#axelConnectBtn").textContent=connected?"Trennen":"Verbinden";
  $("#serverStatus").textContent=S.overlay?.running?`HTTP ${S.overlay.port} · OK`:"HTTP · Aus"; $("#serverStatus").classList.toggle("ok",!!S.overlay?.running);
  const host=S.overlay?.host||S.config?.http?.host||"127.0.0.1", port=S.overlay?.port||S.config?.http?.port||8787;
  $("#overlayUrl").textContent=`http://${host}:${port}/overlay/chat`;
}
function renderAll(){renderTabs();renderMessages();renderModeration();renderLogs();renderConnection();}

async function moderate(action){
  if(!S.contextUser)return;
  let reason="";
  if(action==="mute"&&S.config.moderation.askReasonForMute) reason=prompt("Grund für Stummschaltung:","")||"";
  if(action==="block"&&S.config.moderation.askReasonForBlock) reason=prompt("Grund für Blockierung:","")||"";
  const r=await api.moderate({...S.contextUser,action,reason,resultMode:"local"});
  $("#contextMenu").hidden=true;
  if(!r.ok)return toast(r.error||"Moderation fehlgeschlagen",true);
  const fresh=await api.getState(); S.moderation=fresh.moderation; S.logs=fresh.logs; renderModeration();renderLogs();
  toast(`${S.contextUser.username}: ${action} – lokal protokolliert`);
}

const pages=[["general","Allgemein"],["multiChat","Multi-Chat"],["moderation","Moderation"],["filters","Chat-Filter"],["chatDesign","Chat-Design"],["platforms","Plattformen"],["http","OBS / HTTP"],["backup","Backup / Import"],["advanced","Erweitert"]];
const field=(label,id,value,type="text")=>`<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(value??"")}"></div>`;
const check=(label,id,v)=>`<label class="check-row"><input id="${id}" type="checkbox" ${v?"checked":""}>${label}</label>`;

function renderSettingsNav(){
  $("#settingsNav").innerHTML=pages.map(([id,n])=>`<button data-page="${id}" class="${S.settingsPage===id?"active":""}">${n}</button>`).join("");
  $$("#settingsNav button").forEach(b=>b.onclick=()=>{S.settingsPage=b.dataset.page;renderSettingsNav();renderSettings();});
}

function renderSettings(){
  const c=S.config,p=S.settingsPage; let h="";
  if(p==="general")h=`<h2>Allgemein</h2><p>Lokale Grundeinstellungen.</p><div class="config-card">${field("Anzeigename","displayName",c.general.displayName)}${check("Automatisch speichern","autoSave",c.general.autoSave)}</div>`;
  if(p==="multiChat")h=`<h2>Multi-Chat</h2><p>Gemeinsamer Verlauf aller vier Plattformen.</p><div class="config-card">${check("Aktiviert","mcEnabled",c.multiChat.enabled)}${check("Auto-Scroll","autoScroll",c.multiChat.autoScroll)}${check("Zeitstempel","timestamps",c.multiChat.showTimestamp)}${field("Max. Nachrichten","maxMessages",c.multiChat.maxMessages,"number")}</div>`;
  if(p==="moderation")h=`<h2>Moderation</h2><p>Plattformgetrennte lokale Moderation; echte Plattformaktionen werden nicht simuliert.</p><div class="config-card">${check("Aktiviert","modEnabled",c.moderation.enabled)}${check("Grund bei Stumm","muteReason",c.moderation.askReasonForMute)}${check("Grund bei Block","blockReason",c.moderation.askReasonForBlock)}${field("Standarddauer Minuten","muteMinutes",c.moderation.defaultMuteMinutes,"number")}</div>`;
  if(p==="filters")h=`<h2>Chat-Filter</h2><p>Sperrbegriffe ohne Quellcode verwalten.</p><div class="config-card">${check("Aktiviert","filterEnabled",c.filters.enabled)}<div class="field-grid">${field("Neuer Begriff","filterTerm","")}<div class="field"><label>Plattform</label><select id="filterPlatform"><option value="all">Alle</option><option value="twitch">Twitch</option><option value="tiktok">TikTok</option><option value="cng">CNG</option><option value="youtube">YouTube</option></select></div><div class="field"><label>Aktion</label><select id="filterAction"><option value="hide">Ausblenden</option><option value="mark">Markieren</option><option value="mute">Lokal stummschalten</option><option value="block">Lokal blockieren</option></select></div></div><button id="addFilter">Begriff hinzufügen</button><div class="filter-list">${(c.filters.rules||[]).map(r=>`<div class="filter-item"><strong>${esc(r.term)}</strong><small>${esc(r.platform)} · ${esc(r.action)}</small><button data-del-filter="${r.id}">X</button></div>`).join("")}</div></div>`;
  if(p==="chatDesign")h=`<h2>Chat-Design / Hologramm</h2><p>Vorschau und OBS verwenden dieselben Werte.</p><div class="config-card"><div class="field-grid">${field("Schriftart","font",c.chatDesign.fontFamily)}${field("Größe px","fontSize",c.chatDesign.fontSize,"number")}${field("Benutzerfarbe","userColor",c.chatDesign.usernameColor,"color")}${field("Textfarbe","msgColor",c.chatDesign.messageColor,"color")}${field("Glow px","glow",c.chatDesign.glow,"number")}${field("Anzeigedauer s","displaySeconds",c.chatDesign.displaySeconds,"number")}</div></div>`;
  if(p==="platforms")h=`<h2>Plattformen</h2><p>Keine zentrale Token-Wand.</p><div class="config-card"><h3>AxelChat Bridge</h3>${check("Adapter aktiviert","axEnabled",c.platforms.axelchat.enabled)}${check("Automatisch verbinden","axAuto",c.platforms.axelchat.autoConnect)}${field("WebSocket URL","axUrl",c.platforms.axelchat.url)}${field("Reconnect Sekunden","axReconnect",c.platforms.axelchat.reconnectSeconds,"number")}</div><div class="config-card"><div class="filter-item"><strong>Twitch</strong><small>offizieller Adapter noch nicht autorisiert</small><span></span></div><div class="filter-item"><strong>TikTok</strong><small>Bridge-first: AxelChat/TikFinity, Euler optional</small><span></span></div><div class="filter-item"><strong>CNG</strong><small>keine erfundene API</small><span></span></div><div class="filter-item"><strong>YouTube</strong><small>offizieller Adapter vorgesehen</small><span></span></div></div>`;
  if(p==="http")h=`<h2>OBS / HTTP</h2><p>Lokale Browserquelle und Echtzeit-WebSocket.</p><div class="config-card">${check("Server aktiviert","httpEnabled",c.http.enabled)}<div class="field-grid">${field("Host","httpHost",c.http.host)}${field("Port","httpPort",c.http.port,"number")}</div><button id="openOverlaySettings">Chat-Overlay öffnen</button></div>`;
  if(p==="backup")h=`<h2>Backup / Import</h2><p>Lokale Einstellungen sichern und wiederherstellen.</p><div class="config-card"><button id="backupNow">Backup jetzt</button> <button id="backupExport">Export</button> <button id="backupImport">Import</button></div><div id="backupList" class="config-card">Wird geladen …</div>`;
  if(p==="advanced")h=`<h2>Erweitert</h2><p>Technische Interna ohne Pflicht-JSON.</p><div class="config-card"><div class="filter-item"><strong>OAuth</strong><small>Secrets nicht im Klartext anzeigen</small><span></span></div><div class="filter-item"><strong>Hardware-Vollanalyse</strong><small>entfernt</small><span></span></div><div class="filter-item"><strong>Fake-Aktionen</strong><small>nicht zulässig</small><span></span></div></div>`;
  $("#settingsPage").innerHTML=h;

  $("#addFilter")?.addEventListener("click",async()=>{const r=await api.addFilter({term:$("#filterTerm").value,platform:$("#filterPlatform").value,action:$("#filterAction").value});if(!r.ok)return toast(r.error,true);const f=await api.getState();S.config=f.config;renderSettings();});
  $$('[data-del-filter]').forEach(b=>b.onclick=async()=>{await api.removeFilter(b.dataset.delFilter);const f=await api.getState();S.config=f.config;renderSettings();});
  $("#openOverlaySettings")?.addEventListener("click",()=>api.openOverlay("/overlay/chat"));
  $("#backupNow")?.addEventListener("click",async()=>{const r=await api.backupNow();toast("Backup erstellt.");showBackups(r.backups||[]);});
  $("#backupExport")?.addEventListener("click",async()=>{const r=await api.exportConfig();if(r.ok)toast("Config exportiert.");});
  $("#backupImport")?.addEventListener("click",importConfig);
  if(p==="backup")api.listBackups().then(r=>showBackups(r.backups||[]));
}

function showBackups(list){
  const el=$("#backupList"); if(!el)return;
  el.innerHTML=list.length?list.map(b=>`<div class="filter-item"><strong>${esc(b.name)}</strong><small>${new Date(b.mtime).toLocaleString("de-DE")}</small><button data-restore="${esc(b.path)}">Wiederherstellen</button></div>`).join(""):"Noch keine Backups.";
  $$('[data-restore]').forEach(b=>b.onclick=async()=>{if(!confirm("Backup wirklich wiederherstellen?"))return;const r=await api.restoreBackup(b.dataset.restore);if(!r.ok)return toast("Wiederherstellung fehlgeschlagen",true);await refresh();renderSettings();toast("Backup wiederhergestellt.");});
}

async function saveSettings(){
  const c=S.config,p=S.settingsPage; let patch={};
  if(p==="general")patch.general={...c.general,displayName:$("#displayName")?.value||"Crazy_Batto",autoSave:!!$("#autoSave")?.checked};
  if(p==="multiChat")patch.multiChat={...c.multiChat,enabled:!!$("#mcEnabled")?.checked,autoScroll:!!$("#autoScroll")?.checked,showTimestamp:!!$("#timestamps")?.checked,maxMessages:Math.max(100,Number($("#maxMessages")?.value||5000))};
  if(p==="moderation")patch.moderation={...c.moderation,enabled:!!$("#modEnabled")?.checked,askReasonForMute:!!$("#muteReason")?.checked,askReasonForBlock:!!$("#blockReason")?.checked,defaultMuteMinutes:Math.max(1,Number($("#muteMinutes")?.value||10))};
  if(p==="filters")patch.filters={...c.filters,enabled:!!$("#filterEnabled")?.checked};
  if(p==="chatDesign")patch.chatDesign={...c.chatDesign,fontFamily:$("#font")?.value||"Segoe UI",fontSize:Math.max(10,Number($("#fontSize")?.value||20)),usernameColor:$("#userColor")?.value||"#7dd3fc",messageColor:$("#msgColor")?.value||"#ffffff",glow:Math.max(0,Number($("#glow")?.value||0)),displaySeconds:Math.max(2,Number($("#displaySeconds")?.value||12))};
  if(p==="platforms")patch.platforms={...c.platforms,axelchat:{...c.platforms.axelchat,enabled:!!$("#axEnabled")?.checked,autoConnect:!!$("#axAuto")?.checked,url:$("#axUrl")?.value||"ws://127.0.0.1:8356",reconnectSeconds:Math.max(1,Number($("#axReconnect")?.value||5))}};
  if(p==="http")patch.http={...c.http,enabled:!!$("#httpEnabled")?.checked,host:$("#httpHost")?.value||"127.0.0.1",port:Math.max(1024,Math.min(65535,Number($("#httpPort")?.value||8787)))};
  if(Object.keys(patch).length){S.config=await api.saveConfig(patch);const f=await api.getState();S.overlay=f.overlay;S.adapters=f.adapters;renderConnection();toast("Einstellungen gespeichert.");}
}

async function importConfig(){const r=await api.importConfig();if(!r.ok)return;await refresh();renderSettings();toast("Config importiert.");}
async function refresh(){const f=await api.getState();S.config=f.config;S.messages=f.messages||[];S.logs=f.logs||[];S.moderation=f.moderation||{};S.adapters=f.adapters||{};S.overlay=f.overlay;renderAll();}

async function boot(){
  await refresh(); S.tab=S.config.multiChat.defaultTab||"all"; renderAll();
  if(detached){$(".side-panel").style.display="none";$(".workspace").style.gridTemplateColumns="1fr";$("#settingsBtn").style.display="none";$("#detachBtn").textContent="↙";}

  api.onChatMessage(m=>{S.messages.push(m);const max=S.config.multiChat.maxMessages||5000;if(S.messages.length>max)S.messages.splice(0,S.messages.length-max);renderTabs();renderMessages();});
  api.onAdapterStatus(a=>{S.adapters[a.name]=a;renderConnection();});
  api.onModerationEvent(async()=>{const f=await api.getState();S.moderation=f.moderation;S.logs=f.logs;renderModeration();renderLogs();});
  api.onFilterHit(h=>toast(`Chat-Filter: "${h.term}" bei ${h.username}`));
  api.onLogEvent(l=>{S.logs.push(l);renderLogs();});
}

$("#composer").onsubmit=async e=>{e.preventDefault();const text=$("#messageInput").value.trim();if(!text)return;const r=await api.sendMessage({platform:$("#sendPlatform").value,text});if(!r.ok)return toast(r.error,true);$("#messageInput").value="";};
$("#axelConnectBtn").onclick=()=>S.adapters?.axelchat?.connected?api.disconnectAdapter("axelchat"):api.connectAdapter("axelchat");
$("#testMessageBtn").onclick=()=>api.testMessage({text:"Testnachricht – Multi-Chat läuft."});
$("#openOverlayBtn").onclick=()=>api.openOverlay("/overlay/chat");
$("#settingsBtn").onclick=()=>{$("#settings").hidden=false;renderSettingsNav();renderSettings();};
$("#closeSettingsBtn").onclick=()=>$("#settings").hidden=true;
$("#saveSettingsBtn").onclick=saveSettings;
$("#resetPageBtn").onclick=renderSettings;
$("#exportBtn").onclick=async()=>{const r=await api.exportConfig();if(r.ok)toast("Config exportiert.");};
$("#importBtn").onclick=importConfig;
$("#detachBtn").onclick=()=>detached?api.closeDetached():api.detachChat();
$("#contextMenu").onclick=e=>{const a=e.target.closest("button")?.dataset.action;if(a)moderate(a);};
document.addEventListener("click",e=>{if(!e.target.closest("#contextMenu"))$("#contextMenu").hidden=true;});
window.addEventListener("blur",()=>$("#contextMenu").hidden=true);
window.addEventListener("keydown",e=>{if(e.key==="Escape"){$("#contextMenu").hidden=true;$("#settings").hidden=true;}});
boot().catch(e=>{console.error(e);toast(`Startfehler: ${e.message}`,true);});
