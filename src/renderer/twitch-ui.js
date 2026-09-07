(() => {
  const baseRenderSettings = renderSettings;

  function currentTwitchConfig() {
    return S.config?.platforms?.twitch || { channel: "", autoConnect: false };
  }

  function statusText() {
    const s = S.adapters?.twitch || {};
    if (s.connected) return `Verbunden · #${esc(s.channel || "twitch")} · Nur Lesen`;
    if (s.error) return `Fehler: ${esc(s.error)}`;
    if (s.state === "connecting") return "Verbindung wird hergestellt …";
    if (s.state === "configured") return "Kanal konfiguriert";
    if (s.state === "stopped") return "Getrennt";
    return "Noch nicht mit Twitch verbunden.";
  }

  function twitchCardHtml() {
    const c = currentTwitchConfig();
    return `
      <div class="config-card" id="twitchDirectCard">
        <h3>Twitch</h3>
        <p>Twitch-Chat direkt lesen – ohne zusätzliche Anmeldedaten.</p>
        <div class="field-grid">
          ${field("Channel / Twitch-URL", "twChannel", c.channel || "crazy_batto")}
        </div>
        ${check("Automatisch verbinden", "twAuto", Boolean(c.autoConnect))}
        <div class="composer-hint">Du kannst den Kanalnamen, eine normale Twitch-URL oder deine Dashboard-Chat-Adresse einfügen. Beispiel: dashboard.twitch.tv/popout/u/crazy_batto/stream-manager/chat. Dieser Modus ist absichtlich Nur-Lesen; Senden und Plattform-Moderation werden nicht als funktionierend vorgetäuscht.</div>
        <div class="section-title"><strong>Twitch-Chat</strong><span id="twAuthState">${statusText()}</span></div>
        <div class="top-actions" style="justify-content:flex-start;flex-wrap:wrap">
          <button id="twSaveConnect" class="primary">Speichern & verbinden</button>
          <button id="twDisconnect">Trennen</button>
          <button id="twClear" class="danger">Twitch-Daten löschen</button>
          <button id="twDashboard">Dashboard-Chat öffnen</button>
        </div>
      </div>`;
  }

  function bindTwitchUi() {
    const save = $("#twSaveConnect");
    if (!save) return;

    save.onclick = async () => {
      save.disabled = true;
      try {
        const current = currentTwitchConfig();
        const channel = $("#twChannel")?.value || "";
        const autoConnect = Boolean($("#twAuto")?.checked);
        const next = await api.saveConfig({
          platforms: {
            ...S.config.platforms,
            twitch: {
              ...current,
              enabled: true,
              channel,
              autoConnect,
              status: channel ? "configured" : "not-configured"
            }
          }
        });
        S.config = next;
        const r = await api.connectAdapter("twitch");
        if (!r.ok) return toast(r.error || "Twitch-Verbindung fehlgeschlagen.", true);
        await refresh();
        renderSettings();
        toast(`Twitch-Chat verbunden: #${r.status?.channel || channel}`);
      } finally {
        save.disabled = false;
      }
    };

    $("#twDisconnect").onclick = async () => {
      const r = await api.disconnectAdapter("twitch");
      if (!r.ok) return toast(r.error || "Trennen fehlgeschlagen.", true);
      await refresh();
      renderSettings();
      toast("Twitch getrennt.");
    };

    $("#twClear").onclick = async () => {
      if (!confirm("Gespeicherten Twitch-Kanal wirklich löschen?")) return;
      await api.disconnectAdapter("twitch");
      const current = currentTwitchConfig();
      S.config = await api.saveConfig({
        platforms: {
          ...S.config.platforms,
          twitch: {
            ...current,
            channel: "",
            account: "",
            autoConnect: false,
            status: "not-configured"
          }
        }
      });
      await refresh();
      renderSettings();
      toast("Twitch-Daten gelöscht.");
    };

    $("#twDashboard").onclick = async () => {
      const r = await api.twitchOpenDashboard($("#twChannel")?.value || "");
      if (!r.ok) toast(r.error || "Twitch-Dashboard konnte nicht geöffnet werden.", true);
    };
  }

  renderSettings = function renderSettingsWithTwitch() {
    baseRenderSettings();
    if (S.settingsPage !== "platforms") return;

    const page = $("#settingsPage");
    const cards = page?.querySelectorAll(".config-card");
    if (!page || !cards?.length) return;
    cards[0].insertAdjacentHTML("afterend", twitchCardHtml());

    const legacyTwitch = [...page.querySelectorAll(".filter-item")]
      .find((row) => row.querySelector("strong")?.textContent?.trim() === "Twitch");
    if (legacyTwitch) {
      const small = legacyTwitch.querySelector("small");
      if (small) small.textContent = "Direkter Chat-Lesemodus ist oben konfigurierbar";
    }

    bindTwitchUi();
  };
})();
