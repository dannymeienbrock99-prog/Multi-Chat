(() => {
  const baseRenderSettings = renderSettings;

  function currentTwitchConfig() {
    return S.config?.platforms?.twitch || { account: "", channel: "", autoConnect: false };
  }

  function statusText() {
    const s = S.adapters?.twitch || {};
    if (s.connected) return `Verbunden als ${esc(s.account || "Twitch")}${s.channel ? ` · #${esc(s.channel)}` : ""}`;
    if (s.error) return `Fehler: ${esc(s.error)}`;
    if (s.state === "connecting") return "Verbindung wird hergestellt …";
    if (s.state === "configured") return "Konfiguriert";
    if (s.state === "stopped") return "Getrennt";
    return "Noch nicht mit Twitch verbunden.";
  }

  function twitchCardHtml() {
    const c = currentTwitchConfig();
    return `
      <div class="config-card" id="twitchDirectCard">
        <h3>Twitch</h3>
        <p>Direkte Twitch-IRC-Verbindung. Eine Client-ID muss im Tool nicht eingetragen werden, wenn bereits ein gültiger Twitch User Access Token vorhanden ist.</p>
        <div class="field-grid">
          ${field("Account", "twAccount", c.account || "")}
          ${field("Channel / Twitch-URL", "twChannel", c.channel || "crazy_batto")}
          ${field("OAuth / Access Token", "twToken", "", "password")}
        </div>
        ${check("Automatisch verbinden", "twAuto", Boolean(c.autoConnect))}
        <div class="composer-hint">Das Channel-Feld akzeptiert auch deine Dashboard-Adresse, z. B. dashboard.twitch.tv/popout/u/crazy_batto/stream-manager/chat. Der Kanalname wird automatisch herausgelesen. Der Token wird verschlüsselt über Windows Secure Storage gespeichert und nie wieder im Klartext angezeigt.</div>
        <div class="section-title"><strong>Twitch-Anmeldung</strong><span id="twAuthState">${statusText()}</span></div>
        <div class="top-actions" style="justify-content:flex-start;flex-wrap:wrap">
          <button id="twSaveConnect" class="primary">Token speichern & verbinden</button>
          <button id="twCheck">Token prüfen</button>
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
        const r = await api.twitchSaveConnect({
          token: $("#twToken")?.value || "",
          channel: $("#twChannel")?.value || "",
          autoConnect: Boolean($("#twAuto")?.checked)
        });
        if (!r.ok) return toast(r.error || "Twitch-Verbindung fehlgeschlagen.", true);
        $("#twToken").value = "";
        await refresh();
        renderSettings();
        toast(`Twitch verbunden: ${r.login} · #${r.channel}`);
      } finally {
        save.disabled = false;
      }
    };

    $("#twCheck").onclick = async () => {
      const r = await api.twitchCheck({ token: $("#twToken")?.value || "" });
      if (!r.ok) return toast(r.error || "Twitch-Token ungültig.", true);
      const mins = r.expiresIn > 0 ? Math.floor(r.expiresIn / 60) : 0;
      toast(`Token gültig: ${r.login} · Scopes: ${(r.scopes || []).join(", ")}${mins ? ` · noch ca. ${mins} Min.` : ""}`);
    };

    $("#twDisconnect").onclick = async () => {
      const r = await api.twitchDisconnect();
      if (!r.ok) return toast(r.error || "Trennen fehlgeschlagen.", true);
      await refresh();
      renderSettings();
      toast("Twitch getrennt.");
    };

    $("#twClear").onclick = async () => {
      if (!confirm("Gespeicherten Twitch-Token und Twitch-Anmeldedaten wirklich löschen?")) return;
      const r = await api.twitchClear();
      if (!r.ok) return toast(r.error || "Twitch-Daten konnten nicht gelöscht werden.", true);
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
      if (small) small.textContent = "Direkter IRC-Adapter ist oben konfigurierbar";
    }

    bindTwitchUi();
  };
})();
