'use strict';
(() => {
  const wait = () => {
    if (typeof S === 'undefined' || !S.config || typeof setView !== 'function') return setTimeout(wait, 50);
    document.body.classList.toggle('detached', Boolean(detached));
    if (typeof renderBroadcastModule === 'function' && window.BattoBroadcast) {
      renderBroadcastModule = function renderBroadcastModuleGold() {
        const el = document.querySelector('#broadcastModule');
        if (!el) return;
        window.BattoBroadcast.render({ el, config:S.config, api:window.batto, toast });
      };
    }
    if (typeof renderSettingsModule === 'function') {
      const baseSettings = renderSettingsModule;
      renderSettingsModule = function renderSettingsGold() {
        const result = baseSettings();
        const el = document.querySelector('#settingsModule');
        if (el && !el.querySelector('.settings-family')) {
          const family = document.createElement('section');
          family.className = 'panel-section settings-family';
          family.innerHTML = `<h3>Team Alpha</h3><div class="settings-family-grid"><figure><img src="../assets/source/sarah-original.png" alt="Sarah Luna"><figcaption>Sarah Luna</figcaption></figure><figure><img src="../assets/source/michelle-original.png" alt="Michelle"><figcaption>Michelle</figcaption></figure></div>`;
          el.appendChild(family);
        }
        return result;
      };
    }
    if (detached) setView('dashboard');
    else setView(S.config?.general?.startView === 'dashboard' || S.config?.general?.startView === 'multichat' ? 'dashboard' : 'start');
  };
  wait();
})();
