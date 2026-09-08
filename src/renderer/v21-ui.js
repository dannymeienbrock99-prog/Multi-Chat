(() => {
  const api21 = window.batto;
  if (!api21) return;

  function safe(fn) { try { return fn(); } catch { return null; } }
  function apply21Appearance() {
    const cfg = safe(() => S.config) || {};
    const appearance = cfg.appearance || {};
    const root = document.documentElement;
    if (appearance.programBackground !== false) root.style.setProperty('--program-background', "url('../assets/program-background.jpg')");
    else root.style.setProperty('--program-background', "url('../assets/HIntergund.png')");
    root.style.setProperty('--background-darkness', String(Math.max(0, Math.min(.9, Number(appearance.backgroundDarkness ?? .28)))));
    document.querySelectorAll('.card,.module-card,.panel-section').forEach((el) => {
      el.style.setProperty('opacity', '1');
    });
  }

  function updateVersionText() {
    const bar = document.querySelector('.statusbar');
    if (bar) bar.innerHTML = bar.innerHTML.replace(/Version\s+1\.0\.0/gi, 'Version 2.1.0').replace(/Version\s+1\.1\.0/gi, 'Version 2.1.0');
    const title = document.querySelector('.brand-title');
    if (title && !title.textContent.includes('2.1')) title.innerHTML = 'CRAZY_BATTO <span>Batto OBS Tool 2.1</span>';
  }

  function ensureTopChips() {
    const host = document.querySelector('.top-status');
    if (!host) return;
    if (!document.querySelector('#ffmpegChip')) {
      const el = document.createElement('span'); el.className = 'chip'; el.id = 'ffmpegChip'; el.innerHTML = '<i></i>FFmpeg'; host.insertBefore(el, host.lastElementChild);
    }
    if (!document.querySelector('#coreChip')) {
      const el = document.createElement('span'); el.className = 'chip ok'; el.id = 'coreChip'; el.innerHTML = '<i></i>Event Core'; host.insertBefore(el, host.lastElementChild);
    }
  }

  function ensureDiagnosticsView() {
    const nav = document.querySelector('#mainNav');
    if (nav && !nav.querySelector('[data-view="diagnostics"]')) {
      const b = document.createElement('button');
      b.className = 'nav-item'; b.dataset.view = 'diagnostics'; b.innerHTML = '<b>◉</b><span>Diagnose 2.1</span>';
      b.onclick = () => setView('diagnostics');
      nav.appendChild(b);
    }
    const content = document.querySelector('#content');
    if (content && !content.querySelector('[data-view-panel="diagnostics"]')) {
      const s = document.createElement('section');
      s.className = 'view module-view'; s.dataset.viewPanel = 'diagnostics';
      s.innerHTML = '<div class="module-head"><div><h1>Diagnose 2.1</h1><p>Health, Event Core, Connectoren, OBS, FFmpeg und Datenbank.</p></div><button data-back-dashboard>← Dashboard</button></div><div class="module-card" id="diagnosticsModule"></div>';
      content.appendChild(s);
      s.querySelector('[data-back-dashboard]').onclick = () => setView('dashboard');
    }
  }

  function stateBadge(label, state, detail = '') {
    const raw = String(state || 'UNKNOWN').toUpperCase();
    const cls = ['CONNECTED','HEALTHY','OPEN','OK'].includes(raw) ? 'ok' : ['ERROR'].includes(raw) ? 'error' : '';
    return `<div class="connection-item"><span class="ico">●</span><div><strong>${esc(label)}</strong><small>${esc(detail || '')}</small></div><span class="conn-state ${cls}">${esc(raw)}</span></div>`;
  }

  async function renderDiagnosticsModule() {
    const el = document.querySelector('#diagnosticsModule');
    if (!el) return;
    const d = await api21.diagnosticsGet();
    const h = d.health || {};
    const connectors = d.connectors || {};
    const ec = d.eventCore || {};
    const bus = ec.bus || {};
    const dedupe = ec.dedupe || {};
    const ag = ec.aggregation || {};
    const ff = d.ffmpeg || {};
    const db = d.database || {};
    const obs = d.obs || {};
    const overlay = d.overlay || {};
    const settings = d.settings || {};
    el.innerHTML =
      section('Gesamtstatus', `<div class="connections">${stateBadge('Settings', settings.validation?.ok ? 'OK' : 'ERROR', settings.validation?.ok ? 'Schema gültig' : `${settings.validation?.errors?.length || 0} Fehler`)}${stateBadge('Overlay Server', overlay.running ? 'CONNECTED' : 'ERROR', `${overlay.host || '127.0.0.1'}:${overlay.port || 17777} · WS ${overlay.wsClients || 0}`)}${stateBadge('OBS', obs.connected ? 'CONNECTED' : obs.state, `${obs.obsVersion || ''} ${obs.currentScene ? '· '+obs.currentScene : ''} ${obs.latencyMs != null ? '· '+obs.latencyMs+' ms' : ''}`)}${stateBadge('FFmpeg', ff.state, `${ff.path || 'nicht erkannt'} ${ff.selectedEncoder ? '· '+ff.selectedEncoder : ''}`)}${stateBadge('Event Core', h.overall === 'ERROR' ? 'ERROR' : 'HEALTHY', `${ec.received || 0} empfangen · ${dedupe.dropped || 0} Duplikate · Queue ${bus.queued || 0}/${bus.maxQueue || 0}`)}${stateBadge('Audit DB', db.state, `${Math.round((db.sizeBytes || 0)/1024)} KB · WAL ${db.wal ? 'an' : 'aus'}`)}</div>`)
      + section('Connectoren', `<div class="connections">${Object.entries(connectors).map(([name,s]) => stateBadge(name, s.state, s.lastError || (s.connectedAt ? `seit ${new Date(s.connectedAt).toLocaleTimeString('de-DE')}` : ''))).join('') || '<small>Keine Connectoren.</small>'}</div>`)
      + section('Event-Core Metriken', `<div class="form-grid four"><div><label>Received</label><input readonly value="${ec.received || 0}"></div><div><label>Invalid</label><input readonly value="${ec.invalid || 0}"></div><div><label>Dedup dropped</label><input readonly value="${dedupe.dropped || 0}"></div><div><label>Aggregated</label><input readonly value="${ag.aggregated || 0}"></div></div>`)
      + section('Abnahmetests', `<div class="toolbar"><button class="primary" id="diagRefresh">Aktualisieren</button><button id="diagObs">OBS Echt-Test</button><button id="diagFfmpeg">FFmpeg erkennen</button><select id="diagEncoder" style="width:auto"><option value="h264_nvenc">NVENC</option><option value="h264_amf">AMF</option><option value="h264_qsv">QSV</option><option value="libx264">CPU / libx264</option></select><button id="diagEncoderTest">Encoder testen</button><button id="diagExport">Diagnose exportieren</button></div><div id="diagResult" class="composer-hint">Tests verwenden die echten Runtime-Services.</div>`)
      + section('Assets', `<div class="composer-hint">Fehlend: ${d.assets?.missing || 0} · Ungültig: ${d.assets?.invalid || 0}</div>`);

    const result = document.querySelector('#diagResult');
    document.querySelector('#diagRefresh').onclick = () => renderDiagnosticsModule();
    document.querySelector('#diagObs').onclick = async () => { const r = await api21.obsTest(); result.textContent = r.ok ? `OBS OK · ${r.obsVersion || ''} · Scene ${r.currentScene || '–'} · ${r.latencyMs} ms` : r.error; await renderDiagnosticsModule(); };
    document.querySelector('#diagFfmpeg').onclick = async () => { const r = await api21.ffmpegDetect(); result.textContent = r.ok ? `FFmpeg erkannt: ${r.status?.version || r.status?.path}` : r.error; await renderDiagnosticsModule(); };
    document.querySelector('#diagEncoderTest').onclick = async () => { const r = await api21.ffmpegTestEncoder(document.querySelector('#diagEncoder').value); result.textContent = r.ok ? `Encoder ${r.encoder} erfolgreich getestet.` : r.error; await renderDiagnosticsModule(); };
    document.querySelector('#diagExport').onclick = async () => { const r = await api21.diagnosticsExport(); if (r.ok) toast(`Diagnose exportiert: ${r.filePath}`); };
  }

  const baseRenderModule = renderModule;
  renderModule = function renderModule21(view) {
    if (view === 'diagnostics') return renderDiagnosticsModule();
    const out = baseRenderModule(view);
    if (view === 'settings') setTimeout(enhanceSettings, 0);
    return out;
  };

  function enhanceSettings() {
    const el = document.querySelector('#settingsModule');
    if (!el || el.querySelector('#settings21')) return;
    const cfg = S.config || {};
    const sync = cfg.sync || {};
    const modules = sync.modules || {};
    const wrap = document.createElement('div');
    wrap.id = 'settings21';
    wrap.innerHTML =
      section('Settings Service 2.1', `<div class="form-grid"><div><label>Suche in Einstellungen</label><input id="stSearch21" placeholder="z. B. OBS, TTS, Port, CNG, FFmpeg"></div><div><label>Programmhintergrund Abdunklung</label><input id="stBgDark21" type="range" min="0" max="0.8" step="0.02" value="${cfg.appearance?.backgroundDarkness ?? .28}"></div></div><label class="check"><input id="stBg21" type="checkbox" ${cfg.appearance?.programBackground !== false ? 'checked' : ''}> Hochgeladenes CRAZY_BATTO-Programmhintergrundbild verwenden</label><div class="toolbar"><button id="stTest21">Testen</button><button class="primary" id="stApply21">Anwenden</button><button id="stDiscard21">Verwerfen</button><button id="stResetGeneral21">Allgemein auf Standard</button><button id="stResetNetwork21">Netzwerk auf Standard</button></div><div id="stResult21" class="composer-hint">Änderungen werden erst durch Anwenden persistent.</div>`)
      + section('Automatische Synchronisierung', `<label class="check"><input id="syncEnabled21" type="checkbox" ${sync.enabled !== false ? 'checked' : ''}> Modul-Synchronisierung aktiviert</label><div class="form-grid four">${Object.keys(modules).map((name) => `<label class="check"><input data-sync21="${esc(name)}" type="checkbox" ${modules[name] !== false ? 'checked' : ''}> ${esc(name)}</label>`).join('')}</div><p>Eine angewendete Einstellung wird als gemeinsame Source of Truth an die laufenden Module verteilt.</p>`)
      + section('Info', `<div style="padding:18px;text-align:center;font-size:16px;font-weight:800;color:#dff6ff;text-shadow:0 0 14px rgba(0,174,255,.35)">Ich danke Dir Für alles Sarah Luna Ich hab Dich Lieb Dein Bruder Crazy_Batto</div>`);
    el.prepend(wrap);

    const search = document.querySelector('#stSearch21');
    search.oninput = () => {
      const q = search.value.trim().toLowerCase();
      el.querySelectorAll('.panel-section').forEach((s) => { s.style.display = !q || s.textContent.toLowerCase().includes(q) ? '' : 'none'; });
    };
    document.querySelector('#stBgDark21').oninput = (e) => document.documentElement.style.setProperty('--background-darkness', e.target.value);
    document.querySelector('#stBg21').onchange = apply21Appearance;
    document.querySelector('#stTest21').onclick = async () => {
      const http = await api21.settingsTest('http'); const general = await api21.settingsTest('general'); const health = await api21.healthGet();
      document.querySelector('#stResult21').textContent = http.ok && general.ok ? `Settings gültig · Health ${health.overall}` : `Fehler: ${[...(http.errors || []), ...(general.errors || [])].map((x) => x.message).join(' | ')}`;
    };
    document.querySelector('#stApply21').onclick = async () => {
      const nextModules = { ...modules }; document.querySelectorAll('[data-sync21]').forEach((x) => { nextModules[x.dataset.sync21] = x.checked; });
      const patch = { appearance: { ...S.config.appearance, programBackground: document.querySelector('#stBg21').checked, backgroundDarkness: Number(document.querySelector('#stBgDark21').value) }, sync: { ...sync, enabled: document.querySelector('#syncEnabled21').checked, modules: nextModules } };
      const r = await api21.settingsDraft(patch); if (!r.validation.ok) return toast(r.validation.errors.map((x) => x.message).join(' | '), true);
      const applied = await api21.settingsApply(); if (!applied.ok) return toast('Einstellungen konnten nicht angewendet werden.', true);
      S.config = applied.config; apply21Appearance(); await refresh(); renderSettingsModule(); toast('2.1 Einstellungen angewendet.');
    };
    document.querySelector('#stDiscard21').onclick = async () => { await api21.settingsDiscard(); await refresh(); renderSettingsModule(); toast('Nicht angewendete Änderungen verworfen.'); };
    document.querySelector('#stResetGeneral21').onclick = async () => { if (!confirm('Allgemeine Einstellungen wirklich auf Standard setzen?')) return; await api21.resetConfig('general'); await refresh(); renderSettingsModule(); };
    document.querySelector('#stResetNetwork21').onclick = async () => { if (!confirm('Overlay/Netzwerk wirklich auf Standard 127.0.0.1:17777 setzen?')) return; await api21.resetConfig('http'); await refresh(); renderSettingsModule(); };
  }

  const baseSettings = renderSettingsModule;
  renderSettingsModule = function renderSettingsModule21() {
    const out = baseSettings();
    setTimeout(enhanceSettings, 0);
    return out;
  };

  function updateFfmpegChip(status) {
    const chip = document.querySelector('#ffmpegChip'); if (!chip) return;
    chip.className = `chip ${status?.state === 'CONNECTED' ? 'ok' : status?.state === 'ERROR' ? 'error' : 'warn'}`;
    chip.innerHTML = `<i></i>FFmpeg ${status?.selectedEncoder || ''}`;
  }
  function updateCoreChip(status) {
    const chip = document.querySelector('#coreChip'); if (!chip) return;
    chip.className = `chip ${status?.overall === 'ERROR' ? 'error' : status?.overall === 'DEGRADED' ? 'warn' : 'ok'}`;
    chip.innerHTML = `<i></i>Core ${status?.overall || 'HEALTHY'}`;
  }

  ensureDiagnosticsView(); ensureTopChips(); updateVersionText(); apply21Appearance();
  api21.ffmpegStatus().then(updateFfmpegChip).catch(() => {});
  api21.healthGet().then(updateCoreChip).catch(() => {});
  api21.onFfmpegStatus?.((s) => { updateFfmpegChip(s); if (S.view === 'diagnostics') renderDiagnosticsModule(); });
  api21.onHealthStatus?.((s) => { updateCoreChip(s); if (S.view === 'diagnostics') renderDiagnosticsModule(); });
  api21.onConfigChanged?.((cfg) => { S.config = cfg; apply21Appearance(); });
})();
