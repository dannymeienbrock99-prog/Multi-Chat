"use strict";
// Deterministic migration of the legacy packed renderer; fail loudly if its
// source changes instead of silently applying a partial UI patch.
function patchRenderer(source) {
  function replace(oldText, newText) {
    if (!source.includes(oldText)) throw new Error(`Renderer migration target missing: ${oldText.slice(0, 90)}`);
    source = source.replace(oldText, newText);
  }
  const helper = `function rerenderActionForm(prefix, render) {
    const ids = prefix === 'cmd' ? ['cmdTrigger','cmdPlatform','cmdCd','cmdEnabled'] : ['evPlatform','evEventType','evMatch','evMin','evEnabled'];
    const draft = ids.map(id => { const el = document.getElementById(id); return [id, el.value, el.checked]; });
    render();
    for (const [id, value, checked] of draft) { const el = document.getElementById(id); el.value = value; if (el.type === 'checkbox') el.checked = checked; }
  }
  `;
  replace('function renderCommandsModule() {', helper + 'function renderCommandsModule() {');
  replace('if (editing && !S.commandDraft.length) S.commandDraft = structuredClone(editing.actions || []);', '');
  replace('if (editing && !S.eventDraft.length) S.eventDraft = structuredClone(editing.actions || []);', '');
  replace('S.commandDraft.push(action); renderCommandsModule();', "S.commandDraft.push(action); rerenderActionForm('cmd', renderCommandsModule);");
  replace('S.commandDraft.splice(Number(button.dataset.cmdActionDel), 1); renderCommandsModule();', "S.commandDraft.splice(Number(button.dataset.cmdActionDel), 1); rerenderActionForm('cmd', renderCommandsModule);");
  replace('S.eventDraft.push(action); renderEventsModule();', "S.eventDraft.push(action); rerenderActionForm('ev', renderEventsModule);");
  replace('S.eventDraft.splice(Number(button.dataset.evActionDel), 1); renderEventsModule();', "S.eventDraft.splice(Number(button.dataset.evActionDel), 1); rerenderActionForm('ev', renderEventsModule);");
  replace("$('#pfSave').onclick = async () => {", "$('#pfSave').onclick = async () => { const youtubeKey = $('#pfYtKey').value;");
  replace("if ($('#pfYtKey').value) await api.youtubeSaveKey($('#pfYtKey').value);", "if (youtubeKey) await api.youtubeSaveKey(youtubeKey);");
  replace("$('#cngSave').onclick = async () => {", "$('#cngSave').onclick = async () => { const cngChatUrl = $('#cngChatSecret').value;");
  replace("if ($('#cngChatSecret').value) {", 'if (cngChatUrl) {');
  replace("await api.cngSaveChatUrl($('#cngChatSecret').value)", 'await api.cngSaveChatUrl(cngChatUrl)');
  replace('const port = S.overlay?.port || S.config?.http?.port || 8787;', 'const port = S.overlay?.port || S.config?.http?.port || 17777;');
  replace('id="${prefix}Platform"', 'id="${prefix}TargetPlatform"');
  replace("$(`#${prefix}Platform`).value", "$(`#${prefix}TargetPlatform`).value");
  replace('id="evType"', 'id="evEventType"');
  replace("$('#evType').value = editing?.event", "$('#evEventType').value = editing?.event");
  replace("event: $('#evType').value", "event: $('#evEventType').value");
  const bgStart = source.indexOf('async function loadProgramBackground() {');
  const bgEnd = source.indexOf('function applyAppearance()', bgStart);
  if (bgStart < 0 || bgEnd < 0) throw new Error('Background loader migration target missing');
  source = source.slice(0, bgStart) + `async function loadProgramBackground() {
    document.documentElement.style.setProperty('--program-background', "url('../assets/program-background.jpg')");
  }

` + source.slice(bgEnd);
  return source;
}
module.exports = { patchRenderer };
