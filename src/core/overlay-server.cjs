const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

class OverlayServer {
  constructor({ host, port, chatCore, configStore }) {
    this.host = host;
    this.port = port;
    this.chatCore = chatCore;
    this.configStore = configStore;
    this.server = null;
    this.wss = null;
    this.boundMessage = (message) => this.broadcast({ type: "chat", data: message });
  }

  getStatus() {
    return { running: Boolean(this.server?.listening), host: this.host, port: this.port };
  }

  async start() {
    if (this.server?.listening) return this.getStatus();

    const app = express();
    app.disable("x-powered-by");

    app.get("/health", (_req, res) => res.json({ ok: true, service: "batto-multi-chat", port: this.port }));
    app.get("/state", (_req, res) => res.json({ messages: this.chatCore.getMessages().slice(-100) }));

    app.get(["/overlay/chat", "/overlay/all"], (_req, res) => {
      const design = this.configStore.get().chatDesign;
      res.type("html").send(`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Batto Chat Overlay</title>
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
body{font-family:${escapeHtml(design.fontFamily)},Arial,sans-serif;color:${escapeHtml(design.messageColor)}}
#chat{position:absolute;left:24px;right:24px;bottom:24px;display:flex;flex-direction:column;gap:10px}
.msg{background:rgba(3,12,24,.66);border:1px solid rgba(96,165,250,.25);border-radius:14px;padding:10px 14px;backdrop-filter:blur(8px);animation:in .28s ease-out}
.user{color:${escapeHtml(design.usernameColor)};font-weight:800;text-shadow:0 0 ${Number(design.glow||0)}px currentColor}
.text{font-size:${Number(design.fontSize||20)}px;line-height:1.35;margin-left:8px}
.platform{font-size:11px;text-transform:uppercase;opacity:.65;margin-right:8px}
@keyframes in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
</style>
</head>
<body>
<div id="chat"></div>
<script>
const chat=document.getElementById("chat");
const ws=new WebSocket("ws://"+location.host+"/ws");
function add(m){
  const row=document.createElement("div"); row.className="msg";
  const p=document.createElement("span"); p.className="platform"; p.textContent=m.platform;
  const u=document.createElement("span"); u.className="user"; u.textContent=m.displayName||m.username;
  const t=document.createElement("span"); t.className="text"; t.textContent=m.message;
  row.append(p,u,t); chat.append(row);
  while(chat.children.length>8) chat.firstElementChild.remove();
  setTimeout(()=>row.remove(), ${Math.max(2, Number(design.displaySeconds||12)) * 1000});
}
fetch("/state").then(r=>r.json()).then(s=>(s.messages||[]).slice(-5).forEach(add)).catch(()=>{});
ws.onmessage=e=>{try{const x=JSON.parse(e.data); if(x.type==="chat") add(x.data)}catch{}};
</script>
</body>
</html>`);
    });

    for (const route of ["/overlay/gifts", "/overlay/follow", "/overlay/media", "/cohost/tiktok", "/cohost/twitch"]) {
      app.get(route, (_req, res) => {
        res.status(501).type("html").send("<!doctype html><meta charset='utf-8'><body style='background:transparent;color:white;font-family:Segoe UI'>Dieses Overlay ist in dieser Multi-Chat-Ausbaustufe noch nicht aktiv.</body>");
      });
    }

    this.server = http.createServer(app);
    this.wss = new WebSocketServer({ server: this.server, path: "/ws" });

    const listenOn = async (port) => {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          this.server?.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          this.server?.off("error", onError);
          resolve();
        };
        this.server.once("error", onError);
        this.server.once("listening", onListening);
        this.server.listen(port, this.host);
      });
    };

    let lastError;
    const requestedPort = this.port;
    for (let candidate = requestedPort; candidate <= Math.min(65535, requestedPort + 10); candidate++) {
      try {
        this.port = candidate;
        await listenOn(candidate);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (error.code !== "EADDRINUSE") throw error;
        this.server = http.createServer(app);
        this.wss = new WebSocketServer({ server: this.server, path: "/ws" });
      }
    }
    if (lastError) throw lastError;

    if (this.port !== requestedPort) {
      this.configStore.merge({ http: { port: this.port } });
      this.chatCore.log("WARN", "OBS", `Port ${requestedPort} belegt; Overlay-Server nutzt ${this.port}.`);
    }

    this.chatCore.on("message", this.boundMessage);
    this.chatCore.log("INFO", "OBS", `Overlay-Server läuft auf http://${this.host}:${this.port}`);
    return this.getStatus();
  }

  broadcast(payload) {
    if (!this.wss) return;
    const text = JSON.stringify(payload);
    for (const client of this.wss.clients) {
      if (client.readyState === 1) client.send(text);
    }
  }

  async stop() {
    this.chatCore?.off("message", this.boundMessage);
    if (this.wss) {
      for (const client of this.wss.clients) client.close();
      this.wss.close();
      this.wss = null;
    }
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(() => resolve()));
  }

  async restart(host, port) {
    await this.stop();
    this.host = host || "127.0.0.1";
    this.port = Number(port) || 8787;
    return this.start();
  }
}

module.exports = { OverlayServer };
