const api = window.batto;
const detached = new URLSearchParams(location.search).get('detached') === '1';

const S = {
  config: null,
  messages: [],
  logs: [],
  moderation: {},
  history: [],
  adapters: {},
  overlay: null,
  obs: {},
  secrets: {},
  chatTab: 'all',
  modTab: 'twitch',
  contextUser: null,
  view: 'dashboard',
  system: null,
  commandDraft: [],
  commandEdit: null,
  eventDraft: [],
  eventEdit: null,
  poolEdit: null,
  ttsVoices: [],
  audioOutputs: [],
  tikfinityWidgetEdit: null,
  assets: {}
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const time = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
};

function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 4200);
}

const PLATFORM_META = Object.freeze({
  tiktok: { label:'TikTok', logo:'../assets/platforms/tiktok.svg' },
  twitch: { label:'Twitch', logo:'../assets/platforms/twitch.svg' },
  youtube: { label:'YouTube', logo:'../assets/platforms/youtube.svg' },
  cng: { label:'CNG', logo:'https://cng-plattform.com/manus-storage/favicon_e3fccd67.png' },
  internal: { label:'Lokaler Chat / Overlay', logo:'' }
});
const TIKFINITY_WIDGET_TYPES = Object.freeze([
  ['chat','Chat'],['follow','Neue Follower'],['gift','Geschenke'],['like','Likes'],['share','Shares'],
  ['subscribe','Abos'],['goal','Ziele'],['ranking','Rangliste'],['custom','Sonstiges']
]);

function platformKey(platform) {
  const key=String(platform || '').toLowerCase();
  return PLATFORM_META[key] ? key : 'internal';
}

function platformIcon(platform) {
  const key=platformKey(platform);
  const meta=PLATFORM_META[key];
  const logo=key === 'internal' ? String(S.assets?.localChatIcon?.url || '') : meta.logo;
  return logo ? `<img src="${esc(logo)}" alt="${esc(meta.label)}" title="${esc(meta.label)}">` : '•';
}

function normalizeTikFinityWidgetUrl(value) {
  try {
    const url=new URL(String(value || '').trim());
    const hostOk=url.hostname.toLowerCase()==='tikfinity.zerody.one' || url.hostname.toLowerCase().endsWith('.tikfinity.zerody.one');
    if (!['http:','https:'].includes(url.protocol) || !hostOk || !/^\/widget(?:\/|$)/i.test(url.pathname)) return '';
    url.protocol='https:';
    return url.href;
  } catch { return ''; }
}

function inferTikFinityWidgetType(value) {
  const lower=String(value || '').toLowerCase();
  return TIKFINITY_WIDGET_TYPES.find(([type])=>type!=='custom' && lower.includes(type))?.[0] || 'custom';
}

function tikFinityChatWidget() {
  const widgets=S.config?.platforms?.tikfinity?.webWidgets;
  if (!Array.isArray(widgets)) return null;
  return widgets.find((widget)=>widget?.enabled === true && widget.eventType === 'chat' && normalizeTikFinityWidgetUrl(widget.url)) || null;
}

function statusClass(status) {
  return status?.connected ? 'ok' : status?.state === 'error' ? 'error' : '';
}

function setView(view) {
  S.view = view;
  $$('.view').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === view));
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  if (view !== 'dashboard') renderModule(view);
  document.dispatchEvent(new CustomEvent('batto:view',{detail:view}));
}

function overlayBase() {
  const host = S.overlay?.host || S.config?.http?.host || '127.0.0.1';
  const port = S.overlay?.port || S.config?.http?.port || 17777;
  return `http://${host}:${port}`;
}

function section(title, html) {
  return `<section class="panel-section"><h3>${title}</h3>${html}</section>`;
}

function copy(text) {
  api.copyText(text);
  toast('In Zwischenablage kopiert.');
}

function cryptoId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

async function loadProgramBackground() {
    document.documentElement.style.setProperty('--program-background', "url('../assets/marble.jpg')");
  }

function chatBackgroundConfig() {
  return {
    enabled:true, mode:'preset', customPath:'', customName:'', fit:'contain', position:'center', darkness:.82, showInMain:false,
    ...(S.config?.appearance?.chatBackground || {})
  };
}

function cssImageUrl(value) {
  return `url(${JSON.stringify(String(value || '../assets/source/crazy-batto-chat-default.jpg'))})`;
}

function applyChatBackground() {
  const chatBackground = chatBackgroundConfig();
  const asset = S.assets?.chatBackground || { url:'../assets/source/crazy-batto-chat-default.jpg', mode:'preset' };
  const darkness = Math.max(0, Math.min(.95, Number(chatBackground.darkness ?? .82)));
  const lighter = Math.max(0, darkness - .18);
  const root = document.documentElement;
  root.style.setProperty('--chat-background-image', cssImageUrl(asset.url));
  root.style.setProperty('--chat-background-overlay', `linear-gradient(90deg,rgba(5,5,6,${darkness}),rgba(5,5,6,${lighter}))`);
  root.style.setProperty('--chat-background-fit', chatBackground.fit === 'cover' ? 'cover' : 'contain');
  root.style.setProperty('--chat-background-position', ['left center','right center'].includes(chatBackground.position) ? chatBackground.position : 'center');
  document.body.classList.toggle('chat-background-active', chatBackground.enabled !== false && (detached || chatBackground.showInMain === true));
}

function applyAppearance() {
  const appearance = S.config?.appearance || {};
  document.documentElement.style.fontSize = `${Math.round(16 * Number(appearance.uiScale || 1))}px`;
  document.documentElement.style.setProperty('--background-darkness', String(Math.max(0, Math.min(.8, Number(appearance.backgroundDarkness ?? .28)))));
  const bg = $('.bg-watermark');
  if (bg) bg.style.display = appearance.programBackground === false ? 'none' : 'block';
  applyChatBackground();
}

async function saveAndSync(patch, message = '') {
  S.config = await api.saveConfig(patch);
  applyAppearance();
  if (S.config?.sync?.enabled) await refresh(false);
  if (message) toast(message);
  if (S.view !== 'dashboard') renderModule(S.view);
}

function counts(platform) {
  return platform === 'all' ? S.messages.length : S.messages.filter((message) => message.platform === platform).length;
}

function renderChat() {
  const tabs = [['all', 'Alle'], ['tiktok', 'TikTok'], ['twitch', 'Twitch'], ['cng', 'CNG'], ['youtube', 'YouTube']];
  const tikfinityChat=tikFinityChatWidget();
  $('#chatTabs').innerHTML = tabs.map(([id, label]) => `<button class="${S.chatTab === id ? 'active' : ''}" data-chat-tab="${id}">${label}${id === 'tiktok' && tikfinityChat ? ' LIVE' : ''} (${counts(id)})</button>`).join('');
  $$('[data-chat-tab]').forEach((button) => {
    button.onclick = () => { S.chatTab = button.dataset.chatTab; renderChat(); };
  });

  const chatList=$('#chatList');
  if (S.chatTab === 'tiktok' && tikfinityChat) {
    const url=normalizeTikFinityWidgetUrl(tikfinityChat.url);
    chatList.classList.add('tikfinity-chat-active');
    const current=$('#tikfinityChatFrame');
    if (!current || current.dataset.url !== url) {
      chatList.innerHTML = `<div class="tikfinity-chat-embed"><div class="tikfinity-chat-frame-bar"><span><span class="platform-icon tiktok">${platformIcon('tiktok')}</span><b>TikFinity HTTP-Chat</b></span><small id="tikfinityChatFrameState">Quelle wird geladen · nur neue LIVE-Nachrichten</small><button id="tikfinityChatReload" type="button">Neu laden</button></div><iframe id="tikfinityChatFrame" class="tikfinity-chat-frame" data-url="${esc(url)}" src="${esc(url)}" title="TikFinity TikTok LIVE-Chat" loading="eager" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin"></iframe></div>`;
      const frame=$('#tikfinityChatFrame');
      frame.addEventListener('load',()=>{const state=$('#tikfinityChatFrameState');if(state)state.textContent='Quelle geladen · neue LIVE-Nachrichten erscheinen ab jetzt';});
      $('#tikfinityChatReload').onclick=()=>{const state=$('#tikfinityChatFrameState');if(state)state.textContent='Quelle wird neu geladen …';frame.setAttribute('src',frame.dataset.url);};
    }
    return;
  }
  chatList.classList.remove('tikfinity-chat-active');
  const rows = S.chatTab === 'all' ? S.messages : S.messages.filter((message) => message.platform === S.chatTab);
  chatList.innerHTML = rows.length
    ? rows.slice(-250).map((message) => { const platform=platformKey(message.platform); const label=PLATFORM_META[platform].label; return `<div class="chat-row"><span class="chat-time">${time(message.timestamp)}</span><span class="platform-icon ${platform}" aria-label="${label}">${platformIcon(platform)}</span><span class="chat-user ${platform}" data-user="${esc(message.username)}" data-platform="${platform}">${esc(message.displayName || message.username)}</span><span class="chat-text">${esc(message.message)}</span></div>`; }).join('')
    : `<div class="empty"><div><b>Noch keine Nachrichten</b><br><small>TikFinity, AxelChat, Twitch oder YouTube verbinden.</small></div></div>`;

  $$('.chat-user').forEach((el) => {
    el.oncontextmenu = (event) => {
      event.preventDefault();
      S.contextUser = { username: el.dataset.user, platform: el.dataset.platform };
      const menu = $('#contextMenu');
      menu.hidden = false;
      menu.style.left = `${Math.min(event.clientX, innerWidth - 245)}px`;
      menu.style.top = `${Math.min(event.clientY, innerHeight - 270)}px`;
    };
  });
  if (S.config?.multiChat?.autoScroll) $('#chatList').scrollTop = $('#chatList').scrollHeight;
}

function stateFor(platform) {
  return S.moderation?.[platform] || { moderators: [], muted: [], blocked: [] };
}

function modEntries(title, list, kind) {
  return `<div class="mod-box"><div class="mod-title"><span>${title} (${list.length})</span><span>＋</span></div><div class="mod-list">${list.length ? list.map((entry) => `<div class="mod-entry"><div><b>${esc(entry.username)}</b>${entry.reason ? `<small><br>Grund: ${esc(entry.reason)}</small>` : ''}</div><button data-mod-inline="${kind}" data-user="${esc(entry.username)}">⋮</button></div>`).join('') : '<small style="color:var(--muted)">Keine Einträge</small>'}</div></div>`;
}

function actionLabel(action) {
  return ({ addModerator: 'Moderator +', removeModerator: 'Moderator −', mute: 'Stummgeschaltet', unmute: 'Entstummt', block: 'Blockiert', unblock: 'Entblockt' })[action] || action;
}

async function doModeration(user, action, reason = '') {
  if (!user) return;
  if ((action === 'mute' || action === 'block') && !reason) {
    reason = prompt(action === 'mute' ? 'Grund für Stummschaltung:' : 'Grund für Blockierung:', '') || '';
  }
  const result = await api.moderate({ ...user, action, reason, resultMode: 'local' });
  $('#contextMenu').hidden = true;
  if (!result.ok) return toast(result.error || 'Moderation fehlgeschlagen', true);
  await refresh(false);
  renderModeration();
  renderHistory();
  toast(`${user.username}: ${actionLabel(action)}`);
}

function renderModeration() {
  const tabs = ['tiktok', 'twitch', 'cng', 'youtube'];
  $('#modTabs').innerHTML = tabs.map((platform) => `<button data-mod-tab="${platform}" class="${S.modTab === platform ? 'active' : ''}">${platform[0].toUpperCase() + platform.slice(1)}</button>`).join('');
  $$('[data-mod-tab]').forEach((button) => {
    button.onclick = () => { S.modTab = button.dataset.modTab; renderModeration(); };
  });
  const state = stateFor(S.modTab);
  $('#modColumns').innerHTML = modEntries('Moderatoren', state.moderators || [], 'removeModerator') + modEntries('Stummgeschaltet', state.muted || [], 'unmute') + modEntries('Blockiert', state.blocked || [], 'unblock');
  $$('[data-mod-inline]').forEach((button) => { button.onclick = () => doModeration({ username: button.dataset.user, platform: S.modTab }, button.dataset.modInline, ''); });
}

function renderHistory() {
  const filter = $('#historyPlatform')?.value || 'all';
  const rows = S.history.filter((entry) => filter === 'all' || entry.platform === filter).slice(-100).reverse();
  const body = $('#historyBody');
  if (!body) return;
  body.innerHTML = rows.length
    ? rows.map((entry) => `<tr><td>${time(entry.timestamp)}</td><td>${esc(entry.username)}</td><td>${esc(actionLabel(entry.action))}</td><td>${esc(entry.reason || '–')}</td><td title="${esc(entry.lastMessage || '')}">${esc(entry.lastMessage || '–')}</td><td>${esc(entry.executor || '–')}</td><td>${esc(entry.platform)}</td><td class="result-ok">${esc(entry.result || 'Lokal')}</td></tr>`).join('')
    : `<tr><td colspan="8" style="text-align:center;color:var(--muted)">Noch kein Moderationsverlauf.</td></tr>`;
}

function renderHologram() {
  const design = S.config.chatDesign || {};
  $('#holoUserEnabled').checked = design.usernameEnabled !== false;
  $('#holoMessageEnabled').checked = design.messageEnabled !== false;
  $('#holoFont').value = ['Segoe UI', 'Arial', 'Impact', 'Verdana', 'BattoCustom'].includes(design.fontFamily) ? design.fontFamily : 'Segoe UI';
  $('#holoUserColor').value = design.usernameColor || '#00d4ff';
  $('#holoMsgColor').value = design.messageColor || '#ffffff';
  $('#holoGlow').value = Number(design.glow || 10);
  $('#holoOpacity').value = Math.round(Number(design.opacity ?? .92) * 100);
  $('#holoUrl').textContent = `${overlayBase()}/overlay/chat`;
}

async function saveHologram() {
  const old = S.config.chatDesign || {};
  await saveAndSync({ chatDesign: { ...old, usernameEnabled: $('#holoUserEnabled').checked, messageEnabled: $('#holoMessageEnabled').checked, fontFamily: $('#holoFont').value, usernameColor: $('#holoUserColor').value, messageColor: $('#holoMsgColor').value, glow: Number($('#holoGlow').value), opacity: Number($('#holoOpacity').value) / 100 } }, 'Hologramm gespeichert.');
  renderHologram();
}

function renderCohost() {
  const cohost = S.config.cohost || {};
  const places = Math.max(1, Math.min(9, Number(cohost.places || 4)));
  $('#coEnabled').checked = cohost.enabled !== false;
  $('#coPlaces').value = String(places);
  $$('[data-co-format]').forEach((button) => button.classList.toggle('active', button.dataset.coFormat === (cohost.format || 'tiktok')));
  const slots = [...(cohost.slots || [])];
  while (slots.length < places) slots.push({ label: `Gast ${slots.length + 1}`, source: '' });
  $('#coSlotList').innerHTML = slots.slice(0, places).map((slot, index) => `<div class="slot-row"><span>Platz ${index + 1}</span><input data-co-slot="${index}" value="${esc(slot.source || slot.label || '')}" placeholder="Quelle / Gast / Browser-URL"></div>`).join('');
  $('#coPreview').style.gridTemplateColumns = places <= 1 ? '1fr' : places <= 4 ? 'repeat(2,1fr)' : 'repeat(3,1fr)';
  $('#coPreview').innerHTML = slots.slice(0, places).map((slot, index) => `<div class="guest-preview"><div><b>${esc(slot.label || `Gast ${index + 1}`)}</b><br>${slot.source ? '<span>Quelle gesetzt</span>' : '<span>keine Quelle</span>'}</div></div>`).join('');
  $('#coTikUrl').textContent = `${overlayBase()}/cohost/tiktok`;
  $('#coTwUrl').textContent = `${overlayBase()}/cohost/twitch`;
}

async function saveCohost() {
  const old = S.config.cohost || {};
  const places = Number($('#coPlaces').value || 4);
  const format = $('[data-co-format].active')?.dataset.coFormat || 'tiktok';
  const slots = [];
  for (let i = 0; i < places; i++) {
    const value = $(`[data-co-slot="${i}"]`)?.value?.trim() || '';
    slots.push({ label: value && !/^https?:\/\//i.test(value) ? value : `Gast ${i + 1}`, source: /^https?:\/\//i.test(value) ? value : '' });
  }
  await saveAndSync({ cohost: { ...old, enabled: $('#coEnabled').checked, places, format, slots } });
  renderCohost();
}

function connItem(icon, name, sub, status) {
  const cls = status?.connected ? 'ok' : status?.ready ? 'warn' : status?.state === 'error' ? 'error' : '';
  const text = status?.connected ? 'Verbunden' : status?.state || 'Nicht verbunden';
  return `<div class="connection-item"><span class="ico">${icon}</span><div><strong>${name}</strong><small>${sub}</small></div><span class="conn-state ${cls}">${esc(text)}</span></div>`;
}

function renderConnections() {
  const adapters = S.adapters || {};
  const widgets=(S.config?.platforms?.tikfinity?.webWidgets || []).filter((widget)=>widget.enabled);
  $('#connectionList').innerHTML =
    connItem('TF', 'TikFinity Local Bridge', 'ohne Euler/API · lokal', adapters.tikfinity) +
    connItem('↗', 'TikFinity HTTPS-Widgets', `${widgets.length} für OBS gespeichert`, { ready:widgets.length>0, state:widgets.length ? 'konfiguriert' : 'nicht eingerichtet' }) +
    connItem('AX', 'AxelChat WebSocket', 'lokale Chat-Bridge', adapters.axelchat) +
    connItem('TW', 'Twitch Direkt-Chat', 'Nur-Lesen ohne Tokenfeld', adapters.twitch) +
    connItem('YT', 'YouTube Live-Chat', 'Data API', adapters.youtube) +
    connItem('CNG', 'CNG Overlays', S.secrets.cngObsChatUrl ? 'OBS-Chat-URL sicher gespeichert' : 'Ghost/Alert konfiguriert', { connected: true, state: 'overlay-ready' });
  $('#obsChip').className = `chip ${S.obs?.connected ? 'ok' : S.obs?.state === 'error' ? 'error' : ''}`;
  $('#overlayChip').className = `chip ${S.overlay?.running ? 'ok' : 'error'}`;
  $('#overlayChip').innerHTML = `<i></i>Overlay ${S.overlay?.port || S.config?.http?.port || 8787}`;
  $('#tikfinityChip').className = `chip ${adapters.tikfinity?.connected ? 'ok' : widgets.length ? 'warn' : adapters.tikfinity?.state === 'error' ? 'error' : ''}`;
  $('#tikfinityChip').innerHTML = `<i></i>${adapters.tikfinity?.connected ? 'TikFinity Bridge' : widgets.length ? `TikFinity HTTPS (${widgets.length})` : 'TikFinity getrennt'}`;
}

function renderDashboard() {
  renderChat();
  renderModeration();
  renderHistory();
  renderHologram();
  renderCohost();
  renderConnections();
}

function renderModule(view) {
  if (view === 'moderation') renderModerationModule();
  if (view === 'filters') renderFiltersModule();
  if (view === 'hologram') renderHoloModule();
  if (view === 'cohost') renderCohostModule();
  if (view === 'platforms') renderPlatformsModule();
  if (view === 'commands') renderCommandsModule();
  if (view === 'broadcast') renderBroadcastModule();
  if (view === 'hotkeys') renderHotkeysModule();
  if (view === 'events') renderEventsModule();
  if (view === 'media') renderMediaModule();
  if (view === 'pools') renderPoolsModule();
  if (view === 'tts') void renderTtsModule();
  if (view === 'discord') renderDiscordModule();
  if (view === 'backups') renderBackupModule();
  if (view === 'settings') renderSettingsModule();
}

function renderModerationModule() {
  const el = $('#moderationModule');
  const tabs = ['tiktok', 'twitch', 'cng', 'youtube'];
  el.innerHTML = `<div class="tabs">${tabs.map((platform) => `<button data-mm-tab="${platform}" class="${S.modTab === platform ? 'active' : ''}">${platform}</button>`).join('')}</div><div id="mmLists" class="mod-columns"></div>${section('Moderationsverlauf', '<div class="table-scroll"><table><thead><tr><th>Zeit</th><th>Name</th><th>Aktion</th><th>Grund</th><th>Letzte Nachricht</th><th>Durch</th><th>Plattform</th><th>Ergebnis</th></tr></thead><tbody id="mmHistory"></tbody></table></div>')}`;
  const state = stateFor(S.modTab);
  $('#mmLists').innerHTML = modEntries('Moderatoren', state.moderators || [], 'removeModerator') + modEntries('Stummgeschaltet', state.muted || [], 'unmute') + modEntries('Blockiert', state.blocked || [], 'unblock');
  $('#mmHistory').innerHTML = S.history.slice().reverse().map((entry) => `<tr><td>${time(entry.timestamp)}</td><td>${esc(entry.username)}</td><td>${esc(actionLabel(entry.action))}</td><td>${esc(entry.reason || '–')}</td><td>${esc(entry.lastMessage || '–')}</td><td>${esc(entry.executor || '–')}</td><td>${esc(entry.platform)}</td><td class="result-ok">${esc(entry.result)}</td></tr>`).join('') || '<tr><td colspan="8">Noch kein Verlauf.</td></tr>';
  $$('[data-mm-tab]').forEach((button) => { button.onclick = () => { S.modTab = button.dataset.mmTab; renderModerationModule(); }; });
  $$('[data-mod-inline]').forEach((button) => { button.onclick = () => doModeration({ username: button.dataset.user, platform: S.modTab }, button.dataset.modInline, ''); });
}

function renderFiltersModule() {
  const cfg = S.config.filters;
  $('#filtersModule').innerHTML = section('Neuen Filter anlegen', `<div class="form-grid three"><div><label>Begriff</label><input id="fTerm"></div><div><label>Plattform</label><select id="fPlatform"><option value="all">Alle</option><option>tiktok</option><option>twitch</option><option>cng</option><option>youtube</option></select></div><div><label>Aktion</label><select id="fAction"><option value="hide">Ausblenden</option><option value="mark">Markieren</option><option value="mute">Stummschalten</option><option value="block">Blockieren</option></select></div></div><div class="toolbar"><button class="primary" id="fAdd">Hinzufügen</button></div>`) + section('Aktive Filter', `<div class="list-grid">${(cfg.rules || []).map((rule) => `<div class="list-row"><b>${esc(rule.term)}</b><small>${esc(rule.platform)} · ${esc(rule.action)}</small><button data-filter-del="${rule.id}">Löschen</button></div>`).join('') || '<small>Keine Filter.</small>'}</div>`);
  $('#fAdd').onclick = async () => {
    const result = await api.addFilter({ term: $('#fTerm').value, platform: $('#fPlatform').value, action: $('#fAction').value });
    if (!result.ok) return toast(result.error, true);
    await refresh(false); renderFiltersModule(); toast('Filter hinzugefügt.');
  };
  $$('[data-filter-del]').forEach((button) => { button.onclick = async () => { await api.removeFilter(button.dataset.filterDel); await refresh(false); renderFiltersModule(); }; });
}

function renderHoloModule() {
  const d = S.config.chatDesign;
  $('#holoModule').innerHTML = section('Hologramm-Design', `<div class="form-grid three"><div><label>Schriftart</label><select id="mhFont"><option>Segoe UI</option><option>Arial</option><option>Impact</option><option>Verdana</option><option>BattoCustom</option></select></div><div><label>Benutzerfarbe</label><input id="mhUser" type="color" value="${d.usernameColor}"></div><div><label>Nachrichtenfarbe</label><input id="mhMsg" type="color" value="${d.messageColor}"></div><div><label>Schriftgröße</label><input id="mhSize" type="number" min="10" max="80" value="${d.fontSize}"></div><div><label>Glow</label><input id="mhGlow" type="number" min="0" max="60" value="${d.glow}"></div><div><label>Anzeigedauer</label><input id="mhSec" type="number" min="2" max="120" value="${d.displaySeconds}"></div></div><div class="toolbar"><button id="mhImportFont">Eigene Schrift laden</button><button class="primary" id="mhSave">Speichern</button><button id="mhPreview">Overlay öffnen</button></div>`) + section('OBS-Browserquelle', `<div class="url-row"><span>Chat</span><code>${overlayBase()}/overlay/chat</code><button id="mhCopy">URL kopieren</button></div>`);
  $('#mhFont').value = d.fontFamily || 'Segoe UI';
  $('#mhImportFont').onclick = async () => { const result = await api.importFont(); if (result.ok) { S.config = result.config; renderHoloModule(); toast('Schrift importiert.'); } };
  $('#mhSave').onclick = () => saveAndSync({ chatDesign: { ...d, fontFamily: $('#mhFont').value, usernameColor: $('#mhUser').value, messageColor: $('#mhMsg').value, fontSize: Number($('#mhSize').value), glow: Number($('#mhGlow').value), displaySeconds: Number($('#mhSec').value) } }, 'Hologramm gespeichert.');
  $('#mhPreview').onclick = () => api.openOverlay('/overlay/chat');
  $('#mhCopy').onclick = () => copy(`${overlayBase()}/overlay/chat`);
}

function renderCohostModule() {
  const c = S.config.cohost;
  const places = Number(c.places || 4);
  $('#cohostModule').innerHTML = section('Format & Plätze', `<div class="form-grid"><div><label>Format</label><select id="mcFormat"><option value="tiktok">TikTok 1080 × 1920</option><option value="twitch">Twitch 1920 × 1080</option></select></div><div><label>Plätze</label><select id="mcPlaces">${[1, 2, 3, 4, 6, 9].map((n) => `<option ${n === places ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>`) + section('Plätze / Quellen', '<div id="mcSlots" class="list-grid"></div>') + section('OBS-Ausgabe', `<div class="url-row"><span>TikTok</span><code>${overlayBase()}/cohost/tiktok</code><button data-copy-url="${overlayBase()}/cohost/tiktok">Kopieren</button></div><div class="url-row"><span>Twitch</span><code>${overlayBase()}/cohost/twitch</code><button data-copy-url="${overlayBase()}/cohost/twitch">Kopieren</button></div><div class="toolbar"><button class="primary" id="mcSave">Speichern</button><button id="mcTik">TikTok Vorschau</button><button id="mcTw">Twitch Vorschau</button></div>`);
  $('#mcFormat').value = c.format || 'tiktok';
  const slots = [...(c.slots || [])];
  while (slots.length < places) slots.push({ label: `Gast ${slots.length + 1}`, source: '' });
  $('#mcSlots').innerHTML = slots.slice(0, places).map((slot, index) => `<div class="form-grid"><div><label>Platz ${index + 1} Name</label><input data-mc-label="${index}" value="${esc(slot.label || `Gast ${index + 1}`)}"></div><div><label>Quelle / Browser-URL</label><input data-mc-src="${index}" value="${esc(slot.source || '')}"></div></div>`).join('');
  $('#mcPlaces').onchange = async () => { await saveAndSync({ cohost: { ...c, places: Number($('#mcPlaces').value) } }); renderCohostModule(); };
  $('#mcSave').onclick = async () => {
    const count = Number($('#mcPlaces').value);
    const arr = [];
    for (let i = 0; i < count; i++) arr.push({ label: $(`[data-mc-label="${i}"]`)?.value || `Gast ${i + 1}`, source: $(`[data-mc-src="${i}"]`)?.value || '' });
    await saveAndSync({ cohost: { ...c, format: $('#mcFormat').value, places: count, slots: arr } }, 'Co-Host gespeichert.');
    renderCohost();
  };
  $('#mcTik').onclick = () => api.openOverlay('/cohost/tiktok');
  $('#mcTw').onclick = () => api.openOverlay('/cohost/twitch');
  $$('[data-copy-url]').forEach((button) => { button.onclick = () => copy(button.dataset.copyUrl); });
}

function adapterCard(name, title, desc, fields = '') {
  const status = S.adapters[name] || {};
  return section(title, `<p>${desc}</p>${fields}<div class="toolbar"><button class="primary" data-connect="${name}">${status.connected ? 'Verbunden' : 'Verbinden'}</button><button data-disconnect="${name}">Trennen</button><span class="conn-state ${statusClass(status)}">${esc(status.error || status.state || 'idle')}</span></div>`);
}

function renderPlatformsModule() {
  const c = S.config.platforms;
  const cng = c.cng || {};
  const tikfinity = c.tikfinity || {};
  const widgets = Array.isArray(tikfinity.webWidgets) ? tikfinity.webWidgets : [];
  const chatWidget = widgets.find((widget) => widget.eventType === 'chat') || null;
  const editingWidget = widgets.find((widget) => widget.id === S.tikfinityWidgetEdit) || null;
  const widgetTypeOptions = TIKFINITY_WIDGET_TYPES.map(([value,label]) => `<option value="${value}" ${value === (editingWidget?.eventType || 'follow') ? 'selected' : ''}>${label}</option>`).join('');
  const widgetRows = widgets.map((widget) => {
    const obsUrl = `${overlayBase()}/overlay/tikfinity/${encodeURIComponent(widget.id)}`;
    const typeLabel = TIKFINITY_WIDGET_TYPES.find(([value]) => value === widget.eventType)?.[1] || 'Sonstiges';
    return `<article class="tikfinity-widget-row ${widget.enabled ? '' : 'disabled'}">
      <div class="tikfinity-widget-head"><span class="platform-icon tiktok">${platformIcon('tiktok')}</span><div><strong>${esc(widget.name)}</strong><small>${esc(typeLabel)} · ${widget.enabled ? 'aktiv' : 'deaktiviert'}</small></div></div>
      <code class="tikfinity-direct-url" title="${esc(widget.url)}">${esc(widget.url)}</code>
      <div class="url-row"><span>Stabile OBS-URL</span><code>${esc(obsUrl)}</code><button data-tf-copy-obs="${esc(widget.id)}">Kopieren</button></div>
      <div class="toolbar"><button data-tf-open="${esc(widget.id)}">Vorschau</button><button data-tf-copy-direct="${esc(widget.id)}">TikFinity-URL kopieren</button><button data-tf-edit="${esc(widget.id)}">Bearbeiten</button><button data-tf-toggle="${esc(widget.id)}">${widget.enabled ? 'Deaktivieren' : 'Aktivieren'}</button><button class="danger" data-tf-delete="${esc(widget.id)}">Löschen</button></div>
    </article>`;
  }).join('');
  $('#platformsModule').innerHTML =
    adapterCard('tikfinity', 'TikFinity Event-/Chat-Bridge (WebSocket)', 'Für echte Chatnachrichten und Events im Multi-Chat. Hier gehört nur ws:// oder wss:// hinein; TikFinity-HTTPS-Links werden dauerhaft im Bereich darunter gespeichert.', `<div class="form-grid"><div><label>Lokaler WebSocket</label><input id="pfTikUrl" value="${esc(tikfinity.url)}" placeholder="ws://127.0.0.1:21213/"></div><div><label>Reconnect Sekunden</label><input id="pfTikRec" type="number" value="${tikfinity.reconnectSeconds}"></div></div><label class="check"><input id="pfTikAuto" type="checkbox" ${tikfinity.autoConnect ? 'checked' : ''}> Automatisch verbinden</label>`) +
    section('TikFinity Chat-HTTP/HTTPS', `<div class="success-note">Hier den Chat-Link aus TikFinity einfügen. Er wird dauerhaft gespeichert und direkt im <b>TikTok-Tab des Chatfensters</b> geladen. Ein Link mit <b>http://</b> wird automatisch sicher als <b>https://</b> gespeichert.</div><div class="warning-note" style="margin-top:8px">Das TikFinity-Widget zeigt nur neue Nachrichten ab dem Laden der Quelle. Für zusammengeführte Nachrichten, Commands und TTS bleibt die lokale WebSocket-Bridge zusätzlich erforderlich.</div><div style="margin-top:10px"><label>TikFinity Chat-URL</label><input id="pfTikChatUrl" type="url" value="${esc(chatWidget?.url || '')}" placeholder="https://tikfinity.zerody.one/widget/chat?cid=..."></div><div class="toolbar"><button class="primary" id="pfTikChatSave">Chat-Link speichern</button>${chatWidget ? '<button id="pfTikChatShow">Im TikTok-Tab anzeigen</button><button class="danger" id="pfTikChatRemove">Chat-Link entfernen</button>' : ''}<span class="conn-state ${chatWidget?.enabled ? 'ok' : ''}">${chatWidget ? (chatWidget.enabled ? 'Chat-Link gespeichert und im TikTok-Tab aktiv' : 'Chat-Link gespeichert, aber deaktiviert') : 'Chat-Link muss eingefügt werden'}</span></div>${chatWidget ? `<div class="url-row"><span>Stabile OBS-URL</span><code>${esc(`${overlayBase()}/overlay/tikfinity/${encodeURIComponent(chatWidget.id)}`)}</code><button id="pfTikChatCopyObs">Kopieren</button></div>` : ''}`) +
    section('Weitere TikFinity-Widgets – Follower & Co.', `<div class="success-note">Zusätzlich kannst du getrennte Anzeigen für neue Follower, Geschenke, Likes, Shares, Abos, Ziele, Ranglisten und weitere Inhalte speichern.</div><div class="warning-note" style="margin-top:8px">HTTP/HTTPS-Widgets zeigen TikFinity direkt in OBS an. Damit Events zusätzlich Commands, TTS oder Medien im Batto Tool auslösen, muss die WebSocket-Bridge oben verbunden sein.</div><div class="form-grid three" style="margin-top:10px"><div><label>Widget-Name</label><input id="pfTikWidgetName" maxlength="80" value="${esc(editingWidget?.name || '')}" placeholder="z. B. Neue Follower"></div><div><label>Anzeige / Event</label><select id="pfTikWidgetType">${widgetTypeOptions}</select></div><div><label>TikFinity HTTP/HTTPS-URL</label><input id="pfTikWidgetUrl" type="url" value="${esc(editingWidget?.url || '')}" placeholder="https://tikfinity.zerody.one/widget/..."></div></div><label class="check"><input id="pfTikWidgetEnabled" type="checkbox" ${editingWidget?.enabled === false ? '' : 'checked'}> Widget aktiv</label><div class="toolbar"><button class="primary" id="pfTikWidgetSave">${editingWidget ? 'Änderungen speichern' : 'Weiteres Widget hinzufügen'}</button>${editingWidget ? '<button id="pfTikWidgetCancel">Abbrechen</button>' : ''}<span class="conn-state ${widgets.some((widget) => widget.enabled) ? 'ok' : ''}">${widgets.filter((widget) => widget.enabled).length} aktiv · ${widgets.length}/24 gespeichert</span></div><div class="tikfinity-widget-list">${widgetRows || '<small>Noch kein TikFinity-Widget gespeichert.</small>'}</div>`) +
    adapterCard('axelchat', 'AxelChat WebSocket', 'Zusätzliche lokale Chat-Bridge.', `<div class="form-grid"><div><label>WebSocket</label><input id="pfAxUrl" value="${esc(c.axelchat.url)}"></div><div><label>Reconnect Sekunden</label><input id="pfAxRec" type="number" value="${c.axelchat.reconnectSeconds}"></div></div><label class="check"><input id="pfAxAuto" type="checkbox" ${c.axelchat.autoConnect ? 'checked' : ''}> Automatisch verbinden</label>`) +
    adapterCard('twitch', 'Twitch Direkt-Chat', 'Öffentlichen Chat direkt lesen. Kein Tokenfeld; Senden/Plattformmoderation bleiben im Nur-Lesen-Modus deaktiviert.', `<div><label>Channel / Twitch-URL / Dashboard-URL</label><input id="pfTwChannel" value="${esc(c.twitch.channel)}"></div><label class="check"><input id="pfTwAuto" type="checkbox" ${c.twitch.autoConnect ? 'checked' : ''}> Automatisch verbinden</label>`) +
    adapterCard('youtube', 'YouTube Live-Chat', 'Live Chat ID + eigener API Key. Key wird verschlüsselt gespeichert.', `<div class="form-grid"><div><label>Live Chat ID</label><input id="pfYtId" value="${esc(c.youtube.liveChatId)}"></div><div><label>API Key ${S.secrets.youtubeApiKey ? '(gespeichert)' : ''}</label><input id="pfYtKey" type="password" placeholder="${S.secrets.youtubeApiKey ? 'nur zum Ändern eingeben' : 'API Key'}"></div><div><label>Polling ms</label><input id="pfYtPoll" type="number" value="${c.youtube.pollMs}"></div></div><label class="check"><input id="pfYtAuto" type="checkbox" ${c.youtube.autoConnect ? 'checked' : ''}> Automatisch verbinden</label>`) +
    section('CNG Overlays & Chat', `<div class="success-note">CNG stellt öffentliche Guides für Alerts sowie OBS-/Ghost-Chat-Overlays bereit. Tokenisierte OBS-Chat-URLs werden in dieser App ausschließlich lokal verschlüsselt gespeichert.</div><div class="form-grid three" style="margin-top:10px"><div><label>Creator ID</label><input id="cngCreator" value="${esc(cng.creatorId || '')}"></div><div><label>Alert-Overlay URL</label><input id="cngAlert" value="${esc(cng.alertOverlayUrl || '')}"></div><div><label>Ghost-Chat URL</label><input id="cngGhost" value="${esc(cng.ghostChatUrl || '')}"></div></div><div><label>OBS-Chat URL mit obsChatToken ${S.secrets.cngObsChatUrl ? '(verschlüsselt gespeichert)' : ''}</label><input id="cngChatSecret" type="password" placeholder="${S.secrets.cngObsChatUrl ? 'nur zum Ändern eingeben' : 'CNG OBS-Chat URL hier lokal speichern'}"></div><label class="check"><input id="cngLocalBroadcast" type="checkbox" ${cng.localBroadcastEnabled !== false ? 'checked' : ''}> CNG Auto-Broadcast im lokalen Multi-Chat/Overlay erlauben</label><div class="toolbar"><button class="primary" id="cngSave">CNG speichern</button><button id="cngCopyAlert">Alert URL kopieren</button><button id="cngCopyGhost">Ghost URL kopieren</button><button id="cngCopyChat">Gespeicherte OBS-Chat URL kopieren</button><button id="cngOpenAlert">Alert öffnen</button><button id="cngOpenGhost">Ghost öffnen</button><button id="cngClearChat" class="danger">OBS-Chat URL löschen</button></div><div class="warning-note">Die von dir verwendete obsChatToken-URL wird absichtlich nicht in das öffentliche GitHub-Repository geschrieben.</div>`) +
    section('OBS WebSocket 4455', `<div class="form-grid"><div><label>Adresse</label><input id="pfObsUrl" value="${esc(S.config.obs.url)}"></div><div><label>Passwort ${S.secrets.obsPassword ? '(gespeichert)' : ''}</label><input id="pfObsPass" type="password" placeholder="${S.secrets.obsPassword ? 'nur zum Ändern' : 'optional'}"></div></div><label class="check"><input id="pfObsAuto" type="checkbox" ${S.config.obs.autoConnect ? 'checked' : ''}> Automatisch verbinden</label><div class="toolbar"><button class="primary" id="pfObsConnect">Speichern & verbinden</button><button id="pfObsDisconnect">Trennen</button><span class="conn-state ${S.obs.connected ? 'ok' : S.obs.state === 'error' ? 'error' : ''}">${esc(S.obs.error || S.obs.state || 'idle')}</span></div>`) +
    `<div class="toolbar"><button class="primary" id="pfSave">Plattform-Einstellungen speichern</button></div>`;

  $('#pfSave').onclick = async () => { const youtubeKey = $('#pfYtKey').value;
    const enteredTikfinityUrl=$('#pfTikUrl').value.trim();
    const normalizedTikfinityUrl=normalizeTikFinityWidgetUrl(enteredTikfinityUrl);
    let socketUrl=enteredTikfinityUrl;
    let nextWidgets=widgets;
    let importedHttps=false;
    if (normalizedTikfinityUrl) {
      const alreadyStored=widgets.some((widget)=>widget.url===normalizedTikfinityUrl);
      if (!alreadyStored && widgets.length >= 24) return toast('Maximal 24 TikFinity-Widgets sind möglich.', true);
      importedHttps=true;
      socketUrl=/^wss?:\/\//i.test(tikfinity.url || '') ? tikfinity.url : 'ws://127.0.0.1:21213/';
      if (!alreadyStored) {
        const eventType=inferTikFinityWidgetType(normalizedTikfinityUrl);
        const typeLabel=TIKFINITY_WIDGET_TYPES.find(([value])=>value===eventType)?.[1] || 'Widget';
        nextWidgets=[...widgets,{id:`tikfinity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`,name:`TikFinity ${typeLabel}`,eventType,url:normalizedTikfinityUrl,enabled:true}];
      }
    }
    const patch = { platforms: { ...c, tikfinity: { ...tikfinity, url: socketUrl, reconnectSeconds: Number($('#pfTikRec').value), autoConnect: $('#pfTikAuto').checked, webWidgets:nextWidgets }, axelchat: { ...c.axelchat, url: $('#pfAxUrl').value, reconnectSeconds: Number($('#pfAxRec').value), autoConnect: $('#pfAxAuto').checked }, twitch: { ...c.twitch, channel: $('#pfTwChannel').value, autoConnect: $('#pfTwAuto').checked }, youtube: { ...c.youtube, liveChatId: $('#pfYtId').value, pollMs: Number($('#pfYtPoll').value), autoConnect: $('#pfYtAuto').checked } } };
    await saveAndSync(patch);
    if (youtubeKey) await api.youtubeSaveKey(youtubeKey);
    await refresh(false); renderPlatformsModule(); toast(importedHttps ? 'HTTPS-Link erkannt und dauerhaft als TikFinity Browser-Widget gespeichert.' : 'Plattformen gespeichert.');
  };

  $('#pfTikChatSave').onclick = async () => {
    const url=normalizeTikFinityWidgetUrl($('#pfTikChatUrl').value);
    if (!url || !/\/widget\/chat(?:\/|$)/i.test(new URL(url).pathname)) return toast('Bitte den HTTP- oder HTTPS-Link des TikFinity-Chat-Widgets einfügen.', true);
    if (!chatWidget && widgets.length >= 24) return toast('Maximal 24 TikFinity-Widgets sind möglich.', true);
    const newId=widgets.some((widget)=>widget.id==='tikfinity-chat') ? `tikfinity-chat-${Date.now().toString(36)}` : 'tikfinity-chat';
    const item={id:chatWidget?.id || newId,name:'TikFinity Chat',eventType:'chat',url,enabled:true};
    const next=chatWidget ? widgets.map((widget)=>widget.id===chatWidget.id ? item : widget) : [...widgets,item];
    S.tikfinityWidgetEdit=null;
    S.chatTab='tiktok';
    await saveAndSync({platforms:{...c,tikfinity:{...tikfinity,webWidgets:next}}},'TikFinity Chat-Link dauerhaft gespeichert und im TikTok-Tab aktiviert.');
    renderPlatformsModule();
  };
  $('#pfTikChatShow')?.addEventListener('click',()=>{S.chatTab='tiktok';setView('dashboard');renderChat();});
  $('#pfTikChatRemove')?.addEventListener('click',async()=>{if(!confirm('TikFinity Chat-Link wirklich entfernen?'))return;S.tikfinityWidgetEdit=null;await saveAndSync({platforms:{...c,tikfinity:{...tikfinity,webWidgets:widgets.filter((widget)=>widget.id!==chatWidget.id)}}},'TikFinity Chat-Link entfernt.');renderPlatformsModule();});
  $('#pfTikChatCopyObs')?.addEventListener('click',()=>copy(`${overlayBase()}/overlay/tikfinity/${encodeURIComponent(chatWidget.id)}`));

  $('#pfTikWidgetSave').onclick = async () => {
    const name=$('#pfTikWidgetName').value.trim();
    const url=normalizeTikFinityWidgetUrl($('#pfTikWidgetUrl').value);
    if (!name) return toast('Bitte einen Namen für das TikFinity-Widget eingeben.', true);
    if (!url) return toast('Bitte eine gültige HTTP- oder HTTPS-Widget-URL von tikfinity.zerody.one/widget/ einfügen.', true);
    if (!editingWidget && widgets.length >= 24) return toast('Maximal 24 TikFinity-Widgets sind möglich.', true);
    const item={
      id:editingWidget?.id || `tikfinity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`,
      name,
      eventType:$('#pfTikWidgetType').value,
      url,
      enabled:$('#pfTikWidgetEnabled').checked
    };
    const next=editingWidget ? widgets.map((widget)=>widget.id===editingWidget.id ? item : widget) : [...widgets,item];
    const previousEdit=S.tikfinityWidgetEdit;
    S.tikfinityWidgetEdit=null;
    try {
      await saveAndSync({platforms:{...c,tikfinity:{...tikfinity,webWidgets:next}}}, editingWidget ? 'TikFinity HTTPS-Widget aktualisiert.' : 'TikFinity HTTPS-Widget dauerhaft gespeichert.');
      renderPlatformsModule();
    } catch (error) {
      S.tikfinityWidgetEdit=previousEdit;
      toast(error.message || 'TikFinity-Widget konnte nicht gespeichert werden.', true);
    }
  };
  $('#pfTikWidgetCancel')?.addEventListener('click',()=>{S.tikfinityWidgetEdit=null;renderPlatformsModule();});
  $$('[data-tf-edit]').forEach((button)=>{button.onclick=()=>{S.tikfinityWidgetEdit=button.dataset.tfEdit;renderPlatformsModule();};});
  $$('[data-tf-open]').forEach((button)=>{button.onclick=async()=>{const result=await api.openOverlay(`/overlay/tikfinity/${encodeURIComponent(button.dataset.tfOpen)}`);if(!result.ok)toast(result.error,true);};});
  $$('[data-tf-copy-obs]').forEach((button)=>{button.onclick=()=>copy(`${overlayBase()}/overlay/tikfinity/${encodeURIComponent(button.dataset.tfCopyObs)}`);});
  $$('[data-tf-copy-direct]').forEach((button)=>{button.onclick=()=>{const widget=widgets.find((item)=>item.id===button.dataset.tfCopyDirect);if(widget)copy(widget.url);};});
  $$('[data-tf-toggle]').forEach((button)=>{button.onclick=async()=>{const next=widgets.map((widget)=>widget.id===button.dataset.tfToggle ? {...widget,enabled:!widget.enabled} : widget);await saveAndSync({platforms:{...c,tikfinity:{...tikfinity,webWidgets:next}}},'TikFinity-Widget-Status gespeichert.');renderPlatformsModule();};});
  $$('[data-tf-delete]').forEach((button)=>{button.onclick=async()=>{const widget=widgets.find((item)=>item.id===button.dataset.tfDelete);if(!widget || !confirm(`TikFinity-Widget „${widget.name}“ wirklich löschen?`))return;S.tikfinityWidgetEdit=null;await saveAndSync({platforms:{...c,tikfinity:{...tikfinity,webWidgets:widgets.filter((item)=>item.id!==widget.id)}}},'TikFinity-Widget gelöscht.');renderPlatformsModule();};});

  $$('[data-connect]').forEach((button) => { button.onclick = async () => { await $('#pfSave').onclick(); const result = await api.connectAdapter(button.dataset.connect); if (!result.ok) toast(result.error, true); else toast(`${button.dataset.connect} verbunden.`); await refresh(false); renderPlatformsModule(); }; });
  $$('[data-disconnect]').forEach((button) => { button.onclick = async () => { await api.disconnectAdapter(button.dataset.disconnect); await refresh(false); renderPlatformsModule(); }; });

  $('#pfObsConnect').onclick = async () => { const result = await api.obsConnect({ url: $('#pfObsUrl').value, password: $('#pfObsPass').value, autoConnect: $('#pfObsAuto').checked }); if (!result.ok) toast(result.error, true); else toast('OBS verbunden.'); await refresh(false); renderPlatformsModule(); };
  $('#pfObsDisconnect').onclick = async () => { await api.obsDisconnect(); await refresh(false); renderPlatformsModule(); };

  $('#cngSave').onclick = async () => { const cngChatUrl = $('#cngChatSecret').value;
    const creatorId = $('#cngCreator').value.trim();
    const nextCng = { ...cng, creatorId, alertOverlayUrl: $('#cngAlert').value.trim() || `https://cng-plattform.com/alert-overlay?creatorId=${encodeURIComponent(creatorId)}&alertTts=1&chatTts=0`, ghostChatUrl: $('#cngGhost').value.trim() || `https://cng-plattform.com/chat-popout/${encodeURIComponent(creatorId)}?mode=ghost`, localBroadcastEnabled: $('#cngLocalBroadcast').checked };
    await saveAndSync({ platforms: { ...S.config.platforms, cng: nextCng } });
    if (cngChatUrl) {
      const secretResult = await api.cngSaveChatUrl(cngChatUrl);
      if (!secretResult.ok) return toast(secretResult.error, true);
    }
    await refresh(false); renderPlatformsModule(); toast('CNG Einstellungen gespeichert.');
  };
  $('#cngCopyAlert').onclick = async () => { const r = await api.cngCopyUrl('alert'); toast(r.ok ? 'CNG Alert URL kopiert.' : r.error, !r.ok); };
  $('#cngCopyGhost').onclick = async () => { const r = await api.cngCopyUrl('ghost'); toast(r.ok ? 'CNG Ghost URL kopiert.' : r.error, !r.ok); };
  $('#cngCopyChat').onclick = async () => { const r = await api.cngCopyUrl('chat'); toast(r.ok ? 'CNG OBS-Chat URL kopiert.' : r.error, !r.ok); };
  $('#cngOpenAlert').onclick = () => api.cngOpenUrl('alert');
  $('#cngOpenGhost').onclick = () => api.cngOpenUrl('ghost');
  $('#cngClearChat').onclick = async () => { await api.cngClearChatUrl(); await refresh(false); renderPlatformsModule(); toast('CNG OBS-Chat URL gelöscht.'); };
}

function actionSummary(action) {
  const type = action.type || 'unknown';
  if (type === 'tts') return `TTS: ${action.text || ''}`;
  if (type === 'overlay') return `Overlay ${action.eventType || 'custom'}: ${action.text || ''}`;
  if (type === 'mediaPool') return `Medien-Pool: ${(S.config.mediaPools || []).find((p) => p.id === action.poolId)?.name || action.poolId}`;
  if (type === 'media') return `Medium: ${(S.config.media || []).find((m) => m.id === action.mediaId)?.name || action.mediaId}`;
  if (type === 'hotkey') return `Hotkey ${action.process}: ${action.keys}`;
  if (type === 'discord') return `Discord: ${action.text || ''}`;
  if (type === 'chat') return `Chat ${action.platform || 'same'}: ${action.text || ''}`;
  if (type === 'delay') return `Pause ${action.ms || 0} ms`;
  return type;
}

function actionBuilderHtml(prefix, actions) {
  const mediaOptions = (S.config.media || []).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  const poolOptions = (S.config.mediaPools || []).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  return `<div class="action-builder"><div class="form-grid four"><div><label>Aktion</label><select id="${prefix}Type"><option value="tts">TTS</option><option value="mediaPool">Medien-Pool</option><option value="media">Medium</option><option value="overlay">Overlay</option><option value="hotkey">Hotkey</option><option value="discord">Discord</option><option value="chat">Chat-Antwort</option><option value="delay">Pause</option></select></div><div><label>Text / Overlay-Text</label><input id="${prefix}Text" placeholder="Danke {user}! / {nickname}"></div><div><label>Zielplattform</label><select id="${prefix}TargetPlatform"><option value="same">Gleiche Plattform</option><option value="local">Lokal</option><option value="cng">CNG</option><option value="twitch">Twitch</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option></select></div><div><label>Overlay Event</label><input id="${prefix}EventType" value="custom"></div><div><label>Medien-Pool</label><select id="${prefix}Pool"><option value="">–</option>${poolOptions}</select></div><div><label>Medium</label><select id="${prefix}Media"><option value="">–</option>${mediaOptions}</select></div><div><label>Zielprozess</label><input id="${prefix}Process" placeholder="game"></div><div><label>Hotkey / Pause ms</label><input id="${prefix}Value" placeholder="^+{F1} oder 1000"></div></div><div class="toolbar"><button id="${prefix}AddAction">Aktion hinzufügen</button></div><div class="action-list">${actions.map((action, index) => `<div class="action-chip"><div><b>${esc(action.type)}</b><br><small>${esc(actionSummary(action))}</small></div><button data-${prefix.toLowerCase()}-action-del="${index}">Entfernen</button></div>`).join('') || '<small>Noch keine Aktion.</small>'}</div></div>`;
}

function readAction(prefix) {
  const type = $(`#${prefix}Type`).value;
  if (type === 'tts') return { type, text: $(`#${prefix}Text`).value };
  if (type === 'overlay') return { type, eventType: $(`#${prefix}EventType`).value || 'custom', text: $(`#${prefix}Text`).value };
  if (type === 'mediaPool') return { type, poolId: $(`#${prefix}Pool`).value };
  if (type === 'media') return { type, mediaId: $(`#${prefix}Media`).value };
  if (type === 'hotkey') return { type, process: $(`#${prefix}Process`).value, keys: $(`#${prefix}Value`).value };
  if (type === 'discord') return { type, text: $(`#${prefix}Text`).value };
  if (type === 'chat') return { type, platform: $(`#${prefix}TargetPlatform`).value, text: $(`#${prefix}Text`).value };
  if (type === 'delay') return { type, ms: Math.max(0, Number($(`#${prefix}Value`).value || 0)) };
  return { type };
}

function rerenderActionForm(prefix, render) {
    const ids = prefix === 'cmd' ? ['cmdTrigger','cmdPlatform','cmdCd','cmdEnabled','cmdTimeout','cmdFailure','cmdLiveOnly'] : ['evPlatform','evEventType','evMatch','evMin','evEnabled','evTimeout','evFailure','evLiveOnly','evCooldown'];
    const draft = ids.map(id => { const el = document.getElementById(id); return [id, el.value, el.checked]; });
    render();
    for (const [id, value, checked] of draft) { const el = document.getElementById(id); el.value = value; if (el.type === 'checkbox') el.checked = checked; }
  }
  function renderCommandsModule() {
  const list = S.config.commands || [];
  const editing = S.commandEdit == null ? null : list[S.commandEdit];
  
  $('#commandsModule').innerHTML = section(editing ? 'Command bearbeiten' : 'Neuen Command anlegen', `<div class="form-grid three"><div><label>Command</label><input id="cmdTrigger" value="${esc(editing?.trigger || '')}" placeholder="!discord"></div><div><label>Plattform</label><select id="cmdPlatform"><option value="all">Alle Plattformen</option><option value="tiktok">TikTok</option><option value="twitch">Twitch</option><option value="cng">CNG</option><option value="youtube">YouTube</option><option value="local">Lokal</option></select></div><div><label>Cooldown Sekunden</label><input id="cmdCd" type="number" min="0" value="${editing?.cooldownSeconds ?? 5}"></div></div><label class="check"><input id="cmdEnabled" type="checkbox" ${editing?.enabled === false ? '' : 'checked'}> Aktiviert</label>${actionBuilderHtml('cmd', S.commandDraft)}<div class="toolbar"><button class="primary" id="cmdSave">${editing ? 'Änderungen speichern' : 'Command speichern'}</button><button id="cmdCancel">Entwurf leeren</button></div>`) + section('Commands', `<div class="list-grid">${list.map((cmd, index) => `<div class="list-row"><b>${esc(cmd.trigger)} <small>[${esc(cmd.platform || 'all')}]</small></b><small>${(cmd.actions || []).map(actionSummary).map(esc).join(' · ') || 'Keine Aktion'}</small><div><button data-cmd-edit="${index}">Bearbeiten</button> <button data-cmd-del="${index}">Löschen</button></div></div>`).join('') || '<small>Keine Commands.</small>'}</div>`);
  $('#cmdPlatform').value = editing?.platform || 'all';
  $('#cmdAddAction').onclick = () => { const action = readAction('cmd'); if ((action.type === 'mediaPool' && !action.poolId) || (action.type === 'media' && !action.mediaId)) return toast('Bitte Medium oder Medien-Pool auswählen.', true); S.commandDraft.push(action); rerenderActionForm('cmd', renderCommandsModule); };
  $$('[data-cmd-action-del]').forEach((button) => { button.onclick = () => { S.commandDraft.splice(Number(button.dataset.cmdActionDel), 1); rerenderActionForm('cmd', renderCommandsModule); }; });
  $('#cmdSave').onclick = async () => {
    const trigger = $('#cmdTrigger').value.trim();
    if (!trigger || !S.commandDraft.length) return toast('Command und mindestens eine Aktion werden benötigt.', true);
    const item = { id: editing?.id || cryptoId(), trigger, platform: $('#cmdPlatform').value, cooldownSeconds: Number($('#cmdCd').value || 0), enabled: $('#cmdEnabled').checked, timeoutMs:Number($('#cmdTimeout').value),failurePolicy:$('#cmdFailure').value,onlyWhenLive:$('#cmdLiveOnly').checked, actions: structuredClone(S.commandDraft) };
    const next = [...list];
    if (S.commandEdit == null) next.push(item); else next[S.commandEdit] = item;
    await saveAndSync({ commands: next }, 'Command gespeichert.');
    S.commandDraft = []; S.commandEdit = null; renderCommandsModule();
  };
  $('#cmdCancel').onclick = () => { S.commandDraft = []; S.commandEdit = null; renderCommandsModule(); };
  $$('[data-cmd-edit]').forEach((button) => { button.onclick = () => { S.commandEdit = Number(button.dataset.cmdEdit); S.commandDraft = structuredClone(list[S.commandEdit].actions || []); renderCommandsModule(); }; });
  $$('[data-cmd-del]').forEach((button) => { button.onclick = async () => { const next = list.filter((_item, index) => index !== Number(button.dataset.cmdDel)); await saveAndSync({ commands: next }); S.commandEdit = null; S.commandDraft = []; renderCommandsModule(); }; });
}

function renderBroadcastModule() {
  window.BattoBroadcast.render({el:$('#broadcastModule'),config:S.config,api,toast});
}

function renderHotkeysModule() {
  const list = S.config.hotkeys || [];
  $('#hotkeysModule').innerHTML = section('Hotkey definieren', `<div class="form-grid three"><div><label>Name</label><input id="hkName" placeholder="Spiel-Aktion"></div><div><label>Prozess</label><input id="hkProcess" placeholder="game"></div><div><label>SendKeys</label><input id="hkKeys" placeholder="^+{F1}"></div></div><div class="toolbar"><button class="primary" id="hkAdd">Speichern</button></div><p>Der Zielprozess wird vor dem Tastendruck aktiviert.</p>`) + section('Hotkeys', `<div class="list-grid">${list.map((hotkey, index) => `<div class="list-row"><b>${esc(hotkey.name)}</b><small>${esc(hotkey.process)} · ${esc(hotkey.keys)}</small><button data-hk-del="${index}">Löschen</button></div>`).join('') || '<small>Keine Hotkeys.</small>'}</div>`);
  $('#hkAdd').onclick = async () => { const item = { id: cryptoId(), name: $('#hkName').value, process: $('#hkProcess').value, keys: $('#hkKeys').value }; await saveAndSync({ hotkeys: [...list, item] }, 'Hotkey gespeichert.'); renderHotkeysModule(); };
  $$('[data-hk-del]').forEach((button) => { button.onclick = async () => { await saveAndSync({ hotkeys: list.filter((_item, index) => index !== Number(button.dataset.hkDel)) }); renderHotkeysModule(); }; });
}

function renderEventsModule() {
  const list = S.config.events || [];
  const editing = S.eventEdit == null ? null : list[S.eventEdit];
  
  $('#eventsModule').innerHTML = section(editing ? 'Event bearbeiten' : 'Neue Event-Regel', `<div class="form-grid four"><div><label>Plattform</label><select id="evPlatform"><option value="all">Alle</option><option value="tiktok">TikTok</option><option value="twitch">Twitch</option><option value="cng">CNG</option><option value="youtube">YouTube</option></select></div><div><label>Event</label><select id="evEventType"><option>gift</option><option>follow</option><option>like</option><option>share</option><option>subscribe</option><option>raid</option><option>stream_start</option><option>stream_end</option><option>chat</option><option>custom</option></select></div><div><label>Filter Text / Giftname optional</label><input id="evMatch" value="${esc(editing?.matchText || '')}"></div><div><label>Mindestwert optional</label><input id="evMin" type="number" min="0" value="${editing?.minValue || 0}"></div></div><label class="check"><input id="evEnabled" type="checkbox" ${editing?.enabled === false ? '' : 'checked'}> Aktiviert</label>${actionBuilderHtml('ev', S.eventDraft)}<div class="toolbar"><button class="primary" id="evSave">${editing ? 'Änderungen speichern' : 'Event speichern'}</button><button id="evCancel">Entwurf leeren</button><button id="evTestGift">Gift testen</button><button id="evTestFollow">Follow testen</button></div>`) + section('Event-Regeln', `<div class="list-grid">${list.map((rule, index) => `<div class="list-row"><b>${esc(rule.platform || 'all')} · ${esc(rule.event)}</b><small>${(rule.actions || []).map(actionSummary).map(esc).join(' · ')}</small><div><button data-ev-edit="${index}">Bearbeiten</button> <button data-ev-del="${index}">Löschen</button></div></div>`).join('') || '<small>Keine Regeln.</small>'}</div>`);
  $('#evPlatform').value = editing?.platform || 'tiktok';
  $('#evEventType').value = editing?.event || 'gift';
  $('#evAddAction').onclick = () => { const action = readAction('ev'); if ((action.type === 'mediaPool' && !action.poolId) || (action.type === 'media' && !action.mediaId)) return toast('Bitte Medium oder Medien-Pool auswählen.', true); S.eventDraft.push(action); rerenderActionForm('ev', renderEventsModule); };
  $$('[data-ev-action-del]').forEach((button) => { button.onclick = () => { S.eventDraft.splice(Number(button.dataset.evActionDel), 1); rerenderActionForm('ev', renderEventsModule); }; });
  $('#evSave').onclick = async () => {
    if (!S.eventDraft.length) return toast('Mindestens eine Aktion ist erforderlich.', true);
    const item = { id: editing?.id || cryptoId(), platform: $('#evPlatform').value, event: $('#evEventType').value, matchText: $('#evMatch').value.trim(), minValue: Number($('#evMin').value || 0), enabled: $('#evEnabled').checked, timeoutMs:Number($('#evTimeout').value),failurePolicy:$('#evFailure').value,onlyWhenLive:$('#evLiveOnly').checked,cooldownSeconds:Number($('#evCooldown').value), actions: structuredClone(S.eventDraft) };
    const next = [...list];
    if (S.eventEdit == null) next.push(item); else next[S.eventEdit] = item;
    await saveAndSync({ events: next }, 'Event-Regel gespeichert.');
    S.eventDraft = []; S.eventEdit = null; renderEventsModule();
  };
  $('#evCancel').onclick = () => { S.eventDraft = []; S.eventEdit = null; renderEventsModule(); };
  $('#evTestGift').onclick = () => api.testEvent('gift');
  $('#evTestFollow').onclick = () => api.testEvent('follow');
  $$('[data-ev-edit]').forEach((button) => { button.onclick = () => { S.eventEdit = Number(button.dataset.evEdit); S.eventDraft = structuredClone(list[S.eventEdit].actions || []); renderEventsModule(); }; });
  $$('[data-ev-del]').forEach((button) => { button.onclick = async () => { await saveAndSync({ events: list.filter((_item, index) => index !== Number(button.dataset.evDel)) }); S.eventEdit = null; S.eventDraft = []; renderEventsModule(); }; });
}

function renderMediaModule() {
  const list = S.config.media || [];
  $('#mediaModule').innerHTML = section('Eigene Medien', `<div class="toolbar"><button class="primary" id="mediaAdd">Dateien hinzufügen</button><button id="mediaOverlay">Medien-Overlay öffnen</button></div><p>Unterstützt MP3, WAV, OGG, MP4, WebM, GIF, PNG und JPG.</p><div class="list-grid">${list.map((media) => `<div class="list-row"><b>${esc(media.name)}</b><small>${esc(media.type)}</small><div><button data-media-test="${media.id}">Test</button> <button data-media-del="${media.id}">Löschen</button></div></div>`).join('') || '<small>Noch keine Medien.</small>'}</div>`);
  $('#mediaAdd').onclick = async () => { const result = await api.importMedia(); if (result.ok) { S.config = result.config; renderMediaModule(); toast(`${result.items.length} Medien importiert.`); } };
  $('#mediaOverlay').onclick = () => api.openOverlay('/overlay/media');
  $$('[data-media-test]').forEach((button) => { button.onclick = async () => { await api.testAutomationAction({ type: 'media', mediaId: button.dataset.mediaTest }); toast('Medium an Overlay gesendet.'); }; });
  $$('[data-media-del]').forEach((button) => { button.onclick = async () => { if (!confirm('Medium wirklich löschen?')) return; const result = await api.removeMedia(button.dataset.mediaDel); if (result.ok) { S.config = result.config; renderMediaModule(); } }; });
}

function renderPoolsModule() {
  const pools = S.config.mediaPools || [];
  const editing = S.poolEdit == null ? null : pools[S.poolEdit];
  const selected = new Set(editing?.mediaIds || []);
  $('#poolsModule').innerHTML = section(editing ? 'Medien-Pool bearbeiten' : 'Medien-Pool anlegen', `<div class="form-grid four"><div><label>Name</label><input id="poolName" value="${esc(editing?.name || '')}" placeholder="Gift Sounds"></div><div><label>Modus</label><select id="poolMode"><option value="random">Zufällig</option><option value="sequence">Nacheinander</option></select></div><div><label>Lautstärke</label><div class="range-row"><input id="poolVolume" type="range" min="0" max="100" value="${Math.round(Number(editing?.volume ?? 1) * 100)}"><span id="poolVolumeLabel">${Math.round(Number(editing?.volume ?? 1) * 100)}%</span></div></div><div><label>Max. Anzeige Sekunden (0 = Medienlänge)</label><input id="poolDuration" type="number" min="0" max="300" value="${editing?.durationSeconds || 0}"></div></div><label class="check"><input id="poolAvoid" type="checkbox" ${editing?.avoidRepeat === false ? '' : 'checked'}> Direkte Wiederholung vermeiden</label><div><label>Medien im Pool</label><div class="media-picker">${(S.config.media || []).map((media) => `<label class="media-check"><input type="checkbox" data-pool-media="${media.id}" ${selected.has(media.id) ? 'checked' : ''}> ${esc(media.name)}</label>`).join('') || '<small>Zuerst Medien importieren.</small>'}</div></div><div class="toolbar"><button class="primary" id="poolSave">${editing ? 'Änderungen speichern' : 'Pool anlegen'}</button><button id="poolCancel">Abbrechen</button>${editing ? '<button id="poolTest">Pool testen</button>' : ''}</div>`) + section('Medien-Pools', `<div class="list-grid">${pools.map((pool, index) => `<div class="list-row"><b>${esc(pool.name)}</b><small>${esc(pool.mode)} · ${(pool.mediaIds || []).length} Medien · ${Math.round(Number(pool.volume ?? 1) * 100)}%</small><div><button data-pool-edit="${index}">Bearbeiten</button> <button data-pool-test="${pool.id}">Test</button> <button data-pool-del="${index}">Löschen</button></div></div>`).join('') || '<small>Keine Pools.</small>'}</div>`);
  $('#poolMode').value = editing?.mode || 'random';
  $('#poolVolume').oninput = () => { $('#poolVolumeLabel').textContent = `${$('#poolVolume').value}%`; };
  $('#poolSave').onclick = async () => {
    const mediaIds = $$('[data-pool-media]:checked').map((input) => input.dataset.poolMedia);
    if (!$('#poolName').value.trim() || !mediaIds.length) return toast('Poolname und mindestens ein Medium werden benötigt.', true);
    const item = { id: editing?.id || cryptoId(), name: $('#poolName').value.trim(), mode: $('#poolMode').value, mediaIds, volume: Number($('#poolVolume').value) / 100, durationSeconds: Number($('#poolDuration').value || 0), avoidRepeat: $('#poolAvoid').checked };
    const next = [...pools];
    if (S.poolEdit == null) next.push(item); else next[S.poolEdit] = item;
    await saveAndSync({ mediaPools: next }, 'Medien-Pool gespeichert und synchronisiert.');
    S.poolEdit = null; renderPoolsModule();
  };
  $('#poolCancel').onclick = () => { S.poolEdit = null; renderPoolsModule(); };
  $('#poolTest')?.addEventListener('click', () => api.testAutomationAction({ type: 'mediaPool', poolId: editing.id }));
  $$('[data-pool-edit]').forEach((button) => { button.onclick = () => { S.poolEdit = Number(button.dataset.poolEdit); renderPoolsModule(); }; });
  $$('[data-pool-test]').forEach((button) => { button.onclick = () => api.testAutomationAction({ type: 'mediaPool', poolId: button.dataset.poolTest }); });
  $$('[data-pool-del]').forEach((button) => { button.onclick = async () => { await saveAndSync({ mediaPools: pools.filter((_item, index) => index !== Number(button.dataset.poolDel)) }); S.poolEdit = null; renderPoolsModule(); }; });
}

async function loadAudioOutputs() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'audiooutput').map((device, index) => ({ id: device.deviceId, label: device.label || `Audio-Ausgang ${index + 1}` }));
  } catch {
    return [];
  }
}

let ttsQueue=[],ttsRunning=false;
async function playTts(payload = {}) {
  const limit=Math.max(1,Number(S.config?.tts?.queueLimit || 100));
  if(ttsQueue.length>=limit){toast('TTS-Warteschlange ist voll.',true);return;}
  ttsQueue.push(payload);if(ttsRunning)return;ttsRunning=true;
  try{while(ttsQueue.length){try{await playTtsOnce(ttsQueue.shift());}catch(e){toast(e.message,true);}}}finally{ttsRunning=false;}
}
async function playTtsOnce(payload = {}) {
  const cfg = S.config?.tts || {};
  const result = await api.ttsSynthesize({ text: payload.text, voice: payload.voice || cfg.voice, rate: payload.rate ?? cfg.rate });
  if (!result.ok) {
    if ((!payload.outputDeviceId || payload.outputDeviceId==='default') && (!cfg.outputDeviceId || cfg.outputDeviceId==='default') && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(String(payload.text || ''));
      utterance.rate = Number(payload.rate ?? cfg.rate ?? 1);
      utterance.volume = Number(payload.volume ?? cfg.volume ?? 1);
      await new Promise(resolve=>{utterance.onend=resolve;utterance.onerror=resolve;speechSynthesis.speak(utterance);});
      return;
    }
    return toast(result.error || 'TTS fehlgeschlagen.', true);
  }
  const audio = new Audio(result.url);
  audio.volume = Math.max(0, Math.min(1, Number(payload.volume ?? cfg.volume ?? 1)));
  const sink = payload.outputDeviceId || cfg.outputDeviceId;
  if (sink && sink !== 'default' && typeof audio.setSinkId === 'function') {
    try { await audio.setSinkId(sink); } catch (error) { await api.ttsCleanup(result.path);toast(`TTS-Ausgabegerät konnte nicht gesetzt werden: ${error.message}`, true);return; }
  }
  const cleanup = () => api.ttsCleanup(result.path);
  await new Promise(resolve=>{
    let done=false;const timer=setTimeout(()=>finish(),120000);
    function finish(){if(done)return;done=true;clearTimeout(timer);audio.pause();cleanup();resolve();}
    audio.onended=finish;audio.onerror=finish;
    audio.play().catch(error=>{toast(`TTS Wiedergabe: ${error.message}`,true);finish();});
  });
}

async function renderTtsModule() {
  const t = S.config.tts || {};
  const voiceResult = await api.ttsListVoices();
  if (voiceResult.ok) S.ttsVoices = voiceResult.voices || [];
  S.audioOutputs = await loadAudioOutputs();
  const outputOptions = [`<option value="default">Systemstandard</option>`, ...S.audioOutputs.map((device) => `<option value="${esc(device.id)}">${esc(device.label)}</option>`)].join('');
  const voiceOptions = [`<option value="">Systemstandard</option>`, ...S.ttsVoices.map((voice) => `<option value="${esc(voice.name)}">${esc(voice.name)} (${esc(voice.culture || '')})</option>`)].join('');
  $('#ttsModule').innerHTML = section('Text-to-Speech', `<label class="check"><input id="ttsEnabled" type="checkbox" ${t.enabled ? 'checked' : ''}> TTS aktiviert</label><label class="check"><input id="ttsReadChat" type="checkbox" ${t.readChat ? 'checked' : ''}> Chat automatisch vorlesen</label><div class="form-grid three"><div><label>Stimme</label><select id="ttsVoice">${voiceOptions}</select></div><div><label>Ausgabegerät</label><select id="ttsOutput">${outputOptions}</select></div><div><label>Geschwindigkeit</label><input id="ttsRate" type="number" min="0.5" max="2" step="0.1" value="${t.rate || 1}"></div></div><div><label>Lautstärke</label><div class="range-row"><input id="ttsVol" type="range" min="0" max="100" value="${Math.round(Number(t.volume ?? 1) * 100)}"><span id="ttsVolLabel">${Math.round(Number(t.volume ?? 1) * 100)}%</span></div></div><div><label>Plattformen vorlesen</label><div class="media-picker">${['twitch', 'tiktok', 'cng', 'youtube'].map((platform) => `<label class="media-check"><input type="checkbox" data-tts-platform="${platform}" ${(t.platforms || []).includes(platform) ? 'checked' : ''}> ${platform.toUpperCase()}</label>`).join('')}</div></div><label class="check"><input id="ttsStripUrls" type="checkbox" ${t.stripUrls !== false ? 'checked' : ''}> Links beim Vorlesen vereinfachen</label><div class="toolbar"><button class="primary" id="ttsSave">Speichern & synchronisieren</button><button id="ttsDetect">Geräte neu erkennen</button><button id="ttsChoose">Ausgabegerät auswählen</button><button id="ttsTest">Test sprechen</button></div><div class="success-note">Das ausgewählte Ausgabegerät wird über Chromium Audio Output Routing (setSinkId) verwendet. Die Sprachausgabe wird unter Windows zuerst als WAV erzeugt und danach gezielt auf das gewählte Gerät ausgegeben.</div>`);
  $('#ttsVoice').value = t.voice || '';
  if(t.outputDeviceId && ![...$('#ttsOutput').options].some(o=>o.value===t.outputDeviceId))$('#ttsOutput').add(new Option((t.outputDeviceLabel || t.outputDeviceId)+' (nicht verbunden)',t.outputDeviceId));
  $('#ttsOutput').value=t.outputDeviceId || 'default';
  $('#ttsVol').oninput = () => { $('#ttsVolLabel').textContent = `${$('#ttsVol').value}%`; };
  $('#ttsSave').onclick = async () => {
    const selectedOutput = $('#ttsOutput');
    const platforms = $$('[data-tts-platform]:checked').map((x) => x.dataset.ttsPlatform);
    await saveAndSync({ tts: { ...t, enabled: $('#ttsEnabled').checked, readChat: $('#ttsReadChat').checked, voice: $('#ttsVoice').value, rate: Number($('#ttsRate').value), volume: Number($('#ttsVol').value) / 100, outputDeviceId: selectedOutput.value, outputDeviceLabel: selectedOutput.selectedOptions[0]?.textContent || 'Systemstandard', platforms, stripUrls: $('#ttsStripUrls').checked } }, 'TTS gespeichert und synchronisiert.');
    await renderTtsModule();
  };
  $('#ttsDetect').onclick = () => renderTtsModule();
  $('#ttsChoose').onclick = async () => {
    if (!navigator.mediaDevices?.selectAudioOutput) {
      toast('Die direkte Windows-Auswahl ist in dieser Electron-Version nicht verfügbar. Nutze die erkannten Ausgabegeräte.', true);
      return;
    }
    try {
      const device = await navigator.mediaDevices.selectAudioOutput();
      if (!device?.deviceId) return;
      const select = $('#ttsOutput');
      if (![...select.options].some((option) => option.value === device.deviceId)) {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || 'Ausgewähltes Audiogerät';
        select.append(option);
      }
      select.value = device.deviceId;
      toast(`TTS-Ausgabe gewählt: ${device.label || 'Audiogerät'}`);
    } catch (error) {
      if (error.name !== 'NotAllowedError') toast(`Audiogerät: ${error.message}`, true);
    }
  };
  $('#ttsTest').onclick = () => playTts({ text: 'CRAZY BATTO Multi Chat TTS Test', voice: $('#ttsVoice').value, rate: Number($('#ttsRate').value), volume: Number($('#ttsVol').value) / 100, outputDeviceId: $('#ttsOutput').value });
}

function renderDiscordModule() {
  const d = S.config.discord || {};
  $('#discordModule').innerHTML = section('Discord Webhook', `<label class="check"><input id="dcEnabled" type="checkbox" ${d.enabled ? 'checked' : ''}> Discord aktiviert</label><div class="form-grid"><div><label>Webhook ${S.secrets.discordWebhook ? '(gespeichert)' : ''}</label><input id="dcHook" type="password" placeholder="${S.secrets.discordWebhook ? 'nur zum Ändern eingeben' : 'https://discord.com/api/webhooks/...'}"></div><div><label>Standardtext</label><input id="dcText" value="${esc(d.messageTemplate || 'CRAZY_BATTO ist live!')}"></div></div><div class="toolbar"><button class="primary" id="dcSave">Speichern</button><button id="dcTest">Test senden</button></div>`);
  $('#dcSave').onclick = async () => { if ($('#dcHook').value) await api.discordSaveWebhook($('#dcHook').value); await saveAndSync({ discord: { ...d, enabled: $('#dcEnabled').checked, messageTemplate: $('#dcText').value } }, 'Discord gespeichert.'); await refresh(false); renderDiscordModule(); };
  $('#dcTest').onclick = async () => { const result = await api.discordTest($('#dcText').value); toast(result.ok ? 'Discord Test gesendet.' : result.error, !result.ok); };
}

function renderBackupModule() {
  api.listBackups().then((result) => {
    const list = result.backups || [];
    $('#backupModule').innerHTML = section('Sicherung', `<div class="toolbar"><button class="primary" id="bkNow">Backup jetzt</button><button id="bkExport">Config exportieren</button><button id="bkImport">Config importieren</button></div><div class="list-grid">${list.map((backup) => `<div class="list-row"><b>${esc(backup.name)}</b><small>${new Date(backup.mtime).toLocaleString('de-DE')}</small><button data-bk-restore="${esc(backup.path)}">Wiederherstellen</button></div>`).join('') || '<small>Noch keine Backups.</small>'}</div>`);
    $('#bkNow').onclick = async () => { await api.backupNow(); renderBackupModule(); toast('Backup erstellt.'); };
    $('#bkExport').onclick = () => api.exportConfig();
    $('#bkImport').onclick = async () => { const imported = await api.importConfig(); if (imported.ok) { await refresh(false); renderBackupModule(); toast('Config importiert.'); } };
    $$('[data-bk-restore]').forEach((button) => { button.onclick = async () => { if (!confirm('Backup wiederherstellen?')) return; await api.restoreBackup(button.dataset.bkRestore); await refresh(false); renderBackupModule(); }; });
  });
}

function renderSettingsModule() {
  const g = S.config.general;
  const h = S.config.http;
  const a = S.config.appearance;
  const sync = S.config.sync || { modules: {} };
  const modules = ['platforms', 'commands', 'autoBroadcast', 'events', 'mediaPools', 'tts', 'cng', 'cohost', 'overlays'];
  const chatBackground = chatBackgroundConfig();
  const chatAsset = S.assets?.chatBackground || {};
  const chatImageName = chatBackground.mode === 'custom' ? (chatBackground.customName || 'Eigenes Bild') : 'Crazy_Batto Social-Media-Motiv';
  const chatImageStatus = chatAsset.missing ? 'Eigene Datei fehlt – das Crazy_Batto-Motiv wird ersatzweise angezeigt.' : chatBackground.mode === 'custom' ? 'Eigenes Bild gespeichert' : 'Mitgeliefertes Motiv aus deinem Social-Media-Set';
  const localIconConfig = a.chatIcons?.local || { mode:'default', customPath:'', customName:'' };
  const localIconAsset = S.assets?.localChatIcon || { mode:'default', url:'', name:'Standardpunkt', width:128, height:128 };
  const localIconName = localIconConfig.mode === 'custom' ? (localIconConfig.customName || 'Eigenes Icon') : 'Standardpunkt';
  const localIconStatus = localIconAsset.missing ? 'Die gespeicherte Datei fehlt – vorübergehend wird der Standardpunkt angezeigt.' : localIconConfig.mode === 'custom' ? 'Eigenes Icon aktiv' : 'Noch kein eigenes Icon ausgewählt';
  const localIconPreview = localIconAsset.url ? `<img src="${esc(localIconAsset.url)}" alt="Vorschau Lokaler Chat / Overlay">` : '<span aria-hidden="true">•</span>';
  $('#settingsModule').innerHTML = section('Allgemein', `<div class="form-grid"><div><label>Anzeigename</label><input id="stName" value="${esc(g.displayName)}"></div><div><label>UI-Skalierung</label><input id="stScale" type="number" min="0.8" max="1.4" step="0.05" value="${a.uiScale || 1}"></div></div><label class="check"><input id="stBackground" type="checkbox" ${a.programBackground === false ? '' : 'checked'}> Programm-Hintergrund verwenden</label><div><label>Hintergrund-Abdunklung</label><div class="range-row"><input id="stDarkness" type="range" min="0" max="70" value="${Math.round(Number(a.backgroundDarkness ?? .28) * 100)}"><span id="stDarknessLabel">${Math.round(Number(a.backgroundDarkness ?? .28) * 100)}%</span></div></div>`) + section('Chatfenster-Bild', `<div class="chat-background-settings" id="chatBackgroundSettings"><div class="chat-background-preview" id="chatBackgroundPreview" role="img" aria-label="Vorschau des Chatfenster-Bildes"><span>Vorschau</span></div><div><strong id="chatBackgroundName">${esc(chatImageName)}</strong><p id="chatBackgroundStatus">${esc(chatImageStatus)}</p><div class="toolbar"><button class="primary" id="stChatImageUpload">Eigenes Bild hochladen</button><button id="stChatImagePreset" ${chatBackground.mode === 'preset' ? 'disabled' : ''}>Crazy_Batto-Motiv verwenden</button></div><div class="form-grid three"><label class="check"><input id="stChatImageEnabled" type="checkbox" ${chatBackground.enabled === false ? '' : 'checked'}> Bild im Chatfenster anzeigen</label><label class="check"><input id="stChatImageMain" type="checkbox" ${chatBackground.showInMain ? 'checked' : ''}> Auch im Hauptfenster</label><label>Bildanpassung<select id="stChatImageFit"><option value="contain">Ganz anzeigen</option><option value="cover">Fenster ausfüllen</option></select></label><label>Position<select id="stChatImagePosition"><option value="center">Mitte</option><option value="left center">Links</option><option value="right center">Rechts</option></select></label></div><label>Abdunklung für lesbaren Chat <span id="stChatImageDarknessLabel">${Math.round(Number(chatBackground.darkness ?? .82) * 100)}%</span></label><div class="range-row"><input id="stChatImageDarkness" type="range" min="0" max="95" value="${Math.round(Number(chatBackground.darkness ?? .82) * 100)}"><span></span></div><div class="toolbar"><button class="primary" id="stChatImageSave">Chatbild-Einstellungen speichern</button></div><p class="composer-hint">PNG, JPG/JPEG oder WebP bis 20 MB. Das ausgewählte Bild wird sicher in die App kopiert und bleibt nach einem Neustart erhalten.</p></div></div>`) + section('Overlay / HTTP', `<div class="form-grid three"><div><label>Host</label><input id="stHost" value="${esc(h.host)}"></div><div><label>Port</label><input id="stPort" type="number" value="${h.port}"></div><div><label>Heartbeat Sekunden</label><input id="stHeartbeat" type="number" value="${h.heartbeatSeconds || 15}"></div></div><label class="check"><input id="stHttp" type="checkbox" ${h.enabled ? 'checked' : ''}> Overlay-Webserver aktiv</label>`) + section('Automatische Synchronisation / Zusatz-Einstellungen', `<label class="check"><input id="stSync" type="checkbox" ${sync.enabled !== false ? 'checked' : ''}> Änderungen sofort an laufende Module synchronisieren</label><div class="media-picker">${modules.map((module) => `<label class="media-check"><input type="checkbox" data-sync-module="${module}" ${sync.modules?.[module] === false ? '' : 'checked'}> ${esc(module)}</label>`).join('')}</div><p>Bei aktivierter Synchronisation werden gespeicherte Änderungen sofort in Dashboard, Overlays, Bridges, TTS, Commands, Events, Medien-Pools und Auto-Broadcast übernommen.</p>`) + section('Info', `<div class="info-card"><strong>Sarah Luna</strong><p>Ich danke Dir Für alles Sarah Luna Ich hab Dich Lieb Dein Bruder Crazy_Batto</p></div>`) + `<div class="toolbar"><button class="primary" id="stSave">Alles speichern & synchronisieren</button><button id="stOpen">Chat-Overlay öffnen</button></div>`;
  const overlaySettingsSection = [...$('#settingsModule').children].find((item) => item.querySelector('h3')?.textContent === 'Overlay / HTTP');
  overlaySettingsSection?.insertAdjacentHTML('beforebegin', section('Chat-Icons', `<div class="local-chat-icon-settings" id="localChatIconSettings"><div class="local-chat-icon-preview" id="localChatIconPreview">${localIconPreview}</div><div><strong>${esc(localIconName)}</strong><p id="localChatIconStatus">${esc(localIconStatus)}</p><div class="local-chat-icon-spec"><b>Lokaler Chat / Overlay</b><span>Ausgabe: 128 × 128 px</span><span>Anzeige im Multi-Chat: 19 × 19 px</span><span>Anzeige im OBS-Overlay: 22 × 22 px</span></div><div class="toolbar"><button class="primary" id="stLocalIconUpload">Bild hochladen</button><button id="stLocalIconReset" ${localIconConfig.mode === 'custom' ? '' : 'disabled'}>Standardpunkt verwenden</button></div><p class="composer-hint">PNG, JPG/JPEG oder WebP bis 20 MB. Das Bild wird automatisch mittig quadratisch zugeschnitten und als scharfes 128×128-PNG gespeichert.</p></div></div>`));
  $('#stChatImageFit').value = chatBackground.fit || 'contain';
  $('#stChatImagePosition').value = chatBackground.position || 'center';
  const updateChatPreview = () => {
    const darkness = Number($('#stChatImageDarkness').value) / 100;
    const lighter = Math.max(0, darkness - .18);
    const preview = $('#chatBackgroundPreview');
    preview.style.backgroundImage = `linear-gradient(90deg,rgba(5,5,6,${darkness}),rgba(5,5,6,${lighter})),${cssImageUrl(chatAsset.url)}`;
    preview.style.backgroundSize = `auto, ${$('#stChatImageFit').value}`;
    preview.style.backgroundPosition = `center, ${$('#stChatImagePosition').value}`;
    $('#stChatImageDarknessLabel').textContent = `${$('#stChatImageDarkness').value}%`;
  };
  updateChatPreview();
  $('#stChatImageDarkness').oninput = updateChatPreview;
  $('#stChatImageFit').onchange = updateChatPreview;
  $('#stChatImagePosition').onchange = updateChatPreview;
  $('#stChatImageUpload').onclick = async () => {
    const result = await api.importChatBackground();
    if (result.canceled) return;
    if (!result.ok) return toast(result.error || 'Chatbild konnte nicht geladen werden.', true);
    S.config = result.config; S.assets.chatBackground = result.asset; applyAppearance(); renderSettingsModule();
    toast(`Chatbild gespeichert (${result.width} × ${result.height}).`);
  };
  $('#stChatImagePreset').onclick = async () => {
    if (!confirm('Eigenes Chatbild entfernen und das Crazy_Batto-Motiv verwenden?')) return;
    const result = await api.resetChatBackground();
    if (!result.ok) return toast(result.error || 'Chatbild konnte nicht zurückgesetzt werden.', true);
    S.config = result.config; S.assets.chatBackground = result.asset; applyAppearance(); renderSettingsModule();
    toast('Crazy_Batto-Motiv wiederhergestellt.');
  };
  $('#stChatImageSave').onclick = async () => {
    await saveAndSync({ appearance:{ ...a, chatBackground:{ ...chatBackground, enabled:$('#stChatImageEnabled').checked, showInMain:$('#stChatImageMain').checked, fit:$('#stChatImageFit').value, position:$('#stChatImagePosition').value, darkness:Number($('#stChatImageDarkness').value) / 100 } } }, 'Chatbild-Einstellungen gespeichert.');
  };
  $('#stLocalIconUpload').onclick = async () => {
    const result = await api.importLocalChatIcon();
    if (result.canceled) return;
    if (!result.ok) return toast(result.error || 'Das lokale Chat-Icon konnte nicht geladen werden.', true);
    S.config = result.config; S.assets.localChatIcon = result.asset; renderDashboard(); renderSettingsModule();
    toast(`Lokales Chat-Icon als ${result.width} × ${result.height} px gespeichert.`);
  };
  $('#stLocalIconReset').onclick = async () => {
    if (!confirm('Eigenes Icon für Lokaler Chat / Overlay entfernen?')) return;
    const result = await api.resetLocalChatIcon();
    if (!result.ok) return toast(result.error || 'Das lokale Chat-Icon konnte nicht zurückgesetzt werden.', true);
    S.config = result.config; S.assets.localChatIcon = result.asset; renderDashboard(); renderSettingsModule();
    toast('Für lokalen Chat und Overlay wird wieder der Standardpunkt verwendet.');
  };
  $('#stDarkness').oninput = () => { $('#stDarknessLabel').textContent = `${$('#stDarkness').value}%`; document.documentElement.style.setProperty('--background-darkness', String(Number($('#stDarkness').value) / 100)); };
  $('#stSave').onclick = async () => {
    const moduleSync = {};
    $$('[data-sync-module]').forEach((input) => { moduleSync[input.dataset.syncModule] = input.checked; });
    await saveAndSync({ general: { ...g, displayName: $('#stName').value }, appearance: { ...a, uiScale: Number($('#stScale').value), programBackground: $('#stBackground').checked, backgroundDarkness: Number($('#stDarkness').value) / 100 }, http: { ...h, enabled: $('#stHttp').checked, host: $('#stHost').value, port: Number($('#stPort').value), heartbeatSeconds: Number($('#stHeartbeat').value) }, sync: { ...sync, enabled: $('#stSync').checked, modules: moduleSync } }, 'Alle Einstellungen gespeichert und synchronisiert.');
    renderSettingsModule();
  };
  $('#stOpen').onclick = () => api.openOverlay('/overlay/chat');
}

async function refresh(render = true) {
  const state = await api.getState();
  S.config = state.config;
  S.messages = state.messages || [];
  S.logs = state.logs || [];
  S.moderation = state.moderation || {};
  S.history = state.moderationHistory || [];
  S.adapters = state.adapters || {};
  S.overlay = state.overlay;
  S.obs = state.obs || {};
  S.secrets = state.secrets || {};
  S.assets = state.assets || {};
  applyAppearance();
  if (render) renderDashboard();
}

function bindStatic() {
  $$('#mainNav [data-view]').forEach((button) => { button.onclick = () => setView(button.dataset.view); });
  $$('[data-back-dashboard]').forEach((button) => { button.onclick = () => setView('dashboard'); });
  $$('[data-open-view]').forEach((button) => { button.onclick = () => setView(button.dataset.openView); });

  $('#composer').onsubmit = async (event) => {
    event.preventDefault();
    const text = $('#messageInput').value.trim();
    if (!text) return;
    const result = await api.sendMessage({ platform: $('#sendPlatform').value, text });
    if (!result.ok) return toast(result.error, true);
    $('#messageInput').value = '';
  };

  $('#contextMenu').onclick = (event) => {
    const action = event.target.closest('button')?.dataset.action;
    if (action) doModeration(S.contextUser, action, '');
  };
  document.addEventListener('click', (event) => { if (!event.target.closest('#contextMenu')) $('#contextMenu').hidden = true; });
  window.addEventListener('blur', () => { $('#contextMenu').hidden = true; });

  $('#historyPlatform').onchange = renderHistory;
  $('#previewHologram').onclick = () => api.openOverlay('/overlay/chat');
  $('#importFontBtn').onclick = async () => { const result = await api.importFont(); if (result.ok) { S.config = result.config; renderHologram(); toast('Schrift geladen.'); } };
  ['#holoUserEnabled', '#holoMessageEnabled', '#holoFont', '#holoUserColor', '#holoMsgColor', '#holoGlow', '#holoOpacity'].forEach((id) => { $(id).onchange = saveHologram; });

  $$('[data-co-format]').forEach((button) => { button.onclick = async () => { $$('[data-co-format]').forEach((x) => x.classList.toggle('active', x === button)); await saveCohost(); }; });
  $('#coPlaces').onchange = saveCohost;
  $('#coEnabled').onchange = saveCohost;
  $('#coSlotList').addEventListener('change', (event) => { if (event.target.matches('[data-co-slot]')) saveCohost(); });

  $$('[data-copy]').forEach((button) => { button.onclick = () => copy(button.dataset.copy === 'holo' ? $('#holoUrl').textContent : button.dataset.copy === 'coTik' ? $('#coTikUrl').textContent : $('#coTwUrl').textContent); });
  $('#detachBtn').onclick = () => detached ? api.closeDetached() : api.detachChat();
  $('#chatImageSettings').onclick = () => { setView('settings'); setTimeout(() => $('#chatBackgroundSettings')?.scrollIntoView({ block:'start' }), 0); };
  setInterval(() => { $('#clock').textContent = new Date().toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }); }, 1000);
}

function updateSystem(status) {
  S.system = status;
  $('#cpuStat').textContent = `${status.cpu?.toFixed?.(0) ?? '–'}%`;
  $('#ramStat').textContent = `${status.ram?.toFixed?.(0) ?? '–'}%`;
  $('#cpuMeter').value = status.cpu || 0;
  $('#ramMeter').value = status.ram || 0;
  $('#uploadStat').textContent = status.uploadKbps == null ? '–' : `${Math.round(status.uploadKbps)} kbps`;
  $('#fpsStat').textContent = status.fps == null ? '–' : Number(status.fps).toFixed(0);
  $('#bitrateStat').textContent = status.bitrateKbps == null ? '–' : `${Math.round(status.bitrateKbps)} kbps`;
}

async function boot() {
  await loadProgramBackground();
  await refresh();
  bindStatic();
  document.body.classList.toggle('detached',detached);
  if(!detached)setView(S.config.general.startView==='multichat'?'dashboard':S.config.general.startView || 'start');
  if (detached) {
    $('#sidebar').style.display = 'none';
    document.querySelector('.shell').style.gridTemplateColumns = '1fr';
    $$('.dashboard-grid>.card:not(.chat-card)').forEach((x) => { x.style.display = 'none'; });
    $('.dashboard-grid').style.display = 'block';
    $('.chat-card').style.height = '100%';
    $('#detachBtn').textContent = '↙';
  }

  api.onChatMessage((message) => {
    S.messages.push(message);
    const max = S.config.multiChat.maxMessages || 5000;
    if (S.messages.length > max) S.messages.splice(0, S.messages.length - max);
    renderChat();
  });
  api.onAdapterStatus((status) => {
    S.adapters[status.name] = status;
    renderConnections();
    if (S.view === 'platforms') renderPlatformsModule();
  });
  api.onModerationEvent(async () => {
    const state = await api.getState();
    S.moderation = state.moderation;
    S.history = state.moderationHistory;
    renderModeration(); renderHistory();
    if (S.view === 'moderation') renderModerationModule();
  });
  api.onFilterHit((hit) => toast(`Chat-Filter: ${hit.username} · ${hit.term}`));
  api.onPlatformEvent((event) => { if (['gift', 'follow', 'subscribe'].includes(event.event)) toast(`${event.platform || 'Event'} ${event.event}: ${event.data?.nickname || event.data?.uniqueId || ''}`); });
  api.onObsStatus((status) => { S.obs = status; renderConnections(); if (S.view === 'platforms') renderPlatformsModule(); });
  api.onSystemStatus(updateSystem);
  api.onTtsSpeak((payload) => {if(!detached)playTts(payload);});
  api.onConfigChanged((config) => {
    S.config = config;
    applyAppearance();
    renderDashboard();
    if (S.view !== 'dashboard') renderModule(S.view);
  });
  api.onChatBackgroundChanged?.(({ config, asset }) => {
    S.config = config;
    S.assets.chatBackground = asset;
    applyAppearance();
    renderDashboard();
    if (S.view !== 'dashboard') renderModule(S.view);
  });
  api.onLocalChatIconChanged?.(({ config, asset }) => {
    S.config = config;
    S.assets.localChatIcon = asset;
    renderDashboard();
    if (S.view !== 'dashboard') renderModule(S.view);
  });
}

boot().catch((error) => {
  console.error(error);
  toast(`Startfehler: ${error.message}`, true);
});
