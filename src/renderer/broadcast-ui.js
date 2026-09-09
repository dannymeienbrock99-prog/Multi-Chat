'use strict';
// The renderer edits drafts only. Scheduling and all automatic sends are owned by Electron Main.
window.BattoBroadcast = (() => {
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const targetNames = { local:'Lokaler Chat / Overlay', cng:'CNG · lokales Overlay', twitch:'Twitch', tiktok:'TikTok', youtube:'YouTube' };
  let api, notify, config, root, selected = null, draft = null, dirty = false, status = { items:[] }, unsubscribe;
  const $ = sel => root.querySelector(sel);
  function fresh() { return { id:crypto.randomUUID(), name:'Neuer Broadcast', enabled:false, intervalSeconds:600, startDelaySeconds:30, intervalMode:'fixed', minIntervalSeconds:300, maxIntervalSeconds:900, mode:'sequence', avoidRepeat:true, onlyWhenLive:false, onlyWhenChatActive:false, activityWindowSeconds:300, minChatMessages:1, retryOnError:false, retryDelaySeconds:30, targets:['cng'], messages:[''] }; }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function input(label, id, value, min, max) { return `<label class="field">${label}<input id="${id}" type="number" min="${min}" max="${max}" required value="${e(value)}"></label>`; }
  function check(label, id, value) { return `<label class="check"><input id="${id}" type="checkbox" ${value?'checked':''}> ${label}</label>`; }
  function ask(text) {
    return new Promise(resolve => {
      const d = document.createElement('dialog'); d.className='confirm-dialog';
      d.innerHTML=`<form method="dialog"><h2>Bitte bestätigen</h2><p>${e(text)}</p><div class="toolbar"><button value="no" autofocus>Abbrechen</button><button class="danger" value="yes">Bestätigen</button></div></form>`;
      document.body.append(d); d.addEventListener('close',()=>{const yes=d.returnValue==='yes';d.remove();resolve(yes);},{once:true});d.showModal();
    });
  }
  async function discardOK() { return !dirty || await ask('Ungespeicherte Änderungen an diesem Broadcast verwerfen?'); }
  function markDirty() { dirty=true; const hint=$('#bcDraftState'); if(hint)hint.textContent='Nicht gespeicherte Änderungen'; }
  function messages() {
    const box=$('#bcMessages'); if(!box)return;
    box.innerHTML=draft.messages.map((text,i)=>`<div class="bc-message-row"><span>${i+1}</span><textarea data-bc-message="${i}" rows="2" maxlength="500" aria-label="Nachricht ${i+1}" placeholder="Deine automatische Nachricht…">${e(text)}</textarea><button type="button" data-bc-remove-message="${i}" aria-label="Nachricht ${i+1} löschen" title="Nachricht löschen">×</button></div>`).join('');
    box.querySelectorAll('[data-bc-message]').forEach(el=>el.oninput=()=>{draft.messages[Number(el.dataset.bcMessage)]=el.value;markDirty();});
    box.querySelectorAll('[data-bc-remove-message]').forEach(el=>el.onclick=()=>{draft.messages.splice(Number(el.dataset.bcRemoveMessage),1);if(!draft.messages.length)draft.messages.push('');markDirty();messages();});
  }
  function read() {
    if(!$('#bcName'))return draft;
    const d={...draft,name:$('#bcName').value,targets:[...root.querySelectorAll('[data-bc-target]:checked')].map(el=>el.dataset.bcTarget)};
    for(const [field,id] of Object.entries({intervalSeconds:'bcInterval',startDelaySeconds:'bcDelay',minIntervalSeconds:'bcMin',maxIntervalSeconds:'bcMax',activityWindowSeconds:'bcActivityWindow',minChatMessages:'bcActivityCount',retryDelaySeconds:'bcRetryDelay'})) d[field]=Number($('#'+id).value);
    for(const [field,id] of Object.entries({enabled:'bcEnabled',avoidRepeat:'bcAvoidRepeat',onlyWhenLive:'bcLive',onlyWhenChatActive:'bcActiveChat',retryOnError:'bcRetry'}))d[field]=$('#'+id).checked;
    d.mode=$('#bcMode').value;d.intervalMode=$('#bcIntervalMode').value;
    d.messages=[...root.querySelectorAll('[data-bc-message]')].map(el=>el.value);
    draft=d;return d;
  }
  function renderEditor() {
    const box=$('#bcEditor');if(!box)return;
    if(!draft){box.innerHTML='<div class="bc-empty"><h2>Deine automatischen Nachrichten</h2><p>Erstelle getrennte Broadcasts mit eigenen Intervallen, Nachrichten und Ausgabezielen.</p><button id="bcFirst" class="primary">+ Neuer Broadcast</button></div>';$('#bcFirst').onclick=newItem;return;}
    const d=draft;
    box.innerHTML=`<form id="bcForm"><div class="section-line"><h2>Broadcast bearbeiten</h2><span id="bcDraftState">${dirty?'Nicht gespeicherte Änderungen':'Gespeichert'}</span></div>
      <div class="form-grid"><label class="field">Name<input id="bcName" maxlength="100" required value="${e(d.name)}"></label><div class="bc-activation">${check('Diesen Broadcast aktivieren','bcEnabled',d.enabled)}</div></div>
      <div class="form-grid three">${input('Intervall (Sekunden)','bcInterval',d.intervalSeconds,30,86400)}${input('Startverzögerung (Sekunden)','bcDelay',d.startDelaySeconds,0,86400)}<label class="field">Intervalltyp<select id="bcIntervalMode"><option value="fixed" ${d.intervalMode!=='random'?'selected':''}>Festes Intervall</option><option value="random" ${d.intervalMode==='random'?'selected':''}>Zufallsintervall</option></select></label></div>
      <div class="form-grid three" id="bcRandomFields">${input('Zufallsintervall ab (Sekunden)','bcMin',d.minIntervalSeconds,30,86400)}${input('Zufallsintervall bis (Sekunden)','bcMax',d.maxIntervalSeconds,30,86400)}<label class="field">Textauswahl<select id="bcMode"><option value="sequence" ${d.mode!=='random'?'selected':''}>Nacheinander</option><option value="random" ${d.mode==='random'?'selected':''}>Zufällig</option></select></label></div>
      <h3>Ausgabeziele</h3><div class="bc-targets">${Object.entries(targetNames).map(([id,name])=>`<label class="check"><input type="checkbox" data-bc-target="${id}" ${d.targets.includes(id)?'checked':''}>${name}</label>`).join('')}</div>
      <p class="composer-hint">CNG wird lokal im Overlay ausgegeben. Externe Chat-Nachrichten benötigen eine verbundene, schreibberechtigte Plattform. Ein Test zeigt das tatsächliche Ergebnis.</p>
      <div class="section-line"><h3>Nachrichten</h3><button type="button" id="bcAddMessage">+ Nachricht</button></div><div id="bcMessages"></div>
      <details class="bc-advanced"><summary>Bedingungen & Fehlerverhalten</summary><div class="form-grid">
      <div>${check('Nur senden, wenn OBS live streamt','bcLive',d.onlyWhenLive)}${check('Nur bei Chat-Aktivität','bcActiveChat',d.onlyWhenChatActive)}${check('Zufällige Nachricht nicht direkt wiederholen','bcAvoidRepeat',d.avoidRepeat)}${check('Fehlgeschlagene Ziele einmal erneut versuchen','bcRetry',d.retryOnError)}</div>
      <div class="form-grid">${input('Aktivitätsfenster (Sekunden)','bcActivityWindow',d.activityWindowSeconds,10,86400)}${input('Mindestens Chat-Nachrichten','bcActivityCount',d.minChatMessages,1,5000)}${input('Erneuter Versuch nach (Sekunden)','bcRetryDelay',d.retryDelaySeconds,5,3600)}</div></div></details>
      <div class="toolbar bc-save"><button type="submit" class="primary" id="bcSave">Speichern & anwenden</button><button type="button" id="bcTest">Jetzt testen</button><button type="button" id="bcDuplicate" ${selected?'':'disabled'}>Duplizieren</button><button type="button" class="danger" id="bcDelete" ${selected?'':'disabled'}>Löschen</button></div><div id="bcTestResult" class="composer-hint" role="status"></div></form>`;
    messages();
    $('#bcForm').oninput=()=>markDirty();
    $('#bcForm').onchange=()=>markDirty();
    $('#bcAddMessage').onclick=()=>{read();if(draft.messages.length>=200)return notify('Höchstens 200 Nachrichten.',true);draft.messages.push('');markDirty();messages();};
    $('#bcForm').onsubmit=async event=>{event.preventDefault();await save();};
    $('#bcTest').onclick=()=>action(async()=>{const result=await api.broadcastTest(read());$('#bcTestResult').textContent=(result.results||[]).map(r=>`${targetNames[r.target]||r.target}: ${r.ok?(r.mode==='cng-local-overlay'?'lokal ausgegeben':'erfolgreich'):r.error}`).join(' · ')||result.error||'';if(!result.ok)notify(result.error||'Nicht alle Ausgabeziele konnten senden.',true);});
    $('#bcDelete').onclick=()=>action(async()=>{if(!selected||!await ask(`„${draft.name}“ dauerhaft löschen? Der zugehörige Zeitplan wird gestoppt.`))return;const r=await api.broadcastDelete(selected);if(!r.ok)throw new Error(r.error);config=r.config;selected=null;draft=null;dirty=false;renderAll();notify('Broadcast gelöscht; Zeitplan gestoppt.');});
    $('#bcDuplicate').onclick=()=>action(async()=>{if(!await discardOK())return;const r=await api.broadcastDuplicate(selected);if(!r.ok)throw new Error(r.error);config=r.config;selected=r.item.id;draft=copy(r.item);dirty=false;renderAll();notify('Kopie angelegt (pausiert).');});
  }
  async function action(fn){try{await fn();}catch(err){notify(err.message||String(err),true);}}
  async function save(){await action(async()=>{const r=await api.broadcastUpsert(read());if(!r.ok)throw new Error(r.error);config=r.config;selected=r.item.id;draft=copy(r.item);dirty=false;renderAll();notify('Broadcast gespeichert; Zeitplan synchronisiert.');});}
  async function newItem(){if(!await discardOK())return;selected=null;draft=fresh();dirty=true;renderAll();$('#bcName')?.focus();}
  function statusText(id){const s=status.items?.find(x=>x.id===id);if(!config.autoBroadcast.enabled)return 'Global pausiert';if(!s?.enabled)return 'Pausiert';if(s.lastError)return s.lastError;if(s.lastResult?.startsWith('Wartet'))return s.lastResult;return s.nextAt?'Nächste Ausgabe '+new Date(s.nextAt).toLocaleTimeString('de-DE'):'Aktiv';}
  function renderList(){const box=$('#bcList');if(!box)return;box.innerHTML=(config.autoBroadcast.items||[]).map(item=>`<button type="button" class="bc-list-item ${selected===item.id?'selected':''}" data-bc-select="${e(item.id)}"><span class="bc-item-name"><i class="bc-dot ${item.enabled?'enabled':''}"></i>${e(item.name)}</span><small>${item.messages.length} Nachrichten · ${item.intervalMode==='random'?'Zufall':item.intervalSeconds+' s'}</small><small data-bc-status="${e(item.id)}">${e(statusText(item.id))}</small></button>`).join('')||'<p class="composer-hint">Noch keine gespeicherten Broadcasts.</p>';
    box.querySelectorAll('[data-bc-select]').forEach(btn=>btn.onclick=async()=>{if(!await discardOK())return;selected=btn.dataset.bcSelect;draft=copy(config.autoBroadcast.items.find(i=>i.id===selected));dirty=false;renderAll();});}
  function renderAll(){if(!root)return;root.innerHTML=`<section class="panel-section bc-master"><div class="section-line"><div><h3>Auto-Chat-Broadcast</h3><p>Getrennte Zeitpläne. Ein gemeinsamer Scheduler.</p></div>${check('Automatische Ausgabe aktiv','bcMaster',config.autoBroadcast.enabled)}</div><div class="form-grid three">${input('Globaler Mindestabstand (Sekunden)','bcGlobalGap',config.autoBroadcast.globalMinGapSeconds??3,0,3600)}${input('Mindestabstand je Plattform (Sekunden)','bcPlatformGap',config.autoBroadcast.platformMinGapSeconds??5,0,3600)}<button id="bcMasterSave">Globale Einstellungen anwenden</button></div></section><div class="bc-layout"><aside class="bc-sidebar"><button class="primary wide" id="bcNew">+ Neuer Broadcast</button><div id="bcList"></div></aside><section class="panel-section bc-editor" id="bcEditor"></section></div>`;
    $('#bcNew').onclick=newItem;$('#bcMasterSave').onclick=()=>action(async()=>{const r=await api.broadcastMaster({enabled:$('#bcMaster').checked,globalMinGapSeconds:Number($('#bcGlobalGap').value),platformMinGapSeconds:Number($('#bcPlatformGap').value)});if(!r.ok)throw new Error(r.error);config=r.config;renderList();notify('Globale Broadcast-Einstellungen angewendet.');});renderList();renderEditor();}
  return { render({el,config:next,api:client,toast}){
    root=el;api=client;notify=toast;config=next;
    if(!unsubscribe)unsubscribe=api.onBroadcastStatus?.(s=>{status=s;if(root?.isConnected)root.querySelectorAll('[data-bc-status]').forEach(x=>{x.textContent=statusText(x.dataset.bcStatus);});});
    if(selected&&!config.autoBroadcast.items?.some(i=>i.id===selected)){selected=null;draft=null;dirty=false;}
    if(dirty&&root.querySelector('#bcForm')){renderList();return;}
    if(selected)draft=copy(config.autoBroadcast.items.find(i=>i.id===selected));
    renderAll();api.broadcastStatus().then(s=>{status=s;renderList();}).catch(()=>{});
  }, isDirty:()=>dirty };
})();
