'use strict';
// Shared controls edit the same persisted configuration, not independent UI copies.
(() => {
  const caught = fn => async (...args) => {try {return await fn(...args);} catch(e){toast(e.message || String(e),true);}};
  function showResult(result) {toast(result.ok ? 'Aktionskette erfolgreich getestet.' : result.error || 'Mindestens eine Aktion ist fehlgeschlagen.', !result.ok);}
  const baseSettings=renderSettingsModule;
  renderSettingsModule=function(){
    baseSettings();
    const el=document.querySelector('#settingsModule');
    const family=document.createElement('section');family.className='panel-section';family.id='familyBranding';
    family.innerHTML='<h3>Sarah & Michelle</h3><div class="family-logos"><figure><img src="../assets/source/sarah-original.png" alt="Lunacat Sarah"><figcaption>Sarah Luna</figcaption></figure><figure><img src="../assets/source/michelle-original.png" alt="Team Michelle"><figcaption>Team Michelle</figcaption></figure></div>';
    el.append(family);
    const audio=document.createElement('section');audio.className='panel-section';audio.id='settingsAudio';
    const t=S.config.tts;
    audio.innerHTML=`<h3>TTS / Sound-Ausgabe</h3><div class="tts-output-row"><label>Verbundenes Ausgabegerät<select id="settingsTtsOutput"><option value="default">Systemstandard</option></select></label><label>Lautstärke <span id="settingsTtsVolumeLabel">${Math.round(t.volume*100)}%</span><input id="settingsTtsVolume" type="range" min="0" max="100" value="${Math.round(t.volume*100)}"></label></div><div class="toolbar"><button id="settingsTtsRefresh">Geräte erkennen</button><button id="settingsTtsSave" class="primary">Ausgabe speichern & anwenden</button><button id="settingsTtsTest">Test sprechen</button><button id="settingsTtsDetails">Alle TTS-Einstellungen</button></div>`;
    el.append(audio);
    async function devices(){const select=audio.querySelector('#settingsTtsOutput');if(!select)return;const wanted=select.dataset.loaded ? select.value : t.outputDeviceId;const items=await loadAudioOutputs();if(!audio.isConnected)return;select.innerHTML='<option value="default">Systemstandard</option>'+items.filter(x=>x.id!=='default').map(x=>`<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('');if(wanted && ![...select.options].some(x=>x.value===wanted)){const option=new Option((t.outputDeviceLabel || wanted)+' (nicht verbunden)',wanted);select.add(option);}select.value=wanted||'default';select.dataset.loaded='1';}
    devices().catch(()=>{});
    audio.querySelector('#settingsTtsRefresh').onclick=caught(devices);
    audio.querySelector('#settingsTtsVolume').oninput=e=>audio.querySelector('#settingsTtsVolumeLabel').textContent=e.target.value+'%';
    audio.querySelector('#settingsTtsSave').onclick=caught(async()=>{const out=audio.querySelector('#settingsTtsOutput');await saveAndSync({tts:{outputDeviceId:out.value,outputDeviceLabel:out.selectedOptions[0].textContent,volume:Number(audio.querySelector('#settingsTtsVolume').value)/100}},'TTS-Ausgabe gespeichert und synchronisiert.');});
    audio.querySelector('#settingsTtsTest').onclick=caught(()=>playTts({text:'Crazy Batto. Test der ausgewählten Sound-Ausgabe.',outputDeviceId:audio.querySelector('#settingsTtsOutput').value,volume:Number(audio.querySelector('#settingsTtsVolume').value)/100}));
    audio.querySelector('#settingsTtsDetails').onclick=()=>setView('tts');
    const links=document.createElement('section');links.className='panel-section';
    links.innerHTML='<h3>Modul-Einstellungen</h3><p>Alle Bereiche verwenden dieselbe gespeicherte Konfiguration.</p><div class="module-settings-links">'+[...document.querySelectorAll('#mainNav [data-view]')].filter(b=>!['settings','start','dashboard'].includes(b.dataset.view)).map(b=>`<button data-settings-view="${b.dataset.view}">${esc(b.textContent.trim())}</button>`).join('')+'</div>';
    links.querySelectorAll('[data-settings-view]').forEach(b=>b.onclick=()=>setView(b.dataset.settingsView));el.append(links);
  };
  navigator.mediaDevices?.addEventListener?.('devicechange',()=>{document.querySelector('#settingsTtsRefresh')?.click();});

  function advanced(prefix,rule,container){
    const target=document.querySelector(container+' .action-builder');if(!target)return;
    const panel=document.createElement('details');panel.className='bc-advanced';
    panel.innerHTML=`<summary>Bedingungen & Fehlerverhalten</summary><div class="form-grid three"><label>Timeout je Aktion (ms)<input id="${prefix}Timeout" type="number" min="250" max="60000" value="${rule?.timeoutMs ?? 5000}"></label><label>Fehlerbehandlung<select id="${prefix}Failure"><option value="stop-sequence">Aktionskette abbrechen</option><option value="continue">Nächste Aktion ausführen</option><option value="retry-once">Einmal erneut versuchen</option></select></label><label class="check"><input id="${prefix}LiveOnly" type="checkbox" ${rule?.onlyWhenLive?'checked':''}>Nur wenn OBS live ist</label>${prefix==='ev'?`<label>Cooldown (Sekunden)<input id="evCooldown" type="number" min="0" max="86400" value="${rule?.cooldownSeconds ?? 5}"></label>`:''}</div><div class="toolbar"><button id="${prefix}TestChain">Diese Aktionskette testen</button></div>`;
    target.after(panel);document.querySelector('#'+prefix+'Failure').value=rule?.failurePolicy || 'stop-sequence';
    document.querySelector('#'+prefix+'TestChain').onclick=caught(async()=>{const actions=prefix==='cmd'?S.commandDraft:S.eventDraft;if(!actions.length)return toast('Zuerst eine Aktion hinzufügen.',true);showResult(await api.testAutomationSequence({actions,context:{platform:'internal',user:'Crazy_User',username:'Crazy_User',message:'Test',count:1},failurePolicy:document.querySelector('#'+prefix+'Failure').value,timeoutMs:Number(document.querySelector('#'+prefix+'Timeout').value)}));});
    const list=document.querySelector(container+' .list-grid');if(list)list.querySelectorAll('.list-row').forEach((row,i)=>{const button=document.createElement('button');button.textContent='Aktionskette testen';button.onclick=caught(async()=>{const item=(prefix==='cmd'?S.config.commands:S.config.events)[i];showResult(await api.testAutomationSequence({actions:item.actions,context:{platform:item.platform==='all'?'internal':item.platform,user:'Crazy_User',username:'Crazy_User',message:'Test'},failurePolicy:item.failurePolicy,timeoutMs:item.timeoutMs}));});row.lastElementChild.append(button);});
  }
  const baseCommands=renderCommandsModule;
  renderCommandsModule=function(){baseCommands();advanced('cmd',S.commandEdit==null?null:S.config.commands[S.commandEdit],'#commandsModule');};
  const baseEvents=renderEventsModule;
  renderEventsModule=function(){baseEvents();advanced('ev',S.eventEdit==null?null:S.config.events[S.eventEdit],'#eventsModule');};
  const basePools=renderPoolsModule;
  renderPoolsModule=function(){
    basePools();const editing=S.poolEdit==null?null:S.config.mediaPools[S.poolEdit];const picker=document.querySelector('#poolsModule .media-picker');if(!picker)return;
    const labels=[...picker.querySelectorAll('label')],ordered=[...(editing?.mediaIds||[]),...S.config.media.map(x=>x.id)];
    for(const id of [...new Set(ordered)]){const label=labels.find(x=>x.querySelector('input')?.dataset.poolMedia===id);if(label)picker.append(label);}
    let dragging=null;
    for(const label of labels){label.draggable=true;label.ondragstart=()=>{dragging=label;};label.ondragover=e=>e.preventDefault();label.ondrop=e=>{e.preventDefault();if(dragging&&dragging!==label)picker.insertBefore(dragging,label);dragging=null;};const up=document.createElement('button'),down=document.createElement('button');up.textContent='↑';down.textContent='↓';up.type=down.type='button';up.setAttribute('aria-label','Medium nach oben');down.setAttribute('aria-label','Medium nach unten');up.onclick=e=>{e.preventDefault();if(label.previousElementSibling)picker.insertBefore(label,label.previousElementSibling);};down.onclick=e=>{e.preventDefault();if(label.nextElementSibling)picker.insertBefore(label.nextElementSibling,label);};label.append(up,down);}
    const extra=document.createElement('div');extra.className='form-grid';extra.innerHTML=`<label>Wenn eine Datei fehlt<select id="poolMissingPolicy"><option value="skip">Nächste verfügbare Datei verwenden</option><option value="stop">Aktion abbrechen</option></select></label><p>Reihenfolge per Ziehen oder mit ↑ / ↓ ändern. Die gespeicherte Reihenfolge bleibt beim Neustart erhalten.</p>`;picker.after(extra);document.querySelector('#poolMissingPolicy').value=editing?.missingPolicy || 'skip';
    document.querySelector('#poolSave').onclick=caught(async()=>{const name=document.querySelector('#poolName').value.trim(),mediaIds=[...picker.querySelectorAll('[data-pool-media]:checked')].map(x=>x.dataset.poolMedia);if(!name||!mediaIds.length)return toast('Poolname und mindestens ein Medium werden benötigt.',true);const item={...editing,id:editing?.id || cryptoId(),name,mediaIds,mode:document.querySelector('#poolMode').value,volume:Number(document.querySelector('#poolVolume').value)/100,durationSeconds:Number(document.querySelector('#poolDuration').value),avoidRepeat:document.querySelector('#poolAvoid').checked,missingPolicy:document.querySelector('#poolMissingPolicy').value};const items=[...S.config.mediaPools];if(S.poolEdit==null)items.push(item);else items[S.poolEdit]=item;await saveAndSync({mediaPools:items},'Medien-Pool gespeichert.');S.poolEdit=null;renderPoolsModule();});
  };
  const baseConnections=renderConnections;
  renderConnections=function(){baseConnections();const live=document.querySelector('.chat-card .live-pill');if(live){const connected=Object.values(S.adapters || {}).some(x=>x.connected);live.textContent=connected?'Chat verbunden':'Chat bereit';live.classList.toggle('offline',!connected);}const mod=document.querySelector('.moderation-card .live-pill');if(mod){mod.textContent=S.config?.filters?.enabled?'Filter aktiv':'Filter aus';mod.classList.toggle('offline',!S.config?.filters?.enabled);}};
  window.addEventListener('unhandledrejection' ,e=>{console.error(e.reason);toast(e.reason?.message || 'Aktion konnte nicht ausgeführt werden.',true);});
})();
