const OVERLAY_CLIENT = `function connectBatto(){
 const proxy={onmessage:null,send:value=>{if(socket?.readyState===1)socket.send(value);}};let socket,attempt=0,closed=false;
 function open(){if(closed)return;socket=new WebSocket('ws://'+location.host+'/ws');socket.onopen=()=>{attempt=0;};socket.onmessage=e=>{try{const x=JSON.parse(e.data);if(x.type==='config'){const route=location.pathname,sections=x.sections||[];if((route.includes('/cohost/')&&sections.includes('cohost'))||(route.includes('/chat')&&sections.includes('chatDesign')))location.reload();}else proxy.onmessage?.(e);}catch{}};socket.onclose=()=>{if(!closed)setTimeout(open,[1000,2000,5000,10000,30000][Math.min(attempt++,4)]);};socket.onerror=()=>socket.close();}
 window.addEventListener('beforeunload',()=>{closed=true;socket?.close();});open();return proxy;
}`;
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { isTikFinityWidgetUrl } = require('./settings/schema.cjs');

const PLATFORM_LOGO_DIR = path.join(__dirname, '..', 'assets', 'platforms');
const PLATFORM_LOGOS = new Set(['tiktok.svg', 'twitch.svg', 'youtube.svg']);

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function isLoopback(req) {
  const ip = String(req.socket?.remoteAddress || '');
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

class OverlayServer {
  constructor({ host = '127.0.0.1', port = 17777, chatCore, configStore }) {
    this.host = host;
    this.port = Number(port) || 17777;
    this.chatCore = chatCore;
    this.configStore = configStore;
    this.server = null;
    this.wss = null;
    this.startedAt = null;
    this.boundMessage = (message) => this.broadcast({ type: 'chat', data: message });
  }

  allowRequest(req) {
    const cfg = this.configStore.get().http || {};
    if(!isLoopback(req) && cfg.allowLan!==true)return false;
    try{
      const target=new URL('http://'+req.headers.host);
      if(Number(target.port || 80)!==this.port)return false;
      if(cfg.allowLan!==true && !['127.0.0.1','localhost','[::1]'].includes(target.hostname))return false;
      if(req.headers.origin){const origin=new URL(req.headers.origin);if(origin.origin!==target.origin)return false;}
      return true;
    }catch{return false;}
  }

  getStatus() {
    return {
      running: Boolean(this.server?.listening),
      host: this.host,
      port: this.port,
      wsClients: this.wss?.clients?.size || 0,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0
    };
  }

  getTikFinityWidget(id) {
    const widgets = this.configStore.get().platforms?.tikfinity?.webWidgets || [];
    return widgets.find((widget) => widget?.enabled === true && widget.id === id && isTikFinityWidgetUrl(widget.url)) || null;
  }

  chatHtml() {
    const design = this.configStore.get().chatDesign || {};
    const custom = design.customFontPath && fs.existsSync(design.customFontPath);
    const font = custom ? 'BattoCustom' : esc(design.fontFamily || 'Segoe UI');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
${custom ? `@font-face{font-family:BattoCustom;src:url('/font/custom')}` : ''}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
body{font-family:${font},Segoe UI,Arial;color:${esc(design.messageColor || '#fff')}}
#chat{position:absolute;left:24px;right:24px;bottom:24px;display:flex;flex-direction:column;gap:10px}
.msg{display:flex;align-items:center;gap:9px;background:rgba(2,12,28,${Math.max(.15, Math.min(1, Number(design.opacity ?? .92)))});border:1px solid rgba(0,212,255,.32);border-radius:15px;padding:10px 14px;backdrop-filter:blur(12px);box-shadow:0 10px 30px rgba(0,0,0,.22);animation:in .22s ease-out}
.user{color:${esc(design.usernameColor || '#00d4ff')};font-weight:900;text-shadow:0 0 ${Number(design.glow || 10)}px currentColor}
.text{font-size:${Number(design.fontSize || 20)}px;line-height:1.35}.platform{width:23px;height:23px;display:inline-grid;place-items:center;flex:0 0 23px}.platform img{display:block;width:22px;height:22px;object-fit:contain}.platform.internal{border-radius:6px;background:rgba(255,255,255,.12);font-size:13px}
@keyframes in{from{opacity:0;transform:translateY(16px) scale(.98)}to{opacity:1;transform:none}}
</style><script src="/overlay-client.js"></script></head><body><div id="chat"></div><script>
const chat=document.getElementById('chat');const ws=connectBatto();const platformLogos={tiktok:'/assets/platforms/tiktok.svg',twitch:'/assets/platforms/twitch.svg',youtube:'/assets/platforms/youtube.svg',cng:'https://cng-plattform.com/manus-storage/favicon_e3fccd67.png'};const platformNames={tiktok:'TikTok',twitch:'Twitch',youtube:'YouTube',cng:'CNG',internal:'Lokal'};
function add(m){const key=platformLogos[m.platform]?m.platform:'internal';const row=document.createElement('div');row.className='msg';const p=document.createElement('span');p.className='platform '+key;p.title=platformNames[key];p.setAttribute('aria-label',platformNames[key]);if(platformLogos[key]){const logo=document.createElement('img');logo.src=platformLogos[key];logo.alt=platformNames[key];p.append(logo)}else p.textContent='•';const u=document.createElement('span');u.className='user';u.textContent=m.displayName||m.username;const t=document.createElement('span');t.className='text';t.textContent=m.message;row.append(p,u,t);chat.append(row);while(chat.children.length>8)chat.firstElementChild.remove();setTimeout(()=>row.remove(),${Math.max(2, Number(design.displaySeconds || 12)) * 1000})}
fetch('/state').then(r=>r.json()).then(s=>(s.messages||[]).slice(-5).forEach(add)).catch(()=>{});ws.onmessage=e=>{try{const x=JSON.parse(e.data);if(x.type==='chat')add(x.data)}catch{}};
</script></body></html>`;
  }

  eventHtml(kind) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:Segoe UI;color:#fff}
#box{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}.card{max-width:75%;padding:20px 28px;border-radius:22px;background:rgba(1,13,32,.78);border:1px solid rgba(0,212,255,.38);box-shadow:0 20px 70px rgba(0,0,0,.38),0 0 30px rgba(0,145,255,.18);backdrop-filter:blur(14px);text-align:center;opacity:0;transform:scale(.92);transition:.25s}.card.show{opacity:1;transform:none}.title{font-size:14px;text-transform:uppercase;color:#61dcff}.big{font-size:32px;font-weight:900;margin-top:6px}
</style><script src="/overlay-client.js"></script></head><body><div id="box"><div id="card" class="card"><div class="title">${esc(kind)}</div><div id="big" class="big"></div></div></div><script>
const card=document.getElementById('card'),big=document.getElementById('big');let t;const ws=connectBatto();ws.onmessage=e=>{try{const x=JSON.parse(e.data);if(x.type!=='event')return;const evt=x.data||{};const normalizedType=evt.type||evt.event;if('${kind}'!=='all'&&normalizedType!=='${kind}')return;const d=evt.data||evt;big.textContent=d.user?.displayName||d.nickname||d.uniqueId||d.username||d.message?.text||d.text||normalizedType||'Event';card.classList.add('show');clearTimeout(t);t=setTimeout(()=>card.classList.remove('show'),5000)}catch{}};
</script></body></html>`;
  }

  mediaHtml() {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}#stage{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}video,img{max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 18px 45px rgba(0,0,0,.4))}audio{display:none}.fade{animation:show .2s ease-out}@keyframes show{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
</style><script src="/overlay-client.js"></script></head><body><div id="stage"></div><script>
const stage=document.getElementById('stage');const ws=connectBatto();let current=null,timer=null;
function clear(){clearTimeout(timer);if(current){try{current.pause?.()}catch{};current.remove();current=null}stage.innerHTML=''}
function play(d){clear();if(!d?.mediaId)return;const type=String(d.mediaType||'').toLowerCase();const url='/media/'+encodeURIComponent(d.mediaId);let el;if(['mp4','webm'].includes(type)){el=document.createElement('video');el.autoplay=true;el.playsInline=true}else if(['mp3','wav','ogg'].includes(type)){el=document.createElement('audio');el.autoplay=true}else{el=document.createElement('img')}el.src=url;el.className='fade';if('volume'in el)el.volume=Math.max(0,Math.min(1,Number(d.volume??1)));stage.append(el);current=el;const seconds=Number(d.durationSeconds||0);if(seconds>0)timer=setTimeout(clear,seconds*1000);else if(el.tagName==='AUDIO'||el.tagName==='VIDEO')el.onended=clear;else timer=setTimeout(clear,8000);el.play?.().catch(()=>{})}
ws.onmessage=e=>{try{const x=JSON.parse(e.data);if(x.type==='event'&&(x.data?.event==='media'||x.data?.type==='custom'&&x.data?.data?.event==='media'))play(x.data.data||{})}catch{}};
</script></body></html>`;
  }

  cohostHtml(format) {
    const cfg = this.configStore.get().cohost || {};
    const slots = (cfg.slots || []).slice(0, Math.max(1, Math.min(9, Number(cfg.places || 4))));
    const portrait = format === 'tiktok';
    const count = slots.length;
    const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
    const cards = slots.map((slot, index) => {
      const src = String(slot.source || '').trim();
      const content = /^https?:\/\//i.test(src)
        ? `<iframe src="${esc(src)}" allow="autoplay;camera;microphone" referrerpolicy="no-referrer"></iframe>`
        : `<div class="placeholder"><div class="avatar">${index + 1}</div><strong>${esc(slot.label || `Gast ${index + 1}`)}</strong><span>${src ? esc(src) : 'Quelle in der App zuweisen'}</span></div>`;
      return `<section class="guest">${content}</section>`;
    }).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:Segoe UI;color:white}.grid{position:absolute;inset:0;display:grid;grid-template-columns:repeat(${cols},1fr);grid-auto-rows:1fr;gap:${portrait ? '12' : '18'}px;padding:${portrait ? '12' : '18'}px}.guest{overflow:hidden;border-radius:20px;background:rgba(3,16,36,.72);border:2px solid rgba(0,212,255,.34);box-shadow:inset 0 0 40px rgba(0,90,180,.1);display:grid;place-items:center}.guest iframe{width:100%;height:100%;border:0}.placeholder{text-align:center;color:#d7efff}.avatar{width:72px;height:72px;border-radius:50%;display:grid;place-items:center;margin:0 auto 12px;background:linear-gradient(145deg,#0b5597,#071a33);border:1px solid #20bfff;font-size:30px;font-weight:900}.placeholder strong{display:block;font-size:24px}.placeholder span{display:block;color:#7ea6c6;margin-top:6px;font-size:13px}
</style><script src="/overlay-client.js"></script></head><body><main class="grid">${cards}</main></body></html>`;
  }

  async start() {
    if (this.server?.listening) return this.getStatus();
    const app = express();
    app.disable('x-powered-by');
    app.use((req,res,next)=>{if(!this.allowRequest(req))return res.sendStatus(403);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');next();});
    app.use(express.json({ limit: '256kb' }));
    app.get('/overlay-client.js',(_req,res)=>res.type('application/javascript').send(OVERLAY_CLIENT));
    app.get('/assets/platforms/:name', (req, res) => {
      const name=String(req.params.name || '').toLowerCase();
      if (!PLATFORM_LOGOS.has(name)) return res.sendStatus(404);
      return res.type('image/svg+xml').sendFile(path.join(PLATFORM_LOGO_DIR, name));
    });

    app.get('/health', (_req, res) => res.json({ ok: true, service: 'batto-obs-tool-2.1', ...this.getStatus() }));
    app.get('/state', (_req, res) => res.json({ messages: this.chatCore.getMessages().slice(-100) }));
    app.get(['/overlay/chat', '/overlay/all'], (_req, res) => res.type('html').send(this.chatHtml()));
    app.get(['/overlay/alerts', '/overlay/events'], (_req, res) => res.type('html').send(this.eventHtml('all')));
    app.get('/overlay/gifts', (_req, res) => res.type('html').send(this.eventHtml('gift')));
    app.get('/overlay/follow', (_req, res) => res.type('html').send(this.eventHtml('follow')));
    app.get('/overlay/subs', (_req, res) => res.type('html').send(this.eventHtml('sub')));
    app.get('/overlay/media', (_req, res) => res.type('html').send(this.mediaHtml()));
    app.get('/overlay/tikfinity/:id', (req, res) => {
      const widget=this.getTikFinityWidget(String(req.params.id || ''));
      if (!widget) return res.status(404).type('text/plain').send('TikFinity HTTPS-Widget nicht gefunden oder deaktiviert.');
      return res.redirect(302, widget.url);
    });
    app.get('/cohost/tiktok', (_req, res) => res.type('html').send(this.cohostHtml('tiktok')));
    app.get('/cohost/twitch', (_req, res) => res.type('html').send(this.cohostHtml('twitch')));

    app.get('/media/:id', (req, res) => {
      if (!this.allowRequest(req)) return res.sendStatus(403);
      const media = (this.configStore.get().media || []).find((item) => item.id === req.params.id);
      if (!media?.path || !fs.existsSync(media.path)) return res.sendStatus(404);
      res.sendFile(path.resolve(media.path));
    });

    app.get('/font/custom', (req, res) => {
      if (!this.allowRequest(req)) return res.sendStatus(403);
      const fontPath = this.configStore.get().chatDesign?.customFontPath;
      if (!fontPath || !fs.existsSync(fontPath)) return res.sendStatus(404);
      res.sendFile(path.resolve(fontPath));
    });

    app.post('/api/ingest', (req, res) => {
      if (!this.allowRequest(req)) return res.status(403).json({ ok: false, error: 'local only' });
      const body = req.body || {};
      if (body.type === 'chat' || body.message || body.text) {
        const message = this.chatCore.ingest(body.data || body);
        return res.json({ ok: Boolean(message) });
      }
      this.emitEvent(body);
      return res.json({ ok: true });
    });

    this.server = http.createServer(app);
    this.wss = new WebSocketServer({ server: this.server, path: '/ws', maxPayload: 256 * 1024 });
    this.wss.on('connection', (ws, req) => {
      if (!this.allowRequest(req)) {
        ws.close(1008, 'local only');
        return;
      }
      const maxClients = Math.max(1, Number(this.configStore.get().http?.maxWsClients || 20));
      if (this.wss.clients.size > maxClients) {
        ws.close(1013, 'client limit');
        return;
      }
      ws.send(JSON.stringify({ type: 'hello', data: { service: 'Batto OBS Tool 2.1', port: this.port } }));
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server.off('listening', onListen);
        reject(error);
      };
      const onListen = () => {
        this.server.off('error', onError);
        resolve();
      };
      this.server.once('error', onError);
      this.server.once('listening', onListen);
      this.server.listen(this.port, this.host);
    }).catch((error) => {
      if (error.code === 'EADDRINUSE') {
        const err = new Error(`Overlay-Port ${this.port} ist belegt. Der Port wird nicht automatisch geändert.`);
        err.code = 'OVERLAY_PORT_IN_USE';
        throw err;
      }
      throw error;
    });

    this.startedAt = Date.now();
    this.chatCore.on('message', this.boundMessage);
    this.chatCore.log('INFO', 'Overlay', `Overlay-Server: http://${this.host}:${this.port}`);
    return this.getStatus();
  }

  emitEvent(evt) { this.broadcast({ type: 'event', data: evt }); }

  broadcast(payload) {
    if (!this.wss) return;
    const text = JSON.stringify(payload);
    for (const client of this.wss.clients) {
      if (client.readyState === 1 && client.bufferedAmount < 1024 * 1024) client.send(text);
    }
  }

  async stop() {
    this.chatCore?.off('message', this.boundMessage);
    if (this.wss) {
      for (const client of this.wss.clients) client.close();
      try { this.wss.close(); } catch {}
      this.wss = null;
    }
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.startedAt = null;
    await new Promise((resolve) => server.close(() => resolve()));
  }

  async restart(host, port) {
    await this.stop();
    this.host = host || '127.0.0.1';
    this.port = Number(port) || 17777;
    return this.start();
  }
}

module.exports = { OverlayServer, isLoopback };
